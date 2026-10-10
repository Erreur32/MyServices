// Commande d'installation de l'agent Windows : recalculée à chaque changement de l'adresse de MyServices (le jeton, montré une seule
// fois, reste en mémoire de la page). Même règle d'adresse que le serveur (agents.clean_url) : http(s)://hôte[:port], sans chemin.

/** Adresse nettoyée (sans « / » final) si elle est utilisable par l'agent, sinon null */
export function cleanAgentUrl(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:\d{1,5})?$/.test(url) ? url : null;
}

/** Texte à coller dans un PowerShell administrateur du PC ; null si l'adresse n'est pas valable */
export function installCommand(url: string, token: string): string | null {
  const base = cleanAgentUrl(url);
  if (!base) return null;
  return `Set-ExecutionPolicy Bypass -Scope Process -Force\n$env:MSV_URL = '${base}'\n$env:MSV_TOKEN = '${token}'\niex (iwr "$env:MSV_URL/myservices/agent/install.ps1" -UseBasicParsing).Content`;
}
