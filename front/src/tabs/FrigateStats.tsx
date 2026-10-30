// « Frigate » sub-page of Video and cameras: what each Frigate says about its own load (/api/stats): detectors, GPUs, the processes of each camera,
// storage, temperatures. Read with the other connector figures at each collection: no probe of its own.
import { Cpu, Gauge, HardDrive, MonitorCog, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { FrigateProc, ServiceStatus } from "../types";
import { dur } from "../lib/format";
import { tx } from "../lib/i18n";
import { Dim, Empty, GradientFill, Td, Th } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { InfoNote } from "../components/InfoNote";
import { FoldPanel } from "../components/FoldPanel";

const SLOW_MS = 100;   // a detector slower than this is told apart (same limit as the alert of the page)
const num = (v?: number | null, unit = "", digits = 0) => (v == null ? "-" : `${v.toFixed(digits)}${unit}`);
const proc = (p?: FrigateProc) => (p?.cpu == null && p?.mem == null ? "-" : `${num(p.cpu, " %", 1)} · ${num(p.mem, " %", 1)}`);
const mo = (v?: number | null) => (v == null ? "-" : v >= 1048576 ? `${(v / 1048576).toFixed(1)} To` : v >= 1024 ? `${(v / 1024).toFixed(v >= 10240 ? 0 : 1)} Go` : `${Math.round(v)} Mo`);

function Table({ head, children }: Readonly<{ head: ReactNode; children: ReactNode }>) {
  return (
    <div className="-m-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr>{head}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">{children}</tbody>
      </table>
    </div>
  );
}

/** One block of the page, in the same frame as the Services page */
function Section({ id, title, icon, count, children }: Readonly<{ id: string; title: string; icon: LucideIcon; count?: number; children: ReactNode }>) {
  return <FoldPanel id={`frigate-${id}`} icon={icon} title={title} count={count} pinned>{children}</FoldPanel>;
}

function One({ s }: Readonly<{ s: ServiceStatus }>) {
  const f = s.frigate!;
  const slowest = Math.max(0, ...f.detectors.map((d) => d.ms ?? 0));
  const temps = Object.entries(f.temperatures);
  const update = f.latest_version && f.version && f.latest_version !== f.version;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Gauge size={16} aria-hidden />{s.name}{f.version && <span className="ml-2 text-sm font-normal text-dim">{tx("version {0}", f.version)}</span>}</h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={f.uptime == null ? "-" : dur(f.uptime)} label={tx("En marche depuis")} sub={update ? tx("{0} disponible", f.latest_version!) : tx("à jour")} tone={update ? "warn" : undefined} />
        <StatTile n={f.detectors.length ? `${slowest.toFixed(0)} ms` : "-"} label={tx("Détection la plus lente")} tone={slowest > SLOW_MS ? "warn" : undefined} sub={tx("{0} détecteur(s)", f.detectors.length)} />
        <StatTile n={f.cameras.length} label={tx("Caméras")} sub={tx("{0} en panne", f.cameras.filter((c) => c.fps === 0).length)} tone={f.cameras.some((c) => c.fps === 0) ? "warn" : undefined} />
        {temps.length > 0 && <StatTile n={`${Math.max(...temps.map(([, v]) => v)).toFixed(0)} °C`} label={tx("Température")} sub={temps.map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" · ")} />}
      </div>
      {f.detectors.length > 0 && <Section id="detectors" title={tx("Détecteurs")} icon={Cpu} count={f.detectors.length}>
        <Table head={<><Th>{tx("Détecteur")}</Th><Th className="text-right">{tx("Temps d'inférence")}</Th><Th>{tx("Processeur · mémoire")}</Th></>}>
          {f.detectors.map((d) => <tr key={d.name}><Td className="font-semibold">{d.name}</Td><Td className={`text-right tabular-nums ${(d.ms ?? 0) > SLOW_MS ? "text-warn" : ""}`}>{num(d.ms, " ms", 1)}</Td><Td>{proc(d)}</Td></tr>)}
        </Table>
      </Section>}
      {f.gpus.length > 0 && <Section id="gpus" title={tx("Cartes graphiques")} icon={MonitorCog} count={f.gpus.length}>
        <Table head={<><Th>{tx("Carte")}</Th><Th className="text-right">GPU</Th><Th className="text-right">{tx("Mémoire")}</Th><Th className="text-right">{tx("Encodage")}</Th><Th className="text-right">{tx("Décodage")}</Th></>}>
          {f.gpus.map((g) => <tr key={g.name}><Td className="font-semibold">{g.name}</Td><Td className="text-right tabular-nums">{num(g.gpu, " %", 1)}</Td><Td className="text-right tabular-nums">{num(g.mem, " %", 1)}</Td><Td className="text-right tabular-nums">{num(g.enc, " %", 1)}</Td><Td className="text-right tabular-nums">{num(g.dec, " %", 1)}</Td></tr>)}
        </Table>
      </Section>}
      {f.cameras.length > 0 && <Section id="cameras" title={tx("Caméras et leurs processus")} icon={Video} count={f.cameras.length}>
        <Table head={<><Th>{tx("Caméra")}</Th><Th className="text-right">{tx("Capture i/s")}</Th><Th className="text-right">{tx("Traitées i/s")}</Th><Th className="text-right">{tx("Détection i/s")}</Th><Th className="text-right">{tx("Perdues i/s")}</Th><Th>{tx("ffmpeg (proc. · mém.)")}</Th><Th>{tx("Détection (proc. · mém.)")}</Th></>}>
          {f.cameras.map((c) => <tr key={c.name}><Td className="font-semibold">{c.name}</Td><Td className={`text-right tabular-nums ${c.fps === 0 ? "text-bad" : ""}`}>{num(c.fps, "", 1)}</Td><Td className="text-right tabular-nums">{num(c.process_fps, "", 1)}</Td><Td className="text-right tabular-nums">{num(c.detection_fps, "", 1)}</Td><Td className={`text-right tabular-nums ${(c.skipped_fps ?? 0) > 0 ? "text-warn" : ""}`}>{num(c.skipped_fps, "", 1)}</Td><Td>{proc(c.ffmpeg)}</Td><Td>{proc(c.detect)}</Td></tr>)}
        </Table>
      </Section>}
      {f.storage.length > 0 && <Section id="storage" title={tx("Stockage")} icon={HardDrive} count={f.storage.length}>
        <Table head={<><Th>{tx("Dossier")}</Th><Th className="text-right">{tx("Utilisé")}</Th><Th className="text-right">{tx("Libre")}</Th><Th className="w-48">{tx("Remplissage")}</Th></>}>
          {f.storage.map((d) => {
            const pct = d.total ? Math.round(100 * (d.total - (d.free ?? 0)) / d.total) : null;
            return <tr key={d.path}><Td className="font-mono text-xs">{d.path}</Td><Td className="text-right tabular-nums">{mo(d.used)}</Td><Td className="text-right tabular-nums">{mo(d.free)}</Td>
              <Td>{pct == null ? <Dim>-</Dim> : <span className="flex items-center gap-2"><span className="h-2 w-32 overflow-hidden rounded-full bg-bg2"><GradientFill pct={pct} /></span><span className="tabular-nums">{pct} %</span></span>}</Td></tr>;
          })}
        </Table>
      </Section>}
    </div>
  );
}

export function FrigateStats({ statuses }: Readonly<{ statuses: ServiceStatus[] }>) {
  const read = statuses.filter((s) => s.connector === "frigate" && s.frigate);
  if (!read.length) return <Empty>{tx("Aucun Frigate lu : reliez un connecteur Frigate dans Connecteurs.")}</Empty>;
  return (
    <>
      <InfoNote>{tx("Ce que Frigate dit de sa propre charge (détecteurs, cartes graphiques, processus de chaque caméra, stockage). Lu à chaque collecte, sans sonde en plus.")}</InfoNote>
      {read.map((s) => <One key={s.name} s={s} />)}
    </>
  );
}
