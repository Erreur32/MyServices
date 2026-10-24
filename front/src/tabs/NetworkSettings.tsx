// The discovery: what MyServices finds by itself et ce qui demande un clic, sur une page à lire de haut en bas.
//   1. En-tête : l'état en une phrase, le mode automatique (la recherche réseau est en tête de « Machines sur le réseau »)
//   2. À faire (seulement s'il y en a)   3. Machines sur le réseau (replié)   4. Applis à activer (tuiles, ordre alphabétique)
//   5. Autres suggestions   6. Oubliés (replié)
// No job setting here: the search frequency, networks and discreet mode live in Settings → Tasks and schedules, with every job.
// Cadres neutres, jamais un cadre coloré dans un autre : la couleur reste dans les pastilles. Liens directs gardés :
// Each part is now shown with its subject (see DiscoveryPart); the old #settings/network/<part> addresses lead there (discoveryMoved).
import { Bell, Boxes, EyeOff, ListChecks, Lightbulb, Radar, RefreshCw, Search, Timer } from "lucide-react";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import type { Snapshot } from "../api";
import { NoteLine, Switch } from "../components/form";
import { Badge, Count, Dim, Loading, TITLE } from "../components/ui";
import { Action, MODE, MuteButton, Title, useDiscoveries, when, type DiscoveryItem } from "../components/DiscoveryCard";
import { NetworkStep } from "../components/NetworkStep";
import { appIcon } from "../lib/appIcons";
import { dateTime } from "../lib/format";
import { reopenAssistant } from "../lib/assistant";
import { act, primary, quiet, type Note } from "../lib/forms";
import { pokeScan } from "../lib/scan";
import { usePoll } from "../lib/polling";
import { tx } from "../lib/i18n";
import { runningTip, stoppedTip } from "../lib/runState";
import type { NetScan } from "../types";
import { InfoNote } from "../components/InfoNote";

interface NetSettings { every_h: number; default_h: number; max_h: number; fixed: boolean; nets: string[]; discreet: boolean; auto: boolean; ignored: { ip: string; name: string }[] }

const CARD = "rounded-2xl border border-line bg-card p-4";
const byLabel = (a: DiscoveryItem, b: DiscoveryItem) => (a.app || a.title).localeCompare(b.app || b.title, undefined, { sensitivity: "base" }) || (a.machine?.name ?? "").localeCompare(b.machine?.name ?? "");

