// « Software and services » of a machine: one row per software, from its web servers, its containers and the sites NPM sends to it.
import type { Host, Machine, WebServer } from "../types";

export type SoftwareFilter = "all" | "web" | "docker" | "program" | "system" | "alone";
export type SoftwareMode = WebServer["mode"] | "process";

export interface SoftwareRow {
  key: string; order: number; name: string; mode: SoftwareMode; box: string; image?: string; status?: string; up: boolean; hostNet: boolean;
  ports: number[]; localPorts: number[]; domains: string[]; paths: string[]; web?: WebServer; alone: boolean;
  program?: boolean; own?: boolean; system?: boolean;   // a process or a systemd service; own: not from a package; system: from a package, on no port
}

const pathOf = (r: Host): string => {
  const s = r.service!;
  return [r.npm || "NPM", r.port ? `${s.name} :${r.port}` : s.name, s.behind && (s.behind.name ?? s.behind.addr)].filter(Boolean).join(" → ");
};

export function softwareRows(m: Machine, hosts: Host[]): SoftwareRow[] {
  const left = new Set(hosts.filter((r) => r.service?.name && (r.host_ip || r.ip) === m.ip));
  const take = (name: string): Host[] => {   // an Apache site is named « apache2 · its vhost »
    const found = [...left].filter((r) => r.service!.name === name || r.service!.name!.startsWith(`${name} · `));
    found.forEach((r) => left.delete(r));
    return found;
  };
  const reached = (found: Host[]) => ({
    domains: [...new Set(found.flatMap((r) => r.domains.slice(0, 1)))],
    paths: found.filter((r) => r.type === "proxy" && r.domains.length).map(pathOf),
  });
  const containers = m.containers ?? [], web = m.web ?? [];
  const webRows = web.map((w): SoftwareRow => {
    const c = w.mode === "docker" ? containers.find((x) => x.name === w.name) : undefined;
    return { key: `web/${w.key}/${w.mode}/${w.name}`, order: 0, name: w.label, mode: w.mode, box: w.name, image: c?.image, status: c?.status, up: w.up, hostNet: w.host_net,
      ports: w.ports, localPorts: c?.local_ports ?? [], ...reached(take(w.name)), web: w, alone: false };
  });
  const inWeb = new Set(web.filter((w) => w.mode === "docker").map((w) => w.name));
  const boxRows = containers.filter((c) => !inWeb.has(c.name)).map((c): SoftwareRow => {
    const found = take(c.name);
    return { key: `box/${c.name}`, order: 0, name: c.name, mode: "docker", box: c.name, image: c.image, status: c.status, up: c.up, hostNet: c.host_net,
      ports: c.ports, localPorts: c.local_ports, ...reached(found), alone: !found.length };
  });
  const siteRows = [...new Set([...left].filter((r) => r.type === "proxy" && r.domains.length).map((r) => r.service!.name!))].map((name): SoftwareRow => (
    { key: `site/${name}`, order: 0, name, mode: "service", box: name, up: true, hostNet: false, ports: [], localPorts: [], ...reached(take(name)), alone: false }));
  const units = new Map((m.info?.units ?? []).map((u) => [u.name, u.own]));
  const unitOf = (name: string) => [name, name.replace(/d$/, "")].find((n) => units.has(n));   // the process sshd is the unit ssh
  [...web.map((w) => w.name), ...siteRows.map((r) => r.name)].forEach((name) => units.delete(unitOf(name) ?? ""));
  const program = (name: string, ports: number[], mode: SoftwareMode, own?: boolean): SoftwareRow => (
    { key: `program/${name}`, order: 0, name, mode, box: name, up: true, hostNet: false, ports, localPorts: [], domains: [], paths: [], alone: false, program: true, own,
      system: !own && !ports.length }
  );
  const processRows = [...new Set([...left].filter((r) => r.service!.kind === "process").map((r) => r.service!.name!))].map((name) => {
    const ports = [...new Set(take(name).flatMap((r) => r.port ?? []))].sort((a, b) => a - b), unit = unitOf(name) ?? "", own = units.get(unit);
    units.delete(unit);
    return program(name, ports, unit ? "service" : "process", own);
  });
  const programs = [...processRows, ...[...units].map(([name, own]) => program(name, [], "service", own))];
  const rank = (r: SoftwareRow) => Number(r.alone) + Number(!r.up);
  const byName = (a: SoftwareRow, b: SoftwareRow) => a.name.localeCompare(b.name);
  const others = [...boxRows, ...siteRows].sort((a, b) => rank(a) - rank(b) || byName(a, b));
  programs.sort((a, b) => Number(a.system) - Number(b.system) || byName(a, b));
  return [...webRows, ...others, ...programs].map((r, order) => ({ ...r, order }));
}

export function matchesFilter(r: SoftwareRow, filter: SoftwareFilter): boolean {
  if (filter === "web") return !!r.web;
  if (filter === "docker") return r.mode === "docker";
  if (filter === "program") return !!r.program && !r.system;
  if (filter === "system") return !!r.system;
  return filter === "all" ? !r.system : r.alone;
}
