// Unified Library API
// Memories (re-exported from core memory module)
export { listBeliefs, searchBeliefs, semanticSearch, forgetBelief, correctBelief, memoryStats, remember, rememberStructured, getMemoryContext, retrieveContext, getBeliefHistory, listBeliefProvenance } from "@personal-ai/core";
export type { Belief, BeliefChange, MemoryStats, RememberOptions } from "@personal-ai/core";

// Documents (re-exported from core knowledge module)
export { listSources, getSourceChunks, learnFromContent, knowledgeSearch, forgetSource, cleanupExpiredSources } from "@personal-ai/core";
export type { KnowledgeSource, KnowledgeChunk, KnowledgeSearchResult } from "@personal-ai/core";

// Findings
export { findingsMigrations, createFinding, getFinding, listFindings, listFindingsForWatch, deleteFinding } from "./findings.js";
export type { ResearchFinding, CreateFindingInput, ResearchFindingSource } from "./findings.js";

// Finding embeddings
export { storeFindingEmbedding, getFindingEmbedding, embedFinding } from "./findings-embed.js";

// Unified search
export { unifiedSearch } from "./search.js";
export type { LibrarySearchResult, LibrarySourceType } from "./search.js";
