import fs from "node:fs";

import {
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

async function run(): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];

  checks.push(validatePackageScripts());
  checks.push(validateHarnessDocsReference());

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
      "## Boundaries",
      "## Required Validation",
      "## Evidence To Capture",
      "## Escalate When",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/agent-plane.md", [
      "# Agent Plane Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Boundaries",
      "## Required Validation",
      "## Evidence To Capture",
      "## Escalate When",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/digests.md", [
      "# Digests Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Boundaries",
      "## Required Validation",
      "## Evidence To Capture",
      "## Escalate When",
    ]),
  );

  checks.push(
    validateMarkdownSections("harness/checklists/quality.md", [
      "# Quality Checklist",
      "## Use This Checklist When",
      "## Before Coding",
      "## Boundaries",
      "## Required Validation",
      "## Evidence To Capture",
      "## Escalate When",
    ]),
  );

  checks.push(validateTaskContractTemplate("harness/templates/task-contract.yaml"));
  checks.push(
    validateMarkdownSections("harness/templates/evidence-pack.md", [
      "# Evidence Pack",
      "## Problem",
      "## Change",
      "## Validation",
      "## Metrics",
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
      "Regression harness run. This validates the coding-agent workflow assets: architecture block docs, harness checklists, task/evidence templates, and root harness script wiring.",
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
