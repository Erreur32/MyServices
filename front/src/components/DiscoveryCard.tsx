// « Découvertes » : ce que MyServices cherche tout seul, ce qui demande un clic, et ce qui reste à faire (GET /discoveries).
// Liste complète en haut de Réglages → Découverte ; rappel court sur l'accueil quand quelque chose est à faire.
import { ChevronRight, Hand, Play, RefreshCw, Repeat } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { dateTime } from "../lib/format";
import { act, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { NoteLine } from "./form";
import { Badge, Card, Dim } from "./ui";

export interface DiscoveryItem {
  id: string; title: string; mode: "auto" | "first" | "manual"; what: string; last: number | null; next: number | null;
  state: "ok" | "todo" | "info"; note: string; action: { label: string; href?: string; run?: string } | null;
}

function useDiscoveries() {
  const [d, setD] = useState<{ items: DiscoveryItem[]; todo: number } | null>(null);
  const load = useCallback(() => { read<{ items: DiscoveryItem[]; todo: number }>("discoveries").then(setD).catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); }); }, []);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);
  return [d, load] as const;
}

const MODE: Record<DiscoveryItem["mode"], { label: string; hint: string; tone: "ok" | "warn" | "info"; Icon: typeof Repeat }> = {
  auto: { label: tx("Automatique"), hint: tx("Se fait tout seul, rien à faire"), tone: "ok", Icon: RefreshCw },
  first: { label: tx("Une fois, puis automatique"), hint: tx("À lancer une première fois ; ensuite MyServices s'en occupe"), tone: "info", Icon: Repeat },
  manual: { label: tx("À la main"), hint: tx("Ne se fait jamais tout seul : à lancer quand c'est utile"), tone: "warn", Icon: Hand },
};

const when = (ts: number | null) => (ts ? dateTime(ts * 1000) : null);

function Action({ a, reload }: { a: NonNullable<DiscoveryItem["action"]>; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  if (a.href) return <a href={a.href} className={`${quiet} no-underline`}>{a.label}<ChevronRight size={14} aria-hidden /></a>;
  return (
    <>
      <button type="button" className={quiet} onClick={() => void act(() => send("POST", `system/tasks/${a.run}/run`), tx("lancé"), setNote).then(() => reload())}><Play size={13} aria-hidden />{a.label}</button>
      <NoteLine note={note} />
    </>
  );
}

export function DiscoveryCard() {
  const [d, load] = useDiscoveries();
  if (!d) return null;
  return (
    <Card>
      <h2 className="mb-1 font-bold">{tx("Découvertes : qui fait quoi")} {d.todo > 0 && <Badge tone="warn">{tx("{0} à faire", d.todo)}</Badge>}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Ce que MyServices cherche tout seul, ce qui attend un clic de votre part, et quand cela a été fait pour la dernière fois.")}</p>
      <ul className="flex flex-col divide-y divide-line/60">
        {d.items.map((x) => {
          const m = MODE[x.mode];
          return (
            <li key={x.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-3">
              <div className="min-w-[260px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{x.title}</b>
                  <Badge tone={m.tone} title={m.hint}><m.Icon size={11} aria-hidden />{m.label}</Badge>
                  {x.state === "todo" && <Badge tone="warn">{tx("à faire")}</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted">{x.what}</p>
                <p className="mt-0.5 text-xs text-dim">
                  {x.note && <span className={x.state === "todo" ? "text-warn" : ""}>{x.note} · </span>}
                  {when(x.last) ? <>{tx("dernière fois")} {when(x.last)}</> : x.mode === "auto" ? null : <Dim>{tx("jamais lancée")}</Dim>}
                  {when(x.next) && <> · {tx("prochaine")} {when(x.next)}</>}
                </p>
              </div>
              {x.action && <div className="flex flex-col items-start gap-1"><Action a={x.action} reload={load} /></div>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Accueil : seulement ce qui est à faire (rien d'affiché quand tout est en ordre) */
export function DiscoveryReminder() {
  const [d] = useDiscoveries();
  const todo = d?.items.filter((x) => x.state === "todo") ?? [];
  if (!todo.length) return null;
  return (
    <section className="rounded-2xl border border-warn/40 bg-card p-5" aria-label={tx("Découvertes à faire")}>
      <h2 className="mb-1 text-base font-bold">{tx("À faire pour compléter la découverte")}</h2>
      <p className="mb-2 text-sm text-muted">{tx("Ces recherches ne se lancent pas toutes seules.")} <a className="text-link hover:underline" href="#settings/network">{tx("Tout voir")}</a></p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {todo.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1"><b>{x.title}</b> <span className="text-dim">· {x.note || MODE[x.mode].label}</span></span>
            {x.action?.href && <a href={x.action.href} className="inline-flex items-center gap-1 text-link hover:underline">{x.action.label}<ChevronRight size={14} aria-hidden /></a>}
          </li>
        ))}
      </ul>
    </section>
  );
}
