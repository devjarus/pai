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
  validateScenario,
  writeReport,
} from "./_shared";

function run(): ValidationReport {
  const checks: ValidationCheck[] = [];

  // 1. AGENTS.md must exist — it's the single source of truth
  checks.push(
    makeCheck(
      "agents-md",
      "AGENTS.md exists.",
      fileExists("AGENTS.md") ? [] : ["AGENTS.md is missing"],
      [],
    ),
  );

  // 2. Core scenarios must exist and be well-formed
  const scenarioFiles = listFiles("harness/scenarios", ".yaml");
  checks.push(
    makeCheck(
      "scenario-directory",
      "Verified scenario directory presence.",
      scenarioFiles.length === 0 ? ["harness/scenarios contains no .yaml files"] : [],
      [],
    ),
  );

  const scenarioIds: string[] = [];
  for (const filePath of scenarioFiles) {
    const relativePath = relativeToRoot(filePath);
    const scenario = readYamlFile<Record<string, unknown>>(relativePath);
    if (typeof scenario.id === "string") {
      scenarioIds.push(scenario.id);
    }
    checks.push(validateScenario(relativePath, scenario));
  }

  const missingScenarioIds = REQUIRED_SCENARIO_IDS.filter((id) => !scenarioIds.includes(id));
  checks.push(
    makeCheck(
      "scenario-coverage",
      "Verified required scenario IDs are present.",
      missingScenarioIds.length > 0 ? [`missing required scenarios: ${missingScenarioIds.join(", ")}`] : [],
      [],
    ),
  );

  // 3. Core packages must build (checked by pnpm verify, but validate wiring)
  const packageScripts = ["build", "test", "lint", "typecheck", "verify", "harness:core-loop", "harness:regressions"];
  try {
    const packageJson = readJsonFile("package.json") as Record<string, unknown>;
    const scripts = (packageJson.scripts ?? {}) as Record<string, unknown>;
    for (const scriptName of packageScripts) {
      checks.push(
        makeCheck(
          `script:${scriptName}`,
          `Verified ${scriptName} script exists.`,
          typeof scripts[scriptName] === "string" ? [] : [`package.json is missing script "${scriptName}"`],
          [],
        ),
      );
    }
  } catch {
    checks.push(makeCheck("package-json", "Could not read package.json.", ["package.json is missing or invalid"], []));
  }

  // 4. Key reference docs exist (optional — warn only)
  const referenceDocs = ["docs/ARCHITECTURE.md", "docs/MEMORY-LIFECYCLE.md", "docs/SETUP.md"];
  for (const docPath of referenceDocs) {
    checks.push(
      makeCheck(
        `doc:${docPath}`,
        "Verified reference doc presence.",
        [],
        fileExists(docPath) ? [] : [`${docPath} is missing (reference doc, not blocking)`],
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
      "Regression harness: validates AGENTS.md presence, scenario coverage, package script wiring, and reference doc presence.",
    checks,
    blockers,
    warnings,
    artifacts: ["harness/reports/latest-regressions.json"],
    todo: [],
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
