// Onglets : ordre, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { LayoutGrid, Server, Shield, Globe, HardDrive, House, Monitor, Network, Router, Workflow, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";
import { NETWORK_CARDS, hasNetwork } from "./network";

/** Cartes de services (hors outils réseau, qui ont leur onglet) et conteneurs lus par une API : l'onglet Infra */
export const infraCards = (s: Snapshot) => (s.data.services_status ?? []).filter((c) => !NETWORK_CARDS.includes(c.connector));
export const infraDocker = (s: Snapshot) => (s.data.containers ?? []).filter((c) => !c.links_only);

// Icônes monochromes (lucide, trait fin) : couleur du texte, lisibles en clair comme en sombre
// Six onglets « Surveiller » dans la barre ; Infra, Virtualisation, DNS et Schémas sont dans le menu « Inventaire » (ci-dessous) ; Réglages est ouvert par l'engrenage de l'en-tête.
export const TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "home", icon: House, label: tx("Accueil") },
  { id: "machines", icon: Monitor, label: tx("Machines") },
  { id: "services", icon: Globe, label: tx("Services") },
  { id: "network", icon: Router, label: tx("Réseau") },
  { id: "backups", icon: HardDrive, label: tx("Sauvegardes") },
  { id: "security", icon: Shield, label: tx("Sécurité") },
];

/** Menu « Inventaire ▾ » : listes complètes, moins consultées au quotidien que les six onglets ci-dessus */
export const INVENTORY: { id: TabId; icon: LucideIcon; label: string; hint: string }[] = [
  { id: "infra", icon: LayoutGrid, label: tx("Infra"), hint: tx("cartes des services et conteneurs") },
  { id: "virtualization", icon: Server, label: tx("Virtualisation"), hint: tx("Proxmox, ESXi, PBS") },
  { id: "dns", icon: Network, label: tx("DNS"), hint: tx("résolution des noms, AdGuard") },
  { id: "diagrams", icon: Workflow, label: tx("Schémas"), hint: "" },
];

/** Tout identifiant d'onglet reconnu par l'adresse : la barre, l'Inventaire, et Réglages (ouvert par l'engrenage, pas par la barre) */
export const TAB_IDS: TabId[] = [...TABS.map((t) => t.id), ...INVENTORY.map((t) => t.id), "settings"];

/** Onglets encore en chantier : visibles seulement sur une image de dev (construite sur place, git-rev), pas publiés. */
export const UNRELEASED: TabId[] = ["infra"];
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

const OLD_TABS: Record<string, string> = { fail2ban: "security", health: "machines", history: "home", stats: "home" };   // removed tabs, now inside another one (#history, #stats: sub-tabs of the home page)

/** Onglet visé par l'adresse actuelle (#dns, #settings/api…) ; « home » si l'adresse n'en désigne aucun (y compris les pages à part : #profile, #audit…) */
export function tabFromHash(): TabId {
  const raw = location.hash.slice(1).split("/")[0];
  const h = (OLD_TABS[raw] ?? raw) as TabId;
  return TAB_IDS.includes(h) ? h : "home";
}
