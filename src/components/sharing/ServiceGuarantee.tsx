/** Release control: enable only after live redo/refund acceptance and operations review. */
export function ServiceGuarantee() {
  if (process.env.SERVICE_QUALITY_GUARANTEE !== "1" || process.env.SERVICE_QUALITY_INTAKE !== "1") return null;
  return <section className="mt-6 rounded-2xl border border-teal-200 p-6" aria-label="Bundleen guarantee"><h2 className="text-lg font-semibold">The Bundleen guarantee</h2><p className="mt-2">If a visit isn’t done as described, report it within 72 hours and we’ll have it redone or refund that visit.</p></section>;
}
