// Onglets : ordre, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { ClipboardClock, Server, Shield, Globe, HardDrive, House, Monitor, Network, Router, Settings, Stethoscope, Workflow, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";
import { hasNetwork } from "./network";

// Icônes monochromes (lucide, trait fin) : couleur du texte, lisibles en clair comme en sombre
export const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "home", icon: House, label: tx("Accueil") },
  { id: "history", icon: ClipboardClock, label: tx("Historique") },
  { id: "machines", icon: Monitor, label: tx("Machines") },
  { id: "services", icon: Globe, label: tx("Services") },
  { id: "health", icon: Stethoscope, label: tx("Santé") },
  { id: "virtualization", icon: Server, label: tx("Virtualisation") },
  { id: "network", icon: Router, label: tx("Réseau") },
  { id: "security", icon: Shield, label: tx("Sécurité") },
  { id: "dns", icon: Network, label: tx("DNS") },
  { id: "backups", icon: HardDrive, label: tx("Sauvegardes") },
  { id: "diagrams", icon: Workflow, label: tx("Schémas") },
  { id: "settings", icon: Settings, label: tx("Réglages") },
];

/** Onglet affiché seulement si sa source est activée (et Réglages pour les admins). */
export function visible(id: TabId, s: Snapshot): boolean {
  switch (id) {
    case "health": return !!s.health; // activée et déjà relevée
    case "backups": return !!s.backups;
    case "dns": return !!s.data.dns;
    case "virtualization": return (s.data.virtualization ?? []).length > 0; // a hypervisor (Proxmox, ESXi, vCenter) or a Proxmox Backup Server ; Dockhand stays in Health
    case "network": return hasNetwork(s);   // MynetworK, UniFi, Freebox, OPNsense, NetAlertX… answer, or devices were found
    case "security": return (s.data.security ?? []).length > 0 || s.data.hosts.some((r) => r.type === "proxy") || s.data.machine_list.some((m) => !!m.info?.sshd);
    case "settings": return s.me.role === "admin";
    default: return true;
  }
}

