// Compteurs de l'en-tête de la page actuelle (NPM, directs, santé, sauvegardes, AdGuard), en colonne à droite
// de l'accueil ; clic = ouvrir l'onglet.
import { Boxes, HardDrive, HeartPulse, Monitor, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Snapshot } from "../api";
import { CLEANUP, checks, dnsSync, status } from "../lib/status";
import { mState } from "../lib/machines";
import type { TabId } from "../lib/summary";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { ScheduleCard } from "./ScheduleCard";

type Tone = "ok" | "warn" | "bad" | "off";
const TONE: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", off: "text-muted" };

/** Vrai logo de l'appli quand il existe, sinon une icône du thème */
function Mark({ app, Icon, tone = "text-muted" }: { app?: string; Icon: LucideIcon; tone?: string }) {
  const src = app ? appIcon([app]) : null;
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2">{src ? <img src={src} alt="" className="h-4 w-4" /> : <Icon size={14} className={tone} aria-hidden />}</span>;
}

function Group({ title, sub, accent, tab, go, cells, mark }: {
  mark: ReactNode; title: string; sub: string; accent: string; tab: TabId; go: (t: TabId) => void; cells: [Tone, number, string][];
}) {
  return (
    <button type="button" onClick={() => go(tab)}
      className={`w-full rounded-xl border border-line border-l-4 ${accent} bg-card p-3 text-left hover:border-link`}>
      <div className="flex items-center justify-between gap-2">
        <b className="flex min-w-0 items-center gap-2 text-sm">{mark}<span className="truncate">{title.replace(/^\p{Extended_Pictographic}\s*/u, "")}</span></b><span className="shrink-0 text-xs text-dim">{sub}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {cells.map(([tone, n, label]) => (
          <div key={label} className={`rounded-lg bg-bg2 px-1.5 py-1 text-center ${n ? "" : "opacity-40"}`}>
            <div className={`font-mono text-base font-bold ${TONE[tone]}`}>{n}</div>
            <div className="truncate text-[10.5px] text-muted" title={label}>{label}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

/** Groupes de compteurs, par onglet : la colonne de droite les empile tous, l'accueil range chacun sous son paragraphe */
export function statGroups(snap: Snapshot, go: (t: TabId) => void): Partial<Record<TabId, ReactNode[]>> {
  const { data, health, backups } = snap;
  const npm = data.hosts.filter((r) => r.type !== "local"), local = data.hosts.filter((r) => r.type === "local");
  const n = (rows: typeof npm, cls: string) => rows.filter((r) => r.enabled && status(r)[0] === cls).length;
  const hl = (l: string) => (health?.hosts || []).filter((h) => (h.reachable === false ? "down" : h.level) === l).length;
  const dns = data.dns;
  const ms = (data.machine_list || []).filter((m) => !m.disabled), ml = (...st: ReturnType<typeof mState>[]) => ms.filter((m) => st.includes(mState(m))).length;
  const groups = [
    ms.length > 0 && <Group key="mc" mark={<Mark Icon={Monitor} />} title={tx("🖥 Machines")} sub={tx("{0} machines", ms.length)} accent="border-l-muted" tab="machines" go={go} cells={[
      ["ok", ml("ssh", "manual"), tx("SSH OK")], ["warn", ml("nossh", "refused"), tx("à régler")],
      ["off", ml("off"), tx("éteintes")], ["bad", ml("down"), tx("injoignables")]]} />,
    npm.length > 0 && <Group key="npm" mark={<Mark app="Nginx Proxy Manager" Icon={Boxes} />} title={tx("NPM")} sub={tx("{0} entrées", npm.length)} accent="border-l-npm" tab="services" go={go} cells={[
      ["ok", n(npm, "ok"), tx("OK")], ["bad", n(npm, "bad"), tx("en panne")],
      ["warn", npm.filter((r) => checks(r).some((c) => !CLEANUP.includes(c))).length, tx("à corriger")],
      ["off", npm.filter((r) => !r.enabled).length, tx("désactivés")]]} />,
    local.length > 0 && <Group key="loc" mark={<Mark app="Docker" Icon={Boxes} />} title={tx("Services")} sub={tx("{0} services", local.length)} accent="border-l-loc" tab="services" go={go} cells={[
      ["ok", n(local, "ok"), tx("en ligne")], ["bad", n(local, "bad"), "down"],
      ["warn", local.filter((r) => r.web === "ui" && !r.direct_ok).length, tx("UI sans domaine")], ["off", n(local, "off"), tx("non testés")]]} />,
    health && <Group key="hl" mark={<Mark Icon={HeartPulse} tone="text-ok" />} title={tx("🩺 Santé")} sub={tx("{0} machines", health.hosts.length)} accent="border-l-ok" tab="health" go={go} cells={[
      ["ok", hl("ok"), tx("OK")], ["warn", hl("warn"), tx("à surveiller")], ["bad", hl("crit"), tx("critiques")], ["bad", hl("down"), tx("injoignables")]]} />,
    dns && <Group key="dns" mark={<Mark app="AdGuard Home" Icon={Boxes} />} title={tx("🌍 AdGuard")} sub={dnsSync(dns).label} accent="border-l-link" tab="dns" go={go} cells={[
      ["ok", data.hosts.filter((r) => r.dns && r.enabled && !r.dns.issues.length).length, tx("domaines OK")],
      ["warn", data.hosts.filter((r) => r.dns && r.enabled && r.dns.issues.length).length, tx("à vérifier")],
      ["warn", dns.orphans.length, tx("orphelines")],
      ["bad", Object.values(dns.servers).filter((s) => !s.readable || s.silent).length, tx("injoignables")]]} />,
    backups && <Group key="bk" mark={<Mark Icon={HardDrive} />} title={tx("💾 Sauvegardes")} sub={tx("{0} jeux", backups.summary.sets)} accent="border-l-apache" tab="backups" go={go} cells={[
      ["ok", backups.summary.ok, tx("à jour")], ["warn", backups.summary.warn, tx("en retard")],
      ["bad", backups.summary.crit, tx("critiques")], ["bad", backups.summary.no_offsite, tx("sans copie")]]} />,
  ];
  const byTab: Partial<Record<TabId, ReactNode[]>> = {};
  for (const g of groups) if (g && typeof g === "object" && "props" in g) (byTab[g.props.tab as TabId] ??= []).push(g);
  return byTab;
}

export function StatsColumn({ snap, go }: { snap: Snapshot; go: (t: TabId) => void }) {
  return <aside className="flex flex-col gap-2.5" aria-label={tx("Compteurs")}>{Object.values(statGroups(snap, go)).flat()}<ScheduleCard /></aside>;
}
