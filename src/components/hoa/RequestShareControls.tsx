"use client";
import { SharedRequestBroadcast } from "@/components/sharing/SharedRequestBroadcast";
import { useRef, useState } from "react";
export function RequestShareControls({ requestId }: { requestId: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [communityPath, setCommunityPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function act(action: "enable" | "disable" | "rotate") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/hoa/requests/${encodeURIComponent(requestId)}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to update sharing.");
      setPath(result.path); setCommunityPath(result.communityPath);
      setMessage(action === "disable" ? "Sharing disabled. Existing request links no longer work." : "Link ready. Anyone with the links can see the community name, service category, accepted price and home counts.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update sharing."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(new URL(value, window.location.origin).toString()); setMessage("Link copied."); }
    catch { setMessage("Copy failed. Open the link and copy it from your address bar."); }
  }
  return <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-sm">Share a public, unlisted service summary and community name. Private descriptions, resident names and addresses are excluded.</p>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy} onClick={() => void act("enable")}>Get share link</button>
    {path && <><button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy} onClick={() => void copy(path)}>Copy request link</button><a className="bb-btn bb-btn-secondary min-h-11" href={path} target="_blank" rel="noreferrer">Preview public page</a><a className="bb-btn bb-btn-secondary min-h-11" href={`/api/hoa/requests/${encodeURIComponent(requestId)}/share/flyer`}>Download QR flyer</a>{communityPath && <button type="button" className="bb-btn bb-btn-secondary min-h-11" onClick={() => void copy(communityPath)}>Copy community link</button>}<button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy} onClick={() => void act("rotate")}>Replace request link</button></>}
    <button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy} onClick={() => void act("disable")}>Disable sharing</button></div>
    {path && <SharedRequestBroadcast key={path} requestId={requestId} />}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </div>;
}
