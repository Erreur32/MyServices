// Étape « Recherche des autres machines du réseau » de Premiers pas : lancer la recherche, choisir les machines à
// ajouter, puis, pour celles qui répondent en SSH, préparer l'accès (alias + commande à autoriser + test).
// Lecture seule sur le réseau ; rien n'est ajouté sans que l'admin le demande.
import { Check, ChevronRight, Circle, EyeOff, Globe, KeyRound, Loader2, Plug, RefreshCw, RotateCcw, Search, Square, Wifi, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { read, send } from "../api";
import { act, button, input, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { dateTime } from "../lib/format";
import { ADDED_KEY, DISMISSED_KEY, LATER_HIDDEN_KEY, REOPEN_EVENT } from "../lib/firstSteps";
import { appIcon } from "../lib/appIcons";
import { changes, interesting, needsLink, netState, osOf, quiet, roleOf, summarize, tagsOf, viaMynetwork } from "../lib/netScan";
import { pokeScan, rereadMachines } from "../lib/scan";
import { ConnectorForm } from "../tabs/Connectors";
import type { ConnectorsState, ConnectorType, NetHost, NetScan, SystemState } from "../types";
import { Copyable, NoteLine } from "./form";
import { netPercent } from "./ScanBar";
import { SkipButton } from "./SkipButton";
import { Badge, Count } from "./ui";

/** Icône de l'appli reconnue (rien si elle n'en a pas) */
function AppIcon({ apps }: { apps?: readonly string[] }) {
  const src = appIcon(apps);
  return src ? <img src={src} alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" /> : null;
}

/** Une machine trouvée : nom (ou « sans nom »), adresse une seule fois, une étiquette par information */
function HostInfo({ h, fresh = false }: { h: NetHost; fresh?: boolean }) {
  const tags = tagsOf(h), os = osOf(h);
  return (
    <>
      <AppIcon apps={h.apps} />
      {h.name ? <b className="text-txt">{h.name}</b> : <i className="text-dim">{tx("sans nom")}</i>}
      <span className="font-mono text-xs text-dim">{h.ip}</span>
      {tags.map((t) => <Badge key={t.label} tone={t.kind === "ssh" ? "ok" : t.kind === "app" ? "info" : "off"}>{t.label}</Badge>)}
      {os && <Badge tone="off" title={tx("Système probable, d'après : {0}", os.how)}>{os.label}</Badge>}
      {fresh && <Badge tone="warn">{tx("nouvelle")}</Badge>}
    </>
  );
}

/** Ce qui suivra l'ajout d'une machine cochée (jeton Home Assistant, API MynetworK, clé SSH) : sous sa ligne, pas dedans */
function HostHint({ h }: { h: NetHost }) {
  return (
    <>
      {h.apps.includes("Home Assistant") && (
        <span className="text-xs text-warn">
          <KeyRound size={12} className="mr-1 inline" aria-hidden />{tx("Après l'ajout, un jeton d'accès vous sera demandé (par son API, pas par SSH) : l'aide vous guide pas à pas.")}
        </span>
      )}
      {viaMynetwork(h) && (
        <span className="text-xs text-info">
          <KeyRound size={12} className="mr-1 inline" aria-hidden />{tx("UniFi sera lu par l'API de MynetworK (à venir) : SSH n'est pas nécessaire pour la surveillance, il reste possible si vous voulez l'état système.")}
        </span>
      )}
      {!!h.ssh_port && !viaMynetwork(h) && !h.apps.includes("Home Assistant") && (
        <span className="text-xs text-link">
          <KeyRound size={12} className="mr-1 inline" aria-hidden />{tx("Après l'ajout, une étape guidée prépare l'accès SSH : une commande à lancer sur la machine avec la clé de MyServices, puis un test.")}
        </span>
      )}
    </>
  );
}

/** Cadre dépliable (« machines déjà ajoutées », « autres appareils ») : bordure et fond à la couleur d'accent pour qu'on voie qu'on peut l'ouvrir */
export const FOLD = "group rounded-xl border border-link/50 bg-link/5 open:bg-link/[0.03] hover:border-link";
/** Même cadre dépliable quand il y a une action à faire : couleur d'alerte */
export const FOLD_WARN = "group rounded-xl border border-warn/60 bg-warn/10 hover:border-warn";
export const FOLD_HEAD = "flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-sm font-semibold text-txt [&::-webkit-details-marker]:hidden";

/** Une ligne de machine trouvée : cadre net, case + infos à gauche, actions à droite ; la ligne cochée prend l'accent */
const ROW = "flex flex-wrap items-start rounded-lg border";
const ROW_BODY = "flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2";

const quietBtn = `${button} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`;

const ADDED = ADDED_KEY;
const loadAdded = (): Record<string, NetHost> => {
  try { return JSON.parse(sessionStorage.getItem(ADDED) || "{}") as Record<string, NetHost>; } catch { return {}; }
};

const DISMISSED = DISMISSED_KEY;
const loadDismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DISMISSED) || "[]") as string[]; } catch { return []; }
};

