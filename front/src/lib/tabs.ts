// Onglets : ordre, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { ClipboardClock, LayoutGrid, Server, Shield, Globe, HardDrive, House, Monitor, Network, Router, Settings, Workflow, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";
import { NETWORK_CARDS, hasNetwork } from "./network";

/** Cartes de services (hors outils réseau, qui ont leur onglet) et conteneurs lus par une API : l'onglet Infra */
export const infraCards = (s: Snapshot) => (s.data.services_status ?? []).filter((c) => !NETWORK_CARDS.includes(c.connector));
export const infraDocker = (s: Snapshot) => (s.data.containers ?? []).filter((c) => !c.links_only);

// Icônes monochromes (lucide, trait fin) : couleur du texte, lisibles en clair comme en sombre
export const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "home", icon: House, label: tx("Accueil") },
  { id: "history", icon: ClipboardClock, label: tx("Historique") },
  { id: "machines", icon: Monitor, label: tx("Machines") },
  { id: "services", icon: Globe, label: tx("Services") },
  { id: "infra", icon: LayoutGrid, label: tx("Infra") },
  { id: "virtualization", icon: Server, label: tx("Virtualisation") },
  { id: "network", icon: Router, label: tx("Réseau") },
  { id: "security", icon: Shield, label: tx("Sécurité") },
  { id: "dns", icon: Network, label: tx("DNS") },
  { id: "backups", icon: HardDrive, label: tx("Sauvegardes") },
  { id: "diagrams", icon: Workflow, label: tx("Schémas") },
  { id: "settings", icon: Settings, label: tx("Réglages") },
];

/** Onglets encore en chantier : visibles seulement sur une image de dev (construite sur place, git-rev), pas publiés. */
const UNRELEASED: TabId[] = ["infra", "network", "security"];
const isDevBuild = (s: Snapshot) => !!s.me.git || s.me.version === "dev";

/** Onglet affiché seulement si sa source est activée (et Réglages pour les admins). */
export function visible(id: TabId, s: Snapshot): boolean {
  if (UNRELEASED.includes(id) && !isDevBuild(s)) return false;
  switch (id) {
    case "infra": return infraCards(s).length > 0 || infraDocker(s).length > 0;   // cartes des services lus par leur API (Dockhand, Home Assistant, Uptime Kuma…)
    case "backups": return !!s.backups;
    case "dns": return !!s.data.dns;
    case "virtualization": return (s.data.virtualization ?? []).length > 0; // a hypervisor (Proxmox, ESXi, vCenter) or a Proxmox Backup Server ; Dockhand is in Infra
    case "network": return hasNetwork(s);   // MynetworK, UniFi, Freebox, OPNsense, NetAlertX… answer, or devices were found
    case "security": return (s.data.security ?? []).length > 0 || s.data.hosts.some((r) => r.type === "proxy") || s.data.machine_list.some((m) => !!m.info?.sshd);
    case "settings": return s.me.role === "admin";
    default: return true;
  }
}

