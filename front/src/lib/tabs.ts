// Menu de gauche : groupes, entrées, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { Activity, Archive, ListChecks, Radio, Sparkles, ArrowDownUp, Boxes, EyeOff, Lightbulb, Copy, FolderSearch, Cpu, Ban, Bell, Eye, FileBadge, FileText, Globe, HardDrive, History, House, Info, KeyRound, Layers, LayoutDashboard, LayoutGrid, List, Mail, Monitor, Network, PenLine, Plug, Plus, Radar, RefreshCw, Router, ScanSearch, ScrollText, Send, Server, Settings, Shield, SlidersHorizontal, Stethoscope, Timer, Users, Webhook, Workflow, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";
import { NETWORK_CARDS, hasNetwork } from "./network";

/** Cartes de services (hors outils réseau, qui ont leur onglet) et conteneurs lus par une API : l'onglet Infra */
export const infraCards = (s: Snapshot) => (s.data.services_status ?? []).filter((c) => !NETWORK_CARDS.includes(c.connector));
export const infraDocker = (s: Snapshot) => (s.data.containers ?? []).filter((c) => !c.links_only);

// Icônes monochromes (lucide, trait fin) : couleur du texte, lisibles en clair comme en sombre

/** One entry of the side menu: the address it opens (without « # »), the tab it belongs to (visibility, alert dot), an extra
 *  condition (`show`) for an entry that only exists when a tool was found, and its sub-pages (`subs`), listed under it while it is open. */
export interface NavItem { id: string; hash: string; tab: TabId; icon: LucideIcon; label: string; show?: (s: Snapshot) => boolean; subs?: NavItem[]; also?: string[] }   // also: other addresses it lights (the page of one item)
export interface NavGroup { id: string; label: string; items: NavItem[] }

const sub = (id: string, hash: string, tab: TabId, icon: LucideIcon, label: string, show?: (s: Snapshot) => boolean): NavItem => ({ id, hash, tab, icon, label, show });
/** A sub-page made of pages (« Vue », « Réglages »): no page of its own, it opens its first one */
const group = (id: string, tab: TabId, icon: LucideIcon, label: string, subs: NavItem[]): NavItem => ({ id, hash: subs[0].hash, tab, icon, label, subs });
const views = (id: string, tab: TabId, subs: NavItem[]): NavItem => group(id, tab, Eye, tx("Vue"), subs);
const unifiShown = (s: Snapshot) => (s.data.services_status ?? []).some((c) => c.connector === "unifi") || (s.data.network ?? []).some((c) => !!c.unifi);
const freeboxShown = (s: Snapshot) => (s.data.services_status ?? []).some((c) => c.connector === "freebox");
const scanShown = (s: Snapshot) => (s.data.network ?? []).some((c) => c.connector === "mynetwork");
const WATCH = tx("À surveiller");

/** The side menu, in four groups; an entry whose source is missing is left out, and so is a group left empty. The pages of
 *  Settings (#settings/<section>[/<part>]) are spread over the topic they set and the Administration group. */
