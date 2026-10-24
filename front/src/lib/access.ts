// Présentation de la recommandation de méthode de lecture d'une machine (voir access_advice.py côté serveur) : titre, phrase, bouton.
import { tx } from "./i18n";
import type { Advice } from "../types";

/** Trois états d'une machine : à régler (rien ne la lit encore), à optimiser (lue, mais pas par la meilleure méthode), en place (rien à faire ou rien de possible) */
export type AdviceStatus = "todo" | "optimize" | "ok";

export interface AdviceView {
  status: AdviceStatus;
  kept: boolean;                       // l'utilisateur a choisi de garder la méthode actuelle (« C'est suffisant ainsi »)
  title: string;                       // « SSH », « Agent Windows »…
  why: string;                         // une phrase sans jargon
  read: boolean;                       // la méthode recommandée lit déjà la machine : rien à faire
  action: { label: string; setup: "ssh" | "agent" | "connector" } | null;   // le réglage à ouvrir (dans une fenêtre, jamais un lien hors de la page)
  others: { label: string; active: boolean }[];   // autres méthodes possibles, et si elles lisent déjà la machine
  now: string;                         // ce qui la lit aujourd'hui, en mots
  explain: string | null;              // pourquoi ce n'est pas encore la meilleure méthode (status « optimize »)
  todo: string | null;                 // ce qu'il faut faire, en une phrase (quand une action existe)
}

const AGENT_LABEL: Record<string, () => string> = { windows: () => tx("Agent Windows"), linux: () => tx("Agent Linux") };

function METHOD_LABEL(m: string, kind: string | null): string {
  if (m === "ssh") return "SSH";
  if (m === "agent") return (AGENT_LABEL[kind ?? ""] ?? (() => tx("Agent")))();
  return m === "connector" ? tx("Connecteur") : tx("Ping seul");
}

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
  esxi: () => tx("VMware ESXi : on n'y installe rien. MyServices le lit par SSH ou par un connecteur, jamais par un agent."),
  nas: () => tx("NAS fermé (Synology, QNAP, TrueNAS, Unraid…) : on n'y installe pas d'agent. MyServices le lit par son connecteur ou par SSH."),
  device: () => tx("Appareil fermé (téléphone, objet connecté) : seul le ping est possible."),
  macos: () => tx("Mac : par SSH (il n'existe pas d'agent pour macOS)."),
  macos_no_ssh: () => tx("Mac sans SSH ouvert : ping seul pour l'instant. Activez la session à distance pour le lire."),
  agent_linux_ssh: () => tx("Machine Linux lue par SSH : un agent la relirait chaque minute, sans clé SSH. Gardez le SSH s'il sert aux sauvegardes, à Proxmox ou ESXi, à NPM ou à AdGuard."),
  agent_linux: () => tx("Machine Linux : un petit agent la lit chaque minute, sans clé SSH à autoriser. Le SSH reste possible, et utile pour les sauvegardes, Proxmox ou ESXi, NPM et AdGuard."),
  connector_only: () => tx("Un outil déjà en place la voit. Un agent est possible si vous voulez plus de détails."),
  unreachable: () => tx("La machine ne répond pas en ce moment (éteinte ?). Vous pourrez la régler quand elle sera allumée."),
  no_ssh_port: () => tx("Machine Linux sans SSH ouvert : un petit agent permet de la lire sans rien ouvrir."),
  unknown_system: () => tx("Système inconnu : MyServices ne devine pas. Choisissez un agent Windows ou Linux si vous voulez la lire, sinon elle reste en ping seul."),
};

/** Richesse de ce que chaque méthode recueille : SSH et agent lisent la santé complète (disques, services, mises à jour, journal), un connecteur ce que
 *  son outil fournit, le ping seulement la présence. Une machine n'est « à optimiser » que si la méthode recommandée recueille PLUS que ce qui la lit déjà. */
export const RICHNESS: Record<string, number> = { ssh: 3, agent: 3, connector: 1, ping: 0 };

/** Le réglage à ouvrir pour mettre en place la méthode recommandée (null : rien à ouvrir) */
function actionFor(a: Advice): AdviceView["action"] {
  if (a.method === "ssh") return { label: tx("Régler l'accès SSH"), setup: "ssh" };
  if (a.method === "agent") return { label: a.agent_kind === "windows" ? tx("Installer l'agent Windows") : tx("Installer l'agent Linux"), setup: "agent" };
  if (a.method === "connector") return { label: tx("Régler le connecteur"), setup: "connector" };
  return null;
}

