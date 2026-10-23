// Menu de gauche : groupes, entrées, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { Ban, Bell, Globe, HardDrive, History, House, LayoutGrid, Monitor, Network, Plug, Router, Server, Shield, SlidersHorizontal, Workflow, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";
import { NETWORK_CARDS, hasNetwork } from "./network";

/** Cartes de services (hors outils réseau, qui ont leur onglet) et conteneurs lus par une API : l'onglet Infra */
export const infraCards = (s: Snapshot) => (s.data.services_status ?? []).filter((c) => !NETWORK_CARDS.includes(c.connector));
export const infraDocker = (s: Snapshot) => (s.data.containers ?? []).filter((c) => !c.links_only);

// Icônes monochromes (lucide, trait fin) : couleur du texte, lisibles en clair comme en sombre

/** One entry of the side menu: the address it opens (without « # »), the tab it belongs to (visibility, alert dot), an entry
 *  drawn indented under the one above it (`child`), and an extra condition (`show`) for an entry that only exists when a tool was found. */
export interface NavItem { id: string; hash: string; tab: TabId; icon: LucideIcon; label: string; child?: boolean; show?: (s: Snapshot) => boolean }
export interface NavGroup { id: string; label: string; items: NavItem[] }

/** The side menu, in four groups; an entry whose source is missing is left out, and so is a group left empty */
export const NAV: NavGroup[] = [
  { id: "overview", label: tx("Vue d'ensemble"), items: [
    { id: "home", hash: "", tab: "home", icon: House, label: tx("Accueil") },
    { id: "history", hash: "history", tab: "home", icon: History, label: tx("Historique") },
  ] },
  { id: "inventory", label: tx("Inventaire"), items: [
    { id: "machines", hash: "machines", tab: "machines", icon: Monitor, label: tx("Machines") },
    { id: "services", hash: "services", tab: "services", icon: Globe, label: tx("Services") },
    { id: "network", hash: "network", tab: "network", icon: Router, label: tx("Réseau") },
    { id: "dns", hash: "dns", tab: "dns", icon: Network, label: tx("DNS") },
    { id: "virtualization", hash: "virtualization", tab: "virtualization", icon: Server, label: tx("Virtualisation") },
    { id: "infra", hash: "infra", tab: "infra", icon: LayoutGrid, label: tx("Infra") },
    { id: "diagrams", hash: "diagrams", tab: "diagrams", icon: Workflow, label: tx("Schémas") },
  ] },
  { id: "protection", label: tx("Protection"), items: [
    { id: "backups", hash: "backups", tab: "backups", icon: HardDrive, label: tx("Sauvegardes") },
    { id: "security", hash: "security", tab: "security", icon: Shield, label: tx("Sécurité") },
    { id: "fail2ban", hash: "security/fail2ban", tab: "security", icon: Ban, label: tx("Fail2ban"), child: true, show: (s) => (s.data.security ?? []).length > 0 },   // a Fail2ban read (LogviewR)
    { id: "alerts", hash: "settings/alerts", tab: "settings", icon: Bell, label: tx("Alertes") },
  ] },
  { id: "admin", label: tx("Administration"), items: [
    { id: "connectors", hash: "settings/connectors", tab: "settings", icon: Plug, label: tx("Connecteurs") },
    { id: "settings", hash: "settings", tab: "settings", icon: SlidersHorizontal, label: tx("Réglages") },
  ] },
];

/** Tout identifiant d'onglet reconnu par l'adresse */
export const TAB_IDS: TabId[] = [...new Set(NAV.flatMap((g) => g.items.map((i) => i.tab)))];

/** Onglets encore en chantier : visibles seulement sur une image de dev (construite sur place, git-rev), pas publiés. */
export const UNRELEASED: TabId[] = ["infra"];
export const isDevBuild = (s: Snapshot) => !!s.me.git || s.me.version === "dev";

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

/** The menu as this account sees it: entries without a source (or without their tool) left out, then empty groups */
export function navGroups(s: Snapshot): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => visible(i.tab, s) && (!i.show || i.show(s))) })).filter((g) => g.items.length > 0);
}

const HOME_HASHES = new Set(["", "home", "stats"]);   // the home page and its statistics

/** Menu entry of an address: the longest entry address it starts with (#settings/alerts/rules -> Alertes, #machines/10.0.0.5 -> Machines);
 *  the home page for #, #home and #stats; none ("") for a page apart (#profile, #help…) */
export function activeNav(hash: string, groups: NavGroup[]): string {
  const h = hash.replace(/^#/, "");
  if (HOME_HASHES.has(h)) return "home";
  let best: NavItem | undefined;
  for (const i of groups.flatMap((g) => g.items))
    if (i.hash && (h === i.hash || h.startsWith(`${i.hash}/`)) && (!best || i.hash.length > best.hash.length)) best = i;
  return best?.id ?? "";
}

/** Onglet visé par l'adresse actuelle (#dns, #settings/api…) ; « home » si l'adresse n'en désigne aucun (y compris les pages à part : #profile, #help…) */
export function tabFromHash(): TabId {
  const raw = location.hash.slice(1).split("/")[0];
  const h = (OLD_TABS[raw] ?? raw) as TabId;
  return TAB_IDS.includes(h) ? h : "home";
}
