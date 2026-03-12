import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

export type ValidationStatus = "pass" | "warn" | "fail";

export interface ValidationCheck {
  name: string;
  status: ValidationStatus;
  details: string;
  blockers: string[];
  warnings: string[];
}

export interface ValidationReport {
  schema_version: string;
  run_type: "core-loop" | "regressions";
  generated_at: string;
  status: ValidationStatus;
  summary: string;
  checks: ValidationCheck[];
  blockers: string[];
  warnings: string[];
  artifacts: string[];
  todo: string[];
}

export interface HarnessScenario {
  id: string;
  name: string;
  initial_user_message: string;
  expected_program_behavior: {
    program_title: string;
    program_family: string;
    why_recurring: string;
    cadence: string;
    expected_actions: string[];
  };
  expected_memory_captured: {
    preferences: string[];
    constraints: string[];
    open_questions: string[];
  };
  expected_brief_sections: string[];
  correction_step: {
    user_message: string;
    expected_memory_update: string[];
    expected_brief_change: string[];
  };
  action_follow_through?: {
    linked_action_title: string;
    expected_first_brief_focus: string[];
    expected_next_brief_change: string[];
  };
  expected_next_brief_behavior: {
    should_reflect_correction: boolean;
    suppressed_old_assumptions: string[];
    expected_changes: string[];
  };
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SCRIPT_DIR, "../..");
export const REQUIRED_SCENARIO_IDS = ["travel-watch", "work-watch", "buying-watch"] as const;
export const REQUIRED_BRIEF_SECTIONS = [
  "recommendation",
  "what_changed",
  "evidence",
  "memory_assumptions",
  "next_actions",
] as const;

export function rootPath(...parts: string[]): string {
  return path.join(ROOT_DIR, ...parts);
}

export function relativeToRoot(filePath: string): string {
  return path.relative(ROOT_DIR, filePath).replaceAll(path.sep, "/");
}

export function fileExists(relativePath: string): boolean {
  return fs.existsSync(rootPath(relativePath));
}

export function listFiles(relativeDir: string, extension: string): string[] {
  const dir = rootPath(relativeDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(extension))
    .map((entry) => path.join(dir, entry))
    .sort();
}

export function readYamlFile<T>(relativePath: string): T {
  const filePath = rootPath(relativePath);
  const raw = fs.readFileSync(filePath, "utf8");
  return YAML.parse(raw) as T;
}

export function readJsonFile(relativePath: string): unknown {
  const filePath = rootPath(relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readMarkdown(relativePath: string): string {
  return fs.readFileSync(rootPath(relativePath), "utf8");
}

export function makeCheck(name: string, details: string, blockers: string[] = [], warnings: string[] = []): ValidationCheck {
  const status: ValidationStatus = blockers.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return { name, status, details, blockers, warnings };
}

export function reportStatus(checks: ValidationCheck[]): ValidationStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

export function flattenIssues(checks: ValidationCheck[], kind: "blockers" | "warnings"): string[] {
  return checks.flatMap((check) => check[kind]);
}

export function writeReport(relativePath: string, report: ValidationReport): void {
  const filePath = rootPath(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item));
}

export function validateScenario(relativePath: string, scenario: Partial<HarnessScenario>): ValidationCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!isNonEmptyString(scenario.id)) {
    blockers.push(`${relativePath}: missing non-empty id`);
  }
  if (!isNonEmptyString(scenario.name)) {
    blockers.push(`${relativePath}: missing non-empty name`);
  }
  if (!isNonEmptyString(scenario.initial_user_message)) {
    blockers.push(`${relativePath}: missing initial_user_message`);
  }

  const program = scenario.expected_program_behavior;
  if (!program || typeof program !== "object") {
    blockers.push(`${relativePath}: missing expected_program_behavior`);
  } else {
    if (!isNonEmptyString(program.program_title)) {
      blockers.push(`${relativePath}: expected_program_behavior.program_title is required`);
    }
    if (!isNonEmptyString(program.program_family)) {
      blockers.push(`${relativePath}: expected_program_behavior.program_family is required`);
    }
    if (!isNonEmptyString(program.why_recurring)) {
      blockers.push(`${relativePath}: expected_program_behavior.why_recurring is required`);
    }
    if (!isNonEmptyString(program.cadence)) {
      blockers.push(`${relativePath}: expected_program_behavior.cadence is required`);
    }
    if (!isStringArray(program.expected_actions)) {
      blockers.push(`${relativePath}: expected_program_behavior.expected_actions must be a non-empty string array`);
    }
  }

  const memory = scenario.expected_memory_captured;
  if (!memory || typeof memory !== "object") {
    blockers.push(`${relativePath}: missing expected_memory_captured`);
  } else {
    if (!isStringArray(memory.preferences)) {
      blockers.push(`${relativePath}: expected_memory_captured.preferences must be a non-empty string array`);
    }
    if (!isStringArray(memory.constraints)) {
      blockers.push(`${relativePath}: expected_memory_captured.constraints must be a non-empty string array`);
    }
    if (!isStringArray(memory.open_questions)) {
      blockers.push(`${relativePath}: expected_memory_captured.open_questions must be a non-empty string array`);
    }
  }

  if (!isStringArray(scenario.expected_brief_sections)) {
    blockers.push(`${relativePath}: expected_brief_sections must be a non-empty string array`);
  } else {
    const missingSections = REQUIRED_BRIEF_SECTIONS.filter((section) => !scenario.expected_brief_sections?.includes(section));
    if (missingSections.length > 0) {
      blockers.push(`${relativePath}: expected_brief_sections is missing ${missingSections.join(", ")}`);
    }
  }

  const correction = scenario.correction_step;
  if (!correction || typeof correction !== "object") {
    blockers.push(`${relativePath}: missing correction_step`);
  } else {
    if (!isNonEmptyString(correction.user_message)) {
      blockers.push(`${relativePath}: correction_step.user_message is required`);
    }
    if (!isStringArray(correction.expected_memory_update)) {
      blockers.push(`${relativePath}: correction_step.expected_memory_update must be a non-empty string array`);
    }
    if (!isStringArray(correction.expected_brief_change)) {
      blockers.push(`${relativePath}: correction_step.expected_brief_change must be a non-empty string array`);
    }
  }

  const actionFollowThrough = scenario.action_follow_through;
  if (actionFollowThrough !== undefined) {
    if (!actionFollowThrough || typeof actionFollowThrough !== "object") {
      blockers.push(`${relativePath}: action_follow_through must be an object when present`);
    } else {
      if (!isNonEmptyString(actionFollowThrough.linked_action_title)) {
        blockers.push(`${relativePath}: action_follow_through.linked_action_title is required when action_follow_through is present`);
      }
      if (!isStringArray(actionFollowThrough.expected_first_brief_focus)) {
        blockers.push(`${relativePath}: action_follow_through.expected_first_brief_focus must be a non-empty string array when action_follow_through is present`);
      }
      if (!isStringArray(actionFollowThrough.expected_next_brief_change)) {
        blockers.push(`${relativePath}: action_follow_through.expected_next_brief_change must be a non-empty string array when action_follow_through is present`);
      }
    }
  }

  const nextBrief = scenario.expected_next_brief_behavior;
  if (!nextBrief || typeof nextBrief !== "object") {
    blockers.push(`${relativePath}: missing expected_next_brief_behavior`);
  } else {
    if (typeof nextBrief.should_reflect_correction !== "boolean") {
      blockers.push(`${relativePath}: expected_next_brief_behavior.should_reflect_correction must be boolean`);
    }
    if (!isStringArray(nextBrief.suppressed_old_assumptions)) {
      blockers.push(`${relativePath}: expected_next_brief_behavior.suppressed_old_assumptions must be a non-empty string array`);
    }
    if (!isStringArray(nextBrief.expected_changes)) {
      blockers.push(`${relativePath}: expected_next_brief_behavior.expected_changes must be a non-empty string array`);
    }
  }

  if (
    isNonEmptyString(scenario.initial_user_message) &&
    !["watch", "keep track", "keep tracking"].some((phrase) =>
      scenario.initial_user_message.toLowerCase().includes(phrase),
    )
  ) {
    warnings.push(`${relativePath}: initial_user_message does not clearly express recurring follow-through intent`);
  }

  return makeCheck(
    `scenario:${path.basename(relativePath)}`,
    blockers.length > 0 ? "Scenario structure is incomplete." : "Scenario structure is complete enough for scaffold validation.",
    blockers,
    warnings,
  );
}

