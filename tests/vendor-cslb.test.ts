import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeVendorClass, parseCslbCsv } from "@/lib/server/vendor-cslb";
import { vendorImportSchema } from "@/lib/validation/vendor-sourcing";

const now = new Date("2026-11-10T12:00:00.000Z");
const nativeFixture = readFileSync(new URL("./fixtures/vendor-sourcing/cslb-native.csv", import.meta.url), "utf8");
const header = ["LicenseNo", "FullBusinessName", "County", "PrimaryStatus", "Classifications(s)", "ExpirationDate", "SecondaryStatus", "PendingSuspension", "InactivationDate", "WorkersCompCoverageType", "WCEffectiveDate", "WCExpirationDate", "WCCancellationDate", "WCSuspendDate", "CBSuretyCompany", "CBEffectiveDate", "CBCancellationDate"];
const good = { LicenseNo: "990099", FullBusinessName: "Fictional Pool", County: "Los Angeles", PrimaryStatus: "CLEAR", "Classifications(s)": "D35| C-53", ExpirationDate: "12/31/2099" };
function csv(rows: Array<Record<string, string>>) {
  const cell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [header.join(","), ...rows.map(row => header.map(key => cell(row[key] ?? "")).join(","))].join("\r\n");
}
const parse = (value: string) => parseCslbCsv(vendorImportSchema.parse({ csv: value, targetCounties: ["Los Angeles"] }), now);

describe("CSLB native master CSV contract", () => {
  it("reads the actual native header with synthetic CLEAR/class/county candidates only", () => {
    const result = parse(nativeFixture);
    expect(result.records).toHaveLength(9);
    expect(result.records.filter(row => row.eligibleForImport).map(row => row.licenseNumber)).toEqual(["990001", "990006", "990001"]);
    expect(result.records.find(row => row.licenseNumber === "990001")).toMatchObject({ businessName: "Fictional Pool, Inc.", licenseClasses: ["D-35", "C-53"], categories: ["pool_care"], workersCompOnFile: false });
    expect(result.records.every(row => !("email" in row) && !("contactConfirmed" in row))).toBe(true);
  });
  it("retains suspended/expired rows for deactivation while refusing them as new candidates", () => {
    const result = parse(nativeFixture);
    for (const license of ["990002", "990003"]) expect(result.records.find(row => row.licenseNumber === license)).toMatchObject({ licenseStatus: "inactive", eligibleForImport: false });
    for (const license of ["990007", "990008"]) expect(result.records.find(row => row.licenseNumber === license)).toMatchObject({ eligibleForImport: false });
  });
  it("normalizes native pipe-delimited mixed class spelling and a BOM header", () => {
    expect(normalizeVendorClass(" d35 ")).toBe("D-35"); expect(normalizeVendorClass("C-53")).toBe("C-53");
    expect(parse("\uFEFF" + csv([{ ...good, "Classifications(s)": "D-35| C53| D35" }])).records[0]).toMatchObject({ licenseClasses: ["D-35", "C-53"], eligibleForImport: true });
  });
  it("preserves quoted commas, double quotes and multiline business names", () => {
    const name = 'Fictional "Careful", Pool\nServices';
    expect(parse(csv([{ ...good, FullBusinessName: name }])).records[0].businessName).toBe(name);
  });
  it.each(["UNKNOWN STATUS", "Work Comp Susp", "CLEAR-ish"])("does not infer active eligibility from %s", (status) => {
    expect(parse(csv([{ ...good, PrimaryStatus: status }])).records[0].eligibleForImport).toBe(false);
  });
  it.each(["", "02/30/2099", "01/01/2020"])("refuses missing, invalid or expired license date %s", (expiry) => {
    expect(parse(csv([{ ...good, ExpirationDate: expiry }])).records[0].eligibleForImport).toBe(false);
  });
  it("does not treat exempt or expired workers compensation coverage as insured", () => {
    const result = parse(csv([
      { ...good, WorkersCompCoverageType: "Exempt" },
      { ...good, WorkersCompCoverageType: "Workers' Compensation Insurance", WCEffectiveDate: "01/01/2020", WCExpirationDate: "01/01/2021" },
      { ...good, WorkersCompCoverageType: "Workers' Compensation Insurance", WCEffectiveDate: "01/01/2020", WCExpirationDate: "12/31/2099", WCSuspendDate: "11/01/2026" },
    ]));
    for (const record of result.records) expect(record.workersCompOnFile).not.toBe(true);
  });
  it("does not assert a current bond from a company name with a future-effective or cancelled bond", () => {
    const result = parse(csv([
      { ...good, CBSuretyCompany: "Fictional Surety", CBEffectiveDate: "01/01/2099" },
      { ...good, CBSuretyCompany: "Fictional Surety", CBEffectiveDate: "01/01/2020", CBCancellationDate: "01/01/2021" },
    ]));
    for (const record of result.records) expect(record.bondOnFile).not.toBe(true);
  });
  it("refuses ambiguous duplicate headers and broken quoting", () => {
    expect(() => parse(csv([good]).replace("LicenseNo,", "LicenseNo,License No,"))).toThrow();
    expect(() => parse(header.join(",") + '\n990099,"unclosed')).toThrow();
  });
  it("bounds records independently of the HTTP body limit", () => {
    expect(() => parse(csv(Array.from({ length: 1001 }, () => good)))).toThrow(/1000/);
  });
});
