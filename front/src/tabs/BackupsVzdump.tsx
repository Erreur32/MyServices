// Réglages → Sauvegardes → Proxmox VE (vzdump) : les dumps écrits par Proxmox VE sans Proxmox Backup Server, lus par SSH sur l'hôte
// (dossiers « dump » des stockages qui gardent des sauvegardes). Un jeu par machine invitée ; la copie (rsync vers un NAS…) se déclare
// ensuite comme pour un dossier, ou se trouve avec « Trouver les copies ».
import { Loader2, Search, Archive } from "lucide-react";
import { useState } from "react";
import { LOGIN, LoginRequired, send } from "../api";
import { NoteLine } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";

export interface VzdumpState { followed: number }
interface Group { dir: string; storage: string; network: boolean; kind: string; vmid: string; name: string; count: number; newest: number; newest_name: string; size: number; followed: boolean; suggested_age: number }
interface Host { ip: string; name: string; ok: boolean; error: string; groups: Group[] }
interface Choice { on: boolean; label: string; age: string }

const keyOf = (ip: string, g: Group) => `${ip}|${g.dir}|${g.kind}/${g.vmid}`;

export function BackupsVzdump({ state, reload }: { state: VzdumpState; reload: () => void }) {
  const [hosts, setHosts] = useState<Host[] | null>(null), [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<"" | "search" | "follow">("");
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365);
  const all = (hosts ?? []).flatMap((h) => h.groups.map((g) => ({ h, g })));

  const search = async () => {
    setBusy("search"); setNote(null);
    try {
      const r = await send<{ machines: Host[] }>("POST", "backups/vzdump/discover", {});
      setHosts(r.machines);
      setPick(Object.fromEntries(r.machines.flatMap((h) => h.groups.filter((g) => !g.followed).map((g) => [keyOf(h.ip, g),
        { on: false, label: `${h.name} : ${g.name || g.vmid} (${g.kind === "lxc" ? "CT" : "VM"} ${g.vmid})`.slice(0, 80), age: String(g.suggested_age) }]))));
      if (!r.machines.some((h) => h.ok)) setNote({ ok: true, text: tx("Aucun hôte Proxmox VE parmi les machines lues par SSH.") });
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  const follow = async () => {
    setBusy("follow");
    const items = all.filter(({ h, g }) => pick[keyOf(h.ip, g)]?.on).map(({ h, g }) => {
      const c = pick[keyOf(h.ip, g)];
      return { ip: h.ip, dir: g.dir, kind: g.kind, vmid: g.vmid, network: g.network, label: c.label.trim(), max_age_days: Number(c.age) };
    });
    const ok = await act(() => send("PUT", "backups/vzdump", { groups: items }), tx("{0} sauvegarde(s) suivie(s) : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite", items.length), setNote);
    setBusy("");
    if (ok) { setHosts(null); setPick({}); reload(); }
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Archive size={16} />{tx("Proxmox VE (vzdump)")}
        {state.followed > 0 && <Badge tone="ok">{tx("{0} machine(s) invitée(s) suivie(s)", state.followed)}</Badge>}</h2>
      <InfoNote className="mb-3">
        {tx("Les sauvegardes faites par Proxmox VE lui-même (vzdump, sans Proxmox Backup Server) sont lues par SSH sur l'hôte, en lecture seule : l'âge du dernier dump de chaque VM ou conteneur est surveillé. Une copie (rsync vers un NAS…) s'ajoute ensuite au jeu, ou se trouve avec « Trouver les copies ».")}
      </InfoNote>
      <button type="button" className={primary} disabled={busy !== ""} onClick={() => void search()}>
        {busy === "search" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}{tx("Chercher les dumps")}
      </button>
      {hosts && (
        <div className="mt-3 flex flex-col gap-3">
          {hosts.map((h) => (
            <div key={h.ip} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2 text-sm"><b>{h.name}</b><span className="font-mono text-xs text-dim">{h.ip}</span>
                {!h.ok && <Badge tone="warn">{tx("injoignable")}</Badge>}{h.error && <Dim>{h.error}</Dim>}</div>
              {h.ok && h.groups.length === 0 && <Dim>{tx("Aucun dump trouvé dans les stockages de sauvegarde.")}</Dim>}
              <ul className="flex flex-col gap-2">
                {h.groups.map((g) => {
                  const k = keyOf(h.ip, g), c = pick[k];
                  return (
                    <li key={k} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${g.followed ? "opacity-60" : ""}`}>
                      <label className="flex min-w-[220px] flex-1 items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={g.followed} checked={!!c?.on}
                          onChange={(e) => setPick({ ...pick, [k]: { ...c, on: e.target.checked } })} />
                        <span className="min-w-0">
                          <b>{g.kind === "lxc" ? "CT" : "VM"} {g.vmid}</b>{g.name && <> · {g.name}</>} <Dim>· {g.storage}</Dim>
                          {g.network && <> <Badge tone="info">{tx("stockage réseau")}</Badge></>}
                          <span className="block break-all font-mono text-xs text-dim">{g.dir}</span>
                          <span className="block text-xs text-dim">
                            {tx("dernière sauvegarde")} {dateTime(g.newest * 1000)} · {bytes(g.size)} · {g.count} {tx("gardée(s)")}
                          </span>
                        </span>
                      </label>
                      {g.followed && <Badge tone="ok">{tx("déjà suivi")}</Badge>}
                      {c?.on && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input className={`${input} w-56 py-1 text-xs`} value={c.label} maxLength={80} aria-label={tx("Nom")}
                            onChange={(e) => setPick({ ...pick, [k]: { ...c, label: e.target.value } })} />
                          <label className="flex items-center gap-1 text-xs text-dim">{tx("alerte après")}
                            <input className={`${input} w-16 py-1 text-xs`} type="number" min={0.1} max={365} step="any" value={c.age} aria-label={tx("Âge maximum en jours")}
                              onChange={(e) => setPick({ ...pick, [k]: { ...c, age: e.target.value } })} />{tx("j")}
                          </label>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {Object.keys(pick).length > 0 && (
            <div><button type="button" className={primary} disabled={!valid || busy !== ""} onClick={() => void follow()}>
              {busy === "follow" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre la sélection")} {chosen.length > 0 && `(${chosen.length})`}</button></div>
          )}
          {Object.keys(pick).length === 0 && all.length > 0 && <Dim>{tx("Tous les dumps sont déjà suivis.")}</Dim>}
          <button type="button" className={`${quiet} self-start`} onClick={() => { setHosts(null); setPick({}); }}>{tx("Fermer la liste")}</button>
        </div>
      )}
      <NoteLine note={note} />
    </Card>
  );
}
