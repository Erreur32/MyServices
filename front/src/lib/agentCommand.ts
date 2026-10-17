// Commande d'installation de l'agent (Windows ou Linux) : recalculée à chaque changement de l'adresse de MyServices (le jeton, montré une seule
// fois, reste en mémoire de la page). Même règle d'adresse que le serveur (agents.clean_url) : http(s)://hôte[:port], sans chemin.

/** Adresse nettoyée (sans « / » final) si elle est utilisable par l'agent, sinon null */
export function cleanAgentUrl(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:\d{1,5})?$/.test(url) ? url : null;
}

/** Texte à coller dans un PowerShell administrateur (Windows) ou un terminal (Linux, sudo) ; null si l'adresse n'est pas valable */
export function installCommand(url: string, token: string, kind: "windows" | "linux" = "windows"): string | null {
  const base = cleanAgentUrl(url);
  if (!base) return null;
  if (kind === "linux") return `export MSV_URL='${base}'\nexport MSV_TOKEN='${token}'\ncurl -fsSL "$MSV_URL/agent/install.sh" | sudo env MSV_URL="$MSV_URL" MSV_TOKEN="$MSV_TOKEN" bash`;
  return `Set-ExecutionPolicy Bypass -Scope Process -Force\n$env:MSV_URL = '${base}'\n$env:MSV_TOKEN = '${token}'\niex (iwr "$env:MSV_URL/agent/install.ps1" -UseBasicParsing).Content`;
}
