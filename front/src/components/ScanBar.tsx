// Barre de progression de la collecte, tout en haut de la fenêtre. Position fixe : elle ne pousse ni l'en-tête
// ni le contenu, et n'existe pas tant qu'aucun passage ne tourne. L'étiquette (grand écran) donne l'étape en cours.
import { useEffect, useRef } from "react";
import { ROOT } from "../api";
import { tx } from "../lib/i18n";
import { registerPoller, setScan, useScan, type NetworkSummary, type ScanStatus } from "../lib/scan";

const IDLE_MS = 10_000, RUN_MS = 1_500;

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

export function ScanBar({ onFinished }: { onFinished: () => void }) {
  const st = useScan();
  const was = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let next: ScanStatus | null = null;
      try {
        const r = await fetch(`${ROOT}api/v1/status`, { cache: "no-store" });
        if (r.ok) next = (await r.json()) as ScanStatus;
      } catch {
        // serveur injoignable : la barre s'efface, la page signale déjà l'erreur
      }
      if (stop) return;
      if (was.current && !next?.running) finished.current(); // passage terminé : la page relit ses données
      was.current = !!next?.running;
      setScan(next);
      timer = setTimeout(() => void tick(), next?.running || next?.network?.running ? RUN_MS : IDLE_MS);
    };
    void tick();
    const unregister = registerPoller(() => { clearTimeout(timer); void tick(); });
    return () => { stop = true; clearTimeout(timer); unregister(); };
  }, []);
  const net = st?.network?.running ? st.network : null;
  if (!st?.running && !net) return null;
  const p = st?.running ? st.progress : null;
  const pct = p ? Math.round(fraction(p) * 100) : net ? netPercent(net) : null;
  const title = net && !st?.running ? tx("Découverte") : tx("Recherche réseau en cours");
  const label = p ? `${p.label}${p.total ? ` (${p.done ?? 0}/${p.total})` : ""}`
    : net ? (net.phase === "identify" ? tx("identification : {0}/{1} machines (nom, ports ouverts)", net.described, net.up)
                                      : tx("recherche des machines allumées : {0}/{1} adresses", net.done, net.total)) : tx("démarrage…");
  return (
    <div role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
      aria-valuetext={label} className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="h-1 w-full bg-line/60">
        {pct === null ? <div className="scan-wait h-full" /> : <div className="scan-fill h-full rounded-r-full" style={{ width: `${pct}%` }}><span className="scan-head" aria-hidden /></div>}
      </div>
      <div className="mx-auto mt-1.5 hidden w-fit max-w-[60vw] items-center gap-2 truncate rounded-full border border-line bg-card/90 px-3 py-0.5 text-xs text-muted shadow-sm backdrop-blur sm:flex">
        <span className="font-semibold text-txt">{title}</span>
        {p && <span className="tabular-nums text-dim">{p.step}/{p.steps}</span>}
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}
