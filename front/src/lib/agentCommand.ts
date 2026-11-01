// Commande d'installation de l'agent (Windows ou Linux) : recalculée à chaque changement de l'adresse de MyServices (le jeton, montré une seule
// fois, reste en mémoire de la page). Même règle d'adresse que le serveur (agents.clean_url) : http(s)://hôte[:port], sans chemin.
import { tx } from "./i18n";

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

/** Options of a Linux agent, the variables of agent/install.sh. `npm`: absent = not read, empty = have the script installed, else its path */
export interface AgentOptions { sudo?: boolean; dns?: boolean; backups?: boolean; backupDirs?: string; borgmatic?: boolean; allowHttp?: boolean; npm?: string; npmUrl?: string }

const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;   // what the installer accepts; nothing else goes in a command to paste
const NPM_URL = /^http:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** The folders typed that the installer accepts */
export const backupDirs = (raw: string) => raw.split(/[\s,]+/).filter((d) => SAFE_PATH.test(d));

/** What is typed for NPM cannot go in the command */
export function npmProblem({ npm, npmUrl }: AgentOptions): boolean {
  if (npm === undefined) return false;
  const path = npm.trim(), address = (npmUrl ?? "").trim();
  return path ? !SAFE_PATH.test(path) : address !== "" && !NPM_URL.test(address);
}

/** What an agent's install reads, in words: empty until the agent sends it (version 8) */
export function agentReads(o: AgentOptions = {}): string[] {
  const backups = o.backupDirs ? `${tx("sauvegardes")} ${o.backupDirs}` : tx("sauvegardes");
  const npm = o.npm ? `NPM ${o.npm}` : tx("NPM posé par l'installation");
  return [o.sudo && "sudo", o.dns && tx("DNS local"), o.backups && backups, o.borgmatic && "borgmatic", o.npm !== undefined && npm].filter((x): x is string => !!x);
}

function linuxEnv(o: AgentOptions, http: boolean): string {
  const dirs = o.backups ? backupDirs(o.backupDirs ?? "") : [], path = o.npm?.trim(), address = (o.npmUrl ?? "").trim();
  const env = [http && "MSV_ALLOW_HTTP=1", o.sudo && "MSV_SUDO=1", o.dns && "MSV_DNS=1", o.backups && "MSV_BACKUPS=1", dirs.length > 0 && `MSV_BACKUP_DIRS=${dirs.join(",")}`, o.borgmatic && "MSV_BORGMATIC=1"];
  if (o.npm !== undefined && !npmProblem(o)) env.push(`MSV_NPM=${path || "install"}`, !path && address !== "" && `MSV_NPM_URL=${address}`);
  return env.filter(Boolean).map((v) => `${v} `).join("");
}

/** Texte à coller dans un PowerShell administrateur (Windows) ou un terminal (Linux, sudo) ; null si l'adresse n'est pas valable */
export function installCommand(url: string, token: string, kind: "windows" | "linux" = "windows", options: AgentOptions = {}): string | null {
  const base = cleanAgentUrl(url);
  if (!base) return null;
  const http = !!options.allowHttp && outsideProblem(base) === "clear";   // only for the plain-http address the installer would refuse
  if (kind === "linux") return `export MSV_URL='${base}'\nexport MSV_TOKEN='${token}'\ncurl -fsSL "$MSV_URL/agent/install.sh" | sudo env ${linuxEnv(options, http)}MSV_URL="$MSV_URL" MSV_TOKEN="$MSV_TOKEN" bash`;
  return `Set-ExecutionPolicy Bypass -Scope Process -Force\n${http ? "$env:MSV_ALLOW_HTTP = '1'\n" : ""}$env:MSV_URL = '${base}'\n$env:MSV_TOKEN = '${token}'\niex (iwr "$env:MSV_URL/agent/install.ps1" -UseBasicParsing).Content`;
}
