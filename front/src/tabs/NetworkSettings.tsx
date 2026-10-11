// Réglages → Découverte, en trois sous-onglets (Réseau et machines, Services et applis, Sauvegardes) : les découvertes de chaque famille
// en cartes, et pour le réseau le scan du réseau local (lecture seule) et sa fréquence automatique ; relancer à la main,
// refaire le parcours des premiers pas. Le premier scan est toujours manuel : l'automatique ne démarre qu'après lui.
import { ListChecks, Radar, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { dateTime } from "../lib/format";
import { reopenFirstSteps } from "../lib/firstSteps";
import { act, button, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { pokeScan } from "../lib/scan";
import { GROUPS, DiscoveryPanel, todoOf, useDiscoveries } from "../components/DiscoveryCard";
import type { Snapshot } from "../api";
import { NetworkStep } from "../components/NetworkStep";
import type { NetScan } from "../types";

interface NetSettings { every_h: number; default_h: number; max_h: number; fixed: boolean; nets: string[]; discreet: boolean; ignored: { ip: string; name: string }[] }

/** Lien #settings/network/<hosts|scan> (depuis une découverte à faire) : fait défiler jusqu'à la carte, même si l'on est déjà sur la page ;
 *  `ready` : la page est chargée (sinon la carte n'existe pas encore au moment du clic) */
function useScrollToPart(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const part = location.hash.split("/")[2];
      if (part) setTimeout(() => document.getElementById(`net-${part}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, [ready]);
}

/** Sous-onglet d'ouverture : celui du lien (#settings/network/<hosts|scan|services|backups>), sinon le premier qui a quelque chose à faire */
const openTab = (todo: (id: string) => number) => {
  const part = location.hash.split("/")[2];
  if (part === "services" || part === "backups") return part;
  if (part === "hosts" || part === "scan") return "network";
  return GROUPS.find((g) => todo(g.id))?.id ?? "network";
};

export function NetworkSettings({ snap }: { snap: Snapshot }) {
  const [disc, reloadDisc] = useDiscoveries();
  const [tab, setTab] = useState<string | null>(null);
  const current = tab ?? (disc ? openTab((id) => todoOf(disc, GROUPS.find((g) => g.id === id)!)) : "network");
  const group = GROUPS.find((g) => g.id === current) ?? GROUPS[0];
  const hasHostsItem = !!disc?.items.some((x) => x.id === "hosts" && !x.muted);
  const [cfg, setCfg] = useState<NetSettings | null>(null), [scan, setScan] = useState<NetScan | null>(null);
  const [hours, setHours] = useState(""), [nets, setNets] = useState<string | null>(null), [note, setNote] = useState<Note>(null), [error, setError] = useState("");
  const load = useCallback(() => {
    Promise.all([read<NetSettings>("network/settings"), read<NetScan>("network/scan")])
      .then(([c, s]) => { setCfg(c); setScan(s); setHours((h) => (h === "" ? String(c.every_h) : h)); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000); // une recherche en cours : suivre sa fin
    return () => clearInterval(id);
  }, [load]);
  useScrollToPart(!!cfg && !!scan && current === "network");
  if (!cfg || !scan) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;

  const hostsList = (slot?: HTMLElement | null) => (
    <>
      <p className="text-sm text-muted">{tx("Cochez celles à suivre puis ajoutez-les, ou ignorez-les. MyServices ne les ajoute jamais seul.")}</p>
      <NetworkStep net={scan} reload={load} machines={snap.data.machine_list} connected={snap.data.services_status ?? []} ignoredList={cfg.ignored} barSlot={slot} />
    </>
  );
  const running = scan.phase === "ping" || scan.phase === "identify";
  const last = scan.ended ? scan.ended * 1000 : null;
  const n = Number(hours);
  const valid = hours !== "" && Number.isInteger(n) && n >= 0 && n <= cfg.max_h;
  const save = (value: number) => act(() => send("PUT", "network/settings", { every_h: value }), value ? tx("enregistré : toutes les {0} h", value) : tx("enregistré : recherche automatique coupée"), setNote)
    .then((ok) => { if (ok) { setHours(String(value)); load(); } });
  const netsText = nets ?? cfg.nets.join(", ");
  const netsList = netsText.split(/[\s,;]+/).filter(Boolean);
  const saveNets = () => act(() => send("PUT", "network/settings", { nets: netsList }), netsList.length ? tx("réseaux enregistrés") : tx("réseau de la machine hôte"), setNote)
    .then((ok) => { if (ok) { setNets(null); load(); } });
  const saveDiscreet = (on: boolean) => act(() => send("PUT", "network/settings", { discreet: on }), on ? tx("mode discret activé") : tx("mode discret coupé"), setNote).then(() => load());
  const next = last && cfg.every_h ? last + cfg.every_h * 3_600_000 : null;
  const state = cfg.every_h === 0 ? <Badge tone="off">{tx("automatique coupée")}</Badge>
    : !last ? <Badge tone="warn">{tx("en attente d'une première recherche à la main")}</Badge>
    : <Badge tone="ok">{tx("automatique : toutes les {0} h", cfg.every_h)}</Badge>;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Familles de découvertes")}>
        {GROUPS.map((g) => {
          const n = todoOf(disc, g);
          return (
            <button key={g.id} type="button" onClick={() => setTab(g.id)} aria-current={current === g.id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                current === g.id ? "bg-card text-txt shadow-[inset_0_-2px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
              <g.Icon size={15} strokeWidth={1.75} aria-hidden />{g.title}
              {n > 0 && <Badge tone="warn">{n}</Badge>}
            </button>
          );
        })}
      </nav>
      <DiscoveryPanel d={disc} group={group} reload={reloadDisc} machines={snap.data.machine_list} extra={(x, slot) => (x.id === "hosts" ? hostsList(slot) : null)} />
      {current === "services" && <Card><p className="text-sm text-muted">{tx("Les applis reconnues se relient dans")} <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a>.</p></Card>}
      {current === "backups" && <Card><p className="text-sm text-muted">{tx("Les dossiers et jeux de sauvegarde se règlent dans")} <a className="text-link hover:underline" href="#settings/backups">{tx("Réglages → Sauvegardes")}</a>.</p></Card>}
      {current === "network" && <>
      {!hasHostsItem && (   // aucune machine à choisir dans les découvertes : la liste (scan, déjà ajoutées, ignorées) reste ici
        <div id="net-hosts" className="scroll-mt-20">
          <Card>
            <h2 className="mb-1 flex items-center gap-2 font-bold"><Radar size={16} />{tx("Machines trouvées sur le réseau")}</h2>
            {hostsList()}
          </Card>
        </div>
      )}
      <div id="net-scan" className="grid scroll-mt-20 items-start gap-4 lg:grid-cols-2">
        <Card className="scroll-mt-20">
          <h2 className="mb-1 flex items-center gap-2 font-bold"><Search size={16} />{tx("Recherche sur le réseau")}</h2>
          <p className="mb-3 text-sm text-muted">
            {tx("Cherche les machines allumées sur votre réseau local (un /24 au plus) : un ping, le nom, quelques ports. Lecture seule, rien n'est ajouté tout seul.")}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {state}
            {last ? <span className="text-dim">{tx("dernière :")} {dateTime(last)} · {scan.found.length} {tx("appareils")}</span> : <Dim>{tx("aucune recherche faite")}</Dim>}
            {next && !running && <span className="text-dim">{tx("prochaine à partir de {0}", dateTime(next))}</span>}
            {running && <Badge tone="info">{tx("en cours")}</Badge>}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={running}
              onClick={() => void act(async () => { await send("POST", "network/scan"); pokeScan(); }, tx("recherche lancée"), setNote).then(() => load())}>
              <Search size={14} />{running ? tx("Recherche en cours…") : tx("Lancer une recherche maintenant")}
            </button>
            <button type="button" className={`${button} border-link/60 bg-link/10 text-txt hover:bg-link/20`} onClick={reopenFirstSteps} title={tx("Rouvre la carte et efface vos choix « Passer »")}>
              <ListChecks size={14} />{tx("Revoir les premiers pas")}
            </button>
          </div>
          <form className="flex flex-wrap items-end gap-2 border-t border-line/60 pt-3" onSubmit={(e) => { e.preventDefault(); if (valid) void save(n); }}>
            <label className="flex flex-col gap-1 text-xs text-dim">{tx("Fréquence automatique (heures, 0 = coupée)")}
              <input className={`${input} w-40`} type="number" min={0} max={cfg.max_h} step={1} value={hours} disabled={cfg.fixed}
                onChange={(e) => setHours(e.target.value)} title={cfg.fixed ? tx("fixée par la variable d'environnement du conteneur") : tx("défaut : {0}", cfg.default_h)} />
            </label>
            {!cfg.fixed && <button className={quiet} disabled={!valid || n === cfg.every_h}>{tx("Enregistrer")}</button>}
            {!cfg.fixed && cfg.every_h !== cfg.default_h && (
              <button type="button" className={quiet} title={tx("défaut : {0}", cfg.default_h)} aria-label={tx("Remettre la valeur par défaut")} onClick={() => void save(cfg.default_h)}><RotateCcw size={14} /></button>
            )}
          </form>
          {cfg.fixed && <p className="mt-1 text-xs text-dim">{tx("Fixée par MYSERVICES_NETSCAN_EVERY dans le compose.")}</p>}
          {!valid && hours !== "" && <p className="mt-1 text-xs text-warn">{tx("Un nombre entier de 0 à {0}.", cfg.max_h)}</p>}
          <p className="mt-2 text-xs text-dim">{tx("Le premier scan est toujours lancé à la main ; l'automatique ne démarre qu'après lui.")}</p>
          <NoteLine note={note} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-1 font-bold">{tx("Réseaux et discrétion")}</h2>
            <p className="mb-3 text-sm text-muted">{tx("Par défaut, le réseau de la machine hôte. Vous pouvez en indiquer plusieurs (un /24 au plus chacun), séparés par une virgule.")}</p>
            <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void saveNets(); }}>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-dim">{tx("Réseaux à parcourir")}
                <input className={`${input} w-full font-mono`} value={netsText} placeholder={scan.net || "192.168.1.0/24"} onChange={(e) => setNets(e.target.value)} />
              </label>
              <button className={quiet} disabled={nets === null}>{tx("Enregistrer")}</button>
              {cfg.nets.length > 0 && <button type="button" className={quiet} onClick={() => { setNets(""); }}>{tx("Revenir au réseau de l'hôte")}</button>}
            </form>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={cfg.discreet} onChange={(e) => void saveDiscreet(e.target.checked)} />
              <span><b>{tx("Mode discret")}</b> <Dim>{tx("— ne lit ni le TTL du ping ni l'adresse MAC : le système des machines n'est alors plus deviné par là.")}</Dim></span>
            </label>
          </Card>
        </div>
      </div>
      </>}
    </div>
  );
}