export const NAV: NavGroup[] = [
  { id: "overview", label: tx("Vue d'ensemble"), items: [
    { id: "home", hash: "", tab: "home", icon: House, label: tx("Accueil") },
    { id: "history", hash: "history", tab: "home", icon: History, label: tx("Historique") },
  ] },
  { id: "inventory", label: tx("Inventaire"), items: [
    { id: "machines", hash: "machines", tab: "machines", icon: Monitor, label: tx("Machines"), subs: [
      sub("machines-list", "machines", "machines", List, tx("Toutes les machines")),
      sub("machines-add", "settings/machines", "settings", Plus, tx("Ajouter et détecter")),
      sub("machines-devices", "settings/machines/devices", "settings", Radar, tx("Appareils non suivis")),
      sub("machines-agents", "settings/machines/agents", "settings", Cpu, tx("Agents")),
    ] },
    { id: "services", hash: "services", tab: "services", icon: Globe, label: tx("Services"), subs: [
      sub("services-watch", "services/watch", "services", Eye, WATCH),
      { ...sub("services-all", "services/all", "services", Layers, tx("Tous les services")), also: ["services/item", "services/edit", "services/manual"] },
      sub("services-new", "services/new", "settings", PenLine, tx("Déclarer un service")),
    ] },
    { id: "network", hash: "network", tab: "network", icon: Router, label: tx("Réseau"), subs: [
      views("network-view", "network", [
        sub("network-watch", "network/watch", "network", Eye, WATCH),
        sub("network-unifi", "network/unifi", "network", LayoutDashboard, tx("UniFi"), unifiShown),
        sub("network-freebox", "network/freebox", "network", House, tx("Freebox"), freeboxShown),
        sub("network-scan", "network/scan", "network", Radar, tx("Scan"), scanShown),
        sub("network-list", "network/list", "network", List, tx("Équipements et appareils")),
        sub("network-diagnostic", "network/diagnostic", "network", Stethoscope, tx("Diagnostic")),
      ]),
      group("network-discovery", "settings", ScanSearch, tx("Découverte"), [
        sub("discovery-mode", "settings/network", "settings", SlidersHorizontal, tx("Mode et à faire")),
        sub("discovery-hosts", "settings/network/hosts", "settings", Radar, tx("Machines sur le réseau")),
        sub("discovery-apps", "settings/network/services", "settings", Boxes, tx("Applis à activer")),
        sub("discovery-suggestions", "settings/network/suggestions", "settings", Lightbulb, tx("Autres suggestions")),
        sub("discovery-forgotten", "settings/network/forgotten", "settings", EyeOff, tx("Arrêtés et oubliés")),
      ]),
    ] },
    { id: "dns", hash: "dns", tab: "dns", icon: Network, label: tx("DNS") },
    { id: "virtualization", hash: "virtualization", tab: "virtualization", icon: Server, label: tx("Virtualisation") },
    { id: "infra", hash: "infra", tab: "infra", icon: LayoutGrid, label: tx("Infra") },
    { id: "diagrams", hash: "diagrams", tab: "diagrams", icon: Workflow, label: tx("Schémas") },
  ] },
  { id: "protection", label: tx("Protection"), items: [
    { id: "backups", hash: "backups", tab: "backups", icon: HardDrive, label: tx("Sauvegardes"), subs: [
      views("backups-view", "backups", [
        sub("backups-watch", "backups/watch", "backups", Eye, WATCH),
        sub("backups-all", "backups/all", "backups", Layers, tx("Tous les jeux")),
        sub("backups-machines", "backups/machines", "backups", Monitor, tx("Par machine")),
      ]),
      group("backups-settings", "settings", Settings, tx("Réglages"), [
        sub("backups-sets", "settings/backups", "settings", HardDrive, tx("Jeux suivis")),
        sub("backups-add", "settings/backups/add", "settings", Plus, tx("Ajouter des sauvegardes")),
        sub("backups-copies", "settings/backups/copies", "settings", Copy, tx("Copies ailleurs")),
        sub("backups-paths", "settings/backups/paths", "settings", FolderSearch, tx("Emplacements cherchés")),
        sub("backups-archived", "settings/backups/archived", "settings", Archive, tx("Jeux archivés")),
      ]),
    ] },
    { id: "security", hash: "security", tab: "security", icon: Shield, label: tx("Sécurité"), subs: [
      sub("security-watch", "security/watch", "security", Eye, WATCH),
      sub("security-sites", "security/sites", "security", Globe, tx("Sites exposés")),
      sub("security-access", "security/access", "security", KeyRound, tx("Accès SSH")),
      sub("security-ports", "security/network", "security", Radar, tx("Ports du réseau")),
      sub("security-certs", "security/certs", "security", FileBadge, tx("Certificats")),
      sub("fail2ban", "security/fail2ban", "security", Ban, tx("Fail2ban"), (s) => (s.data.security ?? []).length > 0),   // a Fail2ban read (LogviewR)
    ] },
    { id: "alerts", hash: "settings/alerts/channels", tab: "settings", icon: Bell, label: tx("Alertes"), subs: [
      sub("alerts-channels", "settings/alerts/channels", "settings", Radio, tx("Canaux")),
      sub("alerts-rules", "settings/alerts/rules", "settings", ListChecks, tx("Règles d'alerte")),
      sub("alerts-notifications", "settings/alerts/notifications", "settings", Send, tx("Mes notifications")),
      sub("alerts-examples", "settings/alerts/examples", "settings", Sparkles, tx("Exemples")),
      sub("alerts-sent", "settings/alerts/sent", "settings", History, tx("Derniers envois")),
    ] },
  ] },
  { id: "admin", label: tx("Administration"), items: [
    { id: "connectors", hash: "settings/connectors", tab: "settings", icon: Plug, label: tx("Connecteurs"), subs: [
      sub("connectors-mine", "settings/connectors", "settings", Plug, tx("Mes connecteurs")),
      sub("connectors-available", "settings/connectors/available", "settings", Plus, tx("Disponibles")),
      sub("connectors-detected", "settings/connectors/detected", "settings", Radar, tx("Détectés à relier")),
    ] },
    { id: "access", hash: "settings/accounts", tab: "settings", icon: Users, label: tx("Comptes et accès"), subs: [
      sub("accounts", "settings/accounts", "settings", Users, tx("Comptes et sessions")),
      sub("api", "settings/api", "settings", Webhook, tx("Jetons API et MCP")),
      sub("ssh", "settings/ssh", "settings", KeyRound, tx("Clé SSH de l'app")),
    ] },
    { id: "app", hash: "settings/tasks", tab: "settings", icon: SlidersHorizontal, label: tx("Application"), subs: [
      sub("tasks", "settings/tasks", "settings", Timer, tx("Tâches et horaires")),
      sub("updates", "settings/updates", "settings", RefreshCw, tx("Mises à jour")),
      sub("mail", "settings/mail", "settings", Mail, tx("E-mail")),
      sub("export", "settings/export", "settings", ArrowDownUp, tx("Export et import")),
      sub("requests", "settings/requests", "settings", Activity, tx("Requêtes")),
      sub("audit", "settings/requests/audit", "settings", ScrollText, tx("Journal d'audit")),
      sub("logs", "settings/requests/logs", "settings", FileText, tx("Journaux")),
      sub("about", "about", "settings", Info, tx("Informations")),
    ] },
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

const shown = (i: NavItem, s: Snapshot, hide: ReadonlySet<string>) => visible(i.tab, s) && (!i.show || i.show(s)) && !hide.has(i.id);

/** An entry as this account sees it: its sub-pages left to show; none left, the entry goes; a single one, it takes its place
 *  (and brings its own sub-pages up) */
function seen(i: NavItem, s: Snapshot, hide: ReadonlySet<string>): NavItem | null {
  if (!i.subs) return shown(i, s, hide) ? i : null;
  const subs = i.subs.map((x) => seen(x, s, hide)).filter((x): x is NavItem => x !== null);
  if (subs.length === 0) return null;
  if (subs.length === 1) return { ...i, hash: subs[0].hash, subs: subs[0].subs };
  return { ...i, hash: subs[0].hash, subs };
}

/** The pages under an entry (itself when it has no sub-pages) */
export const leaves = (i: NavItem): NavItem[] => (i.subs ? i.subs.flatMap(leaves) : [i]);

/** The menu as this account sees it: entries without a source (or without their tool) left out, then empty groups;
 *  `hide`: pages left out besides (a « To watch » with nothing to watch) */
export function navGroups(s: Snapshot, hide: ReadonlySet<string> = new Set()): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.map((i) => seen(i, s, hide)).filter((i): i is NavItem => i !== null) })).filter((g) => g.items.length > 0);
}

