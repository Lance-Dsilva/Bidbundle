"use client";

/**
 * The neighbourhood centre, entered as an address.
 *
 * Radius geometry is still admin-owned — Bundleen staff decide how wide a
 * neighbourhood is — but the *centre* is now a place, not two decimals. An
 * admin knows the street a neighbourhood is built around; nobody knows its
 * latitude, and asking for one produced the same transcription errors that
 * made HOA onboarding unreliable.
 *
 * The server resolves whatever is typed here through the same geocoder HOA
 * profiles use, and stores the coordinates itself. There is no field on this
 * component that can carry a coordinate.
 */

export type CentreAddress = {
  addressLine1: string;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
};

export const EMPTY_CENTRE_ADDRESS: CentreAddress = {
  addressLine1: "",
  locality: "",
  region: "",
  postalCode: "",
  country: "US",
};

/** True once every part the geocoder needs is present. */
export function isCompleteCentreAddress(address: CentreAddress): boolean {
  return Boolean(
    address.addressLine1.trim() &&
      address.locality.trim() &&
      address.region.trim() &&
      address.postalCode.trim(),
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function CentreAddressFields({
  value,
  onChange,
  fieldErrors = {},
  required = false,
}: {
  value: CentreAddress;
  onChange: (next: CentreAddress) => void;
  fieldErrors?: Record<string, string>;
  required?: boolean;
}) {
  const set = (key: keyof CentreAddress) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });

  return (
    <fieldset className="space-y-3">
      <legend className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
        Centre address
      </legend>
      <p className="text-[11px] text-slate-500">
        The street this neighbourhood is centred on. Bundleen resolves the map location from it.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Street address
          </span>
          <input
            className={inputClass}
            maxLength={160}
            onChange={set("addressLine1")}
            required={required}
            value={value.addressLine1}
          />
          {fieldErrors["centerAddress.addressLine1"] ? (
            <span className="mt-1 block text-[11px]" style={{ color: "var(--danger-600)" }}>
              {fieldErrors["centerAddress.addressLine1"]}
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            City
          </span>
          <input
            className={inputClass}
            maxLength={80}
            onChange={set("locality")}
            required={required}
            value={value.locality}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            State / region
          </span>
          <input
            className={inputClass}
            maxLength={80}
            onChange={set("region")}
            required={required}
            value={value.region}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Postal code
          </span>
          <input
            className={inputClass}
            maxLength={12}
            onChange={set("postalCode")}
            required={required}
            value={value.postalCode}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Country (2 letters)
          </span>
          <input
            className={inputClass}
            maxLength={2}
            onChange={set("country")}
            required={required}
            value={value.country}
          />
        </label>
      </div>
    </fieldset>
  );
}
