import "server-only";
import { MAX_VENDOR_IMPORT_ROWS, type VendorImportInput } from "@/lib/validation/vendor-sourcing";
import { VendorSourcingError } from "@/lib/server/vendor-errors";

/** Bounded RFC4180 parsing: never split quoted business names or fetch URLs. */
function records(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === "") quoted = !quoted;
      else throw new VendorSourcingError("Malformed CSV quoting.", 400);
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); row = []; field = "";
      if (rows.length > MAX_VENDOR_IMPORT_ROWS + 1) throw new VendorSourcingError(`Import at most ${MAX_VENDOR_IMPORT_ROWS} rows at a time.`, 400);
    } else field += char;
  }
  if (quoted) throw new VendorSourcingError("The CSV contains an unclosed quoted field.", 400);
  row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length > MAX_VENDOR_IMPORT_ROWS + 1) throw new VendorSourcingError(`Import at most ${MAX_VENDOR_IMPORT_ROWS} rows at a time.`, 400);
  return rows;
}
const key = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
export function normalizeVendorClass(value: string): string { return value.trim().toUpperCase().replace(/^([A-Z])[-\s]?(\d+)$/, "$1-$2"); }
function date(value: string): Date | null {
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()), us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (iso) [, year, month, day] = iso.map(Number);
  else if (us) { month = +us[1]; day = +us[2]; year = +us[3]; }
  else return null;
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day ? result : null;
}
export type CslbRecord = {
  licenseNumber: string; businessName: string; licenseClasses: string[]; licenseStatus: "active" | "inactive" | "unknown";
  licenseExpiresAt: Date | null; phone: string | null; city: string | null; region: string | null; postalCode: string | null;
  county: string; workersCompOnFile: boolean | null; bondOnFile: boolean | null; categories: string[]; eligibleForImport: boolean; row: number; reason: string | null;
};
export function parseCslbCsv(input: VendorImportInput, now = new Date()): { records: CslbRecord[]; excluded: Array<{ row: number; reason: string }> } {
  const data = records(input.csv); const header = (data.shift() ?? []).map(key);
  if (new Set(header).size !== header.length) throw new VendorSourcingError("CSV header names must be unique.", 400);
  const find = (...names: string[]) => names.map(key).map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
  const columns = {
    license: find("LicenseNo", "LicenseNumber"), business: find("FullBusinessName", "BusinessName"), county: find("County"),
    status: find("PrimaryStatus", "LicenseStatus"), classes: find("Classifications(s)", "Classifications", "LicenseClasses"), expiry: find("ExpirationDate", "LicenseExpiresAt"),
  };
  if (Object.values(columns).some((index) => index < 0)) throw new VendorSourcingError("Use the CSLB master CSV headers: LicenseNo, BusinessName, County, PrimaryStatus, Classifications(s), ExpirationDate.", 400);
  const counties = new Set(input.targetCounties.map((value) => value.trim().toLowerCase()));
  const classes = new Set(input.licenseClasses.map(normalizeVendorClass));
  const results: CslbRecord[] = [], excluded: Array<{ row: number; reason: string }> = [];
  for (const [index, cells] of data.entries()) {
    if (cells.length !== header.length) { excluded.push({ row: index + 2, reason: "Column count does not match the header." }); continue; }
    const cell = (column: number) => column < 0 ? "" : cells[column]?.trim() ?? "";
    const licenseNumber = cell(columns.license), businessName = cell(columns.business).slice(0, 160);
    if (!/^\d{1,12}$/.test(licenseNumber) || !businessName) { excluded.push({ row: index + 2, reason: "A valid license number and business name are required." }); continue; }
    const licenseClasses = [...new Set(cell(columns.classes).split(/[|;,]/).filter(Boolean).map(normalizeVendorClass))];
    const county = cell(columns.county), expires = date(cell(columns.expiry));
    const rawStatus = cell(columns.status).toLowerCase();
    const pending = ["SecondaryStatus", "PendingSuspension", "PendingClassRemoval", "PendingClassReplace", "InactivationDate"].some((name) => {
      const value = cell(find(name)); return value !== "" && !["0", "n", "no", "false"].includes(value.toLowerCase());
    });
    const current = expires !== null && expires.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const licenseStatus = ["susp", "expired", "revoked", "cancel", "inactive"].some((part) => rawStatus.includes(part)) || (expires !== null && !current)
      ? "inactive" : ["clear", "active"].includes(rawStatus) && current && !pending ? "active" : "unknown";
    const classMatch = licenseClasses.some((classification) => classes.has(classification));
    const countyMatch = counties.has(county.toLowerCase());
    const wc = cell(find("WorkersCompCoverageType"));
    const wcStart = date(cell(find("WCEffectiveDate"))), wcEnd = date(cell(find("WCExpirationDate")));
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const wcCancelled = cell(find("WCCancellationDate")), wcSuspended = cell(find("WCSuspendDate"));
    const wcKnownInvalid = !!wcCancelled || !!wcSuspended || (wcStart !== null && +wcStart > today) || (wcEnd !== null && +wcEnd < today);
    const wcCurrent = wcStart !== null && +wcStart <= today && wcEnd !== null && +wcEnd >= today && !wcKnownInvalid;
    const bondCompany = cell(find("CBSuretyCompany")), bondCancelled = cell(find("CBCancellationDate"));
    const bondStart = date(cell(find("CBEffectiveDate")));
    const categories = [...(licenseClasses.some((classification) => ["D-35", "C-53"].includes(classification)) ? ["pool_care"] : []), ...(licenseClasses.includes("C-27") ? ["landscaping"] : [])];
    const reason = !classMatch ? "Classification excluded." : !countyMatch ? "County excluded." : licenseStatus !== "active" ? "License is not currently clear and active." : categories.length === 0 ? "Unsupported service classification." : null;
    results.push({ licenseNumber, businessName, licenseClasses, licenseStatus, licenseExpiresAt: expires,
      phone: cell(find("BusinessPhone", "Telephone", "Phone")).slice(0, 40) || null, city: cell(find("City")).slice(0, 100) || null,
      region: cell(find("State", "Region")).slice(0, 40) || null, postalCode: cell(find("ZIPCode", "PostalCode")).slice(0, 20) || null,
      county, workersCompOnFile: !wc ? null : /exempt|does not have/i.test(wc) || wcKnownInvalid ? false : /workers.? compensation insurance/i.test(wc) && wcCurrent ? true : null,
      bondOnFile: bondCancelled || (bondStart !== null && +bondStart > today) ? false : bondCompany && bondStart !== null && +bondStart <= today ? true : null,
      categories, eligibleForImport: reason === null, row: index + 2, reason });
    if (reason) excluded.push({ row: index + 2, reason });
  }
  return { records: results, excluded };
}
