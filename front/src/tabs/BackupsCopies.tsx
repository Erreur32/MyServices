// Réglages → Sauvegardes : « copié ailleurs ». Un dossier suivi n'est sûr que s'il existe une copie à jour sur une autre machine :
// on la déclare ici (machine + dossier), et MyServices compare ensuite la copie à la source à chaque relevé (archive manquante ou en retard).
// « Trouver les copies » cherche sur les machines, partages réseau compris, la dernière archive de chaque dossier suivi : rien n'est relié sans clic.
import { Copy, FolderSearch, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { send } from "../api";
import { Badge, Dim } from "../components/ui";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

export interface CopyRow { index: number; host: string; path: string; offsite: boolean }
export interface SshMachine { ip: string; name: string }
export interface CopyGuess { set_id: string; set_label: string; ip: string; name: string; path: string; archive: string; network: boolean; offsite: boolean }
interface Folder { path: string; readable: boolean }
export interface FoundFolders { ip: string; ok: boolean; folders: Folder[] }

const pill = (on: boolean) =>
  `rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`;

/** Copies of one followed folder: list, remove, and a small form to add one (machine as pills, folder typed or picked from the search) */
export function SetCopies({ setId, origin, copies, machines, found, busy, onDone, setNote }: {
  setId: string; origin: string; copies: CopyRow[]; machines: SshMachine[]; found: FoundFolders[] | null; busy: boolean;
  onDone: () => void; setNote: (n: Note) => void;
}) {
  const [adding, setAdding] = useState(false), [ip, setIp] = useState(""), [path, setPath] = useState(""), [saving, setSaving] = useState(false);
  const offsite = copies.filter((c) => c.offsite).length;
  const folders = (found ?? []).find((m) => m.ip === ip)?.folders.filter((f) => f.readable) ?? [];
  const add = async () => {
    setSaving(true);
    const ok = await act(() => send("POST", `backups/settings/${setId}/copies`, { ip, path: path.trim() }), tx("copie déclarée : comparaison avec la source en cours"), setNote);
    setSaving(false);
    if (ok) { setAdding(false); setIp(""); setPath(""); onDone(); }
  };
  const remove = async (index: number) => {
    if (await act(() => send("DELETE", `backups/settings/${setId}/copies/${index}`), tx("copie retirée"), setNote)) onDone();
  };
  return (
    <div className="mt-2 border-t border-line/60 pt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-semibold text-muted"><Copy size={13} aria-hidden />{tx("Copié ailleurs")}</span>
        {copies.length === 0 && <span className="text-warn">{tx("aucune copie déclarée")}</span>}
        {copies.length > 0 && offsite === 0 && <span className="text-warn">{tx("aucune copie sur une autre machine")}</span>}
        {copies.map((c) => (
          <span key={c.index} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg2 px-2 py-0.5">
            <b className="font-semibold">{c.host}</b><code className="font-mono text-[11px] text-dim">{c.path}</code>
            {!c.offsite && <Badge tone="off">{tx("même machine")}</Badge>}
            <button type="button" className="text-dim hover:text-bad" disabled={busy} onClick={() => void remove(c.index)} aria-label={tx("Retirer la copie {0}", c.path)} title={tx("Retirer cette copie")}><Trash2 size={12} /></button>
          </span>
        ))}
        {!adding && <button type="button" className={`${quiet} ml-auto px-2 py-0.5 text-xs`} disabled={busy} onClick={() => setAdding(true)}><Plus size={12} />{tx("Ajouter une copie")}</button>}
      </div>
      {adding && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-bg2/60 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-dim">{tx("Machine")}</span>
            {machines.map((m) => (
              <button key={m.ip} type="button" aria-pressed={ip === m.ip} className={pill(ip === m.ip)} onClick={() => setIp(m.ip)}
                title={m.name === origin ? tx("Même machine que la source : ne compte pas comme copie hors machine") : m.ip}>{m.name}</button>
            ))}
            <button type="button" className="ml-auto text-dim hover:text-txt" onClick={() => setAdding(false)} aria-label={tx("Annuler")}><X size={14} /></button>
          </div>
          {ip && (
            <>
              <input className={`${input} py-1 font-mono text-xs`} value={path} maxLength={300} placeholder={tx("Dossier de la copie, ex. /volume1/backup/{0}", origin.toLowerCase())}
                aria-label={tx("Dossier de la copie")} onChange={(e) => setPath(e.target.value)} />
              {folders.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5"><Dim>{tx("trouvés sur cette machine :")}</Dim>
                  {folders.slice(0, 12).map((f) => <button key={f.path} type="button" className={pill(path === f.path)} onClick={() => setPath(f.path)}><code className="font-mono">{f.path}</code></button>)}
                </span>
              )}
              <div><button type="button" className={`${primary} py-1 text-xs`} disabled={saving || !path.trim().startsWith("/")} onClick={() => void add()}>
                {saving && <Loader2 size={12} className="animate-spin" aria-hidden />}{tx("Déclarer cette copie")}</button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** « Find the copies »: looks on every machine (network shares included) for the newest archive of each followed folder ; one click links */
export function CopyGuesses({ onDone, setNote }: { onDone: () => void; setNote: (n: Note) => void }) {
  const [list, setList] = useState<CopyGuess[] | null>(null), [why, setWhy] = useState(""), [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [searching, setSearching] = useState(false), [busy, setBusy] = useState(""), [hidden, setHidden] = useState<string[]>([]);
  const key = (c: CopyGuess) => `${c.set_id}|${c.ip}|${c.path}`;
  const shown = (list ?? []).filter((c) => !hidden.includes(key(c)));
  const search = async () => {
    setSearching(true);
    try {
      const r = await send<{ copies: CopyGuess[]; reason?: string; errors?: { name: string; error: string }[] }>("POST", "backups/copies/find");
      setList(r.copies); setWhy(r.reason ?? ""); setErrors(r.errors ?? []); setHidden([]);
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
    setSearching(false);
  };
  const link = async (c: CopyGuess) => {
    setBusy(key(c));
    const ok = await act(() => send("POST", `backups/settings/${c.set_id}/copies`, { ip: c.ip, path: c.path, network: c.network }), tx("copie reliée : comparaison avec la source en cours"), setNote);
    setBusy("");
    if (ok) { setHidden([...hidden, key(c)]); onDone(); }
  };
  return (
    <div className="mb-3 rounded-lg border border-line/70 bg-bg2/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={14} className="text-link" aria-hidden /><b>{tx("Trouver les copies")}</b>
        <Dim>{tx("cherche sur vos machines, partages réseau (NAS) compris, la dernière archive de chaque dossier suivi")}</Dim>
        <button type="button" className={`${quiet} ml-auto py-1 text-xs`} disabled={searching} onClick={() => void search()}>
          {searching ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <FolderSearch size={12} aria-hidden />}{searching ? tx("Recherche… (jusqu'à une minute)") : tx("Chercher")}</button>
      </div>
      {list && shown.length === 0 && <p className="mt-2 text-xs text-dim">{why || tx("Aucune copie trouvée. Si la copie est ailleurs (autre NAS, cloud…), déclarez-la à la main sur le jeu.")}</p>}
      {errors.length > 0 && <p className="mt-1 text-xs text-warn">{tx("Non lues : {0}", errors.map((e) => e.name).join(", "))}</p>}
      {shown.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {shown.map((c) => (
            <li key={key(c)} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg2/70 px-2.5 py-1.5 text-xs">
              <b>{c.set_label}</b><span className="text-dim">→</span>
              <span><b>{c.name}</b> <code className="font-mono">{c.path}</code></span>
              {c.network && <Badge tone="off">{tx("partage réseau")}</Badge>}
              {!c.offsite && <Badge tone="off">{tx("même machine")}</Badge>}
              <Dim>{tx("contient {0}", c.archive)}</Dim>
              <span className="ml-auto flex gap-1.5">
                <button type="button" className={`${primary} py-0.5 text-xs`} disabled={busy === key(c)} onClick={() => void link(c)}>{tx("Relier")}</button>
                <button type="button" className={`${quiet} py-0.5 text-xs`} onClick={() => setHidden([...hidden, key(c)])}>{tx("Ignorer")}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
