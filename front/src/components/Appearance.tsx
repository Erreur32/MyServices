// Apparence (thème, logo de l'en-tête, langue, menu replié), retenue par le navigateur : dans le profil de chaque compte,
// lecture seule comprise (c'est un choix personnel, pas un réglage de l'application).
import { Check, Image, Languages, Moon, MousePointer2, MousePointerClick, Palette, PanelLeft, Sun } from "lucide-react";
import { setFlyout, setHeaderLogo, useFlyout, useHeaderLogo, type FlyoutMode, type HeaderLogo, type Theme } from "../theme";
import { LANG, setLang, tx, type Lang } from "../lib/i18n";
import { Flag } from "./Flag";
import { Card } from "./ui";
import { IconChoice, type IconOption } from "./IconChoice";
import { InfoNote } from "./InfoNote";

/** Réglages d'apparence tenus par App (appliqués à toute la page). */
export interface Look {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const LOGO_OPTIONS: IconOption<HeaderLogo>[] = [
  { value: "favicon", label: tx("Favicon (grille sur fond)"), hint: tx("Le favicon tel quel : grille de services sur un carré sombre"), icon: <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" /> },
  { value: "grid", label: tx("Grille sans fond"), hint: tx("La même grille, sans le carré sombre : lisible sur clair comme sur sombre"), icon: <img src={`${import.meta.env.BASE_URL}logo-grid.svg`} alt="" className="h-9 w-9" /> },
];

const FLYOUT_OPTIONS: IconOption<FlyoutMode>[] = [
  { value: "hover", label: tx("Au survol"), hint: tx("Les sous-pages s'ouvrent dès que la souris passe sur l'icône"), icon: <MousePointer2 size={26} aria-hidden /> },
  { value: "click", label: tx("Au clic"), hint: tx("Les sous-pages s'ouvrent seulement en cliquant sur l'icône"), icon: <MousePointerClick size={26} aria-hidden /> },
];

/** The themes, dark ones first; each preview is drawn in the theme's own colours (its « theme-<id> » class, index.css) */
const THEME_CHOICES: { id: Theme; label: string; light?: boolean }[] = [
  { id: "dark", label: tx("Sombre (MyServices)") }, { id: "github-dark", label: "GitHub Dark" }, { id: "night-owl", label: "Night Owl" },
  { id: "ayu-mirage", label: "Ayu Mirage" }, { id: "one-dark", label: "One Dark" }, { id: "nord", label: "Nord" }, { id: "dracula", label: "Dracula" },
  { id: "light", label: tx("Clair"), light: true },
];

/** A small page in the theme's colours: a card with two lines of text, a link and the four state colours */
function ThemeCard({ id, label, light, on, pick }: Readonly<{ id: Theme; label: string; light?: boolean; on: boolean; pick: () => void }>) {
  return (
    <button type="button" onClick={pick} aria-pressed={on}
      className={`group flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors ${on ? "border-link bg-link/10" : "border-line hover:border-link"}`}>
      <span className={`theme-${id} block rounded-lg border border-line bg-bg p-2`} aria-hidden>
        <span className="block rounded-md border border-line bg-card p-2">
          <span className="block h-1.5 w-3/4 rounded-full bg-txt" />
          <span className="mt-1.5 block h-1.5 w-1/2 rounded-full bg-muted" />
          <span className="mt-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-ok" /><span className="h-2.5 w-2.5 rounded-full bg-warn" />
            <span className="h-2.5 w-2.5 rounded-full bg-bad" /><span className="h-2.5 w-2.5 rounded-full bg-link" />
            <span className="ml-auto h-1.5 w-6 rounded-full bg-link/70" />
          </span>
        </span>
      </span>
      <span className={`flex items-center gap-1.5 px-0.5 text-sm font-semibold ${on ? "text-txt" : "text-muted group-hover:text-txt"}`}>
        {light ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}{label}
        {on && <Check size={14} className="ml-auto text-link" aria-label={tx("choisi")} />}
      </span>
    </button>
  );
}

export function Appearance({ look }: Readonly<{ look: Look }>) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-bold"><Palette size={16} aria-hidden />{tx("Thème")}</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {THEME_CHOICES.map((t) => <ThemeCard key={t.id} {...t} on={look.theme === t.id} pick={() => look.setTheme(t.id)} />)}
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
        <h2 className="mb-1 flex items-center gap-2 font-bold"><PanelLeft size={16} aria-hidden />{tx("Menu replié")}</h2>
        <InfoNote className="mb-3">{tx("Quand le menu de gauche est réduit en icônes, ses sous-pages s'ouvrent dans un petit panneau à côté de l'icône.")}</InfoNote>
        <IconChoice label={tx("Menu replié")} value={useFlyout()} onPick={setFlyout} options={FLYOUT_OPTIONS} />
      </Card>
      <InfoNote>{tx("Retenus par ce navigateur seulement.")}</InfoNote>
    </div>
  );
}
