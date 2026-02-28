export type {
  Config, Migration, Storage, LLMClient, ChatMessage, ChatOptions, TokenUsage, ChatResult, EmbedResult, StreamEvent,
  PluginContext, Command, Plugin, AgentPlugin, AgentContext, Logger, LogLevel, LogFileOptions,
} from "./types.js";

// Background jobs (DB-backed)
export { backgroundJobMigrations, upsertJob, getJob, listJobs, updateJobStatus, clearCompletedBackgroundJobs } from "./background-jobs.js";
export type { BackgroundJob } from "./background-jobs.js";
export { loadConfig, loadConfigFile, writeConfig, findGitRoot, resolveConfigHome } from "./config.js";
export { createStorage, backupDatabase, resolveIdPrefix } from "./storage.js";
export { createLLMClient } from "./llm.js";
export { createLogger } from "./logger.js";

// Threads
export {
  threadMigrations,
  DEFAULT_USER_ID,
  listThreads,
  listMessages,
  createThread,
  ensureThread,
  appendMessages,
  clearThread,
  deleteThread,
  clearAllThreads,
  getThread,
  withThreadLock,
} from "./threads.js";
export type { ThreadRow, ThreadMessageRow, ThreadMessageInput, EnsureThreadOptions, ListMessagesOptions, AppendMessagesOptions } from "./threads.js";

// Knowledge
export { knowledgeMigrations, chunkContent, hasSource, listSources, getSourceChunks, learnFromContent, knowledgeSearch, searchKnowledgeFTS, forgetSource, stripChunkHeader, reindexSource, reindexAllSources } from "./knowledge.js";
export type { KnowledgeSource, KnowledgeChunk, KnowledgeSearchResult } from "./knowledge.js";

// Memory
export { memoryMigrations, getMemoryContext, retrieveContext, listBeliefs, searchBeliefs, findSimilarBeliefs, semanticSearch, recordAccess, forgetBelief, updateBeliefContent, memoryStats, memoryCommands, countSupportingEpisodes, linkSupersession, linkBeliefs, getLinkedBeliefs, synthesize, mergeDuplicates, pruneBeliefs, reflect, generateMemoryFile, backfillSubjects, consolidateConversation, findContradictions, getCorePreferences } from "./memory/index.js";
export { remember } from "./memory/index.js";
export type { Belief, Episode, BeliefChange, MemoryStats, MemoryExport, MemoryExportV1, MemoryExportV2, SimilarBelief, ReflectionResult, UnifiedRetrievalResult, ConsolidationResult } from "./memory/index.js";

// Timezone
export { formatDateTime } from "./timezone.js";
export type { FormattedDateTime } from "./timezone.js";

// Auth
export { authMigrations, createOwner, getOwner, getOwnerByEmail, verifyOwnerPassword, hasOwner, getJwtSecret, resetOwnerPassword } from "./auth.js";
export type { Owner } from "./auth.js";
