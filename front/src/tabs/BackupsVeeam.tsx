// Réglages → Sauvegardes → Veeam : assistant en trois temps. On saisit l'adresse de l'API REST (9419) et un compte en lecture
// seule, on essaie la connexion SANS rien enregistrer, on cherche les jobs, puis on coche ceux à suivre (même logique que les
// dossiers). Le mot de passe n'est enregistré (chiffré) qu'au moment de « Suivre » ; il n'est jamais renvoyé par le serveur.
import { Laptop, Loader2, PlugZap, Search, ServerCog } from "lucide-react";
import { useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Field, NoteLine } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { SecretInput } from "../components/SecretInput";
import { InfoNote } from "../components/InfoNote";
import type { MachinesSettings, VeeamObject } from "../types";

export interface VeeamState { configured: boolean; url: string; user: string; password_set: boolean }
interface Job {
  name: string; type: string; status: string; last_result: string; last_run: number | null; disabled: boolean; followed: boolean;
  objects: VeeamObject[];   // what the job backs up, with the machine each one is
  set_label?: string; max_age_days?: number | null;   // a followed job: its set, sent back as it is when only the machines change
}
interface Repo { name: string; type: string; size_gb: number | null; free_gb: number | null }
// copyOf: the job a Backup Copy job copies ("" = a set of its own); machines: object name -> machine IP ("" = none), only the ones changed by hand
interface Choice { on: boolean; label: string; age: string; copyOf: string; machines?: Record<string, string> }
type Names = Record<string, string>;   // machine IP -> name
const AUTO = "auto";
const OBJECT_COLS = "grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,14rem)] items-center gap-x-3";   // name, where it runs, size, machine   // select value: the machine found by name (or none found)

const chosenOf = (j: Job): Record<string, string> =>
  Object.fromEntries(j.objects.filter((o) => o.machine_by === "chosen").map((o) => [o.name, o.machine ?? ""]));

const isCopy = (j: Job) => /copy/i.test(j.type);

/** What a job backs up, each one with its machine: the one found by name, another chosen here, or none. */
function ObjectMachines({ job, c, names, set }: Readonly<{ job: Job; c: Choice; names: Names; set: (c: Choice) => void }>) {
  const pick = (name: string, v: string) => {
    const others = Object.entries(c.machines ?? {}).filter(([k]) => k !== name);   // the choice of the other objects stays
    set({ ...c, machines: Object.fromEntries(v === AUTO ? others : [...others, [name, v]]) });
  };
  return (
    <div className="ml-6 flex w-full flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-dim">{tx("Sauvegarde {0} élément(s)", job.objects.length)}</span>
      <div className={`${OBJECT_COLS} gap-y-1.5 text-xs`}>
        {job.objects.map((o) => {
          const found = o.machine_by === "chosen" ? null : o.machine, mine = c.machines ?? {};
          return (
            <ObjectLine key={o.name} o={o}>
              <select className={`${input} py-1 text-xs ${found || o.name in mine ? "" : "text-warn"}`} aria-label={tx("Machine de {0}", o.name)}
                value={o.name in mine ? mine[o.name] : AUTO} onChange={(e) => pick(o.name, e.target.value)}>
                <option value={AUTO}>{found ? tx("{0} (par le nom)", names[found] ?? found) : tx("aucune trouvée : choisir…")}</option>
                <option value="">{tx("aucune machine")}</option>
                {Object.entries(names).map(([ip, n]) => <option key={ip} value={ip}>{n} · {ip}</option>)}
              </select>
            </ObjectLine>
          );
        })}
      </div>
    </div>
  );
}

/** One backed up object: name, where it runs, size and restore points, then what is shown for its machine. */
function ObjectLine({ o, children }: Readonly<{ o: VeeamObject; children: React.ReactNode }>) {
  return (
    <>
      <span className="truncate font-mono" title={o.name}>{o.name}</span>
      <span className="text-dim">{o.host ? tx("sur {0}", o.host) : o.type}</span>
      <span className="whitespace-nowrap text-dim">{[o.size ? bytes(o.size) : "", o.points == null ? "" : tx("{0} point(s)", o.points)].filter(Boolean).join(" · ")}</span>
      {children}
    </>
  );
}

