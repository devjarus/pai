import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveBrowserUrl, browserHealth, browserNavigate, browserSnapshot, browserAction, browserText, browserScreenshot, browserCloseAllTabs } from "../src/browser.js";

describe("browser", () => {
  const origEnv = process.env.PAI_BROWSER_URL;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PAI_BROWSER_URL = origEnv;
    } else {
      delete process.env.PAI_BROWSER_URL;
    }
    vi.restoreAllMocks();
  });

  describe("resolveBrowserUrl", () => {
    it("returns null when PAI_BROWSER_URL is not set", () => {
      delete process.env.PAI_BROWSER_URL;
      expect(resolveBrowserUrl()).toBeNull();
    });

    it("returns the URL when PAI_BROWSER_URL is set", () => {
      process.env.PAI_BROWSER_URL = "http://localhost:9867";
      expect(resolveBrowserUrl()).toBe("http://localhost:9867");
    });

    it("returns null for empty string", () => {
      process.env.PAI_BROWSER_URL = "";
      expect(resolveBrowserUrl()).toBeNull();
    });

    it("prefers configUrl over env var", () => {
      process.env.PAI_BROWSER_URL = "http://env:9867";
      expect(resolveBrowserUrl("http://config:9867")).toBe("http://config:9867");
    });
  });

  describe("browserHealth", () => {
    it("returns ok:false when no URL configured", async () => {
      delete process.env.PAI_BROWSER_URL;
      expect(await browserHealth()).toEqual({ ok: false });
    });

    it("returns ok:true on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("OK", { status: 200 }),
      );
      const result = await browserHealth("http://browser:9867");
      expect(result).toEqual({ ok: true });
    });

    it("returns ok:false when fetch response is not ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("bad", { status: 500 }),
      );
      expect(await browserHealth("http://browser:9867")).toEqual({ ok: false });
    });

    it("returns ok:false when fetch throws", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
      expect(await browserHealth("http://browser:9867")).toEqual({ ok: false });
    });
  });

  describe("browserNavigate", () => {
    it("throws when browser is not configured", async () => {
      delete process.env.PAI_BROWSER_URL;
      await expect(browserNavigate("https://example.com")).rejects.toThrow("Browser not configured");
    });

    it("returns navigate result on success", async () => {
      const mockResult = { url: "https://example.com", title: "Example" };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), { status: 200 }),
      );
      const result = await browserNavigate("https://example.com", {}, undefined, "http://browser:9867");
      expect(result).toEqual(mockResult);
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("page not found", { status: 404 }),
      );
      await expect(
        browserNavigate("https://bad.example", {}, undefined, "http://browser:9867"),
      ).rejects.toThrow("Browser navigate failed (404): page not found");
    });

    it("throws on connection error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(
        browserNavigate("https://example.com", {}, undefined, "http://browser:9867"),
      ).rejects.toThrow("Cannot reach browser");
    });
  });

  describe("browserSnapshot", () => {
    it("returns snapshot text on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("[1] <button>Click me</button>", { status: 200 }),
      );
      const result = await browserSnapshot(undefined, "http://browser:9867");
      expect(result).toBe("[1] <button>Click me</button>");
    });

    it("throws when not configured", async () => {
      delete process.env.PAI_BROWSER_URL;
      await expect(browserSnapshot()).rejects.toThrow("Browser not configured");
    });
  });

  describe("browserAction", () => {
    it("returns action result on success", async () => {
      const mockResult = { ok: true, message: "clicked" };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), { status: 200 }),
      );
      const result = await browserAction({ kind: "click", ref: "[1]" }, undefined, "http://browser:9867");
      expect(result).toEqual(mockResult);
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("element not found", { status: 400 }),
      );
      await expect(
        browserAction({ kind: "click", ref: "[99]" }, undefined, "http://browser:9867"),
      ).rejects.toThrow("Browser action failed (400)");
    });
  });

  describe("browserText", () => {
    it("returns page text on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Hello World page content", { status: 200 }),
      );
      const result = await browserText(undefined, "http://browser:9867");
      expect(result).toBe("Hello World page content");
    });
  });

  describe("browserScreenshot", () => {
    it("returns buffer on success", async () => {
      const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(pngData, { status: 200 }),
      );
      const result = await browserScreenshot(undefined, undefined, "http://browser:9867");
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(4);
    });

    it("passes quality parameter", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(new Uint8Array([1]), { status: 200 }),
      );
      await browserScreenshot(50, undefined, "http://browser:9867");
      expect(fetchSpy.mock.calls[0]![0]).toContain("?quality=50");
    });
  });

  describe("browserCloseAllTabs", () => {
    it("does nothing when browser is not configured", async () => {
      delete process.env.PAI_BROWSER_URL;
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await browserCloseAllTabs();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("closes all tabs except the first", async () => {
      const calls: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        calls.push(url);
        if (url.includes("/tabs")) {
          return new Response(JSON.stringify([
            { id: "tab-1" },
            { id: "tab-2" },
            { id: "tab-3" },
          ]), { status: 200 });
        }
        return new Response('{"ok":true}', { status: 200 });
      });

      await browserCloseAllTabs(undefined, "http://browser:9867");

      // Should list tabs then close tab-2 and tab-3 (not tab-1)
      expect(calls[0]).toContain("/tabs");
      expect(calls).toHaveLength(3); // 1 list + 2 closes
    });

    it("does nothing when only one tab is open", async () => {
      const calls: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        calls.push(url);
        return new Response(JSON.stringify([{ id: "tab-1" }]), { status: 200 });
      });

      await browserCloseAllTabs(undefined, "http://browser:9867");
      expect(calls).toHaveLength(1); // only list, no closes
    });

    it("silently ignores errors", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
      await browserCloseAllTabs(undefined, "http://browser:9867");
      // Should not throw
    });
  });
});
