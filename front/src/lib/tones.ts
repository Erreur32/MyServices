/** Teinte de chaque rubrique d'un détail déplié (Machines, Services) : un liseré gauche et un titre colorés, sans fond teinté (la bande de titre et la colonne
 *  des libellés sont du ton le plus sombre du thème, les valeurs gardent la couleur de la carte). La couleur repère la catégorie ; elle ne remplit pas la rubrique.
 *  Classes écrites en entier pour Tailwind. */
const BOX = "[&_dt]:bg-bg";   // the label column (left) is the darkest tone of the theme, the values (right) keep the card colour
const HEAD = "bg-bg";
export const TONES = {
  link: { box: `border-l-link/70 ${BOX}`, head: `${HEAD} text-link`, icon: "text-link" },
  violet: { box: `border-l-violet-400/70 ${BOX}`, head: `${HEAD} text-violet-400`, icon: "text-violet-400" },
  ok: { box: `border-l-ok/70 ${BOX}`, head: `${HEAD} text-ok`, icon: "text-ok" },
  warn: { box: `border-l-warn/70 ${BOX}`, head: `${HEAD} text-warn`, icon: "text-warn" },
  bad: { box: `border-l-bad/70 ${BOX}`, head: `${HEAD} text-bad`, icon: "text-bad" },
} as const;