/** A followed job's objects and their machines, read only. */
function ObjectsFollowed({ job, names }: Readonly<{ job: Job; names: Names }>) {
  return (
    <div className={`ml-6 w-full ${OBJECT_COLS} gap-y-1 text-xs`}>
      {job.objects.map((o) => (
        <ObjectLine key={o.name} o={o}>
          <span className={o.machine ? "text-dim" : "text-warn"}>
            {o.machine ? `→ ${names[o.machine] ?? o.machine}` : tx("aucune machine")}
            {o.machine_by === "name" && <span className="text-dim"> ({tx("par le nom")})</span>}
          </span>
        </ObjectLine>
      ))}
    </div>
  );
}

/** Name and alert threshold of a chosen job or run. */
function ChoiceFields({ c, set }: Readonly<{ c: Choice; set: (c: Choice) => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${input} w-56 py-1 text-xs`} value={c.label} maxLength={80} aria-label={tx("Nom")} onChange={(e) => set({ ...c, label: e.target.value })} />
      <label className="flex items-center gap-1 text-xs text-dim">{tx("alerte après")}
        <input className={`${input} w-16 py-1 text-xs`} type="number" min={0.1} max={365} step="any" value={c.age} aria-label={tx("Âge maximum en jours")}
          onChange={(e) => set({ ...c, age: e.target.value })} />{tx("j")}
      </label>
    </div>
  );
}

export function BackupsVeeam({ state, reload }: Readonly<{ state: VeeamState; reload: () => void }>) {
  const [url, setUrl] = useState(state.url), [user, setUser] = useState(state.user), [password, setPassword] = useState("");
  const [jobs, setJobs] = useState<Job[] | null>(null), [repos, setRepos] = useState<Repo[]>([]);
  const [pick, setPick] = useState<Record<string, Choice>>({});
  const [change, setChange] = useState(false);   // compte déjà réglé (ici ou dans Connecteurs) : repris tel quel, formulaire seulement à la demande
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<"" | "test" | "search" | "follow">("");
  const [names, setNames] = useState<Names>({});
  useEffect(() => {
    read<MachinesSettings>("machines/settings")
      .then((st) => setNames(Object.fromEntries(Object.entries(st.machines).map(([ip, m]) => [ip, m.name || ip]).sort((a, b) => a[1].localeCompare(b[1])))))
      .catch(() => undefined);   // no list: the machine found by name is still shown, by its address
  }, []);
  const account = { url: url.trim(), user: user.trim(), password };
  const filled = account.url !== "" && account.user !== "" && (password !== "" || state.password_set);
  const fail = (e: unknown) => { if (e instanceof LoginRequired) location.replace(LOGIN); else setNote({ ok: false, text: (e as Error).message }); };

  const test = async () => {
    setBusy("test"); setNote(null);
    try {
      const r = await send<{ ok: boolean; message: string }>("POST", "backups/veeam/test", account);
      setNote({ ok: r.ok, text: r.message });
    } catch (e) { fail(e); }
    setBusy("");
  };
  const search = async () => {
    setBusy("search"); setNote(null);
    try {
      const r = await send<{ jobs: Job[]; repos: Repo[] }>("POST", "backups/veeam/discover", account);
      setJobs(r.jobs); setRepos(r.repos);
      setPick(Object.fromEntries(r.jobs.filter((j) => !j.followed).map((j) => [j.name, { on: false, label: `Veeam : ${j.name}`, age: "2", copyOf: "", machines: {} }])));
      if (r.jobs.length === 0) setNote({ ok: true, text: tx("Connexion réussie, mais aucun job n'est visible pour ce compte.") });
    } catch (e) { fail(e); }
    setBusy("");
  };
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.copyOf || (c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365));
  // jobs a copy can be attached to: the backup jobs already followed or chosen now
  const copied = (jobs ?? []).filter((j) => !isCopy(j) && (j.followed || pick[j.name]?.on)).map((j) => j.name);
  // a followed job: only its machines change, its set keeps its name and threshold
  const editMachines = (j: Job) => setPick({ ...pick, [j.name]: { on: true, label: j.set_label ?? `Veeam : ${j.name}`, age: String(j.max_age_days ?? 2), copyOf: "", machines: chosenOf(j) } });
  const follow = async () => {
    setBusy("follow");
    const items = chosen.map(([name, c]) => (c.copyOf ? { name, copy_of: c.copyOf } : { name, label: c.label.trim(), max_age_days: Number(c.age), machines: c.machines ?? {} }));
    const ok = await act(() => send("PUT", "backups/veeam", { ...account, jobs: items }), tx("{0} job(s) suivi(s) : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite", items.length), setNote);
    setBusy("");
    if (ok) { setJobs(null); setPick({}); setPassword(""); reload(); }
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><ServerCog size={16} />{tx("Veeam Backup & Replication")}
        {state.configured && <Badge tone="ok">{tx("compte enregistré")}</Badge>}</h2>
      <InfoNote className="mb-3">
        {tx("MyServices lit l'API REST de Veeam (port 9419, pas 9392) avec un compte au seul rôle « Veeam Backup Viewer » : il ne peut ni lancer ni modifier un job. Le mot de passe est chiffré et n'est jamais réaffiché.")}
      </InfoNote>
      {state.configured && state.password_set && !change ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-dim">{tx("Compte du connecteur :")}</span><b>{state.user}</b><Dim>· {state.url}</Dim>
          <button type="button" className={quiet} onClick={() => setChange(true)}>{tx("Changer le compte")}</button>
          <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tx("Adresse du serveur Veeam")}>
            <input className={input} value={url} placeholder="https://192.168.1.50:9419" onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={tx("Compte (lecture seule)")}>
            <input className={input} value={user} placeholder="DOMAINE\myservices" onChange={(e) => setUser(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={tx("Mot de passe")}>
            <SecretInput value={password} onChange={setPassword} autoComplete="new-password"
              placeholder={state.password_set ? tx("enregistré : laisser vide pour le garder") : ""} />
          </Field>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={!filled || busy !== ""} onClick={() => void test()}>
          {busy === "test" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <PlugZap size={14} aria-hidden />}{tx("Tester la connexion")}
        </button>
        <button type="button" className={primary} disabled={!filled || busy !== ""} onClick={() => void search()}>
          {busy === "search" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}{tx("Chercher les jobs")}
        </button>
      </div>
      <InfoNote className="mt-1">{tx("L'essai et la recherche n'enregistrent rien : le compte n'est gardé que lorsque vous suivez des jobs.")}</InfoNote>
      {jobs && (
        <div className="mt-3 flex flex-col gap-2">
          {jobs.length > 0 && <ul className="flex flex-col gap-2">
            {jobs.map((j) => {
              const c = pick[j.name];
              return (
                <li key={j.name} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${j.followed && !c ? "opacity-60" : ""}`}>
                  <label className="flex min-w-[220px] flex-1 items-start gap-2">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={j.followed} checked={!!c?.on} aria-label={j.name}
                      onChange={(e) => setPick({ ...pick, [j.name]: { ...c, on: e.target.checked } })} />
                    <span className="min-w-0">
                      <b className="break-all">{j.name}</b>
                      <span className="block text-xs text-dim">
                        {j.type || "-"} · {j.last_run ? `${tx("dernier passage")} ${dateTime(j.last_run * 1000)} (${j.last_result || "?"})` : tx("jamais lancé")}
                      </span>
                    </span>
                  </label>
                  {j.followed ? <Badge tone="ok">{tx("déjà suivi")}</Badge> : j.disabled && <Badge tone="warn">{tx("job désactivé")}</Badge>}
                  {j.followed && j.objects.length > 0 && !c && (
                    <button type="button" className={quiet} onClick={() => editMachines(j)}>{tx("Modifier les machines")}</button>
                  )}
                  {c?.on && isCopy(j) && (
                    <label className="flex items-center gap-1 text-xs text-dim">{tx("copie de")}
                      <select className={`${input} w-48 py-1 text-xs`} value={c.copyOf} aria-label={tx("Job copié")}
                        onChange={(e) => setPick({ ...pick, [j.name]: { ...c, copyOf: e.target.value } })}>
                        <option value="">{tx("aucun : jeu séparé")}</option>
                        {copied.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  )}
                  {c?.on && !c.copyOf && !j.followed && <ChoiceFields c={c} set={(v) => setPick({ ...pick, [j.name]: v })} />}
                  {c?.on && !c.copyOf && j.objects.length > 0 && <ObjectMachines job={j} c={c} names={names} set={(v) => setPick({ ...pick, [j.name]: v })} />}
                  {j.followed && !c && j.objects.length > 0 && <ObjectsFollowed job={j} names={names} />}
                </li>
              );
            })}
          </ul>}
          {repos.length > 0 && (
            <p className="text-xs text-dim">
              {tx("Dépôts lus (leur espace libre est suivi automatiquement) :")}{" "}
              {repos.map((r) => `${r.name}${r.size_gb ? ` (${Math.round(r.free_gb ?? 0)} / ${Math.round(r.size_gb)} Go)` : ""}`).join(", ")}
            </p>
          )}
          {Object.keys(pick).length > 0 && (
            <div><button type="button" className={primary} disabled={!valid || busy !== ""} onClick={() => void follow()}>
              {busy === "follow" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre la sélection")} {chosen.length > 0 && `(${chosen.length})`}</button></div>
          )}
          {Object.keys(pick).length === 0 && jobs.length > 0 && <Dim>{tx("Tous les jobs sont déjà suivis.")}</Dim>}
        </div>
      )}
      <NoteLine note={note} />
      <AgentBackups reload={reload} />
    </Card>
  );
}

