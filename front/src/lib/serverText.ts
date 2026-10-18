// Texts written by the server (error answers, connector messages, event labels) are French. In English they are looked up in server-text.json:
// the fixed sentences exactly, the families that only change a name through a pattern. A text not found (one built with a value in it) stays as it is.
import table from "./server-text.json";
import { LANG } from "./i18n";

const EXACT: Record<string, string> = table.exact;
const PATTERNS: [RegExp, string][] = table.templates.map(([re, out]) => [new RegExp(re), out]);

export function serverText(fr: string, lang: string = LANG): string {
  if (lang === "fr") return fr;
  const hit = EXACT[fr];
  if (hit) return hit;
  for (const [re, out] of PATTERNS) {
    if (re.test(fr)) return fr.replace(re, out);
  }
  return fr;
}

/** The `message` of each item of a list read from the server, translated (connector rows keep everything else) */
export function withServerMessages<T extends { message?: string }>(rows: T[] | undefined, lang?: string): T[] | undefined {
  return rows?.map((r) => (typeof r.message === "string" ? { ...r, message: serverText(r.message, lang) } : r));
}
