// Badges next to a page title (Network, DNS, Security, Backups, Services): counts in blue, the tools read in green, the rest in grey,
// then the time of the reading.
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { Badge } from "./ui";

type Tag = string | { text: string; title?: string };
const text = (t: Tag) => (typeof t === "string" ? t : t.text);

export function HeadTags({ counts = [], sources = [], others = [], at, max }: Readonly<{ counts?: Tag[]; sources?: Tag[]; others?: Tag[]; at: string | number; max?: number }>) {
  // max: on a crowded head, only the first tags of a row show and a « +n » badge carries the others in its tooltip (keeps the head on one line)
  const row = (all: Tag[], tone: "info" | "ok" | "off", cap = max) => {
    const tags = all.filter((t) => !!text(t)), shown = cap != null && tags.length > cap ? tags.slice(0, cap) : tags, rest = tags.slice(shown.length);
    return [...shown.map((t) => (
      <Badge key={`${tone}-${text(t)}`} tone={tone} outline title={typeof t === "string" ? undefined : t.title}>{text(t)}</Badge>
    )), ...(rest.length ? [<Badge key={`${tone}-more`} tone={tone} outline title={rest.map(text).join(", ")}>+{rest.length}</Badge>] : [])];
  };
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      {row(counts, "info")}
      {row(others, "off")}
      {row(sources, "ok")}
      <Badge tone="off" outline>{tx("relevé du {0}", dateTime(at))}</Badge>
    </span>
  );
}
