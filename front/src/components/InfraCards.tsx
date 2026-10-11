// Proxmox (VE et Backup Server) et Dockhand : ce que chaque connecteur lit, en cartes sous la barre de recherche de l'onglet Santé.
import { Boxes, Container, HardDrive, Server } from "lucide-react";
import type { ContainersConnector, VirtualizationConnector } from "../types";
import { appIcon } from "../lib/appIcons";
import { dateTime, dur } from "../lib/format";
import { tx } from "../lib/i18n";
import { Badge, Dim, Fill } from "./ui";

const tone = (p?: number | null) => (p == null ? "off" : p >= 90 ? "bad" : p >= 80 ? "warn" : "ok") as "ok" | "warn" | "bad" | "off";

function Head({ c, icon }: { c: { label: string; url?: string | null; ok: boolean; version?: string | null; stale: boolean }; icon: React.ReactNode }) {
  const img = appIcon([c.label]);
  return (
    <>
      <header className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2">{img ? <img src={img} alt="" className="h-6 w-6" /> : icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold leading-tight">{c.label}</h3>
          {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-xs text-dim hover:text-link hover:underline">{c.url}</a>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>
          {c.version && <span className="font-mono text-xs text-dim">{c.version}</span>}
        </div>
      </header>
      {c.stale && <p className="mt-2 text-xs text-warn">{tx("relevé périmé : dernier état connu")}</p>}
    </>
  );
}

function Pve({ c }: { c: VirtualizationConnector }) {
  const t = c.totals, guests = (c.guests ?? []).filter((g) => !g.template);
  return (
    <article className={`rounded-2xl border bg-card p-4 ${c.ok ? "border-line" : "border-bad/40"}`}>
      <Head c={c} icon={<Server size={20} className="text-muted" aria-hidden />} />
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <>
          {t && <p className="mt-3 text-sm text-muted">{t.vm} {tx("VM")} · {t.lxc} {tx("conteneurs LXC")} · <b className="text-ok">{t.running} {tx("en marche")}</b>{t.stopped > 0 && <> · {t.stopped} {tx("arrêtés")}</>}</p>}
          {(c.nodes ?? []).length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {c.nodes!.map((n) => (
                <li key={n.name} className="flex flex-wrap items-center gap-2">
                  <Badge tone={n.online ? "ok" : "bad"}>{n.online ? tx("en ligne") : tx("hors ligne")}</Badge><b>{n.name}</b>
                  {n.cpu_pct != null && <Dim>{tx("CPU")} {Math.round(n.cpu_pct)} %</Dim>}{n.mem_pct != null && <Dim>· {tx("mémoire")} {Math.round(n.mem_pct)} %</Dim>}
                  {n.uptime ? <Dim>· {tx("en marche depuis")} {dur(n.uptime)}</Dim> : null}
                </li>
              ))}
            </ul>
          )}
          {(c.storage ?? []).filter((s) => s.used_pct != null).length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {c.storage!.filter((s) => s.used_pct != null).map((s) => (
                <div key={`${s.node}/${s.name}`} className="text-xs"><div className="flex justify-between text-muted"><span><HardDrive size={11} className="mr-1 inline" aria-hidden />{s.name}{s.node && <Dim> · {s.node}</Dim>}</span><span>{s.used_pct} %</span></div><Fill pct={s.used_pct!} tone={tone(s.used_pct)} /></div>
              ))}
            </div>
          )}
          {c.backups && <p className={`mt-3 text-sm ${c.backups.ok ? "text-muted" : "text-warn"}`}>{tx("Dernière sauvegarde :")} {dateTime(c.backups.last * 1000)} · {c.backups.ok ? tx("réussie") : tx("en échec")}{c.backups.failed_recent > 0 && ` · ${c.backups.failed_recent} ${tx("échec(s) récents")}`}</p>}
          {guests.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted hover:text-txt">{tx("Voir les VM et conteneurs")} · {guests.length}</summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                {guests.slice(0, 60).map((g) => (
                  <li key={g.vmid} className="flex flex-wrap items-baseline gap-2"><Badge tone={g.status === "running" ? "ok" : "off"}>{g.status === "running" ? tx("en marche") : tx("arrêté")}</Badge><span className="text-txt">{g.name || g.vmid}</span><Dim>{g.type === "lxc" ? "LXC" : "VM"} {g.vmid}{g.node && ` · ${g.node}`}</Dim></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function Pbs({ c }: { c: VirtualizationConnector }) {
  return (
    <article className={`rounded-2xl border bg-card p-4 ${c.ok ? "border-line" : "border-bad/40"}`}>
      <Head c={c} icon={<HardDrive size={20} className="text-muted" aria-hidden />} />
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
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

function Dockhand({ c }: { c: ContainersConnector }) {
  return (
    <article className={`rounded-2xl border bg-card p-4 ${c.ok ? "border-line" : "border-bad/40"}`}>
      <Head c={c} icon={<Container size={20} className="text-muted" aria-hidden />} />
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {(c.environments ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2"><b>{e.name || e.id}</b>
                {e.containers.total != null && <Dim>{e.containers.running ?? 0}/{e.containers.total} {tx("en marche")}</Dim>}
                {(e.containers.unhealthy ?? 0) > 0 && <Badge tone="bad">{e.containers.unhealthy} {tx("en mauvaise santé")}</Badge>}
                {e.updates.length > 0 && <Badge tone="warn">{e.updates.length} {tx("mise(s) à jour d'image")}</Badge>}</li>
            ))}
          </ul>
          {(c.updates ?? 0) > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted hover:text-txt">{tx("Voir les mises à jour d'image")}</summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                {c.environments!.flatMap((e) => e.updates.map((u) => <li key={`${e.id}/${u.container}`}><span className="text-txt">{u.container}</span> <Dim>{u.image}{u.newer ? ` → ${u.newer}` : ""}</Dim></li>)).slice(0, 40)}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

export function InfraCards({ virt, docker }: { virt: VirtualizationConnector[]; docker: ContainersConnector[] }) {
  if (!virt.length && !docker.length) return null;
  return (
    <section className="mb-4" aria-label={tx("Virtualisation et conteneurs")}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Boxes size={15} aria-hidden />{tx("Virtualisation et conteneurs")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {virt.map((c) => c.connector === "proxmox-backup" ? <Pbs key={`${c.connector}/${c.name}`} c={c} /> : <Pve key={`${c.connector}/${c.name}`} c={c} />)}
        {docker.map((c) => <Dockhand key={`${c.connector}/${c.name}`} c={c} />)}
      </div>
    </section>
  );
}
