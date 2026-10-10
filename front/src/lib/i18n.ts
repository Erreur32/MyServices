// Langue de la page (FR par défaut, EN) : le texte français sert de clé, `tx("…")` rend la traduction.
// Paramètres positionnels : tx("il y a {0} min", n). Langue choisie une fois au chargement (navigateur, sinon
// choix gardé) : un changement recharge la page, donc tx() peut servir aussi dans les constantes de module.
import { EN } from "./en";

export type Lang = "fr" | "en";
const KEY = "myservices-lang";

function detect(): Lang {
  if (typeof localStorage === "undefined") return "fr"; // hors navigateur (tests, build) : français, la langue des clés
  const saved = localStorage.getItem(KEY);
  if (saved === "fr" || saved === "en") return saved;
  const nav = navigator.language || "fr";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const LANG: Lang = detect();
export const LOCALE = LANG === "fr" ? "fr-FR" : "en-GB";

export function tx(fr: string, ...args: unknown[]): string {
  const s = LANG === "fr" ? fr : EN[fr] ?? fr;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m)) : s;
}

export function setLang(lang: Lang): void {
  localStorage.setItem(KEY, lang);
  location.reload();
}
