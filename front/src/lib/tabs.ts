// Onglets : ordre, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { Ban, ClipboardClock, Globe, HardDrive, House, Monitor, Network, Settings, Stethoscope, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";

// Icônes monochromes (lucide, trait fin) : couleur du texte, lisibles en clair comme en sombre
export const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "home", icon: House, label: tx("Accueil") },
  { id: "history", icon: ClipboardClock, label: tx("Historique") },
  { id: "machines", icon: Monitor, label: tx("Machines") },
  { id: "services", icon: Globe, label: tx("Services") },
  { id: "health", icon: Stethoscope, label: tx("Santé") },
  { id: "fail2ban", icon: Ban, label: tx("Fail2ban") },
  { id: "dns", icon: Network, label: tx("DNS") },
  { id: "backups", icon: HardDrive, label: tx("Sauvegardes") },
  { id: "settings", icon: Settings, label: tx("Réglages") },
];

/** Onglet affiché seulement si sa source est activée (et Réglages pour les admins). */
export function visible(id: TabId, s: Snapshot): boolean {
  switch (id) {
    case "health": return !!s.health; // activée et déjà relevée
    case "backups": return !!s.backups;
    case "dns": return !!s.data.dns;
    case "fail2ban": return false; // source activable quand le connecteur LogviewR existera (Réglages → Sources)
    case "settings": return s.me.role === "admin";
    default: return true;
  }
}

