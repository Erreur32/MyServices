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
  action: { label: string; setup: "ssh" | "agent" | "connector" } | null;   // le réglage à ouvrir (dans une fenêtre, jamais un lien hors de la page)
  others: { label: string; active: boolean }[];   // autres méthodes possibles, et si elles lisent déjà la machine
  now: string;                         // ce qui la lit aujourd'hui, en mots
  explain: string | null;              // pourquoi ce n'est pas encore la meilleure méthode (status « optimize »)
  todo: string | null;                 // ce qu'il faut faire, en une phrase (quand une action existe)
}

const METHOD_LABEL = (m: string, kind: string | null) => m === "ssh" ? "SSH" : m === "agent" ? (kind === "windows" ? tx("Agent Windows") : kind === "linux" ? tx("Agent Linux") : tx("Agent")) : m === "connector" ? tx("Connecteur") : tx("Ping seul");

const OTHER_LABEL: Record<string, () => string> = { ssh: () => "SSH", agent: () => tx("un agent"), connector: () => tx("un connecteur"), ping: () => tx("le ping seul") };
const NOW_LABEL: Record<string, () => string> = { ssh: () => "SSH", agent: () => tx("l'agent"), connector: () => tx("un connecteur") };

/** Ce que la meilleure méthode apporte de plus */
const BENEFIT: Record<string, (kind: string | null) => string> = {
  ssh: () => tx("Docker, services, mises à jour et journaux sont lus en détail."),
  agent: (kind) => kind === "windows" ? tx("disques, mémoire, services, mises à jour Windows et journal, sans rien ouvrir sur le PC.") : tx("disques, services, mises à jour et journal, sans rien ouvrir sur la machine."),
  connector: () => tx("l'outil qui voit déjà cette machine fournit ses données."),
};

/** Ce qu'il faut faire pour mettre la méthode en place */
const TODO: Record<string, (kind: string | null) => string> = {
  ssh: () => tx("Autorisez la clé SSH de MyServices sur la machine : une commande à copier, puis un test."),
  agent: (kind) => kind === "windows" ? tx("Créez l'agent, puis collez la commande dans un PowerShell administrateur du PC.") : tx("Créez l'agent, puis collez la commande dans un terminal de la machine (avec sudo)."),
  connector: () => tx("Reliez l'outil qui voit cette machine."),
};

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

/** Richesse de ce que chaque méthode recueille : SSH et agent lisent la santé complète (disques, services, mises à jour, journal), un connecteur ce que
 *  son outil fournit, le ping seulement la présence. Une machine n'est « à optimiser » que si la méthode recommandée recueille PLUS que ce qui la lit déjà. */
export const RICHNESS: Record<string, number> = { ssh: 3, agent: 3, connector: 1, ping: 0 };

export function describeAdvice(_ip: string, a: Advice): AdviceView {
  const best = Math.max(0, ...a.current.map((m) => RICHNESS[m] ?? 0));
  const read = a.method !== "ping" && (a.current.includes(a.method) || best >= RICHNESS[a.method]);
  let action: AdviceView["action"] = null;
  if (!read) {
    if (a.method === "ssh") action = { label: tx("Régler l'accès SSH"), setup: "ssh" };
    else if (a.method === "agent") action = { label: a.agent_kind === "windows" ? tx("Installer l'agent Windows") : tx("Installer l'agent Linux"), setup: "agent" };
    else if (a.method === "connector") action = { label: tx("Régler le connecteur"), setup: "connector" };
  }
  const status: AdviceStatus = read || a.method === "ping" ? "ok" : a.current.length ? "optimize" : "todo";
  const title = METHOD_LABEL(a.method, a.agent_kind), now = a.current.map((m) => NOW_LABEL[m]()).join(", ");
  // Un agent est installé mais ne répond plus : la cause la plus utile à dire, avant la méthode manquante
  const silent = a.method === "agent" && a.agent_state && a.agent_state !== "actif";
  const explain = status !== "optimize" ? null : silent
    ? tx("Un agent est déjà installé, mais il ne répond plus ({0}). Vérifiez que la machine est allumée et qu'elle joint MyServices ; sinon recréez l'agent.", a.agent_state ?? "")
    : tx("Aujourd'hui elle est lue par {0}. {1} donnerait plus : {2}", now, title, (BENEFIT[a.method] ?? (() => ""))(a.agent_kind));
  return {
    status, title, why: (WHY[a.why] ?? (() => ""))(), read, action, now, explain,
    todo: action ? (silent ? tx("Si l'agent est perdu, recréez-le : un nouveau jeton remplace l'ancien.") : (TODO[a.method] ?? (() => ""))(a.agent_kind)) || null : null,
    others: a.alternatives.filter((m) => m !== "ping").map((m) => ({ label: OTHER_LABEL[m](), active: a.current.includes(m) })),
  };
}

/** Ordre des machines : d'abord celles à finir, puis celles à optimiser, en dernier celles qui sont en place */
export const STATUS_RANK: Record<AdviceStatus, number> = { todo: 0, optimize: 1, ok: 2 };

/** Résumé de l'étape : combien de machines sont déjà lues par la méthode recommandée */
export function summary(advice: Record<string, Advice>): { total: number; read: number } {
  const all = Object.values(advice);
  return { total: all.length, read: all.filter((a) => a.method !== "ping" && a.current.includes(a.method)).length };
}
