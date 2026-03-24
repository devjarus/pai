import { execFileSync } from "node:child_process";
import fs from "node:fs";

import {
  ROOT_DIR,
  ValidationCheck,
  ValidationReport,
  flattenIssues,
  makeCheck,
  readMarkdown,
  relativeToRoot,
  reportStatus,
  rootPath,
  validateMarkdownSections,
  validateTaskContractTemplate,
  writeReport,
} from "./_shared";

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: "GitHub personal access token", pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { label: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z\-_]{20,}\b/g },
  { label: "Linear API key", pattern: /\blin_api_[A-Za-z0-9]{12,}\b/g },
];

const FORBIDDEN_TRACKED_FILES = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)config\.json$/,
  /(^|\/)[^/]+\.(pem|p12|pfx|key)$/i,
];

function validatePackageScripts(): ValidationCheck {
  const packageJson = JSON.parse(fs.readFileSync(rootPath("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const blockers: string[] = [];

  if (!scripts["harness:core-loop"]) {
    blockers.push("package.json is missing scripts.harness:core-loop");
  }
  if (!scripts["harness:regressions"]) {
    blockers.push("package.json is missing scripts.harness:regressions");
  }

  return makeCheck(
    "package-scripts",
    "Checked root harness scripts.",
    blockers,
    [],
  );
}

function validateHarnessDocsReference(): ValidationCheck {
  const content = readMarkdown("AGENTS.md");
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!content.includes("docs/architecture")) {
    blockers.push("AGENTS.md should point contributors to docs/architecture/*");
  }
  if (!content.includes("Architecture Blocks")) {
    blockers.push("AGENTS.md should describe Architecture Blocks");
  }
  if (!content.includes("agent-harness")) {
    warnings.push("AGENTS.md does not yet mention the agent harness path explicitly");
  }

  return makeCheck(
    "agents-guidance",
    "Checked contributor guidance in AGENTS.md.",
    blockers,
    warnings,
  );
}

function listTrackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT_DIR });
  return output.toString("utf8").split("\0").filter(Boolean);
}

function isLikelyTextFile(content: Buffer): boolean {
  return !content.includes(0);
}

function isRuntimeSourceFile(filePath: string): boolean {
  return filePath.startsWith("packages/")
    && filePath.includes("/src/")
    && !filePath.includes("/test/")
    && !filePath.includes("/dist/");
}

function validateRepoHygiene(): ValidationCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const trackedFiles = listTrackedFiles();
  for (const relativePath of trackedFiles) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (
      FORBIDDEN_TRACKED_FILES.some((pattern) => pattern.test(normalized))
      && !normalized.endsWith(".env.example")
    ) {
      blockers.push(`${normalized}: should not be committed to git`);
      continue;
    }

    const absolutePath = rootPath(normalized);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const raw = fs.readFileSync(absolutePath);
    if (raw.length > 1024 * 1024 || !isLikelyTextFile(raw)) {
      continue;
    }

    const content = raw.toString("utf8");
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        blockers.push(`${normalized}: contains ${label}`);
      }
      pattern.lastIndex = 0;
    }

    if (isRuntimeSourceFile(normalized)) {
      for (const match of content.matchAll(/\b(defaultTeam|defaultProject)\s*:\s*["'`]([^"'`]+)["'`]/g)) {
        const field = match[1];
        const value = match[2]?.trim();
        if (field && value) {
          blockers.push(`${normalized}: hardcodes ${field}="${value}" in runtime source`);
        }
      }
    }
  }

  return makeCheck(
    "repo-hygiene",
    "Checked tracked files for committed secrets, secret-bearing config files, and hardcoded Linear defaults in runtime source.",
    blockers,
    warnings,
  );
}

async function run(): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];

  checks.push(validatePackageScripts());
  checks.push(validateHarnessDocsReference());
  checks.push(validateRepoHygiene());

  checks.push(
    validateMarkdownSections("harness/README.md", [
      "# Harness",
      "## Workflow",
      "## Checklists",
      "## Templates",
      "## Verification",
    ]),
  );

  checks.push(
    validateMarkdownSections("docs/architecture/overview.md", [
      "# Architecture Overview",
      "## Core Platform Blocks",
      "## Agent Plane Blocks",
      "## Current Package Mapping",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/core-platform.md", [
      "# Core Platform Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Keep True",
      "## Validation",
      "## Stop And Reassess",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/agent-plane.md", [
      "# Agent Plane Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Keep True",
      "## Validation",
      "## Stop And Reassess",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/digests.md", [
      "# Digests Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Keep True",
      "## Validation",
      "## Stop And Reassess",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/quality.md", [
      "# Quality Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Keep True",
      "## Validation",
      "## Stop And Reassess",
    ]),
  );

  checks.push(validateTaskContractTemplate("harness/templates/task-contract.yaml"));
  checks.push(
    validateMarkdownSections("harness/templates/evidence-pack.md", [
      "# Evidence Pack",
      "## Problem",
      "## Change",
      "## Validation",
      "## Outcome",
      "## Risks",
    ]),
  );

  const blockers = flattenIssues(checks, "blockers");
  const warnings = flattenIssues(checks, "warnings");
  const report: ValidationReport = {
    schema_version: "1.0.0",
    run_type: "regressions",
    generated_at: new Date().toISOString(),
    status: reportStatus(checks),
    summary:
      "Regression harness run. This validates the coding-agent workflow assets: architecture block docs, lean checklists, lightweight task/evidence templates, repo hygiene, and root harness script wiring.",
    checks,
    blockers,
    warnings,
    artifacts: ["harness/reports/latest-regressions.json"],
    todo: [
      "Add lintable import-boundary rules once block ownership stabilizes.",
      "Add task-contract and evidence-pack examples tied to real block-specific changes.",
      "Link checklist selection into issue or PR templates so the workflow becomes mandatory.",
    ],
  };

  writeReport("harness/reports/latest-regressions.json", report);
  return report;
}

const report = await run();
const reportPath = rootPath("harness/reports/latest-regressions.json");
console.log(`[harness:regressions] ${report.status.toUpperCase()} ${relativeToRoot(reportPath)}`);
console.log(`[harness:regressions] ${report.summary}`);

if (report.blockers.length > 0) {
  console.log("[harness:regressions] blockers:");
  for (const blocker of report.blockers) {
    console.log(`- ${blocker}`);
  }
}

if (report.warnings.length > 0) {
  console.log("[harness:regressions] warnings:");
  for (const warning of report.warnings) {
    console.log(`- ${warning}`);
  }
}

if (report.status === "fail") {
  process.exitCode = 1;
}
