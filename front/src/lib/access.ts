// Présentation de la recommandation de méthode de lecture d'une machine (voir access_advice.py côté serveur) : titre, phrase, bouton.
import { tx } from "./i18n";
import type { Advice } from "../types";

/** todo : rien ne lit encore la machine · optimize : lue, mais pas par la meilleure méthode · ok : rien à faire (ou rien de possible) */
export type AdviceStatus = "todo" | "optimize" | "ok";

export interface AdviceView {
  status: AdviceStatus;
  title: string;                       // « SSH », « Agent Windows »…
  why: string;                         // une phrase sans jargon
  read: boolean;                       // la méthode recommandée lit déjà la machine : rien à faire
  action: { label: string; href: string } | null;
  others: string[];                    // autres méthodes possibles (libellés)
}

const METHOD_LABEL = (m: string, kind: string | null) => m === "ssh" ? "SSH" : m === "agent" ? (kind === "windows" ? tx("Agent Windows") : kind === "linux" ? tx("Agent Linux") : tx("Agent")) : m === "connector" ? tx("Connecteur") : tx("Ping seul");

const WHY: Record<string, () => string> = {
  appliance: () => tx("Box, passerelle ou équipement fermé : on n'y installe rien. MyServices la lit par un outil déjà en place (un connecteur)."),
  windows: () => tx("PC Windows : un petit agent envoie sa santé à MyServices, sans rien ouvrir sur le PC."),
  home_assistant: () => tx("Home Assistant OS : on le lit par son API (un jeton), ni par SSH ni par un agent."),
  device: () => tx("Appareil fermé (téléphone, objet connecté) : seul le ping est possible."),
  macos: () => tx("Mac : par SSH (il n'existe pas d'agent pour macOS)."),
  macos_no_ssh: () => tx("Mac sans SSH ouvert : ping seul pour l'instant. Activez la session à distance pour le lire."),
  ssh_configured: () => tx("Machine Linux avec un accès SSH : c'est la méthode la plus simple. Un agent reste possible en secours."),
  ssh_port: () => tx("Un accès SSH répond sur cette machine : MyServices peut la lire par SSH, il reste à autoriser sa clé."),
  connector_only: () => tx("Un outil déjà en place la voit. Un agent est possible si vous voulez plus de détails."),
  unreachable: () => tx("La machine ne répond pas en ce moment (éteinte ?). Vous pourrez la régler quand elle sera allumée."),
  no_ssh_port: () => tx("Machine Linux sans SSH ouvert : un petit agent permet de la lire sans rien ouvrir."),
  unknown_system: () => tx("Système inconnu : MyServices ne devine pas. Choisissez un agent Windows ou Linux si vous voulez la lire, sinon elle reste en ping seul."),
};

export function describeAdvice(ip: string, a: Advice): AdviceView {
  const read = a.current.includes(a.method === "ping" ? "" : a.method);
  let action: AdviceView["action"] = null;
  if (!read) {
    if (a.method === "ssh") action = { label: tx("Régler l'accès SSH"), href: `#settings/machines/${ip}` };
    else if (a.method === "agent") action = { label: a.agent_kind === "windows" ? tx("Installer l'agent Windows") : tx("Installer l'agent Linux"), href: `#settings/agents/${ip}` };
    else if (a.method === "connector") action = { label: tx("Voir les connecteurs"), href: "#settings/connectors" };
  }
  const status: AdviceStatus = read || a.method === "ping" ? "ok" : a.current.length ? "optimize" : "todo";
  return {
    status, title: METHOD_LABEL(a.method, a.agent_kind), why: (WHY[a.why] ?? (() => ""))(), read, action,
    others: a.alternatives.map((m) => METHOD_LABEL(m, a.agent_kind)),
  };
}

/** Ordre des machines : d'abord celles à finir, puis celles à optimiser, en dernier celles qui sont en place */
export const STATUS_RANK: Record<AdviceStatus, number> = { todo: 0, optimize: 1, ok: 2 };

/** Résumé de l'étape : combien de machines sont déjà lues par la méthode recommandée */
export function summary(advice: Record<string, Advice>): { total: number; read: number } {
  const all = Object.values(advice);
  return { total: all.length, read: all.filter((a) => a.method !== "ping" && a.current.includes(a.method)).length };
}