export function NetworkStep({ net, reload, machines, connected, onSkip, ignoredList, onCount }: {
  onCount?: (n: number) => void;  // nombre de machines cochées, pour l'afficher sur l'en-tête du cadre quand il est plié
  net: NetScan | null; reload: () => void; onSkip?: () => void;
  ignoredList?: { ip: string; name: string }[];  // appareils ignorés à la main, avec « Reprendre » (Réglages → Découverte)  // sans onSkip : pas de bouton « Passer » (Réglages → Découverte)
  machines: { ip: string; name?: string; ping?: boolean; local?: boolean; off?: boolean; ssh?: unknown }[]; connected: { connector: string; url?: string | null }[];
}) {
  const known = machines.map((m) => m.ip);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [laterHidden, setLaterHidden] = useState(() => localStorage.getItem(LATER_HIDDEN_KEY) === "1");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [othersOpen, setOthersOpen] = useState(false);  // cadre « autres appareils » ouvert : ses cases ne comptent que s'il l'est
  const [names, setNames] = useState<Record<string, string>>({});  // nom choisi avant l'ajout (sinon : nom DNS, sinon l'IP)
  // Machines ajoutées dont les options (SSH, jeton) restent à régler : gardées si la page est rechargée, retirées par « Terminé »
  const [added, setAdded] = useState<Record<string, NetHost>>(loadAdded);
  useEffect(() => { sessionStorage.setItem(ADDED, JSON.stringify(added)); }, [added]);
  useEffect(() => {  // « Revoir les premiers pas » efface la mémoire : la carte déjà affichée la relit
    const refresh = () => { setDismissed(loadDismissed()); setAdded(loadAdded()); setLaterHidden(localStorage.getItem(LATER_HIDDEN_KEY) === "1"); };
    addEventListener(REOPEN_EVENT, refresh);
    return () => removeEventListener(REOPEN_EVENT, refresh);
  }, []);
  const state = netState(net);
  const preselected = useRef<number | null>(null);
  useEffect(() => {  // fin d'une recherche : les machines intéressantes sont cochées d'office (décochables)
    if (net?.phase !== "done" || !net.ended || preselected.current === net.ended) return;
    preselected.current = net.ended;
    setPicked(new Set(net.found.filter(interesting).map((h) => h.ip)));
  }, [net]);
  const diff = net ? changes(net) : null;

  const start = async () => {
    setBusy(true);
    await act(async () => { await send("POST", "network/scan"); pokeScan(); reload(); }, tx("recherche lancée"), setNote);
    setBusy(false);
  };
  const stop = async () => { await send("POST", "network/scan/stop"); reload(); };

  const toggle = (ip: string) => setPicked((p) => { const n = new Set(p); if (n.has(ip)) n.delete(ip); else n.add(ip); return n; });
  const found = (net?.found ?? []).filter((h) => !added[h.ip] && !known.includes(h.ip) && !net?.ignored?.includes(h.ip));
  const ignoredIps = net?.ignored ?? [];
  const ignoredSeen = (net?.found ?? []).filter((h) => !known.includes(h.ip) && ignoredIps.includes(h.ip));
  const ignoredGone = (ignoredList ?? []).filter((e) => !(net?.found ?? []).some((h) => h.ip === e.ip)).map((e): NetHost => ({ ip: e.ip, name: e.name, ports: [], hints: [], apps: [] }));  // pas revus à ce scan
  const watch = found.filter(interesting);                              // liste principale : SSH, appli reconnue, service utile
  const webOnly = found.filter((h) => !interesting(h) && !quiet(h));    // repliés : caméras, box, objets connectés…
  const pingOnly = found.filter((h) => !interesting(h) && quiet(h));
  const ignoredAll = [...ignoredSeen, ...ignoredGone];                    // rangés dans « autres appareils », avec « Reprendre »
  const rest = webOnly.length + pingOnly.length + ignoredAll.length;
  const sum = net && net.phase === "done" ? summarize(net.found, known) : null;
  // Accès à régler : machines ajoutées à l'instant, plus celles déjà déclarées dont le SSH ou le jeton Home Assistant manque
  const pending = (net?.found ?? []).filter((h) => known.includes(h.ip) && !added[h.ip] && !dismissed.includes(h.ip) && needsLink(h, machines, connected));
  const toLink = [...Object.values(added), ...pending].filter((h) => needsLink(h, machines, connected));   // seulement ce qui reste à régler : le reste est dans « déjà ajoutées »
  const later = (net?.found ?? []).filter((h) => known.includes(h.ip) && dismissed.includes(h.ip) && needsLink(h, machines, connected));
  const resumeLater = () => setDismissed((d) => { const n = d.filter((ip) => !later.some((h) => h.ip === ip)); localStorage.setItem(DISMISSED, JSON.stringify(n)); return n; });

  const scanned = !!net && net.phase === "done" && !!net.ended;
  const declared = machines.filter((m) => !m.local);  // machines déjà ajoutées (hors la machine hôte)
  /** Les deux actions de l'étape, ensemble : (re)lancer la recherche, ou la passer (à reprendre plus tard) */
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={scanned ? quietBtn : primary} disabled={busy} onClick={() => void start()}>
        {scanned ? <RefreshCw size={14} aria-hidden /> : <Search size={14} aria-hidden />}{scanned ? tx("Refaire un scan") : tx("Lancer le scan")}
      </button>
      {onSkip && <SkipButton onClick={onSkip} onDark />}
    </div>
  );

  const unignore = (h: NetHost) => void act(() => send("DELETE", `network/ignored/${h.ip}`), tx("{0} sera de nouveau proposé", h.name || h.ip), setNote).then(() => reload());
  const renderRows = (list: NetHost[]) => list.map((h) => ignoredAll.includes(h) ? (
    <li key={h.ip} className={`${ROW} border-dashed bg-bg2/30 opacity-80`}>
      <EyeOff size={15} className="ml-3 mt-3 shrink-0 text-muted" aria-hidden />
      <div className={ROW_BODY}>
        <HostInfo h={h} />
        <Badge tone="off">{tx("ignoré")}{ignoredGone.includes(h) ? ` · ${tx("pas revu à ce scan")}` : ""}</Badge>
      </div>
      <button type="button" className={`${quietBtn} m-1.5 shrink-0`} onClick={() => unignore(h)}>{tx("Reprendre")}</button>
    </li>
  ) : (
    <li key={h.ip} className={`${ROW} ${picked.has(h.ip) ? "border-link/50 bg-link/5" : "border-transparent bg-bg2/60 hover:bg-bg2"}`}>
      <label className={`${ROW_BODY} cursor-pointer`}>
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-[rgb(var(--link))]" checked={picked.has(h.ip)} onChange={() => toggle(h.ip)} />
        <HostInfo h={h} fresh={!!diff?.fresh.has(h.ip)} />
      </label>
      <button type="button" className="m-1.5 shrink-0 rounded-md p-1.5 text-muted hover:bg-line/40 hover:text-txt" aria-label={tx("Ignorer {0}", h.name || h.ip)}
        title={tx("Ignorer : ne plus le proposer (à reprendre dans Réglages → Découverte)")} onClick={() => void ignore(h)}><EyeOff size={15} aria-hidden /></button>
      {picked.has(h.ip) && (
        <div className="row-in flex basis-full flex-col gap-1.5 px-3 pb-2.5 pl-9">
          <input className={`${input} max-w-xs py-1 text-xs`} value={names[h.ip] ?? h.name ?? ""} maxLength={60} placeholder={h.ip}
            aria-label={tx("Nom de {0}", h.ip)} title={tx("Nom donné à la machine une fois ajoutée (modifiable ici avant l'ajout)")}
            onChange={(e) => setNames((n) => ({ ...n, [h.ip]: e.target.value }))} />
          <HostHint h={h} />
        </div>
      )}
    </li>
  ));

  /** Un groupe de lignes : titre en petites capitales avec son nombre, puis la liste */
  const group = (title: string, list: NetHost[], Icon: LucideIcon, tone: string) => list.length > 0 && (
    <section className="flex flex-col gap-1.5" key={title}>
      <h3 className={`flex items-center gap-2 rounded-md border-l-4 bg-bg2 px-3 py-1.5 text-sm font-semibold text-txt ${tone}`}><Icon size={15} className="shrink-0 text-muted" aria-hidden />{title}<Count n={list.length} /></h3>
      <ul className="flex flex-col gap-1.5">{renderRows(list)}</ul>
    </section>
  );

  // Cochées ET visibles : une machine ignorée, déjà ajoutée ou cachée dans un cadre plié ne compte pas (sinon des boutons sans rien à l'écran)
  const chosen = found.filter((h) => picked.has(h.ip) && (watch.includes(h) || othersOpen));
  useEffect(() => { onCount?.(chosen.length); }, [chosen.length, onCount]);
  // Boutons de la sélection : sous la liste, dans son cadre, seulement quand quelque chose est coché
  const selectionBar = chosen.length > 0 && (
    <div className="row-in sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-2.5 shadow-lg">
      <button type="button" className={primary} disabled={busy} onClick={() => void addPicked()}>
        <Check size={14} aria-hidden />{tx("Ajouter la sélection")} ({chosen.length})
      </button>
      <button type="button" className={quietBtn} onClick={() => setPicked(new Set())}>{tx("Tout désélectionner")}</button>
    </div>
  );

  const ignore = async (h: NetHost) => {
    setPicked((p) => { const n = new Set(p); n.delete(h.ip); return n; });
    await act(() => send("POST", "network/ignored", { ip: h.ip, name: h.name || "" }), tx("{0} ignoré : retrouvez-le dans Réglages → Découverte", h.name || h.ip), setNote);
    reload();
  };

  const addPicked = async () => {
    setBusy(true);
    const done: Record<string, NetHost> = {};
    await act(async () => {
      for (const h of chosen) {
        await send("PUT", `machines/settings/${h.ip}`, { machine: { name: (names[h.ip] ?? h.name ?? "").trim() || h.ip, role: roleOf(h) }, extra: [] });
        done[h.ip] = h;
      }
    }, tx("machines ajoutées : relevé et santé lancés"), setNote);
    setAdded((a) => ({ ...a, ...done }));
    setPicked(new Set());
    setNames({});
    await rereadMachines(Object.keys(done)).catch(() => undefined);  // relevé et santé des seules machines ajoutées
    setBusy(false);
  };

  if (state === "run" && net) {
    const pinging = net.phase === "ping";
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="text-sm text-dim">
          {tx("Lecture seule : un ping par adresse, la demande du nom et quelques connexions TCP. Rien n'est modifié sur vos machines.")}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2">
            {pinging ? <Loader2 size={15} className="animate-spin text-link" aria-hidden /> : <Check size={15} className="step-pop text-ok" aria-hidden />}
            <b className="text-txt">{tx("Recherche des machines allumées")}</b>
            <span className="tabular-nums text-dim">{net.done}/{net.total} {tx("adresses")}</span>
            <span className="font-mono text-xs text-dim">{net.net}</span>
          </li>
          <li className={`flex items-center gap-2 transition-opacity duration-500 ${pinging ? "opacity-50" : ""}`}>
            {pinging ? <Circle size={15} className="text-dim" aria-hidden /> : <Loader2 size={15} className="animate-spin text-link" aria-hidden />}
            <b className="text-txt">{tx("Identification de chaque machine")}</b>
            <span className="text-dim">{pinging ? tx("nom, ports ouverts : juste après") : tx("{0}/{1} machines (nom, ports ouverts)", net.described, net.up)}</span>
          </li>
        </ul>
        <div className="h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden>
          <div className="scan-fill h-full rounded-full" style={{ width: `${Math.max(3, netPercent(net))}%` }} />
        </div>
        {net.found.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {net.found.map((h) => (
              <li key={h.ip} className="row-in flex flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2"><HostInfo h={h} /></li>
            ))}
          </ul>
        )}
        <div><button type="button" className={quietBtn} onClick={() => void stop()}><Square size={13} aria-hidden />{tx("Arrêter")}</button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {actions}
      {later.length > 0 && !laterHidden && (
        <section className="relative rounded-xl border border-warn/50 bg-warn/10 p-3 pr-10" aria-live="polite">
          <button type="button" aria-label={tx("Masquer ce rappel")} title={tx("Masquer ce rappel : les accès restent listés dans « machines déjà ajoutées »")}
            onClick={() => { localStorage.setItem(LATER_HIDDEN_KEY, "1"); setLaterHidden(true); }}
            className="absolute right-2 top-2 rounded-md p-1 text-dim hover:bg-bg2 hover:text-txt"><X size={16} aria-hidden /></button>
          <div className="flex flex-wrap items-center gap-2">
            <RotateCcw size={16} className="text-warn" aria-hidden />
            <b className="text-txt">{later.length > 1 ? tx("{0} accès passés, à régler plus tard", later.length) : tx("1 accès passé, à régler plus tard")}</b>
            <button type="button" className={`${primary} ml-auto`} onClick={resumeLater}>
              <RotateCcw size={14} aria-hidden />{later.length > 1 ? tx("Tout reprendre") : tx("Reprendre")}
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">{tx("Ces machines sont ajoutées, mais leur accès (SSH ou jeton Home Assistant) n'est pas réglé : MyServices ne lit pas leurs conteneurs ni leur état.")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {later.map((h) => <Badge key={h.ip} tone="warn" title={h.ip}>{h.name || h.ip}</Badge>)}
          </div>
        </section>
      )}
      {toLink.length === 0 && found.length === 0 && (
        <p>{tx("Cherche les machines allumées sur votre réseau local (un seul sous-réseau /24, en lecture seule : ping, nom et quelques ports). Vous choisissez ensuite lesquelles ajouter ; rien n'est ajouté tout seul.")}</p>
      )}
      {net?.error && <p className="text-bad">⚠ {net.error}</p>}
      {sum && scanned && !net.error && (
        <section className="rounded-xl border border-line bg-bg2/40 p-3" aria-live="polite">
          <p className="text-sm">
            <b className="text-txt">{net.stopped ? tx("Scan arrêté : ") : ""}{tx("{0} appareil(s) sur {1}", sum.total, net.net ?? "")}</b>
            {sum.known > 0 && <span className="text-dim"> · {tx("{0} déjà ajouté(s)", sum.known)}</span>}
            {net.ended && <span className="text-dim"> · {tx("scan du {0}", dateTime(net.ended * 1000))}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="off">{tx("{0} à regarder", sum.watch)}</Badge>
            {sum.ssh > 0 && <Badge tone="off">SSH {sum.ssh}</Badge>}
            {sum.apps > 0 && <Badge tone="off">{tx("{0} applis reconnues", sum.apps)}</Badge>}
            {sum.shares > 0 && <Badge tone="off">{tx("{0} partages / bureau à distance", sum.shares)}</Badge>}
            {sum.webOnly > 0 && <Badge tone="off">{tx("{0} pages web seules (repliées)", sum.webOnly)}</Badge>}
            {sum.pingOnly > 0 && <Badge tone="off">{tx("{0} ping seulement (repliés)", sum.pingOnly)}</Badge>}
          </div>
          {diff && !net.stopped && (
            <p className="mt-2 text-sm">
              {diff.fresh.size === 0 && diff.gone.length === 0
                ? <span className="text-dim">{tx("Aucun changement depuis le scan du {0}.", dateTime((net.previous_ended ?? 0) * 1000))}</span>
                : <>
                    <b className="text-txt">{tx("Depuis le scan du {0} :", dateTime((net.previous_ended ?? 0) * 1000))}</b>{" "}
                    {diff.fresh.size > 0 && <span className="text-warn">{tx("{0} nouvelle(s)", diff.fresh.size)}</span>}
                    {diff.fresh.size > 0 && diff.gone.length > 0 && " · "}
                    {diff.gone.length > 0 && <span className="text-bad" title={diff.gone.join(", ")}>{tx("{0} disparue(s) : {1}", diff.gone.length, diff.gone.slice(0, 4).join(", "))}{diff.gone.length > 4 ? "…" : ""}</span>}
                  </>}
            </p>
          )}
        </section>
      )}
      {(found.length > 0 || ignoredAll.length > 0) && toLink.length === 0 && (
        <>
          {watch.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 basis-64 text-sm font-semibold text-txt">
                  {tx("À regarder")} <span className="font-normal text-dim">({watch.length}) · {tx("cochées d'office : SSH, appli reconnue ou service utile ; décochez ce que vous ne voulez pas")}</span>
                </p>
                {watch.some((h) => !picked.has(h.ip)) && <button type="button" className={quietBtn} onClick={() => setPicked(new Set(watch.map((h) => h.ip)))}>{tx("Tout sélectionner")}</button>}
              </div>
              <ul className="flex flex-col gap-1.5">{renderRows(watch)}</ul>
            </section>
          )}
          {watch.length === 0 && rest > 0 && <p className="text-sm text-dim">{tx("Rien d'évident à ajouter dans ce scan : les appareils trouvés sont repliés ci-dessous.")}</p>}
          {rest > 0 && (
            <details open={othersOpen} onToggle={(e) => setOthersOpen(e.currentTarget.open)} className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
              <summary className={FOLD_HEAD}><ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
                {tx("{0} autre(s) appareil(s) : pages web seules, caméras, objets connectés, ping seulement, ignorés", rest)}
                {[...webOnly, ...pingOnly].some((h) => diff?.fresh.has(h.ip)) && <> <Badge tone="warn">{tx("nouvelle")}</Badge></>}
              </summary>
              <p className="text-xs text-dim">{tx("On n'y touche pas : décochés. Cochez-en un si vous voulez le suivre quand même.")}</p>
              <div className="flex flex-col gap-3">
                {group(tx("Pages web seules"), webOnly, Globe, "border-link")}
                {group(tx("Répondent au ping seulement"), pingOnly, Wifi, "border-warn")}
                {group(tx("Ignorés à la main"), ignoredAll, EyeOff, "border-dim")}
              </div>
            </details>
          )}
          {selectionBar}
        </>
      )}
      {toLink.length > 0 && (
        <div className="flex flex-col gap-2">
          {found.length > 0 && <p className="text-xs text-dim">{tx("{0} autre(s) appareil(s) masqué(s) : ils reviennent quand les accès ci-dessous sont réglés ou passés.", found.length)}</p>}
          <p className="text-sm font-semibold text-txt">{tx("Machines ajoutées : accès à régler")}</p>
          {toLink.map((h) => (
            <AddedMachine key={h.ip} host={h} linked={!viaMynetwork(h) && !needsLink(h, machines, connected)} onDone={() => {
              setAdded((a) => { const n = { ...a }; delete n[h.ip]; return n; });
              setDismissed((d) => { const n = [...new Set([...d, h.ip])]; localStorage.setItem(DISMISSED, JSON.stringify(n)); return n; });
            }} />
          ))}
          {found.length === 0 && <p className="text-sm text-dim">{tx("Toutes les machines trouvées sont ajoutées. « Terminé » ferme un cadre ; « Refaire un scan » relance la recherche.")}</p>}
        </div>
      )}
      {scanned && declared.length > 0 && (
        <details className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
          <summary className={FOLD_HEAD}><ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
            {tx("{0} machine(s) déjà ajoutée(s)", declared.length)}
            <span className="font-normal text-dim"> · {tx("vos choix précédents")}</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {declared.map((m) => {
              const seen = net?.found.find((h) => h.ip === m.ip);
              const link = seen ? needsLink(seen, machines, connected) : null;
              return (
                <li key={m.ip} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2">
                  <AppIcon apps={seen?.apps} />
                  <b className="text-txt">{m.name || m.ip}</b>
                  <span className="font-mono text-xs text-dim">{m.ip}</span>
                  {m.ssh ? <Badge tone="ok">SSH</Badge> : null}
                  {link && <Badge tone="warn">{link === "ha" ? tx("jeton à régler") : tx("accès SSH à régler")}</Badge>}
                  {!m.off && m.ping === false && <Badge tone="bad">{tx("hors ligne")}</Badge>}
                  {m.off && <Badge tone="off">{tx("éteinte volontairement")}</Badge>}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-dim">{tx("Pour retirer une machine : Réglages → Machines. Pour effacer vos « Passer » : menu du compte → « Revoir les premiers pas ».")}</p>
        </details>
      )}
      <NoteLine note={note} />
    </div>
  );
}

/** Machine ajoutée : si elle répond en SSH, préparer l'accès (alias avec la clé de l'app), puis la commande et le test */
/** linked : l'accès marche déjà d'après les données du serveur (cadre rouvert après un rechargement de la page) */
function AddedMachine({ host, linked, onDone }: { host: NetHost; linked: boolean; onDone: () => void }) {
  const ha = host.apps.includes("Home Assistant");
  const mwk = viaMynetwork(host);  // UniFi : API MynetworK à venir ; SSH facultatif
  const ssh = !!host.ssh_port && !ha;  // Home Assistant se relie par son API : pas de SSH proposé, même s'il répond
  const [user, setUser] = useState("root"), [cmd, setCmd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null), [tested, setTested] = useState(false), [haOk, setHaOk] = useState(false);
  const ok = tested || linked;
  const valid = ok || haOk || (!ssh && !ha);  // vert seulement une fois l'accès validé (ou s'il n'y en a aucun à régler)
  const label = host.name || host.ip;

  const prepare = async () => {
    setBusy(true);
    await act(async () => {
      const { alias } = await send<{ alias: string }>("POST", "machines/ssh-alias", { ip: host.ip, user, port: host.ssh_port ?? 22 });
      await send("PUT", `machines/settings/${host.ip}`, { machine: { name: label, role: roleOf(host), ssh: alias }, extra: [] });
      const sys = await read<SystemState>("system");
      setCmd(sys.ssh.authorize ?? null);
    }, tx("accès SSH préparé : lancer la commande sur la machine, puis tester"), setNote);
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    const good = await act(async () => {
      const r = await send<{ failed: number }>("POST", `machines/settings/${host.ip}/check`);
      if (r.failed) throw new Error(tx("toujours illisible : {0}", label));
      await rereadMachines([host.ip]);
    }, tx("accès SSH accepté : cette machine est relue (collecte et santé)"), setNote);
    setTested(good);
    setBusy(false);
  };

  return (
    <div className={`rounded-lg border p-3 ${valid ? "border-ok/50 bg-ok/10" : "border-warn/50 bg-warn/10"}`}>
      <p className="flex flex-wrap items-center gap-2">
        <Check size={14} className={valid ? "text-ok" : "text-warn"} aria-hidden /><AppIcon apps={host.apps} /><b className="text-txt">{label}</b>
        <span className="font-mono text-xs text-dim">{host.ip}</span><Badge tone={valid ? "ok" : "warn"}>{valid ? tx("ajoutée") : tx("accès à régler")}</Badge>
        {ssh && ok && <Badge tone="ok">{tx("SSH accepté")}</Badge>}
        <SkipButton onClick={onDone} onDark className="ml-auto" label={ssh && !ok ? tx("Passer") : tx("Terminé")}
          title={tx("Passer ou fermer ce cadre : la machine reste ajoutée, ses accès se règlent aussi plus tard (« Reprendre » ici, ou Réglages → Machines et Connecteurs)")} />
      </p>
      {mwk && (
        <p className="mt-2 text-sm text-muted">
          {tx("UniFi sera lu par l'API de MynetworK (à venir) : en ligne / hors ligne, appareils et clients, sans SSH. Le SSH apporte seulement l'état système (disque, charge) : à vous de voir.")}
        </p>
      )}
      {ssh && !ok && !cmd && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-dim">{tx("Compte SSH sur cette machine")}
            <input className={`${input} w-40`} value={user} maxLength={32} onChange={(e) => setUser(e.target.value)} />
          </label>
          <button type="button" className={mwk ? quietBtn : primary} disabled={busy || !user} onClick={() => void prepare()}>
            <KeyRound size={14} aria-hidden />{mwk ? tx("Lire quand même par SSH") : tx("Lire cette machine par SSH")}
          </button>
        </div>
      )}
      {cmd && !ok && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-muted">{tx("Sur {0}, avec le compte {1} :", label, user)}</p>
          <Copyable text={cmd} oneLine />
          <div><button type="button" className={primary} disabled={busy} onClick={() => void test()}>{busy ? tx("Test…") : tx("Tester")}</button></div>
        </div>
      )}
      {ha && <HomeAssistantLink host={host} onLinked={() => setHaOk(true)} />}
      {!ssh && !ha && <p className="mt-1 text-sm text-dim">{tx("Pas de SSH sur cette machine : ses services web seront suivis par leur adresse.")}</p>}
      <NoteLine note={note} />
    </div>
  );
}

