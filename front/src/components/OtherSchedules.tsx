// Tasks and schedules: the schedules set elsewhere (the update check, the notification reports), shown here with a link to where
// each one is set, so every schedule can be seen in one place without a second setting.
import { CalendarClock, RefreshCw, Send, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import type { NotificationItem, NotificationsState } from "../types";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { SettingsLink } from "./SettingsLink";
import { DAYS } from "../tabs/Notifications";
import { InfoNote } from "./InfoNote";
import { Card, Dim } from "./ui";

const COLS = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-6 px-3";   // the header and every line share the columns

interface UpdateCheck { enabled: boolean; checked_at: number | null }

const updateWhen = (u: UpdateCheck | null) => {
  if (!u) return "-";
  return u.enabled ? tx("toutes les 6 h") : tx("coupée");
};

/** « Lun Mer · 08:00 » or « tous les jours · 08:00, 20:00 » */
function reportWhen(n: NotificationItem): string {
  if (!n.enabled) return tx("coupée");
  const days = n.config.days.length === 7 ? tx("tous les jours") : n.config.days.map((d) => DAYS[d]).join(" ");
  return `${days} · ${n.config.at.join(", ")}`;
}

function Line({ icon: Icon, name, when, last, href }: Readonly<{ icon: LucideIcon; name: string; when: string; last: number | null; href: string }>) {
  return (
    <li className={`${COLS} items-center py-2.5 even:bg-bg/50`}>
      <span className="flex min-w-0 items-center gap-2 font-semibold"><Icon size={15} className="shrink-0 text-muted" aria-hidden /><span className="truncate">{name}</span></span>
      <span className="text-muted">{when}</span>
      <span className="text-dim">{last ? dateTime(last * 1000) : <Dim>-</Dim>}</span>
      <SettingsLink href={href} of={name} />
    </li>
  );
}

export function OtherSchedules() {
  const [check, setCheck] = useState<UpdateCheck | null>(null), [reports, setReports] = useState<NotificationItem[]>([]);
  useEffect(() => {
    read<UpdateCheck>("about").then(setCheck).catch(() => undefined);
    read<NotificationsState>("notifications").then((s) => setReports(s.notifications.filter((n) => n.kind === "report"))).catch(() => undefined);
  }, []);
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><CalendarClock size={16} aria-hidden />{tx("Autres horaires")}</h2>
      <InfoNote className="mb-3">{tx("Réglés ailleurs, rappelés ici pour voir tous les horaires au même endroit.")}</InfoNote>
      <div className={`${COLS} pb-1 text-[11px] font-bold uppercase tracking-wider text-dim`}>
        <span>{tx("Tâche")}</span><span>{tx("Horaire")}</span><span>{tx("Dernier passage")}</span><span />
      </div>
      <ul className="flex flex-col text-sm">
        <Line icon={RefreshCw} name={tx("Vérification des mises à jour")} when={updateWhen(check)} last={check?.checked_at ?? null} href="#settings/updates" />
        {reports.map((n) => <Line key={n.id} icon={Send} name={n.name} when={reportWhen(n)} last={n.last_sent} href="#settings/alerts/notifications" />)}
      </ul>
    </Card>
  );
}
