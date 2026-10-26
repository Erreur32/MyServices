// Apparence retenue par le navigateur : thème (sombre par défaut) et logo. La page prend toute la largeur de l'écran.
import { useEffect, useState, useSyncExternalStore } from "react";

/** "dark" is the original palette; the other dark themes each get a class « theme-<id> » on <html> (colours in index.css). */
export type Theme = "dark" | "light" | "github-dark" | "night-owl" | "ayu-mirage" | "one-dark" | "nord" | "dracula";
export const THEMES: Theme[] = ["dark", "github-dark", "night-owl", "ayu-mirage", "one-dark", "nord", "dracula", "light"];
const KEY = "myservices-theme";

const isTheme = (v: string | null): v is Theme => THEMES.includes(v as Theme);

export function savedTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return isTheme(v) ? v : "dark";
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("light", t === "light");
  for (const id of THEMES) root.classList.toggle(`theme-${id}`, id === t && id !== "dark" && id !== "light");
}

/** The theme, picked in the profile (Appearance) only: the header has no switch any more */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return [theme, setTheme];
}

/** Logo before the header title, and the browser tab's icon: the grid alone (default, readable on light and dark) or the grid on its dark square. */
export type HeaderLogo = "favicon" | "grid";
export const HEADER_LOGOS: { id: HeaderLogo; file: string }[] = [
  { id: "grid", file: "logo-grid.svg" }, { id: "favicon", file: "favicon.svg" },
];
const LOGO_KEY = "myservices-header-logo";
const DEFAULT_LOGO: HeaderLogo = "grid";
const logoSubs = new Set<() => void>();

export function savedLogo(): HeaderLogo {
  try {
    const v = localStorage.getItem(LOGO_KEY);
    return HEADER_LOGOS.some((l) => l.id === v) ? (v as HeaderLogo) : DEFAULT_LOGO;
  } catch { return DEFAULT_LOGO; }
}

/** The tab's icon (favicon) follows the chosen logo; called at start and on every change */
export function applyFavicon(id: HeaderLogo = savedLogo()): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `${import.meta.env.BASE_URL}${HEADER_LOGOS.find((l) => l.id === id)!.file}`;
}

export function setHeaderLogo(id: HeaderLogo): void {
  localStorage.setItem(LOGO_KEY, id);
  applyFavicon(id);
  logoSubs.forEach((f) => f());
}

export function useHeaderLogo(): HeaderLogo {
  return useSyncExternalStore((f) => { logoSubs.add(f); return () => { logoSubs.delete(f); }; }, savedLogo, () => DEFAULT_LOGO);
}

/** Folded side menu: the sub-pages of an icon open when the pointer rests on it, or only on a click */
export type FlyoutMode = "hover" | "click";
const FLYOUT_KEY = "myservices-menu-flyout";
const flyoutSubs = new Set<() => void>();

export function savedFlyout(): FlyoutMode {
  try { return localStorage.getItem(FLYOUT_KEY) === "click" ? "click" : "hover"; } catch { return "hover"; }
}

export function setFlyout(m: FlyoutMode): void {
  try { localStorage.setItem(FLYOUT_KEY, m); } catch { /* storage refused: the choice lasts this visit */ }
  flyoutSubs.forEach((f) => f());
}

export function useFlyout(): FlyoutMode {
  return useSyncExternalStore((f) => { flyoutSubs.add(f); return () => { flyoutSubs.delete(f); }; }, savedFlyout, () => "hover");
}
