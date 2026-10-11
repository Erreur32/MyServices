// Tâches planifiées en direct, sous le titre : ce qui tourne, depuis quand, et le prochain passage de chacune.
import { useEffect, useState } from "react";
import { LoginRequired, read } from "../api";
import { detail, liveText, shortName, type TaskInfo } from "../lib/tasks";

const IDLE_MS = 5_000, RUN_MS = 1_500;

export function TaskStrip() {
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
  if (!tasks) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="tâches planifiées">
      {Object.entries(tasks).filter(([, t]) => t.enabled).map(([name, t]) => (
        <li key={name} className="flex items-center gap-1.5" title={detail(t)}>
          <span className={`h-1.5 w-1.5 rounded-full ${t.running ? "animate-pulse bg-link" : "bg-ok"}`} />
          <b className="font-semibold text-txt">{shortName(name, t)}</b>
          <span className="tabular-nums">{liveText(t, now)}</span>
        </li>
      ))}
    </ul>
  );
}
