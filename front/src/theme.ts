// Apparence retenue par le navigateur : thème (sombre par défaut) et logo. La page prend toute la largeur de l'écran.
import { useEffect, useState, useSyncExternalStore } from "react";

/** "dark" is the original palette; the other dark themes each get a class « theme-<id> » on <html> (colours in index.css). */
export type Theme = "dark" | "light" | "github-dark" | "night-owl" | "ayu-mirage";
export const THEMES: Theme[] = ["dark", "github-dark", "night-owl", "ayu-mirage", "light"];
const KEY = "myservices-theme";
const DARK_KEY = "myservices-theme-dark";   // last dark theme picked: the header button comes back to it from the light one

const isTheme = (v: string | null): v is Theme => THEMES.includes(v as Theme);

export function savedTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return isTheme(v) ? v : "dark";
}

function savedDark(): Theme {
  const v = localStorage.getItem(DARK_KEY);
  return isTheme(v) && v !== "light" ? v : "dark";
}

/** Header button: light → the last dark theme, any dark theme → light. */
export function toggledTheme(t: Theme, lastDark: Theme): Theme {
  return t === "light" ? lastDark : "light";
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("light", t === "light");
  for (const id of THEMES) root.classList.toggle(`theme-${id}`, id === t && id !== "dark" && id !== "light");
}

export function useTheme(): [Theme, () => void, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
    if (theme !== "light") localStorage.setItem(DARK_KEY, theme);
  }, [theme]);
  return [theme, () => setTheme((t) => toggledTheme(t, savedDark())), setTheme];
}

/** Logo avant le titre de l'en-tête : le favicon tel quel (grille sur carré sombre) ou la même grille sans fond. */
export type HeaderLogo = "favicon" | "grid";
export const HEADER_LOGOS: { id: HeaderLogo; file: string }[] = [
  { id: "favicon", file: "favicon.svg" }, { id: "grid", file: "logo-grid.svg" },
];
const LOGO_KEY = "myservices-header-logo";
const logoSubs = new Set<() => void>();

export function savedLogo(): HeaderLogo {
  const v = localStorage.getItem(LOGO_KEY);
  return HEADER_LOGOS.some((l) => l.id === v) ? (v as HeaderLogo) : "favicon";
}

export function setHeaderLogo(id: HeaderLogo): void {
  localStorage.setItem(LOGO_KEY, id);
  logoSubs.forEach((f) => f());
}

export function useHeaderLogo(): HeaderLogo {
  return useSyncExternalStore((f) => { logoSubs.add(f); return () => { logoSubs.delete(f); }; }, savedLogo, () => "favicon");
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