function statusOf(a: Advice, read: boolean): AdviceStatus {
  if (read || a.method === "ping") return "ok";
  return a.current.length ? "optimize" : "todo";
}

/** Pourquoi la méthode actuelle n'est pas la meilleure ; un agent installé mais silencieux est la cause à dire en premier */
function explainFor(a: Advice, now: string, title: string, silent: boolean): string {
  if (silent) return tx("Un agent est déjà installé, mais il ne répond plus ({0}). Vérifiez que la machine est allumée et qu'elle joint MyServices ; sinon recréez l'agent.", a.agent_state ?? "");
  return tx("Aujourd'hui elle est lue par {0}. {1} donnerait plus : {2}", now, title, (BENEFIT[a.method] ?? (() => ""))(a.agent_kind));
}

function todoFor(a: Advice, silent: boolean): string | null {
  const text = silent ? tx("Si l'agent est perdu, recréez-le : un nouveau jeton remplace l'ancien.") : (TODO[a.method] ?? (() => ""))(a.agent_kind);
  return text || null;
}

export function describeAdvice(_ip: string, a: Advice, accepted = false): AdviceView {
  const best = Math.max(0, ...a.current.map((m) => RICHNESS[m] ?? 0));
  const read = a.method !== "ping" && (a.current.includes(a.method) || best >= RICHNESS[a.method]);
  const raw = statusOf(a, read);
  const kept = accepted && raw === "optimize";   // seule une machine « à optimiser » peut être gardée ainsi : une machine jamais lue reste à régler
  const action = !read && !(accepted && a.current.length > 0) ? actionFor(a) : null;
  const title = METHOD_LABEL(a.method, a.agent_kind), now = a.current.map((m) => NOW_LABEL[m]()).join(", ");
  const silent = a.method === "agent" && !!a.agent_state && a.agent_state !== "actif";   // un agent installé mais qui ne répond plus
  return {
    status: kept ? "ok" : raw, kept, title, why: (WHY[a.why] ?? (() => ""))(), read, action, now,
    explain: raw === "optimize" && !kept ? explainFor(a, now, title, silent) : null,
    todo: action && !kept ? todoFor(a, silent) : null,
    others: a.alternatives.filter((m) => m !== "ping").map((m) => ({ label: OTHER_LABEL[m](), active: a.current.includes(m) })),
  };
}

/** Machine à régler maintenant : suivie et qui répond. Une machine éteinte (même « souvent éteinte ») ne peut pas être lue : lui proposer SSH ou un agent
 *  n'aurait aucun sens, on la reprend quand elle est allumée. */
export const isActive = (m: { ping?: boolean; disabled?: boolean }): boolean => !m.disabled && !!m.ping;

/** Ordre des machines : d'abord celles à finir, puis celles à optimiser, en dernier celles qui sont en place */
export const STATUS_RANK: Record<AdviceStatus, number> = { todo: 0, optimize: 1, ok: 2 };

/** Résumé de l'étape : combien de machines sont déjà lues par la méthode recommandée */
export function summary(advice: Record<string, Advice>): { total: number; read: number } {
  const all = Object.values(advice);
  return { total: all.length, read: all.filter((a) => a.method !== "ping" && a.current.includes(a.method)).length };
}

/** Connecteurs à proposer pour une machine qu'un outil doit lire (box, passerelle…) : d'abord ceux dont le nom se retrouve dans la machine
 *  (« UniFi » dans le rôle d'une passerelle UniFi), puis les inventaires réseau (MynetworK lit la Freebox et UniFi). Quatre au plus. */
export function connectorsFor<T extends { type: string; label: string; kinds: readonly string[] }>(m: { name: string; role?: string | null; icon?: string | null }, types: T[]): T[] {
  const hay = `${m.name} ${m.role ?? ""} ${m.icon ?? ""}`.toLowerCase();
  const direct = types.filter((t) => hay.includes(t.type.toLowerCase()) || hay.includes(t.label.split(/[\s/(]/)[0].toLowerCase()));
  return [...direct, ...types.filter((t) => t.kinds.includes("network") && !direct.includes(t))].slice(0, 4);
}
