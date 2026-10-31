// Orbe « searching » au centre de l'en-tête pendant qu'une tâche choisie tourne (lib/headerTasks.ts) : le point de repère visible sans
// regarder la barre du haut. thinking-orbs (MIT, sans dépendance) est chargée à la demande : rien n'est téléchargé tant que rien ne tourne.
import { lazy, Suspense } from "react";
import { tx } from "../lib/i18n";
import { serverText } from "../lib/serverText";
import { orbLook, shownTasks, taskColor, taskTitle } from "../lib/headerTasks";
import { useScan } from "../lib/scan";

const Orb = lazy(() => import("thinking-orbs").then((m) => ({ default: m.ThinkingOrb })));

const netStep = (net: { phase?: string } | null): string => {
  if (!net) return tx("démarrage…");
  return net.phase === "identify" ? tx("identification des machines") : tx("recherche des machines allumées");
};

export function ScanOrb() {
  const st = useScan();
  const [main, ...others] = shownTasks(st);
  if (!main) return null;
  const p = main === "collect" ? st?.progress : null;
  const step = (): string => {
    if (p) return `${p.step}/${p.steps} · ${serverText(p.label)}`;   // the step label comes from the server, in French
    if (main === "collect") return netStep(null);
    if (main === "netscan") return netStep(st?.network ?? null);
    return "";
  };
  const title = taskTitle(main), detail = step();
  const also = others.map(taskTitle).join(" · ");
  return (
    <div className="pointer-events-none hidden items-center justify-center gap-3 md:flex" role="status" aria-live="polite" aria-label={detail ? `${title} : ${detail}` : title}>
      <Suspense fallback={<span className="block h-16 w-16" aria-hidden />}><Orb state="searching" size={64} speed={0.6} {...orbLook(main)} /></Suspense>
      <span className="flex flex-col whitespace-nowrap text-xs leading-tight">
        <b className="text-sm" style={{ color: taskColor(main) }}>{title}</b>
        {detail && <span className="text-dim">{detail}</span>}
        {also && <span className="text-dim">{also}</span>}
      </span>
    </div>
  );
}
