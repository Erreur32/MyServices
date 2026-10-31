// « Frigate » sub-page of Video and cameras: what each Frigate says about its own load (/api/stats): detectors, GPUs, the processes of each camera,
// storage, temperatures. Read with the other connector figures at each collection: no probe of its own.
import { Cpu, Gauge, HardDrive, MonitorCog, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { FrigateProc, FrigateSystem, ServiceStatus } from "../types";
import { dur } from "../lib/format";
import { tx } from "../lib/i18n";
import { Empty, GradientFill, Td, Th } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { InfoNote } from "../components/InfoNote";
import { FoldPanel } from "../components/FoldPanel";

const SLOW_MS = 100;   // a detector slower than this is told apart (same limit as the alert of the page)
const num = (v?: number | null, unit = "", digits = 0) => (v == null ? "-" : `${v.toFixed(digits)}${unit}`);
const proc = (p?: FrigateProc) => (p?.cpu == null && p?.mem == null ? "-" : `${num(p.cpu, " %", 1)} · ${num(p.mem, " %", 1)}`);
const mo = (v?: number | null) => (v == null ? "-" : v >= 1048576 ? `${(v / 1048576).toFixed(1)} To` : v >= 1024 ? `${(v / 1024).toFixed(v >= 10240 ? 0 : 1)} Go` : `${Math.round(v)} Mo`);

function Table({ head, foot, children }: Readonly<{ head: ReactNode; foot?: string; children: ReactNode }>) {
  return (
    <div className="-m-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr>{head}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">{children}</tbody>
      </table>
      {foot && <p className="px-4 py-2 text-xs text-dim">{foot}</p>}
    </div>
  );
}

const Bar = ({ pct }: Readonly<{ pct?: number | null }>) => <span className="block h-2 overflow-hidden rounded-full bg-bg2">{pct != null && <GradientFill pct={pct} />}</span>;

function Meter({ label, value }: Readonly<{ label: string; value?: number | null }>) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      <span className="flex justify-between">{label}<b className="font-semibold tabular-nums text-txt">{num(value, " %", 1)}</b></span>
      <Bar pct={value} />
    </div>
  );
}

function Disk({ d }: Readonly<{ d: FrigateSystem["storage"][number] }>) {
  const pct = d.total ? Math.round(100 * (d.total - (d.free ?? 0)) / d.total) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-bg/50 px-3 py-2.5">
      <div className="truncate font-mono text-xs" title={d.path}>{d.path}</div>
      <Bar pct={pct} />
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted">
        <span>{tx("{0} utilisés", mo(d.used))}</span><span>{tx("{0} libres", mo(d.free))}</span><b className="tabular-nums text-txt">{pct == null ? "-" : `${pct} %`}</b>
      </div>
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
  const side = f.detectors.length > 0 || f.gpus.length > 0;
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
      <div className="grid gap-3 xl:grid-cols-3">
        {f.cameras.length > 0 && <div className={`min-w-0 [&>section]:h-full ${side ? "xl:col-span-2" : "xl:col-span-3"}`}><Section id="cameras" title={tx("Caméras et leurs processus")} icon={Video} count={f.cameras.length}>
          <Table foot={tx("FFmpeg et Détection : processeur · mémoire.")} head={<><Th>{tx("Caméra")}</Th><Th className="text-right">{tx("Capture i/s")}</Th><Th className="text-right">{tx("Traitées i/s")}</Th><Th className="text-right">{tx("Détection i/s")}</Th><Th className="text-right">{tx("Perdues i/s")}</Th><Th className="text-right">FFmpeg</Th><Th className="text-right">{tx("Détection")}</Th></>}>
            {f.cameras.map((c) => <tr key={c.name}><Td className="font-semibold">{c.name}</Td><Td className={`text-right tabular-nums ${c.fps === 0 ? "text-bad" : ""}`}>{num(c.fps, "", 1)}</Td><Td className="text-right tabular-nums">{num(c.process_fps, "", 1)}</Td><Td className="text-right tabular-nums">{num(c.detection_fps, "", 1)}</Td><Td className={`text-right tabular-nums ${(c.skipped_fps ?? 0) > 0 ? "text-warn" : ""}`}>{num(c.skipped_fps, "", 1)}</Td><Td className="whitespace-nowrap text-right tabular-nums">{proc(c.ffmpeg)}</Td><Td className="whitespace-nowrap text-right tabular-nums">{proc(c.detect)}</Td></tr>)}
          </Table>
        </Section></div>}
        {side && <div className="flex min-w-0 flex-col gap-3 [&>section:last-child]:flex-1">
          {f.detectors.length > 0 && <Section id="detectors" title={tx("Détecteurs")} icon={Cpu} count={f.detectors.length}>
            <ul className="flex flex-col gap-2">
              {f.detectors.map((d) => <li key={d.name}>
                <div className="flex items-baseline justify-between gap-3"><b>{d.name}</b><span className={`font-mono text-lg font-bold ${(d.ms ?? 0) > SLOW_MS ? "text-warn" : ""}`}>{num(d.ms, " ms", 1)}</span></div>
                <div className="text-sm text-muted">{tx("processeur {0} · mémoire {1}", num(d.cpu, " %", 1), num(d.mem, " %", 1))}</div>
              </li>)}
            </ul>
          </Section>}
          {f.gpus.length > 0 && <Section id="gpus" title={tx("Cartes graphiques")} icon={MonitorCog} count={f.gpus.length}>
            <ul className="flex flex-col gap-3">
              {f.gpus.map((g) => <li key={g.name}>
                <b className="block truncate" title={g.name}>{g.name}</b>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2"><Meter label="GPU" value={g.gpu} /><Meter label={tx("Mémoire")} value={g.mem} /><Meter label={tx("Encodage")} value={g.enc} /><Meter label={tx("Décodage")} value={g.dec} /></div>
              </li>)}
            </ul>
          </Section>}
        </div>}
        {f.storage.length > 0 && <div className="min-w-0 xl:col-span-3"><Section id="storage" title={tx("Stockage")} icon={HardDrive} count={f.storage.length}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">{f.storage.map((d) => <Disk key={d.path} d={d} />)}</div>
        </Section></div>}
      </div>
    </div>
  );
}

export function FrigateStats({ statuses }: Readonly<{ statuses: ServiceStatus[] }>) {
  const read = statuses.filter((s) => s.connector === "frigate" && s.frigate);
  if (!read.length) return <Empty>{tx("Aucun Frigate lu : reliez un connecteur Frigate dans Connecteurs.")}</Empty>;
  return (
    <>
      <InfoNote>{tx("Ce que Frigate dit de sa propre charge. Lu à chaque collecte, sans sonde en plus.")}</InfoNote>
      {read.map((s) => <One key={s.name} s={s} />)}
    </>
  );
}
