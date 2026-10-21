// Action line of a tooltip: what a click on the element itself does (never on the bubble, which follows the mouse and cannot be clicked).
// Written as the last line of a `title`; the tooltip layer draws it as a strip at the bottom with a mouse icon.

/** The last line of a tip that says what a click does */
export const tipAction = (text: string): string => `[[act:${text}]]`;

/** A tip split into its text and its action line (if its last line is one) */
export function splitAction(tip: string): [string, string | undefined] {
  const i = tip.lastIndexOf("\n"), last = tip.slice(i + 1), m = /^\[\[act:(.+)\]\]$/.exec(last);
  return m ? [i < 0 ? "" : tip.slice(0, i).replace(/\n+$/, ""), m[1]] : [tip, undefined];
}
