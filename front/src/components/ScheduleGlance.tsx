// Start guide, last step: the scheduled tasks at a glance (collection, watch, health, backups): when each one runs, and why one does not. The detail and the
// buttons are in Settings -> Tasks and schedules.
import { ArrowRight, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import { scheduleRows, type ScheduleRow } from "../lib/tasks";
import { tx } from "../lib/i18n";
import type { SystemState } from "../types";
import { InfoNote } from "./InfoNote";
import { Badge, Dim } from "./ui";

export function ScheduleGlance() {
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  useEffect(() => { read<SystemState>("system").then((s) => setRows(scheduleRows(s.tasks))).catch(() => setRows(null)); }, []);
  if (!rows?.length) return null;
  return (
    <section className="mt-6 rounded-xl border border-line bg-bg/40 p-4" aria-label={tx("Tâches planifiées")}>
      <h3 className="mb-2 flex items-center gap-2 font-bold"><Timer size={16} className="text-link" aria-hidden />{tx("Tâches planifiées")}</h3>
      <InfoNote className="mb-3">{tx("MyServices relit tout seul vos machines et vos outils. Voici quand, et pourquoi une tâche ne tourne pas si elle est coupée.")}</InfoNote>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">
        {rows.map((r) => (
          <li key={r.name} className="grid items-center gap-x-4 gap-y-1 px-2 py-2 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
            <b>{r.label}</b>
            <span className="text-muted">{r.on ? r.when : <Dim>{r.why || tx("coupée")}</Dim>}</span>
            <Badge outline tone={r.on ? "ok" : "off"}>{r.on ? tx("active") : tx("coupée")}</Badge>
          </li>
        ))}
      </ul>
      <a href="#settings/tasks" className="mt-3 inline-flex items-center gap-1 text-sm text-link hover:underline">{tx("Régler les horaires")}<ArrowRight size={14} aria-hidden /></a>
    </section>
  );
}
