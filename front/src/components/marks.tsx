// Repères visuels des pastilles de filtre : un point de couleur (état), un logo (système, appli) ou un carré de la couleur d'une famille.
import type { Tone } from "../lib/level";

const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", off: "bg-dim", info: "bg-link" };

export const Dot = ({ tone }: { tone: Tone }) => <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />;
/** Carré de la couleur d'une famille (classe Tailwind bg-…) */
export const Square = ({ cls }: { cls: string }) => <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-sm ${cls}`} />;
export const Logo = ({ src }: { src: string }) => <img src={src} alt="" className="h-3.5 w-3.5 shrink-0" />;
