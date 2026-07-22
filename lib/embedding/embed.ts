export const TOGETHER_EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";
export const MAX_EMBED_CHARS = 600; // Keep Together input below multilingual-e5-large-instruct's 512-token limit.
export const EMBED_BATCH = 8;

const TOGETHER_API_URL = "https://api.together.xyz/v1/embeddings";
const EMBED_MAX_ATTEMPTS = 4;
const EMBED_RETRY_BASE_MS = 1000;

function sanitizeForEmbedding({ text }: { text: string }): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(text: string): string {
  const sanitized = sanitizeForEmbedding({ text });
  return sanitized.length > MAX_EMBED_CHARS ? sanitized.slice(0, MAX_EMBED_CHARS) : sanitized;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  let lastRetryableError: string | undefined;

  for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(TOGETHER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: TOGETHER_EMBEDDING_MODEL, input: texts.map(truncate) }),
    });

    if (res.ok) {
      const data = await res.json() as { data: { embedding: number[]; index: number }[] };
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }

    const body = await res.text();
    if (res.status < 500 && res.status !== 429) {
      throw new Error(`Batch embedding failed: ${res.status} ${body}`);
    }
    lastRetryableError = `Batch embedding failed: ${res.status} ${body}`;
    if (attempt >= EMBED_MAX_ATTEMPTS) break;

    const retryAfterSeconds = Number(res.headers.get("retry-after") ?? "");
    const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : undefined;
    const backoffMs = retryAfterMs ?? EMBED_RETRY_BASE_MS * 2 ** (attempt - 1);
    console.warn(`[embed] batch failed with ${res.status}; retrying attempt ${attempt + 1}/${EMBED_MAX_ATTEMPTS} after ${backoffMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  if (texts.length > 1) {
    const midpoint = Math.ceil(texts.length / 2);
    console.warn(`[embed] splitting failed batch of ${texts.length} after retries`);
    const left = await embedBatch(texts.slice(0, midpoint));
    const right = await embedBatch(texts.slice(midpoint));
    return [...left, ...right];
  }

  const text = texts[0] ?? "";
  if (text.length > 300) {
    console.warn("[embed] retrying single failed chunk with 300 characters");
    return embedBatch([text.slice(0, 300)]);
  }
  if (text.length > 120) {
    console.warn("[embed] retrying single failed chunk with 120 characters");
    return embedBatch([text.slice(0, 120)]);
  }

  throw new Error(lastRetryableError ?? "Batch embedding failed without a response");
}
