// « Découvertes » : ce que MyServices cherche tout seul, ce qui demande un clic, et ce qui reste à faire (GET /discoveries).
// Liste complète en haut de Réglages → Découverte ; rappel court sur l'accueil quand quelque chose est à faire.
import { Bell, Boxes, Check, ChevronRight, EyeOff, Hand, HardDrive, Lightbulb, Network, Play, RefreshCw, Repeat, RotateCcw, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { dateTime } from "../lib/format";
import { act, button, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { openConnector } from "../lib/connectorPrefill";
import { pokeScan } from "../lib/scan";
import type { Machine } from "../types";
import { MachineIcon } from "./MachineIcon";
import { FOLD, FOLD_HEAD, FOLD_WARN } from "./NetworkStep";
import { NoteLine } from "./form";
import { Badge } from "./ui";

export interface DiscoveryItem {
  id: string; title: string; mode: "auto" | "first" | "manual"; what: string; last: number | null; next: number | null;
  app?: string | null; machine?: { ip: string; name: string } | null;  // appli trouvée et machine visée : titre mis en forme
  mutable?: boolean; muted?: boolean;  // rappel qu'on peut couper (et rétablir) ; coupé
  // state : todo = nécessaire , suggest = facultatif, ok / info = rien à faire
  state: "ok" | "todo" | "suggest" | "info"; note: string; action: { label: string; href?: string; run?: string; prefill?: { type: string; name: string; url: string } } | null;
}

// Un seul chargement partagé (cloche, accueil, menu Réglages, page Découverte) : une lecture toutes les 30 s quel que soit le nombre
// de composants qui l'affichent, à l'arrêt quand l'onglet est masqué.
let shared: { items: DiscoveryItem[]; muted?: string[]; todo: number; suggest: number } | null = null;
const listeners = new Set<(d: NonNullable<typeof shared>) => void>();
let timer: ReturnType<typeof setInterval> | undefined, inflight = false;
const loadShared = () => {
  if (inflight) return;
  inflight = true;
  read<NonNullable<typeof shared>>("discoveries")
    .then((d) => { shared = d; listeners.forEach((f) => f(d)); })
    .catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); })
    .finally(() => { inflight = false; });
};

export function useDiscoveries() {
  const [d, setD] = useState(shared);
  useEffect(() => {
    listeners.add(setD);
    if (listeners.size === 1) timer = setInterval(() => { if (!document.hidden) loadShared(); }, 30_000);
    loadShared();
    return () => { listeners.delete(setD); if (!listeners.size) clearInterval(timer); };
  }, []);
  return [d, loadShared] as const;
}

