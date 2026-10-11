// Apparence retenue par le navigateur : thème (sombre par défaut) et largeur de la page.
import { useEffect, useState, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "myservices-theme";
const WIDTH_KEY = "myservices-content-width";

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

/** Largeur maximale du contenu (en-tête, onglets, pages), en px ; 0 = toute la largeur de l'écran
 *  (dernier cran du curseur). Même réglage que « Page width » de GpuViewR. */
export const CONTENT_WIDTH = { min: 1200, max: 2560, step: 80, default: 1760, full: 0 } as const;

function clampWidth(px: number): number {
  if (px === CONTENT_WIDTH.full) return px;
  if (!Number.isFinite(px)) return CONTENT_WIDTH.default;
  return Math.min(CONTENT_WIDTH.max, Math.max(CONTENT_WIDTH.min, px));
}

export function applyWidth(px: number): void {
  document.documentElement.style.setProperty("--content-max", px === CONTENT_WIDTH.full ? "100%" : `${px}px`);
}

export function savedWidth(): number {
  const v = localStorage.getItem(WIDTH_KEY);
  return v === null ? CONTENT_WIDTH.default : clampWidth(Number.parseInt(v, 10));
}

export function useContentWidth(): [number, (px: number) => void] {
  const [width, setWidth] = useState<number>(savedWidth);
  useEffect(() => {
    applyWidth(width);
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);
  return [width, (px) => setWidth(clampWidth(px))];
}

/** Logo avant le titre de l'en-tête : le favicon tel quel (grille sur carré sombre), la même grille sans fond, ou le hub relié à ses services. */
export type HeaderLogo = "favicon" | "grid" | "hub";
export const HEADER_LOGOS: { id: HeaderLogo; file: string }[] = [
  { id: "favicon", file: "favicon.svg" }, { id: "grid", file: "logo-grid.svg" }, { id: "hub", file: "mark.svg" },
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
  return useSyncExternalStore((f) => { logoSubs.add(f); return () => { logoSubs.delete(f); }; }, savedLogo);
}
