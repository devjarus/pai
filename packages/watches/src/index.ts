// Watch-named aliases for Program functions from plugin-schedules.
// "Watch" is the user-facing product noun; "Program" is the internal noun.

export {
  // Program CRUD → Watch CRUD
  ensureProgram as ensureWatch,
  createProgram as createWatch,
  listPrograms as listWatches,
  getProgramById as getWatch,
  updateProgram as updateWatch,
  pauseProgram as pauseWatch,
  resumeProgram as resumeWatch,
  deleteProgram as deleteWatch,

  // Evaluation & scheduling
  recordProgramEvaluation as recordWatchEvaluation,
  getDueSchedules as getDueWatches,
  markScheduleRun as markWatchRun,

  // Migrations (re-export as-is)
  scheduleMigrations,

  // Types re-exported with Watch naming
  type Program as Watch,
  type ProgramCreateResult as WatchCreateResult,
  type ProgramDuplicateReason as WatchDuplicateReason,
  type ProgramFamily as WatchFamily,
  type ProgramPhase as WatchPhase,
  type ProgramDeliveryMode as WatchDeliveryMode,
  type ProgramContext as WatchContext,
  type ProgramAuthoredState as WatchAuthoredState,
  type ProgramRuntimeState as WatchRuntimeState,
  type ScheduledJob,
} from "@personal-ai/plugin-schedules";
