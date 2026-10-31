// Settings > Requests: the calls of every connector to its service, per route, as the server counted them since it started
// (connectors/reqstats.py), measured in real conditions on any build. « To watch »: a route near or over a limit known on the service,
// or a 429 received during the last hour. A button copies the whole reading (JSON) to paste for analysis. RequestTable is pure (tested as is).
import { Activity, Copy, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { read, send } from "../api";
import { copyText } from "../lib/clipboard";
import { dateTime } from "../lib/format";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";
import { InfoNote } from "./InfoNote";
import { Badge, Dim, Empty } from "./ui";

export type RequestRow = {
  owner: string; route: string; per_min: number; per_hour: number; total: number; hits: number; last_ms: number | null; avg_ms: number | null;
  last_code: number | null; n429: number; retry_after: number | null; last_error: string; last_at: number | null; limit: number | null; watch: boolean;
};
export type RequestWatch = { owner: string; route: string; per_min: number; limit: number | null; n429: number; retry_after: number | null };
/** What a pulse costs: one ping or TCP connection per target and pass (`every` = 0: the pulse is off) */
export type PulseCost = { name: "machines" | "ports"; targets: number; every: number; per_min: number };
export type RequestDoc = { rows: RequestRow[]; watch: RequestWatch[]; at: number; version?: string; pulses?: PulseCost[] };

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

export function watchText(w: RequestWatch): string {
  if (w.n429 > 0) return w.retry_after === null ? tx("429 reçu sur {0} ({1})", w.route, w.owner) : tx("429 reçu sur {0} ({1}), réessai dans {2} s", w.route, w.owner, w.retry_after);
  return tx("{0} appels par minute sur {1} ({2}), limite {3}", w.per_min, w.route, w.owner, w.limit ?? "?");
}

const PULSE_NAME = { machines: tx("Pouls (ping des machines)"), ports: tx("Pouls (port des services)") };

/** The pulses are not connector calls: their cost per minute next to the counters, so that the whole load of the app is read in one place */
export function PulseCosts({ pulses }: Readonly<{ pulses: PulseCost[] }>) {
  if (pulses.length === 0) return null;
  const total = Math.round(pulses.reduce((sum, p) => sum + p.per_min, 0) * 10) / 10;
  return (
    <ul className="mb-3 space-y-0.5 rounded-lg border border-line/60 bg-bg/50 px-3 py-2 text-sm">
      {pulses.map((p) => (
        <li key={p.name}>
          <b>{PULSE_NAME[p.name]}</b>{" "}
          {p.every > 0 ? tx("{0} cible(s), une passe toutes les {1} s : {2} connexions par minute", p.targets, p.every, p.per_min) : tx("coupé")}
        </li>
      ))}
      <li className="text-muted">{tx("Pouls au total : {0} connexions par minute", total)}</li>
    </ul>
  );
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
    </div>
  );
}

/** The Settings section: every connector, read again every few seconds, the reading copied as JSON on a click. */
export function RequestsSettings() {
  const [doc, setDoc] = useState<RequestDoc | null>(null), [failed, setFailed] = useState(false), [copied, setCopied] = useState<"" | "ok" | "no">("");
  const load = useCallback(() => { read<RequestDoc>("connectors/requests").then((d) => { setDoc(d); setFailed(false); }).catch(() => setFailed(true)); }, []);
  usePoll(load, POLL);
  const copy = async () => {
    if (!doc) return;
    setCopied((await copyText(JSON.stringify({ taken: new Date().toISOString(), ...doc }, null, 1))) ? "ok" : "no");
    setTimeout(() => setCopied(""), 4000);
  };
  const reset = () => void send("POST", "connectors/requests/reset").then(load).catch(() => setFailed(true));
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <Activity size={16} className="text-link" aria-hidden />
        <h2 className="font-bold">{tx("Requêtes")}</h2>
        {doc && doc.watch.length > 0 && <Badge tone="warn">{doc.watch.length} {tx("à surveiller")}</Badge>}
        {doc && <Dim>{tx("relevé à {0}", dateTime(doc.at))}</Dim>}
        <button type="button" className={`${quiet} ml-auto flex items-center gap-1.5`} disabled={!doc} onClick={() => void copy()} title={tx("Copie le relevé complet (JSON) : à coller pour analyse")}>
          <Copy size={14} aria-hidden />{tx("Copier le relevé")}
        </button>
        <button type="button" className={`${quiet} flex items-center gap-1.5`} disabled={!doc} onClick={reset} title={tx("Remet tous les compteurs à zéro (nouvelle mesure)")}>
          <RotateCcw size={14} aria-hidden />{tx("Remettre à zéro")}
        </button>
        {copied === "ok" && <output className="text-sm text-ok">{tx("relevé copié")}</output>}
        {copied === "no" && <output className="text-sm text-warn">{tx("Copie impossible ici : sélectionnez le tableau à la main")}</output>}
      </div>
      <div className="p-4">
        <InfoNote className="mb-3">{tx("Appels de chaque connecteur vers son service, comptés par route depuis le démarrage du serveur ; relus toutes les {0} s. Une route proche d'une limite connue du service, ou un 429 reçu dans l'heure, est signalée.", POLL / 1000)}</InfoNote>
        {doc?.pulses && <PulseCosts pulses={doc.pulses} />}
        {failed && !doc ? <Empty>{tx("Lecture des compteurs impossible.")}</Empty> : doc && <RequestTable doc={doc} />}
      </div>
    </section>
  );
}
