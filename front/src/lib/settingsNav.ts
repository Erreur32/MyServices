// Dernière section des Réglages ouverte, retenue par le navigateur : « Réglages » du menu du compte y revient.
const KEY = "ms.settings.last";

export const lastSettingsSection = (): string => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const rememberSettingsSection = (id: string): void => { try { localStorage.setItem(KEY, id); } catch { /* navigation privée : tant pis */ } };

// Sous-onglet ouvert de Réglages → Machines (Machines, SSH & Agents) : retrouvé après un rechargement
const PART_KEY = "ms.settings.machines.part";
export const lastMachinesPart = (): string => { try { return localStorage.getItem(PART_KEY) || ""; } catch { return ""; } };
export const rememberMachinesPart = (id: string): void => { try { localStorage.setItem(PART_KEY, id); } catch { /* navigation privée : tant pis */ } };

/** Shows the open section in the address (#settings/connectors, #settings/agents…): a reload, a bookmark or a copied link opens the same
 *  page, and a link to it works even when the old address was still showing. A new entry in the history, so « back » goes back. */
export function showInUrl(hash: string, replace = false): void {
  if (location.hash.slice(1) === hash) return;
  if (replace) history.replaceState(history.state, "", `#${hash}`);
  else history.pushState(history.state, "", `#${hash}`);
}