/** Home Assistant : pas de SSH, son API avec un jeton (connecteur « home-assistant », formulaire et aide partagés avec Réglages) */
function HomeAssistantLink({ host, onLinked }: { host: NetHost; onLinked: () => void }) {
  const [type, setType] = useState<ConnectorType | null>(null), [open, setOpen] = useState(true), [done, setDone] = useState(false);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {  // le formulaire (et son aide) s'ouvre d'office : c'est la suite logique de l'ajout
    void act(async () => {
      const st = await read<ConnectorsState>("connectors/settings");
      const t = st.types.find((x) => x.type === "home-assistant");
      if (!t) throw new Error(tx("connecteur Home Assistant introuvable"));
      setType(t);
      // déjà relié (enregistré, mais pas encore vu par la collecte) : pas de second formulaire, qui échouerait en doublon
      if (st.instances.some((i) => i.type === "home-assistant" && String(i.config.url ?? "").includes(host.ip))) { setDone(true); onLinked(); }
    }, "", setNote);
  }, []);
  if (done) return <p className="mt-2 text-sm text-muted">{tx("Home Assistant relié par son API : première lecture en cours")}</p>;
  return (
    <div className="mt-2">
      <p className="text-sm text-muted">{tx("Home Assistant se relie par son API (adresse + jeton), pas par SSH. Un compte dédié non administrateur est recommandé.")}</p>
      {!open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => setOpen(true)}><Plug size={14} aria-hidden />{tx("Relier Home Assistant")}</button>
          <span className="self-center text-sm text-dim">{tx("ou plus tard : Réglages → Connecteurs")}</span>
        </div>
      )}
      {open && type && (
        <ConnectorForm type={type} quietSave prefill={{ type: "home-assistant", name: "home-assistant", url: `http://${host.ip}:8123` }}
          onDone={() => { setDone(true); onLinked(); void send("POST", "system/tasks/collect/run").catch(() => undefined); pokeScan(); }}
          onCancel={() => setOpen(false)} />
      )}
      <NoteLine note={note} />
    </div>
  );
}
