// « Découvertes » : ce que MyServices cherche tout seul, ce qui demande un clic, et ce qui reste à faire (GET /discoveries).
// Liste complète en haut de Réglages → Découverte ; rappel court sur l'accueil quand quelque chose est à faire.
import { Bell, Boxes, Check, ChevronRight, Hand, HardDrive, Network, Play, RefreshCw, Repeat, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { dateTime } from "../lib/format";
import { act, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { openConnector } from "../lib/connectorPrefill";
import type { Machine } from "../types";
import { MachineIcon } from "./MachineIcon";
import { NoteLine } from "./form";
import { Badge, Card, Dim } from "./ui";

export interface DiscoveryItem {
  id: string; title: string; mode: "auto" | "first" | "manual"; what: string; last: number | null; next: number | null;
  app?: string | null; machine?: { ip: string; name: string } | null;  // appli trouvée et machine visée : titre mis en forme
  state: "ok" | "todo" | "info"; note: string; action: { label: string; href?: string; run?: string; prefill?: { type: string; name: string; url: string } } | null;
}

export function useDiscoveries() {
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

/** Titre d'une découverte : logo du système de la machine, puis « **Appli** trouvé sur **Machine** (ip) » (gras : l'appli et la machine seulement) */
export function Title({ x, machines }: { x: DiscoveryItem; machines?: Machine[] }) {
  const m = x.machine, live = m && machines?.find((y) => y.ip === m.ip);
  const icon = live && <MachineIcon m={{ os: live.agent ? "windows" : undefined, osName: live.info?.os ?? live.agent?.os, info: live.info, ttl: live.ttl }} />;   // pas le nom ni le rôle : le logo est celui du système
  if (x.app && m) {
    return <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">{icon}<b>{x.app}</b>{tx("trouvé sur")}<b>{m.name || m.ip}</b>{m.name && m.ip && <span className="font-normal text-dim">({m.ip})</span>}</span>;
  }
  if (m) return <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">{icon}<b>{x.title}</b></span>;
  return <b>{x.title}</b>;
}

const when = (ts: number | null) => (ts ? dateTime(ts * 1000) : null);

function Action({ a, reload }: { a: NonNullable<DiscoveryItem["action"]>; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  if (a.prefill) return <button type="button" className={quiet} onClick={() => openConnector(a.prefill!)}><Settings2 size={13} aria-hidden />{a.label}<ChevronRight size={14} aria-hidden /></button>;   // le connecteur s'ouvre déjà rempli
  if (a.href) return <a href={a.href} className={`${quiet} no-underline`}>{a.label}<ChevronRight size={14} aria-hidden /></a>;
  return (
    <>
      <button type="button" className={quiet} onClick={() => void act(() => send("POST", `system/tasks/${a.run}/run`), tx("lancé"), setNote).then(() => reload())}><Play size={13} aria-hidden />{a.label}</button>
      <NoteLine note={note} />
    </>
  );
}

/** Familles de découvertes : rangées d'après l'identifiant (les entrées « ssh:ip », « agent:ip », « connector:… » ont un suffixe) */
const GROUPS: { id: string; title: string; Icon: typeof Boxes; has: (id: string) => boolean }[] = [
  { id: "network", title: tx("Réseau et machines"), Icon: Network, has: (id) => ["network", "redetect", "hosts"].includes(id) || id.startsWith("ssh:") || id.startsWith("agent:") },
  { id: "services", title: tx("Services et applis"), Icon: Boxes, has: (id) => ["services", "new", "connectors"].includes(id) || id.startsWith("connector:") },
  { id: "backups", title: tx("Sauvegardes"), Icon: HardDrive, has: (id) => id.startsWith("backups") || id === "cron" },
];
const groupOf = (x: DiscoveryItem) => GROUPS.find((g) => g.has(x.id)) ?? GROUPS[1];

/** Une découverte : titre, mode, ce qu'elle fait, dernière / prochaine fois, et son action */
function Item({ x, reload, machines }: { x: DiscoveryItem; reload: () => void; machines?: Machine[] }) {
  const m = MODE[x.mode];
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Title x={x} machines={machines} />
        <Badge tone={m.tone} title={m.hint}><m.Icon size={11} aria-hidden />{m.label}</Badge>
      </div>
      <p className="text-sm text-muted">{x.what}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-dim">
          {x.note && <span className={x.state === "todo" ? "text-warn" : ""}>{x.note}</span>}
          {when(x.last) ? <Badge tone="off">{tx("dernière fois")} {when(x.last)}</Badge> : x.mode !== "auto" && <Badge tone="warn">{tx("jamais lancée")}</Badge>}
          {when(x.next) && <Badge tone="info">{tx("prochaine")} {when(x.next)}</Badge>}
        </div>
        {x.action && <div className="flex flex-col items-start gap-1"><Action a={x.action} reload={reload} /></div>}
      </div>
    </li>
  );
}

/** Réglages → Découverte : d'abord ce qui est à faire (actions importantes), puis tout le reste rangé par famille */
export function DiscoveryCard({ machines }: { machines?: Machine[] }) {
  const [d, load] = useDiscoveries();
  if (!d) return null;
  const todo = d.items.filter((x) => x.state === "todo"), rest = d.items.filter((x) => x.state !== "todo");
  return (
    <div className="flex flex-col gap-4">
      <section className={`rounded-2xl border bg-card p-5 ${todo.length ? "border-warn/50" : "border-ok/40"}`} aria-label={tx("Actions importantes")}>
        <h2 className="mb-1 flex flex-wrap items-center gap-2 font-bold"><Bell size={16} aria-hidden />{tx("Actions importantes")} {todo.length > 0 && <Badge tone="warn">{tx("{0} à faire", todo.length)}</Badge>}</h2>
        {todo.length === 0 ? <p className="flex items-center gap-2 text-sm text-ok"><Check size={15} aria-hidden />{tx("Rien à faire : tout ce que MyServices a trouvé est en ordre.")}</p> : (
          <>
            <p className="mb-1 text-sm text-muted">{tx("Ces recherches ne se lancent pas toutes seules, ou demandent votre accord.")}</p>
            <ul className="flex flex-col divide-y divide-line/60">
              {todo.map((x) => { const G = groupOf(x); return (
                <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn" title={G.title}><G.Icon size={16} aria-hidden /></span>
                  <div className="min-w-[240px] flex-1">
                    <Title x={x} machines={machines} />
                    <p className="text-sm text-muted">{x.what}</p>
                    <p className="text-xs text-warn">{x.note}</p>
                  </div>
                  {x.action && <div className="flex flex-col items-start gap-1"><Action a={x.action} reload={load} /></div>}
                </li>
              ); })}
            </ul>
          </>
        )}
      </section>
      <div className="grid items-start gap-4 xl:grid-cols-3">
        {GROUPS.map((g) => {
          const items = rest.filter((x) => groupOf(x) === g);
          if (!items.length) return null;
          return (
            <Card key={g.id}>
              <h2 className="flex items-center gap-2 font-bold"><g.Icon size={16} aria-hidden />{g.title} <Dim>· {items.length}</Dim></h2>
              <ul className="mt-1 flex flex-col divide-y divide-line/60">{items.map((x) => <Item key={x.id} x={x} reload={load} machines={machines} />)}</ul>
            </Card>
          );
        })}
      </div>
    </div>
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
            {x.action?.prefill && <button type="button" onClick={() => openConnector(x.action!.prefill!)} className="inline-flex items-center gap-1 text-link hover:underline">{x.action.label}<ChevronRight size={14} aria-hidden /></button>}
            {x.action?.href && <a href={x.action.href} className="inline-flex items-center gap-1 text-link hover:underline">{x.action.label}<ChevronRight size={14} aria-hidden /></a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cloche de l'en-tête (admin) : nombre de choses à faire (connecteurs à configurer, recherches jamais lancées…) ; un clic ouvre la liste sur l'accueil */
export function DiscoveryBell() {
  const [d] = useDiscoveries();
  const n = d?.todo ?? 0;
  if (!n) return null;
  return (
    <a href="#home" className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-warn/50 bg-warn/10 text-warn hover:bg-warn/20"
      title={tx("{0} chose(s) à faire pour compléter la découverte", n)} aria-label={tx("{0} chose(s) à faire pour compléter la découverte", n)}>
      <Bell size={16} aria-hidden />
      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold leading-none text-bg">{n}</span>
    </a>
  );
}
