// Machines : accès (ping, SSH), système, serveurs (NPM, Apache, Docker), services et santé de chaque machine.
import { useCallback, useMemo } from "react";
import type { Snapshot } from "../api";
import { useFilter, useSort, type Facet } from "../lib/filter";
import { dur, ipNum, splitHostName } from "../lib/format";
import { status } from "../lib/status";
import type { HealthHost, Machine } from "../types";
import { MSTATE, ORDER, mState, type MState } from "../lib/machines";
import { AuthorizeKey } from "../components/AuthorizeKey";
import { Badge, Cards, Dim, Empty, FilterBar, Level, Table, Td, Th } from "../components/ui";
import { tx } from "../lib/i18n";

function healthByIp(hosts: HealthHost[] = []): Map<string, HealthHost> {
  return new Map(hosts.map((h) => [splitHostName(h.name)[1], h]));
}

function topDisk(h?: HealthHost) {
  return (h?.disks || []).reduce<NonNullable<HealthHost["disks"]>[number] | null>((a, d) => (!a || d.used_pct > a.used_pct ? d : a), null);
}

function Servers({ m, snap }: { m: Machine; snap: Snapshot }) {
  const rows = snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.service);
  const npm = rows.some((r) => /nginx-proxy-manager/.test(r.service!.image || ""));
  const apDown = rows.filter((r) => r.enabled && r.service!.kind === "apache" && status(r)[0] === "bad").length;
  const i = m.info || {};
  const tags = [
    npm && <Badge key="npm" tone="off"><span className="text-npm">{tx("NPM")}</span></Badge>,
    i.apache && <Badge key="ap" tone={apDown ? "bad" : "off"}><span className={apDown ? "" : "text-apache"}>{tx("Apache ·")} {(i.vhosts || []).length} {tx("vhosts")}</span></Badge>,
    i.nginx && <Badge key="ng" tone="off">{tx("nginx")}</Badge>,
    i.docker ? <Badge key="dk" tone="off"><span className="text-link">{tx("Docker ·")} {i.docker}</span></Badge> : null,
  ].filter(Boolean);
  return tags.length ? <div className="flex flex-wrap gap-1">{tags}</div> : <Dim>—</Dim>;
}

function HealthCell({ h }: { h?: HealthHost }) {
  if (!h) return <Dim>{tx("non suivie")}</Dim>;
  const d = topDisk(h), failed = h.systemd?.failed.length || 0, apt = h.apt?.upgradable || 0;
  return (
    <div className="flex flex-col items-start gap-1">
      <Level level={h.reachable === false ? "down" : h.level} />
      {d && <span className={`text-xs ${d.critical ? "text-bad" : d.warning ? "text-warn" : "text-muted"}`}>{tx("disque")} {d.mount} {d.used_pct} %</span>}
      {(failed > 0 || apt > 0 || h.reboot_required) && (
        <span className="text-xs text-warn">{[failed && tx("{0} service(s) en échec", failed), apt && tx("{0} mise(s) à jour", apt), h.reboot_required && tx("redémarrage requis")].filter(Boolean).join(" · ")}</span>
      )}
    </div>
  );
}

function Ssh({ m }: { m: Machine }) {
  if (!m.ssh) return <Dim>{m.local ? tx("local") : tx("pas d'accès SSH configuré")}</Dim>;
  const s = m.ssh, sd = m.info?.sshd || {};
  const pwd = s.methods ? s.methods.some((x) => x === "password" || x === "keyboard-interactive") : sd.passwordauthentication?.startsWith("yes");
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs">{s.user || "?"}@{m.ip}:{s.port}</span>
      <span className="text-xs text-dim">{tx("alias")} {s.alias}{s.identity ? "" : tx(" · sans clé")}</span>
      <span className="flex flex-wrap gap-1">
        {!s.host_key && <Badge tone="bad" title={tx("Clé d'hôte absente de known_hosts")}>{tx("clé d'hôte inconnue")}</Badge>}
        {sd.permitrootlogin?.startsWith("yes") && <Badge tone="warn">{tx("root autorisé")}</Badge>}
        {pwd && <Badge tone="warn">{tx("mot de passe accepté")}</Badge>}
      </span>
    </div>
  );
}

