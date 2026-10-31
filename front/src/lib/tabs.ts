// Menu de gauche : groupes, entrées, icône, libellé, visibilité (hors composants, voir lib/forms.ts).
import { Activity, Bot, Boxes, Camera, Cloud, Film, Gauge, ListOrdered, ListChecks, Radio, Sparkles, ArrowDownUp, Copy, FolderSearch, Cpu, Ban, Bell, Eye, FileBadge, FileText, Globe, HardDrive, History, House, Info, KeyRound, Layers, LayoutDashboard, Link2, List, Mail, Monitor, Network, PenLine, Plug, Plus, Radar, RefreshCw, Router, ScanSearch, ScrollText, Send, Server, Shield, ShieldCheck, SlidersHorizontal, Stethoscope, Timer, Users, Video, Webhook, Workflow, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "./summary";
import { tx } from "./i18n";
import { hasNetwork } from "./network";
import { aiCards, aiGpus, aiModels, hasAi } from "./ai";
import { hasCloudflare } from "./cloudflare";
import { hasDomotique } from "./domotique";
import { hasTapo } from "./tapo";
import { hasStream, streamCameras, streamCards, streamFlows } from "./video";

/** Cartes de services (hors outils réseau, qui ont leur onglet) et conteneurs lus par une API : l'onglet Infra */

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
const boxShown = (s: Snapshot) => (s.data.services_status ?? []).some((c) => !!c.box);
const scanShown = (s: Snapshot) => (s.data.network ?? []).some((c) => c.connector === "mynetwork");

/** The side menu, in five groups; an entry whose source is missing is left out, and so is a group left empty. The pages of
 *  Settings (#settings/<section>[/<part>]) are spread over the topic they set, the Collection group (connectors, discovery, tasks) and the Administration group. */
export const NAV: NavGroup[] = [
  { id: "overview", label: tx("En bref"), items: [   // « Vue d'ensemble » is Security's page alone
    { id: "home", hash: "", tab: "home", icon: House, label: tx("Accueil"), subs: [
      { ...sub("home-overview", "", "home", LayoutDashboard, tx("Tableau de bord")), also: ["home", "stats"] },
      sub("history-events", "history/events", "home", ListOrdered, tx("Événements")),   // the History pages, under the dashboard (#history keeps its address)
      sub("history-availability", "history/availability", "home", Activity, tx("Disponibilité")),
    ] },
  ] },
  { id: "inventory", label: tx("Inventaire"), items: [
    { id: "machines", hash: "machines", tab: "machines", icon: Monitor, label: tx("Machines"), subs: [
      { ...sub("machines-list", "machines", "machines", List, tx("Toutes les machines")), also: ["settings/machines"] },   // its « Add » and « Redetect » buttons open #settings/machines
      sub("machines-devices", "settings/machines/devices", "settings", Radar, tx("Appareils non suivis")),
      sub("machines-agents", "settings/machines/agents", "settings", Cpu, tx("Agents")),
      sub("machines-ssh", "settings/machines/ssh", "settings", KeyRound, tx("Connexions SSH")),
    ] },
    { id: "services", hash: "services", tab: "services", icon: Globe, label: tx("Services"), subs: [
      { ...sub("services-all", "services/all", "services", Layers, tx("Tous les services")), also: ["services/manual"] },
      sub("services-fresh", "services/fresh", "services", Sparkles, tx("Nouveaux services"), (s) => s.me.role === "admin"),   // found these 7 days, to keep or pause
      sub("services-new", "services/new", "settings", PenLine, tx("Déclarer un service")),
    ] },
    { id: "network", hash: "network", tab: "network", icon: Router, label: tx("Réseau"), subs: [
      views("network-view", "network", [
        sub("network-unifi", "network/unifi", "network", LayoutDashboard, tx("UniFi"), unifiShown),
        { ...sub("network-box", "network/box", "network", Router, tx("Box internet"), boxShown), also: ["network/freebox"] },   // the Freebox is read here now
        sub("network-scan", "network/scan", "network", Radar, tx("Scan"), scanShown),
        sub("network-list", "network/list", "network", List, tx("Équipements et appareils")),
        sub("network-diagnostic", "network/diagnostic", "network", Stethoscope, tx("Diagnostic")),
      ]),
    ] },
    { id: "dns", hash: "dns", tab: "dns", icon: Network, label: tx("DNS"), subs: [
      sub("dns-servers", "dns/servers", "dns", Server, tx("Serveurs")),
      sub("dns-all", "dns/all", "dns", Layers, tx("Détails")),
    ] },
    { id: "cloudflare", hash: "cloudflare/overview", tab: "cloudflare", icon: Cloud, label: "Cloudflare", subs: [
      sub("cloudflare-overview", "cloudflare/overview", "cloudflare", LayoutDashboard, tx("Vue d'ensemble")),
      sub("cloudflare-traffic", "cloudflare/traffic", "cloudflare", Activity, tx("Trafic")),
      sub("cloudflare-compare", "cloudflare/compare", "cloudflare", Layers, tx("Comparer les domaines")),
      sub("cloudflare-security", "cloudflare/security", "cloudflare", Shield, tx("Sécurité")),
      sub("cloudflare-origin", "cloudflare/origin", "cloudflare", Server, tx("Serveur et cache")),
      sub("cloudflare-dns", "cloudflare/dns", "cloudflare", Network, tx("DNS")),
      sub("cloudflare-checks", "cloudflare/checks", "cloudflare", ListChecks, tx("Vérification")),
    ] },
    { id: "virtualization", hash: "virtualization", tab: "virtualization", icon: Server, label: tx("Virtualisation") },
    { id: "stream", hash: "stream", tab: "stream", icon: Video, label: tx("Vidéo et caméras"), subs: [
      sub("stream-overview", "stream/overview", "stream", LayoutDashboard, tx("Vue d'ensemble")),
      sub("stream-cameras", "stream/cameras", "stream", Camera, tx("Caméras"), (s) => streamCameras(streamCards(s)).length > 0),
      sub("stream-flows", "stream/flows", "stream", Radio, tx("Flux"), (s) => streamFlows(streamCards(s)).length > 0),
      sub("stream-recordings", "stream/recordings", "stream", Film, tx("Enregistrements"), (s) => streamCards(s).some((c) => c.role === "nvr" && !c.unread)),
      sub("stream-frigate", "stream/frigate", "stream", Gauge, tx("Frigate"), (s) => (s.data.services_status ?? []).some((c) => c.connector === "frigate" && !!c.frigate)),
    ] },
    { id: "domotique", hash: "domotique/overview", tab: "domotique", icon: House, label: tx("Domotique"), subs: [
      sub("domotique-overview", "domotique/overview", "domotique", LayoutDashboard, tx("Vue d'ensemble")),
      sub("domotique-netatmo", "domotique/netatmo", "domotique", House, "Netatmo"),
      sub("domotique-tapo", "domotique/tapo", "domotique", Plug, "Tapo"),
    ] },
    { id: "ai", hash: "ai", tab: "ai", icon: Bot, label: tx("IA et agents"), subs: [
      sub("ai-overview", "ai/overview", "ai", LayoutDashboard, tx("Vue d'ensemble")),
      sub("ai-models", "ai/models", "ai", Boxes, tx("Modèles"), (s) => aiModels(s).length > 0),
      sub("ai-agents", "ai/agents", "ai", Workflow, tx("Agents et MCP"), (s) => aiCards(s).some((c) => c.role === "agent" || c.role === "interface" || c.role === "mcp")),
      sub("ai-gpu", "ai/gpu", "ai", Cpu, "GPU", (s) => aiGpus(s).length > 0 || aiModels(s).some((m) => !!m.vram)),
    ] },
    { id: "diagrams", hash: "diagrams", tab: "diagrams", icon: Workflow, label: tx("Schémas") },
  ] },
  { id: "protection", label: tx("Protection"), items: [
    { id: "security", hash: "security", tab: "security", icon: Shield, label: tx("Sécurité"), subs: [
      sub("security-overview", "security/overview", "security", Eye, tx("Vue d'ensemble")),   // the findings of every page below, always shown
      sub("security-sites", "security/sites", "security", Globe, tx("Sites exposés")),
      sub("security-access", "security/access", "security", KeyRound, tx("Accès SSH")),
      sub("security-ports", "security/network", "security", Radar, tx("Ports du réseau")),
      sub("security-certs", "security/certs", "security", FileBadge, tx("Certificats")),
      sub("fail2ban", "security/fail2ban", "security", Ban, tx("Fail2ban"), (s) => (s.data.security ?? []).length > 0),   // a Fail2ban read (LogviewR)
      sub("security-wazuh", "security/wazuh", "security", ShieldCheck, "Wazuh", (s) => (s.data.services_status ?? []).some((c) => c.connector === "wazuh")),   // a Wazuh connector
    ] },
    { id: "backups", hash: "backups", tab: "backups", icon: HardDrive, label: tx("Sauvegardes"), subs: [
      views("backups-view", "backups", [
        sub("backups-machines", "backups/machines", "backups", Monitor, tx("Par machine")),
        { ...sub("backups-all", "backups/all", "backups", Layers, tx("Jeux")), also: ["settings/backups"] }   // the page of one set: #settings/backups/<set id>,
      ]),
      sub("backups-add", "settings/backups/add", "settings", Plus, tx("Ajouter des sauvegardes")),
      sub("backups-unlinked", "settings/backups/unlinked", "settings", Link2, tx("À relier")),
      sub("backups-copies", "settings/backups/copies", "settings", Copy, tx("Copies ailleurs")),
      sub("backups-paths", "settings/backups/paths", "settings", FolderSearch, tx("Emplacements cherchés")),
    ] },
  ] },
  { id: "collect", label: tx("Collecte"), items: [   // what feeds the app: the sources it reads, what it finds by itself, when it runs
    { id: "connectors", hash: "settings/connectors", tab: "settings", icon: Plug, label: tx("Connecteurs"), subs: [
      sub("connectors-mine", "settings/connectors", "settings", Plug, tx("Mes connecteurs")),
      sub("connectors-available", "settings/connectors/available", "settings", Plus, tx("Disponibles")),
      sub("connectors-detected", "settings/connectors/detected", "settings", Radar, tx("Détectés à relier")),
      sub("connectors-read", "settings/connectors/read", "settings", Server, tx("Déjà lus par SSH ou agent")),
    ] },
    { id: "discovery", hash: "settings/discovery", tab: "settings", icon: ScanSearch, label: tx("Découverte") },   // its mode, what to do, the other suggestions
    { id: "tasks", hash: "settings/tasks", tab: "settings", icon: Timer, label: tx("Tâches et horaires") },
  ] },
  { id: "admin", label: tx("Administration"), items: [
    { id: "alerts", hash: "settings/alerts/channels", tab: "settings", icon: Bell, label: tx("Notifications"), subs: [   // where and when the alerts are sent
      sub("alerts-channels", "settings/alerts/channels", "settings", Radio, tx("Canaux")),
      sub("alerts-rules", "settings/alerts/rules", "settings", ListChecks, tx("Règles d'alerte")),
      sub("alerts-notifications", "settings/alerts/notifications", "settings", Send, tx("Mes notifications")),
      sub("alerts-examples", "settings/alerts/examples", "settings", Sparkles, tx("Exemples")),
      sub("alerts-sent", "settings/alerts/sent", "settings", History, tx("Derniers envois")),
    ] },
    { id: "access", hash: "settings/accounts", tab: "settings", icon: Users, label: tx("Comptes et accès"), subs: [
      sub("accounts", "settings/accounts", "settings", Users, tx("Comptes et sessions")),
      sub("api", "settings/api", "settings", Webhook, tx("Jetons API et MCP")),
    ] },
    { id: "app", hash: "settings/updates", tab: "settings", icon: SlidersHorizontal, label: tx("Application"), subs: [
      sub("updates", "settings/updates", "settings", RefreshCw, tx("Mises à jour")),
      sub("mail", "settings/mail", "settings", Mail, tx("E-mail")),
      sub("export", "settings/export", "settings", ArrowDownUp, tx("Export et import")),
      sub("requests", "settings/requests", "settings", Activity, tx("Requêtes")),   // what the app does (calls, audit, logs), a page apart of the settings
      sub("audit", "settings/requests/audit", "settings", ScrollText, tx("Journal d'audit")),
      sub("logs", "settings/requests/logs", "settings", FileText, tx("Journaux")),
      sub("about", "about", "settings", Info, tx("Informations")),
    ] },
  ] },
];

/** Tout identifiant d'onglet reconnu par l'adresse */
export const TAB_IDS: TabId[] = [...new Set(NAV.flatMap((g) => g.items.map((i) => i.tab)))];

/** Onglets encore en chantier : visibles seulement sur une image de dev (construite sur place, git-rev), pas publiés. */
export const UNRELEASED: TabId[] = ["diagrams"];
export const isDevBuild = (s: Snapshot) => !!s.me.git || s.me.version === "dev";

/** Onglet affiché seulement si sa source est activée (et Réglages pour les admins). */
export function visible(id: TabId, s: Snapshot): boolean {
  if (UNRELEASED.includes(id) && !isDevBuild(s)) return false;
  switch (id) {
    case "ai": return hasAi(s);   // an AI service in Services, an AI connector or GpuViewR
    case "cloudflare": return hasCloudflare(s);
    case "domotique": return hasDomotique(s) || hasTapo(s);
    case "stream": return hasStream(s);   // a « Stream » service in Services or a video connector
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

/** Page of an address: the entry (or sub-page) with the longest address it starts with (#settings/alerts/rules -> Alertes,
 *  #machines/10.0.0.5 -> Machines); the home page for #, #home and #stats; none ("") for a page apart (#profile, #help…) */
export function activeNav(hash: string, groups: NavGroup[]): string {
  const h = hash.replace(/^#/, "") || "home";   // « # » alone: the home page
  let best: { id: string; len: number } | undefined;
  for (const i of groups.flatMap((g) => g.items.flatMap(leaves)))
    for (const x of [i.hash, ...(i.also ?? [])])
      if (x && (h === x || h.startsWith(`${x}/`)) && (!best || x.length > best.len)) best = { id: i.id, len: x.length };
  return best?.id ?? "";
}

/** The entry an address belongs to, and its page when it has sub-pages: the title of a page (« Collecte › Tâches et horaires ») */
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
