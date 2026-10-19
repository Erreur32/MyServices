// Orbe « searching » au centre de l'en-tête pendant qu'un passage tourne (collecte, recherche réseau) : le point de repère visible sans
// regarder la barre du haut. thinking-orbs (MIT, sans dépendance) est chargée à la demande : rien n'est téléchargé tant que rien ne tourne.
import { lazy, Suspense } from "react";
import { tx } from "../lib/i18n";
import { serverText } from "../lib/serverText";
import { useScan } from "../lib/scan";

const Orb = lazy(() => import("thinking-orbs").then((m) => ({ default: m.ThinkingOrb })));

const netStep = (net: { phase?: string } | null): string => {
  if (!net) return tx("démarrage…");
  return net.phase === "identify" ? tx("identification des machines") : tx("recherche des machines allumées");
};

export function ScanOrb() {
  const st = useScan();
  const net = st?.network?.running ? st.network : null;
  if (!st?.running && !net) return null;
  const p = st?.running ? st.progress : null;
  const title = st?.running ? tx("Collecte en cours") : tx("Recherche réseau en cours");
  const step = p ? `${p.step}/${p.steps} · ${serverText(p.label)}` : netStep(net);   // the step label comes from the server, in French
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 items-center justify-center gap-3 md:flex" role="status" aria-live="polite" aria-label={`${title} : ${step}`}>
      <Suspense fallback={<span className="block h-16 w-16" aria-hidden />}><Orb state="searching" size={64} theme="auto" /></Suspense>
      <span className="flex min-w-0 max-w-[16rem] flex-col text-xs leading-tight">
        <b className="text-sm text-txt">{title}</b>
        <span className="truncate text-dim">{step}</span>
      </span>
    </div>
  );
}
