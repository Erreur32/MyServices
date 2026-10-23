// Accueil → Statistiques : une ligne de chiffres clés, puis les compteurs de chaque sujet en grille (deux colonnes, trois sur
// un très grand écran) et les horaires ; clic sur le titre d'un groupe = ouvrir sa page, clic sur un compteur = l'ouvrir filtrée.
import { Boxes, HardDrive, HeartPulse, Layers, Monitor, PackageCheck, Plug } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { read } from "../api";
import { StatTile } from "./StatTile";
import { pct, tileTone, type Report } from "../tabs/Availability";
import type { Snapshot } from "../api";
import { CLEANUP, checks, dnsSync, status } from "../lib/status";
import { mState } from "../lib/machines";
import type { TabId } from "../lib/summary";
import { tx } from "../lib/i18n";
import { ScheduleCard } from "./ScheduleCard";
import { hasNetwork } from "../lib/network";
import { connectorCounts, networkCounts, upkeepCounts, virtualCounts } from "../lib/statsExtra";
import { NetworkGroup } from "./NetworkGroup";
import { Group, Mark, type Open } from "./StatGroup";
import type { Selected } from "../lib/filter";

/** Groupes de compteurs, par onglet : la colonne de droite les empile tous, l'accueil range chacun sous son paragraphe */
export function statGroups(snap: Snapshot, nav: Open): Partial<Record<TabId, ReactNode[]>> {
  const { data, health, backups } = snap;
  const npm = data.hosts.filter((r) => r.type !== "local"), local = data.hosts.filter((r) => r.type === "local");
  const n = (rows: typeof npm, cls: string) => rows.filter((r) => r.enabled && status(r)[0] === cls).length;
  const hl = (l: string) => (health?.hosts || []).filter((h) => (h.reachable === false ? "down" : h.level) === l).length;
  const dns = data.dns;
  const ms = (data.machine_list || []).filter((m) => !m.disabled), ml = (...st: ReturnType<typeof mState>[]) => ms.filter((m) => st.includes(mState(m))).length;
  const groups = [
    ms.length > 0 && <Group key="mc" mark={<Mark Icon={Monitor} />} title={tx("🖥 Machines")} sub={tx("{0} machines", ms.length)} accent="border-l-muted" tab="machines" nav={nav} cells={[
      ["ok", ml("ssh", "manual"), tx("SSH OK"), { state: ["ssh", "manual"] }], ["warn", ml("nossh", "refused"), tx("à régler"), { state: ["nossh", "refused"] }],
      ["off", ml("off"), tx("éteintes"), { state: ["off"] }], ["bad", ml("down"), tx("injoignables"), { state: ["down"] }]]} />,
    npm.length > 0 && <Group key="npm" mark={<Mark app="Nginx Proxy Manager" Icon={Boxes} />} title={tx("NPM")} sub={tx("{0} entrées", npm.length)} accent="border-l-npm" tab="services" nav={nav} cells={[
      ["ok", n(npm, "ok"), tx("OK"), { src: ["npm"], status: ["ok"] }], ["bad", n(npm, "bad"), tx("en panne"), { src: ["npm"], status: ["bad"] }],
      ["warn", npm.filter((r) => checks(r).some((c) => !CLEANUP.includes(c))).length, tx("à corriger"), { src: ["npm"], check: [...new Set(npm.flatMap(checks).filter((c) => !CLEANUP.includes(c)))] }],
      ["off", npm.filter((r) => !r.enabled).length, tx("désactivés"), { src: ["npm"], status: ["off"] }]]} />,
    local.length > 0 && <Group key="loc" mark={<Mark app="Docker" Icon={Boxes} />} title={tx("Services")} sub={tx("{0} services", local.length)} accent="border-l-loc" tab="services" nav={nav} cells={[
      ["ok", n(local, "ok"), tx("en ligne"), { src: ["local"], status: ["ok"] }], ["bad", n(local, "bad"), "down", { src: ["local"], status: ["bad"] }],
      ["warn", local.filter((r) => r.web === "ui" && !r.direct_ok).length, tx("UI sans domaine"), { src: ["local"] }], ["off", n(local, "off"), tx("non testés"), { src: ["local"], status: ["off"] }]]} />,
    health && <Group key="hl" mark={<Mark Icon={HeartPulse} tone="text-ok" />} title={tx("🩺 Santé")} sub={tx("{0} machines", health.hosts.length)} accent="border-l-ok" tab="machines" nav={nav} cells={[
      ["ok", hl("ok"), tx("OK"), { health: ["ok"] }], ["warn", hl("warn"), tx("à surveiller"), { health: ["warn"] }], ["bad", hl("crit"), tx("critiques"), { health: ["crit"] }], ["bad", hl("down"), tx("injoignables"), { health: ["down"] }]]} />,
    dns && <Group key="dns" mark={<Mark app="AdGuard Home" Icon={Boxes} />} title={tx("🌍 AdGuard")} sub={dnsSync(dns, Date.parse(data.generated)).label} accent="border-l-link" tab="dns" nav={nav} cells={[
      ["ok", data.hosts.filter((r) => r.dns && r.enabled && !r.dns.issues.length).length, tx("domaines OK"), { anchor: ["domains"] }],
      ["warn", data.hosts.filter((r) => r.dns && r.enabled && r.dns.issues.length).length, tx("à vérifier"), { anchor: ["domains"] }],
      ["warn", dns.orphans.length, tx("orphelines"), { anchor: ["orphans"] }],
      ["bad", Object.values(dns.servers).filter((s) => !s.readable || s.silent).length, tx("injoignables"), { anchor: ["servers"] }]]} />,
    backups && <Group key="bk" mark={<Mark Icon={HardDrive} />} title={tx("💾 Sauvegardes")} sub={tx("{0} jeux", backups.summary.sets)} accent="border-l-apache" tab="backups" nav={nav} cells={[
      ["ok", backups.summary.ok, tx("à jour"), { state: ["ok"] }], ["warn", backups.summary.warn, tx("en retard"), { state: ["warn"] }],
      ["bad", backups.summary.crit, tx("critiques"), { state: ["crit", "down"] }], ["bad", backups.summary.no_offsite, tx("sans copie")]]} />,
    hasNetwork(snap) && <NetworkGroup key="net" tab="network" snap={snap} nav={nav} counts={networkCounts(snap)} />,
    ...extraGroups(snap, nav),
  ];
  const byTab: Partial<Record<TabId, ReactNode[]>> = {};
  for (const g of groups) {
    if (!g || typeof g !== "object" || !("props" in g)) continue;
    const tab = g.props.tab as TabId;
    const list = byTab[tab] ?? [];
    list.push(g);
    byTab[tab] = list;
  }
  return byTab;
}