export function validateTaskContractTemplate(relativePath: string): ValidationCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!fileExists(relativePath)) {
    return makeCheck(`template:${relativePath}`, "Task contract template is missing.", [`${relativePath} is missing`], []);
  }

  const template = readYamlFile<Record<string, unknown>>(relativePath);
  const requiredFields = [
    "id",
    "title",
    "objective",
    "why_now",
    "work_mode",
    "trigger_signal",
    "restore_condition",
    "prevention_followup",
    "in_scope",
    "out_of_scope",
    "affected_systems",
    "success_criteria",
    "validations_required",
    "evidence_pack",
    "risks",
    "escalation_conditions",
  ];

  for (const field of requiredFields) {
    if (!(field in template)) {
      blockers.push(`${relativePath}: missing required field ${field}`);
    }
  }

  if (!Array.isArray(template.checklists_required)) {
    warnings.push(`${relativePath}: checklists_required should be present to guide agent workflow`);
  }

  if (template.work_mode !== "planned" && template.work_mode !== "reactive") {
    blockers.push(`${relativePath}: work_mode must be either "planned" or "reactive"`);
  }

  return makeCheck(`template:${path.basename(relativePath)}`, "Checked task contract template structure.", blockers, warnings);
}

export function validateMarkdownSections(relativePath: string, requiredHeadings: string[]): ValidationCheck {
  const blockers: string[] = [];

  if (!fileExists(relativePath)) {
    return makeCheck(`markdown:${relativePath}`, "Markdown artifact is missing.", [`${relativePath} is missing`], []);
  }

  const content = readMarkdown(relativePath);
  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) {
      blockers.push(`${relativePath}: missing heading or section marker "${heading}"`);
    }
  }

  return makeCheck(`markdown:${path.basename(relativePath)}`, "Checked markdown template sections.", blockers, []);
}

export function validateJsonSchema(relativePath: string): ValidationCheck {
  const blockers: string[] = [];

  if (!fileExists(relativePath)) {
    return makeCheck(`schema:${relativePath}`, "Schema file is missing.", [`${relativePath} is missing`], []);
  }

  const schema = readJsonFile(relativePath) as Record<string, unknown>;
  if (schema.type !== "object") {
    blockers.push(`${relativePath}: root schema type must be object`);
  }
  if (!Array.isArray(schema.required)) {
    blockers.push(`${relativePath}: schema.required must be an array`);
  }

  return makeCheck(`schema:${path.basename(relativePath)}`, "Checked JSON schema shape.", blockers, []);
}
