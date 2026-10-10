// État des services lus par leur API (connecteurs « status », aujourd'hui Home Assistant) : en ligne, version,
// entités, mises à jour disponibles (information, sans alerte). Affiché sous la barre de recherche de l'onglet Santé.
import { ArrowUpCircle, CheckCircle2, Layers, Plug } from "lucide-react";
import type { ServiceStatus } from "../types";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { Badge } from "./ui";

function Tile({ icon, value, label, tone }: { icon: React.ReactNode; value: string | number; label: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-bg2/60 px-3 py-2">
      <span className="text-dim" aria-hidden>{icon}</span>
      <div className="min-w-0"><div className={`font-mono text-base font-bold leading-tight ${tone ?? "text-txt"}`}>{value}</div><div className="truncate text-xs text-dim">{label}</div></div>
    </div>
  );
}

export function ServiceStatusCards({ items }: { items: ServiceStatus[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-4" aria-label={tx("Services lus par leur API")}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Plug size={15} aria-hidden />{tx("Services lus par leur API")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((s) => {
          const icon = appIcon([s.label]), n = s.updates?.length ?? 0;
          return (
            <article key={`${s.connector}/${s.name}`} className={`rounded-2xl border bg-card p-4 ${s.ok ? "border-line" : "border-bad/40"}`}>
              <header className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2">{icon ? <img src={icon} alt="" className="h-6 w-6" /> : <Plug size={20} className="text-muted" aria-hidden />}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-bold leading-tight">{s.label}</h3>
                  {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-xs text-dim hover:text-link hover:underline">{s.url}</a>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={s.ok ? "ok" : "bad"}>{s.ok ? tx("en ligne") : tx("illisible")}</Badge>
                  {s.version && <span className="font-mono text-xs text-dim">{s.version}</span>}
                </div>
              </header>
              {s.stale && <p className="mt-2 text-xs text-warn">{tx("relevé périmé : dernier état connu")}</p>}
              {!s.ok && !s.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{s.message}</p> : (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {s.entities !== undefined && <Tile icon={<Layers size={16} />} value={s.entities} label={tx("entités")} />}
                    {s.updates && (n ? <Tile icon={<ArrowUpCircle size={16} />} value={n} label={tx("mise(s) à jour")} tone="text-warn" />
                      : <Tile icon={<CheckCircle2 size={16} />} value="✓" label={tx("à jour")} tone="text-ok" />)}
                  </div>
                  {!!n && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-muted hover:text-txt">{tx("Voir les mises à jour")}</summary>
                      <ul className="mt-1.5 flex flex-col gap-1 text-muted">
                        {s.updates!.slice(0, 8).map((u) => (
                          <li key={u.name} className="flex flex-wrap items-baseline gap-2">
                            <span className="text-txt">{u.name}</span>
                            {u.installed && u.latest && <span className="font-mono text-xs text-dim">{u.installed} → {u.latest}</span>}
                          </li>
                        ))}
                        {n > 8 && <li className="text-dim">… +{n - 8}</li>}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
