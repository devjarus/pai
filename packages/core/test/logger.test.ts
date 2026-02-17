import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("should not output anything at silent level", () => {
    const logger = createLogger("silent");
    logger.error("test");
    logger.debug("test");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("should output errors at error level", () => {
    const logger = createLogger("error");
    logger.error("something broke", { code: 500 });
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = JSON.parse((stderrSpy.mock.calls[0]![0] as string).trim());
    expect(output.level).toBe("error");
    expect(output.msg).toBe("something broke");
    expect(output.code).toBe(500);
    expect(output.ts).toBeDefined();
  });

  it("should filter messages below threshold", () => {
    const logger = createLogger("warn");
    logger.info("should not appear");
    logger.debug("should not appear");
    expect(stderrSpy).not.toHaveBeenCalled();
    logger.warn("should appear");
    logger.error("should appear");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("should output all levels at debug", () => {
    const logger = createLogger("debug");
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });

  it("should write NDJSON format", () => {
    const logger = createLogger("info");
    logger.info("test message");
    const raw = stderrSpy.mock.calls[0]![0] as string;
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty("ts");
    expect(parsed).toHaveProperty("level", "info");
    expect(parsed).toHaveProperty("msg", "test message");
  });
});

describe("Logger file output", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = mkdtempSync(join(tmpdir(), "pai-log-test-"));
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("should write log entries to file", () => {
    const logger = createLogger("silent", { dir: tmpDir });
    logger.info("file entry", { key: "val" });
    const logPath = join(tmpDir, "pai.log");
    const content = readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("file entry");
    expect(parsed.key).toBe("val");
  });

  it("should write to file even when stderr is silent", () => {
    const logger = createLogger("silent", { dir: tmpDir });
    logger.info("silent stderr, file logs");
    expect(stderrSpy).not.toHaveBeenCalled();
    const logPath = join(tmpDir, "pai.log");
    const content = readFileSync(logPath, "utf-8").trim();
    expect(JSON.parse(content).msg).toBe("silent stderr, file logs");
  });

  it("should respect file log level", () => {
    const logger = createLogger("silent", { dir: tmpDir, level: "error" });
    logger.info("should not appear in file");
    logger.error("should appear in file");
    const logPath = join(tmpDir, "pai.log");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).level).toBe("error");
  });

  it("should not write debug to file when file level is info", () => {
    const logger = createLogger("silent", { dir: tmpDir, level: "info" });
    logger.debug("debug msg");
    logger.info("info msg");
    const logPath = join(tmpDir, "pai.log");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).level).toBe("info");
  });

  it("should rotate log file when exceeding maxBytes", () => {
    const logPath = join(tmpDir, "pai.log");
    // Write a file larger than the threshold
    writeFileSync(logPath, "x".repeat(200));
    const logger = createLogger("silent", { dir: tmpDir, maxBytes: 100 });
    logger.info("after rotation");

    // Old file should be renamed to .1
    expect(existsSync(logPath + ".1")).toBe(true);
    const rotatedContent = readFileSync(logPath + ".1", "utf-8");
    expect(rotatedContent).toBe("x".repeat(200));

    // New file should have the new entry
    const newContent = readFileSync(logPath, "utf-8").trim();
    expect(JSON.parse(newContent).msg).toBe("after rotation");
  });

  it("should not rotate when file is under maxBytes", () => {
    const logPath = join(tmpDir, "pai.log");
    writeFileSync(logPath, "small");
    createLogger("silent", { dir: tmpDir, maxBytes: 1000 });
    expect(existsSync(logPath + ".1")).toBe(false);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toBe("small");
  });

  it("should dual-output to stderr and file", () => {
    const logger = createLogger("info", { dir: tmpDir });
    logger.info("dual output");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const logPath = join(tmpDir, "pai.log");
    const fileContent = readFileSync(logPath, "utf-8").trim();
    const stderrContent = (stderrSpy.mock.calls[0]![0] as string).trim();
    expect(JSON.parse(fileContent).msg).toBe("dual output");
    expect(JSON.parse(stderrContent).msg).toBe("dual output");
  });
});
