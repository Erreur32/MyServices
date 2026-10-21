// Dernière section des Réglages ouverte, retenue par le navigateur : « Réglages » du menu du compte y revient.
const KEY = "ms.settings.last";

export const lastSettingsSection = (): string => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const rememberSettingsSection = (id: string): void => {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) return;   // only a section id reaches the storage
  try { localStorage.setItem(KEY, id); } catch { /* navigation privée : tant pis */ }
};

// Sous-onglet ouvert de Réglages → Machines (Machines, SSH & Agents) : retrouvé après un rechargement

/** Shows the open section in the address (#settings/connectors, #settings/agents…): a reload, a bookmark or a copied link opens the same
 *  page, and a link to it works even when the old address was still showing. A new entry in the history, so « back » goes back. */
export function showInUrl(hash: string, replace = false): void {
  if (location.hash.slice(1) === hash) return;
  if (replace) history.replaceState(history.state, "", `#${hash}`);
  else history.pushState(history.state, "", `#${hash}`);
}

/** An old section id, moved elsewhere in Settings (`section`) or become a page apart (`redirect`, a full address without the leading « # »). */
export interface SectionTarget { section?: string; redirect?: string }

/** Settings sections that moved under another id (SSH key: now part of « Clés et API » ; Connecteurs and Machines kept their old menu-link ids) */
const SECTION_ALIAS: Record<string, string> = { ssh: "api", sources: "connectors", agents: "machines" };
/** Old Settings sections, now a page apart (#help…) or a sub-tab of Requests and logs (#settings/requests/audit) ; « tasks » (Tâches et horaires) stays a section */
const PAGE_REDIRECT: Record<string, string> = { audit: "settings/requests/audit", logs: "settings/requests/logs", help: "help", about: "about" };

/** Where an id read from the address (or from the last-section memory) leads today; an id with neither an alias nor a redirect comes back as its own section.
 *  Own keys only: an id read from the address (#settings/constructor…) never reaches Object's own methods. */
export function normalizeSection(id: string): SectionTarget {
  if (Object.hasOwn(PAGE_REDIRECT, id)) return { redirect: PAGE_REDIRECT[id] };
  return { section: Object.hasOwn(SECTION_ALIAS, id) ? SECTION_ALIAS[id] : id };
}
