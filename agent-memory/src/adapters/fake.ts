import type {
  ExtractionRequest,
  MemoryCandidate,
  ModelAdapter,
} from "../types.ts";

export class FakeAdapter implements ModelAdapter {
  readonly name = "fake";
  private readonly candidates: MemoryCandidate[];

  constructor(candidates: MemoryCandidate[] = []) {
    this.candidates = candidates;
  }

  async extract(_request: ExtractionRequest): Promise<MemoryCandidate[]> {
    return this.candidates;
  }
}
