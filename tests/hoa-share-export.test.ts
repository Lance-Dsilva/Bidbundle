import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { hoaShareCsv, hoaSharePdf } from "@/lib/server/hoa-share-export";
import type { HoaShareStatementExport } from "@/lib/hoa-revenue-share-types";
const view: HoaShareStatementExport = { id: "statement-synthetic", communityId: "community-synthetic", communityName: "Érable 社区", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", totalCents: -250, savingsCents: 0, openingBalanceCents: 100, availableCents: -150, distributedCents: 0, closingBalanceCents: -150, status: "accruing", paidAt: null, reference: null, lines: [{ date: "2026-10-20T12:00:00.000Z", kind: "refund_adjustment", amountCents: -250, savingsCents: 0 }] };
it("exports exact cents and preserves negative adjustments without spreadsheet formulas", () => {
 const csv = hoaShareCsv({ ...view, communityName: '=HYPERLINK("bad")', reference: "  +CMD" });
 expect(csv).toContain('"-250"'); expect(csv).toContain('"-150"'); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("'  +CMD");
 expect(csv).not.toContain("residentUserId"); expect(csv).not.toContain("paymentMethodId");
});
it("renders a multi-page Unicode statement with full ledger and safe rejection of oversized exports", async () => {
 const lines = Array.from({ length: 75 }, (_, i) => ({ ...view.lines[0], amountCents: i === 74 ? -777 : -250 }));
 const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
 const pdf = await hoaSharePdf({ ...view, lines, totalCents, closingBalanceCents: view.openingBalanceCents + totalCents }); expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-"); expect(pdf.byteLength).toBeGreaterThan(10000);
 if (process.env.HOA_SHARE_EXPORT_SAMPLE === "1") await writeFile("/private/tmp/bundleen-hoa-share-statement.pdf", pdf);
 expect(() => hoaShareCsv({ ...view, lines: Array(10001).fill(view.lines[0]) })).toThrow(/too large/);
}, 30000);
it("rejects unsupported characters without replacing the name", async () => { await expect(hoaSharePdf({ ...view, communityName: "Estate 🦄" })).rejects.toThrow(/character/); });

it("refuses incomplete ledger exports rather than silently dropping entries", () => { expect(() => hoaShareCsv({ ...view, lines: [] })).toThrow(/complete statement/); });
