// Santé des machines (health.py / Beszel) : une fiche par machine, avec ce qui ne va pas en premier.
import { useCallback, useMemo } from "react";
import type { Snapshot } from "../api";
import { useFilter, type Facet } from "../lib/filter";
import { dateTime, splitHostName } from "../lib/format";
import type { AsleepHost, HealthHost } from "../types";
import { Badge, Dim, Empty, Fill, FilterBar, Level } from "../components/ui";
import { InfraCards } from "../components/InfraCards";
import { ServiceStatusCards } from "../components/ServiceStatusCards";
import { LEVEL } from "../lib/level";
import { tx } from "../lib/i18n";

const gb = (mb?: number) => ((mb ?? 0) / 1024).toFixed(1);
const levelOf = (h: HealthHost) => (h.reachable === false ? "down" : h.level || "ok");
const RANK: Record<string, number> = { down: 0, crit: 1, warn: 2, ok: 3, na: 4 };

/** Ce qui ne va pas sur une machine, en phrases courtes (vide = rien à signaler). */
function problems(h: HealthHost): [("bad" | "warn"), string][] {
  if (h.reachable === false) return [["bad", tx("injoignable : ni SSH ni Beszel")]];
  const out: [("bad" | "warn"), string][] = [];
  for (const d of h.disks || []) if (d.critical || d.warning) out.push([d.critical ? "bad" : "warn", tx("disque {0} rempli à {1} %", d.mount, d.used_pct)]);
  const failed = h.systemd?.failed || [];
  if (failed.length) out.push(["bad", tx("{0} service(s) systemd en échec : {1}", failed.length, failed.map((u) => u.unit).join(", "))]);
  const dk = h.docker;
  if (dk?.accessible && (dk.unhealthy || dk.restarting)) out.push(["warn", tx("Docker : {0} unhealthy, {1} en redémarrage", dk.unhealthy || 0, dk.restarting || 0)]);
  if ((dk?.issues || []).length) out.push(["warn", tx("Docker : {0}", dk!.issues!.join(", "))]);
  if (h.kernel?.has_errors) out.push(["warn", tx("erreurs noyau récentes")]);
  for (const d of h.smart?.disks || []) if (d.failed || !d.healthy) out.push(["bad", tx("SMART : {0} en défaut", d.device)]);
  if (h.load?.available && h.load.load_1 > h.load.ncpu) out.push(["warn", tx("charge {0} pour {1} CPU", h.load.load_1, h.load.ncpu)]);
  if (h.ssh_auth?.available && h.ssh_auth.failed_24h > 20) out.push(["warn", tx("{0} connexions SSH refusées en 24 h", h.ssh_auth.failed_24h)]);
  if (h.res?.available && (h.res.mem_pct ?? 0) >= 90) out.push([h.res.mem_pct! >= 97 ? "bad" : "warn", tx("mémoire utilisée à {0} %", Math.round(h.res.mem_pct!))]);
  if (h.temp?.available && h.temp.celsius! >= 85) out.push([h.temp.celsius! >= 95 ? "bad" : "warn", tx("processeur à {0} °C", h.temp.celsius)]);
  if (h.reboot_required) out.push(["warn", tx("redémarrage requis")]);
  if (h.apt?.upgradable) out.push(["warn", tx("{0} mise(s) à jour en attente", h.apt.upgradable)]);
  return out;
}

