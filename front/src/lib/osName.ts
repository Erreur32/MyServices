// Nom de système abrégé pour les colonnes : « Microsoft Windows 11 Professionnel » -> « Windows 11 Pro », « Debian GNU/Linux 13 (trixie) » -> « Debian 13 (trixie) ».
// Le nom complet reste dans l'info-bulle et le détail.
// \b ne voit pas « é » comme une lettre : bornes explicites
const word = (alt: string) => new RegExp(`(?<![\\p{L}])(?:${alt})(?![\\p{L}])`, "iu");
const EDITIONS: [RegExp, string][] = [
  [word("professionnel|professional"), "Pro"], [word("entreprise|enterprise"), "Enterprise"], [word("éducation|education"), "Education"],
  [word("familiale|famille|home"), "Home"],
];

export function shortOs(name?: string | null): string {
  let s = (name || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (/windows/i.test(s)) {
    s = s.replace(/^microsoft\s+/i, "").replace(new RegExp(word("édition|edition").source, "giu"), "").replace(/\s+/g, " ").trim();
    if (/windows server/i.test(s)) return s.replace(/\s+(standard|datacenter|essentials)\b.*$/i, "").trim();
    const rel = /\b(\d{2}H[12]|20H2|2004)\s*$/i.exec(s)?.[1];   // version de fonctionnalités (23H2) : seul morceau utile après l'édition
    for (const [rx, abbr] of EDITIONS) {
      const m = rx.exec(s);
      if (m) return `${s.slice(0, m.index).trim()} ${abbr}${rel ? ` ${rel}` : ""}`;  // tout ce qui suit l'édition est du bruit (« Professionnel N », mois de version…)
    }
    return s;
  }
  return s
    .replace(/^Red Hat Enterprise Linux\b/i, "RHEL")
    .replace(/\bGNU\/Linux\b/i, "")
    .replace(/^(Fedora|Rocky|AlmaLinux|CentOS(?: Stream)?) Linux\b/i, "$1")
    .replace(/\s*\((?:Workstation|Server|Cloud|Container)[^)]*Edition\)/i, "")
    .replace(/\s+/g, " ").trim();
}
