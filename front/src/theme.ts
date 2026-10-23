// Apparence retenue par le navigateur : thème (sombre par défaut) et logo. La page prend toute la largeur de l'écran.
import { useEffect, useState, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "myservices-theme";

export function savedTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function useTheme(): [Theme, () => void, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark")), setTheme];
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
