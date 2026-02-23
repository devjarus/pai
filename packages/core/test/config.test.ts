import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, findGitRoot } from "../src/config.js";
import { resolveDataDir, resolveConfigFilePath, loadConfigFile, writeConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("should return defaults when no env vars set", () => {
    // Use a temp dir with no config.json so we get pure defaults
    const emptyHome = mkdtempSync(join(tmpdir(), "pai-test-defaults-"));
    const config = loadConfig({ PAI_HOME: emptyHome });
    expect(config.llm.provider).toBe("ollama");
    expect(config.llm.model).toBe("llama3.2");
    expect(config.llm.baseUrl).toBe("http://127.0.0.1:11434");
    expect(config.logLevel).toBe("silent");
    expect(config.llm.fallbackMode).toBeUndefined();
    expect(config.plugins).toEqual(["memory", "tasks"]);
    rmSync(emptyHome, { recursive: true, force: true });
  });

  it("should override from env", () => {
    const config = loadConfig({
      PAI_DATA_DIR: "/tmp/test-pai",
      PAI_LLM_PROVIDER: "openai",
      PAI_LLM_MODEL: "gpt-4.1-mini",
      PAI_LLM_BASE_URL: "https://api.openai.com/v1",
      PAI_LLM_API_KEY: "sk-test",
      PAI_PLUGINS: "memory",
    });
    expect(config.dataDir).toBe("/tmp/test-pai");
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4.1-mini");
    expect(config.llm.apiKey).toBe("sk-test");
    expect(config.plugins).toEqual(["memory"]);
  });
});

describe("findGitRoot", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("should return the directory containing .git", () => {
    const root = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(root);
    mkdirSync(join(root, ".git"));
    const nested = join(root, "a", "b", "c");
    mkdirSync(nested, { recursive: true });

    expect(findGitRoot(nested)).toBe(root);
    expect(findGitRoot(root)).toBe(root);
  });

  it("should return null when no .git found", () => {
    const root = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(root);

    expect(findGitRoot(root)).toBeNull();
  });
});

describe("resolveDataDir", () => {
  it("should respect PAI_DATA_DIR override (highest priority)", () => {
    const result = resolveDataDir({ PAI_DATA_DIR: "/custom/path" });
    expect(result).toBe("/custom/path");
  });

  it("should use config file dataDir when set", () => {
    const result = resolveDataDir({}, { dataDir: "/from/config" });
    expect(result).toBe("/from/config");
  });

  it("should fall back to default ~/.personal-ai/data", () => {
    const result = resolveDataDir({});
    expect(result).toContain(".personal-ai");
    expect(result).toContain("data");
  });

  it("should prioritize PAI_DATA_DIR over config file", () => {
    const result = resolveDataDir({ PAI_DATA_DIR: "/override" }, { dataDir: "/from/config" });
    expect(result).toBe("/override");
  });
});

describe("resolveConfigFilePath", () => {
  it("should return {PAI_HOME}/config.json when PAI_HOME is set", () => {
    const result = resolveConfigFilePath({ PAI_HOME: "/tmp/custom-pai" });
    expect(result).toBe("/tmp/custom-pai/config.json");
  });

  it("should return ~/.personal-ai/config.json when no PAI_HOME", () => {
    const result = resolveConfigFilePath({});
    expect(result).toContain(".personal-ai");
    expect(result).toMatch(/config\.json$/);
  });
});

describe("loadConfigFile", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("should return empty object when file doesn't exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const result = loadConfigFile(dir);
    expect(result).toEqual({});
  });

  it("should return parsed config when file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const config = { llm: { provider: "openai", model: "gpt-4.1" }, logLevel: "debug" };
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    const result = loadConfigFile(dir);
    expect(result).toEqual(config);
  });

  it("should return empty object when file has invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    writeFileSync(join(dir, "config.json"), "not valid json {{{");
    const result = loadConfigFile(dir);
    expect(result).toEqual({});
  });
});

describe("writeConfig", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("should create directory and write config.json", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pai-test-")), "nested", "dir");
    dirs.push(dir);
    const config = { llm: { provider: "anthropic" as const, model: "claude-opus-4-6" } };
    writeConfig(dir, config);
    expect(existsSync(join(dir, "config.json"))).toBe(true);
  });

  it("should write valid JSON matching what was written", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const config = { llm: { provider: "openai" as const, model: "gpt-4.1" }, logLevel: "info" as const };
    writeConfig(dir, config);
    const raw = readFileSync(join(dir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(config);
  });
});

describe("loadConfig with config file merging", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("should use config file values when no env vars set", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const fileConfig = { llm: { provider: "openai", model: "gpt-4.1", baseUrl: "https://api.openai.com/v1", apiKey: "sk-file" }, logLevel: "debug" };
    writeFileSync(join(dir, "config.json"), JSON.stringify(fileConfig));
    const config = loadConfig({ PAI_HOME: dir });
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4.1");
    expect(config.llm.apiKey).toBe("sk-file");
    expect(config.logLevel).toBe("debug");
  });

  it("should let env vars override config file values", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const fileConfig = { llm: { provider: "openai", model: "gpt-4.1" }, logLevel: "debug" };
    writeFileSync(join(dir, "config.json"), JSON.stringify(fileConfig));
    const config = loadConfig({ PAI_HOME: dir, PAI_LLM_PROVIDER: "ollama", PAI_LOG_LEVEL: "silent" });
    expect(config.llm.provider).toBe("ollama");
    expect(config.logLevel).toBe("silent");
  });

  it("should allow config file to set llm.provider to anthropic", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const fileConfig = { llm: { provider: "anthropic", model: "claude-opus-4-6", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-test" } };
    writeFileSync(join(dir, "config.json"), JSON.stringify(fileConfig));
    const config = loadConfig({ PAI_HOME: dir });
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-opus-4-6");
  });

  it("should use dataDir from config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-test-"));
    dirs.push(dir);
    const fileConfig = { dataDir: "/custom/data/path" };
    writeFileSync(join(dir, "config.json"), JSON.stringify(fileConfig));
    const config = loadConfig({ PAI_HOME: dir });
    expect(config.dataDir).toBe("/custom/data/path");
  });
});