interface AgentRun { ip: string; machine: string; tool: string; last_run: number | null; ok: boolean; warn: boolean; followed: boolean }

/** The outcome of an agent run: failed, with warnings or succeeded */
function runOutcome(r: AgentRun): string {
  if (!r.ok) return tx("échec");
  return r.warn ? tx("avertissements") : tx("réussi");
}

// Veeam Agent (and Windows Server Backup) on a PC followed by its MyServices agent: the last run comes with each report, no account needed
function AgentBackups({ reload }: Readonly<{ reload: () => void }>) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null), [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const key = (r: AgentRun) => `${r.ip}|${r.tool}`;
  const search = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await read<{ runs: AgentRun[] }>("backups/agents/discover");
      setRuns(r.runs);
      setPick(Object.fromEntries(r.runs.filter((x) => !x.followed).map((x) => [key(x), { on: false, label: `${x.machine} : ${x.tool}`, age: "2", copyOf: "" }])));
      if (r.runs.length === 0) setNote({ ok: true, text: tx("Aucun agent Windows n'a encore vu de sauvegarde Veeam Agent ou Windows Server.") });
    } catch (e) { if (e instanceof LoginRequired) location.replace(LOGIN); else setNote({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365);
  const follow = async () => {
    setBusy(true);
    const items = chosen.map(([k, c]) => { const [ip, tool] = k.split("|"); return { ip, tool, label: c.label.trim(), max_age_days: Number(c.age) }; });
    const ok = await act(() => send("PUT", "backups/agents", { runs: items }), tx("{0} sauvegarde(s) suivie(s) : premier relevé en cours", items.length), setNote);
    setBusy(false);
    if (ok) { setRuns(null); setPick({}); reload(); }
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1 flex items-center gap-2 font-semibold"><Laptop size={15} />{tx("Veeam Agent pour Windows (agents MyServices)")}</h3>
      <InfoNote className="mb-2">{tx("Un PC suivi par l'agent MyServices envoie le résultat de sa dernière sauvegarde Veeam Agent (ou Sauvegarde Windows Server) : aucun compte à saisir. L'agent ne dit pas où la sauvegarde est écrite : aucune copie ailleurs n'est exigée.")}</InfoNote>
      <button type="button" className={quiet} disabled={busy} onClick={() => void search()}>
        {busy && !runs ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />}{tx("Chercher dans les relevés des agents")}
      </button>
      {runs && runs.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {runs.map((r) => {
            const k = key(r), c = pick[k];
            return (
              <li key={k} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${r.followed ? "opacity-60" : ""}`}>
                <label className="flex min-w-[220px] flex-1 items-start gap-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={r.followed} checked={!!c?.on} aria-label={`${r.machine} ${r.tool}`}
                    onChange={(e) => setPick({ ...pick, [k]: { ...c, on: e.target.checked } })} />
                  <span className="min-w-0">
                    <b>{r.machine}</b> <Dim>· {r.tool}</Dim>
                    <span className="block text-xs text-dim">
                      {r.last_run ? `${tx("dernier passage")} ${dateTime(r.last_run * 1000)} (${runOutcome(r)})` : tx("jamais lancé")}
                    </span>
                  </span>
                </label>
                {r.followed && <Badge tone="ok">{tx("déjà suivi")}</Badge>}
                {c?.on && <ChoiceFields c={c} set={(v) => setPick({ ...pick, [k]: v })} />}
              </li>
            );
          })}
        </ul>
      )}
      {chosen.length > 0 && (
        <div className="mt-2"><button type="button" className={primary} disabled={!valid || busy} onClick={() => void follow()}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre la sélection")} ({chosen.length})</button></div>
      )}
      <NoteLine note={note} />
    </div>
  );
}
