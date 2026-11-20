import type {
  ChatModelAdapter,
  ChatRequest,
  ChatResponse,
} from "../assistant/types.ts";

/**
 * Deterministic adapter for tests and for exercising the loop without a
 * network. It returns the queued turns in order.
 */
export class FakeChatAdapter implements ChatModelAdapter {
  readonly name = "fake-chat";
  private readonly turns: ChatResponse[];
  readonly requests: ChatRequest[] = [];

  constructor(turns: ChatResponse[]) {
    this.turns = [...turns];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const turn = this.turns.shift();
    if (!turn) throw new Error("FakeChatAdapter ran out of scripted turns");
    return { ...turn, model: turn.model || this.name };
  }
}