const HOME_HASHES = new Set(["", "home", "stats"]);   // the home page and its statistics

/** Page of an address: the entry (or sub-page) with the longest address it starts with (#settings/alerts/rules -> Alertes,
 *  #machines/10.0.0.5 -> Machines); the home page for #, #home and #stats; none ("") for a page apart (#profile, #help…) */
export function activeNav(hash: string, groups: NavGroup[]): string {
  const h = hash.replace(/^#/, "");
  if (HOME_HASHES.has(h)) return "home";
  let best: { id: string; len: number } | undefined;
  for (const i of groups.flatMap((g) => g.items.flatMap(leaves)))
    for (const x of [i.hash, ...(i.also ?? [])])
      if (x && (h === x || h.startsWith(`${x}/`)) && (!best || x.length > best.len)) best = { id: i.id, len: x.length };
  return best?.id ?? "";
}

/** The entry an address belongs to, and its page when it has sub-pages: the title of a page (« Application › Tâches et horaires ») */
export function navTrail(hash: string): { item?: NavItem; sub?: NavItem } {
  const id = activeNav(hash, NAV);
  for (const i of NAV.flatMap((g) => g.items)) {
    if (i.id === id) return { item: i };
    const x = i.subs && leaves(i).find((y) => y.id === id);
    if (x) return { item: i, sub: x };
  }
  return {};
}

/** Onglet visé par l'adresse actuelle (#dns, #settings/api…) ; « home » si l'adresse n'en désigne aucun (y compris les pages à part : #profile, #help…) */
export function tabFromHash(): TabId {
  const raw = location.hash.slice(1).split("/")[0];
  const h = (OLD_TABS[raw] ?? raw) as TabId;
  return TAB_IDS.includes(h) ? h : "home";
}
