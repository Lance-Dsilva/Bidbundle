/** The server supplies current, document-backed credential validity. */
export function VerifiedProviderBadge({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <span className="inline-flex max-w-full items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold leading-4 text-emerald-800">
      Licensed &amp; insured — verified by Bundleen
    </span>
  );
}
