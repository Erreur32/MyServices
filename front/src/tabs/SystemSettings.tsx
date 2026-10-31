// Réglages, sections sur le même état : « Tâches et
// horaires » (Surveillance : modifiables, lancer maintenant) et « Sauvegarde et informations » (export de la configuration,
// version de l'image et lien vers la dernière publiée, chemins, tailles).
import { Activity, Bell, Check, Clock, ExternalLink, HardDrive, HeartPulse, Loader2, Pause, Play, Radar, RefreshCw, RotateCcw, Server, ShieldCheck, Timer, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { NoteLine, Switch } from "../components/form";
import { act, button, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim, type Tone } from "../components/ui";
import { bytes, dateTime, dur, hm } from "../lib/format";
import type { SystemState, SystemTask } from "../types";
import { usePoll } from "../lib/polling";
import { useHeaderTask } from "../lib/headerTasks";
import { useStoredFlag } from "../lib/storedFlag";
import { tx } from "../lib/i18n";
import { GITHUB, releaseOf } from "../lib/links";
import { groupOf, inText, liveText, parseAt, period, runLength, runState, summarize, TASK_GROUPS, type RunState } from "../lib/tasks";
import { pokeScan } from "../lib/scan";
import { AutoDiscoveries, DISCOVERED_BY } from "../components/AutoDiscoveries";
import { useDiscoveries } from "../components/DiscoveryCard";
import { MailSettings } from "../components/MailSettings";
import { ConfigTransfer } from "../components/ConfigTransfer";
import { ScheduleHelp } from "../components/ScheduleHelp";
import { OtherSchedules } from "../components/OtherSchedules";

export function SystemSettings({ part, snap }: Readonly<{ part: "mail" | "export" | "info" | "tasks"; snap: Snapshot }>) {
  const [st, setSt] = useState<SystemState | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    read<SystemState>("system")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  usePoll(reload, st?.tasks.some((t) => t.running) ? 10_000 : 60_000);   // 10 s seulement pour suivre une tâche lancée
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {part === "tasks" && <><Tasks tasks={st.tasks} netscan={st.netscan} beat={st.scheduler?.beat ?? null} reload={reload} /><OtherSchedules /><AutoDiscoveries machines={snap.data.machine_list} /></>}
      {part === "mail" && <MailSettings />}
      {part === "export" && <ConfigTransfer />}
      {part === "info" && <Info info={st.info} />}
    </div>
  );
}

/** Aligned columns from one row to the next: task, editable schedule, next run, button */
const ROW_COLS = "lg:grid lg:grid-cols-[minmax(0,1fr)_18rem_9rem_11rem]";
const ICON: Record<string, LucideIcon> = { collect: RefreshCw, watch: Bell, health: HeartPulse, backups: HardDrive, netscan: Radar, pulse: Activity };
const DESC: Record<string, string> = {
  collect: tx("Lit les machines, Docker, NPM et les connecteurs, puis met les pages à jour."),
  watch: tx("Compare au passage précédent : services tombés, nouveaux ou disparus, et envoie les alertes."),
  health: tx("Disques, services, mises à jour et SMART de chaque machine, lus par SSH."),
  backups: tx("Âge du dernier fichier de chaque sauvegarde suivie, et de ses copies."),
  netscan: tx("Cherche les nouveaux appareils sur le réseau."),
};
const desc = (name: string) => DESC[name] ?? "";

/** One look per state: the icon and the word carry it, the colour only backs it up */
const STATE_VIEW: Record<RunState, { tone: Tone; Icon: LucideIcon; label: () => string }> = {
  running: { tone: "info", Icon: Loader2, label: () => tx("en cours") },
  failed: { tone: "bad", Icon: TriangleAlert, label: () => tx("échec") },
  ok: { tone: "ok", Icon: Check, label: () => tx("réussi") },
  disabled: { tone: "off", Icon: Pause, label: () => tx("coupée") },
  idle: { tone: "off", Icon: Clock, label: () => tx("en attente") },
};
const ROW_STYLE: Record<RunState, string> = {
  running: "border-l-link bg-link/5", failed: "border-l-bad bg-bad/5", ok: "border-l-transparent", idle: "border-l-transparent", disabled: "border-l-transparent opacity-70",
};
/** Dark title band of a card, as in the other cards (flush with the card edges) */
const STRIP = "-mx-4 -mt-4 mb-3 rounded-t-2xl border-b border-line/60 bg-bg px-4 py-3";
const rowClass = (s: RunState) => `border-l-4 px-3 py-3 text-sm ${ROW_STYLE[s]}`;

