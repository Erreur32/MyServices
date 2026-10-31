// What a working agent cannot read yet: said in words, because the machine keeps going through SSH and nothing looks wrong otherwise.
import { tx } from "../lib/i18n";

const GAP: Record<string, () => string> = {
  sudo: () => tx("L'agent voit les ports ouverts, mais il lui manque sudo pour savoir quel programme les tient : relancez la commande d'installation avec MSV_SUDO=1 après « sudo env »."),
  docker: () => tx("Le compte de l'agent ne lit pas Docker : relancez la commande d'installation avec MSV_DOCKER=1 après « sudo env » (ce groupe donne les droits de root)."),
  info: () => tx("Le relevé de l'agent ne contient pas les informations de la machine : mettez l'agent à jour."),
};

export function AgentGaps({ gaps }: Readonly<{ gaps: string[] }>) {
  return (
    <span className="flex flex-col gap-0.5 text-xs text-muted">
      {gaps.map((g) => <span key={g}>{GAP[g]?.() ?? g}</span>)}
      <span className="text-dim">{tx("Rien n'est cassé : la collecte passe par le SSH pour ce qui manque, si la machine en a un.")}</span>
    </span>
  );
}
