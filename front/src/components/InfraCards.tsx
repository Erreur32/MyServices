// Shared parts of the connector cards: their header and the backup server card.
import { HardDrive } from "lucide-react";
import type { VirtualizationConnector } from "../types";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { Badge, Dim, Fill } from "./ui";


/** Shared header of every card of the grid: logo, name and address, what kind of thing it is, and its state. */
export function CardHead({ c, icon, kind }: Readonly<{ c: { label: string; url?: string | null; ok: boolean; version?: string | null; stale: boolean }; icon: React.ReactNode; kind: string }>) {
  const img = appIcon([c.label]);
  return (
    <>
      <header className={`flex items-center gap-3 border-b border-line/60 px-4 py-3 ${c.ok ? "bg-bg" : "bg-bad/10"}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2">{img ? <img src={img} alt="" className="h-6 w-6" /> : icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold leading-tight">{c.label}</h3>
          <span className="block text-xs font-semibold uppercase tracking-wider text-dim">{kind}</span>
          {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-xs text-dim hover:text-link hover:underline">{c.url}</a>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>
          {c.version && <span className="font-mono text-xs text-dim">{c.version}</span>}
        </div>
      </header>
      {c.stale && <p className="mx-4 mt-2 text-xs text-warn">{tx("relevé périmé : dernier état connu")}</p>}
    </>
  );
}

export function PbsCard({ c }: Readonly<{ c: VirtualizationConnector }>) {
  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-card pb-3 shadow-sm ${c.ok ? "border-line" : "border-bad/40"}`}>
      <CardHead c={c} kind={tx("Sauvegardes")} icon={<HardDrive size={20} className="text-muted" aria-hidden />} />
      {!c.ok && !c.stale ? <p className="mx-4 mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <ul className="mt-3 flex flex-col gap-2 px-4 text-sm">
          {(c.datastores ?? []).map((d) => (
            <li key={d.name}>
              <div className="flex flex-wrap items-center gap-2"><b>{d.name}</b><Dim>{d.groups} {tx("groupes de sauvegarde")}</Dim>
                {d.age_h != null && <Badge tone={d.age_h > 48 ? "warn" : "ok"}>{tx("dernière")} {d.age_h < 48 ? `${Math.round(d.age_h)} h` : `${Math.round(d.age_h / 24)} ${tx("j")}`}</Badge>}</div>
              {d.used_pct != null && <div className="mt-1 text-xs"><div className="flex justify-between text-muted"><span>{tx("Espace utilisé")}</span><span>{d.used_pct} %</span></div><Fill pct={d.used_pct} /></div>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
