// Connecteurs qui se relient de plusieurs façons (NPM : API directe, API par SSH, script npm-api.sh) : le mode choisi décide des champs
// montrés, de ceux qui sont requis et de ce qui est envoyé. Même règle que le serveur (connectors/npm.py : mode_of).
import type { AgentInfo, ConnectorType, SshAlias } from "../types";

type ConnectorValue = string | number | boolean;

/** Mode d'après les réglages enregistrés : agent, puis script si le chemin est donné, puis SSH si une machine l'est, sinon direct */
export function modeOf(type: ConnectorType, config: Record<string, unknown> | undefined): string {
  const modes = type.modes ?? [];
  if (!modes.length) return "";
  const has = (k: string) => !!config?.[k];
  const id = ([["agent", "agent"], ["api", "script"], ["ssh", "ssh"]] as const).find(([key]) => has(key))?.[1] ?? "direct";
  return modes.some((m) => m.id === id) ? id : modes[0].id;
}

/** Réglages à envoyer : seulement les champs du mode (les autres, d'un mode abandonné, ne doivent pas rester enregistrés) */
export function configFor(type: ConnectorType, mode: string, conf: Record<string, ConnectorValue>): Record<string, ConnectorValue> {
  const def = (type.modes ?? []).find((m) => m.id === mode);
  if (!def) return conf;
  return Object.fromEntries(Object.entries(conf).filter(([k]) => def.fields.includes(k)));
}

/** The agent, among those in use, that already reads this NPM: on the machine named by the address, the SSH alias or the IP of the connector */
export function npmAgent(agents: AgentInfo[], conf: Record<string, ConnectorValue>, aliases: SshAlias[]): AgentInfo | undefined {
  const alias = aliases.find((a) => a.alias === conf.ssh);
  const ips = new Set([conf.ip, conf.agent, /^https?:\/\/([^:/]+)/.exec(String(conf.url ?? ""))?.[1], alias?.ip ?? alias?.host]);
  return agents.find((a) => a.options?.npm !== undefined && ips.has(a.ip));
}