function HostCard({ h }: { h: HealthHost }) {
  const lv = levelOf(h), pb = problems(h);
  const [name, ip] = splitHostName(h.name);
  return (
    <section className={`rounded-2xl border bg-card p-4 ${lv === "ok" ? "border-line" : lv === "warn" ? "border-warn/50" : "border-bad/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div><b>{name}</b><span className="block text-xs text-dim">{ip}{h.os === "windows" ? tx(" · Windows") : ""}</span></div>
        <Level level={lv} />
      </div>
      {pb.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {pb.map(([t, s], i) => <li key={i} className={t === "bad" ? "text-bad" : "text-warn"}>• {s}</li>)}
        </ul>
      ) : h.reachable !== false && <p className="mt-3 text-sm text-ok">{tx("Rien à signaler.")}</p>}
      {h.reachable !== false && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-line/60 pt-3 text-xs text-muted">
          {h.res?.available && (
            <>
              <div className="flex items-center gap-2">
                <span className="w-24 truncate">{tx("CPU")}</span>
                <Fill pct={h.res.cpu_pct ?? 0} tone={(h.res.cpu_pct ?? 0) >= 90 ? "warn" : "ok"} /><span>{Math.round(h.res.cpu_pct ?? 0)} %</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24 truncate">{tx("Mémoire")}</span>
                <Fill pct={h.res.mem_pct ?? 0} tone={(h.res.mem_pct ?? 0) >= 97 ? "bad" : (h.res.mem_pct ?? 0) >= 90 ? "warn" : "ok"} /><span>{Math.round(h.res.mem_pct ?? 0)} %</span>
                {h.res.mem_total_mb != null && <Dim>· {gb(h.res.mem_used_mb)} / {gb(h.res.mem_total_mb)} {tx("Go")}</Dim>}
              </div>
              {!!h.res.swap_total_mb && (h.res.swap_used_mb ?? 0) > 0 && <Dim>{tx("swap")} {gb(h.res.swap_used_mb)} / {gb(h.res.swap_total_mb)} {tx("Go")}</Dim>}
            </>
          )}
          {(h.disks || []).filter((d) => (d.size_gb ?? 1) >= 1).map((d) => (
            <div key={d.mount} className="flex items-center gap-2">
              <span className="w-24 truncate font-mono" title={d.mount}>{d.mount}</span>
              <Fill pct={d.used_pct} tone={d.critical ? "bad" : d.warning ? "warn" : "ok"} />
              <span>{d.used_pct} %</span>{d.avail_gb != null && <Dim>· {d.avail_gb.toFixed(0)} {tx("Go libres")}</Dim>}
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {!!h.sources?.length && <Badge tone="off" title={tx("Source de la santé : la première de la liste répond, les suivantes complètent ce qu'elle n'a pas lu")}>{tx("lu par")} {h.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" + ")}</Badge>}
            {h.docker?.accessible && <Badge tone="off">{tx("Docker ·")} {h.docker.total ?? 0} {tx("conteneurs")}</Badge>}
            {h.load?.available && <Badge tone="off">{tx("charge")} {h.load.load_1} / {h.load.ncpu} {tx("CPU")}</Badge>}
        {!h.temp?.available && h.temp?.virt && <Badge tone="off" title={tx("Machine virtuelle ({0}) : pas de capteur de température", h.temp.virt)}>{tx("VM")}</Badge>}
        {h.temp?.available && <Badge tone={h.temp.celsius! >= 95 ? "bad" : h.temp.celsius! >= 85 ? "warn" : "off"} title={h.temp.source}>{tx("CPU")} {h.temp.celsius} °C</Badge>}
            {h.smart?.accessible && <Badge tone="off">{tx("SMART ·")} {h.smart.disks.length} {tx("disque(s)")}</Badge>}
            {h.ssh_auth?.available && <Badge tone="off">{tx("SSH refusés 24 h :")} {h.ssh_auth.failed_24h}</Badge>}
          </div>
        </div>
      )}
    </section>
  );
}

function AsleepCard({ a }: { a: AsleepHost }) {
  const [name, ip] = splitHostName(a.name);
  return (
    <section className={`rounded-2xl border border-line bg-card p-4 ${a.ping ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div><b>{name}</b><span className="block text-xs text-dim">{ip}{a.os === "windows" ? tx(" · Windows") : ""}</span></div>
        {a.ping ? <Badge tone="ok" title={tx("Répond au ping : son agent n'a pas encore envoyé de relevé")}>{tx("allumée, agent en attente")}</Badge>
          : <Badge tone="off" title={tx("Éteinte volontairement, aucune alerte")}>{tx("éteinte (voulu)")}</Badge>}
      </div>
      <p className="mt-3 text-sm text-muted">{a.last_seen ? tx("Dernier relevé de l'agent : {0}", dateTime(a.last_seen * 1000)) : tx("Pas encore de relevé.")}</p>
    </section>
  );
}

const SOURCE_LABEL: Record<string, string> = { ssh: "SSH", agent: tx("agent"), beszel: "Beszel" };

export function Health({ snap }: { snap: Snapshot }) {
  const hosts = useMemo(() => [...(snap.health?.hosts || [])].sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)]), [snap.health]);
  const facets = useMemo((): Facet<HealthHost>[] => [
    { key: "level", label: tx("État"), get: levelOf, name: (v) => LEVEL[v]?.[1] || v, order: ["down", "crit", "warn", "ok"] },
  ], []);
  const text = useCallback((h: HealthHost) => [h.name, ...problems(h).map((p) => p[1])].join(" "), []);
  const f = useFilter(hosts, facets, text);
  const asleep = (snap.health?.asleep ?? []).filter((a) => !Object.keys(f.sel).length && a.name.toLowerCase().includes(f.query.trim().toLowerCase()));
  const services = snap.data.services_status ?? [], virt = snap.data.virtualization ?? [], docker = snap.data.containers ?? [];
  if (!snap.health) return services.length || virt.length || docker.length ? <div className="py-1"><InfraCards virt={virt} docker={docker} /><ServiceStatusCards items={services} /><Empty>{tx("Santé pas encore relevée.")}</Empty></div> : <Empty>{tx("Santé pas encore relevée.")}</Empty>;
  return (
    <div className="py-1">
      <FilterBar f={f} placeholder={tx("Machine, disque, service en échec…")}
        extra={<span className="text-xs text-dim">{tx("relevé du")} {dateTime(snap.health.timestamp)}</span>} />
      <InfraCards virt={virt} docker={docker} />
      <ServiceStatusCards items={services} />
      {f.shown.length === 0 && !asleep.length ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {f.shown.map((h) => <HostCard key={h.id} h={h} />)}
          {asleep.map((a) => <AsleepCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}
