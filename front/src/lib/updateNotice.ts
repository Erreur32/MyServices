// Header notice of a new release: hidden by its cross for that version only (kept in the browser), back for the next one.
const KEY = "ms.update.dismissed";

export const dismissedTag = (): string => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const dismissTag = (tag: string): void => { try { localStorage.setItem(KEY, tag); } catch { /* private browsing: shown again */ } };
export const forgetDismissed = (): void => { try { localStorage.removeItem(KEY); } catch { /* nothing kept */ } };

/** What a check found, told to the header the moment it ends (« Check now ») or when the snapshot brings a new release (automatic check) */
export interface UpdateNews { available: boolean; tag?: string | null; url?: string | null; manual?: boolean }
const EVENT = "ms-update-check";
export const announceCheck = (news: UpdateNews): void => { dispatchEvent(new CustomEvent<UpdateNews>(EVENT, { detail: news })); };
export const onCheck = (fn: (news: UpdateNews) => void): (() => void) => {
  const h = (e: Event) => fn((e as CustomEvent<UpdateNews>).detail);
  addEventListener(EVENT, h);
  return () => removeEventListener(EVENT, h);
};

// A release found by the automatic check is announced once (kept in the browser), then only its pill stays
const SEEN = "ms.update.announced";
export const announcedTag = (): string => { try { return localStorage.getItem(SEEN) || ""; } catch { return ""; } };
export const markAnnounced = (tag: string): void => { try { localStorage.setItem(SEEN, tag); } catch { /* private browsing: announced again */ } };

// The header's notices of a new release (pill and toast), switched off from Settings → Updates (kept in the browser)
const OFF = "ms.update.notices-off";
const OFF_EVENT = "ms-update-notices";
export const noticesOn = (): boolean => { try { return localStorage.getItem(OFF) !== "1"; } catch { return true; } };
export const setNoticesOn = (on: boolean): void => {
  try { if (on) localStorage.removeItem(OFF); else localStorage.setItem(OFF, "1"); } catch { /* private browsing: for this visit */ }
  dispatchEvent(new Event(OFF_EVENT));
};
export const onNotices = (fn: () => void): (() => void) => { addEventListener(OFF_EVENT, fn); return () => removeEventListener(OFF_EVENT, fn); };
