// « + Service »: declare a service by hand (a page the detection did not see, a machine without SSH or agent, a port to probe).
// Name, machine (followed, or a free IP), port, scheme (http, https, or tcp for a port alone), « Try » probes without saving,
// « Follow » writes it; the same window edits a declared service. The collection then probes it like any other service.
import { Loader2, PenLine, Radar, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { send } from "../api";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { Host, Machine } from "../types";
import { NoteLine } from "./form";
import { InfoNote } from "./InfoNote";
import { Badge, Card } from "./ui";

export interface ManualInitial { name: string; ip: string; port: number; scheme: string }
interface TryResult { up: boolean; ms: number | null; web: "ui" | "api" | null; title: string | null; code: number | null; error: string | null }

const SCHEMES: { v: string; label: string; hint: string }[] = [
  { v: "http", label: "http", hint: tx("page web en clair") }, { v: "https", label: "https", hint: tx("page web chiffrée") }, { v: "tcp", label: tx("port seul"), hint: tx("pas de page : la connexion suffit") },
];

/** What « Try » found: reachable (and the page, for http or https) or not */
function TryResultView({ tried, scheme }: Readonly<{ tried: TryResult; scheme: string }>) {
  if (!tried.up) return <Badge tone="bad">{tx("injoignable ({0})", tried.error ?? "?")}</Badge>;
  let web: ReactNode = null;
  if (scheme !== "tcp") {
    web = tried.web
      ? <span className="text-muted">{tried.web === "ui" ? tx("page web") : tx("répond en HTTP, sans page")}{tried.title ? ` · ${tried.title}` : ""}{tried.code ? ` · HTTP ${tried.code}` : ""}</span>
      : <span className="text-warn">{tx("port ouvert mais pas de réponse HTTP ({0})", tried.error ?? "?")}</span>;
  }
  return <span className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="ok">{tx("répond en {0} ms", tried.ms)}</Badge>{web}</span>;
}

/** The target: a followed machine from the list, or a free IP typed in */
function TargetField({ machines, ip, setIp, custom, setCustom, locked }: Readonly<{ machines: Machine[]; ip: string; setIp: (v: string) => void; custom: boolean; setCustom: (v: boolean) => void; locked: boolean }>) {
  if (custom || !machines.length) {
    return (
      <span className="flex gap-2"><input className={`${input} font-mono`} value={ip} disabled={locked} placeholder={tx("adresse IP")} onChange={(e) => setIp(e.target.value)} />
        {machines.length > 0 && !locked && <button type="button" className={`${quiet} shrink-0`} onClick={() => setCustom(false)}>{tx("Une machine suivie")}</button>}</span>
    );
  }
  return (
    <span className="flex gap-2"><select className={input} value={ip} disabled={locked} onChange={(e) => setIp(e.target.value)}>
        <option value="">{tx("choisir…")}</option>{machines.map((m) => <option key={m.ip} value={m.ip}>{m.name} · {m.ip}</option>)}</select>
      {!locked && <button type="button" className={`${quiet} shrink-0`} onClick={() => { setCustom(true); setIp(""); }}>{tx("Autre IP")}</button>}</span>
  );
}

/** In the detail of a service declared by hand: edit it (the window above) or stop following it, with a confirmation */
export function ManualActions({ r, onEdit }: Readonly<{ r: Host; onEdit?: () => void }>) {
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
  const remove = () => void act(() => send("DELETE", `services/manual/${r.ip}/${r.port}`), tx("service retiré : il disparaît au relevé en cours"), setNote).then((ok) => ok && setConfirm(false));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg2/40 px-3 py-2 text-sm">
      <span className="text-muted">{tx("Déclaré à la main : sondé à chaque relevé, jamais lu sur la machine.")}</span>
      <span className="ml-auto flex flex-wrap gap-2">
        {onEdit && <button type="button" className={`${quiet} py-1`} onClick={onEdit}><PenLine size={14} aria-hidden />{tx("Modifier")}</button>}
        {confirm ? <>
          <button type="button" className={`${danger} py-1`} onClick={remove}>{tx("Confirmer le retrait")}</button>
          <button type="button" className={`${quiet} py-1`} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
        </> : <button type="button" className={`${quiet} py-1`} onClick={() => setConfirm(true)}><Trash2 size={14} aria-hidden />{tx("Retirer")}</button>}
      </span>
      <NoteLine note={note} />
    </div>
  );
}

