// Réglages → Requêtes et journaux → Journaux : ce que le conteneur écrit (le même texte que « docker logs »), depuis son démarrage, relu toutes les 5 s.
// Filtré par origine (serveur ou tâche : collecte, veille, santé, sauvegardes), erreurs seulement, texte ; téléchargeable.
import { Download, Pause, Play, ScrollText, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LOGIN, LoginRequired, read } from "../api";
import { Card, Count, Dim } from "../components/ui";
import { dateTime, norm } from "../lib/format";
import { input, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { isProblem, sourceOf } from "../lib/logs";
import { usePoll } from "../lib/polling";
import { InfoNote } from "../components/InfoNote";

interface Line { n: number; t: number; err: boolean; text: string }
interface Logs { lines: Line[]; last: number; started: number; kept: number }

const KEEP = 3000;
const SOURCES: Record<string, string> = { server: tx("Serveur"), collect: tx("Collecte"), watch: tx("Veille"), health: tx("Santé"), backups: tx("Sauvegardes") };
const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`;

export function Logs() {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [started, setStarted] = useState(0);
  const [error, setError] = useState("");
  const [src, setSrc] = useState(""), [problems, setProblems] = useState(false), [q, setQ] = useState(""), [follow, setFollow] = useState(true);
  const last = useRef(0), box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    read<Logs>(`system/logs?after=${last.current}`)
      .then((d) => {
        if (d.last < last.current) { last.current = 0; setLines(null); return; }   // conteneur redémarré : on repart de zéro
        last.current = d.last;
        setStarted(d.started);
        setLines((old) => [...(old ?? []), ...d.lines].slice(-KEEP));
        setError("");
      })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  usePoll(load, follow ? 5_000 : 60_000);
  const all = useMemo(() => lines ?? [], [lines]);
  const sources = useMemo(() => [...new Set(all.map((l) => sourceOf(l.text)))].sort((a, b) => (a === "server" ? -1 : b === "server" ? 1 : a.localeCompare(b))), [all]);
  const shown = useMemo(() => {
    const n = norm(q);
    return all.filter((l) => (!src || sourceOf(l.text) === src) && (!problems || isProblem(l)) && (!n || norm(l.text).includes(n)));
  }, [all, src, problems, q]);
  const nProblems = useMemo(() => all.filter(isProblem).length, [all]);
  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, follow]);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([shown.map((l) => l.text).join("\n") + "\n"], { type: "text/plain" }));
    a.download = `myservices-logs-${new Date().toISOString().slice(0, 16).replace(":", "")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (!lines) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><ScrollText size={16} aria-hidden />{tx("Journaux du conteneur")} <Count n={`${shown.length} / ${all.length}`} /></h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={quiet} onClick={() => setFollow(!follow)} title={follow ? tx("Arrêter de suivre les nouvelles lignes") : tx("Suivre les nouvelles lignes (relu toutes les 5 s)")}>
            {follow ? <Pause size={14} /> : <Play size={14} />}{follow ? tx("Pause") : tx("Suivre")}
          </button>
          <button type="button" className={quiet} disabled={!shown.length} onClick={download}><Download size={14} />{tx("Télécharger (.txt)")}</button>
        </div>
      </div>
      <InfoNote className="mb-3">
        {tx("Le même texte que « docker compose logs myservices » : le serveur et la sortie de chaque tâche, depuis le démarrage du conteneur ({0}), {1} dernières lignes au plus.", started ? dateTime(started * 1000) : "?", KEEP)}
        {" "}<Dim>{tx("Les actions des comptes sont dans le Journal d'audit.")}</Dim>
      </InfoNote>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className={chip(!src)} onClick={() => setSrc("")}>{tx("Tout")}</button>
        {sources.map((s) => <button key={s} type="button" className={chip(src === s)} onClick={() => setSrc(src === s ? "" : s)}>{SOURCES[s] ?? s}</button>)}
        <button type="button" className={`${chip(problems)} ${nProblems && !problems ? "border-warn/60 text-warn" : ""}`} onClick={() => setProblems(!problems)}>{tx("Erreurs et avertissements ({0})", nProblems)}</button>
        <label className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" aria-hidden />
          <input className={`${input} py-1.5 pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Chercher dans les journaux")} aria-label={tx("Chercher dans les journaux")} />
        </label>
      </div>
      {error && <p className="mb-2 text-xs text-warn">⚠ {error}</p>}
      <div ref={box} onScroll={(e) => { const el = e.currentTarget; if (follow && el.scrollHeight - el.scrollTop - el.clientHeight > 40) setFollow(false); }}
        className="max-h-[65vh] overflow-auto rounded-lg border border-line bg-bg2/60 p-2 font-mono text-[12px] leading-relaxed">
        {shown.length ? shown.map((l) => (
          <div key={l.n} className={`whitespace-pre-wrap break-all ${isProblem(l) ? "text-warn" : "text-muted"}`}>{l.text}</div>
        )) : <p className="p-2 text-dim">{tx("Aucune ligne.")}</p>}
      </div>
    </Card>
  );
}
