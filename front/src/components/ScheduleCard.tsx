// Cadre de l'accueil, sous les compteurs : la date et l'heure en direct, puis les tâches planifiées (collecte, veille, santé,
// sauvegardes, recherche réseau) avec leur prochain passage ou leur durée en cours. Une tâche coupée n'y figure pas.
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { LoginRequired, read } from "../api";
import { longDay } from "../lib/format";
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
  const active = Object.entries(tasks ?? {}).filter(([, t]) => t.enabled);
  return (
    <section className="rounded-xl border border-line border-l-4 border-l-muted bg-card p-3" aria-label={tx("Date et tâches planifiées")}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-sm capitalize">{longDay(now)}</b>
        <span className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-muted"><Clock size={13} aria-hidden />{new Date(now).toLocaleTimeString(LOCALE)}</span>
      </div>
      {active.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-line/60 pt-2 text-xs text-muted">
          {active.map(([name, t]) => (
            <li key={name} className="flex items-center gap-1.5" title={detail(t)}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.running ? "animate-pulse bg-link" : "bg-ok"}`} />
              <b className="font-semibold text-txt">{shortName(name, t)}</b>
              <span className="ml-auto tabular-nums">{liveText(t, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
