// D'où vient un événement de l'historique : la méthode de détection (ping, SSH, santé, connecteur…) et ce qui l'a lu (NPM, Docker, agent, un connecteur…).
import { tx } from "./i18n";

export interface Origin { method: string; via: string[] }

const CONNECTOR: Record<string, string> = {
  npm: "NPM", adguard: "AdGuard Home", beszel: "Beszel", "uptime-kuma": "Uptime Kuma", dozzle: "Dozzle", "web-check": "Web-Check", docker: "Docker (SSH)",
  process: "Ports (SSH)", "home-assistant": "Home Assistant", mynetwork: "MynetworK", logviewr: "LogviewR", dockhand: "Dockhand", proxmox: "Proxmox VE",
  "proxmox-backup": "Proxmox Backup", veeam: "Veeam", discord: "Discord", telegram: "Telegram",
};
const SOURCE: Record<string, string> = { ssh: "SSH", agent: tx("agent MyServices"), beszel: "Beszel" };

/** Ce qui a lu un service « local » (port en écoute sur une machine) : selon la façon dont la ligne est lue aujourd'hui.
 *  `kind` : type de service de la ligne (docker, process, apache…), `agent` : la machine envoie ses relevés par agent. Ligne disparue
 *  (inconnue) : on ne devine pas, « Collecte ». */
export function localVia(kind?: string, agent = false): string[] {
  if (kind === "docker") return ["Docker"];
  if (kind === "process") return [agent ? tx("agent MyServices") : tx("Ports (SSH)")];
  if (kind === "apache") return ["Apache"];
  if (kind === "manuel") return [tx("Saisi à la main")];
  if (kind === "web") return [tx("Page web")];
  return [tx("Collecte")];
}

/** `healthSources` : sources qui lisent la santé de la machine concernée (SSH, agent, Beszel), si on les connaît.
 *  `local` : ce qui lit la ligne pour un événement de service local (voir localVia). */
export function originOf(e: { kind: string; key: string }, healthSources: string[] = [], local?: string[]): Origin {
  const k = e.kind;
  if (k === "hors_ligne" || k === "en_ligne") return { method: tx("Ping"), via: [tx("Collecte")] };
  if (k === "ssh_down" || k === "ssh_ok") return { method: "SSH", via: [tx("Collecte")] };
  if (k.startsWith("health_")) return { method: tx("Santé"), via: healthSources.map((s) => SOURCE[s] ?? s) };
  if (k.startsWith("connecteur")) {
    const type = e.key.replace(/^connecteur:/, "").split("/")[0];
    return { method: tx("Connecteur"), via: [CONNECTOR[type] ?? type] };
  }
  if (k === "dns") return { method: "DNS", via: ["AdGuard Home"] };
  if (k === "perime") return { method: tx("Données"), via: [tx("Collecte")] };
  const isLocal = e.key.startsWith("local:");
  const via = isLocal ? (local ?? [tx("Collecte")]) : ["NPM"];
  if (k === "unhealthy") return { method: tx("Healthcheck"), via: ["Docker"] };
  if (k === "nouveau" || k === "disparu") return { method: tx("Inventaire"), via };
  if (k === "securite") return { method: tx("Sécurité"), via: ["NPM"] };
  return { method: k === "ui_hors" ? tx("Interface web") : tx("Sonde HTTP"), via };
}