/** Section : titre avec icône et compteur, une phrase d'aide, le contenu ; `id` sert aux liens directs */
function Section({ id, icon, title, n, hint, right, children }: { id?: string; icon: ReactNode; title: string; n?: number; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={`${CARD} ${TITLE} scroll-mt-20`} aria-label={title}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-2 font-bold">{icon}{title}{n !== undefined && <Count n={n} />}</h2>
        {right && <span className="ml-auto flex flex-wrap items-center gap-2">{right}</span>}
      </div>
      {hint && <InfoNote className="mt-1">{hint}</InfoNote>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Une découverte en ligne : titre, note, dernière / prochaine fois, puis ses boutons */
function Row({ x, reload, machines }: { x: DiscoveryItem; reload: () => void; machines: Snapshot["data"]["machine_list"] }) {
  const m = MODE[x.mode];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2 text-muted" title={m.hint}><m.Icon size={15} aria-hidden /></span>
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2"><Title x={x} machines={machines} /></div>
        <p className="mt-0.5 text-sm text-muted">{x.what}</p>
        {(x.note || x.last || x.next) && (
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-dim">
            {x.note && <span>{x.note}</span>}{when(x.last) && <span>{tx("dernière fois")} {when(x.last)}</span>}{when(x.next) && <span>{tx("prochaine")} {when(x.next)}</span>}
          </p>
        )}
      </div>
      {(x.action || x.mutable) && <div className="flex flex-wrap items-center gap-1.5">{x.action && <Action a={x.action} reload={reload} />}<MuteButton x={x} reload={reload} /></div>}
    </li>
  );
}

/** Appli reconnue à activer : une tuile (logo, appli, machine), « Activer » ouvre le connecteur déjà rempli */
function AppTile({ x, reload }: { x: DiscoveryItem; reload: () => void }) {
  const icon = x.app ? appIcon([x.app]) : null;
  return (
    <li className={`rounded-xl border border-line bg-bg2/40 p-3 ${x.muted || x.running === false ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card">{icon ? <img src={icon} alt="" className="h-6 w-6" /> : <Boxes size={18} className="text-muted" aria-hidden />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5"><b className="truncate text-sm">{x.app || x.title}</b>
            {x.running === true && <Badge tone="ok" title={runningTip()}>{tx("actif")}</Badge>}
            {x.running === false && <Badge tone="off" title={stoppedTip(x.note)}>{tx("arrêté")}</Badge>}</span>
          <span className="block truncate text-xs text-dim">{x.machine ? `${x.machine.name || x.machine.ip}${x.machine.name ? ` · ${x.machine.ip}` : ""}` : x.note}</span>
        </span>
        {/* buttons on the top line, at the right of the card */}
        <span className="flex shrink-0 items-center gap-1.5">{x.action && <Action a={x.action} reload={reload} />}<MuteButton x={x} reload={reload} /></span>
      </div>
    </li>
  );
}

/** One category inside « Stopped and forgotten »: a small title with its count and what it holds */
function AsideGroup({ title, n, hint, children }: Readonly<{ title: string; n: number; hint: string; children: React.ReactNode }>) {
  return (
    <section>
      <h3 className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-line/60 pb-1 text-sm font-semibold">{title} <Count n={n} /><span className="font-normal text-muted">{hint}</span></h3>
      {children}
    </section>
  );
}

/** The parts of the discovery, each shown with its subject: the machines found in Machines › Untracked devices, the apps (to activate,
 *  stopped, forgotten) in Connectors › Recognised apps, the mode and other suggestions in Application › Automatic discovery */
export type DiscoveryPart = "mode" | "hosts" | "services" | "suggestions" | "forgotten";
type Part = DiscoveryPart;
/** Where an old #settings/network/<part> address now lives (null: Application › Automatic discovery, #settings/network itself) */
export function discoveryMoved(hash: string): string | null {
  const v = hash.split("/")[2];
  if (v === "hosts" || v === "network" || v === "scan") return "#settings/machines/devices";
  if (v === "services" || v === "forgotten") return "#settings/connectors/apps";
  return null;
}

/** The line under « Machines on the network »: the ticked count while choosing, else the last search and what happens to the machines found */
function hostsHint(picked: number, last: number | null, note: string | undefined, auto: boolean): string {
  if (picked) return tx("{0} cochée(s)", picked);
  const when = last ? tx("dernière recherche : {0}", dateTime(last)) : tx("aucune recherche faite");
  const what = note || (auto ? tx("le mode automatique ajoute seul les plus utiles") : tx("à cocher pour les suivre, ou à ignorer"));
  return [when, what].join(" · ");
}

/** The state of the network search: running, turned off, waiting for its first pass, or its rhythm */
function SearchState({ running, everyH, last }: Readonly<{ running: boolean; everyH: number; last: number | null }>) {
  if (running) return <Badge tone="info"><RefreshCw size={11} className="mr-1 inline animate-spin" aria-hidden />{tx("en cours")}</Badge>;
  if (everyH === 0) return <Badge tone="off">{tx("automatique coupée")}</Badge>;
  if (!last) return <Badge tone="info">{tx("première recherche dans la minute")}</Badge>;
  return <Badge tone="ok">{tx("toutes les {0} h", everyH)}</Badge>;
}

export function NetworkSettings({ snap, parts }: Readonly<{ snap: Snapshot; parts: Part[] }>) {
  const [disc, reloadDisc] = useDiscoveries();
  const [cfg, setCfg] = useState<NetSettings | null>(null), [scan, setScan] = useState<NetScan | null>(null);
  const [note, setNote] = useState<Note>(null), [error, setError] = useState("");
  const [picked, setPicked] = useState(0);
  const load = useCallback(() => {
    Promise.all([read<NetSettings>("network/settings"), read<NetScan>("network/scan")])
      .then(([c, s]) => { setCfg(c); setScan(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  const running = scan?.phase === "ping" || scan?.phase === "identify";
  usePoll(load, running ? 10_000 : 60_000);   // 10 s seulement pour suivre une recherche en cours
  const [searchNote, setSearchNote] = useState<Note>(null);   // shown under the search line, next to its button
  const scanNow = () => act(async () => { await send("POST", "network/scan"); pokeScan(); }, tx("recherche lancée"), setSearchNote).then(() => load());
  if (!cfg || !scan) return <Loading error={error} />;

  const items = disc?.items ?? [];
  const todo = items.filter((x) => x.state === "todo" && x.id !== "hosts").sort(byLabel);
  const apps = items.filter((x) => x.state === "suggest" && x.id.startsWith("connector:") && x.running !== false).sort(byLabel);
  const stopped = items.filter((x) => x.running === false && !x.muted && x.id.startsWith("connector:")).sort(byLabel);   // container not running
  const others = items.filter((x) => x.state === "suggest" && !x.id.startsWith("connector:") && x.id !== "hosts").sort(byLabel);
  const forgotten = items.filter((x) => x.muted).sort(byLabel);   // « Forget »: out of every list above, back with « Recall »
  // put aside, one frame by category: stopped containers, forgotten apps, other forgotten suggestions
  const forgotApps = forgotten.filter((x) => x.id.startsWith("connector:")), forgotOthers = forgotten.filter((x) => !x.id.startsWith("connector:"));
  const aside = stopped.length + forgotten.length;
  const hostsItem = items.find((x) => x.id === "hosts");

  const last = scan.ended ? scan.ended * 1000 : null;
  const next = last && cfg.every_h ? last + cfg.every_h * 3_600_000 : null;
  const saveAuto = (on: boolean) => act(() => send("PUT", "network/settings", { auto: on }), on ? tx("mode automatique activé") : tx("mode manuel : rien n'est plus ajouté tout seul"), setNote)
    .then((ok) => { if (ok) { load(); reloadDisc(); } });

  const pages: Record<Part, ReactNode> = {
      // 1. En-tête : l'état, le mode, la recherche réseau
      mode: <>
      <section className={`${CARD} ${TITLE}`} aria-label={tx("Découverte")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Radar size={18} aria-hidden />{tx("Découverte")}</h2>
          {todo.length ? <Badge tone="warn">{tx("{0} chose(s) à faire", todo.length)}</Badge> : <Badge tone="ok">{tx("rien d'obligatoire à faire")}</Badge>}
          {apps.length + others.length > 0 && <Badge tone="info">{tx("{0} suggestion(s) facultative(s)", apps.length + others.length)}</Badge>}
          <span className="ml-auto flex items-center gap-2 text-sm font-semibold">{tx("Mode automatique")}<Switch on={cfg.auto} onChange={(on) => void saveAuto(on)} label={tx("Mode automatique")} /></span>
        </div>
        {/* what the mode does by itself, then what is always left to do by hand */}
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <b className="text-txt">{cfg.auto ? tx("Automatique") : tx("Manuel")}</b>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {(cfg.auto
                ? [tx("Après chaque recherche, ajout des machines avec SSH, une appli reconnue ou un service utile"), tx("Activation du SSH dès que la clé fonctionne"),
                  tx("Une machine retirée manuellement n'est plus réajoutée")]
                : [tx("Rien n'est ajouté ni activé tout seul"), tx("Vous choisissez les machines trouvées"), tx("La recherche réseau garde sa fréquence")]
              ).map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
          <div>
            <b className="text-txt">{tx("À faire vous-même")}</b>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {[tx("Autoriser la clé SSH"), tx("Fournir un jeton aux connecteurs"), tx("Installer l'agent Windows")].map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line/60 pt-3">
          <button type="button" className={quiet} onClick={reopenAssistant} title={tx("Rouvre l'assistant depuis le début")}><ListChecks size={14} aria-hidden />{tx("Revoir l'assistant de démarrage")}</button>
        </div>
        <NoteLine note={note} />
      </section>

      {/* 2. À faire */}
      {todo.length > 0 && (
        <Section icon={<Bell size={16} className="text-warn" aria-hidden />} title={tx("À faire")} n={todo.length} hint={tx("Nécessaire : sans ça, MyServices ne voit pas tout.")}>
          <ul className="flex flex-col divide-y divide-line/60">{todo.map((x) => <Row key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul>
        </Section>
      )}
      </>,

      // 3. Machines sur le réseau
      hosts: <Section id="net-hosts" icon={<Radar size={16} aria-hidden />} title={tx("Machines sur le réseau")} n={scan.found.filter((h) => !h.known).length || undefined}
        hint={hostsHint(picked, last, hostsItem?.note, cfg.auto)}>
        {/* the network search fills this frame: its state and settings here, its button just below */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/60 pb-3 text-sm">
          <Search size={15} className="text-muted" aria-hidden /><b>{tx("Recherche sur le réseau")}</b>
          <SearchState running={running} everyH={cfg.every_h} last={last} />
          {last ? <span className="text-dim">{tx("dernière :")} {dateTime(last)} · {scan.found.length} {tx("appareils")}</span> : <Dim>{tx("aucune recherche faite")}</Dim>}
          {next && !running && <span className="text-dim">{tx("prochaine à partir de {0}", dateTime(next))}</span>}
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={running} onClick={() => void scanNow()}>
              {last ? <><RefreshCw size={14} aria-hidden />{tx("Relancer la recherche")}</> : <><Search size={14} aria-hidden />{tx("Chercher maintenant")}</>}</button>
            <a href="#settings/tasks" className={`${quiet} no-underline`} title={tx("Fréquence, réseaux à parcourir et mode discret : dans Tâches et horaires")}><Timer size={14} aria-hidden />{tx("Réglages de la recherche")}</a>
          </span>
        </div>
        <NoteLine note={searchNote} />
        <NetworkStep noButton net={scan} reload={load} machines={snap.data.machine_list} connected={snap.data.services_status ?? []} ignoredList={cfg.ignored} onCount={setPicked} />
      </Section>,

      // 4. Applis à activer : only those that run (stopped and forgotten ones are put aside, below)
      services: (
        <Section id="net-services" icon={<Boxes size={16} aria-hidden />} title={tx("Applis à activer")} n={apps.length}
          hint={tx("Applis reconnues sur vos machines, qu'un connecteur peut lire. Facultatif : « Oublier » range celles qui ne vous servent pas, « Rappeler » les fait revenir.")}>
          {apps.length ? <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{apps.map((x) => <AppTile key={x.id} x={x} reload={reloadDisc} />)}</ul> : <Dim>{tx("Rien ici pour l'instant.")}</Dim>}
        </Section>
      ),

      // 5. Autres suggestions
      suggestions: (
        <Section id="net-backups" icon={<Lightbulb size={16} aria-hidden />} title={tx("Autres suggestions")} n={others.length} hint={tx("Facultatif : pour en voir davantage.")}>
          {others.length ? <ul className="flex flex-col divide-y divide-line/60">{others.map((x) => <Row key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul> : <Dim>{tx("Rien ici pour l'instant.")}</Dim>}
        </Section>
      ),

      // 6. Mis de côté : stopped containers and what was forgotten, grouped by category, each with its button
      forgotten: (
        <Section id="net-forgotten" icon={<EyeOff size={16} className="text-muted" aria-hidden />} title={tx("Arrêtés et oubliés")} n={aside}
          hint={tx("mis de côté : rien à activer tant qu'un conteneur est arrêté ; « Rappeler » fait revenir ce qui a été oublié")}>
          {aside === 0 && <Dim>{tx("Rien ici pour l'instant.")}</Dim>}
          <div className="flex flex-col gap-4">
            {stopped.length > 0 && (
              <AsideGroup title={tx("Conteneurs arrêtés")} n={stopped.length} hint={tx("vus par docker ps -a mais pas lancés")}>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{stopped.map((x) => <AppTile key={x.id} x={x} reload={reloadDisc} />)}</ul>
              </AsideGroup>
            )}
            {forgotApps.length > 0 && (
              <AsideGroup title={tx("Applis oubliées")} n={forgotApps.length} hint={tx("plus proposées à activer")}>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{forgotApps.map((x) => <AppTile key={x.id} x={x} reload={reloadDisc} />)}</ul>
              </AsideGroup>
            )}
            {forgotOthers.length > 0 && (
              <AsideGroup title={tx("Autres suggestions oubliées")} n={forgotOthers.length} hint={tx("plus rappelées dans la cloche ni sur l'accueil")}>
                <ul className="flex flex-col divide-y divide-line/60">{forgotOthers.map((x) => <Row key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul>
              </AsideGroup>
            )}
          </div>
        </Section>
      ),
  };

  return <div className="flex flex-col gap-4">{parts.map((p) => <Fragment key={p}>{pages[p]}</Fragment>)}</div>;
}
