// The head of a list page, the same on every page: the title with its icon, the tags (counts, sources, read time) on the same line,
// and at the far right the actions of the page (period of the history, link to the settings, buttons; the main button last).
// The line wraps by itself when the width is short.
import { Plug, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { tx } from "../lib/i18n";

export function PageHead({ icon: Icon, title, tags, actions }: Readonly<{ icon: LucideIcon; title: string; tags: ReactNode; actions?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="flex items-center gap-2 text-xl font-bold"><Icon size={18} aria-hidden />{title}</h1>
      {tags}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The icon link to the connectors, on a page that reads its data through them (admins only) */
export function ConnectorsLink() {
  return <a href="#settings/connectors" className="inline-flex items-center rounded-lg border border-line p-1.5 text-link hover:bg-link/10" title={tx("Connecteurs")} aria-label={tx("Connecteurs")}><Plug size={14} aria-hidden /></a>;
}
