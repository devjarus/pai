import { describe, it, expect } from "vitest";
import { isBinaryDocument, parsePdf, parseExcel, parseBinaryDocument } from "../src/document-parser.js";

describe("isBinaryDocument", () => {
  it("recognizes PDF by MIME type", () => {
    expect(isBinaryDocument("application/pdf", "file.txt")).toBe(true);
  });

  it("recognizes PDF by extension", () => {
    expect(isBinaryDocument("application/octet-stream", "report.pdf")).toBe(true);
    expect(isBinaryDocument("application/octet-stream", "REPORT.PDF")).toBe(true);
  });

  it("recognizes Excel by MIME type", () => {
    expect(isBinaryDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data")).toBe(true);
    expect(isBinaryDocument("application/vnd.ms-excel", "data")).toBe(true);
    expect(isBinaryDocument("application/vnd.ms-excel.sheet.macroEnabled.12", "data")).toBe(true);
    expect(isBinaryDocument("application/vnd.ms-excel.sheet.binary.macroEnabled.12", "data")).toBe(true);
  });

  it("recognizes Excel by extension", () => {
    expect(isBinaryDocument("application/octet-stream", "data.xlsx")).toBe(true);
    expect(isBinaryDocument("application/octet-stream", "data.xls")).toBe(true);
    expect(isBinaryDocument("application/octet-stream", "data.xlsm")).toBe(true);
    expect(isBinaryDocument("application/octet-stream", "data.xlsb")).toBe(true);
  });

  it("rejects non-binary documents", () => {
    expect(isBinaryDocument("text/plain", "file.txt")).toBe(false);
    expect(isBinaryDocument("text/html", "page.html")).toBe(false);
    expect(isBinaryDocument("application/json", "data.json")).toBe(false);
    expect(isBinaryDocument("image/png", "photo.png")).toBe(false);
  });
});

describe("parseExcel", () => {
  it("parses a simple XLSX buffer", async () => {
    // Create a minimal xlsx using the xlsx library
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Value"],
      ["Alpha", "100"],
      ["Beta", "200"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = await parseExcel(Buffer.from(buf));
    expect(result).toContain("Name");
    expect(result).toContain("Alpha");
    expect(result).toContain("200");
  });

  it("handles multi-sheet workbooks", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A", "1"]]), "First");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["B", "2"]]), "Second");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = await parseExcel(Buffer.from(buf));
    expect(result).toContain("## Sheet: First");
    expect(result).toContain("## Sheet: Second");
  });

  it("skips empty sheets", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Data"]]), "HasData");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = await parseExcel(Buffer.from(buf));
    expect(result).toContain("Data");
    expect(result).not.toContain("Empty");
  });
});

describe("parseBinaryDocument", () => {
  it("routes Excel files to parseExcel", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Test"]]), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = await parseBinaryDocument(
      Buffer.from(buf),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "test.xlsx",
    );
    expect(result).toContain("Test");
  });

  it("routes by file extension when MIME is generic", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Test"]]), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = await parseBinaryDocument(Buffer.from(buf), "application/octet-stream", "data.xlsx");
    expect(result).toContain("Test");
  });

  it("throws for unsupported formats", async () => {
    await expect(
      parseBinaryDocument(Buffer.from("data"), "text/plain", "file.txt"),
    ).rejects.toThrow("Unsupported binary document format");
  });
});