function StateBadge({ state }: Readonly<{ state: RunState }>) {
  const { tone, Icon, label } = STATE_VIEW[state];
  return (
    <Badge tone={tone} title={state === "idle" ? tx("pas encore passé depuis le démarrage") : undefined}>
      <Icon size={12} aria-hidden className={state === "running" ? "motion-safe:animate-spin" : ""} />{label()}
    </Badge>
  );
}

function TaskIcon({ name, state }: Readonly<{ name: string; state: RunState }>) {
  const Icon = ICON[name] ?? Timer;
  return (
    <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-lg ${state === "disabled" ? "bg-bg2 text-dim" : "bg-link/15 text-link"}`}>
      {state === "running" && <span className="absolute inset-0 rounded-lg ring-2 ring-link/60 motion-safe:animate-pulse" aria-hidden />}
      <Icon size={16} aria-hidden />
    </span>
  );
}

/** Left part of every row: icon, name, state, short description and the last run */
function TaskHead({ name, title, state, badge, note, extra, about, children }: Readonly<{
  name: string; title: string; state: RunState; badge?: ReactNode; note: Note; extra?: ReactNode; about: ReactNode; children?: ReactNode;
}>) {
  return (
    <div className="flex min-w-[220px] gap-3">
      <TaskIcon name={name} state={state} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b>{title}</b>
          {badge ?? <StateBadge state={state} />}
          <NoteLine inline note={note} />
          {extra}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">{about}</p>
        {children}
      </div>
    </div>
  );
}

function Tasks({ tasks, netscan, beat, reload }: Readonly<{ tasks: SystemTask[]; netscan: SystemState["netscan"]; beat: number | null; reload: () => void }>) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const ago = beat ? Math.max(0, Math.round(now / 1000 - beat)) : null, alive = ago !== null && ago < 90;   // the loop turns every 5 s
  const sections: Record<string, ReactNode[]> = {};
  const add = (group: string, row: ReactNode) => {
    sections[group] ??= [];
    sections[group].push(row);
  };
  const [edit, setEdit] = useStoredFlag("myservices.tasks.edit", false);   // the schedules as words by default; the fields behind « Edit the schedules »
  tasks.forEach((t) => add(groupOf(t.name), <TaskRow key={t.name} t={t} now={now} reload={reload} edit={edit} />));
  if (netscan) add(groupOf("netscan"), <NetscanRow key="netscan" n={netscan} now={now} reload={reload} edit={edit} />);
  if (edit) add(groupOf("live"), <LiveChecksRow key="live" />);
  return <>
    <TasksHeader tasks={tasks} netscan={netscan} ago={ago} alive={alive} now={now} edit={edit} setEdit={setEdit} />
    {TASK_GROUPS.filter((g) => sections[g.id]?.length).map((g) => (
      <Card key={g.id}>
        <h3 className={`${STRIP} text-xs font-bold uppercase tracking-wider text-muted`}>{g.title()}</h3>
        <div className={`mb-1 hidden items-center gap-x-4 border-b border-line px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-dim ${ROW_COLS}`} aria-hidden>
          <span>{tx("Tâche")}</span><span>{tx("Horaire")}</span><span>{tx("Prochain passage")}</span><span />
        </div>
        <ul className="flex flex-col divide-y divide-line/60" aria-label={g.title()}>{sections[g.id]}</ul>
      </Card>
    ))}
  </>;
}

/** Title, scheduler heartbeat and a one-line summary: how many tasks are on, which one is running or failed, which is next */
function TasksHeader({ tasks, netscan, ago, alive, now, edit, setEdit }: Readonly<{ tasks: SystemTask[]; netscan: SystemState["netscan"]; ago: number | null; alive: boolean; now: number; edit: boolean; setEdit: (on: boolean) => void }>) {
  const items = netscan ? [...tasks, { name: "netscan", label: tx("Recherche réseau"), enabled: netscan.enabled, running: netscan.running, result: netscan.ended ? "success" : null, next: netscan.next }] : tasks;
  const sum = summarize(items), label = items.find((t) => t.name === sum.next?.name)?.label;
  return (
    <Card tone={alive ? undefined : "bad"}>
      <div className={`${STRIP} flex flex-wrap items-center gap-2`}>
        <h2 className="flex items-center gap-2 font-bold"><Timer size={16} aria-hidden />{tx("Tâches et horaires")}</h2>
        <ScheduleHelp />
        <Badge tone={alive ? "ok" : "bad"} title={alive ? tx("Vérifié il y a {0} s. Il lance chaque tâche à son horaire, comme une crontab.", ago) : tx("Plus aucun tour depuis {0} s : redémarrez le conteneur.", ago ?? "?")}>
          {alive ? <span className="h-1.5 w-1.5 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
          {alive ? tx("planificateur actif") : tx("planificateur arrêté")}</Badge>
        <button type="button" aria-pressed={edit} onClick={() => setEdit(!edit)} className={`${quiet} ml-auto py-1 text-xs`} title={tx("Les horaires, les réseaux parcourus par la recherche et les contrôles vivants : à changer rarement")}>
          <Clock size={13} aria-hidden />{edit ? tx("Fermer les réglages") : tx("Modifier les horaires")}</button>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted" aria-live="polite">
        <span>{tx("{0} tâche(s) active(s) sur {1}", sum.enabled, items.length)}</span>
        {sum.running > 0 && <Badge tone="info"><Loader2 size={12} aria-hidden className="motion-safe:animate-spin" />{tx("{0} en cours", sum.running)}</Badge>}
        {sum.failed > 0 && <Badge tone="bad"><TriangleAlert size={12} aria-hidden />{tx("{0} en échec", sum.failed)}</Badge>}
        {sum.next && <span>{tx("prochaine : {0}, {1} ({2})", label ?? sum.next.name, hm(sum.next.at * 1000), inText(sum.next.at * 1000 - now))}</span>}
      </p>
      {!alive && (
        <p className="mt-3 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm">
          <b>{tx("Les horaires ne sont pas appliqués :")}</b> {tx("le planificateur intégré au conteneur (l'équivalent d'une crontab) ne tourne plus, aucune tâche ne part à son heure. Rien à activer : redémarrez le conteneur MyServices. Si le message revient, regardez Réglages → Journaux. En attendant, « Exécuter maintenant » marche toujours.")}
        </p>
      )}
    </Card>
  );
}

/** Next run in its own column: the time, then how long until it (or how long it has been running); the full date on hover */
function NextRun({ on, t, now }: Readonly<{ on: boolean; t: { running: boolean; started: number | null; next: number | null }; now: number }>) {
  const when = on && t.next !== null && !t.running;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 lg:block lg:pt-1" title={when ? dateTime(t.next! * 1000) : undefined}>
      <span className="text-xs text-dim lg:hidden">{tx("Prochain passage")}</span>
      {when ? (
        <span className="flex items-baseline gap-2 tabular-nums lg:flex-col lg:gap-0">
          <b className="font-mono text-sm">{hm(t.next! * 1000)}</b>
          <span className="text-xs text-dim">{inText(t.next! * 1000 - now)}</span>
        </span>
      ) : <span className="text-xs tabular-nums text-muted lg:block lg:pt-1">{on ? liveText(t, now) : tx("coupée")}</span>}
    </div>
  );
}

/** What a task also discovers (the Discovery entries it runs), as small tags: one place for each scheduled job */
function AlsoFinds({ task }: Readonly<{ task: string }>) {
  const [disc] = useDiscoveries();
  const ids = DISCOVERED_BY[task] ?? [];
  const found = (disc?.items ?? []).filter((x) => ids.includes(x.id));
  if (!found.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-dim">
      <span title={tx("Découvertes mises à jour par cette tâche (page Découverte)")}>{tx("alimente aussi :")}</span>
      {found.map((x) => <span key={x.id} className="rounded-md border border-line bg-bg2/60 px-1.5 py-0.5 text-muted" title={x.what}>{SHORT_FIND[x.id] ?? x.title}</span>)}
    </span>
  );
}
const SHORT_FIND: Record<string, string> = { services: tx("services et ports"), new: tx("nouveaux services"), connectors: tx("applis à activer"), network: tx("machines du réseau"), cron: tx("tâches cron de sauvegarde") };

/** Last run in one line: when, how long, and the error of a failed run; the run state lives in memory, so a restart starts it over */
function LastRun({ t }: Readonly<{ t: Pick<SystemTask, "running" | "result" | "started" | "ended"> }>) {
  const failed = !!t.result && t.result !== "success" && !t.running;
  let last: string | null = null;
  if (t.ended && t.started) last = `${tx("dernier :")} ${dateTime(t.ended * 1000)} (${runLength(t.started, t.ended)})`;
  else if (!t.running) last = tx("pas encore passé depuis le démarrage");
  if (!last && !failed) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-dim">
      {last && <span>{last}</span>}
      {failed && <span className="font-semibold text-bad">{t.result}</span>}
    </div>
  );
}

function RunButton({ label, busy, disabled, onRun }: Readonly<{ label: string; busy: boolean; disabled?: boolean; onRun: () => void }>) {
  return (
    <div className="flex items-start lg:justify-end">
      <button type="button" className={`${button} h-9 min-w-[7rem] justify-center border-link/50 bg-link/10 text-txt hover:border-link hover:bg-link/20 active:scale-[0.98] motion-safe:transition`}
        disabled={disabled || busy} aria-busy={busy} aria-label={tx("Lancer {0} maintenant", label)}
        title={tx("Lance la tâche tout de suite, une fois, sans attendre l'horaire ; l'horaire ne change pas")} onClick={onRun}>
        {busy ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden /> : <Play size={14} className="fill-current" aria-hidden />}{busy ? tx("En cours") : tx("Lancer")}
      </button>
    </div>
  );
}

function HeaderSwitch({ task }: Readonly<{ task: string }>) {
  const [on, set] = useHeaderTask(task);
  return <p className="mt-1 flex items-center gap-2 text-xs text-muted"><Switch on={on} onChange={set} label={tx("Afficher dans l'en-tête")} />{tx("Afficher dans l'en-tête")}</p>;
}

function TaskRow({ t, now, reload, edit }: Readonly<{ t: SystemTask; now: number; reload: () => void; edit: boolean }>) {
  const [at, setAt] = useState(t.at), [note, setNote] = useState<Note>(null);
  const parsed = parseAt(at), changed = at.trim() !== t.at, state = runState(t);
  const save = (spec: string, done: string) => void act(() => send("PUT", `system/tasks/${t.name}/schedule`, { at: spec }), done, setNote).then((ok) => { if (ok) { if (!spec) setAt(t.default); reload(); } });
  return (
    <li className={rowClass(state)}>
      <div className={`flex flex-wrap items-start gap-x-4 gap-y-2 ${ROW_COLS}`}>
        <TaskHead name={t.name} title={t.label} state={state} note={note}
          about={<><span>{!t.enabled && t.why ? t.why : desc(t.name)}</span><AlsoFinds task={t.name} /></>}>
          {t.enabled && <LastRun t={t} />}
          <HeaderSwitch task={t.name} />
        </TaskHead>
        <div>
          <span className="mb-1 block text-xs text-dim lg:hidden">{tx("Horaire")}</span>
          {!edit && <p className="text-sm">{parsed ? period(parsed) : t.at}{t.at !== t.default && <Dim> · {tx("modifié")}</Dim>}</p>}
          {edit && <>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (parsed) save(at.trim(), tx("horaire enregistré")); }}>
            <input className={`${input} h-9 w-36 font-mono ${parsed ? "" : "border-bad"}`} value={at} disabled={t.fixed} onChange={(e) => setAt(e.target.value)} aria-label={tx("Horaire de {0}", t.label)}
              aria-invalid={!parsed} title={t.fixed ? tx("fixé par la variable d'environnement du conteneur") : tx("défaut : {0}", t.default)} />
            {!t.fixed && changed && <button type="submit" className={`${primary} h-9`} disabled={!parsed}>{tx("Enregistrer")}</button>}
            {!t.fixed && !changed && t.at !== t.default && (
              <button type="button" className={`${quiet} h-9`} title={tx("Revenir au défaut : {0}", t.default)} aria-label={tx("Revenir au défaut : {0}", t.default)}
                onClick={() => save("", tx("horaire par défaut"))}><RotateCcw size={14} aria-hidden /></button>
            )}
          </form>
          <p className={`mt-1 text-xs ${parsed ? "text-dim" : "text-bad"}`}>
            {parsed ? period(parsed) : tx("format attendu : minutes (0-59) puis heures (0-23 ou *), séparées par des virgules")}
          </p>
          {t.fixed && <p className="mt-0.5 text-xs text-dim">{tx("Fixé par MYSERVICES_")}{t.name.toUpperCase()}{tx("_AT dans le compose.")}</p>}
          </>}
        </div>
        <NextRun on={t.enabled} t={{ running: t.running, started: t.started, next: t.next ?? null }} now={now} />
        <RunButton label={t.label} busy={t.running} disabled={!t.enabled}
          onRun={() => void act(() => send("POST", `system/tasks/${t.name}/run`), tx("lancée : son état se met à jour ici"), setNote).then((ok) => ok && reload())} />
      </div>
    </li>
  );
}

interface LiveCfg { values: Record<LiveKey, number>; defaults: Record<LiveKey, number>; limits: Record<LiveKey, [number, number]>; off_allowed: LiveKey[] }
type LiveKey = "pulse_every" | "pulse_confirm" | "ports_every" | "fast_every";
const LIVE_FIELDS: { key: LiveKey; label: string; unit: string; hint: string }[] = [
  { key: "pulse_every", label: tx("Pouls (ping des machines)"), unit: "s", hint: tx("Un ping de chaque machine suivie : l'état en ligne ou hors ligne est vivant. 0 = coupé.") },
  { key: "pulse_confirm", label: tx("Pouls à confirmer"), unit: "×", hint: tx("Nombre de pouls de suite avant d'annoncer qu'une machine est tombée ou revenue (un paquet perdu ne compte pas).") },
  { key: "ports_every", label: tx("Pouls (port des services)"), unit: "s", hint: tx("Une connexion au port de chaque service web : une panne se voit sans attendre deux collectes. Les erreurs 5xx et les sites publics restent vus à la collecte. 0 = coupé.") },
  { key: "fast_every", label: tx("Lecture des connecteurs"), unit: "s", hint: tx("Le serveur lit chaque connecteur à cette période, sauf ceux qui ont la leur (Réglages → Connecteurs, « Lecture toutes les »). La collecte, la santé et la page réutilisent ce relevé. 0 = coupé : chaque tâche lit elle-même.") },
];

/** Settings of the live checks: the ping of every machine and the light connector reads (PUT system/live-checks, applied at the next pass) */
function LiveChecksRow() {
  const [cfg, setCfg] = useState<LiveCfg | null>(null), [draft, setDraft] = useState<Record<string, string>>({}), [note, setNote] = useState<Note>(null);
  const load = useCallback(() => { read<LiveCfg>("system/live-checks").then((c) => { setCfg(c); setDraft({}); }).catch(() => undefined); }, []);
  useEffect(load, [load]);
  if (!cfg) return null;
  const valueOf = (k: LiveKey) => draft[k] ?? String(cfg.values[k]);
  const okValue = (k: LiveKey) => { const v = Number(valueOf(k)), [lo, hi] = cfg.limits[k]; return valueOf(k) !== "" && Number.isInteger(v) && ((v >= lo && v <= hi) || (v === 0 && cfg.off_allowed.includes(k))); };
  const changed = LIVE_FIELDS.filter((f) => Number(valueOf(f.key)) !== cfg.values[f.key]);
  const valid = LIVE_FIELDS.every((f) => okValue(f.key));
  const live = cfg.values.pulse_every > 0 || cfg.values.ports_every > 0 || cfg.values.fast_every > 0;
  const save = (body: Partial<Record<LiveKey, number>>) => void act(() => send("PUT", "system/live-checks", body), tx("enregistré"), setNote).then((ok) => { if (ok) load(); });
  return (
    <li className={rowClass(live ? "ok" : "disabled")}>
      <TaskHead name="pulse" title={tx("Vérifications en direct")} state={live ? "ok" : "disabled"} note={note}
        badge={<Badge tone={live ? "ok" : "off"}>{live ? <Check size={12} aria-hidden /> : <Pause size={12} aria-hidden />}{live ? tx("actif") : tx("coupée")}</Badge>}
        about={<span>{tx("Ping de chaque machine, port de chaque service et lectures légères des connecteurs, entre deux collectes : les changements se voient en quelques minutes au plus.")}</span>} />
      <form className="mt-3 grid gap-3 rounded-lg bg-bg2/50 p-3 md:ml-11 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); if (valid && changed.length) save(Object.fromEntries(changed.map((f) => [f.key, Number(valueOf(f.key))]))); }}>
        {LIVE_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs font-semibold text-muted">{f.label}
            <span className="flex items-center gap-1.5">
              <input className={`${input} h-9 w-24 font-mono ${okValue(f.key) ? "" : "border-bad"}`} type="number" step={1} value={valueOf(f.key)}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} title={tx("défaut : {0}", cfg.defaults[f.key])} />
              <span className="font-normal text-dim">{f.unit}</span>
              {cfg.values[f.key] !== cfg.defaults[f.key] && !draft[f.key] && (
                <button type="button" className={`${quiet} h-9`} title={tx("Revenir au défaut : {0}", cfg.defaults[f.key])} aria-label={tx("Revenir au défaut : {0}", cfg.defaults[f.key])}
                  onClick={() => save({ [f.key]: cfg.defaults[f.key] })}><RotateCcw size={14} aria-hidden /></button>
              )}
            </span>
            <span className="font-normal text-dim">{f.hint}</span>
          </label>
        ))}
        {changed.length > 0 && <div className="md:col-span-3"><button type="submit" className={`${primary} h-9`} disabled={!valid}>{tx("Enregistrer")}</button></div>}
      </form>
    </li>
  );
}

interface NetCfg { every_h: number; default_h: number; max_h: number; fixed: boolean; nets: string[]; discreet: boolean }

/** The network search runs every N hours: the same setting as Discovery (PUT network/settings), so both pages stay in step */
function NetscanRow({ n, now, reload, edit }: Readonly<{ n: NonNullable<SystemState["netscan"]>; now: number; reload: () => void; edit: boolean }>) {
  const state = runState({ enabled: n.enabled, running: n.running, result: n.ended ? "success" : null });
  const [cfg, setCfg] = useState<NetCfg | null>(null), [hostNet, setHostNet] = useState("");
  const [hours, setHours] = useState(""), [nets, setNets] = useState<string | null>(null), [note, setNote] = useState<Note>(null);
  const load = useCallback(() => {
    read<NetCfg>("network/settings").then((c) => { setCfg(c); setHours(String(c.every_h)); }).catch(() => undefined);
    read<{ net?: string }>("network/scan").then((x) => setHostNet(x.net ?? "")).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  const h = Number(hours), valid = !!cfg && hours !== "" && Number.isInteger(h) && h >= 0 && h <= cfg.max_h;
  const save = (value: number) => void act(() => send("PUT", "network/settings", { every_h: value }), value ? tx("enregistré : toutes les {0} h", value) : tx("enregistré : recherche automatique coupée"), setNote)
    .then((ok) => { if (ok) { load(); reload(); } });
  const netsText = nets ?? cfg?.nets.join(", ") ?? "", netsList = netsText.split(/[\s,;]+/).filter(Boolean);
  const saveNets = () => void act(() => send("PUT", "network/settings", { nets: netsList }), netsList.length ? tx("réseaux enregistrés") : tx("réseau de la machine hôte"), setNote)
    .then((ok) => { if (ok) { setNets(null); load(); } });
  const saveDiscreet = (on: boolean) => void act(() => send("PUT", "network/settings", { discreet: on }), on ? tx("mode discret activé") : tx("mode discret coupé"), setNote).then(() => load());
  return (
    <li className={rowClass(state)}>
      <div className={`flex flex-wrap items-start gap-x-4 gap-y-2 ${ROW_COLS}`}>
        <TaskHead name="netscan" title={tx("Recherche réseau")} state={state} note={note} about={<><span>{desc("netscan")}</span><AlsoFinds task="netscan" /></>}>
          {n.enabled && <LastRun t={{ running: n.running, result: null, started: n.started, ended: n.ended }} />}
          <HeaderSwitch task="netscan" />
        </TaskHead>
        <div>
          <span className="mb-1 block text-xs text-dim lg:hidden">{tx("Horaire")}</span>
          {!edit && cfg && <p className="text-sm">{cfg.every_h ? tx("toutes les {0} h", cfg.every_h) : tx("coupée")}{cfg.nets.length > 0 && <Dim> · {cfg.nets.join(", ")}</Dim>}{cfg.discreet && <Dim> · {tx("mode discret")}</Dim>}</p>}
          {edit && <>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) save(h); }}>
            <span className="flex items-center gap-1.5">
              <input className={`${input} h-9 w-20 font-mono ${valid || hours === "" ? "" : "border-bad"}`} type="number" min={0} max={cfg?.max_h} step={1} value={hours}
                disabled={!cfg || cfg.fixed} onChange={(e) => setHours(e.target.value)} aria-label={tx("Fréquence (heures, 0 = coupée)")}
                title={cfg?.fixed ? tx("fixée par la variable d'environnement du conteneur") : tx("défaut : {0}", cfg?.default_h ?? "?")} />
              <span className="text-xs text-dim">h</span>
            </span>
            {cfg && !cfg.fixed && h !== cfg.every_h && <button type="submit" className={`${primary} h-9`} disabled={!valid}>{tx("Enregistrer")}</button>}
            {cfg && !cfg.fixed && h === cfg.every_h && cfg.every_h !== cfg.default_h && (
              <button type="button" className={`${quiet} h-9`} title={tx("Revenir au défaut : {0}", cfg.default_h)} aria-label={tx("Revenir au défaut : {0}", cfg.default_h)}
                onClick={() => save(cfg.default_h)}><RotateCcw size={14} aria-hidden /></button>
            )}
          </form>
          <p className={`mt-1 text-xs ${valid || hours === "" ? "text-dim" : "text-bad"}`}>
            {!valid && hours !== "" ? tx("Un nombre entier de 0 à {0}.", cfg?.max_h ?? "?") : h === 0 ? tx("coupée") : tx("toutes les {0} h", h)}
          </p>
          {cfg?.fixed && <p className="mt-0.5 text-xs text-dim">{tx("Fixée par MYSERVICES_NETSCAN_EVERY dans le compose.")}</p>}
          </>}
        </div>
        <NextRun on={n.enabled} t={n} now={now} />
        <RunButton label={tx("Recherche réseau")} busy={n.running}
          onRun={() => void act(async () => { await send("POST", "network/scan"); pokeScan(); }, tx("recherche lancée"), setNote).then(() => reload())} />
      </div>
      {cfg && edit && (   /* what the search reads: the networks and the discreet mode, behind « Edit the schedules » */
        <div className="mt-3 grid gap-4 rounded-lg bg-bg2/50 p-3 md:ml-11 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); saveNets(); }}>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">{tx("Réseaux à parcourir")}
              <span className="flex flex-wrap gap-2">
                <input className={`${input} h-9 min-w-[200px] flex-1 font-mono`} value={netsText} placeholder={hostNet || "192.168.1.0/24"} onChange={(e) => setNets(e.target.value)} />
                {nets !== null && <button type="submit" className={`${primary} h-9`}>{tx("Enregistrer")}</button>}
                {nets === null && cfg.nets.length > 0 && <button type="button" className={`${quiet} h-9`} onClick={() => setNets("")}>{tx("Revenir au réseau de l'hôte")}</button>}
              </span>
            </label>
            <p className="text-xs text-dim">{tx("Par défaut, le réseau de la machine hôte. Plusieurs possibles (un /24 au plus chacun), séparés par une virgule.")}</p>
          </form>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted"><ShieldCheck size={14} aria-hidden />{tx("Mode discret")}
              <Switch on={cfg.discreet} onChange={saveDiscreet} label={tx("Mode discret")} /></span>
            <p className="text-xs text-dim">{tx("Ne lit ni le TTL du ping ni l'adresse MAC : le système des machines n'est alors plus deviné par là.")}</p>
          </div>
        </div>
      )}
    </li>
  );
}

/** One group of the information card: a small title and a list of label / value lines */
function InfoGroup({ title, icon: Icon, children }: Readonly<{ title: string; icon: LucideIcon; children: ReactNode }>) {
  return (
    <section className="rounded-xl border border-line/70 bg-bg/40 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted"><Icon size={13} aria-hidden />{title}</h3>
      <dl className="flex flex-col divide-y divide-line/50 text-sm">{children}</dl>
    </section>
  );
}

function InfoLine({ label, children }: Readonly<{ label: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-dim">{label}</dt>
      <dd className="m-0 min-w-0 text-right">{children}</dd>
    </div>
  );
}

const LINK = "inline-flex items-center gap-1 text-link hover:underline";

function Info({ info }: Readonly<{ info: SystemState["info"] }>) {
  const release = releaseOf(info.version);
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-bold"><Server size={16} aria-hidden />{tx("Informations")}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <InfoGroup title={tx("Application")} icon={Server}>
          <InfoLine label={tx("Version")}><code className="font-mono text-xs">{info.version}</code></InfoLine>
          <InfoLine label={tx("Dernière publiée")}>
            <span className="flex flex-wrap justify-end gap-x-3">
              {release && <a className={LINK} href={release.url} target="_blank" rel="noopener noreferrer">{tx("Notes de {0}", release.tag)}<ExternalLink size={12} aria-hidden /></a>}
              <a className={LINK} href={`${GITHUB}/releases/latest`} target="_blank" rel="noopener noreferrer">{tx("Voir la dernière version")}<ExternalLink size={12} aria-hidden /></a>
            </span>
          </InfoLine>
          <InfoLine label={tx("Démarré")}><span title={dateTime(info.started * 1000)}>{tx("depuis {0}", dur(info.uptime_s))}</span></InfoLine>
          <InfoLine label={tx("Python")}>{info.python}</InfoLine>
        </InfoGroup>
        <InfoGroup title={tx("Accès et sécurité")} icon={ShieldCheck}>
          <InfoLine label={tx("Port")}><code className="font-mono text-xs">{info.port}</code></InfoLine>
          <InfoLine label={tx("Comptes")}>{info.auth ? <Badge tone="ok">{tx("connexion requise")}</Badge> : <Badge tone="warn">{tx("coupés (MYSERVICES_AUTH=0)")}</Badge>}</InfoLine>
          <InfoLine label={tx("Cookies Secure")}>{info.cookie_secure ? <Badge tone="ok">{tx("oui")}</Badge> : <Badge tone="off">{tx("non (HTTP direct)")}</Badge>}</InfoLine>
          <InfoLine label={tx("Réseaux autorisés")}><span className="break-words font-mono text-xs">{info.allow.join(", ")}</span></InfoLine>
        </InfoGroup>
        <InfoGroup title={tx("Stockage")} icon={HardDrive}>
          <InfoLine label={<code className="font-mono text-xs">{info.paths.config}</code>}>{bytes(info.sizes.config)}</InfoLine>
          <InfoLine label={<code className="font-mono text-xs">{info.paths.data}</code>}>{bytes(info.sizes.data)}</InfoLine>
          <InfoLine label={tx("Base (comptes, historique, alertes)")}>{bytes(info.sizes.db)}</InfoLine>
        </InfoGroup>
      </div>
    </Card>
  );
}
