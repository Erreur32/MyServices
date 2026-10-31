// Réglages → Sauvegardes → Proxmox Backup : le compte (jeton DatastoreAudit) est celui du connecteur Proxmox Backup Server
// (Réglages → Connecteurs), rien n'est ressaisi ici. « Chercher » liste les groupes (une VM, un conteneur ou un hôte par magasin)
// sans rien enregistrer ; on coche ceux à suivre, comme les jobs Veeam.
import { Loader2, Search, DatabaseBackup } from "lucide-react";
import { useState } from "react";
import { LOGIN, LoginRequired, send } from "../api";
import { Field, NoteLine } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { dateTime } from "../lib/format";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";

export interface PbsState { connectors: string[]; followed: number }
interface Group { key: string; store: string; type: string; id: string; last: number | null; count: number; comment: string; followed: boolean }
interface Choice { on: boolean; label: string; age: string }

export function BackupsPbs({ state, reload }: Readonly<{ state: PbsState; reload: () => void }>) {
  const [name, setName] = useState(state.connectors[0] ?? "");
  const [groups, setGroups] = useState<Group[] | null>(null), [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<"" | "search" | "follow">("");
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365);

  const search = async () => {
    setBusy("search"); setNote(null);
    try {
      const r = await send<{ groups: Group[] }>("POST", "backups/pbs/discover", { connector: name });
      setGroups(r.groups);
      setPick(Object.fromEntries(r.groups.filter((g) => !g.followed).map((g) => [g.key, { on: false, label: `Proxmox Backup : ${g.id}`, age: "2" }])));
      if (r.groups.length === 0) setNote({ ok: true, text: tx("Connexion réussie, mais aucun groupe de sauvegarde n'est visible pour ce jeton.") });
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  const follow = async () => {
    setBusy("follow");
    const items = chosen.map(([key, c]) => ({ key, label: c.label.trim(), max_age_days: Number(c.age) }));
    const ok = await act(() => send("PUT", "backups/pbs", { connector: name, groups: items }), tx("{0} groupe(s) suivi(s) : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite", items.length), setNote);
    setBusy("");
    if (ok) { setGroups(null); setPick({}); reload(); }
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><DatabaseBackup size={16} />{tx("Proxmox Backup Server")}
        {state.followed > 0 && <Badge tone="ok">{tx("{0} groupe(s) suivi(s)", state.followed)}</Badge>}</h2>
      {state.connectors.length === 0 ? (
        <InfoNote>
          {tx("Aucun connecteur Proxmox Backup Server : ajoutez-le d'abord dans")} <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a>
          {tx(" (jeton en lecture seule, rôle DatastoreAudit). Ses sauvegardes se suivent ensuite ici, sans ressaisir le compte.")}
        </InfoNote>
      ) : (
        <>
          <InfoNote className="mb-3">
            {tx("MyServices lit les groupes de sauvegarde (une VM, un conteneur ou un hôte par magasin) avec le jeton du connecteur, en lecture seule : l'âge de la dernière sauvegarde de chaque groupe est surveillé.")}
          </InfoNote>
          <div className="flex flex-wrap items-end gap-3">
            {state.connectors.length > 1 && (
              <Field label={tx("Connecteur")}>
                <select className={input} value={name} onChange={(e) => { setName(e.target.value); setGroups(null); }}>
                  {state.connectors.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <button type="button" className={primary} disabled={!name || busy !== ""} onClick={() => void search()}>
              {busy === "search" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}{tx("Chercher les groupes")}
            </button>
          </div>
          {groups && (
            <div className="mt-3 flex flex-col gap-2">
              {groups.length > 0 && <ul className="flex flex-col gap-2">
                {groups.map((g) => {
                  const c = pick[g.key];
                  return (
                    <li key={g.key} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${g.followed ? "opacity-60" : ""}`}>
                      <label className="flex min-w-[220px] flex-1 items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={g.followed} checked={!!c?.on} aria-label={`${g.type}/${g.id}`}
                          onChange={(e) => setPick({ ...pick, [g.key]: { ...c, on: e.target.checked } })} />
                        <span className="min-w-0">
                          <b className="break-all">{g.type}/{g.id}</b> <Dim>· {g.store}</Dim>
                          <span className="block text-xs text-dim">
                            {g.last ? `${tx("dernière sauvegarde")} ${dateTime(g.last * 1000)}` : tx("aucune sauvegarde")} · {g.count} {tx("gardée(s)")}{g.comment && ` · ${g.comment}`}
                          </span>
                        </span>
                      </label>
                      {g.followed && <Badge tone="ok">{tx("déjà suivi")}</Badge>}
                      {c?.on && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input className={`${input} w-56 py-1 text-xs`} value={c.label} maxLength={80} aria-label={tx("Nom")}
                            onChange={(e) => setPick({ ...pick, [g.key]: { ...c, label: e.target.value } })} />
                          <label className="flex items-center gap-1 text-xs text-dim">{tx("alerte après")}
                            <input className={`${input} w-16 py-1 text-xs`} type="number" min={0.1} max={365} step="any" value={c.age} aria-label={tx("Âge maximum en jours")}
                              onChange={(e) => setPick({ ...pick, [g.key]: { ...c, age: e.target.value } })} />{tx("j")}
                          </label>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>}
              {Object.keys(pick).length > 0 && (
                <div><button type="button" className={primary} disabled={!valid || busy !== ""} onClick={() => void follow()}>
                  {busy === "follow" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre la sélection")} {chosen.length > 0 && `(${chosen.length})`}</button></div>
              )}
              {Object.keys(pick).length === 0 && groups.length > 0 && <Dim>{tx("Tous les groupes sont déjà suivis.")}</Dim>}
              <button type="button" className={`${quiet} self-start`} onClick={() => { setGroups(null); setPick({}); }}>{tx("Fermer la liste")}</button>
            </div>
          )}
        </>
      )}
      <NoteLine note={note} />
    </Card>
  );
}
