// Sauvegardes (backups.py) in « state » mode: four figures, then one view at a time: by machine (disks, latest local backup, copies, sets
// produced), to watch, and the sets (filters: in use, flagged, archived), each unfolding its detail; « Set » opens the page of the set in
// Backups → Settings. The local folders and cron lines no set claims are listed there too (« To link »).
import { usePageView } from "../lib/route";
import { ChevronDown, ChevronUp, HardDrive, Layers, Monitor, Plus, Terminal, SlidersHorizontal } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { type Snapshot } from "../api";
import { useFilter, type Facet, type Selected } from "../lib/filter";
import { ageDays, bytes, dateTime } from "../lib/format";
import type { BackupHost, BackupSet, Backups as BackupsData, Machine } from "../types";
import { Badge, Cards, ChipButton, Dim, Empty, Fill, FilterBar, Level, Pct, Table, TableCard, Td, Th } from "../components/ui";
import { FoldPanel } from "../components/FoldPanel";
import { LEVEL } from "../lib/level";
import { Dot } from "../components/marks";
import { primary, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { SettingsLink } from "../components/SettingsLink";
import { StatTile } from "../components/StatTile";
import { HistoryTile, useBackupsHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import type { TilePoint } from "../lib/tileHistory";
import { cronsOf, figures, newestOf, rank, sourceOf, unclaimedCrons } from "../lib/backupsState";
import { HeadTags } from "../components/HeadTags";
import { PageHead } from "../components/PageHead";
import { MachineIcon } from "../components/MachineIcon";
import { useStoredFlag } from "../lib/storedFlag";

const stateOf = (h: BackupHost) => (h.reachable || h.stopped ? h.level : "down");   // stopped: its connector switched off on purpose, not unreachable
const short = (label: string) => label.replace(/^[^:]*: /, "");

/** The unfolded detail of a set: what the server holds against it, every place, the cron line, the settings and the machine */
function SetDetail({ s, b, snap }: Readonly<{ s: BackupSet; b: BackupsData; snap: Snapshot }>) {
  const origin = b.hosts?.find((h) => h.id === s.origin);
  const machine = origin && snap.data.machine_list.find((m) => m.ip === origin.ip);
  const crons = cronsOf(s, b.hosts);
  return (
    <div className="flex flex-col gap-3 border-l-2 border-link/60 px-4 py-3 text-sm">
      {s.why?.length ? (
        <ul className="flex flex-col gap-1">{s.why.map((w) => <li key={w} className="flex gap-2"><Dot tone={s.level === "warn" ? "warn" : "bad"} /><span className="text-muted">{w}</span></li>)}</ul>
      ) : <p className="text-ok">{tx("Rien à reprocher à ce jeu.")}</p>}
      <div className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
        <span><b className="text-txt">{tx("Attendu")}</b> : {s.schedule || "-"}{s.max_age_days ? ` · ${tx("au plus {0} j", s.max_age_days)}` : ""}</span>
        {s.retention && <span><b className="text-txt">{tx("Rétention")}</b> : {s.retention}</span>}
        {s.size ? <span><b className="text-txt">{tx("Taille")}</b> : {bytes(s.size)}</span> : null}
        <span><b className="text-txt">{tx("Copie ailleurs")}</b> : {s.expect_offsite === false ? tx("non exigée") : tx("{0} à jour", s.offsite)}</span>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-dim"><th className="py-1 pr-3 font-semibold">{tx("Emplacement")}</th><th className="py-1 pr-3 font-semibold">{tx("Dossier")}</th><th className="py-1 pr-3 font-semibold">{tx("Dernière archive")}</th><th className="py-1 font-semibold">{tx("État")}</th></tr></thead>
        <tbody className="divide-y divide-line/60">
          {s.locations.map((l, i) => (
            <tr key={`${l.host}/${l.path ?? i}`}>
              <td className="py-1.5 pr-3"><Badge tone={l.role === "source" ? "info" : "off"} outline plainText>{l.role === "source" ? tx("source") : tx("copie")}</Badge> <b className="font-semibold">{l.encrypted ? "🔒 " : ""}{l.label}</b>{l.via && <Dim> · {l.via}</Dim>}</td>
              <td className="py-1.5 pr-3"><code className="break-all font-mono">{l.path ?? "-"}</code></td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{l.newest ? <>{dateTime(l.newest.mtime * 1000)}{l.newest.size ? <Dim> · {bytes(l.newest.size)}</Dim> : null}</> : <Dim>-</Dim>}</td>
              <td className="py-1.5"><Level level={l.level} />{l.detail && <span className="ml-1.5 text-muted">{l.detail}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {crons.length > 0 && (
        <div className="flex flex-col gap-1">
          {crons.map((c) => <div key={c.line} className="flex items-start gap-2 text-xs"><Terminal size={13} className="mt-0.5 shrink-0 text-dim" aria-hidden /><span className="text-dim">{c.src ?? "cron"} ·</span><code className="break-all font-mono text-muted">{c.line}</code></div>)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {snap.me.role === "admin" && <a href={`#settings/backups/${s.id}`} className={`${quiet} no-underline`}><SlidersHorizontal size={14} aria-hidden />{tx("Régler ce jeu")}</a>}
        {machine && <a href={`#machines/${machine.ip}`} className={`${quiet} no-underline`}><Monitor size={14} aria-hidden />{tx("Ouvrir {0}", machine.name)}</a>}
      </div>
    </div>
  );
}

/** The machine a set is produced on, as the Machines page knows it (for its icon), or none (Home Assistant, a Veeam server…) */
function machineOfSet(s: BackupSet, b: BackupsData, snap: Snapshot) {
  const ip = b.hosts?.find((h) => h.id === s.origin)?.ip;
  return ip ? snap.data.machine_list.find((m) => m.ip === ip) : undefined;
}

/** The sets one after the other by machine (the machines by name), each keeping its order inside */
function byMachine(sets: BackupSet[]): { name: string; sets: BackupSet[] }[] {
  const groups = new Map<string, BackupSet[]>();
  for (const s of sets) { const k = s.origin_label ?? s.origin; groups.set(k, [...(groups.get(k) ?? []), s]); }
  return [...groups].sort(([a], [x]) => a.localeCompare(x)).map(([name, list]) => ({ name, sets: list }));
}

/** A table of sets (to watch, or all): set, machine, expected, latest archive, state, a Detail button that unfolds the row.
 *  Grouped: one header row per machine (icon, name, sets, worst state) set apart by a thicker line, the machine column then left out */
function SetsTable({ sets, b, snap, sizes = false, grouped = false }: Readonly<{ sets: BackupSet[]; b: BackupsData; snap: Snapshot; sizes?: boolean; grouped?: boolean }>) {
  const [open, setOpen] = useState<string | null>(null);
  const cols = 6 + (sizes ? 1 : 0) - (grouped ? 1 : 0);
  const groups = grouped ? byMachine(sets) : [{ name: "", sets }];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
          <th className="px-3 py-2">{tx("Jeu")}</th>{!grouped && <th className="px-3 py-2">{tx("Machine")}</th>}<th className="px-3 py-2">{tx("Attendu")}</th><th className="px-3 py-2">{tx("Dernière archive")}</th>{sizes && <th className="px-3 py-2">{tx("Taille")}</th>}<th className="px-3 py-2">{tx("État")}</th><th className="w-40 px-3 py-2" />
        </tr></thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.name}>
              {grouped && <MachineHeader name={g.name} sets={g.sets} m={machineOfSet(g.sets[0], b, snap)} cols={cols} />}
          {g.sets.map((s) => {
            const n = newestOf(s), on = open === s.id, src = sourceOf(s), m = machineOfSet(s, b, snap);
            return (
              <Fragment key={s.id}>
                <tr className={`border-t border-line/60 ${on ? "bg-bg2/40" : "even:bg-bg/50 hover:bg-bg2/40"}`}>
                  <td className="px-3 py-2"><b className="font-semibold">{short(s.label)}</b>{src?.path && <span className="block truncate font-mono text-[11px] text-dim" title={src.path}>{src.path}</span>}</td>
                  {!grouped && <td className="px-3 py-2"><span className="flex items-center gap-2">{m ? <MachineIcon m={m} /> : <MachineIcon m={{}} />}{s.origin_label ?? s.origin}</span></td>}
                  <td className="px-3 py-2 text-muted">{s.schedule || "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{n ? <>{dateTime(n.mtime * 1000)}<span className="block text-[11px] text-dim">{n.where}</span></> : <span className="text-bad">{tx("aucune")}</span>}</td>
                  {sizes && <td className="px-3 py-2 tabular-nums text-muted">{s.size ? bytes(s.size) : "-"}</td>}
                  <td className="px-3 py-2"><Level level={s.level} />{s.why?.[0] && !on && <span className="ml-1.5 hidden text-xs text-muted xl:inline" title={s.why.join("\n")}>{s.why[0]}</span>}</td>
                  <td className="px-3 py-2 text-right"><span className="inline-flex items-center gap-2">
                    <button type="button" onClick={() => setOpen(on ? null : s.id)} aria-expanded={on} className={`${quiet} py-1`}>{on ? tx("Replier") : tx("Détail")}{on ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}</button>
                    {snap.me.role === "admin" && <SettingsLink href={`#settings/backups/${s.id}`} of={s.label} />}
                  </span></td>
                </tr>
                {on && <tr><td colSpan={cols} className="p-0"><SetDetail s={s} b={b} snap={snap} /></td></tr>}
              </Fragment>
            );
          })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The header row of one machine in the grouped table: its icon and name, how many sets, the worst state among them */
function MachineHeader({ name, sets, m, cols }: Readonly<{ name: string; sets: BackupSet[]; m?: Machine; cols: number }>) {
  const worst = sets.reduce((w, x) => (rank(x.level) > rank(w.level) ? x : w), sets[0]);
  return (
    <tr className="border-t-2 border-line bg-bg">
      <td colSpan={cols} className="px-3 py-2">
        <span className="flex flex-wrap items-center gap-2.5">
          {m ? <MachineIcon m={m} /> : <Monitor size={16} className="text-dim" aria-hidden />}
          <b>{name}</b>{m && m.ip !== name && <Dim>{m.ip}</Dim>}
          <Badge tone="off">{tx("{0} jeu(x)", sets.length)}</Badge>
          {worst.level !== "ok" && <Level level={worst.level} />}
        </span>
      </td>
    </tr>
  );
}

/** The view by machine (the former page): filters, one row per machine, local folders, unclaimed cron lines */
function ByMachine({ b, initial, onSets, known }: Readonly<{ b: BackupsData; initial?: Selected; onSets: (h: BackupHost) => void; known: ReadonlySet<string> }>) {
  const sets = useMemo(() => new Map((b.sets || []).map((s) => [s.id, s])), [b]);
  const facets = useMemo((): Facet<BackupHost>[] => [
    { key: "state", label: tx("État"), get: stateOf, name: (v) => LEVEL[v]?.[1] || v, order: ["crit", "down", "warn", "ok", "off", "na"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
    { key: "kind", label: tx("Type"), get: (h) => h.kind || "" },
  ], []);
  const text = useCallback((h: BackupHost) => [h.label, h.ip, h.kind, ...h.sets.map((id) => sets.get(id)?.label), ...h.copies.map((c) => c.label), ...h.local.map((x) => x.path)].join(" "), [sets]);
  const f = useFilter(b.hosts || [], facets, text, initial);

  const copies = (h: BackupHost) => {
    if (!h.copies.length) return h.sets.length ? <Badge tone="bad" outline plainText>{tx("aucune copie ailleurs")}</Badge> : <Dim>-</Dim>;
    return (
      <span className="flex flex-wrap gap-1">
        {h.copies.map((c) => (
          <span key={c.host} title={`${ageDays(c.age)} · ${c.vias.join(", ")}`}><Level level={c.level} outline plainText>{c.encrypted ? "🔒 " : ""}{c.label}</Level></span>
        ))}
      </span>
    );
  };
  const last = (h: BackupHost) => h.last_local ? (
    <span className="text-sm"><Level level={h.last_local.level}>{ageDays(h.last_local.age)}</Level>
      <span className="block text-xs text-dim">{dateTime(h.last_local.mtime * 1000)} · {short(h.last_local.set)}</span></span>
  ) : <Dim>{tx("aucun")}</Dim>;
  const produced = (h: BackupHost) => {
    const own = h.sets.map((id) => sets.get(id)).filter((x): x is BackupSet => !!x);
    if (!own.length) return <Dim>{tx("aucun")}</Dim>;
    const worst = own.reduce((w, x) => (rank(x.level) > rank(w.level) ? x : w), own[0]);
    return (
      <button type="button" className={`${quiet} py-1`} title={[...own.map((x) => short(x.label) + " · " + (x.schedule ?? "")), tx("Voir ses jeux")].join("\n")} onClick={() => onSets(h)}>
        <Layers size={14} aria-hidden /><Dot tone={LEVEL[worst.level]?.[0] ?? "off"} />{tx("{0} jeu(x)", own.length)}
      </button>
    );
  };
  const name = (h: BackupHost) => known.has(h.ip)
    ? <a href={`#machines/${h.ip}`} className="font-bold text-txt no-underline hover:underline" title={tx("Ouvrir {0}", h.label)}>{h.label}</a> : <b>{h.label}</b>;
  const disks = (h: BackupHost) => h.disks.length ? (
    <div className="flex flex-col gap-1">
      {h.disks.map((d) => (
        <span key={d.mount} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate font-mono" title={d.mount}>{d.mount}</span>
          <Fill pct={d.pct} /><span className="w-10 text-right tabular-nums"><Pct value={d.pct} /></span>
          <span className="w-28 whitespace-nowrap text-right tabular-nums"><Dim>{bytes(d.avail)} {tx("libres")}</Dim></span>
        </span>
      ))}
    </div>
  ) : <Dim>-</Dim>;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar f={f} placeholder={tx("Machine, jeu, dossier…")} primary={["state", "kind"]} oneLine />
      {f.shown.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <>
          <Table head={<><Th>{tx("Machine")}</Th><Th>{tx("État")}</Th><Th>{tx("Disques")}</Th><Th>{tx("Dernier backup local")}</Th><Th>{tx("Copié ailleurs")}</Th><Th>{tx("Jeux produits")}</Th></>}>
            {f.shown.map((h) => (
              <tr key={h.id} className="even:bg-bg/50 hover:bg-bg2/40">
                <Td>{name(h)}<span className="block text-xs text-dim">{h.ip} · {h.kind}</span></Td>
                <Td><Level level={stateOf(h)} /></Td><Td>{disks(h)}</Td><Td>{last(h)}</Td><Td>{copies(h)}</Td><Td>{produced(h)}</Td>
              </tr>
            ))}
          </Table>
          <Cards>
            {f.shown.map((h) => (
              <div key={h.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-3.5">
                <div className="flex items-start justify-between gap-2"><div>{name(h)}<span className="block text-xs text-dim">{h.ip} · {h.kind}</span></div><Level level={stateOf(h)} /></div>
                <div className="text-sm"><span className="text-muted">{tx("Dernier local :")} </span>{last(h)}</div>
                {copies(h)}{produced(h)}
              </div>
            ))}
          </Cards>
        </>
      )}
    </div>
  );
}

/** Backups → Settings → To link: local backup folders (inventoried by a set or not) and cron lines that no followed set claims */
export function UnlinkedBackups({ b }: Readonly<{ b?: BackupsData | null }>) {
  if (!b) return <Empty>{tx("Sauvegardes pas encore relevées.")}</Empty>;
  const sm = b.summary;
  const local = (b.hosts ?? []).flatMap((h) => h.local.filter((x) => x.size || x.covered.length).map((x) => ({ h, x })));
  const orphans = unclaimedCrons(b.sets ?? [], b.hosts);
  return (
    <div className="flex flex-col gap-4">
      <TableCard zebra title={tx("Dossiers de sauvegarde locaux")} tone={(sm.local_unlisted ?? 0) > 0 ? "warn" : "info"} empty={tx("Aucun dossier de sauvegarde local vu sur les machines lues par SSH.")}
        note={<>{sm.local_dirs ?? local.length} {tx("trouvés,")} <b className={sm.local_unlisted ? "text-warn" : "text-txt"}>{sm.local_unlisted ?? 0}</b> {tx("non inventoriés")}</>}
        cols={[{ label: tx("Machine"), className: "w-[14%]" }, { label: tx("Dossier"), className: "w-[28%]" }, { label: tx("Taille"), className: "w-24" }, { label: tx("Dernière modification"), className: "w-36" }, { label: tx("Inventorié") }]}   // the folder no longer takes the room left: the sets covering it do
        rows={local.map(({ h, x }) => [
          <b key="h" className="font-semibold">{h.label}</b>,
          <code key="p" className="break-all font-mono text-xs">{x.path}</code>,
          <span key="s" className="tabular-nums">{x.size ? bytes(x.size) : <Dim>-</Dim>}</span>,
          x.age == null ? <Dim key="a">-</Dim> : <span key="a" className="whitespace-nowrap">{tx("il y a {0}", ageDays(x.age))}</span>,
          x.covered.length ? <span key="c" className="flex flex-wrap gap-1">{x.covered.map((c) => <Badge key={c} tone="ok">{c}</Badge>)}</span> : <Badge key="c" tone="warn">{tx("non inventorié")}</Badge>,
        ])} />
      <TableCard zebra title={tx("Tâches cron de sauvegarde sans jeu suivi")} tone="info" empty={tx("Chaque ligne cron de sauvegarde trouvée est réclamée par un jeu suivi.")}
        note={tx("Des lignes cron trouvées sur vos machines qu'aucun jeu suivi ne réclame : peut-être une sauvegarde à déclarer dans « Ajouter des sauvegardes ».")}
        cols={[{ label: tx("Machine"), className: "w-[16%]" }, { label: tx("Source"), className: "w-36" }, { label: tx("Ligne") }]}
        rows={orphans.map((c) => [<b key="h" className="font-semibold">{c.host}</b>, <Dim key="s">{c.src ?? "cron"}</Dim>, <code key="l" className="break-all font-mono text-xs">{c.line}</code>])} />
    </div>
  );
}

type SetFilter = "live" | "alerts" | "archived";
const SET_FILTERS: { id: SetFilter; label: string; keep: (s: BackupSet) => boolean }[] = [
  { id: "live", label: tx("En service"), keep: (s) => !s.archived },
  { id: "alerts", label: tx("Alertes"), keep: (s) => !s.archived && s.level !== "ok" },   // the same sets as the menu's dot (toWatch)
  { id: "archived", label: tx("Archivés"), keep: (s) => s.archived },
];

/** Backups → Sets (also the old « To watch » address, opened on « Alerts »): every set, a search (set, machine, folder, schedule…) with a machine filter (set by the link of a machine), three chips
 *  (in use, flagged, archived); each row unfolds its detail, « Set » opens its settings page */
function SetsView({ sets, b, snap, initial, alerts = false }: Readonly<{ sets: BackupSet[]; b: BackupsData; snap: Snapshot; initial?: Selected; alerts?: boolean }>) {
  const [pick, setPick] = useState<SetFilter>(alerts ? "alerts" : "live");   // alerts: opened from the menu's dot or the home page
  const [grouped, setGrouped] = useStoredFlag("myservices.backups.setsByMachine", true);   // by machine unless turned off
  const facets = useMemo((): Facet<BackupSet>[] => {
    const hosts = b.hosts ?? [], names = new Map(hosts.map((h) => [h.id, h.label]));
    return [{ key: "machine", label: tx("Machine"), get: (s) => hosts.filter((h) => h.sets.includes(s.id)).map((h) => h.id), name: (v) => names.get(v) || v }];
  }, [b]);
  const text = useCallback((s: BackupSet) => [s.label, s.origin_label, s.origin, s.schedule, s.mode, s.retention, ...(s.why ?? []),
    ...s.locations.flatMap((l) => [l.label, l.host, l.path, l.via])].join(" "), []);
  const f = useFilter(sets, facets, text, initial);
  const filter = SET_FILTERS.find((x) => x.id === pick)!;
  const shown = f.shown.filter(filter.keep);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-label={tx("Jeux")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line/60 bg-bg px-4 py-3">
        <h2 className="flex items-center gap-2 font-bold"><Layers size={16} aria-hidden />{tx("Jeux")}</h2>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {SET_FILTERS.map((x) => {
            const n = f.shown.filter(x.keep).length, on = x.id === pick;
            return (
              <ChipButton key={x.id} on={on} count={n} label={x.label} onClick={() => setPick(x.id)} />
            );
          })}
        </span>
      </div>
      <div className="border-b border-line/60 px-4 py-3"><FilterBar f={f} placeholder={tx("Jeu, machine, dossier, horaire…")} primary={["machine"]} oneLine bare
        side={<ChipButton on={grouped} mark={<Monitor size={14} aria-hidden />} label={tx("Par machine")} title={tx("Regrouper les jeux sous le nom de leur machine")} onClick={() => setGrouped(!grouped)} />} /></div>
      {shown.length ? <SetsTable sets={shown} b={b} snap={snap} sizes grouped={grouped} /> : <p className="px-4 py-3 text-sm text-dim">{tx("Aucun jeu dans ce filtre.")}</p>}
    </section>
  );
}

const VIEWS = ["machines", "watch", "all"] as const;
type View = (typeof VIEWS)[number];

/** Opened without a view: the sets on « Alerts » when asked (the menu's dot, the home page), else the main view, by machine.
 *  « To watch » is no longer in the menu: its old address shows the sets on « Alerts » too */
function defaultView(alerts: boolean): View {
  return alerts ? "all" : "machines";
}

export function Backups({ snap, initial, route }: Readonly<{ snap: Snapshot; initial?: Selected; route: string }>) {
  const b = snap.backups;
  const { alerts, ...hostSel } = initial ?? {};   // « alerts »: the sets on Alerts; the rest filters the machines
  const view = usePageView(route, "backups", VIEWS, defaultView(!!alerts));
  const [setsFrom, setSetsFrom] = useState<{ sel: Selected; n: number }>({ sel: {}, n: 0 });   // the machine filter brought by « Sets produced » (By machine)
  const [hours, setHours] = usePeriod(), hist = useBackupsHistory(hours, b?.generated ?? ""), now = Math.floor(Date.now() / 1000);
  if (!b) return <Empty>{tx("Sauvegardes pas encore relevées.")}</Empty>;
  const sm = b.summary, fig = figures(b), ratio = (p: TilePoint) => `${p[1]}/${p[2]}`, missing = (p: TilePoint) => p[2] - p[1];
  const all = [...(b.sets ?? [])].sort((a, x) => Number(a.archived) - Number(x.archived) || rank(x.level) - rank(a.level) || a.label.localeCompare(x.label));   // archived sets last, kept visible here
  const sources = [...new Set((b.hosts ?? []).map((h) => h.kind).filter(Boolean))];
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={HardDrive} title={tx("Sauvegardes")} tags={<HeadTags counts={[tx("{0} jeux", sm.sets), { text: tx("{0} machines", sm.hosts), title: sources.join(", ") || undefined }]} at={b.generated} />}
        actions={<>{snap.me.role === "admin" && <a href="#settings/backups/add" className={`${primary} py-1 no-underline`}><Plus size={14} aria-hidden />{tx("Ajouter des sauvegardes")}</a>}<PeriodSwitch value={hours} onChange={setHours} /></>} />
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <HistoryTile n={fig.ok} label={tx("À jour")} tone="ok" fact={fig.offsiteExpected ? tx("copie ailleurs : {0} sur {1}", fig.offsiteOk, fig.offsiteExpected) : undefined} kind="curve" points={hist?.ok ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={ratio} goodHigh />
        <HistoryTile n={fig.warn} label={tx("En retard")} tone={fig.warn ? "warn" : undefined} kind="strip" points={hist?.late ?? null} hours={hours} now={now} figure={missing} fmt={(p) => tx("{0} en retard", missing(p))} goodHigh={false} />
        <HistoryTile n={fig.bad} label={tx("Absente ou en erreur")} tone={fig.bad ? "bad" : undefined} fact={sm.no_offsite ? tx("{0} sans copie hors machine", sm.no_offsite) : undefined} kind="strip" points={hist?.bad ?? null} hours={hours} now={now} figure={missing} fmt={(p) => tx("{0} absente(s) ou en erreur", missing(p))} goodHigh={false} />
        <StatTile n={fig.last ? dateTime(fig.last.mtime * 1000) : "-"} label={tx("Dernière archive")} sub={fig.last ? `${short(fig.last.set.label)} · ${fig.last.name}` : tx("aucune archive vue")} />
      </div>

      {(view === "all" || view === "watch") && <SetsView key={setsFrom.n} sets={all} b={b} snap={snap} initial={setsFrom.sel} alerts={view === "watch" || !!alerts} />}
      {view === "machines" && (
        <FoldPanel id="backups-hosts" icon={Monitor} title={tx("Par machine")} count={b.hosts?.length ?? 0} pinned>
          <ByMachine b={b} initial={hostSel} known={new Set(snap.data.machine_list.map((m) => m.ip))} onSets={(h) => { setSetsFrom((x) => ({ sel: { machine: [h.id] }, n: x.n + 1 })); location.hash = "backups/all"; }} />
        </FoldPanel>
      )}
    </div>
  );
}
