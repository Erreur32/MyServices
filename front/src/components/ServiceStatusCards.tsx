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

/** Mises à jour par famille : le cœur de Home Assistant (dit s'il est à jour), ses modules, puis les autres appareils */
const GROUPS: ["core" | "addon" | "other", string][] = [["core", tx("Home Assistant")], ["addon", tx("Modules complémentaires")], ["other", tx("Autres appareils et intégrations")]];

export function ServiceStatusCards({ items }: { items: ServiceStatus[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-4" aria-label={tx("Service via API")}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Plug size={15} aria-hidden />{tx("Service via API")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((s) => {
          const icon = appIcon([s.label]), ups = s.updates ?? [], group = (g: string) => ups.filter((u) => (u.group ?? "other") === g);
          const core = group("core").length, rest = ups.length - core;
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
                  {(s.facts?.length || s.problems) && (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {(s.facts ?? []).map((f) => <Tile key={f.label} icon={<Layers size={16} />} value={f.value} label={f.label} tone={f.tone === "bad" ? "text-bad" : f.tone === "warn" ? "text-warn" : f.tone === "ok" ? "text-ok" : undefined} />)}
                      </div>
                      {(s.problems ?? []).length > 0
                        ? <ul className="mt-2 flex flex-col gap-1 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{(s.problems ?? []).map((p, i) => <li key={i}>• {p}</li>)}</ul>
                        : <p className="mt-2 text-xs text-ok">{tx("Rien à signaler.")}</p>}
                    </>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {s.entities !== undefined && <Tile icon={<Layers size={16} />} value={s.entities} label={tx("entités")} />}
                    {s.updates && (core ? <Tile icon={<ArrowUpCircle size={16} />} value={core} label={tx("mise(s) à jour de Home Assistant")} tone="text-warn" />
                      : <Tile icon={<CheckCircle2 size={16} />} value="✓" label={tx("Home Assistant à jour")} tone="text-ok" />)}
                    {rest > 0 && <Tile icon={<Layers size={16} />} value={rest} label={tx("autres mises à jour (modules, appareils)")} tone="text-muted" />}
                  </div>
                  {ups.length > 0 && (
                    <details className="mt-2 text-sm" open={core > 0}>
                      <summary className="cursor-pointer text-muted hover:text-txt">{tx("Voir les mises à jour")}</summary>
                      {GROUPS.map(([g, title]) => group(g).length > 0 && (
                        <div key={g} className="mt-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">{title} <span className="font-normal">· {group(g).length}</span></h4>
                          <ul className="mt-1 flex flex-col gap-1 text-muted">
                            {group(g).slice(0, 8).map((u) => (
                              <li key={u.name} className="flex flex-wrap items-baseline gap-2">
                                <span className="text-txt">{u.name}</span>
                                {u.installed && u.latest && <span className="font-mono text-xs text-dim">{u.installed} → {u.latest}</span>}
                              </li>
                            ))}
                            {group(g).length > 8 && <li className="text-dim">… +{group(g).length - 8}</li>}
                          </ul>
                        </div>
                      ))}
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
