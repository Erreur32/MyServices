// Apparence (thème, logo de l'en-tête, langue, largeur de la page), retenue par le navigateur : dans le profil de chaque compte,
// lecture seule comprise (c'est un choix personnel, pas un réglage de l'application).
import { Image, Languages, Moon, MoveHorizontal, Palette, RotateCcw, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { CONTENT_WIDTH, setHeaderLogo, useHeaderLogo, type HeaderLogo, type Theme } from "../theme";
import { LANG, setLang, tx, type Lang } from "../lib/i18n";
import { Flag } from "./Flag";
import { Card } from "./ui";
import { IconChoice, type IconOption } from "./IconChoice";
import { quiet } from "../lib/forms";
import { InfoNote } from "./InfoNote";

/** Réglages d'apparence tenus par App (appliqués à toute la page). */
export interface Look {
  theme: Theme;
  setTheme: (t: Theme) => void;
  width: number;
  setWidth: (px: number) => void;
}

const LOGO_OPTIONS: IconOption<HeaderLogo>[] = [
  { value: "favicon", label: tx("Favicon (grille sur fond)"), hint: tx("Le favicon tel quel : grille de services sur un carré sombre"), icon: <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" /> },
  { value: "grid", label: tx("Grille sans fond"), hint: tx("La même grille, sans le carré sombre : lisible sur clair comme sur sombre"), icon: <img src={`${import.meta.env.BASE_URL}logo-grid.svg`} alt="" className="h-9 w-9" /> },
];

export function Appearance({ look }: { look: Look }) {
  const themes: { id: Theme; label: string; icon: ReactNode; swatch: string }[] = [
    { id: "dark", label: tx("Sombre"), icon: <Moon size={16} />, swatch: "bg-[#0c0e14]" },
    { id: "light", label: tx("Clair"), icon: <Sun size={16} />, swatch: "bg-[#f4f6fa]" },
  ];
  // Le dernier cran (max + un pas) = pleine largeur, stockée 0
  const fullNotch = CONTENT_WIDTH.max + CONTENT_WIDTH.step;
  const full = look.width === CONTENT_WIDTH.full;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-bold"><Palette size={16} aria-hidden />{tx("Thème")}</h2>
        <div className="flex flex-wrap gap-2">
          {themes.map((t) => (
            <button key={t.id} type="button" onClick={() => look.setTheme(t.id)} aria-pressed={look.theme === t.id}
              className={`flex w-40 items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold ${look.theme === t.id ? "border-link bg-link/10 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>
              <span className={`h-8 w-8 rounded-lg border border-line ${t.swatch}`} />
              <span className="inline-flex items-center gap-1.5">{t.icon}{t.label}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><Image size={16} aria-hidden />{tx("Logo de l'en-tête")}</h2>
        <InfoNote className="mb-3">{tx("L'icône affichée avant le titre. Le changement est immédiat. Le favicon de l'onglet du navigateur ne change pas.")}</InfoNote>
        <IconChoice label={tx("Logo de l'en-tête")} value={useHeaderLogo()} onPick={setHeaderLogo} options={LOGO_OPTIONS} />
      </Card>
      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-bold"><Languages size={16} aria-hidden />{tx("Langue")}</h2>
        <div className="flex flex-wrap gap-2">
          {([["fr", "Français"], ["en", "English"]] as [Lang, string][]).map(([l, label]) => (
            <button key={l} type="button" onClick={() => l !== LANG && setLang(l)} aria-pressed={LANG === l}
              className={`flex w-44 items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold ${LANG === l ? "border-link bg-link/10 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>
              <Flag lang={l} className="h-6 w-9" />{label}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 font-bold"><MoveHorizontal size={16} />{tx("Largeur de la page")}</h2>
          <button type="button" className={quiet} onClick={() => look.setWidth(CONTENT_WIDTH.default)} disabled={look.width === CONTENT_WIDTH.default}>
            <RotateCcw size={14} />{tx("Par défaut")}
          </button>
        </div>
        <InfoNote className="mb-3">
          {tx("Largeur maximale du contenu (en-tête, onglets, pages). Le cran le plus à droite utilise toute la largeur de l'écran.")}
        </InfoNote>
        <div className="flex items-center gap-4">
          <input type="range" className="range flex-1" min={CONTENT_WIDTH.min} max={fullNotch} step={CONTENT_WIDTH.step}
            value={full ? fullNotch : look.width} aria-label={tx("Largeur de la page")}
            onChange={(e) => { const px = Number(e.target.value); look.setWidth(px >= fullNotch ? CONTENT_WIDTH.full : px); }} />
          <span className="w-32 whitespace-nowrap text-right font-mono text-sm tabular-nums">{full ? tx("Pleine largeur") : `${look.width} px`}</span>
        </div>
      </Card>
      <InfoNote>{tx("Retenus par ce navigateur seulement.")}</InfoNote>
    </div>
  );
}
