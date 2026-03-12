import path from "node:path";

import {
  REQUIRED_SCENARIO_IDS,
  ValidationCheck,
  ValidationReport,
  fileExists,
  flattenIssues,
  listFiles,
  makeCheck,
  readYamlFile,
  relativeToRoot,
  reportStatus,
  rootPath,
  validateMarkdownSections,
  validateScenario,
  validateTaskContractTemplate,
  writeReport,
} from "./_shared";
import { runExecutableCoreLoopScenario } from "./core-loop-runtime";

async function run(): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];
  const scenarioFiles = listFiles("harness/scenarios", ".yaml");

  checks.push(
    makeCheck(
      "scenario-directory",
      "Verified scenario directory presence.",
      scenarioFiles.length === 0 ? ["harness/scenarios contains no .yaml files"] : [],
      [],
    ),
  );

  const foundScenarioIds: string[] = [];
  for (const filePath of scenarioFiles) {
    const relativePath = relativeToRoot(filePath);
    const scenario = readYamlFile<Record<string, unknown>>(relativePath);
    if (typeof scenario.id === "string") {
      foundScenarioIds.push(scenario.id);
    }
    checks.push(validateScenario(relativePath, scenario));
  }

  const missingScenarioIds = REQUIRED_SCENARIO_IDS.filter((id) => !foundScenarioIds.includes(id));
  checks.push(
    makeCheck(
      "scenario-coverage",
      "Checked required core-loop scenario coverage.",
      missingScenarioIds.length > 0 ? [`missing required scenarios: ${missingScenarioIds.join(", ")}`] : [],
      [],
    ),
  );

  checks.push(validateTaskContractTemplate("harness/task-contract.template.yaml"));
  checks.push(
    validateMarkdownSections("harness/evidence-pack.template.md", [
      "## Summary Of Change",
      "## Files Changed",
      "## Validations Run",
      "## Remaining Uncertainty",
      "## Confidence",
    ]),
  );

  for (const checklistPath of [
    "harness/checklists/core-loop-change-checklist.md",
    "harness/checklists/memory-change-checklist.md",
    "harness/checklists/ui-change-checklist.md",
  ]) {
    checks.push(
      makeCheck(
        `checklist:${path.basename(checklistPath)}`,
        "Verified checklist presence.",
        fileExists(checklistPath) ? [] : [`${checklistPath} is missing`],
        [],
      ),
    );
  }

  checks.push(await runExecutableCoreLoopScenario());

  const blockers = flattenIssues(checks, "blockers");
  const warnings = flattenIssues(checks, "warnings");
  const report: ValidationReport = {
    schema_version: "1.0.0",
    run_type: "core-loop",
    generated_at: new Date().toISOString(),
    status: reportStatus(checks),
    summary:
      "Core-loop harness run. This validates harness artifacts and executes the work-watch scenario against real Ask-created Program, linked Action, and Brief runtime paths using deterministic fallback generation.",
    checks,
    blockers,
    warnings,
    artifacts: ["harness/reports/latest-core-loop.json"],
    todo: [
      "Add at least one more executable scenario beyond work-watch so travel and buying paths are also covered.",
      "Cover the streamed chat transport or Keep watching UI path, not just the assistant tool/runtime layer.",
      "Connect executable harness checks to rendered UI and correction entrypoints, not just storage and generation paths.",
    ],
  };

  writeReport("harness/reports/latest-core-loop.json", report);
  return report;
}

const report = await run();
const reportPath = rootPath("harness/reports/latest-core-loop.json");
console.log(`[harness:core-loop] ${report.status.toUpperCase()} ${relativeToRoot(reportPath)}`);
console.log(`[harness:core-loop] ${report.summary}`);

if (report.blockers.length > 0) {
  console.log("[harness:core-loop] blockers:");
  for (const blocker of report.blockers) {
    console.log(`- ${blocker}`);
  }
}

if (report.warnings.length > 0) {
  console.log("[harness:core-loop] warnings:");
  for (const warning of report.warnings) {
    console.log(`- ${warning}`);
  }
}

if (report.status === "fail") {
  process.exitCode = 1;
}
