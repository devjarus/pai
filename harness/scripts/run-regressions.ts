import {
  REQUIRED_SCENARIO_IDS,
  ValidationCheck,
  ValidationReport,
  fileExists,
  flattenIssues,
  listFiles,
  makeCheck,
  readJsonFile,
  readYamlFile,
  relativeToRoot,
  reportStatus,
  rootPath,
  validateJsonSchema,
  validateMarkdownSections,
  validateScenario,
  validateTaskContractTemplate,
  writeReport,
} from "./_shared";

function run(): ValidationReport {
  const checks: ValidationCheck[] = [];

  const requiredDocs = [
    "AGENTS.md",
    "docs/PRODUCT-CHARTER.md",
    "docs/PRIMITIVES.md",
    "docs/DEFINITION-OF-DONE.md",
    "docs/ARCHITECTURE-BOUNDARIES.md",
    "docs/decisions/0001-roadmap-focus.md",
    "docs/decisions/0002-programs-implicit.md",
    "docs/decisions/0003-brief-schema.md",
  ];

  for (const docPath of requiredDocs) {
    checks.push(
      makeCheck(
        `doc:${docPath}`,
        "Verified required harness doc presence.",
        fileExists(docPath) ? [] : [`${docPath} is missing`],
        [],
      ),
    );
  }

  checks.push(validateTaskContractTemplate("harness/task-contract.template.yaml"));
  checks.push(
    validateMarkdownSections("harness/evidence-pack.template.md", [
      "## Summary Of Change",
      "## Files Changed",
      "## Failure Signal",
      "## Root Cause",
      "## Validations Run",
      "## Results",
      "## Proof Of Restore",
      "## Prevention Added",
      "## Failures",
      "## Residual Risk",
      "## Remaining Uncertainty",
      "## Confidence",
      "## Next Best Step",
    ]),
  );

  for (const checklistPath of [
    "harness/checklists/core-loop-change-checklist.md",
    "harness/checklists/memory-change-checklist.md",
    "harness/checklists/reactive-fix-checklist.md",
    "harness/checklists/ui-change-checklist.md",
  ]) {
    checks.push(
      makeCheck(
        `checklist:${checklistPath}`,
        "Verified checklist presence.",
        fileExists(checklistPath) ? [] : [`${checklistPath} is missing`],
        [],
      ),
    );
  }

  const scenarioFiles = listFiles("harness/scenarios", ".yaml");
  for (const filePath of scenarioFiles) {
    const relativePath = relativeToRoot(filePath);
    checks.push(validateScenario(relativePath, readYamlFile(relativePath)));
  }

  const scenarioIds = scenarioFiles
    .map((filePath) => readYamlFile<{ id?: string }>(relativeToRoot(filePath)).id)
    .filter((value): value is string => typeof value === "string");
  const missingScenarioIds = REQUIRED_SCENARIO_IDS.filter((id) => !scenarioIds.includes(id));
  checks.push(
    makeCheck(
      "scenario-presence",
      "Verified required scenario IDs are present.",
      missingScenarioIds.length > 0 ? [`missing required scenarios: ${missingScenarioIds.join(", ")}`] : [],
      [],
    ),
  );

  for (const schemaPath of [
    "schemas/task-contract.schema.json",
    "schemas/validation-report.schema.json",
    "schemas/evidence-pack.schema.json",
  ]) {
    checks.push(validateJsonSchema(schemaPath));
  }

  const packageJson = readJsonFile("package.json") as Record<string, unknown>;
  const scripts = (packageJson.scripts ?? {}) as Record<string, unknown>;
  for (const scriptName of ["harness:core-loop", "harness:regressions"]) {
    checks.push(
      makeCheck(
        `package-script:${scriptName}`,
        "Verified root harness script wiring.",
        typeof scripts[scriptName] === "string" ? [] : [`package.json is missing script ${scriptName}`],
        [],
      ),
    );
  }

  const blockers = flattenIssues(checks, "blockers");
  const warnings = flattenIssues(checks, "warnings");
  const report: ValidationReport = {
    schema_version: "1.0.0",
    run_type: "regressions",
    generated_at: new Date().toISOString(),
    status: reportStatus(checks),
    summary:
      "Scaffold regression harness run. This validates repo-native harness artifacts, scenario/schema presence, reactive-work workflow artifacts, and package wiring. It does not replace package tests or runtime integration checks.",
    checks,
    blockers,
    warnings,
    artifacts: ["harness/reports/latest-regressions.json"],
    todo: [
      "Integrate real runtime assertions for Program persistence and Brief rendering.",
      "Attach harness checks to targeted package tests or CI once the contracts stabilize.",
      "Add memory-governance regression cases that exercise live retrieval and correction suppression.",
      "Validate actual task contracts and evidence packs, not only the templates, once the reactive workflow stabilizes.",
    ],
  };

  writeReport("harness/reports/latest-regressions.json", report);
  return report;
}

const report = run();
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
