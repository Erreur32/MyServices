// Request counters per connector and per route (development builds only): what the server counted since it started (connectors/reqstats.py),
// in a folded panel under a connector card and in Network > Diagnostic. « To watch »: a route near or over a limit known on the service, or a
// 429 received during the last hour. RequestTable is pure (tested as is); RequestStatsPanel reads the route every few seconds while open.
import { Activity } from "lucide-react";
import { useCallback, useState } from "react";
import { read } from "../api";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { Badge, Dim, Empty } from "./ui";

export type RequestRow = {
  owner: string; route: string; per_min: number; per_hour: number; total: number; hits: number; last_ms: number | null; avg_ms: number | null;
  last_code: number | null; n429: number; retry_after: number | null; last_error: string; last_at: number | null; limit: number | null; watch: boolean;
};
export type RequestWatch = { owner: string; route: string; per_min: number; limit: number | null; n429: number; retry_after: number | null };
export type RequestDoc = { rows: RequestRow[]; watch: RequestWatch[]; at: number };

const POLL = 10_000;

function codeTone(code: number | null): "ok" | "warn" | "bad" | "off" {
  if (code === null) return "bad";
  if (code === 429) return "warn";
  return code < 400 ? "ok" : "off";
}

/** « 2 (7 s) »: the 429 answers and the last delay asked; nothing when there was none */
function text429(r: RequestRow): string {
  if (r.n429 === 0) return "";
  return r.retry_after === null ? String(r.n429) : `${r.n429} (${r.retry_after} s)`;
}

function watchText(w: RequestWatch): string {
  if (w.n429 > 0) return w.retry_after === null ? tx("429 reçu sur {0} ({1})", w.route, w.owner) : tx("429 reçu sur {0} ({1}), réessai dans {2} s", w.route, w.owner, w.retry_after);
  return tx("{0} appels par minute sur {1} ({2}), limite {3}", w.per_min, w.route, w.owner, w.limit ?? "?");
}

/** The rows of one connector (`owner`), or of all of them. */
export function RequestTable({ doc, owner }: Readonly<{ doc: RequestDoc; owner?: string }>) {
  const rows = doc.rows.filter((r) => !owner || r.owner === owner);
  const watch = doc.watch.filter((w) => !owner || w.owner === owner);
  if (rows.length === 0) return <Empty>{tx("Aucun appel compté depuis le démarrage.")}</Empty>;
  return (
    <div className="space-y-3">
      {watch.length > 0 && <InfoNote tone="warn"><ul className="list-disc pl-4">{watch.map((w) => <li key={`${w.owner}/${w.route}`}>{watchText(w)}</li>)}</ul></InfoNote>}
      <div className="overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-dim">
              {!owner && <th className="px-2 py-1">{tx("Connecteur")}</th>}
              <th className="px-2 py-1">{tx("Route")}</th><th className="px-2 py-1 text-right">{tx("/ min")}</th><th className="px-2 py-1 text-right">{tx("/ h")}</th>
              <th className="px-2 py-1 text-right">{tx("Total")}</th><th className="px-2 py-1 text-right">{tx("Cache")}</th><th className="px-2 py-1 text-right">{tx("Dernière")}</th>
              <th className="px-2 py-1 text-right">{tx("Moyenne")}</th><th className="px-2 py-1">{tx("Code")}</th><th className="px-2 py-1 text-right">429</th><th className="px-2 py-1">{tx("Dernière erreur")}</th>
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(even)]:bg-bg/50 [&>tr]:border-b [&>tr]:border-line/60">
            {rows.map((r) => (
              <tr key={`${r.owner}/${r.route}`} className={r.watch ? "text-warn" : ""}>
                {!owner && <td className="px-2 py-1 font-mono text-xs">{r.owner}</td>}
                <td className="px-2 py-1 font-mono text-xs">{r.route}{r.limit !== null && <Dim> {tx("limite {0}/min", r.limit)}</Dim>}</td>
                <td className="px-2 py-1 text-right font-semibold">{r.per_min}</td><td className="px-2 py-1 text-right">{r.per_hour}</td>
                <td className="px-2 py-1 text-right">{r.total}</td><td className="px-2 py-1 text-right">{r.hits || ""}</td>
                <td className="px-2 py-1 text-right">{r.last_ms === null ? "" : `${r.last_ms} ms`}</td><td className="px-2 py-1 text-right">{r.avg_ms === null ? "" : `${r.avg_ms} ms`}</td>
                <td className="px-2 py-1">{r.total > 0 && <Badge tone={codeTone(r.last_code)}>{r.last_code ?? tx("aucune réponse")}</Badge>}</td>
                <td className="px-2 py-1 text-right">{text429(r)}</td>
                <td className="max-w-[18rem] truncate px-2 py-1 text-xs text-muted" title={r.last_error}>{r.last_error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-dim">{tx("Compteurs en mémoire depuis le démarrage du serveur, image de développement seulement ; relus toutes les {0} s.", POLL / 1000)}</p>
    </div>
  );
}

/** Folded panel « Requests (debugging) », read while open; `owner` limits it to one connector. Shown by the caller on a development build only. */
export function RequestStatsPanel({ owner, id }: Readonly<{ owner?: string; id: string }>) {
  const [doc, setDoc] = useState<RequestDoc | null>(null), [failed, setFailed] = useState(false);
  const load = useCallback(() => { read<RequestDoc>("connectors/requests").then((d) => { setDoc(d); setFailed(false); }).catch(() => setFailed(true)); }, []);
  usePoll(load, POLL);
  const watch = doc ? doc.watch.filter((w) => !owner || w.owner === owner).length : 0;
  return (
    <FoldPanel id={`requests-${id}`} icon={Activity} title={tx("Requêtes (débogage)")} count={watch || undefined} tone={watch ? "warn" : "off"} startFolded>
      {failed && !doc ? <Empty>{tx("Lecture des compteurs impossible.")}</Empty> : doc && <RequestTable doc={doc} owner={owner} />}
    </FoldPanel>
  );
}
