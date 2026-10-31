// Barre de progression de la collecte, tout en haut de la fenêtre. Position fixe : elle ne pousse ni l'en-tête
// ni le contenu, et n'existe pas tant qu'aucun passage ne tourne. L'étiquette (grand écran) donne l'étape en cours.
import { useEffect, useRef } from "react";
import { ROOT } from "../api";
import { tx } from "../lib/i18n";
import { shownTasks, taskColor, taskTitle } from "../lib/headerTasks";
import { registerPoller, setScan, useScan, type NetworkSummary, type ScanStatus } from "../lib/scan";
import { onStream, streamConnected } from "../lib/stream";

const IDLE_MS = 10_000, RUN_MS = 1_500, STREAM_IDLE_MS = 60_000;   // with the event stream the state arrives by itself: a safety read only

/** Avancement de 0 à 1 : étapes finies, plus la part des sondes de l'étape en cours (compteur done / total) */
export function fraction(p: NonNullable<ScanStatus["progress"]>): number {
  const part = p.total ? Math.min(1, (p.done ?? 0) / p.total) : 0;
  return Math.max(0.03, Math.min(1, (p.step - 1 + part) / p.steps));
}

/** Recherche réseau : la 1re moitié de la barre est le ping, la 2e l'identification des machines trouvées */
export function netPercent(n: Pick<NetworkSummary, "phase" | "done" | "total" | "up" | "described">): number {
  if (n.phase === "identify") return Math.min(100, 50 + Math.round((n.described / Math.max(1, n.up)) * 50));
  return Math.min(50, Math.round((n.done / Math.max(1, n.total)) * 50));
}

type Progress = ScanStatus["progress"];

/** The tasks that do not say how far they are get null: a block that goes back and forth */
function barPercent(p: Progress | undefined, net: NetworkSummary | null | undefined): number | null {
  if (p) return Math.round(fraction(p) * 100);
  return net ? netPercent(net) : null;
}

function barLabel(main: string, p: Progress | undefined, net: NetworkSummary | null | undefined): string {
  if (p) return `${p.label}${p.total ? ` (${p.done ?? 0}/${p.total})` : ""}`;
  if (net) return net.phase === "identify" ? tx("identification : {0}/{1} machines (nom, ports ouverts)", net.described, net.up)
    : tx("recherche des machines allumées : {0}/{1} adresses", net.done, net.total);
  return main === "collect" ? tx("démarrage…") : "";
}

export function ScanBar({ onFinished }: { onFinished: () => void }) {
  const st = useScan();
  const was = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const apply = (next: ScanStatus | null) => {
      if (was.current && !next?.running) finished.current(); // passage terminé : la page relit ses données
      was.current = !!next?.running;
      setScan(next);
    };
    const tick = async () => {
      if (document.hidden) { timer = setTimeout(() => void tick(), IDLE_MS); return; }   // hidden tab: asked again when it is shown (visibilitychange below)
      let next: ScanStatus | null = null;
      try {
        const r = await fetch(`${ROOT}api/v1/status`, { cache: "no-store" });
        if (r.ok) next = (await r.json()) as ScanStatus;
      } catch {
        // serveur injoignable : la barre s'efface, la page signale déjà l'erreur
      }
      if (stop) return;
      apply(next);
      const running = next?.running || next?.network?.running || next?.tasks?.length;
      timer = setTimeout(() => void tick(), running && !streamConnected() ? RUN_MS : streamConnected() ? STREAM_IDLE_MS : IDLE_MS);
    };
    void tick();
    const unregister = registerPoller(() => { clearTimeout(timer); void tick(); });
    const shown = () => { if (!document.hidden) { clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", shown);
    const off = onStream("status", (s) => { if (!stop) apply(s as ScanStatus); });   // the server says it: no read at all
    return () => { stop = true; clearTimeout(timer); unregister(); off(); document.removeEventListener("visibilitychange", shown); };
  }, []);
  const [main] = shownTasks(st);
  if (!main) return null;
  const p = main === "collect" ? st?.progress : null, net = main === "netscan" ? st?.network : null;
  const pct = barPercent(p, net);
  const title = taskTitle(main), tint = `scan-${main}`;
  const label = barLabel(main, p, net);
  return (
    <div role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
      aria-valuetext={label || title} className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="h-1 w-full bg-line/60">
        {pct === null ? <div className={`scan-wait h-full ${tint}`} /> : <div className={`scan-fill h-full rounded-r-full ${tint}`} style={{ width: `${pct}%` }}><span className="scan-head" aria-hidden /></div>}
      </div>
      <div className="mx-auto mt-1.5 hidden w-fit max-w-[60vw] items-center gap-2 truncate rounded-full border border-line bg-card/90 px-3 py-0.5 text-xs text-muted shadow-sm backdrop-blur sm:flex md:hidden">
        <span className="font-semibold" style={{ color: taskColor(main) }}>{title}</span>
        {p && <span className="tabular-nums text-dim">{p.step}/{p.steps}</span>}
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}
