// The pieces the pages of one family of services share (« IA et agents », « Vidéo et caméras »): the « À surveiller » panel, one card per
// service, and the button that opens the connector a service needs, already filled.
import { Eye, Plug, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { appIcon } from "../lib/appIcons";
import { openConnector, type Prefill } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";
import type { ServiceCard, WatchLine } from "../lib/serviceCards";
import { Dot, Logo } from "./marks";
import { FoldPanel } from "./FoldPanel";
import { Badge, Dim } from "./ui";

/** Opens Connectors on the form of the connector this service needs, already filled with its address */
export function AddConnector({ prefill }: Readonly<{ prefill: Prefill }>) {
  return (
    <button type="button" onClick={() => openConnector(prefill)} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
      <Plug size={13} aria-hidden />{tx("Ajouter un connecteur")} ›
    </button>
  );
}

export function WatchPanel({ id, lines, admin }: Readonly<{ id: string; lines: WatchLine[]; admin: boolean }>) {
  if (!lines.length) return null;
  return (
    <FoldPanel id={id} icon={Eye} title={tx("À surveiller")} count={lines.length} tone={lines.some((a) => a.tone === "bad") ? "bad" : "warn"}>
      <ul className="flex flex-col [&>li:nth-child(even)]:bg-bg/50">
        {lines.map((a) => (
          <li key={a.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2">
            <Dot tone={a.tone} />
            <span className="min-w-0 flex-1"><b className="block font-semibold">{a.title}</b>{a.detail && <span className="text-sm text-muted">{a.detail}</span>}</span>
            {a.prefill && admin && <AddConnector prefill={a.prefill} />}
            {a.hash && <a href={a.hash} className="text-sm text-link hover:underline">{tx("Voir")} ›</a>}
          </li>
        ))}
      </ul>
    </FoldPanel>
  );
}

/** One service: its state, its figures (only what was read), the way to its Services page, and what else it leads to (`links`) */
export function FamilyCard<R extends string>({ c, role, facts, links, icon: Fallback, admin }: Readonly<{
  c: ServiceCard<R>; role: string; facts: [string, string][]; links?: ReactNode; icon: LucideIcon; admin: boolean;
}>) {
  const icon = appIcon([c.title, c.engine ?? "", c.conn?.label ?? ""]);
  return (
    <article className={`flex h-56 min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ${c.unread ? "border-dashed border-line" : "border-line"}`}>
      <div className="flex items-center gap-2 border-b border-line/60 bg-bg px-4 py-2.5">
        <Dot tone={c.tone} />
        {icon ? <Logo src={icon} /> : <Fallback size={14} className="text-muted" aria-hidden />}
        <h2 className="min-w-0 truncate font-bold" title={c.title}>{c.title}</h2>
        <Badge tone="off" outline>{role}</Badge>
        <span className="ml-auto truncate text-xs text-dim" title={c.state}>{c.state}</span>
      </div>
      <dl className="grid flex-1 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-4 gap-y-1 px-4 py-3 text-sm">
        {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="truncate tabular-nums" title={v}>{v}</dd></div>)}
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 px-4 py-2 text-sm">
        {c.serviceHash && <a href={c.serviceHash} className="text-link hover:underline">{tx("Fiche du service")} ›</a>}
        {c.prefill && admin && <AddConnector prefill={c.prefill} />}
        {c.unread && !c.connector && <Dim>{tx("pas de connecteur pour cette appli")}</Dim>}
        {links}
      </div>
    </article>
  );
}