export const MODE: Record<DiscoveryItem["mode"], { label: string; hint: string; tone: "ok" | "warn" | "info"; Icon: typeof Repeat }> = {
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

export const when = (ts: number | null) => (ts ? dateTime(ts * 1000) : null);

/** Forget a discovery (no bell, no home reminder, moved to « Forgotten » in Settings → Discovery) or bring it back */
export function MuteButton({ x, reload }: { x: DiscoveryItem; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  if (!x.mutable) return null;
  const mute = !x.muted;
  return (
    <>
      <button type="button" className={`${button} border-line bg-bg2 text-txt hover:border-link`} onClick={() => void act(() => send("PUT", "discoveries/muted", { id: x.id, muted: mute }), mute ? tx("oublié : rangé dans « Oubliés », en bas de Réglages → Découverte") : tx("rappelé : de nouveau proposé"), setNote).then(() => reload())}
        title={mute ? tx("Ne plus le proposer, ni dans la cloche ni sur l'accueil. Il reste dans « Oubliés » pour le rappeler plus tard.") : tx("Le proposer de nouveau")}>
        {mute ? <EyeOff size={13} aria-hidden /> : <RotateCcw size={13} aria-hidden />}{mute ? tx("Oublier") : tx("Rappeler")}
      </button>
      <NoteLine note={note} />
    </>
  );
}

export function Action({ a, reload }: { a: NonNullable<DiscoveryItem["action"]>; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  const go = (href: string) => {   // déjà à cette adresse : l'adresse ne change pas, on prévient quand même la page (défilement, cadre allumé)
    if (location.hash === href) dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = href;
  };
  if (a.run === "netscan") return (   // la recherche réseau : lancée par la route du cadre « Recherche sur le réseau », puis ce cadre est montré (avancement)
    <>
      <button type="button" className={primary} onClick={() => void act(async () => { await send("POST", "network/scan"); pokeScan(); }, tx("recherche lancée"), setNote)
        .then((ok) => { reload(); if (ok && a.href) go(a.href); })}><Play size={13} aria-hidden />{a.label}</button>
      <NoteLine note={note} />
    </>
  );
  if (a.prefill) return <button type="button" className={primary} onClick={() => openConnector(a.prefill!)}><Settings2 size={13} aria-hidden />{a.label}<ChevronRight size={14} aria-hidden /></button>;   // le connecteur s'ouvre déjà rempli
  if (a.href) return (
    <a href={a.href} className={`${primary} no-underline`} onClick={(e) => { e.preventDefault(); go(a.href!); }}>
      {a.label}<ChevronRight size={14} aria-hidden />
    </a>
  );
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
  const m = MODE[x.mode], todo = x.state === "todo", suggest = x.state === "suggest";
  const wanted = () => location.hash.split("/")[2] === x.id;   // lien #settings/network/hosts : le cadre s'ouvre
  const [open, setOpen] = useState(false);   // plié par défaut, même si le lien du rappel est encore dans l'adresse ; un clic sur le lien l'ouvre
  useEffect(() => {
    const on = () => { if (wanted()) setOpen(true); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [x.id]);
  return (
    <li id={`net-${x.id}`} className={`scroll-mt-20 flex flex-col gap-2 rounded-xl border bg-card p-4 ${extra ? "lg:col-span-2 " : ""}${todo ? "border-warn bg-warn/5 shadow-[inset_4px_0_0_rgb(var(--warn))]" : suggest ? "border-link/40" : x.muted ? "border-line/60 opacity-75" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${todo ? "bg-warn/15 text-warn" : "bg-bg2 text-muted"}`} title={m.hint}><m.Icon size={15} aria-hidden /></span>
        <div className="min-w-0 flex-1"><Title x={x} machines={machines} /></div>
        {todo ? <Badge tone="warn" title={tx("Nécessaire : sans ça, MyServices ne voit pas tout")}>{tx("à faire")}</Badge>
          : suggest ? <Badge tone="info" title={tx("Facultatif : rien ne casse si vous le laissez")}>{tx("facultatif")}</Badge>
          : <Badge tone={m.tone} title={m.hint}>{m.label}</Badge>}
      </div>
      <p className="text-sm text-muted">{x.what}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {x.muted ? <Badge tone="off">{tx("oublié")}</Badge> : x.note && <span className={todo ? "text-warn" : "text-dim"}>{x.note}</span>}
        {when(x.last) ? <Badge tone="off">{tx("dernière fois")} {when(x.last)}</Badge> : x.mode !== "auto" && <Badge tone="warn">{tx("jamais lancée")}</Badge>}
        {when(x.next) && <Badge tone="info">{tx("prochaine")} {when(x.next)}</Badge>}
      </div>
      {extra && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={`${todo ? FOLD_WARN : FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
          <summary className={FOLD_HEAD}><ChevronRight size={16} className={`shrink-0 ${todo ? "text-warn" : "text-link"} transition-transform group-open:rotate-90`} aria-hidden />{tx("Voir et choisir les machines trouvées")}{picked > 0 && <Badge tone="info">{tx("{0} cochée(s)", picked)}</Badge>}</summary>
          <div className="flex flex-col gap-3">{extra(setPicked)}</div>
        </details>
      )}
      {((x.action && !extra) || x.mutable) && <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2.5">{x.action && !extra && <Action a={x.action} reload={reload} />}<MuteButton x={x} reload={reload} /></div>}
    </li>
  );
}

export type DiscoveryData = { items: DiscoveryItem[]; muted?: string[]; todo: number; suggest: number };
const countOf = (d: DiscoveryData | null, g: (typeof GROUPS)[number], state: DiscoveryItem["state"]) => (d?.items ?? []).filter((x) => x.state === state && groupOf(x) === g).length;
export const todoOf = (d: DiscoveryData | null, g: (typeof GROUPS)[number]) => countOf(d, g, "todo");
export const suggestOf = (d: DiscoveryData | null, g: (typeof GROUPS)[number]) => countOf(d, g, "suggest");

/** Suggestion en une ligne (appli reconnue, dossiers à chercher…) : elles peuvent être nombreuses, une carte chacune noierait ce qui compte */
function SuggestRow({ x, reload, machines }: { x: DiscoveryItem; reload: () => void; machines?: Machine[] }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
      <div className="min-w-[220px] flex-1" title={x.what}>
        <Title x={x} machines={machines} />
        {x.note && <p className="mt-0.5 text-xs text-dim">{x.note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {x.action && <Action a={x.action} reload={reload} />}
        <MuteButton x={x} reload={reload} />
      </div>
    </li>
  );
}

/** Les découvertes d'une famille, en trois temps : ce qu'il faut faire, ce qui est proposé (facultatif), puis, replié, ce qui tourne seul */
export function DiscoveryPanel({ d, group, reload, machines, extra }: { d: DiscoveryData | null; group: (typeof GROUPS)[number]; reload: () => void; machines?: Machine[]; extra?: (x: DiscoveryItem, onCount: (n: number) => void) => ReactNode }) {
  if (!d) return null;
  const items = d.items.filter((x) => groupOf(x) === group);
  const todo = items.filter((x) => x.state === "todo"), suggest = items.filter((x) => x.state === "suggest");
  const rest = items.filter((x) => x.state !== "todo" && x.state !== "suggest");
  const extraOf = (x: DiscoveryItem) => (extra && extra(x, () => undefined) !== null ? (onCount: (n: number) => void) => extra(x, onCount) : undefined);
  const card = (x: DiscoveryItem) => <Item key={x.id} x={x} reload={reload} machines={machines} extra={extraOf(x)} />;
  const rows = suggest.filter((x) => !extraOf(x)), cards = suggest.filter((x) => extraOf(x));   // une suggestion avec sa liste (machines trouvées) garde sa carte
  return (
    <section aria-label={group.title} className="flex flex-col gap-4">
      {todo.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-warn"><Bell size={15} aria-hidden />{tx("À faire ({0})", todo.length)}
            <span className="font-normal text-muted">{tx("nécessaire : sans ça, MyServices ne voit pas tout")}</span></h3>
          <ul className="grid items-stretch gap-3 lg:grid-cols-2">{todo.map(card)}</ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm font-semibold text-ok"><Check size={15} aria-hidden />{tx("Rien d'obligatoire à faire ici.")}</p>
      )}
      {suggest.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-link"><Lightbulb size={15} aria-hidden />{tx("Suggestions ({0})", suggest.length)}
            <span className="font-normal text-muted">{tx("facultatif : pour en voir davantage ; « Ne plus me le rappeler » range celles qui ne vous servent pas")}</span></h3>
          {cards.length > 0 && <ul className="grid items-stretch gap-3 lg:grid-cols-2">{cards.map(card)}</ul>}
          {rows.length > 0 && <ul className="flex flex-col divide-y divide-line/60 rounded-xl border border-link/30 bg-card">{rows.map((x) => <SuggestRow key={x.id} x={x} reload={reload} machines={machines} />)}</ul>}
        </div>
      )}
      {rest.length > 0 && (
        <details className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
          <summary className={FOLD_HEAD}><ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
            {tx("Automatique ou déjà en ordre ({0})", rest.length)}<span className="font-normal text-muted">{tx("rien à faire, pour information")}</span></summary>
          <ul className="grid items-stretch gap-3 lg:grid-cols-2">{rest.map(card)}</ul>
        </details>
      )}
    </section>
  );
}

const FOLD_KEY = "ms.home.discovery.folded";

/** Accueil : seulement ce qui est à faire (rien d'affiché quand tout est en ordre). Un cadre « notifications » : en-tête avec un badge du nombre,
 *  puis une ligne par chose à faire (logo, « Appli trouvée sur Machine », pourquoi) avec son bouton, et « Ne plus me le rappeler » quand c'est permis. */
export function DiscoveryReminder({ machines }: { machines?: Machine[] }) {
  const [d, reload] = useDiscoveries();
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  const todo = d?.items.filter((x) => x.state === "todo") ?? [];
  if (!todo.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-warn/50 bg-card shadow-sm" aria-label={tx("Découvertes à faire")}>
      <div className="flex flex-wrap items-center gap-3 bg-warn/10 px-5 py-3.5">
        <button type="button" onClick={() => fold(!folded)} aria-expanded={!folded} title={folded ? tx("Déplier") : tx("Replier")}
          className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warn/20 text-warn">
            <Bell size={18} aria-hidden />
            <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1 text-[11px] font-bold leading-none text-bg shadow"
              title={tx("{0} chose(s) à faire pour compléter la découverte", todo.length)}>{todo.length}</span>
          </span>
          <span className="min-w-0 flex-1">
            <h2 className="text-base font-bold">{tx("À faire pour compléter la découverte")}</h2>
            <p className="text-xs text-muted">{tx("Ces recherches ne se lancent pas toutes seules.")}</p>
          </span>
          <ChevronRight size={18} className={`shrink-0 text-txt transition-transform ${folded ? "" : "rotate-90"}`} aria-hidden />
        </button>
        <a href="#settings/network" className="group/go inline-flex items-center gap-1 rounded-full border border-warn/40 bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted no-underline transition-colors hover:border-warn hover:text-txt">
          {tx("Tout voir")}<ChevronRight size={13} className="transition-transform group-hover/go:translate-x-0.5" aria-hidden />
        </a>
      </div>
      {!folded && <ul className="flex flex-col divide-y divide-line/60">
        {todo.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
            <div className="min-w-[220px] flex-1">
              <Title x={x} machines={machines} />
              <p className="mt-0.5 text-xs text-dim">{x.note || MODE[x.mode].label}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {x.action && <Action a={x.action} reload={reload} />}
              <MuteButton x={x} reload={reload} />
            </div>
          </li>
        ))}
      </ul>}
    </section>
  );
}

/** Cloche de l'en-tête (admin) : ce qu'il reste à faire, dans un panneau qui s'ouvre au clic (chaque chose avec son bouton), puis le nombre
 *  de suggestions facultatives et un lien vers Réglages → Découverte. Pastille orange = choses à faire ; cloche grise s'il n'y a que des suggestions. */
export function DiscoveryBell({ machines }: { machines?: Machine[] }) {
  const [d, reload] = useDiscoveries();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const moved = () => setOpen(false);   // un bouton du panneau mène ailleurs : le panneau se ferme
    addEventListener("mousedown", away);
    addEventListener("keydown", esc);
    addEventListener("hashchange", moved);
    return () => { removeEventListener("mousedown", away); removeEventListener("keydown", esc); removeEventListener("hashchange", moved); };
  }, [open]);
  const n = d?.todo ?? 0, sug = d?.suggest ?? 0;
  if (!n && !sug) return null;
  const todo = d!.items.filter((x) => x.state === "todo");
  const label = n ? tx("{0} chose(s) à faire pour compléter la découverte", n) : tx("{0} suggestion(s) facultative(s)", sug);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} title={label} aria-label={label}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border ${n ? "border-warn/50 bg-warn/10 text-warn hover:bg-warn/20" : "border-line bg-card text-muted hover:border-link hover:text-txt"}`}>
        <Bell size={16} aria-hidden />
        {n > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold leading-none text-bg">{n}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={tx("Notifications")} className="absolute right-0 z-30 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-card shadow-xl shadow-black/30">
          <p className={`flex items-center gap-2 px-4 py-3 text-sm font-bold ${n ? "bg-warn/10 text-warn" : "text-ok"}`}>
            {n ? <><Bell size={15} aria-hidden />{tx("À faire ({0})", n)}</> : <><Check size={15} aria-hidden />{tx("Rien d'obligatoire à faire")}</>}
          </p>
          {todo.length > 0 && (
            <ul className="flex max-h-[60vh] flex-col divide-y divide-line/60 overflow-y-auto">
              {todo.map((x) => (
                <li key={x.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <div title={x.what}>
                    <Title x={x} machines={machines} />
                    {x.note && <p className="mt-0.5 text-xs text-warn">{x.note}</p>}
                  </div>
                  {x.action && <div className="flex flex-wrap items-center gap-1.5"><Action a={x.action} reload={reload} /></div>}
                </li>
              ))}
            </ul>
          )}
          <a href="#settings/network" onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-line/70 px-4 py-2.5 text-sm text-muted no-underline hover:bg-bg2 hover:text-txt">
            {sug > 0 ? <><Lightbulb size={14} className="text-link" aria-hidden />{tx("{0} suggestion(s) facultative(s)", sug)}</> : tx("Tout voir")}
            <ChevronRight size={14} className="ml-auto" aria-hidden />
          </a>
        </div>
      )}
    </div>
  );
}
