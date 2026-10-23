// Sauvegardes (backups.py) in « state » mode: four figures, then one view at a time: by machine (disks, latest local backup, copies, sets
// produced), to watch, and the sets (filters: in use, flagged, archived), each unfolding its detail; « Set » opens the page of the set in
// Backups → Settings. The local folders and cron lines no set claims are listed there too (« To link »).
import { usePageView } from "../lib/route";
import { ChevronDown, ChevronUp, HardDrive, Layers, Monitor, Settings2, Terminal } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { type Snapshot } from "../api";
import { useFilter, type Facet, type Selected } from "../lib/filter";
import { ageDays, bytes, dateTime } from "../lib/format";
import type { BackupHost, BackupSet, Backups as BackupsData } from "../types";
import { Badge, Cards, Dim, Empty, Fill, FilterBar, Level, Pct, Table, TableCard, Td, Th } from "../components/ui";
import { FoldPanel } from "../components/FoldPanel";
import { LEVEL } from "../lib/level";
import { Dot } from "../components/marks";
import { quiet, worstTone } from "../lib/forms";
import { tx } from "../lib/i18n";
import { StatTile } from "../components/StatTile";
import { WatchPanel } from "../components/WatchPanel";
import { cronsOf, figures, newestOf, rank, sourceOf, toWatch, unclaimedCrons } from "../lib/backupsState";
import { HeadTags } from "../components/HeadTags";

const stateOf = (h: BackupHost) => (h.reachable ? h.level : "down");
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
        {snap.me.role === "admin" && <a href={`#settings/backups/${s.id}`} className={`${quiet} no-underline`}><Settings2 size={14} aria-hidden />{tx("Régler ce jeu")}</a>}
        {machine && <a href={`#machines/${machine.ip}`} className={`${quiet} no-underline`}><Monitor size={14} aria-hidden />{tx("Ouvrir {0}", machine.name)}</a>}
      </div>
    </div>
  );
}

