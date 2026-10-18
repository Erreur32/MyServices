// Compteurs de l'en-tête de la page actuelle (NPM, directs, santé, sauvegardes, AdGuard), en colonne à droite
// de l'accueil ; clic sur le titre = ouvrir l'onglet, clic sur un compteur = l'ouvrir déjà filtré sur ce qu'il compte.
import { Boxes, HardDrive, HeartPulse, Layers, Monitor, PackageCheck, Plug } from "lucide-react";
import type { ReactNode } from "react";
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
  for (const g of groups) if (g && typeof g === "object" && "props" in g) (byTab[g.props.tab as TabId] ??= []).push(g);
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

export function StatsColumn({ snap, go, goFilter }: { snap: Snapshot; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }) {
  return <aside className="flex flex-col gap-2.5" aria-label={tx("Compteurs")}>{Object.values(statGroups(snap, { go, goFilter })).flat()}<ScheduleCard /></aside>;
}
