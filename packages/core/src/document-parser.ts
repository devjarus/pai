/**
 * Document parser — extracts text content from binary document formats (PDF, Excel).
 * Used by both the chat upload flow and the knowledge upload endpoint.
 */

/**
 * Parse a PDF buffer and return extracted text content.
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text?.trim() ?? "";
}

/**
 * Parse an Excel buffer (.xlsx, .xls) and return content as CSV-like text.
 * Each sheet is separated by a header line.
 */
export async function parseExcel(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv: string = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim().length === 0) continue;
    if (workbook.SheetNames.length > 1) {
      sections.push(`## Sheet: ${sheetName}\n\n${csv}`);
    } else {
      sections.push(csv);
    }
  }

  return sections.join("\n\n");
}

/**
 * Determine if a file is a supported binary document by MIME type or extension.
 */
export function isBinaryDocument(mimeType: string, fileName: string): boolean {
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) return true;
  if (isExcelMime(mimeType) || /\.(xlsx?|xlsm|xlsb)$/i.test(fileName)) return true;
  return false;
}

/**
 * Check if a MIME type is an Excel type.
 */
function isExcelMime(mime: string): boolean {
  return [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  ].includes(mime);
}

/**
 * Parse a binary document buffer into text based on its type.
 * Returns the extracted text, or throws if the format is unsupported.
 */
export async function parseBinaryDocument(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    return parsePdf(buffer);
  }
  if (isExcelMime(mimeType) || /\.(xlsx?|xlsm|xlsb)$/i.test(fileName)) {
    return parseExcel(buffer);
  }
  throw new Error(`Unsupported binary document format: ${mimeType}`);
}
