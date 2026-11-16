import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import type { PublicRequestSummary } from "@/lib/server/public-request-sharing";

/** Only generic category labels, counts and the capability link enter the PDF.
 * It never includes community/resident names, addresses or private content. */
export async function createShareFlyer(request: PublicRequestSummary, url: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const teal = rgb(0.04, 0.45, 0.4);
  page.drawText("BUNDLEEN", { x: 52, y: 718, size: 20, font: bold, color: teal });
  page.drawText("A service for your community", { x: 52, y: 660, size: 25, font: bold });
  page.drawText(request.service, { x: 52, y: 615, size: 21, font: bold });
  page.drawText(`${request.joinedHomes} homes joined${request.minimumHomes ? ` / ${request.minimumHomes} needed` : ""}`, { x: 52, y: 580, size: 15, font: regular });
  page.drawText("Scan to see the service and enrollment details.", { x: 52, y: 540, size: 14, font: regular });
  const png = await QRCode.toBuffer(url, { type: "png", width: 420, margin: 4, errorCorrectionLevel: "M" });
  const image = await pdf.embedPng(png);
  page.drawImage(image, { x: 196, y: 280, width: 220, height: 220 });
  page.drawText("Resident names and addresses stay private.", { x: 52, y: 235, size: 13, font: regular });
  page.drawText("Open this link if you cannot scan the code:", { x: 52, y: 192, size: 11, font: regular });
  // Capability links are long: wrap at known path delimiters, never truncate.
  const parts = url.match(/.{1,72}/g) ?? [url];
  parts.forEach((line, index) => page.drawText(line, { x: 52, y: 170 - index * 16, size: 9, font: regular }));
  return pdf.save();
}
