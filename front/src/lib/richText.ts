// Light markup of the home lines, drawn by components/Rich: [[m:name]] or [[m:name|address]] a machine badge, [[since:text]] how long it lasts,
// in grey, and a line break between two causes. plainText gives the same words for a tooltip.
const clean = (s: string) => s.replaceAll(/[[\]|]/g, "");

export const machineTag = (name: string, href?: string) => `[[m:${clean(name)}${href ? `|${href}` : ""}]]`;
export const sinceTag = (text: string) => `[[since:${clean(text)}]]`;

/** The text without its markup: the badge becomes its name, the duration follows after a comma, causes are joined by commas */
export const plainText = (text: string) =>
  text.replaceAll(/\[\[m:([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1").replaceAll(/\s*\[\[since:([^\]]+)\]\]/g, ", $1").replaceAll("\n", ", ").replaceAll("**", "");
