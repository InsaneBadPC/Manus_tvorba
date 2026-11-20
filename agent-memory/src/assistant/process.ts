import { spawn } from "node:child_process";
import type {
  ProcessOptions,
  ProcessResult,
  ProcessRunner,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 120_000;

/**
 * Runs one process without a shell. Callers that need shell semantics pass
 * `bash -lc <command>` explicitly, so tool arguments can never be re-parsed by
 * a shell by accident.
 */
export class NodeProcessRunner implements ProcessRunner {
  async run(
    file: string,
    args: string[],
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const maxOutput = Math.max(1_000, options.maxOutputChars ?? DEFAULT_MAX_OUTPUT);

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      };

      let child;
      try {
        child = spawn(file, args, {
          cwd: options.cwd,
          env: options.env ?? process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({
          code: -1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false,
        });
        return;
      }

      const append = (current: string, chunk: Buffer) => {
        if (current.length >= maxOutput) return current;
        return (current + chunk.toString("utf8")).slice(0, maxOutput);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => {
        stderr = append(stderr, Buffer.from(error.message, "utf8"));
        finish(-1);
      });
      child.on("close", (code) => {
        finish(typeof code === "number" ? code : -1);
      });

      timer = setTimeout(() => {
        timedOut = true;
        stderr = append(stderr, Buffer.from(`\nprocess timed out after ${timeoutMs}ms\n`, "utf8"));
        child.kill("SIGKILL");
        // Some runtimes do not emit close after SIGKILL promptly.
        setTimeout(() => finish(-1), 500).unref();
      }, timeoutMs);
      timer.unref();
    });
  }
}

export function quoteForDisplay(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
