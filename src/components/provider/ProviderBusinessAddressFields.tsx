"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { autocompleteAddress, geoapifyConfig, type GeoapifyPlace } from "@/lib/geoapify";
import { MAX_ADDRESS_LENGTH, MAX_NEIGHBORHOOD_LENGTH } from "@/lib/validation/profile";

type Props = {
  address: string;
  neighborhood: string;
  unchanged: boolean;
  selected: boolean;
  disabled: boolean;
  error?: string;
  inputRef: RefObject<HTMLInputElement>;
  onEdit: (address: string) => void;
  onSelect: (place: GeoapifyPlace) => void;
};

// Treat provider responses as untrusted even though the shared adapter normalizes them.
function usable(place: GeoapifyPlace): boolean {
  return typeof place.formatted === "string" && Boolean(place.formatted.trim()) &&
    place.formatted.trim().length <= MAX_ADDRESS_LENGTH &&
    typeof place.neighborhood === "string" && place.neighborhood.trim().length <= MAX_NEIGHBORHOOD_LENGTH &&
    Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
    Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180;
}

export function ProviderBusinessAddressFields({ address, neighborhood, unchanged, selected, disabled, error, inputRef, onEdit, onSelect }: Props) {
  const id = useId();
  const [results, setResults] = useState<GeoapifyPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const generation = useRef(0);
  const cache = useRef(new Map<string, GeoapifyPlace[]>());
  const needsSearch = !unchanged && !selected && address.trim().length >= 3;

  useEffect(() => {
    const current = ++generation.current;
    setResults([]);
    setOpen(false);
    setActive(-1);
    if (disabled || !needsSearch) { setStatus(""); return; }
    if (!geoapifyConfig.apiKey) {
      setStatus("Address search is unavailable. Your draft is kept. Try again later or restore your saved address.");
      return;
    }
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const query = address.trim();
    setStatus("Searching for addresses…");
    const debounce = setTimeout(async () => {
      const show = (places: GeoapifyPlace[]) => {
        if (generation.current !== current || controller.signal.aborted) return;
        setResults(places); setOpen(places.length > 0); setActive(-1);
        setStatus(places.length ? "Choose an address from the suggestions." : "No matching addresses found. Try a more complete address.");
      };
      const cached = cache.current.get(query);
      if (cached) { show(cached); return; }
      timeout = setTimeout(() => {
        if (generation.current !== current) return;
        controller.abort();
        setStatus("Address search timed out. Your draft is kept. Please retry.");
      }, 8_000);
      try {
        const places = (await autocompleteAddress(query, controller.signal)).filter(usable).slice(0, 5).map((place) => ({ ...place, formatted: place.formatted.trim(), neighborhood: place.neighborhood.trim() }));
        if (generation.current !== current || controller.signal.aborted) return;
        if (cache.current.size >= 10) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(query, places);
        show(places);
      } catch {
        if (generation.current === current && !controller.signal.aborted) {
          setStatus("We couldn't search for that address. Your draft is kept. Please retry.");
        }
      } finally { clearTimeout(timeout); }
    }, 300);
    return () => { generation.current += 1; clearTimeout(debounce); clearTimeout(timeout); controller.abort(); };
  }, [address, disabled, needsSearch, retry]);

  // Keep the active descendant visible while focus stays on the combobox.
  useEffect(() => {
    const list = listRef.current;
    const option = list?.children[active];
    if (!open || !list || !(option instanceof HTMLElement)) return;
    const listBounds = list.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    const top = listBounds.top + list.clientTop;
    const bottom = top + list.clientHeight;
    if (optionBounds.top < top) list.scrollTop += optionBounds.top - top;
    else if (optionBounds.bottom > bottom) list.scrollTop += optionBounds.bottom - bottom;
  }, [active, open]);

  function choose(place: GeoapifyPlace) {
    if (disabled) return;
    ++generation.current;
    setOpen(false); setResults([]); setActive(-1);
    onSelect(place);
    inputRef.current?.focus();
  }

  const statusMessage = selected
    ? "Location selected. Service areas will stay unchanged unless you edit them separately."
    : status || (address.trim() && !unchanged ? "Enter at least three characters, then choose an address suggestion." : "");

  return (
    <div className="space-y-3" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <label htmlFor={`${id}-input`} className="block text-[11px] font-bold uppercase tracking-[0.10em] text-[var(--ink-500)]">Business address</label>
      <input ref={inputRef} id={`${id}-input`} role="combobox" aria-autocomplete="list" aria-expanded={open && results.length > 0}
        aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-describedby={`${id}-help ${id}-status${error ? ` ${id}-error` : ""}`} aria-invalid={Boolean(error)}
        autoComplete="off" disabled={disabled} value={address} maxLength={MAX_ADDRESS_LENGTH}
        className="h-11 w-full rounded-xl border border-[var(--border-warm)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-900)]"
        onFocus={() => { if (results.length && !disabled) setOpen(true); }}
        onChange={(event) => { if (disabled) return; ++generation.current; setResults([]); setOpen(false); setActive(-1); onEdit(event.target.value); }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
            event.preventDefault(); setOpen(true);
            setActive((index) => event.key === "ArrowDown" ? (index + 1) % results.length : (index <= 0 ? results.length - 1 : index - 1));
          }
          if (event.key === "Enter" && open && active >= 0) { event.preventDefault(); choose(results[active]!); }
        }} />
      {open && results.length > 0 ? <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Address suggestions" className="m-0 max-h-64 list-none overflow-y-auto rounded-xl border border-[var(--border-warm)] p-1">
        {results.map((place, index) => <li key={`${place.formatted}-${place.latitude}-${place.longitude}-${index}`} id={`${id}-option-${index}`} role="option" aria-selected={index === active}
          className={`min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm break-words ${index === active ? "bg-[var(--cream-100)]" : ""}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place)}>{place.formatted}</li>)}
      </ul> : null}
      <p id={`${id}-help`} className="text-xs leading-5 text-[var(--ink-500)]">Choose a suggestion to match your location. This does not verify your business or postal address. Address searches are sent to Geoapify.</p>
      <p id={`${id}-status`} role={statusMessage ? "status" : undefined} className="text-xs leading-5 text-[var(--ink-500)]">{statusMessage}</p>
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-[var(--danger-600)]">{error}</p> : null}
      {needsSearch && !disabled ? <button type="button" className="min-h-11 rounded-full border border-[var(--border-warm)] px-4 text-sm" onClick={() => { cache.current.delete(address.trim()); setRetry((value) => value + 1); }}>Retry address search</button> : null}
      <label className="block text-[11px] font-bold uppercase tracking-[0.10em] text-[var(--ink-500)]">Neighborhood
        <input readOnly value={neighborhood} disabled={disabled} className="mt-2 h-11 w-full rounded-xl border border-[var(--border-warm)] bg-[var(--cream-100)] px-3 text-sm font-normal normal-case tracking-normal text-[var(--ink-900)]" />
      </label>
      <p className="text-xs leading-5 text-[var(--ink-500)]">Address data: <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="underline">Geoapify</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap contributors</a></p>
    </div>
  );
}
