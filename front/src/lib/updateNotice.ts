// Header notice of a new release: hidden by its cross for that version only (kept in the browser), back for the next one.
const KEY = "ms.update.dismissed";

export const dismissedTag = (): string => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const dismissTag = (tag: string): void => { try { localStorage.setItem(KEY, tag); } catch { /* private browsing: shown again */ } };
export const forgetDismissed = (): void => { try { localStorage.removeItem(KEY); } catch { /* nothing kept */ } };
