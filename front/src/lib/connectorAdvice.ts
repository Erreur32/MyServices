// What a failed connector means in plain words: a short line for the card, then what it means and what to check first for the open card.
import { tx } from "./i18n";

export interface ConnectorAdvice { short: string; meaning: string; tip: string }

const HTTP = (codes: string) => new RegExp(String.raw`(?:HTTP|error|erreur)\s*:?\s*(${codes})\b`, "i");

const denied = () => ({ short: tx("Accès refusé"), meaning: tx("Le service répond, mais refuse le compte ou le jeton."), tip: tx("Vérifiez le compte, ou refaites le jeton dans le service.") });

// The first that matches wins: a cause named by the message comes before the HTTP codes, « connection refused » before the refused account
const RULES: [RegExp, (code: string) => ConnectorAdvice][] = [
  [/ssh.*(permission denied|publickey)|permission denied \(publickey/i, () => ({ short: tx("Connexion SSH refusée"), meaning: tx("La machine refuse la clé de MyServices."), tip: tx("Autorisez la clé dans Machines, Connexions SSH.") })],
  [/certificate|certificat|\bssl\b|\btls\b/i, () => ({ short: tx("Certificat refusé"), meaning: tx("Le certificat est expiré ou auto-signé."), tip: tx("Renouvelez-le, ou désactivez la vérification si c'est voulu.") })],
  [/name or service not known|could not resolve|name resolution|nodename/i, () => ({ short: tx("Nom de machine inconnu"), meaning: tx("Le nom de l'adresse ne se traduit pas en IP."), tip: tx("Essayez avec l'IP, ou vérifiez le DNS.") })],
  [/connection refused|connexion refusée|errno 111|curl: \(7\)/i, () => ({ short: tx("Rien n'écoute sur ce port"), meaning: tx("La machine répond, mais aucun service sur ce port."), tip: tx("Vérifiez le port, ou que le service est démarré.") })],
  [/timed? ?out|délai dépassé|curl: \(28\)/i, () => ({ short: tx("Pas de réponse à temps"), meaning: tx("Machine éteinte, trop lente, ou passage bloqué."), tip: tx("Vérifiez que la machine est allumée, puis le pare-feu ou le VPN.") })],
  [HTTP("502|503|504"), (code) => ({ short: tx("Le service ne répond pas ({0})", code), meaning: tx("L'adresse répond, mais l'application derrière n'est pas prête ou s'est arrêtée."), tip: tx("Vérifiez que le service tourne, puis regardez ses journaux.") })],
  [HTTP("401|403"), denied],
  [/refus[ée]|unauthorized|forbidden/i, denied],
  [HTTP("404"), () => ({ short: tx("Adresse de l'API introuvable"), meaning: tx("Le service répond, mais pas à cet endroit."), tip: tx("Vérifiez l'adresse et la version du service.") })],
];

export function connectorAdvice(message: string): ConnectorAdvice {
  for (const [rule, advice] of RULES) {
    const hit = rule.exec(message);
    if (hit) return advice(hit[1] ?? "");
  }
  return { short: tx("Lecture impossible"), meaning: tx("Cause non reconnue : le message technique dit ce qui a été répondu."), tip: tx("Lancez un test depuis le formulaire ci-dessous.") };
}
