import readline from "node:readline/promises";
import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequest,
} from "./types.ts";

export class AutoApprovalGate implements ApprovalGate {
  async request(): Promise<ApprovalDecision> {
    return "approve";
  }
}

export class DenyApprovalGate implements ApprovalGate {
  private readonly reason: string;

  constructor(reason = "no interactive approval available") {
    this.reason = reason;
  }

  async request(): Promise<ApprovalDecision> {
    void this.reason;
    return "deny";
  }
}

/** Interactive terminal gate. Non-TTY input denies risky actions by default. */
export class CliApprovalGate implements ApprovalGate {
  private readonly rl: readline.Interface;
  private readonly output: NodeJS.WritableStream;

  constructor(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stderr,
  ) {
    this.output = output;
    this.rl = readline.createInterface({ input, output });
  }

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.output.write(
      `\n[schválení ${request.risk}/3] ${request.tool}\n${request.summary}\n` +
        `${request.details}\nSchválit? [a]no/[n]e: `,
    );
    let answer = "";
    try {
      answer = (await this.rl.question("")).trim().toLowerCase();
    } catch {
      answer = "";
    }
    return answer === "a" || answer === "ano" || answer === "y" || answer === "yes"
      ? "approve"
      : "deny";
  }

  close(): void {
    this.rl.close();
  }
}
