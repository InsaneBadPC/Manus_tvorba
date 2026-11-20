import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ChatModelAdapter,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
} from "../assistant/types.ts";

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const part: GeminiPart = {
        functionResponse: {
          name: message.name ?? "unknown",
          response: { result: message.content.slice(0, 60_000) },
        },
      };
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts.every((entry) => entry.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content.trim()) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }

    if (message.content.trim()) {
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts.every((entry) => entry.text)) {
        last.parts.push({ text: message.content });
      } else {
        contents.push({ role: "user", parts: [{ text: message.content }] });
      }
    }
  }
  return contents;
}

function parseResponse(payload: unknown, model: string): ChatResponse {
  const data = payload as {
    candidates?: Array<{
      content?: { parts?: GeminiPart[] };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("");
  const toolCalls: ChatToolCall[] = [];
  for (const part of parts) {
    if (!part.functionCall?.name) continue;
    toolCalls.push({
      id: `call-${randomUUID()}`,
      name: part.functionCall.name,
      arguments: part.functionCall.args ?? {},
    });
  }
  if (!text.trim() && toolCalls.length === 0) {
    throw new Error("Gemini returned an empty response");
  }
  return {
    text,
    toolCalls,
    model,
    finishReason: candidate?.finishReason,
  };
}

export interface GeminiChatOptions {
  apiKey: string;
  models?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

export class GeminiChatAdapter implements ChatModelAdapter {
  readonly name: string;
  private readonly apiKeys: string;
  private readonly models: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: GeminiChatOptions) {
    if (!options.apiKey) throw new Error("Gemini API key is required");
    this.apiKeys = options.apiKey;
    this.models = (options.models?.length ? options.models : ["gemini-2.5-flash"])
      .map((model) => model.trim())
      .filter(Boolean);
    this.name = this.models[0] ?? "gemini-2.5-flash";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retries = Math.max(0, Math.min(2, options.retries ?? 1));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const models = request.model
      ? [request.model, ...this.models.filter((model) => model !== request.model)]
      : this.models;
    const failures: string[] = [];
    for (const model of models) {
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        try {
          return await this.callModel(model, request);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${model}: ${message}`);
          const retryable = /\b(429|500|502|503|504)\b|timeout|fetch failed|ECONN/i.test(message);
          if (!retryable || attempt === this.retries) break;
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
    }
    throw new Error(`all Gemini models failed: ${failures.join(" | ").slice(0, 1_000)}`);
  }

  private async callModel(model: string, request: ChatRequest): Promise<ChatResponse> {
    const functions = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: request.system }] },
      contents: toContents(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxOutputTokens ?? 2_048,
      },
    };
    if (functions.length) {
      body.tools = [{ functionDeclarations: functions }];
      body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKeys,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    return parseResponse(await response.json(), model);
  }
}

export function createChatAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GeminiChatAdapter | undefined {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return undefined;
  const models = (env.GEMINI_MODELS ?? env.GEMINI_MODEL ?? "gemini-2.5-flash")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return new GeminiChatAdapter({
    apiKey,
    models,
    timeoutMs: Number(env.GEMINI_TIMEOUT_MS) || undefined,
  });
}
