// « Découvertes » : ce que MyServices cherche tout seul, ce qui demande un clic, et ce qui reste à faire (GET /discoveries).
// Liste complète en haut de Réglages → Découverte ; rappel court sur l'accueil quand quelque chose est à faire.
import { Bell, BellOff, Boxes, Check, ChevronRight, Hand, HardDrive, Network, Play, RefreshCw, Repeat, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { dateTime } from "../lib/format";
import { act, button, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { openConnector } from "../lib/connectorPrefill";
import type { Machine } from "../types";
import { MachineIcon } from "./MachineIcon";
import { FOLD, FOLD_HEAD } from "./NetworkStep";
import { NoteLine } from "./form";
import { Badge } from "./ui";

export interface DiscoveryItem {
  id: string; title: string; mode: "auto" | "first" | "manual"; what: string; last: number | null; next: number | null;
  app?: string | null; machine?: { ip: string; name: string } | null;  // appli trouvée et machine visée : titre mis en forme
  mutable?: boolean; muted?: boolean;  // rappel qu'on peut couper (et rétablir) ; coupé
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

/** Couper le rappel d'une découverte (plus de cloche ni de rappel sur l'accueil) ou le rétablir ; elle reste listée dans Réglages → Découverte */
function MuteButton({ x, reload }: { x: DiscoveryItem; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  if (!x.mutable) return null;
  const mute = !x.muted;
  return (
    <>
      <button type="button" className={`${button} border-line bg-bg2 text-txt hover:border-link`} onClick={() => void act(() => send("PUT", "discoveries/muted", { id: x.id, muted: mute }), mute ? tx("rappel coupé : il reste listé ici") : tx("rappel rétabli"), setNote).then(() => reload())}
        title={mute ? tx("Ne plus compter cette découverte dans la cloche ni sur l'accueil ; elle reste ici, vous pouvez la réafficher") : undefined}>
        {mute ? <BellOff size={13} aria-hidden /> : <Bell size={13} aria-hidden />}{mute ? tx("Ne plus me le rappeler") : tx("Réafficher le rappel")}
      </button>
      <NoteLine note={note} />
    </>
  );
}

function Action({ a, reload }: { a: NonNullable<DiscoveryItem["action"]>; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  if (a.prefill) return <button type="button" className={primary} onClick={() => openConnector(a.prefill!)}><Settings2 size={13} aria-hidden />{a.label}<ChevronRight size={14} aria-hidden /></button>;   // le connecteur s'ouvre déjà rempli
  if (a.href) return <a href={a.href} className={`${primary} no-underline`}>{a.label}<ChevronRight size={14} aria-hidden /></a>;
  return (
    <>
      <button type="button" className={primary} onClick={() => void act(() => send("POST", `system/tasks/${a.run}/run`), tx("lancé"), setNote).then(() => reload())}><Play size={13} aria-hidden />{a.label}</button>
      <NoteLine note={note} />
    </>
  );
}

/** Familles de découvertes : rangées d'après l'identifiant (les entrées « ssh:ip », « agent:ip », « connector:… » ont un suffixe) */
export const GROUPS: { id: string; title: string; Icon: typeof Boxes; has: (id: string) => boolean }[] = [
  { id: "network", title: tx("Réseau et machines"), Icon: Network, has: (id) => ["network", "redetect", "hosts"].includes(id) || id.startsWith("ssh:") || id.startsWith("agent:") },
  { id: "services", title: tx("Services et applis"), Icon: Boxes, has: (id) => ["services", "new", "connectors"].includes(id) || id.startsWith("connector:") },
  { id: "backups", title: tx("Sauvegardes"), Icon: HardDrive, has: (id) => id.startsWith("backups") || id === "cron" },
];
export const groupOf = (x: DiscoveryItem) => GROUPS.find((g) => g.has(x.id)) ?? GROUPS[1];

/** Une découverte en carte : titre, mode, ce qu'elle fait, dernière / prochaine fois, puis ses boutons */
function Item({ x, reload, machines, extra }: { x: DiscoveryItem; reload: () => void; machines?: Machine[]; extra?: (onCount: (n: number) => void) => ReactNode }) {
  const [picked, setPicked] = useState(0);   // machines cochées dans la liste repliée : montré sur l'en-tête du cadre
  const m = MODE[x.mode], todo = x.state === "todo";
  const wanted = () => location.hash.split("/")[2] === x.id;   // lien #settings/network/hosts : le cadre s'ouvre
  const [open, setOpen] = useState(wanted);
  useEffect(() => {
    const on = () => { if (wanted()) setOpen(true); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [x.id]);
  return (
    <li id={`net-${x.id}`} className={`scroll-mt-20 flex flex-col gap-2 rounded-xl border bg-card p-4 ${extra ? "lg:col-span-2 " : ""}${todo ? "border-warn/50" : x.muted ? "border-line/60 opacity-75" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${todo ? "bg-warn/15 text-warn" : "bg-bg2 text-muted"}`} title={m.hint}><m.Icon size={15} aria-hidden /></span>
        <div className="min-w-0 flex-1"><Title x={x} machines={machines} /></div>
        <Badge tone={todo ? "warn" : m.tone} title={m.hint}>{todo ? tx("à faire") : m.label}</Badge>
      </div>
      <p className="text-sm text-muted">{x.what}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {x.muted ? <Badge tone="off">{tx("rappel coupé")}</Badge> : x.note && <span className={todo ? "text-warn" : "text-dim"}>{x.note}</span>}
        {when(x.last) ? <Badge tone="off">{tx("dernière fois")} {when(x.last)}</Badge> : x.mode !== "auto" && <Badge tone="warn">{tx("jamais lancée")}</Badge>}
        {when(x.next) && <Badge tone="info">{tx("prochaine")} {when(x.next)}</Badge>}
      </div>
      {extra && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
          <summary className={FOLD_HEAD}><ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />{tx("Voir et choisir les machines trouvées")}{picked > 0 && <Badge tone="info">{tx("{0} cochée(s)", picked)}</Badge>}</summary>
          <div className="flex flex-col gap-3">{extra(setPicked)}</div>
        </details>
      )}
      {((x.action && !extra) || x.mutable) && <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2.5">{x.action && !extra && <Action a={x.action} reload={reload} />}<MuteButton x={x} reload={reload} /></div>}
    </li>
  );
}

export type DiscoveryData = { items: DiscoveryItem[]; todo: number };
export const todoOf = (d: DiscoveryData | null, g: (typeof GROUPS)[number]) => (d?.items ?? []).filter((x) => x.state === "todo" && groupOf(x) === g).length;

/** Les découvertes d'une famille : ce qui est à faire d'abord, puis le reste, en cartes */
export function DiscoveryPanel({ d, group, reload, machines, extra }: { d: DiscoveryData | null; group: (typeof GROUPS)[number]; reload: () => void; machines?: Machine[]; extra?: (x: DiscoveryItem, onCount: (n: number) => void) => ReactNode }) {
  if (!d) return null;
  const items = d.items.filter((x) => groupOf(x) === group).sort((a, b) => Number(b.state === "todo") - Number(a.state === "todo"));
  const todo = items.filter((x) => x.state === "todo").length;
  return (
    <section aria-label={group.title} className="flex flex-col gap-3">
      <p className={`flex items-center gap-2 text-sm ${todo ? "text-warn" : "text-ok"}`}>
        {todo ? <><Bell size={15} aria-hidden />{tx("{0} à faire dans cette famille", todo)}</> : <><Check size={15} aria-hidden />{tx("Rien à faire ici : tout est en ordre.")}</>}
      </p>
      <ul className="grid items-stretch gap-3 lg:grid-cols-2">{items.map((x) => <Item key={x.id} x={x} reload={reload} machines={machines} extra={extra && extra(x, () => undefined) !== null ? (onCount) => extra(x, onCount) : undefined} />)}</ul>
    </section>
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
