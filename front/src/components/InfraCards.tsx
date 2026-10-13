// Dockhand, Dozzle, Arcane (conteneurs) et les services lus par leur API : cartes sous la barre de recherche de l'onglet Santé. PbsCard sert à l'onglet Virtualisation
// (les hyperviseurs y sont aussi, plus dans Santé).
import { Boxes, Container, HardDrive } from "lucide-react";
import type { ContainersConnector, ServiceStatus, VirtualizationConnector } from "../types";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { Badge, Count, Dim, Fill } from "./ui";
import { ServiceCard } from "./ServiceStatusCards";

const tone = (p?: number | null) => (p == null ? "off" : p >= 90 ? "bad" : p >= 80 ? "warn" : "ok") as "ok" | "warn" | "bad" | "off";

/** Shared header of every card of the grid: logo, name and address, what kind of thing it is, and its state. */
export function CardHead({ c, icon, kind }: { c: { label: string; url?: string | null; ok: boolean; version?: string | null; stale: boolean }; icon: React.ReactNode; kind: string }) {
  const img = appIcon([c.label]);
  return (
    <>
      <header className={`flex items-center gap-3 px-4 py-3 ${c.ok ? "bg-bg2/50" : "bg-bad/10"}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2">{img ? <img src={img} alt="" className="h-6 w-6" /> : icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold leading-tight">{c.label}</h3>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-dim">{kind}</span>
          {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-xs text-dim hover:text-link hover:underline">{c.url}</a>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>
          {c.version && <span className="font-mono text-xs text-dim">{c.version}</span>}
        </div>
      </header>
      {c.stale && <p className="mx-4 mt-2 text-xs text-warn">{tx("relevé périmé : dernier état connu")}</p>}
    </>
  );
}

export function PbsCard({ c }: { c: VirtualizationConnector }) {
  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-card pb-3 shadow-sm ${c.ok ? "border-line" : "border-bad/40"}`}>
      <CardHead c={c} kind={tx("Sauvegardes")} icon={<HardDrive size={20} className="text-muted" aria-hidden />} />
      {!c.ok && !c.stale ? <p className="mx-4 mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <ul className="mt-3 flex flex-col gap-2 px-4 text-sm">
          {(c.datastores ?? []).map((d) => (
            <li key={d.name}>
              <div className="flex flex-wrap items-center gap-2"><b>{d.name}</b><Dim>{d.groups} {tx("groupes de sauvegarde")}</Dim>
                {d.age_h != null && <Badge tone={d.age_h > 48 ? "warn" : "ok"}>{tx("dernière")} {d.age_h < 48 ? `${Math.round(d.age_h)} h` : `${Math.round(d.age_h / 24)} ${tx("j")}`}</Badge>}</div>
              {d.used_pct != null && <div className="mt-1 text-xs"><div className="flex justify-between text-muted"><span>{tx("Espace utilisé")}</span><span>{d.used_pct} %</span></div><Fill pct={d.used_pct} tone={tone(d.used_pct)} /></div>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function DockhandCard({ c }: { c: ContainersConnector }) {
  const envs = c.environments ?? [], updates = envs.flatMap((e) => e.updates.map((u) => ({ env: e.name || String(e.id), ...u })));
  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-card pb-3 shadow-sm ${c.ok ? "border-line" : "border-bad/40"}`}>
      <CardHead c={c} kind={tx("Conteneurs")} icon={<Container size={20} className="text-muted" aria-hidden />} />
      {!c.ok && !c.stale ? <p className="mx-4 mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <>
          {envs.length > 0 ? (
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                  <th className="px-4 py-2">{tx("Environnement")}</th><th className="w-[5.5rem] px-2 py-2 text-right">{tx("Actifs")}</th><th className="w-[6.5rem] py-2 pl-2 pr-4 text-right">{tx("À signaler")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {envs.map((e) => {
                  const k = e.containers, bad = k.unhealthy ?? 0, upd = e.updates.length;
                  return (
                    <tr key={e.id} className="hover:bg-bg2/40">
                      <td className="truncate px-4 py-2 font-semibold" title={e.name || String(e.id)}>{e.name || e.id}</td>
                      <td className="px-2 py-2 text-right font-mono"><span className={k.total != null && (k.running ?? 0) < k.total ? "text-warn" : "text-ok"}>{k.running ?? 0}</span><span className="text-dim"> / {k.total ?? "?"}</span></td>
                      <td className="py-2 pl-2 pr-4 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          {e.available === false && <Badge tone="bad">{tx("hors ligne")}</Badge>}
                          {bad > 0 && <Badge tone="bad">{bad} {tx("en mauvaise santé")}</Badge>}
                          {upd > 0 && <Badge tone="warn">{upd} {tx("mise(s) à jour d'image")}</Badge>}
                          {!bad && !upd && e.available !== false && <Badge tone="ok">{tx("rien")}</Badge>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="px-4 pt-3 text-sm text-dim">{tx("Aucun environnement lu.")}</p>}
          {updates.length > 0 && (
            <details className="mx-4 mt-2 text-sm">
              <summary className="cursor-pointer text-muted hover:text-txt">{tx("Voir les mises à jour d'image")} · {updates.length}</summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                {updates.slice(0, 40).map((u) => <li key={`${u.env}/${u.container}`} className="flex flex-wrap items-baseline gap-2"><span className="text-txt">{u.container}</span><Dim>{u.image}{u.newer ? ` → ${u.newer}` : ""}</Dim></li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

/** One section, one grid, one card shape: containers (Dockhand) and the services read through their API (Home Assistant, Nextcloud…). */
export function InfraCards({ docker, services }: { docker: ContainersConnector[]; services: ServiceStatus[] }) {
  const n = docker.length + services.length;
  if (!n) return null;
  return (
    <section className="mb-5" aria-label={tx("Services et infrastructure")}>
      <h2 className="mb-2 flex items-center gap-2 border-b border-line/60 pb-1 text-xs font-bold uppercase tracking-wider text-dim"><Boxes size={14} aria-hidden />{tx("Services et infrastructure")} <Count n={n} tone="off" /></h2>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {docker.map((c) => <DockhandCard key={`${c.connector}/${c.name}`} c={c} />)}
        {services.map((x) => <ServiceCard key={`${x.connector}/${x.name}`} s={x} />)}
      </div>
    </section>
  );
}
