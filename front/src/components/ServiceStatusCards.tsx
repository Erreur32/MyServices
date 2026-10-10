// État des services lus par leur API (connecteurs « status », aujourd'hui Home Assistant) : en ligne, version,
// entités, mises à jour disponibles (information, sans alerte).
import { House } from "lucide-react";
import type { ServiceStatus } from "../types";
import { tx } from "../lib/i18n";
import { Badge } from "./ui";

export function ServiceStatusCards({ items }: { items: ServiceStatus[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((s) => (
        <section key={`${s.connector}/${s.name}`} className={`rounded-xl border bg-card p-4 ${s.ok ? "border-line" : "border-bad/40"}`}>
          <h3 className="mb-2 flex flex-wrap items-center gap-2 font-bold">
            <House size={16} aria-hidden />{s.label}
            <Badge tone={s.ok ? "ok" : "bad"}>{s.ok ? tx("en ligne") : tx("illisible")}</Badge>
            {s.stale && <Badge tone="warn">{tx("relevé périmé")}</Badge>}
            {s.version && <Badge tone="off">{s.version}</Badge>}
          </h3>
          {!s.ok && !s.stale ? <p className="text-sm text-bad">{s.message}</p> : (
            <>
              <p className="text-sm text-muted">
                {s.entities !== undefined && <span>{tx("{0} entités", s.entities)}</span>}
                {s.updates && <span>{" · "}{s.updates.length ? <b className="text-warn">{tx("{0} mise(s) à jour disponible(s)", s.updates.length)}</b> : tx("à jour")}</span>}
              </p>
              {!!s.updates?.length && (
                <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted">
                  {s.updates.slice(0, 6).map((u) => (
                    <li key={u.name} className="flex flex-wrap items-baseline gap-2">
                      <span className="text-txt">{u.name}</span>
                      {u.installed && u.latest && <span className="font-mono text-xs text-dim">{u.installed} → {u.latest}</span>}
                    </li>
                  ))}
                  {s.updates.length > 6 && <li className="text-dim">… +{s.updates.length - 6}</li>}
                </ul>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
