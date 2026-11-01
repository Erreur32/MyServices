// The words of the home page's title and sentence: they follow how serious the alerts are, and vary from one hour to the next. The sentence never
// repeats the figures shown under it: with alerts it says where they are, when all is calm it gives a fact of the network, or a quote now and then.
import type { Snapshot } from "../api";
import { hm } from "./format";
import { tx } from "./i18n";
import type { Attention, Category } from "./summary";

const pick = <T>(list: T[], seed: number): T => list[Math.abs(seed) % list.length];

const calmTitles = () => [tx("Tout va bien sur ton réseau."), tx("Rien à signaler, tu peux aller prendre un café."), tx("Réseau au calme, tout répond."), tx("Journée tranquille, aucune alerte en vue.")];
const geekTitles = () => ["All systems nominal.", "200 OK.", tx("Ping OK, pas de kernel panic en vue."), tx("0 warning, 0 error : ça compile du premier coup."), tx("Aucun incident, le chmod 777 n'a pas encore frappé.")];
const QUOTES = ["It's always DNS.", "There's no place like 127.0.0.1.", "Have you tried turning it off and on again?", "Talk is cheap. Show me the code. (Linus Torvalds)",
  "There are only two hard things in computer science: cache invalidation and naming things. (Phil Karlton)"];
const localQuotes = () => [tx("Il n'y a pas de cloud, juste l'ordinateur de quelqu'un d'autre."), tx("Une sauvegarde jamais restaurée n'est qu'un espoir.")];

/** One title in four is a geek one */
function calmTitle(seed: number): string {
  return seed % 4 === 0 ? pick(geekTitles(), seed / 4) : pick(calmTitles(), seed - Math.floor(seed / 4));   // minus the hours given to the geek ones: every title gets its turn
}

function seriousTitle(crit: number, rest: number, seed: number): string {
  if (crit === 1) return rest ? tx("**Un point grave**, et **{0}** à regarder ensuite.", rest) : pick([tx("**Un point grave** demande ton attention."), tx("**Une alerte sérieuse** à traiter en priorité.")], seed);
  return pick([tx("**{0} points graves** sur ton réseau.", crit), tx("Ça sent le roussi : **{0} points graves**.", crit)], seed);
}

function minorTitle(n: number, seed: number): string {
  if (n === 1) return pick([tx("**Un petit point** à regarder, rien d'urgent."), tx("Presque parfait, il reste **un point** à voir.")], seed);
  if (n > 5) return pick([tx("**{0} points** à regarder, ça s'accumule.", n), tx("**{0} points** en attente, un peu de ménage s'impose.", n)], seed);
  return pick([tx("**{0} points** à regarder, rien d'urgent.", n), tx("**{0} petites choses** à voir quand tu auras un moment.", n)], seed);
}

/** The title, from how many alerts there are and how serious */
export function storyTitle(items: Attention[], seed: number): string {
  const crit = items.filter((i) => i.level === "crit").length;
  if (crit) return seriousTitle(crit, items.length - crit, seed);
  return items.length ? minorTitle(items.length, seed) : calmTitle(seed);
}

const place = (c: Category): string => ({ machines: tx("les machines"), services: tx("les services"), sante: tx("la santé des machines"), dns: tx("le DNS"), sauvegardes: tx("les sauvegardes"), connecteurs: tx("les connecteurs") })[c];

/** Where the alerts are, the serious ones first */
export function alertPlaces(items: Attention[]): string {
  const ranked = [...items.filter((i) => i.level === "crit"), ...items.filter((i) => i.level !== "crit")];
  const places = [...new Set(ranked.map((i) => i.category))].map(place);
  if (places.length === 1) return tx("Tout se passe du côté de **{0}**.", places[0]);
  return tx("À commencer par **{0}**, puis **{1}**.", places[0], places.slice(1).join(", "));
}

const DAY_MS = 86_400_000, Y2038_MS = 2_147_483_647_000;

/** The latest archive found in any place of any set: the proof that a copy really ran, not that a set is « up to date » */
export function lastBackup(snap: Snapshot, now: number): string | null {
  let label = "", at = 0;
  for (const s of snap.backups?.sets ?? []) for (const l of s.locations) {
    const t = (l.newest?.mtime ?? 0) * 1000;
    if (t > at && t <= now) { at = t; label = s.label; }
  }
  if (!at) return null;
  const days = Math.floor((now - at) / DAY_MS);
  return days ? tx("Dernière sauvegarde : **{0}**, il y a **{1} jour(s)**.", label, days) : tx("Dernière sauvegarde : **{0}**, à **{1}**.", label, hm(at));
}

/** A day geeks know, or null: Patch Tuesday (second Tuesday of the month), Sysadmin Day (last Friday of July) */
export function specialDay(d: Date): string | null {
  const day = d.getDate();
  if (d.getMonth() === 6 && d.getDay() === 5 && day + 7 > 31) return tx("Bonne journée du **sysadmin** ! Aujourd'hui, c'est toi la vedette.");
  if (d.getDay() === 2 && day >= 8 && day <= 14) return tx("C'est **Patch Tuesday** : Windows va réclamer ses redémarrages.");
  return null;
}

/** The days left before 32-bit Unix time overflows, or nothing once it has */
function y2038(now: number): string[] {
  const days = Math.ceil((Y2038_MS - now) / DAY_MS);
  return days > 0 ? [tx("Plus que **{0} jours** avant le bug de l'an 2038.", days)] : [];
}

/** What is true of the network today and shown nowhere else on the page */
function facts(snap: Snapshot, now: number): string[] {
  const out: string[] = [];
  const up = snap.data.machine_list.map((m) => ({ name: m.name, s: m.agent?.uptime_s ?? m.info?.uptime_s ?? 0 })).reduce((a, b) => (b.s > a.s ? b : a), { name: "", s: 0 });
  const days = Math.floor(up.s / 86400);
  if (days > 0) out.push(tx("**{0}** tourne sans redémarrer depuis **{1} jours**.", up.name, days));
  const bans = (snap.data.security ?? []).reduce((n, c) => n + (c.bans_24h ?? 0), 0);
  if (bans) out.push(tx("Fail2ban a banni **{0} adresses** en 24 h.", bans));
  const disks = (snap.health?.hosts ?? []).flatMap((h) => (h.disks ?? []).map((d) => ({ name: h.name.split(" · ")[0], pct: d.used_pct, mount: d.mount })));
  const full = disks.reduce<(typeof disks)[number] | null>((a, b) => (a == null || b.pct > a.pct ? b : a), null);
  if (full) out.push(tx("Le disque le plus rempli est **{0}** sur **{1}**, à **{2} %**.", full.mount, full.name, full.pct));
  const copy = lastBackup(snap, now);
  if (copy) out.push(copy);
  return out;
}

/** A fact of the network, one time in three a quote, and every other hour the day's name when it has one. The seed counts hours: it gives the date too */
function calmLine(snap: Snapshot, seed: number): string {
  const now = seed * 3_600_000, special = specialDay(new Date(now)), list = facts(snap, now);
  if (special && seed % 2 === 0) return special;
  return list.length && seed % 3 !== 0 ? pick(list, Math.floor(seed / 3)) : pick([...QUOTES, ...localQuotes(), ...y2038(now)], seed);
}

export function storyText(snap: Snapshot, items: Attention[], seed: number): string {
  return items.length ? alertPlaces(items) : calmLine(snap, seed);
}
