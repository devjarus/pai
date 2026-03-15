// Unified Library API
// Memories (re-exported from core memory module)
export { listBeliefs, searchBeliefs, semanticSearch, forgetBelief, correctBelief, memoryStats, remember, rememberStructured, getMemoryContext, retrieveContext, getBeliefHistory, listBeliefProvenance } from "@personal-ai/core";
export type { Belief, BeliefChange, MemoryStats, RememberOptions } from "@personal-ai/core";

// Documents (re-exported from core knowledge module)
export { listSources, getSourceChunks, learnFromContent, knowledgeSearch, forgetSource, cleanupExpiredSources } from "@personal-ai/core";
export type { KnowledgeSource, KnowledgeChunk, KnowledgeSearchResult } from "@personal-ai/core";

// Findings (new — will be implemented in Task 2)
// export { ... } from "./findings.js";

// Unified search (new — will be implemented in Task 3)
// export { unifiedSearch } from "./search.js";
