// Dernière section des Réglages ouverte, retenue par le navigateur : « Réglages » du menu du compte y revient.
const KEY = "ms.settings.last";

export const lastSettingsSection = (): string => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const rememberSettingsSection = (id: string): void => { try { localStorage.setItem(KEY, id); } catch { /* navigation privée : tant pis */ } };
