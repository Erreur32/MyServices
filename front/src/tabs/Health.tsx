// Santé des machines (health.py / Beszel) : une fiche par machine, avec ce qui ne va pas en premier.
import { useCallback, useMemo } from "react";
import type { Snapshot } from "../api";
import { useFilter, type Facet } from "../lib/filter";
import { dateTime, splitHostName } from "../lib/format";
import type { HealthHost } from "../types";
import { Badge, Dim, Empty, Fill, FilterBar, Level } from "../components/ui";
import { ServiceStatusCards } from "../components/ServiceStatusCards";
import { LEVEL } from "../lib/level";
import { tx } from "../lib/i18n";

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
          {(h.disks || []).filter((d) => (d.size_gb ?? 1) >= 1).map((d) => (
            <div key={d.mount} className="flex items-center gap-2">
              <span className="w-24 truncate font-mono" title={d.mount}>{d.mount}</span>
              <Fill pct={d.used_pct} tone={d.critical ? "bad" : d.warning ? "warn" : "ok"} />
              <span>{d.used_pct} %</span>{d.avail_gb != null && <Dim>· {d.avail_gb.toFixed(0)} {tx("Go libres")}</Dim>}
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {h.docker?.accessible && <Badge tone="off">{tx("Docker ·")} {h.docker.total ?? 0} {tx("conteneurs")}</Badge>}
            {h.load?.available && <Badge tone="off">{tx("charge")} {h.load.load_1} / {h.load.ncpu} {tx("CPU")}</Badge>}
            {h.smart?.accessible && <Badge tone="off">{tx("SMART ·")} {h.smart.disks.length} {tx("disque(s)")}</Badge>}
            {h.ssh_auth?.available && <Badge tone="off">{tx("SSH refusés 24 h :")} {h.ssh_auth.failed_24h}</Badge>}
          </div>
        </div>
      )}
    </section>
  );
}

export function Health({ snap }: { snap: Snapshot }) {
  const hosts = useMemo(() => [...(snap.health?.hosts || [])].sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)]), [snap.health]);
  const facets = useMemo((): Facet<HealthHost>[] => [
    { key: "level", label: tx("État"), get: levelOf, name: (v) => LEVEL[v]?.[1] || v, order: ["down", "crit", "warn", "ok"] },
  ], []);
  const text = useCallback((h: HealthHost) => [h.name, ...problems(h).map((p) => p[1])].join(" "), []);
  const f = useFilter(hosts, facets, text);
  const services = snap.data.services_status ?? [];
  if (!snap.health) return services.length ? <div className="py-1"><ServiceStatusCards items={services} /><Empty>{tx("Santé pas encore relevée.")}</Empty></div> : <Empty>{tx("Santé pas encore relevée.")}</Empty>;
  return (
    <div className="py-1">
      <ServiceStatusCards items={services} />
      <FilterBar f={f} placeholder={tx("Machine, disque, service en échec…")}
        extra={<span className="text-xs text-dim">{tx("relevé du")} {dateTime(snap.health.timestamp)}</span>} />
      {f.shown.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{f.shown.map((h) => <HostCard key={h.id} h={h} />)}</div>
      )}
    </div>
  );
}
