export type {
  Config, Migration, Storage, LLMClient, ChatMessage, ChatOptions, TokenUsage, ChatResult, EmbedResult, StreamEvent,
  PluginContext, Command, Plugin, AgentPlugin, AgentContext, Logger, LogLevel, LogFileOptions,
  TelemetryAttributes, TelemetryProcess, TelemetrySpanType, TelemetryStatus, TelemetrySurface, EmbedOptions,
  LlmTrafficConfig, LlmTrafficLane, BackgroundJobSourceKind, BackgroundWaitingReason,
} from "./types.js";

// Background jobs (DB-backed)
export { backgroundJobMigrations, upsertJob, getJob, listJobs, updateJobStatus, cancelBackgroundJob, forceDeleteBackgroundJob, recoverStaleBackgroundJobs, cancelAllRunningBackgroundJobs, clearCompletedBackgroundJobs } from "./background-jobs.js";
export type { BackgroundJob } from "./background-jobs.js";
export { loadConfig, loadConfigFile, writeConfig, findGitRoot, resolveConfigHome } from "./config.js";
export { createStorage, backupDatabase, resolveIdPrefix } from "./storage.js";
export { createLLMClient } from "./llm.js";
export { createLogger } from "./logger.js";
export {
  acquireLlmTrafficPermit,
  configureLlmTraffic,
  getDefaultLlmTrafficConfig,
  getLlmTrafficConfig,
  getLlmTrafficSnapshot,
  getTrafficLane,
} from "./llm-traffic.js";
export type { LlmTrafficPermit, LlmTrafficSnapshot } from "./llm-traffic.js";
export {
  telemetryMigrations,
  TELEMETRY_RETENTION_DAYS,
  cleanupOldTelemetrySpans,
  createChildTelemetry,
  finishSpan,
  getJobDiagnostics,
  getObservabilityOverview,
  getThreadDiagnostics,
  getTraceSpans,
  instrumentedEmbed,
  instrumentedGenerateText,
  instrumentedStreamText,
  listProcessAggregates,
  listRecentErrors,
  startSpan,
} from "./telemetry.js";
export type {
  TelemetryRuntime,
  TelemetryStartInput,
  ActiveTelemetrySpan,
  TelemetrySpan,
  TelemetrySummary,
  ProcessAggregate,
  ModelAggregate,
  QueueProcessAggregate,
  QueueLaneSnapshot,
  LiveQueueSnapshot,
  ObservabilityOverview,
  ObservabilityRange,
  ThreadMessageUsage,
  ThreadDiagnostics,
  JobDiagnostics,
  RecentError,
} from "./telemetry.js";

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
  getAncestors,
  getChildren,
  getInheritedContext,
} from "./threads.js";
export type { ThreadRow, ThreadMessageRow, ThreadMessageInput, EnsureThreadOptions, ListMessagesOptions, AppendMessagesOptions } from "./threads.js";

// Knowledge
export { knowledgeMigrations, chunkContent, hasSource, listSources, getSourceChunks, learnFromContent, knowledgeSearch, searchKnowledgeFTS, forgetSource, cleanupExpiredSources, stripChunkHeader, reindexSource, reindexAllSources } from "./knowledge.js";
export type { KnowledgeSource, KnowledgeChunk, KnowledgeSearchResult, KnowledgeCleanupResult } from "./knowledge.js";

// Memory
export { memoryMigrations, getMemoryContext, retrieveContext, listBeliefs, searchBeliefs, findSimilarBeliefs, semanticSearch, recordAccess, forgetBelief, correctBelief, updateBeliefContent, memoryStats, memoryCommands, countSupportingEpisodes, linkSupersession, linkBeliefs, getLinkedBeliefs, synthesize, mergeDuplicates, pruneBeliefs, reflect, generateMemoryFile, backfillSubjects, consolidateConversation, findContradictions, getCorePreferences } from "./memory/index.js";
export { remember } from "./memory/index.js";
export type { Belief, Episode, BeliefChange, CorrectBeliefResult, MemoryStats, MemoryExport, MemoryExportV1, MemoryExportV2, SimilarBelief, ReflectionResult, UnifiedRetrievalResult, ConsolidationResult } from "./memory/index.js";

// Timezone
export { formatDateTime, currentDateBlock } from "./timezone.js";
export type { FormattedDateTime } from "./timezone.js";
export { normalizeTimestamp, parseTimestamp } from "./timezone.js";

// Auth
export { authMigrations, createOwner, getOwner, getOwnerByEmail, verifyOwnerPassword, hasOwner, getJwtSecret, resetOwnerPassword } from "./auth.js";
export type { Owner } from "./auth.js";

// Research schemas
export { detectResearchDomain } from "./research-schemas.js";
export type { FlightQuery, FlightOption, FlightReport, StockMetrics, ChartArtifact, StockReport, ResearchResult, ResearchResultType } from "./research-schemas.js";
export {
  extractPresentationBlocks,
  parseVisualManifest,
  collectReportVisuals,
  deriveReportVisuals,
  mergeRenderSpecWithVisuals,
  buildReportPresentation,
  getReferencedVisualsFromSpec,
} from "./report-presentation.js";
export type { ReportExecution, ReportVisual, ReportPresentation } from "./report-presentation.js";

// Sandbox
export { resolveSandboxUrl, sandboxHealth, runInSandbox } from "./sandbox.js";
export type { SandboxResult, SandboxOptions } from "./sandbox.js";

// Browser automation (Pinchtab)
export { resolveBrowserUrl, browserHealth, browserNavigate, browserSnapshot, browserAction, browserText, browserScreenshot, createBrowserTools } from "./browser.js";
export type { BrowserNavigateOptions, BrowserNavigateResult, BrowserActionOptions, BrowserActionResult, BrowserToolContext } from "./browser.js";

// Context budget
export { getContextBudget, estimateTokens, _resetBudgetCache } from "./context-budget.js";
export type { ContextBudget } from "./context-budget.js";
export { getProviderOptions } from "./provider-options.js";

// Artifacts
export { artifactMigrations, storeArtifact, getArtifact, listArtifacts, deleteJobArtifacts, cleanupOldArtifacts, guessMimeType } from "./artifacts.js";
export type { Artifact, ArtifactMeta } from "./artifacts.js";

// Chart utilities (pure math, no DOM)
export { getChartBounds, buildLinePoints, buildLinePath, buildAreaPath, buildDonutSegments, formatChartValue } from "./chart-utils.js";
export type { ChartPoint, ChartBounds, DonutSegmentInput, DonutSegment } from "./chart-utils.js";

// Spec-to-HTML renderer (json-render spec → static HTML string)
export { specToStaticHtml } from "./spec-to-html.js";
export type { SpecToHtmlOptions } from "./spec-to-html.js";

// Document parsing (PDF, Excel)
export { parseBinaryDocument, isBinaryDocument, parsePdf, parseExcel } from "./document-parser.js";
