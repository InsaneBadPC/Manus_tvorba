import type { MemoryContext } from "../context.ts";

export type ChatRole = "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  name?: string;
  created?: string;
}

export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ModelTool[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ChatToolCall[];
  model: string;
  finishReason?: string;
}

/** The only model-specific boundary in the assistant loop. */
export interface ChatModelAdapter {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export type ToolRisk = 0 | 1 | 2 | 3;

export interface ToolContext extends MemoryContext {
  sessionId: string;
  projectCwd: string;
  processRunner: ProcessRunner;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  changed?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  reversible: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

export interface ApprovalRequest {
  tool: string;
  risk: ToolRisk;
  summary: string;
  details: string;
}

export type ApprovalDecision = "approve" | "deny";

export interface ApprovalGate {
  request(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface ProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessRunner {
  run(file: string, args: string[], options?: ProcessOptions): Promise<ProcessResult>;
}

export interface AssistantRunOptions {
  message: string;
  ctx: MemoryContext;
  adapter: ChatModelAdapter;
  approval: ApprovalGate;
  projectCwd: string;
  sessionId?: string;
  agentId?: string;
  maxSteps?: number;
  maxModelCalls?: number;
  processRunner?: ProcessRunner;
  extractor?: import("../types.ts").ModelAdapter;
  onEvent?: (event: AssistantEvent) => void;
}

export type AssistantEvent =
  | { type: "assistant"; text: string }
  | { type: "tool"; call: ChatToolCall; outcome: ToolOutcome }
  | { type: "approval"; request: ApprovalRequest; decision: ApprovalDecision }
  | { type: "step"; index: number };

export interface AssistantRunResult {
  sessionId: string;
  text: string;
  messages: ChatMessage[];
  tools: Array<{ call: ChatToolCall; outcome: ToolOutcome }>;
  model: string;
  steps: number;
  hitLimit: boolean;
  remembered: string[];
  skill?: string;
}