/** Connectors and agents, virtual machines, updates and certificates: worked out from the snapshot (lib/statsExtra.ts) */
function extraGroups(snap: Snapshot, nav: Open): ReactNode[] {
  const out: ReactNode[] = [], c = connectorCounts(snap), v = virtualCounts(snap), u = upkeepCounts(snap);
  if (c.ok + c.failing + c.agents > 0)
    out.push(<Group key="co" mark={<Mark Icon={Plug} />} title={tx("Connecteurs et agents")} sub={tx("{0} connecteurs", c.ok + c.failing)} accent="border-l-muted" tab="settings" nav={nav} cells={[
      ["ok", c.ok, tx("répondent")], ["bad", c.failing, tx("en erreur")], ["ok", c.agents, tx("agents")]]} />);
  if (v.guests + v.nodesDown > 0)
    out.push(<Group key="vi" mark={<Mark Icon={Layers} />} title={tx("Virtualisation")} sub={tx("{0} invités", v.guests)} accent="border-l-loc" tab="virtualization" nav={nav} cells={[
      ["ok", v.running, tx("en marche")], ["off", v.stopped, tx("arrêtés")], ["bad", v.nodesDown, tx("nœuds hors ligne")], ["warn", v.problems, tx("à voir")]]} />);
  if (snap.health || snap.data.hosts.length > 0)
    out.push(<Group key="up" mark={<Mark Icon={PackageCheck} />} title={tx("Mises à jour et certificats")} sub={tx("{0} machines relevées", snap.health?.hosts.length ?? 0)} accent="border-l-apache" tab="machines" nav={nav} cells={[
      ["warn", u.updates, tx("à mettre à jour")], ["warn", u.reboot, tx("à redémarrer")], ["warn", u.certSoon, tx("certificats bientôt")], ["bad", u.certBad, tx("certificats invalides")]]} />);
  return out;
}

type Tone = "ok" | "warn" | "bad";
/** Part that is fine: green when all, orange from one problem, red under 80 % */
function ratioTone(good: number, total: number): Tone | undefined {
  if (!total) return undefined;
  if (good === total) return "ok";
  return good / total >= 0.8 ? "warn" : "bad";
}

/** Average availability over 7 days (services and machines, weighted by their readings); null while unread or without readings */
function useWeekAvailability(generated: string): number | null {
  const [avg, setAvg] = useState<number | null>(null);
  useEffect(() => {
    read<Report>("availability?days=7").then((r) => {
      const n = r.items.reduce((s, x) => s + x.samples, 0);
      setAvg(n ? (100 * r.items.reduce((s, x) => s + x.samples - x.down, 0)) / n : null);
    }).catch(() => setAvg(null));
  }, [generated]);
  return avg;
}

/** The key figures on top: each one a ratio of what is fine */
function KeyFigures({ snap }: Readonly<{ snap: Snapshot }>) {
  const { data, health, backups } = snap;
  const ms = (data.machine_list || []).filter((m) => !m.disabled), up = ms.filter((m) => mState(m) !== "down").length;
  const hosts = data.hosts.filter((r) => r.enabled && status(r)[0] !== "off"), online = hosts.filter((r) => status(r)[0] === "ok").length;
  const hOk = (health?.hosts ?? []).filter((h) => h.reachable !== false && h.level === "ok").length, hAll = health?.hosts.length ?? 0;
  const c = connectorCounts(snap), week = useWeekAvailability(data.generated);
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      <StatTile n={`${up}/${ms.length}`} label={tx("Machines joignables")} tone={ratioTone(up, ms.length)} />
      <StatTile n={`${online}/${hosts.length}`} label={tx("Services en ligne")} tone={ratioTone(online, hosts.length)} />
      {hAll > 0 && <StatTile n={`${hOk}/${hAll}`} label={tx("Santé OK")} tone={ratioTone(hOk, hAll)} />}
      {backups && <StatTile n={`${backups.summary.ok}/${backups.summary.sets}`} label={tx("Sauvegardes à jour")} tone={ratioTone(backups.summary.ok, backups.summary.sets)} />}
      {c.ok + c.failing > 0 && <StatTile n={`${c.ok}/${c.ok + c.failing}`} label={tx("Connecteurs qui répondent")} tone={ratioTone(c.ok, c.ok + c.failing)} />}
      {week != null && <StatTile n={pct(week)} label={tx("Disponibilité sur 7 jours")} tone={tileTone(week)} sub={tx("services et machines")} />}
    </div>
  );
}

export function StatsPage({ snap, go, goFilter }: Readonly<{ snap: Snapshot; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <KeyFigures snap={snap} />
      <section className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label={tx("Compteurs")}>
        {Object.values(statGroups(snap, { go, goFilter })).flat()}
      </section>
      <ScheduleCard />
    </div>
  );
}
