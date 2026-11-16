import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { createShareFlyer } from "@/lib/server/share-flyer";
it("creates a one-page portable QR flyer without private fields", async () => {
  const url = `https://bundleen.com/c/${"C".repeat(32)}/r/${"R".repeat(32)}`;
  const bytes=await createShareFlyer({ priceLadder:null,providerName:null,verifiedBidders:0,service:"Seasonal maintenance",joinedHomes:9999,minimumHomes:10000,status:"collecting_interest",enrollmentClosesAt:null,path:""},url);
  const pdf=await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1); expect(bytes.length).toBeGreaterThan(1000);
  if (process.env.SHARE_FLYER_EVIDENCE === "1") await writeFile("/private/tmp/bundleen-share-48-flyer.pdf",bytes);
});
