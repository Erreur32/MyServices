// Cadre de l'accueil, sous les compteurs : la date et l'heure en direct, puis les tâches planifiées (collecte, veille, santé,
// sauvegardes, recherche réseau) avec leur prochain passage ou leur durée en cours. Une tâche coupée n'y figure pas.
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { LoginRequired, read } from "../api";
import { hm, longDay } from "../lib/format";
import { LOCALE, tx } from "../lib/i18n";
import { detail, liveText, shortName, type TaskInfo } from "../lib/tasks";

const IDLE_MS = 5_000, RUN_MS = 1_500;

/** The collection task (next run, running), read every 30 s, with a clock for its countdown: for « not read yet » states */
export function useCollectTask(): { task: TaskInfo | null; now: number } {
  const [task, setTask] = useState<TaskInfo | null>(null), [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => { if (!document.hidden) read<Record<string, TaskInfo>>("tasks").then((t) => setTask(t.collect ?? null)).catch(() => undefined); };
    load();
    const poll = setInterval(load, 30_000), clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, []);
  return { task, now };
}

export function ScheduleCard() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo> | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let busy = false;
      if (!document.hidden) {
        try {
          const t = await read<Record<string, TaskInfo>>("tasks");
          if (stop) return;
          setTasks(t);
          busy = Object.values(t).some((x) => x.running);
        } catch (e) {
          if (e instanceof LoginRequired) return;  // la page recharge déjà vers la connexion
        }
      }
      if (!stop) timer = setTimeout(() => void tick(), busy ? RUN_MS : IDLE_MS);
    };
    void tick();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearTimeout(timer); clearInterval(clock); };
  }, []);
  // soonest first; a task running stays on top
  const active = Object.entries(tasks ?? {}).filter(([, t]) => t.enabled)
    .sort(([, a], [, b]) => Number(b.running) - Number(a.running) || (a.next ?? Infinity) - (b.next ?? Infinity));
  return (
    <section className="rounded-xl border border-line border-l-4 border-l-muted bg-card p-3" aria-label={tx("Date et tâches planifiées")}>
      <a href="#settings/tasks" className="flex items-center justify-between gap-2 text-txt no-underline hover:text-link" title={tx("Ouvrir Tâches et horaires")}>
        <b className="flex min-w-0 items-center gap-2 text-sm">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2"><Clock size={14} className="text-muted" aria-hidden /></span>
          <span className="truncate capitalize">{longDay(now)}</span>
        </b>
        <span className="shrink-0 font-mono text-sm tabular-nums text-muted">{new Date(now).toLocaleTimeString(LOCALE)}</span>
      </a>
      {active.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {active.map(([name, t]) => (
            <li key={name} className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto_5.5rem] items-center gap-2 rounded-lg bg-bg2 px-2 py-1 text-xs" title={detail(t)}>
              <span className={`h-1.5 w-1.5 rounded-full ${t.running ? "animate-pulse bg-link" : "bg-ok"}`} />
              <b className="truncate font-semibold text-txt">{shortName(name, t)}</b>
              <When t={t} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Time of the next run and how long until it, in two aligned columns; a running task says since when */
function When({ t, now }: Readonly<{ t: TaskInfo; now: number }>) {
  if (t.running) return <span className="col-span-2 text-right tabular-nums text-link">{liveText(t, now)}</span>;
  if (t.next === null) return <span className="col-span-2 text-right text-dim">{tx("pas d'horaire")}</span>;
  return <>
    <span className="font-mono tabular-nums text-txt">{hm(t.next * 1000)}</span>
    <span className="text-right tabular-nums text-dim">{until(t.next * 1000 - now)}</span>
  </>;
}

/** « dans 8 min », « dans 2 h 58 », « dans moins d'une minute » */
function until(ms: number): string {
  const min = Math.ceil(ms / 60000);
  if (min <= 1) return tx("dans moins d'une minute");
  if (min < 60) return tx("dans {0} min", min);
  return tx("dans {0} h {1}", Math.floor(min / 60), String(min % 60).padStart(2, "0"));
}
