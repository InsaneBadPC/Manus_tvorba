import type { EmbeddingAdapter } from "../embeddings.ts";

export interface GeminiEmbeddingOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Gemini batched embedding endpoint. The model and dimensionality are part of
 * the adapter name so old vectors are invalidated when either changes.
 */
export class GeminiEmbeddingAdapter implements EmbeddingAdapter {
  readonly name: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiEmbeddingOptions) {
    if (!options.apiKey) throw new Error("Gemini API key is required");
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "gemini-embedding-001";
    this.dimensions = Math.max(64, Math.min(3072, options.dimensions ?? 768));
    this.name = `${this.model}@${this.dimensions}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text: text.slice(0, 20_000) }] },
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: this.dimensions,
          })),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini embedding failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const payload = (await response.json()) as {
      embeddings?: Array<{ values?: number[] }>;
    };
    const vectors = (payload.embeddings ?? []).map((entry) => entry.values ?? []);
    if (vectors.length !== texts.length) {
      throw new Error(`Gemini returned ${vectors.length} embeddings for ${texts.length} inputs`);
    }
    return vectors;
  }
}

export function createEmbeddingAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GeminiEmbeddingAdapter | undefined {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new GeminiEmbeddingAdapter({
    apiKey,
    model: env.GEMINI_EMBED_MODEL,
    dimensions: Number(env.GEMINI_EMBED_DIM) || undefined,
    timeoutMs: Number(env.GEMINI_TIMEOUT_MS) || undefined,
  });
}
