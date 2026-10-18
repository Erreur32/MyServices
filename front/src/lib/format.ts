// Mise en forme commune (dates, tailles, durées), dans la langue de la page.

import { LANG, LOCALE, tx } from "./i18n";

export function bytes(n: number | null | undefined): string {
  if (n == null) return "?";
  const u = LANG === "fr" ? ["o", "Ko", "Mo", "Go", "To"] : ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  const v = n.toFixed(n >= 10 || i === 0 ? 0 : 1);
  return `${LANG === "fr" ? v.replace(".", ",") : v} ${u[i]}`;
}

/** Durée en secondes -> « 3 j 4 h » */
/** Network speed in bits per second, decimal units, like the Freebox and MynetworK show it: « 0 b/s », « 850 kb/s », « 1,2 Mb/s ». */
export function rate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null) return "?";
  const bits = bytesPerSec * 8;
  if (bits <= 0) return "0 b/s";
  const u = ["b/s", "kb/s", "Mb/s", "Gb/s"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bits) / Math.log(1000)));
  const v = bits / 1000 ** i, txt = v.toFixed(v < 10 && i > 0 ? 1 : 0);
  return `${LANG === "fr" ? txt.replace(".", ",") : txt} ${u[i]}`;
}

export function dur(sec: number | null | undefined): string {
  if (sec == null) return "-";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return d ? tx("{0} j {1} h", d, h) : tx("{0} h", h);
}

/** Uptime in a few characters for a table cell: « 12j 4h », « 4h 20m », « 12m » */
export function durShort(sec: number | null | undefined): string {
  if (sec == null) return "-";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return tx("{0}j {1}h", d, h);
  return h ? tx("{0}h {1}m", h, m) : tx("{0}m", m);
}

/** Âge en jours -> « 5 h » ou « 3 j » */
export function ageDays(a: number | null | undefined): string {
  if (a == null) return "-";
  return a < 1 ? tx("{0} h", Math.max(1, Math.round(a * 24))) : tx("{0} j", Math.round(a));
}

export function hm(d: Date | number): string {
  return new Date(d).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(d: Date | number | string): string {
  return new Date(d).toLocaleString(LOCALE, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function longDay(d: Date | number): string {
  return new Date(d).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Clé de jour locale « 2026-10-10 » (même découpage que l'API per-day, heure locale). */
export function dayKey(d: Date | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export function ipNum(ip: string): number {
  return ip.split(".").map(Number).reduce((x, n) => x * 256 + (n || 0), 0);
}

/** Minuscules sans accents, pour la recherche. */
export function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Nom d'une machine de la santé, « Dev · Hermes · 192.168.1.20 » -> [« Dev · Hermes », « 192.168.1.20 »]
 *  (l'IP est après le dernier « · », le nom peut en contenir). */
export function splitHostName(name: string): [string, string] {
  const i = name.lastIndexOf(" · ");
  return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 3)];
}

/** Version shown in the header: « v0.9.2 » for a release image (« v0.9.2-<commit> »); for a branch image « v0.10.1+ · main abc1234 » when the last
 *  release of its changelog is known (« + » = built from the branch after that release), else « main · abc1234 »; « dev » otherwise. */
export function appVersion(v?: string, released?: string | null): string {
  if (!v) return "";
  const tag = /^(v\d+\.\d+\.\d+(?:-[A-Za-z]+\.\d+)?)-[0-9a-f]{7,40}$/.exec(v);
  if (tag) return tag[1];
  const branch = /^(.+)-([0-9a-f]{7,40})$/.exec(v);
  if (!branch) return v;
  const where = `${branch[1]} · ${branch[2].slice(0, 7)}`;
  return released ? `v${released}+ · ${where}` : where;
}
