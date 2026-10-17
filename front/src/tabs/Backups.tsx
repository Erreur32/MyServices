// Sauvegardes (backups.py) : synthèse, points d'attention, puis chaque machine (disques, dernier backup local,
// copies ailleurs, jeux produits) et les dossiers de sauvegarde trouvés sur les disques.
import { useCallback, useMemo } from "react";
import { ROOT, type Snapshot } from "../api";
import { useFilter, type Facet, type Selected } from "../lib/filter";
import { ageDays, bytes, dateTime } from "../lib/format";
import type { BackupHost } from "../types";
import { Badge, Cards, Dim, Empty, Fill, FilterBar, Level, Table, TableCard, Td, Th } from "../components/ui";
import { LEVEL } from "../lib/level";
import { Dot } from "../components/marks";
import { tx } from "../lib/i18n";

const stateOf = (h: BackupHost) => (h.reachable ? h.level : "down");
const short = (label: string) => label.replace(/^[^:]*: /, "");

function Tile({ n, label, tone }: { n: string | number; label: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="min-w-[7.5rem] flex-1 rounded-xl border border-line bg-card px-3 py-2.5">
      <div className={`font-mono text-xl font-bold ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : ""}`}>{n}</div>
      <div className="text-xs leading-tight text-muted">{label}</div>
    </div>
  );
}

export function Backups({ snap, initial }: { snap: Snapshot; initial?: Selected }) {
  const b = snap.backups;
  const sets = useMemo(() => new Map((b?.sets || []).map((s) => [s.id, s])), [b]);
  const facets = useMemo((): Facet<BackupHost>[] => [
    { key: "state", label: tx("État"), get: stateOf, name: (v) => LEVEL[v]?.[1] || v, order: ["crit", "down", "warn", "ok", "na"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
    { key: "kind", label: tx("Type"), get: (h) => h.kind || "" },
  ], []);
  const text = useCallback((h: BackupHost) => [h.label, h.ip, h.kind, ...h.sets.map((id) => sets.get(id)?.label), ...h.copies.map((c) => c.label), ...h.local.map((x) => x.path)].join(" "), [sets]);
  const f = useFilter(b?.hosts || [], facets, text, initial);
  if (!b) return <Empty>{tx("Sauvegardes pas encore relevées.")}</Empty>;
  const sm = b.summary;
  const local = f.shown.flatMap((h) => h.local.filter((x) => x.size || x.covered.length).map((x) => ({ h, x })));

  const copies = (h: BackupHost) => h.copies.length ? (
    <div className="flex flex-col gap-1">
      {h.copies.map((c) => (
        <span key={c.host} className="text-sm">
          <Level level={c.level}>{c.encrypted ? "🔒 " : ""}{c.label}</Level> <Dim>{ageDays(c.age)} · {c.vias.join(", ")}</Dim>
        </span>
      ))}
    </div>
  ) : h.sets.length ? <Badge tone="bad">{tx("aucune copie ailleurs")}</Badge> : <Dim>-</Dim>;
  const last = (h: BackupHost) => h.last_local ? (
    <span className="text-sm"><Level level={h.last_local.level}>{ageDays(h.last_local.age)}</Level>
      <span className="block text-xs text-dim">{dateTime(h.last_local.mtime * 1000)} · {short(h.last_local.set)}</span></span>
  ) : <Dim>{tx("aucun")}</Dim>;
  const produced = (h: BackupHost) => h.sets.length ? (
    <ul className="flex flex-col gap-1 text-sm">
      {h.sets.map((id) => { const s = sets.get(id); return s && (
        <li key={id}><Level level={s.level}>{short(s.label)}</Level> <Dim>{s.schedule} · {s.offsite || s.expect_offsite !== false ? `${s.offsite} ${tx("copie(s) hors machine")}` : tx("copie ailleurs non déclarée")}</Dim></li>
      ); })}
    </ul>
  ) : <Dim>{tx("aucun jeu produit")}</Dim>;
  const disks = (h: BackupHost) => h.disks.length ? (
    <div className="flex flex-col gap-1">
      {h.disks.map((d) => (
        <span key={d.mount} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate font-mono" title={d.mount}>{d.mount}</span>
          <Fill pct={d.pct} /><span>{d.pct} %</span>
          <Dim>{bytes(d.avail)} {tx("libres")}</Dim>
        </span>
      ))}
    </div>
  ) : <Dim>-</Dim>;

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex gap-2.5 overflow-x-auto pb-1">   {/* one single row; scrolls sideways on a narrow screen instead of wrapping */}
        <Tile n={sm.ok} label={tx("jeux à jour")} tone="ok" /><Tile n={sm.warn} label={tx("jeux en retard")} tone={sm.warn ? "warn" : undefined} />
        <Tile n={sm.crit} label={tx("jeux critiques")} tone={sm.crit ? "bad" : undefined} />
        <Tile n={sm.no_offsite} label={tx("sans copie hors machine")} tone={sm.no_offsite ? "bad" : "ok"} />
        {!!sm.offsite_unknown && <Tile n={sm.offsite_unknown} label={tx("copie ailleurs non déclarée")} />}
        <Tile n={bytes(sm.volume)} label={tx("volume des sources")} /><Tile n={sm.hosts} label={tx("machines")} />
      </div>
      <TableCard title={tx("À regarder")} tone={b.issues.some((i) => i.level === "crit" || i.level === "down") ? "bad" : b.issues.length ? "warn" : "ok"}
        cols={[{ label: tx("État"), className: "w-[7.5rem]" }, { label: tx("Jeu de sauvegarde"), className: "w-[34%]" }, { label: tx("Ce qui ne va pas") }]}
        rows={b.issues.map((i) => [<Level level={i.level} />, <b className="font-semibold">{i.set}</b>, <span className="text-muted">{i.text}</span>])}
        empty={tx("Rien à signaler.")} footer={<>{tx("Relevé du")} {dateTime(b.generated)}{snap.data.page.map && <> · <a className="text-link hover:underline" href={`${ROOT}sauvegardes.html`} target="_blank" rel="noopener">{tx("carte des sauvegardes")}</a></>}</>} />
      <FilterBar f={f} placeholder={tx("Machine, jeu, dossier…")} />
      {f.shown.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <>
          <Table head={<><Th>{tx("Machine")}</Th><Th>{tx("État")}</Th><Th>{tx("Disques")}</Th><Th>{tx("Dernier backup local")}</Th><Th>{tx("Copié ailleurs")}</Th><Th>{tx("Jeux produits")}</Th></>}>
            {f.shown.map((h) => (
              <tr key={h.id}>
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
      {local.length > 0 && (
        <details className="rounded-2xl border border-line bg-card p-4">
          <summary className="cursor-pointer font-bold">{tx("Dossiers de sauvegarde locaux")} <Dim>· {sm.local_dirs ?? local.length} {tx("trouvés,")} {sm.local_unlisted ?? 0} {tx("non inventoriés")}</Dim></summary>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {local.map(({ h, x }) => (
              <li key={h.id + x.path} className="flex flex-wrap items-center gap-2">
                <b>{h.label}</b><code className="font-mono text-xs">{x.path}</code><Dim>{bytes(x.size)} · {x.age == null ? "-" : tx("il y a {0}", ageDays(x.age))}</Dim>
                {x.covered.length ? <Badge tone="ok">{x.covered.join(", ")}</Badge> : <Badge tone="warn">{tx("non inventorié")}</Badge>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
