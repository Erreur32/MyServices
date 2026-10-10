// État d'accès d'une machine (ping, SSH) : badge et ordre (hors composants, voir lib/forms.ts).
import type { Tone } from "./level";
import type { Machine } from "../types";
import { tx } from "./i18n";

export type MState = "ssh" | "manual" | "refused" | "nossh" | "off" | "down";
export const MSTATE: Record<MState, [Tone, string, string]> = {
  ssh: ["ok", tx("SSH OK"), tx("Connexion SSH par clé réussie depuis le collecteur")],
  manual: ["info", tx("SSH manuel"), tx("Accès déclaré sans clé (mot de passe) : non testé automatiquement")],
  refused: ["warn", tx("SSH refusé"), tx("Accès SSH configuré, mais la connexion par clé échoue")],
  nossh: ["off", tx("en ligne, sans SSH"), tx("Répond au ping, aucun accès SSH configuré")],
  off: ["off", tx("éteinte (voulu)"), tx("Éteinte volontairement, aucune alerte")],
  down: ["bad", tx("injoignable"), tx("Ne répond ni au ping ni en SSH")],
};
export const ORDER: MState[] = ["ssh", "manual", "refused", "nossh", "off", "down"];

/** Une session SSH réussie prime sur le ping (certains pare-feu bloquent l'ICMP). */
export function mState(m: Machine): MState {
  if (m.info) return "ssh";
  if (m.off && !m.ping) return "off";
  if (m.ssh && !m.ssh.identity) return "manual";
  if (m.ssh) return "refused";
  return m.ping ? "nossh" : "down";
}

