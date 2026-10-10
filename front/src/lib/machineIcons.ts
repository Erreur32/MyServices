// Icônes qu'on peut attribuer à une machine (Réglages → Machines → Identité). Clé enregistrée dans services-meta.json (« icon ») ;
// sans clé, l'icône reste automatique (appli reconnue, sinon système). Trois familles : applis (images de public/icons), systèmes,
// et quelques objets courants.
import { Apple, Bot, Camera, Cpu, Gamepad2, HardDrive, Home, Laptop, Monitor, Printer, Router, Server, Smartphone, Terminal, Tv, type LucideIcon } from "lucide-react";
import { tx } from "./i18n";

export type ChosenIcon = { key: string; label: string; family: "app" | "system" | "object" } & ({ file: string } | { Icon: LucideIcon });

const app = (key: string, label: string): ChosenIcon => ({ key, label, family: "app", file: key });

export const MACHINE_ICONS: ChosenIcon[] = [
  app("home-assistant", "Home Assistant"), app("proxmox", "Proxmox"), app("plex", "Plex"), app("docker", "Docker"),
  app("nginx-proxy-manager", "Nginx Proxy Manager"), app("adguard-home", "AdGuard Home"), app("beszel", "Beszel"), app("uptime-kuma", "Uptime Kuma"),
  app("dozzle", "Dozzle"), app("nginx", "nginx"), app("apache", "Apache"), app("syncthing", "Syncthing"), app("grafana", "Grafana"), app("unifi", "UniFi"),
  { key: "linux", label: "Linux", family: "system", Icon: Terminal }, { key: "windows", label: "Windows", family: "system", Icon: Monitor },
  { key: "macos", label: "macOS", family: "system", Icon: Apple }, { key: "ios", label: "iOS / Android", family: "system", Icon: Smartphone },
  { key: "network", label: tx("Matériel réseau"), family: "system", Icon: Router }, { key: "pi", label: "Raspberry Pi", family: "system", Icon: Cpu },
  { key: "server", label: tx("Serveur"), family: "object", Icon: Server }, { key: "nas", label: "NAS", family: "object", Icon: HardDrive },
  { key: "laptop", label: tx("Portable"), family: "object", Icon: Laptop }, { key: "tv", label: tx("Télévision"), family: "object", Icon: Tv },
  { key: "camera", label: tx("Caméra"), family: "object", Icon: Camera }, { key: "game", label: tx("Console de jeu"), family: "object", Icon: Gamepad2 },
  { key: "printer", label: tx("Imprimante"), family: "object", Icon: Printer }, { key: "home", label: tx("Domotique"), family: "object", Icon: Home },
  { key: "ai", label: tx("IA / LLM"), family: "object", Icon: Bot },
];

/** Icône choisie pour cette clé ; undefined si la clé est vide ou inconnue (retour à l'automatique) */
export const chosenIcon = (key?: string | null): ChosenIcon | undefined => (key ? MACHINE_ICONS.find((i) => i.key === key) : undefined);
