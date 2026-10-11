// Dernière section des Réglages ouverte, retenue par le navigateur : « Réglages » du menu du compte y revient.
const KEY = "ms.settings.last";

export const lastSettingsSection = (): string => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const rememberSettingsSection = (id: string): void => { try { localStorage.setItem(KEY, id); } catch { /* navigation privée : tant pis */ } };

// Sous-onglet ouvert de Réglages → Connecteurs (Agents et SSH, Connecteurs, Activation) : retrouvé après un rechargement
const PART_KEY = "ms.settings.connectors.part";
export const lastConnectorsPart = (): string => { try { return localStorage.getItem(PART_KEY) || ""; } catch { return ""; } };
export const rememberConnectorsPart = (id: string): void => { try { localStorage.setItem(PART_KEY, id); } catch { /* navigation privée : tant pis */ } };
