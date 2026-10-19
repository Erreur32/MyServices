// Home page, « Il manque »: the sources that are not plugged in and would unlock a page or a follow-up (health of a machine, Backups, DNS,
// Network pages, a notification channel). Nothing mandatory: each line says what it would bring and where to plug it in.
import type { Snapshot } from "../api";
import { tx } from "./i18n";
import { mState } from "./machines";
import { hasNetwork } from "./network";
import { names, plural } from "./summary";

export interface Missing {
  key: string;
  text: string;     // sentence, **bold** names rendered by <Rich>
  action: string;   // the button's label
  href: string;     // settings section that fixes it (« settings/connectors »)
}

/** `channels`: number of notification channels set up; null while not read yet (the line is not shown) */
export function missing(snap: Snapshot, channels: number | null): Missing[] {
  const out: Missing[] = [];
  const { data } = snap;
  // Online, followed, but read by nothing: neither agent nor usable SSH (boxes, gateways and the machine running the app excluded)
  const unread = data.machine_list.filter((m) => m.ping && !m.off && !m.disabled && !m.gateway && !m.local && ["nossh", "refused"].includes(mState(m)));
  if (unread.length) {
    out.push({
      key: "health", action: tx("Installer l'agent"), href: "settings/machines",
      text: unread.length === 1
        ? tx("Santé de {0} : ni agent ni accès SSH, ses conteneurs et sa santé ne sont pas lus", names(unread.map((m) => m.name)))
        : tx("{0} sans agent ni accès SSH ({1}) : leurs conteneurs et leur santé ne sont pas lus", plural(unread.length, "machine"), names(unread.map((m) => m.name))),
    });
  }
  if (!snap.backups) out.push({ key: "backups", text: tx("Page Sauvegardes cachée : aucune source branchée (Freebox, Proxmox Backup, Veeam, Synology…)"), action: tx("Ajouter une source"), href: "settings/backups" });
  if (!hasNetwork(snap)) out.push({ key: "network", text: tx("Page Réseau cachée : aucun MynetworK, UniFi, Freebox ou OPNsense branché"), action: tx("Ajouter un connecteur"), href: "settings/connectors" });
  if (!data.dns) out.push({ key: "dns", text: tx("Page DNS cachée : aucun serveur DNS joignable (ni outil DNS branché, ni résolveur dans le conteneur)"), action: tx("Ajouter un connecteur"), href: "settings/connectors" });
  if (channels === 0) out.push({ key: "channels", text: tx("Notifications : aucun canal, les alertes restent sur cette page"), action: tx("Choisir un canal"), href: "settings/alerts" });
  return out;
}