export function ManualService({ machines, initial, onDone, onClose }: Readonly<{ machines: Machine[]; initial?: ManualInitial; onDone: () => void; onClose: () => void }>) {
  const [name, setName] = useState(initial?.name ?? ""), [ip, setIp] = useState(initial?.ip ?? ""), [port, setPort] = useState(initial ? String(initial.port) : "");
  const [scheme, setScheme] = useState(initial?.scheme ?? "http"), [custom, setCustom] = useState(!!initial && !machines.some((m) => m.ip === initial.ip));
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [trying, setTrying] = useState(false), [tried, setTried] = useState<TryResult | null>(null);
  const p = Number(port), ok = name.trim().length > 0 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim()) && Number.isInteger(p) && p >= 1 && p <= 65535;
  const tryIt = async () => {
    setTrying(true); setTried(null);
    try { setTried(await send<TryResult>("POST", "services/manual/try", { ip: ip.trim(), port: p, scheme })); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    setTrying(false);
  };
  const save = async () => {
    setBusy(true);
    const body = { name: name.trim(), ip: ip.trim(), port: p, scheme };
    const done = initial ? act(() => send("PUT", `services/manual/${initial.ip}/${initial.port}`, { name: body.name, scheme, port: p }), tx("service modifié : relevé en cours"), setNote)
      : act(() => send("POST", "services/manual", body), tx("service déclaré : relevé en cours, il apparaît ensuite dans la liste"), setNote);
    const okSaved = await done;
    setBusy(false);
    if (okSaved) { onDone(); onClose(); }
  };
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-bold"><PenLine size={16} aria-hidden />{initial ? tx("Modifier le service") : tx("Déclarer un service")}</h2>
      <div className="mt-3 flex flex-col gap-3">
        <InfoNote>{tx("Pour un service que la détection ne voit pas : une page sur une machine sans SSH ni agent, un appareil, un port à surveiller. Il est sondé à chaque relevé comme les autres (joignable ou non, page web, titre).")}</InfoNote>
        <label className="flex flex-col gap-1 text-sm text-muted">{tx("Nom")}
          <input className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={tx("ex. Imprimante, NAS, Caméra salon")} /></label>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
          <label className="flex flex-col gap-1 text-sm text-muted">{tx("Machine ou adresse IP")}
            <TargetField machines={machines} ip={ip} setIp={setIp} custom={custom} setCustom={setCustom} locked={!!initial} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">{tx("Port")}
            <input className={`${input} font-mono`} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm text-muted">{tx("Protocole")}
            <select className={input} value={scheme} onChange={(e) => setScheme(e.target.value)}>{SCHEMES.map((s) => <option key={s.v} value={s.v}>{s.label} · {s.hint}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={quiet} disabled={!ok || trying} onClick={() => void tryIt()}>{trying ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Radar size={14} aria-hidden />}{tx("Essayer")}</button>
          {tried && <TryResultView tried={tried} scheme={scheme} />}
          <span className="ml-auto flex gap-2">
            <button type="button" className={quiet} onClick={onClose}>{tx("Annuler")}</button>
            <button type="button" className={primary} disabled={!ok || busy} onClick={() => void save()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{initial ? tx("Enregistrer") : tx("Suivre")}</button>
          </span>
        </div>
        <NoteLine note={note} />
      </div>
    </Card>
  );
}
