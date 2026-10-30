// Texts written by the server (error answers, connector messages, event labels) are French. In English they are looked up in server-text.json:
// the fixed sentences exactly, the families that only change a name through a pattern. A text not found (one built with a value in it) stays as it is.
import table from "./server-text.json";
import { LANG } from "./i18n";
import type { ConnectorType } from "../types";

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

interface ServerRow { message?: string; facts?: { label: string; value: string }[]; problems?: string[] }

/** The `message`, the figures and the problems of each item of a list read from the server, translated (connector rows keep everything else) */
export function withServerMessages<T extends ServerRow>(rows: T[] | undefined, lang?: string): T[] | undefined {
  return rows?.map((r) => ({
    ...r,
    ...(typeof r.message === "string" && { message: serverText(r.message, lang) }),
    ...(r.facts && { facts: r.facts.map((f) => ({ ...f, label: serverText(f.label, lang), value: serverText(f.value, lang) })) }),
    ...(r.problems && { problems: r.problems.map((x) => serverText(x, lang)) }),
  }));
}

/** The forms of the connectors as the server describes them, translated: labels, help, guide and modes; the values of a choice stay as they are */
export function translateConnectorTypes<T extends { types: ConnectorType[] }>(state: T, lang?: string): T {
  if ((lang ?? LANG) === "fr") return state;
  const t = (s: string) => serverText(s, lang);
  return { ...state, types: state.types.map((c) => ({
    ...c, label: t(c.label), guide: c.guide?.map(t),
    fields: c.fields.map((f) => ({ ...f, label: t(f.label), help: t(f.help) })),
    modes: c.modes?.map((m) => ({ ...m, label: t(m.label), help: t(m.help) })),
  })) };
}

/** Every connector list of data.json (an array of rows that carry a `message`) with its messages translated; French is returned as it is */
export function translateConnectorMessages<T extends object>(data: T, lang?: string): T {
  if ((lang ?? LANG) === "fr") return data;
  const out = { ...data } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v) && v.some((r) => typeof r?.message === "string")) out[k] = withServerMessages(v, lang);
  }
  return out as T;
}

/** The event labels sent by the server, translated */
export function translateLabels(labels: Record<string, string>, lang?: string): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, serverText(v, lang)]));
}
