// « Relire » : a machine, a connector or a service read right now, on its own, without waiting for its period or for a whole pass.
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { LOGIN, LoginRequired, send } from "../api";
import { quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { pokeScan } from "../lib/scan";
import { serverText } from "../lib/serverText";

type Run = () => Promise<Note>;
const NOTE_MS = 15000;   // the answer stays that long in the tooltip and on the colour of the icon
export interface TryResult { up: boolean; ms: number | null; code: number | null; error: string | null }

export const readConnector = (type: string, name: string): Run => async () => {
  const r = await send<{ ok: boolean; message: string }>("POST", `connectors/settings/${type}/${encodeURIComponent(name)}/read`);
  return r.ok ? { ok: true, text: tx("Lu. La page se met à jour à la fin de la collecte.") } : { ok: false, text: serverText(r.message) };
};

export const recheckMachine = (ip: string): Run => async () => {
  const r = await send<{ started: boolean }>("POST", `machines/settings/${ip}/recheck`);
  return r.started ? { ok: true, text: tx("Santé en cours de relecture, résultat dans quelques secondes.") } : { ok: false, text: tx("Une relecture de santé tourne déjà, réessaie dans un instant.") };
};

/** What a service answered: a page in server error counts as failed, a page asking for a login is a service that answers */
export function tryNote(name: string, t: TryResult): Note {
  if (!t.up) return { ok: false, text: tx("{0} ne répond pas ({1})", name, t.error ?? "?") };
  if (t.code === null) return { ok: !t.error, text: t.error ? tx("{0} : port ouvert, page web en erreur ({1})", name, t.error) : tx("{0} répond en {1} ms", name, t.ms ?? 0) };
  return { ok: t.code < 500, text: tx("{0} répond : code {1} en {2} ms", name, t.code, t.ms ?? 0) };
}

export const testService = (ip: string, port: number, scheme: string | undefined, name: string): Run => async () => {
  const web = scheme === "https" || scheme === "http" ? scheme : "tcp";
  return tryNote(name, await send<TryResult>("POST", "services/manual/try", { ip, port, scheme: web }));
};

export function RereadButton({ label, tip, run, compact = false, onNote, className }: Readonly<{ label: string; tip: string; run: Run; compact?: boolean; onNote?: (n: Note) => void; className?: string }>) {
  const [busy, setBusy] = useState(false), [own, setOwn] = useState<Note>(null);
  const say = onNote ?? setOwn;
  useEffect(() => {
    if (!own) return undefined;
    const t = setTimeout(() => setOwn(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [own]);
  const go = async () => {
    setBusy(true); say(null);
    try { say(await run()); pokeScan(); }
    catch (e) { if (e instanceof LoginRequired) location.replace(LOGIN); else say({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  const Icon = busy ? Loader2 : RefreshCw;
  const tint = own?.ok ? "text-ok" : "text-bad";
  return (
    <>
      <button type="button" disabled={busy} title={own?.text ?? tip} aria-label={label} onClick={(e) => { e.stopPropagation(); void go(); }}
        className={className ?? (compact ? "shrink-0 rounded-md p-1 text-muted hover:bg-link/10 hover:text-link" : quiet)}>
        <Icon size={14} className={`${busy ? "animate-spin" : ""} ${own ? tint : ""}`} aria-hidden />{!compact && label}
      </button>
      {own && <output className="sr-only">{own.text}</output>}
    </>
  );
}
