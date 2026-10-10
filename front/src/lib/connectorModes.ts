// Connecteurs qui se relient de plusieurs façons (NPM : API directe, API par SSH, script npm-api.sh) : le mode choisi décide des champs
// montrés, de ceux qui sont requis et de ce qui est envoyé. Même règle que le serveur (connectors/npm.py : mode_of).
import type { ConnectorType } from "../types";

/** Mode d'après les réglages enregistrés : script si le chemin est donné, sinon SSH si une machine l'est, sinon direct */
export function modeOf(type: ConnectorType, config: Record<string, unknown> | undefined): string {
  const modes = type.modes ?? [];
  if (!modes.length) return "";
  const has = (k: string) => !!(config && config[k]);
  const id = has("api") ? "script" : has("ssh") ? "ssh" : "direct";
  return modes.some((m) => m.id === id) ? id : modes[0].id;
}

/** Réglages à envoyer : seulement les champs du mode (les autres, d'un mode abandonné, ne doivent pas rester enregistrés) */
export function configFor(type: ConnectorType, mode: string, conf: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const def = (type.modes ?? []).find((m) => m.id === mode);
  if (!def) return conf;
  return Object.fromEntries(Object.entries(conf).filter(([k]) => def.fields.includes(k)));
}