export function Machines({ snap, onMachine }: { snap: Snapshot; onMachine: (ip: string) => void }) {
  const hb = useMemo(() => healthByIp(snap.health?.hosts), [snap.health]);
  const facets = useMemo((): Facet<Machine>[] => [
    { key: "state", label: tx("État"), get: mState, name: (v) => MSTATE[v as MState][1], order: ORDER },
    { key: "health", label: tx("Santé"), get: (m) => { const h = hb.get(m.ip); return h ? (h.reachable === false ? "down" : h.level) : ""; },
      name: (v) => ({ ok: "OK", warn: tx("à surveiller"), crit: "critique", down: "injoignable" } as Record<string, string>)[v] || v, order: ["ok", "warn", "crit", "down"] },
    { key: "user", label: tx("Compte SSH"), get: (m) => m.ssh?.user || "" },
  ], [hb]);
  const text = useCallback((m: Machine) => [m.name, m.ip, m.role, MSTATE[mState(m)][1], m.ssh?.alias, m.ssh?.user, m.info?.os].join(" "), []);
  const f = useFilter(snap.data.machine_list, facets, text);
  const keyOf = useCallback((m: Machine, k: string): string | number => {
    switch (k) {
      case "state": return ORDER.indexOf(mState(m));
      case "os": return m.info?.os || "~";
      case "svc": return -m.services;
      case "health": return -(topDisk(hb.get(m.ip))?.used_pct ?? -1);
      default: return ipNum(m.ip);
    }
  }, [hb]);
  const sort = useSort(f.shown, keyOf, "ip");

  const name = (m: Machine) => (
    <button type="button" onClick={() => onMachine(m.ip)} className="text-left" title={tx("Voir ses services")}>
      <b className="font-semibold hover:text-link">{m.name}</b>
      <span className="block text-xs text-dim">{m.ip}{m.role ? ` · ${m.role}` : ""}</span>
    </button>
  );
  const svc = (m: Machine) => (
    <span><b>{m.services}</b> <Dim>{tx("dont")} {m.npm} {tx("NPM")}</Dim>{m.down > 0 && <span className="block text-xs text-bad">{m.down} {tx("en panne")}</span>}</span>
  );
  const st = (m: Machine) => { const [tone, label, tip] = MSTATE[mState(m)]; return <Badge tone={tone} title={tip}>{label}</Badge>; };

  return (
    <div className="py-1">
      {snap.me.role === "admin" && <AuthorizeKey failing={(snap.data.connectors || []).filter((c) => c.type === "docker" && !c.ok)} />}
      <FilterBar f={f} placeholder={tx("Nom, IP, rôle, système, compte SSH…")} />
      {sort.sorted.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <>
          <Table head={<>
            <Th k="ip" sort={sort}>{tx("Machine")}</Th><Th k="state" sort={sort}>{tx("État")}</Th><Th>{tx("SSH")}</Th><Th k="os" sort={sort}>{tx("Système")}</Th>
            <Th>{tx("Serveurs")}</Th><Th k="svc" sort={sort}>{tx("Services")}</Th>{snap.health && <Th k="health" sort={sort}>{tx("Santé")}</Th>}
          </>}>
            {sort.sorted.map((m) => (
              <tr key={m.ip} className="hover:bg-bg2/60">
                <Td>{name(m)}</Td><Td>{st(m)}</Td><Td><Ssh m={m} /></Td>
                <Td>{m.info?.os ? <>{m.info.os}<span className="block text-xs text-dim">{tx("noyau")} {m.info.kernel || "?"} {tx("· up")} {dur(m.info.uptime_s)}</span></> : <Dim>—</Dim>}</Td>
                <Td><Servers m={m} snap={snap} /></Td><Td>{svc(m)}</Td>
                {snap.health && <Td><HealthCell h={hb.get(m.ip)} /></Td>}
              </tr>
            ))}
          </Table>
          <Cards>
            {sort.sorted.map((m) => (
              <div key={m.ip} className="rounded-2xl border border-line bg-card p-3.5">
                <div className="flex items-start justify-between gap-2">{name(m)}{st(m)}</div>
                <div className="mt-2 flex flex-col gap-2 text-sm">
                  {m.info?.os && <span className="text-muted">{m.info.os} {tx("· up")} {dur(m.info.uptime_s)}</span>}
                  <Servers m={m} snap={snap} />
                  <div className="flex items-start justify-between gap-3">{svc(m)}{snap.health && <HealthCell h={hb.get(m.ip)} />}</div>
                </div>
              </div>
            ))}
          </Cards>
        </>
      )}
    </div>
  );
}
