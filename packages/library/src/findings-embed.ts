import type { Storage, LLMClient } from "@personal-ai/core";

export function storeFindingEmbedding(storage: Storage, findingId: string, embedding: number[]): void {
  storage.run(
    `INSERT OR REPLACE INTO research_finding_embeddings (finding_id, embedding)
     VALUES (?, ?)`,
    [findingId, JSON.stringify(embedding)],
  );
}

export function getFindingEmbedding(storage: Storage, findingId: string): number[] | undefined {
  const rows = storage.query<{ embedding: string }>(
    "SELECT embedding FROM research_finding_embeddings WHERE finding_id = ?",
    [findingId],
  );
  const row = rows[0];
  return row ? JSON.parse(row.embedding) as number[] : undefined;
}

export async function embedFinding(storage: Storage, llm: LLMClient, findingId: string, text: string): Promise<void> {
  const result = await llm.embed(text);
  storeFindingEmbedding(storage, findingId, result.embedding);
}
