// Home page figures: a line of key figures, then the counters of each subject in a compact grid (two to four columns with the width);
// a click on a group title opens its page, a click on a counter opens it filtered.
import { Boxes, HardDrive, HeartPulse, Layers, Monitor, PackageCheck, Plug, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { read } from "../api";
import { StatTile } from "./StatTile";
import { pct, tileTone, type Report } from "../tabs/Availability";
import type { Snapshot } from "../api";
import { CLEANUP, checks, dnsSync, status } from "../lib/status";
import { mState } from "../lib/machines";
import type { TabId } from "../lib/summary";
import { tx } from "../lib/i18n";
import { hasNetwork } from "../lib/network";
import { connectorCounts, networkCounts, upkeepCounts, virtualCounts, wazuhCounts } from "../lib/statsExtra";
import { NetworkGroup } from "./NetworkGroup";
import { Group, Mark, type Cell, type Open } from "./StatGroup";
import type { Selected } from "../lib/filter";
import { hiddenNow, isHidden } from "../lib/servicesHidden";
import { keyCounts } from "../lib/homeStory";

/** Groupes de compteurs, par onglet : la colonne de droite les empile tous, l'accueil range chacun sous son paragraphe */
export function statGroups(snap: Snapshot, nav: Open): Partial<Record<TabId, ReactNode[]>> {
  const { data, health, backups } = snap;
  const npm = data.hosts.filter((r) => r.type !== "local"), local = data.hosts.filter((r) => r.type === "local");
  const hidden = hiddenNow(), followed = (r: (typeof npm)[number]) => !isHidden(r, hidden);   // a service hidden from « To watch » is no longer counted as down or to fix
  const n = (rows: typeof npm, cls: string) => rows.filter((r) => r.enabled && status(r)[0] === cls && (cls !== "bad" || followed(r))).length;
  const hl = (l: string) => (health?.hosts || []).filter((h) => (h.reachable === false ? "down" : h.level) === l).length;
  const dns = data.dns;
  const ms = (data.machine_list || []).filter((m) => !m.disabled), ml = (...st: ReturnType<typeof mState>[]) => ms.filter((m) => st.includes(mState(m))).length;
  const groups = [
    ms.length > 0 && <Group key="mc" mark={<Mark Icon={Monitor} />} title={tx("🖥 Machines")} sub={tx("{0} machines", ms.length)} accent="border-l-muted" tab="machines" nav={nav} cells={[
      ["ok", ml("ssh", "manual"), tx("SSH OK"), { state: ["ssh", "manual"] }], ["warn", ml("nossh", "refused"), tx("à régler"), { state: ["nossh", "refused"] }],
      ["off", ml("off"), tx("éteintes"), { state: ["off"] }], ["bad", ml("down"), tx("injoignables"), { state: ["down"] }]]} />,
    npm.length > 0 && <Group key="npm" mark={<Mark app="Nginx Proxy Manager" Icon={Boxes} />} title={tx("NPM")} sub={tx("{0} entrées", npm.length)} accent="border-l-npm" tab="services" nav={nav} cells={[
      ["ok", n(npm, "ok"), tx("OK"), { src: ["npm"], status: ["ok"] }], ["bad", n(npm, "bad"), tx("en panne"), { src: ["npm"], status: ["bad"] }],
      ["warn", npm.filter((r) => followed(r) && checks(r).some((c) => !CLEANUP.includes(c))).length, tx("à corriger"), { src: ["npm"], check: [...new Set(npm.flatMap(checks).filter((c) => !CLEANUP.includes(c)))] }],
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
  const w = wazuhCounts(snap);
  if (w)
    out.push(<Group key="wz" mark={<Mark app="Wazuh" Icon={ShieldCheck} />} title="Wazuh" sub={tx("{0} agents", w.total)} accent="border-l-link" tab="security" href="security/wazuh" nav={nav} cells={[
      ["ok", w.active, tx("actifs")], ["bad", w.disconnected, tx("déconnectés")],
      ...(w.serious != null ? [["bad", w.serious, tx("alertes graves 24 h")] as Cell] : [["warn", w.never, tx("jamais connectés")] as Cell]),
      ...(w.critical != null ? [["bad", w.critical, tx("vulnérabilités critiques")] as Cell] : [])]} />);
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

/** The key figures on top: each one a ratio of what is fine, a click opens its page */
export function KeyFigures({ snap, go }: Readonly<{ snap: Snapshot; go: (t: TabId) => void }>) {
  const k = keyCounts(snap), week = useWeekAvailability(snap.data.generated);
  return (
    <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label={tx("Chiffres clés")}>
      <StatTile n={`${k.machinesUp}/${k.machines}`} label={tx("Machines joignables")} sub={tx("{0} éteinte(s) exprès", k.machinesOff)} tone={ratioTone(k.machinesUp, k.machines)} onClick={() => go("machines")} />
      <StatTile n={`${k.servicesUp}/${k.services}`} label={tx("Services en ligne")} sub={tx("sites et applis du parc")} tone={ratioTone(k.servicesUp, k.services)} onClick={() => go("services")} />
      {k.health > 0 && <StatTile n={`${k.healthOk}/${k.health}`} label={tx("Santé")} sub={tx("disques et mémoire")} hint={tx("Machines dont tous les contrôles de santé sont bons : disques, SMART, mémoire, charge, température, noyau, systemd, Docker, SSH")} tone={ratioTone(k.healthOk, k.health)} onClick={() => go("machines")} />}
      {k.backups > 0 && <StatTile n={`${k.backupsOk}/${k.backups}`} label={tx("Sauvegardes à jour")} sub={tx("{0} jeu(x) suivis", k.backups)} tone={ratioTone(k.backupsOk, k.backups)} onClick={() => go("backups")} />}
      {k.connectors > 0 && <StatTile n={`${k.connectorsOk}/${k.connectors}`} label={tx("Connecteurs qui répondent")} sub={tx("tes outils reliés")} tone={ratioTone(k.connectorsOk, k.connectors)} />}
      {week != null && <StatTile n={pct(week)} label={tx("Disponibilité sur 7 jours")} tone={tileTone(week)} sub={tx("services et machines")} />}
    </nav>
  );
}

/** « Tout ton parc en chiffres »: the counters of every subject */
export function Counters({ snap, go, goFilter }: Readonly<{ snap: Snapshot; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }>) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm" aria-label={tx("Tout ton parc en chiffres")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 bg-bg px-4 py-2">
        <h2 className="text-sm font-bold">{tx("Tout ton parc en chiffres")}</h2>
        <span className="text-xs text-dim">{tx("Clique sur un chiffre pour ouvrir la liste filtrée")}</span>
      </div>
      <div className="grid items-start gap-2 p-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Object.values(statGroups(snap, { go, goFilter })).flat()}</div>
    </section>
  );
}
