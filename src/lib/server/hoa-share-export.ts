import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import type { HoaShareStatementExport } from "@/lib/hoa-revenue-share-types";
import { HoaWorkflowError } from "@/lib/server/hoa";

const amount = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
function validate(view: HoaShareStatementExport) {
  if (view.lines.length > 10000) throw new HoaWorkflowError("This statement is too large to export. Contact support for the complete record.", 413);
  const amounts = [view.totalCents, view.savingsCents, view.openingBalanceCents, view.availableCents, view.distributedCents, view.closingBalanceCents, ...view.lines.flatMap(line => [line.amountCents, line.savingsCents])];
  if (view.lines.reduce((sum, line) => sum + line.amountCents, 0) !== view.totalCents || view.lines.reduce((sum, line) => sum + line.savingsCents, 0) !== view.savingsCents) throw new HoaWorkflowError("The complete statement ledger is required for export.", 409);
  if (amounts.some(value => !Number.isSafeInteger(value))) throw new HoaWorkflowError("Statement amounts need review before export.", 409);
}
function cell(value: string | number) {
  // Never let manually supplied references or community names become spreadsheet formulas.
  let text = String(value);
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function hoaShareCsv(view: HoaShareStatementExport) {
  validate(view);
  const rows: Array<Array<string | number>> = [
    ["Bundleen association statement", view.id], ["Community", view.communityName],
    ["Period start UTC", view.periodStart], ["Period end UTC (exclusive)", view.periodEnd],
    ["Status", view.status], ["Payment reference", view.reference ?? ""], ["Currency", "USD"],
    ["Opening balance cents", view.openingBalanceCents], ["Net earned cents", view.totalCents],
    ["Resident savings cents", view.savingsCents], ["Distributed cents", view.distributedCents],
    ["Period-end balance cents", view.closingBalanceCents], [],
    ["Date UTC", "Entry", "Share cents", "Resident savings cents"],
    ...view.lines.map(line => [line.date, line.kind, line.amountCents, line.savingsCents]),
  ];
  return rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

type EmbeddedFont = { name: string; bytes: Buffer; font: Font };
let fontPromise: Promise<EmbeddedFont[]> | undefined;
function loadFonts() {
  return fontPromise ??= Promise.all(["NotoSans-Regular.ttf", "NotoSansCJKsc-Regular.otf"].map(async (file, i) => {
    const bytes = await readFile(path.join(process.cwd(), "src/assets/fonts/board-minutes", file));
    return { name: `statement-${i}`, bytes, font: create(bytes) as Font };
  })).catch(error => { fontPromise = undefined; throw error; });
}
/** Caller must authorize the exact community and statement before rendering. */
export async function hoaSharePdf(view: HoaShareStatementExport): Promise<Uint8Array> {
  validate(view);
  const fonts = await loadFonts();
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 60, bottom: 58, left: 48, right: 48 }, bufferPages: true, autoFirstPage: false, info: { Title: "Association revenue statement", Author: "Bundleen" } });
  fonts.forEach(font => doc.registerFont(font.name, font.bytes));
  const chunks: Buffer[] = [];
  const output = new Promise<Uint8Array>((resolve, reject) => { doc.on("data", chunk => chunks.push(Buffer.from(chunk))); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  void output.catch(() => {});
  let pages = 0;
  doc.on("pageAdded", () => { if (++pages > 100) throw new HoaWorkflowError("This PDF is too large. Download the complete CSV instead.", 413); });
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  function paragraph(raw: string, size = 10) {
    const text = raw.normalize("NFC").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/\t/g, "    ");
    const runs: Array<{ text: string; font: string }> = [];
    for (const { segment } of segmenter.segment(text)) {
      const font = fonts.find(item => [...segment].every(character => character === "\n" || item.font.hasGlyphForCodePoint(character.codePointAt(0)!)));
      if (!font) throw new HoaWorkflowError("A character cannot be rendered by the bundled PDF fonts. Download CSV for the complete text.", 422);
      const previous = runs[runs.length - 1]; if (previous?.font === font.name) previous.text += segment; else runs.push({ text: segment, font: font.name });
    }
    doc.fontSize(size).fillColor("#153f3b");
    runs.forEach((run, i) => doc.font(run.font).text(run.text, { width: 516, lineGap: 3, continued: i < runs.length - 1 }));
    doc.moveDown(0.5);
  }
  try {
    doc.addPage();
    paragraph("Association revenue statement", 22);
    paragraph(view.communityName, 15);
    paragraph(`Statement: ${view.id}\nPeriod: ${view.periodStart.slice(0, 10)} to ${view.periodEnd.slice(0, 10)} (end exclusive, UTC)\nStatus: ${view.status.replaceAll("_", " ")}`);
    paragraph(`Opening balance: ${amount(view.openingBalanceCents)}\nNet earned during period: ${amount(view.totalCents)}\nResident savings: ${amount(view.savingsCents)}\nDistributed to association: ${amount(view.distributedCents)}\nBalance at period end: ${amount(view.closingBalanceCents)}`, 12);
    paragraph(`Payment reference: ${view.reference ?? "No payment reference recorded"}\nPaid at: ${view.paidAt ?? "Not recorded"}`);
    paragraph("Association shares are funded from Bundleen's fee. Refund adjustments can create a negative balance carried against future earnings. A statement alone does not prove payment.");
    paragraph("Ledger entries", 14);
    if (!view.lines.length) paragraph("No entries in this period.");
    for (const line of view.lines) paragraph(`${line.date} | ${line.kind.replaceAll("_", " ")}\nAssociation share: ${amount(line.amountCents)} | Resident savings: ${amount(line.savingsCents)}`);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); doc.font(fonts[0].name).fontSize(8).fillColor("#546575");
      doc.text("BUNDLEEN / PRIVATE ASSOCIATION STATEMENT", 48, 30, { lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 48, 758, { lineBreak: false });
    }
    doc.end(); return await output;
  } catch (error) { doc.destroy(); throw error; }
}
