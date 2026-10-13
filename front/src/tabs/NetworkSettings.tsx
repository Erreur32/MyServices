// Réglages → Découverte : ce que MyServices trouve tout seul et ce qui demande un clic, sur une page à lire de haut en bas.
//   1. En-tête : l'état en une phrase, le mode automatique, la recherche réseau (dernière, prochaine, lancer maintenant)
//   2. À faire (seulement s'il y en a)   3. Machines trouvées sur le réseau (replié)   4. Applis à relier (tuiles, ordre alphabétique)
//   5. Autres suggestions   6. Ce qui tourne tout seul (replié)   7. Réglages de la recherche (fréquence, réseaux, discrétion)
// Cadres neutres, jamais un cadre coloré dans un autre : la couleur reste dans les pastilles. Liens directs gardés :
// #settings/network/<hosts|scan|services|backups> fait défiler jusqu'à la section (et ouvre les machines trouvées).
import { Bell, Boxes, Check, ChevronRight, EyeOff, ListChecks, Lightbulb, Radar, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import type { Snapshot } from "../api";
import { NoteLine, Switch } from "../components/form";
import { Badge, Count, Dim } from "../components/ui";
import { Action, MODE, MuteButton, Title, useDiscoveries, when, type DiscoveryItem } from "../components/DiscoveryCard";
import { NetworkStep } from "../components/NetworkStep";
import { appIcon } from "../lib/appIcons";
import { dateTime } from "../lib/format";
import { reopenFirstSteps } from "../lib/firstSteps";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { usePoll } from "../lib/polling";
import { tx } from "../lib/i18n";
import { pokeScan } from "../lib/scan";
import type { NetScan } from "../types";

interface NetSettings { every_h: number; default_h: number; max_h: number; fixed: boolean; nets: string[]; discreet: boolean; auto: boolean; ignored: { ip: string; name: string }[] }

const CARD = "rounded-2xl border border-line bg-card p-4";
const byLabel = (a: DiscoveryItem, b: DiscoveryItem) => (a.app || a.title).localeCompare(b.app || b.title, undefined, { sensitivity: "base" }) || (a.machine?.name ?? "").localeCompare(b.machine?.name ?? "");

/** Section : titre avec icône et compteur, une phrase d'aide, le contenu ; `id` sert aux liens directs */
function Section({ id, icon, title, n, hint, right, children }: { id?: string; icon: ReactNode; title: string; n?: number; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={`${CARD} scroll-mt-20`} aria-label={title}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-2 font-bold">{icon}{title}{n !== undefined && <Count n={n} />}</h2>
        {right && <span className="ml-auto flex flex-wrap items-center gap-2">{right}</span>}
      </div>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Section repliable (même cadre neutre) : ouverte par un lien direct vers elle */
function Fold({ id, icon, title, n, hint, open, onToggle, children }: { id: string; icon: ReactNode; title: string; n?: number; hint?: string; open: boolean; onToggle: (o: boolean) => void; children: ReactNode }) {
  return (
    <details id={id} open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className={`${CARD} group scroll-mt-20`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
        <h2 className="flex items-center gap-2 font-bold">{icon}{title}{n !== undefined && <Count n={n} />}</h2>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </summary>
      <div className="mt-3 border-t border-line/60 pt-1">{children}</div>
    </details>
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

/** Something that runs by itself: aligned columns (icon, what it is, mode, last and next time, button), so the list reads as a table */
function AutoRow({ x, reload, machines }: { x: DiscoveryItem; reload: () => void; machines: Snapshot["data"]["machine_list"] }) {
  const m = MODE[x.mode], last = when(x.last), next = when(x.next);
  const sub = "col-start-2 md:col-start-auto";
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 py-3 md:grid-cols-[2rem_minmax(0,1fr)_8.5rem_12.5rem_10rem] md:items-center">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${m.tone === "ok" ? "bg-ok/10 text-ok" : "bg-bg2 text-muted"}`} title={m.hint}><m.Icon size={15} aria-hidden /></span>
      <div className="min-w-0">
        <div className="text-sm"><Title x={x} machines={machines} /></div>
        <p className="mt-0.5 text-xs text-muted">{x.what}</p>
        {x.note && <p className="mt-0.5 text-xs text-dim">{x.note}</p>}
      </div>
      <span className={sub}><Badge tone={m.tone} title={m.hint}>{m.label}</Badge></span>
      <dl className={`${sub} grid grid-cols-[auto_1fr] gap-x-2 text-xs tabular-nums`}>
        <dt className="text-dim">{tx("dernière")}</dt><dd className="text-muted">{last ?? "-"}</dd>
        <dt className="text-dim">{tx("prochaine")}</dt><dd className="text-muted">{next ?? "-"}</dd>
      </dl>
      <div className={`${sub} flex flex-wrap gap-1.5 md:justify-end`}>{x.action && <Action a={x.action} reload={reload} />}</div>
    </li>
  );
}

/** Appli reconnue à relier : une tuile (logo, appli, machine), « Configurer » ouvre le connecteur déjà rempli */
function AppTile({ x, reload }: { x: DiscoveryItem; reload: () => void }) {
  const icon = x.app ? appIcon([x.app]) : null;
  return (
    <li className={`flex flex-col gap-2 rounded-xl border border-line bg-bg2/40 p-3 ${x.muted || x.running === false ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card">{icon ? <img src={icon} alt="" className="h-6 w-6" /> : <Boxes size={18} className="text-muted" aria-hidden />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5"><b className="truncate text-sm">{x.app || x.title}</b>
            {x.running === true && <Badge tone="ok">{tx("actif")}</Badge>}
            {x.running === false && <Badge tone="off" title={x.note}>{tx("arrêté")}</Badge>}</span>
          <span className="block truncate text-xs text-dim">{x.machine ? `${x.machine.name || x.machine.ip}${x.machine.name ? ` · ${x.machine.ip}` : ""}` : x.note}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{x.action && <Action a={x.action} reload={reload} />}<MuteButton x={x} reload={reload} /></div>
    </li>
  );
}

/** Lien direct #settings/network/<part> : défile jusqu'à la section, même si la page est déjà ouverte */
function usePart(ready: boolean, onPart: (part: string) => void) {
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const part = location.hash.split("/")[2];
      if (!part) return;
      onPart(part);
      setTimeout(() => document.getElementById(`net-${part === "network" ? "hosts" : part}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, [ready, onPart]);
}

export function NetworkSettings({ snap }: { snap: Snapshot }) {
  const [disc, reloadDisc] = useDiscoveries();
  const [cfg, setCfg] = useState<NetSettings | null>(null), [scan, setScan] = useState<NetScan | null>(null);
  const [hours, setHours] = useState(""), [nets, setNets] = useState<string | null>(null), [note, setNote] = useState<Note>(null), [error, setError] = useState("");
  const [hostsOpen, setHostsOpen] = useState(false), [autoOpen, setAutoOpen] = useState(false), [forgotOpen, setForgotOpen] = useState(false), [picked, setPicked] = useState(0);
  const load = useCallback(() => {
    Promise.all([read<NetSettings>("network/settings"), read<NetScan>("network/scan")])
      .then(([c, s]) => { setCfg(c); setScan(s); setHours((h) => (h === "" ? String(c.every_h) : h)); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  const running = scan?.phase === "ping" || scan?.phase === "identify";
  usePoll(load, running ? 10_000 : 60_000);   // 10 s seulement pour suivre une recherche en cours
  const onPart = useCallback((part: string) => { if (part === "hosts" || part === "network") setHostsOpen(true); if (part === "forgotten") setForgotOpen(true); load(); }, [load]);
  usePart(!!cfg && !!scan && !!disc, onPart);
  if (!cfg || !scan) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;

  const items = disc?.items ?? [];
  const todo = items.filter((x) => x.state === "todo" && x.id !== "hosts").sort(byLabel);
  const apps = items.filter((x) => x.state === "suggest" && x.id.startsWith("connector:")).sort(byLabel);
  const stopped = items.filter((x) => x.running === false && !x.muted && x.id.startsWith("connector:")).sort(byLabel);   // container not running
  const others = items.filter((x) => x.state === "suggest" && !x.id.startsWith("connector:") && x.id !== "hosts").sort(byLabel);
  const quiet_ = items.filter((x) => x.state !== "todo" && x.state !== "suggest" && x.id !== "hosts" && !x.muted && x.running !== false);
  const forgotten = items.filter((x) => x.muted).sort(byLabel);   // « Forget »: out of every list above, back with « Recall »
  const hostsItem = items.find((x) => x.id === "hosts");

  const last = scan.ended ? scan.ended * 1000 : null;
  const next = last && cfg.every_h ? last + cfg.every_h * 3_600_000 : null;
  const n = Number(hours);
  const valid = hours !== "" && Number.isInteger(n) && n >= 0 && n <= cfg.max_h;
  const save = (value: number) => act(() => send("PUT", "network/settings", { every_h: value }), value ? tx("enregistré : toutes les {0} h", value) : tx("enregistré : recherche automatique coupée"), setNote)
    .then((ok) => { if (ok) { setHours(String(value)); load(); } });
  const netsText = nets ?? cfg.nets.join(", ");
  const netsList = netsText.split(/[\s,;]+/).filter(Boolean);
  const saveNets = () => act(() => send("PUT", "network/settings", { nets: netsList }), netsList.length ? tx("réseaux enregistrés") : tx("réseau de la machine hôte"), setNote)
    .then((ok) => { if (ok) { setNets(null); load(); } });
  const saveDiscreet = (on: boolean) => act(() => send("PUT", "network/settings", { discreet: on }), on ? tx("mode discret activé") : tx("mode discret coupé"), setNote).then(() => load());
  const saveAuto = (on: boolean) => act(() => send("PUT", "network/settings", { auto: on }), on ? tx("mode automatique activé") : tx("mode manuel : rien n'est plus ajouté tout seul"), setNote)
    .then((ok) => { if (ok) { load(); reloadDisc(); } });
  const scanNow = () => act(async () => { await send("POST", "network/scan"); pokeScan(); }, tx("recherche lancée"), setNote).then(() => load());

  return (
    <div className="flex flex-col gap-4">
      {/* 1. En-tête : l'état, le mode, la recherche réseau */}
      <section className={CARD} aria-label={tx("Découverte")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Radar size={18} aria-hidden />{tx("Découverte")}</h2>
          {todo.length ? <Badge tone="warn">{tx("{0} chose(s) à faire", todo.length)}</Badge> : <Badge tone="ok">{tx("rien d'obligatoire à faire")}</Badge>}
          {apps.length + others.length > 0 && <Badge tone="info">{tx("{0} suggestion(s) facultative(s)", apps.length + others.length)}</Badge>}
          <span className="ml-auto flex items-center gap-2 text-sm font-semibold">{tx("Mode automatique")}<Switch on={cfg.auto} onChange={(on) => void saveAuto(on)} label={tx("Mode automatique")} /></span>
        </div>
        <p className="mt-2 text-sm text-muted">
          {cfg.auto
            ? tx("Automatique : après chaque recherche, les machines avec SSH, une appli reconnue ou un service utile sont ajoutées toutes seules, et leur SSH s'active dès que la clé marche. Une machine retirée à la main ne revient pas.")
            : tx("Manuel : rien n'est ajouté ni activé tout seul ; vous choisissez les machines trouvées. La recherche réseau garde sa fréquence.")}
          {" "}<span className="text-dim">{tx("Toujours à faire vous-même : autoriser la clé SSH, donner un jeton aux connecteurs, installer l'agent Windows.")}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line/60 pt-3 text-sm">
          <Search size={15} className="text-muted" aria-hidden /><b>{tx("Recherche sur le réseau")}</b>
          {running ? <Badge tone="info"><RefreshCw size={11} className="mr-1 inline animate-spin" aria-hidden />{tx("en cours")}</Badge>
            : cfg.every_h === 0 ? <Badge tone="off">{tx("automatique coupée")}</Badge>
            : !last ? <Badge tone="info">{tx("première recherche dans la minute")}</Badge>
            : <Badge tone="ok">{tx("toutes les {0} h", cfg.every_h)}</Badge>}
          {last ? <span className="text-dim">{tx("dernière :")} {dateTime(last)} · {scan.found.length} {tx("appareils")}</span> : <Dim>{tx("aucune recherche faite")}</Dim>}
          {next && !running && <span className="text-dim">{tx("prochaine à partir de {0}", dateTime(next))}</span>}
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={running} onClick={() => void scanNow()}><Search size={14} aria-hidden />{running ? tx("Recherche en cours…") : tx("Chercher maintenant")}</button>
            <button type="button" className={quiet} onClick={reopenFirstSteps} title={tx("Rouvre la carte et efface vos choix « Passer »")}><ListChecks size={14} aria-hidden />{tx("Revoir les premiers pas")}</button>
          </span>
        </div>
        <NoteLine note={note} />
      </section>

      {/* 2. À faire */}
      {todo.length > 0 && (
        <Section icon={<Bell size={16} className="text-warn" aria-hidden />} title={tx("À faire")} n={todo.length} hint={tx("Nécessaire : sans ça, MyServices ne voit pas tout.")}>
          <ul className="flex flex-col divide-y divide-line/60">{todo.map((x) => <Row key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul>
        </Section>
      )}

      {/* 3. Machines trouvées sur le réseau */}
      <Fold id="net-hosts" icon={<Radar size={16} aria-hidden />} title={tx("Machines trouvées sur le réseau")} n={scan.found.filter((h) => !h.known).length || undefined}
        hint={picked ? tx("{0} cochée(s)", picked) : hostsItem?.note || (cfg.auto ? tx("le mode automatique ajoute seul les plus utiles") : tx("à cocher pour les suivre, ou à ignorer"))}
        open={hostsOpen} onToggle={setHostsOpen}>
        <NetworkStep net={scan} reload={load} machines={snap.data.machine_list} connected={snap.data.services_status ?? []} ignoredList={cfg.ignored} onCount={setPicked} />
      </Fold>

      {/* 4. Applis à relier */}
      {apps.length + stopped.length > 0 && (
        <Section id="net-services" icon={<Boxes size={16} aria-hidden />} title={tx("Applis à relier")} n={apps.length}
          hint={tx("Applis reconnues sur vos machines, qu'un connecteur peut lire. Facultatif : « Oublier » range celles qui ne vous servent pas, « Rappeler » les fait revenir.")}
          right={<a href="#settings/connectors" className="text-sm text-link hover:underline">{tx("Réglages → Connecteurs")}</a>}>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{apps.map((x) => <AppTile key={x.id} x={x} reload={reloadDisc} />)}</ul>
          {stopped.length > 0 && (
            <details className="group mt-3 border-t border-line/60 pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronRight size={15} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
                {tx("Conteneurs arrêtés")} <Count n={stopped.length} />
                <span className="font-normal text-muted">{tx("vus par docker ps -a mais pas lancés : rien à relier tant qu'ils ne tournent pas")}</span>
              </summary>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{stopped.map((x) => <AppTile key={x.id} x={x} reload={reloadDisc} />)}</ul>
            </details>
          )}
        </Section>
      )}

      {/* 5. Autres suggestions */}
      {others.length > 0 && (
        <Section id="net-backups" icon={<Lightbulb size={16} aria-hidden />} title={tx("Autres suggestions")} n={others.length} hint={tx("Facultatif : pour en voir davantage.")}>
          <ul className="flex flex-col divide-y divide-line/60">{others.map((x) => <Row key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul>
        </Section>
      )}

      {/* 6. Ce qui tourne tout seul */}
      {quiet_.length > 0 && (
        <Fold id="net-auto" icon={<Check size={16} className="text-ok" aria-hidden />} title={tx("Ce qui tourne tout seul")} n={quiet_.length} hint={tx("rien à faire, pour information")} open={autoOpen} onToggle={setAutoOpen}>
          <ul className="flex flex-col divide-y divide-line/60">{quiet_.map((x) => <AutoRow key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul>
        </Fold>
      )}

      {/* 7. Oubliés : ce qu'on a choisi de ne plus voir proposé, à rappeler d'un clic */}
      {forgotten.length > 0 && (
        <Fold id="net-forgotten" icon={<EyeOff size={16} className="text-muted" aria-hidden />} title={tx("Oubliés")} n={forgotten.length} hint={tx("plus proposés ; « Rappeler » les fait revenir")} open={forgotOpen} onToggle={setForgotOpen}>
          <ul className="flex flex-col divide-y divide-line/60">{forgotten.map((x) => <Row key={x.id} x={x} reload={reloadDisc} machines={snap.data.machine_list} />)}</ul>
        </Fold>
      )}

      {/* 8. Réglages de la recherche */}
      <Section id="net-scan" icon={<Settings2 size={16} aria-hidden />} title={tx("Réglages de la recherche")} hint={tx("Cherche les machines allumées sur votre réseau local (un /24 au plus) : un ping, le nom, quelques ports. Lecture seule.")}>
        <div className="grid gap-4 lg:grid-cols-3">
          <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); if (valid) void save(n); }}>
            <label className="flex flex-col gap-1 text-sm font-semibold">{tx("Fréquence (heures, 0 = coupée)")}
              <span className="flex gap-2">
                <input className={`${input} w-28`} type="number" min={0} max={cfg.max_h} step={1} value={hours} disabled={cfg.fixed}
                  onChange={(e) => setHours(e.target.value)} title={cfg.fixed ? tx("fixée par la variable d'environnement du conteneur") : tx("défaut : {0}", cfg.default_h)} />
                {!cfg.fixed && <button className={quiet} disabled={!valid || n === cfg.every_h}>{tx("Enregistrer")}</button>}
                {!cfg.fixed && cfg.every_h !== cfg.default_h && (
                  <button type="button" className={quiet} title={tx("défaut : {0}", cfg.default_h)} aria-label={tx("Remettre la valeur par défaut")} onClick={() => void save(cfg.default_h)}><RotateCcw size={14} /></button>
                )}
              </span>
            </label>
            {cfg.fixed && <p className="text-xs text-dim">{tx("Fixée par MYSERVICES_NETSCAN_EVERY dans le compose.")}</p>}
            {!valid && hours !== "" && <p className="text-xs text-warn">{tx("Un nombre entier de 0 à {0}.", cfg.max_h)}</p>}
            <p className="text-xs text-dim">{tx("La première recherche se lance toute seule ; ensuite à cette fréquence.")}</p>
          </form>
          <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); void saveNets(); }}>
            <label className="flex flex-col gap-1 text-sm font-semibold">{tx("Réseaux à parcourir")}
              <input className={`${input} w-full font-mono`} value={netsText} placeholder={scan.net || "192.168.1.0/24"} onChange={(e) => setNets(e.target.value)} />
            </label>
            <span className="flex flex-wrap gap-2">
              <button className={quiet} disabled={nets === null}>{tx("Enregistrer")}</button>
              {cfg.nets.length > 0 && <button type="button" className={quiet} onClick={() => setNets("")}>{tx("Revenir au réseau de l'hôte")}</button>}
            </span>
            <p className="text-xs text-dim">{tx("Par défaut, le réseau de la machine hôte. Plusieurs possibles (un /24 au plus chacun), séparés par une virgule.")}</p>
          </form>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} aria-hidden />{tx("Mode discret")}
              <Switch on={cfg.discreet} onChange={(on) => void saveDiscreet(on)} label={tx("Mode discret")} /></span>
            <p className="text-xs text-dim">{tx("Ne lit ni le TTL du ping ni l'adresse MAC : le système des machines n'est alors plus deviné par là.")}</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
