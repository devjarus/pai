import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";

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
