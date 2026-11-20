import type {
  ExtractionRequest,
  MemoryCandidate,
  ModelAdapter,
} from "../types.ts";

const SYSTEM_PROMPT = `Jsi extraktor trvalé paměti osobního agenta.
Z jedné uživatelské zprávy vytáhni pouze informace, které mají vydržet déle než aktuální úkol:
preference, rozhodnutí, konvence projektu, důležitá fakta, opakované postupy a opravy.

Nevracej:
- tajemství, API klíče, hesla, tokeny ani obsah soukromých klíčů;
- efemérní stav ("dnes", "teď", "zítra", rozdělaná práce);
- domněnky bez opory ve zprávě;
- obsah, který je už zřejmý z kódu nebo z historie.

Vrať pouze JSON pole objektů. Každý objekt má:
name (2-100 znaků, výstižný název),
description (1-500 znaků, jedna věta),
body (volitelné detaily, max 4000 znaků),
tags (max 8 krátkých štítků),
scope ("global" | "project" | "agent"; použij "project", pokud jde o tento projekt),
confidence (0-1),
source ("stated", pokud to uživatel řekl přímo; "inferred", pokud to plyne z kontextu),
durability ("durable" nebo "ephemeral").

Když není co uložit, vrať [].
Nic jiného než JSON nevracej.`;

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GeminiAdapter implements ModelAdapter {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiOptions) {
    if (!options.apiKey) throw new Error("Gemini API key is required");
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "gemini-2.5-flash";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async extract(request: ExtractionRequest): Promise<MemoryCandidate[]> {
    const context = [
      request.projectId ? `Projekt: ${request.projectId}` : "",
      request.agentId ? `Agent: ${request.agentId}` : "",
      request.existingNames?.length
        ? `Už uložené názvy (nevytvářej duplikáty): ${request.existingNames.slice(0, 100).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [{ text: `${context}\n\nUživatelská zpráva:\n${request.text}` }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Gemini request failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };

    if (payload.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request: ${payload.promptFeedback.blockReason}`);
    }

    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";

    return parseExtractionJson(raw);
  }
}

export function parseExtractionJson(raw: string): MemoryCandidate[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!cleaned) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end <= start) return [];
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is MemoryCandidate => Boolean(entry) && typeof entry === "object",
  );
}

export function createAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GeminiAdapter | undefined {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new GeminiAdapter({ apiKey, model: env.GEMINI_MODEL });
}
