// Camera accounts of the Tapo connector, one row per camera. Saved as the one text connectors/tapo.py reads: « ip user password ; … »,
// so the configs already saved keep working. A saved value is never sent to the page: it is shown again with the account's password.
import { Lock, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { TapoDevice } from "../types";
import { RevealAsk, SecretInput } from "./SecretInput";

export interface CameraAccount { ip: string; user: string; password: string }

/** Rows of the saved text, like tapo._accounts: the password is the rest of the entry, spaces included */
export function parseAccounts(text: string): CameraAccount[] {
  return text.split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^(\S+)(?:\s+(\S+)(?:\s+(.+))?)?$/.exec(p);
    return { ip: m?.[1] ?? p, user: m?.[2] ?? "", password: m?.[3] ?? "" };
  });
}

/** The text to save: a row without its address, login and password is left out, as the connector would */
export const accountsText = (rows: CameraAccount[]) =>
  rows.map((r) => ({ ip: r.ip.trim(), user: r.user.trim(), password: r.password })).filter((r) => r.ip && r.user && r.password && !r.password.includes(";") && !/\s/.test(r.ip + r.user))
    .map((r) => `${r.ip} ${r.user} ${r.password}`).join("; ");

const incomplete = (r: CameraAccount) => !r.ip.trim() || !r.user.trim() || !r.password || /\s/.test(r.ip.trim() + r.user.trim());

export function CameraAccounts({ value, kept, reveal, devices, box, put }: Readonly<{
  value: string; kept: boolean; reveal?: (password: string) => Promise<string>; devices: TapoDevice[]; box: string; put: (v: string) => void;
}>) {
  const [rows, setRows] = useState<CameraAccount[] | null>(value || !kept ? parseAccounts(value) : null);   // null: saved, still hidden
  const [asking, setAsking] = useState(false), list = useId();
  const change = (next: CameraAccount[]) => { setRows(next); put(accountsText(next)); };
  if (!rows) return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-bg2 px-3 py-2 text-sm text-muted">
        <Lock size={14} aria-hidden />{tx("Comptes caméra enregistrés, cachés")}
        {reveal && <button type="button" className={quiet} onClick={() => setAsking(!asking)}>{tx("Afficher pour modifier")}</button>}
      </span>
      {asking && reveal && <RevealAsk reveal={reveal} onValue={(v) => setRows(parseAccounts(v))} />}
    </span>
  );
  const set = (i: number, part: Partial<CameraAccount>) => change(rows.map((r, j) => (j === i ? { ...r, ...part } : r)));
  const cams = devices.filter((d) => d.ip && (d.kind === "camera" || d.kind === "other"));
  return (
    <span className="flex flex-col gap-2">
      <datalist id={list}>{cams.map((d) => <option key={d.ip} value={d.ip}>{d.model || tx("modèle non annoncé")} · {d.name}</option>)}</datalist>
      {rows.map((r, i) => (
        <span key={i} className="flex flex-col gap-1">   {/* NOSONAR: rows have no id of their own, and are only added at the end or removed */}
          <span className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(10rem,1.3fr)_minmax(7rem,1fr)_minmax(8rem,1fr)_2.25rem]">
            <input className={`${box} col-span-2 font-mono sm:col-span-1`} list={list} value={r.ip} placeholder={tx("IP de la caméra")} aria-label={tx("IP de la caméra")}
              autoComplete="off" onChange={(e) => set(i, { ip: e.target.value })} />
            <input className={box} value={r.user} placeholder={tx("Identifiant")} aria-label={tx("Identifiant")} autoComplete="off" onChange={(e) => set(i, { user: e.target.value })} />
            <SecretInput className={box} value={r.password} placeholder={tx("Mot de passe")} onChange={(password) => set(i, { password })} />
            <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-bad/40 text-bad hover:bg-bad/10" title={tx("Retirer cette caméra")} aria-label={tx("Retirer cette caméra")}
              onClick={() => change(rows.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden /></button>
          </span>
          {incomplete(r) && <span className="text-xs text-warn">{tx("IP, identifiant et mot de passe requis, sans espace dans l'IP ni l'identifiant : sinon la ligne est ignorée.")}</span>}
          {r.password.includes(";") && <span className="text-xs text-warn">{tx("Un mot de passe ne peut pas contenir « ; » : changez-le dans l'appli Tapo.")}</span>}
        </span>
      ))}
      <button type="button" className={`${quiet} self-start`} onClick={() => setRows([...rows, { ip: "", user: "", password: "" }])}><Plus size={14} aria-hidden />{tx("Ajouter une caméra")}</button>
    </span>
  );
}
