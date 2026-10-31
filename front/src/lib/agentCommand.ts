// Commande d'installation de l'agent (Windows ou Linux) : recalculée à chaque changement de l'adresse de MyServices (le jeton, montré une seule
// fois, reste en mémoire de la page). Même règle d'adresse que le serveur (agents.clean_url) : http(s)://hôte[:port], sans chemin.

/** Adresse nettoyée (sans « / » final) si elle est utilisable par l'agent, sinon null */
export function cleanAgentUrl(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:\d{1,5})?$/.test(url) ? url : null;
}

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VPN_IP = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;   // the addresses Tailscale gives (100.64.0.0/10)

/** Machine hors du réseau local : une adresse IPv4 publique */
export const isPublicIp = (ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !PRIVATE_IP.test(ip) && !VPN_IP.test(ip);

/** Ce qui ne va pas dans cette adresse pour un agent hors du réseau : « private » il ne la joindra pas, « clear » son jeton passerait en clair sur internet */
export function outsideProblem(url: string): "private" | "clear" | null {
  const base = cleanAgentUrl(url);
  if (!base) return null;
  const host = new URL(base).hostname;
  if (VPN_IP.test(host) || host.endsWith(".ts.net")) return null;
  if (PRIVATE_IP.test(host) || !host.includes(".") || /\.(lan|local|home|internal)$/i.test(host)) return "private";
  return base.startsWith("http:") ? "clear" : null;
}

/** Texte à coller dans un PowerShell administrateur (Windows) ou un terminal (Linux, sudo) ; null si l'adresse n'est pas valable.
 *  `sudo` (Linux) : l'installation pose les règles sudo exactes des trois lectures qui demandent root (MSV_SUDO, agent/install.sh) */
export function installCommand(url: string, token: string, kind: "windows" | "linux" = "windows", sudo = false): string | null {
  const base = cleanAgentUrl(url);
  if (!base) return null;
  if (kind === "linux") return `export MSV_URL='${base}'\nexport MSV_TOKEN='${token}'\ncurl -fsSL "$MSV_URL/agent/install.sh" | sudo env ${sudo ? "MSV_SUDO=1 " : ""}MSV_URL="$MSV_URL" MSV_TOKEN="$MSV_TOKEN" bash`;
  return `Set-ExecutionPolicy Bypass -Scope Process -Force\n$env:MSV_URL = '${base}'\n$env:MSV_TOKEN = '${token}'\niex (iwr "$env:MSV_URL/agent/install.ps1" -UseBasicParsing).Content`;
}
