// What a working agent cannot read yet: said in words, because the machine keeps going through SSH and nothing looks wrong otherwise.
import { TriangleAlert } from "lucide-react";
import { tx } from "../lib/i18n";
import type { AgentInfo } from "../types";

const GAP: Record<string, () => string> = {
  sudo: () => tx("L'agent voit les ports ouverts, mais il lui manque sudo pour savoir quel programme les tient : relancez la commande d'installation avec MSV_SUDO=1 après « sudo env »."),
  docker: () => tx("Le compte de l'agent ne lit pas Docker : relancez la commande d'installation avec MSV_DOCKER=1 après « sudo env » (ce groupe donne les droits de root)."),
  info: () => tx("Le relevé de l'agent ne contient pas les informations de la machine : mettez l'agent à jour."),
  needrestart: () => tx("Sans sudo, l'agent ne voit pas les services à relancer : Nouvelle commande, cochez la case sudo, puis lancez-la sur la machine."),
  hypervisors: () => tx("Sans sudo, l'agent ne voit pas les machines virtuelles : Nouvelle commande, cochez la case sudo, puis lancez-la sur la machine."),
  fail2ban: () => tx("Sans sudo, l'agent ne voit pas les adresses bloquées par fail2ban : Nouvelle commande, cochez la case sudo, puis lancez-la sur la machine."),
};

/** Shown only when something is to be done: what the agent cannot read with no SSH to read it instead, and the rights only the agent can use */
export function AgentTodo({ a, ssh }: Readonly<{ a: AgentInfo; ssh: boolean }>) {
  const gaps = ssh ? [] : a.gaps ?? [], lines = [...gaps, ...a.rights ?? []].map((g) => GAP[g]?.() ?? g);
  if (!lines.length) return null;
  const label = tx("À faire sur cet agent"), noSsh = gaps.length ? [tx("Cette machine n'a pas de SSH pour le lire à la place.")] : [];
  return <span title={[label, ...lines, ...noSsh].join("\n")} className="inline-flex text-warn"><TriangleAlert size={14} aria-label={label} /></span>;
}

export function AgentGaps({ gaps }: Readonly<{ gaps: string[] }>) {
  return (
    <span className="flex flex-col gap-0.5 text-xs text-muted">
      {gaps.map((g) => <span key={g}>{GAP[g]?.() ?? g}</span>)}
      <span className="text-dim">{tx("Rien n'est cassé : la collecte passe par le SSH pour ce qui manque, si la machine en a un.")}</span>
    </span>
  );
}
