// Réglages → Sauvegardes → Synology : le compte (lecture seule) est celui du connecteur Synology DSM (Réglages → Connecteurs), rien
// n'est ressaisi ici. « Chercher » liste les tâches Hyper Backup sans rien enregistrer ; on coche celles à suivre, comme les jobs Veeam.
import { HardDrive, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { LOGIN, LoginRequired, send } from "../api";
import { Field, NoteLine } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { dateTime } from "../lib/format";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

export interface SynologyState { connectors: string[]; followed: number }
interface Task { key: string; name: string; last_run: number | null; result: string; next: number | null; target_type: string; followed: boolean }
interface Choice { on: boolean; label: string; age: string }

export function BackupsSynology({ state, reload }: { state: SynologyState; reload: () => void }) {
  const [name, setName] = useState(state.connectors[0] ?? "");
  const [tasks, setTasks] = useState<Task[] | null>(null), [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<"" | "search" | "follow">("");
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365);

  const search = async () => {
    setBusy("search"); setNote(null);
    try {
      const r = await send<{ tasks: Task[] }>("POST", "backups/synology/discover", { connector: name });
      setTasks(r.tasks);
      setPick(Object.fromEntries(r.tasks.filter((t) => !t.followed).map((t) => [t.key, { on: false, label: `Synology : ${t.name}`, age: "2" }])));
      if (r.tasks.length === 0) setNote({ ok: true, text: tx("Connexion réussie, mais aucune tâche Hyper Backup n'est visible pour ce compte (paquet absent ou droits insuffisants).") });
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  const follow = async () => {
    setBusy("follow");
    const items = chosen.map(([key, c]) => ({ key, label: c.label.trim(), max_age_days: Number(c.age) }));
    const ok = await act(() => send("PUT", "backups/synology", { connector: name, tasks: items }), tx("{0} tâche(s) suivie(s) : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite", items.length), setNote);
    setBusy("");
    if (ok) { setTasks(null); setPick({}); reload(); }
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><HardDrive size={16} />{tx("Synology (Hyper Backup)")}
        {state.followed > 0 && <Badge tone="ok">{tx("{0} tâche(s) suivie(s)", state.followed)}</Badge>}</h2>
      {state.connectors.length === 0 ? (
        <p className="text-sm text-muted">
          {tx("Aucun connecteur Synology DSM : ajoutez-le d'abord dans")} <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a>
          {tx(" (compte dédié, sans droit d'administration). Ses tâches Hyper Backup se suivent ensuite ici, sans ressaisir le compte.")}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {tx("MyServices lit les tâches Hyper Backup du NAS avec le compte du connecteur, en lecture seule : la date et le résultat du dernier passage de chaque tâche sont surveillés (un échec ou un retard déclenche une alerte).")}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {state.connectors.length > 1 && (
              <Field label={tx("Connecteur")}>
                <select className={input} value={name} onChange={(e) => { setName(e.target.value); setTasks(null); }}>
                  {state.connectors.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <button type="button" className={primary} disabled={!name || busy !== ""} onClick={() => void search()}>
              {busy === "search" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}{tx("Chercher les tâches")}
            </button>
          </div>
          {tasks && (
            <div className="mt-3 flex flex-col gap-2">
              {tasks.length > 0 && <ul className="flex flex-col gap-2">
                {tasks.map((t) => {
                  const c = pick[t.key];
                  return (
                    <li key={t.key} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${t.followed ? "opacity-60" : ""}`}>
                      <label className="flex min-w-[220px] flex-1 items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={t.followed} checked={!!c?.on} aria-label={t.name}
                          onChange={(e) => setPick({ ...pick, [t.key]: { ...c, on: e.target.checked } })} />
                        <span className="min-w-0">
                          <b className="break-all">{t.name}</b>{t.target_type && <Dim> · {t.target_type}</Dim>}
                          <span className="block text-xs text-dim">
                            {t.last_run ? `${tx("dernier passage")} ${dateTime(t.last_run * 1000)} (${t.result})` : tx("jamais lancée")}{t.next ? ` · ${tx("prochain")} ${dateTime(t.next * 1000)}` : ""}
                          </span>
                        </span>
                      </label>
                      {t.followed && <Badge tone="ok">{tx("déjà suivie")}</Badge>}
                      {c?.on && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input className={`${input} w-56 py-1 text-xs`} value={c.label} maxLength={80} aria-label={tx("Nom")}
                            onChange={(e) => setPick({ ...pick, [t.key]: { ...c, label: e.target.value } })} />
                          <label className="flex items-center gap-1 text-xs text-dim">{tx("alerte après")}
                            <input className={`${input} w-16 py-1 text-xs`} type="number" min={0.1} max={365} step="any" value={c.age} aria-label={tx("Âge maximum en jours")}
                              onChange={(e) => setPick({ ...pick, [t.key]: { ...c, age: e.target.value } })} />{tx("j")}
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
              {Object.keys(pick).length === 0 && tasks.length > 0 && <Dim>{tx("Toutes les tâches sont déjà suivies.")}</Dim>}
              <button type="button" className={`${quiet} self-start`} onClick={() => { setTasks(null); setPick({}); }}>{tx("Fermer la liste")}</button>
            </div>
          )}
        </>
      )}
      <NoteLine note={note} />
    </Card>
  );
}
