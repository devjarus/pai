import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveSandboxUrl, sandboxHealth, runInSandbox } from "../src/sandbox.js";

describe("sandbox", () => {
  const origEnv = process.env.PAI_SANDBOX_URL;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PAI_SANDBOX_URL = origEnv;
    } else {
      delete process.env.PAI_SANDBOX_URL;
    }
    vi.restoreAllMocks();
  });

  describe("resolveSandboxUrl", () => {
    it("returns null when PAI_SANDBOX_URL is not set", () => {
      delete process.env.PAI_SANDBOX_URL;
      expect(resolveSandboxUrl()).toBeNull();
    });

    it("returns the URL when PAI_SANDBOX_URL is set", () => {
      process.env.PAI_SANDBOX_URL = "http://localhost:8888";
      expect(resolveSandboxUrl()).toBe("http://localhost:8888");
    });

    it("returns null for empty string", () => {
      process.env.PAI_SANDBOX_URL = "";
      expect(resolveSandboxUrl()).toBeNull();
    });
  });

  describe("sandboxHealth", () => {
    it("returns ok:false when no URL configured and none passed", async () => {
      delete process.env.PAI_SANDBOX_URL;
      expect(await sandboxHealth()).toEqual({ ok: false });
    });

    it("returns health response on success", async () => {
      const mockResponse = { ok: true, languages: ["python", "node"] };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );
      const result = await sandboxHealth("http://sandbox:8888");
      expect(result).toEqual({ ok: true, languages: ["python", "node"] });
    });

    it("returns ok:false when fetch response is not ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("bad", { status: 500 }),
      );
      const result = await sandboxHealth("http://sandbox:8888");
      expect(result).toEqual({ ok: false });
    });

    it("returns ok:false when fetch throws", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
      const result = await sandboxHealth("http://sandbox:8888");
      expect(result).toEqual({ ok: false });
    });
  });

  describe("runInSandbox", () => {
    it("throws when sandbox is not configured", async () => {
      delete process.env.PAI_SANDBOX_URL;
      await expect(
        runInSandbox({ language: "python", code: "print(1)" }),
      ).rejects.toThrow("Sandbox not configured");
    });

    it("returns sandbox result on success", async () => {
      process.env.PAI_SANDBOX_URL = "http://sandbox:8888";
      const mockResult = { stdout: "1\n", stderr: "", exitCode: 0, files: [] };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), { status: 200 }),
      );
      const result = await runInSandbox({ language: "python", code: "print(1)" });
      expect(result).toEqual(mockResult);
    });

    it("throws on non-ok response", async () => {
      process.env.PAI_SANDBOX_URL = "http://sandbox:8888";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("timeout exceeded", { status: 408 }),
      );
      await expect(
        runInSandbox({ language: "python", code: "import time; time.sleep(999)" }),
      ).rejects.toThrow("Sandbox request failed (408): timeout exceeded");
    });

    it("uses custom timeout", async () => {
      process.env.PAI_SANDBOX_URL = "http://sandbox:8888";
      const mockResult = { stdout: "", stderr: "", exitCode: 0, files: [] };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), { status: 200 }),
      );
      await runInSandbox({ language: "node", code: "console.log(1)", timeout: 60 });
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.timeout).toBe(60);
    });

    it("handles res.text() failure on error response", async () => {
      process.env.PAI_SANDBOX_URL = "http://sandbox:8888";
      const badResponse = new Response(null, { status: 500 });
      vi.spyOn(badResponse, "text").mockRejectedValue(new Error("read failed"));
      vi.spyOn(globalThis, "fetch").mockResolvedValue(badResponse);
      await expect(
        runInSandbox({ language: "python", code: "x" }),
      ).rejects.toThrow("Sandbox request failed (500): unknown error");
    });
  });
});
