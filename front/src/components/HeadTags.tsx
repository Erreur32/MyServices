// Badges next to a page title (Network, DNS, Security, Backups, Services): counts in blue, the tools read in green, the rest in grey,
// then the time of the reading and « read only ».
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { Badge } from "./ui";

type Tag = string | { text: string; title?: string };
const text = (t: Tag) => (typeof t === "string" ? t : t.text);

export function HeadTags({ counts = [], sources = [], others = [], at }: Readonly<{ counts?: Tag[]; sources?: Tag[]; others?: Tag[]; at: string | number }>) {
  const row = (tags: Tag[], tone: "info" | "ok" | "off") => tags.filter((t) => !!text(t)).map((t) => (
    <Badge key={`${tone}-${text(t)}`} tone={tone} outline title={typeof t === "string" ? undefined : t.title}>{text(t)}</Badge>
  ));
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      {row(counts, "info")}
      {row(others, "off")}
      {row(sources, "ok")}
      <Badge tone="off" outline>{tx("relevé du {0}", dateTime(at))}</Badge>
      <Badge tone="off" outline>{tx("lecture seule")}</Badge>
    </span>
  );
}