/** A table of sets (to watch, or all): set, machine, expected, latest archive, state, a Detail button that unfolds the row */
function SetsTable({ sets, b, snap, sizes = false }: Readonly<{ sets: BackupSet[]; b: BackupsData; snap: Snapshot; sizes?: boolean }>) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
          <th className="px-3 py-2">{tx("Jeu")}</th><th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Attendu")}</th><th className="px-3 py-2">{tx("Dernière archive")}</th>{sizes && <th className="px-3 py-2">{tx("Taille")}</th>}<th className="px-3 py-2">{tx("État")}</th><th className="w-40 px-3 py-2" />
        </tr></thead>
        <tbody>
          {sets.map((s) => {
            const n = newestOf(s), on = open === s.id, src = sourceOf(s);
            return (
              <Fragment key={s.id}>
                <tr className={`border-t border-line/60 ${on ? "bg-bg2/40" : "even:bg-bg/50 hover:bg-bg2/40"}`}>
                  <td className="px-3 py-2"><b className="font-semibold">{short(s.label)}</b>{src?.path && <span className="block truncate font-mono text-[11px] text-dim" title={src.path}>{src.path}</span>}</td>
                  <td className="px-3 py-2">{s.origin_label ?? s.origin}</td>
                  <td className="px-3 py-2 text-muted">{s.schedule || "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{n ? <>{dateTime(n.mtime * 1000)}<span className="block text-[11px] text-dim">{n.where}</span></> : <span className="text-bad">{tx("aucune")}</span>}</td>
                  {sizes && <td className="px-3 py-2 tabular-nums text-muted">{s.size ? bytes(s.size) : "-"}</td>}
                  <td className="px-3 py-2"><Level level={s.level} />{s.why?.[0] && !on && <span className="ml-1.5 hidden text-xs text-muted xl:inline" title={s.why.join("\n")}>{s.why[0]}</span>}</td>
                  <td className="px-3 py-2 text-right"><span className="inline-flex items-center gap-2">
                    <button type="button" onClick={() => setOpen(on ? null : s.id)} aria-expanded={on} className={`${quiet} py-1`}>{on ? tx("Replier") : tx("Détail")}{on ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}</button>
                    {snap.me.role === "admin" && <a href={`#settings/backups/${s.id}`} className="text-xs text-link hover:underline">{tx("Régler")} ›</a>}
                  </span></td>
                </tr>
                {on && <tr><td colSpan={sizes ? 7 : 6} className="p-0"><SetDetail s={s} b={b} snap={snap} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The view by machine (the former page): filters, one row per machine, local folders, unclaimed cron lines */
function ByMachine({ b, initial }: Readonly<{ b: BackupsData; initial?: Selected }>) {
  const sets = useMemo(() => new Map((b.sets || []).map((s) => [s.id, s])), [b]);
  const facets = useMemo((): Facet<BackupHost>[] => [
    { key: "state", label: tx("État"), get: stateOf, name: (v) => LEVEL[v]?.[1] || v, order: ["crit", "down", "warn", "ok", "na"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
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
    return <span title={own.map((x) => `${short(x.label)} · ${x.schedule ?? ""}`).join("\n")}><Level level={worst.level} outline plainText>{tx("{0} jeu(x)", own.length)}</Level></span>;
  };
  const disks = (h: BackupHost) => h.disks.length ? (
    <div className="flex flex-col gap-1">
      {h.disks.map((d) => (
        <span key={d.mount} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate font-mono" title={d.mount}>{d.mount}</span>
          <Fill pct={d.pct} /><Pct value={d.pct} />
          <span className="whitespace-nowrap"><Dim>{bytes(d.avail)} {tx("libres")}</Dim></span>
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
                <Td><b>{h.label}</b><span className="block text-xs text-dim">{h.ip} · {h.kind}</span></Td>
                <Td><Level level={stateOf(h)} /></Td><Td>{disks(h)}</Td><Td>{last(h)}</Td><Td>{copies(h)}</Td><Td>{produced(h)}</Td>
              </tr>
            ))}
          </Table>
          <Cards>
            {f.shown.map((h) => (
              <div key={h.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-3.5">
                <div className="flex items-start justify-between gap-2"><div><b>{h.label}</b><span className="block text-xs text-dim">{h.ip} · {h.kind}</span></div><Level level={stateOf(h)} /></div>
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
        cols={[{ label: tx("Machine"), className: "w-[16%]" }, { label: tx("Dossier") }, { label: tx("Taille"), className: "w-28" }, { label: tx("Dernière modification"), className: "w-40" }, { label: tx("Inventorié"), className: "w-36" }]}
        rows={local.map(({ h, x }) => [
          <b key="h" className="font-semibold">{h.label}</b>,
          <code key="p" className="break-all font-mono text-xs">{x.path}</code>,
          <span key="s" className="tabular-nums">{x.size ? bytes(x.size) : <Dim>-</Dim>}</span>,
          x.age == null ? <Dim key="a">-</Dim> : <span key="a" className="whitespace-nowrap">{tx("il y a {0}", ageDays(x.age))}</span>,
          x.covered.length ? <Badge key="c" tone="ok">{x.covered.join(", ")}</Badge> : <Badge key="c" tone="warn">{tx("non inventorié")}</Badge>,
        ])} />
      <TableCard zebra title={tx("Tâches cron de sauvegarde sans jeu suivi")} tone="info" empty={tx("Chaque ligne cron de sauvegarde trouvée est réclamée par un jeu suivi.")}
        note={tx("Des lignes cron trouvées sur vos machines qu'aucun jeu suivi ne réclame : peut-être une sauvegarde à déclarer dans « Ajouter des sauvegardes ».")}
        cols={[{ label: tx("Machine"), className: "w-[16%]" }, { label: tx("Source"), className: "w-36" }, { label: tx("Ligne") }]}
        rows={orphans.map((c) => [<b key="h" className="font-semibold">{c.host}</b>, <Dim key="s">{c.src ?? "cron"}</Dim>, <code key="l" className="break-all font-mono text-xs">{c.line}</code>])} />
    </div>
  );
}

type SetFilter = "live" | "flagged" | "archived";
const SET_FILTERS: { id: SetFilter; label: string; keep: (s: BackupSet) => boolean }[] = [
  { id: "live", label: tx("En service"), keep: (s) => !s.archived },
  { id: "flagged", label: tx("Signalés"), keep: (s) => !s.archived && ["warn", "crit", "down"].includes(s.level) },
  { id: "archived", label: tx("Archivés"), keep: (s) => s.archived },
];

/** Backups → Sets: every set, three chips (in use, flagged, archived); each row unfolds its detail, « Set » opens its settings page */
function SetsView({ sets, b, snap }: Readonly<{ sets: BackupSet[]; b: BackupsData; snap: Snapshot }>) {
  const [pick, setPick] = useState<SetFilter>("live");
  const filter = SET_FILTERS.find((x) => x.id === pick)!;
  const shown = sets.filter(filter.keep);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-label={tx("Jeux")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line/60 bg-bg px-4 py-3">
        <h2 className="flex items-center gap-2 font-bold"><Layers size={16} aria-hidden />{tx("Jeux")}</h2>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {SET_FILTERS.map((x) => {
            const n = sets.filter(x.keep).length, on = x.id === pick;
            return (
              <button key={x.id} type="button" aria-pressed={on} onClick={() => setPick(x.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
                {x.label}<span className="font-mono text-[11px] text-dim">{n}</span>
              </button>
            );
          })}
        </span>
      </div>
      {shown.length ? <SetsTable sets={shown} b={b} snap={snap} sizes /> : <p className="px-4 py-3 text-sm text-dim">{tx("Aucun jeu dans ce filtre.")}</p>}
    </section>
  );
}

const VIEWS = ["machines", "watch", "all"] as const;
type View = (typeof VIEWS)[number];

/** Opened without a view: « To watch » when something is (and no filter came with it), else the main view, by machine */
function defaultView(watched: number, filtered: boolean): View {
  return watched && !filtered ? "watch" : "machines";
}

export function Backups({ snap, initial, route }: Readonly<{ snap: Snapshot; initial?: Selected; route: string }>) {
  const b = snap.backups;
  const watch = toWatch(b?.sets ?? []);
  const view = usePageView(route, "backups", VIEWS, defaultView(watch.length, !!initial && Object.keys(initial).length > 0));
  if (!b) return <Empty>{tx("Sauvegardes pas encore relevées.")}</Empty>;
  const sm = b.summary, fig = figures(b);
  const all = [...(b.sets ?? [])].sort((a, x) => Number(a.archived) - Number(x.archived) || rank(x.level) - rank(a.level) || a.label.localeCompare(x.label));   // archived sets last, kept visible here
  const worst = worstTone(watch.some((s) => s.level === "crit" || s.level === "down"), watch.length > 0);
  const sources = [...new Set((b.hosts ?? []).map((h) => h.kind).filter(Boolean))];
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><HardDrive size={18} aria-hidden />{tx("Sauvegardes")}</h1>
        <HeadTags counts={[tx("{0} jeux", sm.sets), { text: tx("{0} machines", sm.hosts), title: sources.join(", ") || undefined }]} at={b.generated} />
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={fig.ok} label={tx("À jour")} tone="ok" sub={fig.offsiteExpected ? tx("copie ailleurs : {0} sur {1}", fig.offsiteOk, fig.offsiteExpected) : undefined} />
        <StatTile n={fig.warn} label={tx("En retard")} tone={fig.warn ? "warn" : undefined} />
        <StatTile n={fig.bad} label={tx("Absente ou en erreur")} tone={fig.bad ? "bad" : undefined} sub={sm.no_offsite ? tx("{0} sans copie hors machine", sm.no_offsite) : undefined} />
        <StatTile n={fig.last ? dateTime(fig.last.mtime * 1000) : "-"} label={tx("Dernière archive")} sub={fig.last ? `${short(fig.last.set.label)} · ${fig.last.name}` : tx("aucune archive vue")} />
      </div>

      {view === "watch" && (
        <WatchPanel id="backups" tone={worst} count={watch.length} keep pinned hint={tx("jeux en retard, absents, en erreur ou sans copie à jour")}>
          {watch.length ? <SetsTable sets={watch} b={b} snap={snap} /> : <p className="px-4 py-3 text-sm text-ok">{tx("Tous les jeux suivis sont à jour.")}</p>}
        </WatchPanel>
      )}
      {view === "all" && <SetsView sets={all} b={b} snap={snap} />}
      {view === "machines" && (
        <FoldPanel id="backups-hosts" icon={Monitor} title={tx("Par machine")} count={b.hosts?.length ?? 0} pinned>
          <ByMachine b={b} initial={initial} />
        </FoldPanel>
      )}
    </div>
  );
}
