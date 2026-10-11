// État des services lus par leur API (connecteurs « status », aujourd'hui Home Assistant) : en ligne, version,
// entités, mises à jour disponibles (information, sans alerte). Affiché sous la barre de recherche de l'onglet Santé.
import { ArrowUpCircle, CheckCircle2, Layers, Plug } from "lucide-react";
import type { ServiceStatus } from "../types";
import { tx } from "../lib/i18n";
import { Count } from "./ui";
import { CardHead } from "./InfraCards";

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

export function ServiceCard({ s }: { s: ServiceStatus }) {
  const ups = s.updates ?? [], group = (g: string) => ups.filter((u) => (u.group ?? "other") === g);
  const core = group("core").length, rest = ups.length - core;
  return (
            <article className={`flex flex-col overflow-hidden rounded-2xl border bg-card pb-3 shadow-sm ${s.ok ? "border-line" : "border-bad/40"}`}>
              <CardHead c={s} kind={tx("Service via API")} icon={<Plug size={20} className="text-muted" aria-hidden />} />
              {!s.ok && !s.stale ? <p className="mx-4 mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{s.message}</p> : (
                <div className="px-4">
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
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">{title} <Count n={group(g).length} tone="off" /></h4>
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
                </div>
              )}
            </article>
          );
}
