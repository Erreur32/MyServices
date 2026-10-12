/** Teinte de chaque rubrique d'un détail déplié (Machines, Services) : bande de titre, liseré gauche, fond léger et fond de la colonne des libellés (classes écrites en entier pour Tailwind) */
export const TONES = {
  link: { box: "border-l-link bg-link/[0.06] [&_dt]:bg-link/15", head: "bg-link/15 text-link" },
  violet: { box: "border-l-violet-400 bg-violet-400/[0.06] [&_dt]:bg-violet-400/15", head: "bg-violet-400/15 text-violet-400" },
  ok: { box: "border-l-ok bg-ok/[0.06] [&_dt]:bg-ok/15", head: "bg-ok/15 text-ok" },
  warn: { box: "border-l-warn bg-warn/[0.06] [&_dt]:bg-warn/15", head: "bg-warn/15 text-warn" },
  bad: { box: "border-l-bad bg-bad/[0.06] [&_dt]:bg-bad/15", head: "bg-bad/15 text-bad" },
} as const;
