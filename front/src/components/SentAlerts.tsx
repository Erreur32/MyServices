// Home page (administrator): the last alerts sent, each with the logo of its channel (Discord, Telegram, webhook), its date and its reason
// (the first line of the message sent). The history is read once from alerts (administrator only); the whole list is on Settings, Notifications.
import { ArrowRight, History } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { CHANNEL_ICON } from "../tabs/Alerts";
import type { AlertsState } from "../types";

const SHOWN = 5;

export function SentAlerts() {
  const [st, setSt] = useState<AlertsState | null>(null);
  useEffect(() => { read<AlertsState>("alerts").then(setSt).catch(() => setSt(null)); }, []);
  if (!st?.channels.length) return null;   // no channel yet: « Pour aller plus loin » already says to add one
  const typeOf = new Map(st.channels.map((c) => [c.name, c.type]));
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm" aria-label={tx("Dernières alertes envoyées")}>
      <div className="flex items-center gap-2 border-b border-line/60 bg-bg px-4 py-2.5">
        <History size={16} className="text-link" aria-hidden />
        <h2 className="flex-1 text-sm font-bold">{tx("Dernières alertes envoyées")}</h2>
        <a href="#settings/alerts/sent" className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">{tx("Tout voir")}<ArrowRight size={12} aria-hidden /></a>
      </div>
      {st.sent.length === 0 ? <p className="px-4 py-3 text-sm text-muted">{tx("Rien envoyé pour l'instant.")}</p> : (
        <ul className="divide-y divide-line/60 text-sm">
          {st.sent.slice(0, SHOWN).map((s) => {
            const type = typeOf.get(s.channel);
            return (
              <li key={`${s.ts}/${s.channel}/${s.rule}`} className="flex items-start gap-2.5 px-4 py-2 even:bg-bg/50">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center [&>*]:h-4 [&>*]:w-4" title={s.channel}>{type ? CHANNEL_ICON[type] : <History size={14} className="text-dim" aria-hidden />}</span>
                <span className="w-[6.5rem] shrink-0 whitespace-nowrap text-xs text-dim">{dateTime(s.ts * 1000)}</span>
                <span className="min-w-0 flex-1">
                  <span className={s.ok ? "text-txt" : "text-bad"}>{s.ok ? "" : "⚠ "}{s.summary.split("\n")[0] || s.rule}</span>
                  {s.n > 1 && <span className="text-xs text-dim"> {tx("+{0} autre(s)", s.n - 1)}</span>}
                  <span className="block text-xs text-dim">{s.ok ? s.rule : `${s.rule} · ${s.info}`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
