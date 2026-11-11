"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminVendorLead } from "@/lib/vendor-sourcing-types";
import { SERVICE_CATEGORIES, CATEGORY_LABELS } from "@/lib/service-categories";

const inputClass = "mt-1 block min-h-11 w-full rounded-lg border border-[#dce7e4] bg-white p-2";
export function VendorLeadDirectory({ onChanged }: { onChanged?: () => void }) {
  const loadGeneration = useRef(0);
  const importRevision = useRef(0);
  const approvedImport = useRef<string | null>(null);
  const invalidateImport = () => { importRevision.current++; approvedImport.current = null; setImportReport(null); };
  const [leads, setLeads] = useState<AdminVendorLead[]>([]); const [editing, setEditing] = useState<AdminVendorLead | null>(null);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [search, setSearch] = useState("");
  const currentSearch = useRef(search);
  currentSearch.current = search;
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [csv, setCsv] = useState(""); const [importReport, setImportReport] = useState<{ dryRun: boolean; importedCount: number; updatedCount: number; duplicateCount: number; excluded: unknown[]; rowsConsidered: number } | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (search !== currentSearch.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    try { const response = await fetch(`/api/admin/vendor-leads${search ? `?q=${encodeURIComponent(search)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load vendors."); if (!signal?.aborted && generation === loadGeneration.current && search === currentSearch.current) setLeads(data.leads); }
    catch (caught) { if (!signal?.aborted && generation === loadGeneration.current && search === currentSearch.current) setError(caught instanceof Error ? caught.message : "Could not load vendors."); }
    finally { if (!signal?.aborted && generation === loadGeneration.current && search === currentSearch.current) setLoading(false); }
  }, [search]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => { controller.abort(); loadGeneration.current++; }; }, [load]);
  return <div className="mt-4 space-y-5">
    <p className="text-sm text-[#64748b]">CSLB records establish license information only. Confirm the business email separately before inviting anyone. Provider documents are reviewed through the normal verification process.</p>
    <label className="block text-sm">Find a vendor<input className={inputClass} value={search} maxLength={160} onChange={event => setSearch(event.target.value)} /></label>
    {loading ? <p role="status">Loading vendors…</p> : <ul className="max-h-80 space-y-2 overflow-y-auto">
      {leads.map(lead => <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#dce7e4] p-3 text-sm" key={lead.id}><div><strong>{lead.businessName}</strong><p>{lead.licenseNumber ? `${lead.licenseJurisdiction} ${lead.licenseNumber} · ` : ""}{lead.licenseStatus} · {lead.status}</p><p className="break-all text-xs text-[#64748b]">{lead.city ?? "Location not confirmed"}{lead.email ? ` · ${lead.email}` : " · Email not confirmed"}</p></div><button type="button" className="min-h-11 rounded border px-3" disabled={busy} onClick={() => { setEditing(lead); setError(null); setNotice(null); }}>Edit {lead.businessName}</button></li>)}
      {!leads.length && <li className="text-sm text-[#64748b]">No matching leads.</li>}
    </ul>}
    <form key={editing?.id ?? "new"} className="grid gap-3 rounded-xl border border-[#dce7e4] p-4 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(null); setNotice(null);
      const form = event.currentTarget; const data = new FormData(form); const text = (key: string) => String(data.get(key) ?? "").trim() || null;
      try {
        const input = { businessName: text("businessName"), categories: data.getAll("category"), email: text("email"), phone: text("phone"), website: text("website"), licenseNumber: text("licenseNumber"), licenseJurisdiction: text("licenseJurisdiction") || "CA", licenseClasses: String(data.get("licenseClasses") ?? "").split(",").map(x => x.trim()).filter(Boolean), licenseStatus: text("licenseStatus"), licenseExpiresAt: text("licenseExpiresAt") ? new Date(`${text("licenseExpiresAt")}T00:00:00Z`).toISOString() : null, city: text("city"), region: text("region"), postalCode: text("postalCode"), county: text("county"), latitude: text("latitude") === null ? null : Number(text("latitude")), longitude: text("longitude") === null ? null : Number(text("longitude")), contactConfirmed: data.get("contactConfirmed") === "on", notes: text("notes"), source: editing?.source ?? "admin", ...(editing ? { status: editing.status, workersCompOnFile: editing.workersCompOnFile, bondOnFile: editing.bondOnFile } : {}) };
        const response = await fetch(`/api/admin/vendor-leads${editing ? `/${encodeURIComponent(editing.id)}` : ""}`, { method: editing ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not save the vendor.");
        setEditing(null); form.reset(); setNotice("Vendor saved. No invitation has been sent."); await load(); onChanged?.();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the vendor."); } finally { setBusy(false); }
    }}>
      <h3 className="font-semibold sm:col-span-2">{editing ? `Edit ${editing.businessName}` : "Add a vendor for review"}</h3>
      {([['businessName','Business name','text',editing?.businessName,160],['email','Business email','email',editing?.email,254],['phone','Business phone','tel',editing?.phone,40],['website','Business website','url',editing?.website,300],['licenseNumber','License number','text',editing?.licenseNumber,40],['licenseJurisdiction','License state','text',editing?.licenseJurisdiction ?? 'CA',8],['licenseClasses','License classes, separated by commas','text',editing?.licenseClasses.join(', '),200],['licenseExpiresAt','License expiration date','date',editing?.licenseExpiresAt?.slice(0,10),undefined],['city','Business city','text',editing?.city,100],['region','Business state / region','text',editing?.region,40],['postalCode','Business postal code','text',editing?.postalCode,20],['county','Business county','text',editing?.county,100],['latitude','Business latitude (optional)','number',editing?.latitude,undefined],['longitude','Business longitude (optional)','number',editing?.longitude,undefined]] as const).map(([name,label,type,value,max]) => <label className="text-sm" key={name}>{label}<input className={inputClass} name={name} type={type} step={type === 'number' ? 'any' : undefined} defaultValue={value ?? ''} required={name === 'businessName'} maxLength={max} /></label>)}
      <label className="text-sm">Current license status<select className={inputClass} name="licenseStatus" defaultValue={editing?.licenseStatus ?? "unknown"}><option value="unknown">Not checked</option><option value="active">Active — checked</option><option value="inactive">Inactive</option></select></label>
      <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">Services</legend><div className="mt-1 grid gap-1 sm:grid-cols-2">{SERVICE_CATEGORIES.map(category => <label className="flex min-h-11 items-center gap-2 text-sm" key={category}><input type="checkbox" name="category" value={category} defaultChecked={editing?.categories.includes(category)} />{CATEGORY_LABELS[category]}</label>)}</div></fieldset>
      <label className="text-sm sm:col-span-2">Internal business notes<textarea className={inputClass} name="notes" maxLength={2000} defaultValue={editing?.notes ?? ""} /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input name="contactConfirmed" type="checkbox" defaultChecked={editing?.contactConfirmed ?? false} />I confirmed this business email is an appropriate contact.</label>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button className="min-h-11 rounded bg-[#0f756c] px-4 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={busy}>{busy ? "Saving…" : "Save vendor"}</button>{editing && <button className="min-h-11 rounded border px-4 text-sm" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel editing</button>}</div>
    </form>
    <form className="space-y-3 rounded-xl border border-[#dce7e4] p-4" onChange={event => { if ((event.target as HTMLInputElement).name === "counties" || (event.target as HTMLInputElement).name === "classes") invalidateImport(); }} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(null); setNotice(null);
      const data = new FormData(event.currentTarget); const dryRun = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "apply";
      const revision = importRevision.current;
      const input = { csv, targetCounties: String(data.get("counties")).split(",").map(x => x.trim()).filter(Boolean), licenseClasses: String(data.get("classes")).split(",").map(x => x.trim()).filter(Boolean) };
      const signature = JSON.stringify(input);
      try {
        if (!dryRun && approvedImport.current !== signature) throw new Error("Preview these exact CSV contents and filters before applying.");
        const response = await fetch("/api/admin/vendor-leads/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, dryRun }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not import the CSV.");
        if (revision === importRevision.current) { setImportReport(result); approvedImport.current = dryRun ? signature : null; }
        if (!dryRun) { await load(); onChanged?.(); }
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not import the CSV."); } finally { setBusy(false); }
    }}>
      <h3 className="font-semibold">CSLB license master CSV</h3><p className="text-sm text-[#64748b]">Upload a filtered CSV with at most 1,000 records and 500 KB. The classification-and-county download is Excel; export it as CSV first. CSLB does not provide email addresses. Preview changes before applying.</p>
      <label className="block text-sm">Choose CSV file<input className={inputClass} type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => { setError(null); invalidateImport(); const revision = importRevision.current; const file = event.target.files?.[0]; setCsv(""); if (!file) return; if (file.size > 500000) { setError("Choose a CSV no larger than 500 KB."); return; } try { const contents = await file.text(); if (revision === importRevision.current) setCsv(contents); } catch { setError("Could not read that file. Please choose the CSV again."); } }} /></label>
      <label className="block text-sm">CSV contents<textarea className={`${inputClass} min-h-28 font-mono text-xs`} value={csv} maxLength={500000} required onChange={event => { setCsv(event.target.value); invalidateImport(); }} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Target counties, separated by commas<input className={inputClass} name="counties" placeholder="Los Angeles, Orange" required /></label><label className="text-sm">License classes, separated by commas<input className={inputClass} name="classes" defaultValue="D-35, C-53" required /></label></div>
      <div className="flex flex-wrap gap-2"><button className="min-h-11 rounded border px-4 text-sm" name="mode" value="preview" disabled={busy || !csv}>Preview import</button><button className="min-h-11 rounded bg-[#0f756c] px-4 text-sm font-semibold text-white disabled:opacity-50" name="mode" value="apply" disabled={busy || !csv || !importReport?.dryRun}>Apply import</button></div>
      {importReport && <p role="status" className="text-sm">{importReport.dryRun ? "Preview" : "Import complete"}: {importReport.rowsConsidered} rows considered; {importReport.importedCount} new, {importReport.updatedCount} updates, {importReport.duplicateCount} duplicates, {importReport.excluded.length} excluded.</p>}
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
  </div>;
}
