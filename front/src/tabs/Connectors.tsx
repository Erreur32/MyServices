// Réglages → Connecteurs : services lus par leur API (NPM, Beszel, Uptime Kuma, Dozzle, Web-Check…), en
// lecture seule. Formulaire généré depuis les champs déclarés par chaque connecteur, bouton Tester (sans
// enregistrer), état au dernier passage. Ce qui est lu par SSH (Docker, process, AdGuard) : section Machines.
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ExternalLink, EyeOff, HelpCircle, Loader2, Package, Plug, Plus, RotateCcw, ScanSearch, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { Overlay } from "../components/Overlay";
import { Copyable, Field, NoteLine, Switch } from "../components/form";
import { IconChoice } from "../components/IconChoice";
import { SecretInput } from "../components/SecretInput";
import { CameraAccounts } from "../components/CameraAccounts";
import { act, danger, fieldFrame, fieldText, input, primary, quiet, type Note } from "../lib/forms";
import { FoldPanel } from "../components/FoldPanel";
import { Badge, Card, Count, Dim, SearchBox, Th } from "../components/ui";
import { StatusLine } from "../components/ssh";
import { useCollectTask } from "../components/ScheduleCard";
import { useDiscoveries } from "../components/DiscoveryCard";
import type { AgentInfo, AgentsState, ConnectorField, ConnectorInstance, ConnectorMode, ConnectorsState, ConnectorStatus, ConnectorType, Host, Machine, MachinesSettings, Proposal, ScriptTip, Service, SshAlias, TapoDevice } from "../types";
import { cardNotice, cardsTitle, cardView, noticeTip, READ, TOOL, type CardNotice, type CardTone, type CardView } from "../lib/connectorCards";
import { agentSummary } from "../lib/accessLists";
import { configFor, modeOf, npmAgent } from "../lib/connectorModes";
import { readConnector, RereadButton } from "../components/Reread";
import { pointedHits, takeFocus, takePointed, takePrefill, type Prefill } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";
import { searchHit, useSort } from "../lib/filter";
import { savedFor } from "../lib/savedFor";
import { runningTip, stoppedTip } from "../lib/runState";
import { serviceAt, setupCommand } from "../lib/connectorSetup";
import { detectedValue, type DetectedValue } from "../lib/detectedValue";
import { appIcon } from "../lib/appIcons";
import { InfoNote } from "../components/InfoNote";
import { MachineIcon } from "../components/MachineIcon";

const KIND: Record<string, string> = {
  services: "services", health: tx("santé"), logs: tx("Docker · journaux"), dns: "DNS", inventory: "inventaire", backups: "sauvegardes", network: tx("réseau"), security: tx("sécurité"), containers: "Docker",
};

// Proposé depuis « Premiers pas » : lu une seule fois, à l'ouverture de l'onglet
/** Sub-page of Connectors in the address (#settings/connectors/available): my connectors, the catalogue, or the services found on the network */
export type ConnectorsPart = "mine" | "available" | "detected" | "read";
const PARTS: ConnectorsPart[] = ["available", "detected", "read"];
export const connectorsPart = (v?: string): ConnectorsPart => {
  if (v === "apps") return "detected";   // « apps »: the former Recognised apps, merged here
  return PARTS.find((p) => p === v) ?? "mine";
};
const RUN_RANK: Record<string, number> = { true: 0, false: 2 };
const MINE = "settings/connectors";
const OFF = "*off";   // filters of « My connectors », beside the categories
const listState = { view: "", find: "" };   // the filter and search of « My connectors », found again when back from a connector's page (Settings is mounted again on each address)
/** The address of a connector's own page */
const pageOf = (i: { type: string; name: string }) => `#${MINE}/${i.type}/${encodeURIComponent(i.name)}`;
// The page that shows what a connector reads
const PAGE: Record<string, string> = {
  cloudflare: "cloudflare/overview", netatmo: "domotique/netatmo", tapo: "domotique/tapo", mynetwork: "network", unifi: "network", freebox: "network", "upnp-box": "network", fritzbox: "network", sfrbox: "network", livebox: "network", "vodafone-station": "network", "sagemcom-fast": "network", bbox: "network", "swisscom-box": "network", "connect-box": "network", "liberty-gateway": "network", "speedport": "network", "technicolor-gateway": "network", "tmobile-home-internet": "network", "hitron-coda": "network", "verizon-fios": "network", "arris-surfboard": "network", "openwrt": "network", "mikrotik": "network", "asus-router": "network", "tplink-router": "network", logviewr: "security", wazuh: "security", npm: "services",
  ollama: "ai", "open-webui": "ai", hermes: "ai", gpuviewr: "ai", frigate: "stream", reolink: "stream", onvif: "stream",
};
const BRANDS: Record<string, string> = { onvif: "Abus Hikvision Dahua Axis Amcrest Foscam Hanwha Uniview Annke Lorex" };   // camera makers without their own connector: their search finds ONVIF
const DOT: Record<CardTone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", off: "bg-dim", info: "bg-link" };
const CHIP: Record<CardTone, string> = { ok: "", warn: "!border-warn/60 !text-warn", bad: "!border-bad/60 !text-bad", off: "", info: "!border-link/60 !text-link" };
const TAG: Record<CardTone, string> = { ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad", off: "bg-dim/15 text-muted", info: "bg-link/15 text-link" };   // the « Reading » tag of a connector's page
const TEXT: Record<CardTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", off: "text-muted", info: "text-link" };

/** Tools already read over SSH or by an agent on a followed machine (AdGuard, Proxmox, ESXi, KVM, Hyper-V…): a connector would add nothing */
function ReadElsewhere({ list, types, collect }: Readonly<{ list: ConnectorStatus[]; types: ConnectorType[]; collect: ReturnType<typeof useCollectTask> }>) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-bold"><Plug size={16} aria-hidden />{tx("Déjà lus par SSH ou agent")} <Count n={list.length} /></h2>
      <InfoNote className="mt-1">{tx("Trouvés sur une machine suivie et lus par SSH ou par l'agent (AdGuard, Proxmox, ESXi, KVM, Hyper-V…) : inutile de les ajouter comme connecteur. Un connecteur n'apporte quelque chose que s'il lit une API que la machine ne montre pas.")}</InfoNote>
      {list.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucun outil lu de cette façon pour l'instant.")}</p>}
      <ul className="mt-2 flex flex-col divide-y divide-line/60">
        {list.map((o) => {
          const label = types.find((t) => t.type === o.type)?.label ?? o.label ?? o.type, icon = appIcon([label]);
          return (
            <li key={`${o.type}/${o.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">{icon ? <img src={icon} alt="" className="h-5 w-5" /> : <Plug size={16} className="text-muted" aria-hidden />}</span>
              <b>{label}</b><Dim>· {o.name}</Dim><Badge tone="off">{o.via === "agent" ? tx("agent") : "SSH"}</Badge>
              <span className="ml-auto"><StatusLine s={o} collect={collect} /></span>
              <a href="#machines" className="text-xs text-link hover:underline">{tx("Machines")} ›</a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function Connectors({ snap, part }: Readonly<{ snap: Snapshot; part: ConnectorsPart }>) {
  const [prefill] = useState(takePrefill);
  const [focusKey] = useState(takeFocus);   // « type/nom » du connecteur à montrer (venu de Réglages → Agents)
  const [st, setSt] = useState<ConnectorsState | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string>(() => prefill?.type ?? "");
  const [, , openType, openName] = location.hash.slice(1).split("/");   // #settings/connectors/<type>/<name>: that connector's own page, alone
  const openKey = part === "mine" && openType && openName ? `${openType}/${decodeURIComponent(openName)}` : "";
  const [dirty, setDirty] = useState(false), [leaving, setLeaving] = useState(false);   // settings changed and not saved: leaving the page asks first
  const [pointed] = useState(takePointed), [only, setOnly] = useState<string[]>([]), pointing = useRef(true);   // the connector button of a page: its connector opened, or its connectors alone
  const [linking, setLinking] = useState<Proposal | null>(null);   // service détecté à activer : son formulaire prend la place de la liste
  const [saved, setSaved] = useState<string[]>([]);   // detected services just activated: hidden at once, before any reload
  const [cat, setCat] = useState(""), [query, setQuery] = useState("");   // category and search of the picker (empty: all)
  const [view, setView] = useState(listState.view), [find, setFind] = useState(listState.find);   // filter and search of my connectors
  useEffect(() => { listState.view = view; listState.find = find; }, [view, find]);
  const [srcNote, setSrcNote] = useState<Note>(null), [changed, setChanged] = useState(false), [srcKey, setSrcKey] = useState(""), [toggling, setToggling] = useState("");   // toggling: the connector whose switch waits for the answer
  const collect = useCollectTask();
  const reload = useCallback(() => {
    read<ConnectorsState>("connectors/settings")
      .then((s) => {
        setSt(s); setError("");
        if (!pointing.current) return;
        pointing.current = false;
        const hits = pointedHits(s.instances, s.types, pointed), focused = s.instances.find((i) => `${i.type}/${i.name}` === focusKey);
        if (focused || hits.length === 1) location.replace(pageOf(focused ?? hits[0]));
        else if (pointed.category) setView(pointed.category);
        else if (hits.length > 1) setOnly(pointed.types);
      })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, [pointed, focusKey]);
  useEffect(reload, [reload, snap.data.generated]);   // read again when a collection ends: states and versions up to date without F5

  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const type = st.types.find((t) => t.type === adding);
  // Read over SSH or by an agent because a machine declares it (AdGuard, Proxmox by pvesh, Hyper-V): nothing to add for them
  const readElsewhere = st.others.filter((o) => o.via === "ssh" || o.via === "agent" || st.types.some((t) => t.type === o.type));
  const picking = part === "available";
  const activating = linking ? st.types.find((t) => t.type === linking.connector) : undefined;
  const key = (i: ConnectorInstance) => `${i.type}/${i.name}`;
  const cardOf = (i: ConnectorInstance) => snap.data.services_status?.find((c) => c.connector === i.type && c.name === i.name);
  const views = new Map(st.instances.map((i) => [key(i), cardView(i, cardOf(i))]));
  const typeOf = (i: ConnectorInstance) => st.types.find((t) => t.type === i.type)!;
  const sourced = (src: string) => st.instances.filter((i) => views.get(key(i))!.source === src).length, stopped = st.instances.filter((i) => !i.enabled).length, failing = [...views.values()].some((v) => v.tone === "bad");
  const kept = (i: ConnectorInstance) => {
    if (only.length && !only.includes(i.type)) return false;
    if (view === READ) return views.get(key(i))!.source === "read";
    if (view === TOOL) return views.get(key(i))!.source === "tool";
    if (view === OFF) return !i.enabled;
    return !view || typeOf(i).category === view;
  };
  const listed = st.instances.filter((i) => kept(i) && searchHit(`${i.label} ${i.name} ${i.type}`, find))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name));   // alphabetical, like the picker
  const back = () => { setLeaving(false); location.hash = `#${MINE}`; };
  const leave = () => (dirty ? setLeaving(true) : back());
  const card = (i: ConnectorInstance, open: boolean) => (
          <InstanceCard key={`${i.type}/${i.name}`} inst={i} view={views.get(key(i))!} hosts={snap.data.hosts} devices={cardOf(i)?.devices} collect={collect} type={typeOf(i)} reload={reload}
            toggling={toggling === `${i.type}/${i.name}`} toggleNote={srcKey === `${i.type}/${i.name}` ? srcNote : null} onForce={() => void act(() => send("PATCH", `connectors/settings/${i.type}/${encodeURIComponent(i.name)}`, { enabled: true, force: true }),
              tx("allumé sans test : relecture lancée"), setSrcNote).then((ok) => { if (ok) { setChanged(true); reload(); } })}
            onCollect={(on) => { setSrcKey(`${i.type}/${i.name}`); setSrcNote(null); setToggling(`${i.type}/${i.name}`); void act(() => send("PATCH", `connectors/settings/${i.type}/${encodeURIComponent(i.name)}`, { enabled: on }),
              on ? tx("allumé : relecture lancée") : tx("coupé : réglages gardés, plus rien de lu"), setSrcNote).then((ok) => { setToggling(""); if (ok) { setChanged(true); reload(); } }); }}
            open={open} locked={picking || !!adding} onOpen={() => { location.hash = pageOf(i); }} onClose={back} onLeave={leave} onDirty={setDirty} />
  );
  const mine = (<div className="mt-5 grid grid-flow-dense gap-x-2.5 gap-y-4 [grid-template-columns:repeat(auto-fill,minmax(max(min(100%,18rem),calc((100%_-_3.125rem)/6)),1fr))]">
        {only.length > 0 && <button type="button" className="col-span-full justify-self-start text-sm font-semibold text-link hover:underline" onClick={() => setOnly([])}>{tx("Voir tous mes connecteurs")}</button>}
        {listed.length === 0 && <p className="col-span-full py-4 text-center text-sm text-muted">{tx("Aucun connecteur ne correspond.")}</p>}
        {listed.map((i) => card(i, false))}
        {changed && (
          <div className="col-span-full flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg2/40 px-4 py-3 text-sm text-muted">
            {tx("Pris en compte à la prochaine collecte.")}
            <button type="button" className={primary}
              onClick={() => void act(() => send("POST", "system/tasks/collect/run"), tx("collecte lancée : la page se met à jour à la fin"), setSrcNote)}>
              {tx("Lancer la collecte maintenant")}
            </button>
          </div>
        )}
        </div>);
  const done = () => { setAdding(""); reload(); if (picking) location.hash = MINE; };   // a connector added from the catalogue: back to « My connectors »
  const opened = openKey ? st.instances.find((i) => key(i) === openKey) : undefined;
  if (opened) return (   // the connector's own page: its state, where a warning comes from, what it reads and its settings, without the other cards
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" className={quiet} onClick={leave}><ArrowLeft size={15} aria-hidden />{tx("Retour")}</button>
        <button type="button" className={`${quiet} ml-auto`} onClick={leave}><X size={15} aria-hidden />{tx("Fermer")}</button>
      </div>
      {leaving && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/50 bg-warn/10 px-4 py-2.5 text-sm">
          {tx("Quitter sans enregistrer ? Les réglages modifiés seront perdus.")}
          <button type="button" className={danger} onClick={back}>{tx("Quitter")}</button>
          <button type="button" className={quiet} onClick={() => setLeaving(false)}>{tx("Rester")}</button>
        </div>
      )}
      {card(opened, true)}
    </div>
  );
  const form = type && <ConnectorForm key={type.type} type={type} hosts={snap.data.hosts} prefill={prefill?.type === type.type ? prefill : null} onSaved={reload} onDone={done} onCancel={() => setAdding("")} />;
  return (
    <div className="flex flex-col gap-4">
      {part === "mine" && <FoldPanel icon={Plug} title={tx("Mes connecteurs")} pinned
        extra={st.instances.length > 0 && <span className="min-w-0 text-xs leading-tight text-muted">{cardsTitle([...views.values()]).split(/(\d+)/).map((part, i) => (i % 2 ? <b key={part + i} className="text-sm text-txt">{part}</b> : part))}</span>}
        center={st.instances.length > 0 && <SearchBox value={find} onChange={setFind} placeholder={tx("Chercher un connecteur")} count={[listed.length, st.instances.length]} />}
        end={<a href={`#${MINE}/available`} className={`${primary} no-underline`}><Plus size={14} />{tx("Ajouter un connecteur")}</a>}>
        {form}
        {st.instances.length === 0 && !type && (
          <p className="mt-3 text-sm text-muted">{tx("Aucun connecteur pour l'instant. Cliquez sur « Ajouter un connecteur » : les outils que MyServices sait lire s'affichent en petites cartes.")}</p>
        )}
        {st.instances.length > 0 && <>
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2 [&:not(:first-child)]:mt-3">
            <CategoryChips types={st.instances.map(typeOf)} cat={view} setCat={setView} extra={[[READ, tx("Lecture à revoir"), sourced("read"), failing ? "bad" : "warn"], [TOOL, tx("Signalé par l'outil"), sourced("tool"), "info"], [OFF, tx("Coupés"), stopped, "off"]]} />
          </div>
          {mine}
        </>}
      </FoldPanel>}
      {part === "read" && <ReadElsewhere list={readElsewhere} types={st.types} collect={collect} />}
      {picking && <Card>
        <h2 className="flex items-center gap-2 font-bold"><Plus size={16} />{tx("Connecteurs disponibles")}</h2>
        {form}
        {!type && (
          <label className={`mt-3 flex max-w-md items-center gap-2 px-3 py-2 ${fieldFrame}`}>
            <Search size={16} className="text-field-txt/75" aria-hidden />
            <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx("Chercher un connecteur (nom, catégorie…)")}
              className={`w-full bg-transparent ${fieldText}`} />
          </label>
        )}
        {!type && <CategoryChips types={st.types} cat={cat} setCat={setCat} />}
        {!type && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={tx("Connecteurs disponibles")}>
            {st.types.filter((t) => (!cat || t.category === cat) && searchHit([t.label, t.type, BRANDS[t.type] ?? "", catName(t.category ?? ""), ...t.kinds.map((k) => KIND[k] || k)].join(" "), query))
              .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })).map((t) => {
              const icon = appIcon([t.label]), n = st.instances.filter((i) => i.type === t.type).length, ssh = readElsewhere.filter((o) => o.type === t.type).length;
              return (
                <li key={t.type}>
                  <button type="button" onClick={() => setAdding(t.type)}
                    className="flex h-full w-full items-center gap-3 rounded-xl border border-dim/50 bg-bg2 p-3 text-left transition-colors hover:border-link hover:bg-link/10">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card">
                      {icon ? <img src={icon} alt="" className="h-6 w-6" /> : <Plug size={18} className="text-muted" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm text-txt">{t.label}</b>
                      <span className="block truncate text-xs text-dim">{t.kinds.map((k) => KIND[k] || k).join(" · ")}{n > 0 && ` · ${tx("{0} déjà", n)}`}</span>
                      {ssh > 0 && <span className="block truncate text-xs font-semibold text-ok" title={tx("Déjà lu par SSH sur sa machine : un connecteur ferait doublon, sauf pour un autre serveur")}>{tx("déjà lu par SSH ({0})", ssh)}</span>}
                    </span>
                    <Plus size={15} className="shrink-0 text-dim" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>}
      {part === "detected" && !activating && <DetectedServices apps={(snap.data.detected_apps ?? []).filter((p) => !saved.includes(discoveryId(p)))} instances={st.instances} types={st.types}
        machines={snap.data.machine_list} dockerOk={new Set((snap.data.connectors ?? []).filter((c) => c.type === "docker" && c.ok && c.ip).map((c) => c.ip!))} onOpen={setLinking} />}
      {part === "detected" && activating && linking && (   // a found service to link: its form in the page, in place of the list
        <Card>
          <h2 className="flex items-center gap-2 font-bold">{appIcon([linking.label]) && <img src={appIcon([linking.label])!} alt="" className="h-6 w-6" />}{tx("Activer")} {linking.label} <Dim>· {linking.machine || linking.ip}</Dim></h2>
          <ConnectorForm key={linking.connector} type={activating} prefill={{ type: linking.connector, name: linking.connector, url: linking.url }}
            found={snap.data.hosts.find((h) => String(h.id) === String(linking.service))?.service} hosts={snap.data.hosts}
            onSaved={() => { setSaved((x) => [...x, discoveryId(linking)]); reload(); }}
            onDone={() => { setLinking(null); reload(); }} onCancel={() => setLinking(null)} />
        </Card>
      )}


    </div>
  );
}

/** Every word of the search found in one of the texts (accents and case ignored) */

// Categories sent by the server (connectors/settings.py: category), translated here
const CATEGORY: Record<string, string> = {
  "Infra / virtualisation": tx("Infra / virtualisation"), Monitoring: tx("Monitoring"), "Réseau / DNS": tx("Réseau / DNS"), Médias: tx("Médias"),
  Sauvegardes: tx("Sauvegardes"), Domotique: tx("Domotique"), "Fichiers / sync": tx("Fichiers / sync"), IA: tx("IA"), Outils: tx("Outils"),
  Système: tx("Système"), Sécurité: tx("Sécurité"), "Web / perso": tx("Web / perso"), Autre: tx("Autre"),
};
const catName = (c: string) => CATEGORY[c] ?? c;

/** Picker filter: one chip per category, with its count, alphabetical */
function CategoryChips({ types, cat, setCat, extra = [] }: Readonly<{ types: ConnectorType[]; cat: string; setCat: (c: string) => void; extra?: [string, string, number, CardTone][] }>) {
  const counts = new Map<string, number>();
  for (const t of types) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => catName(a).localeCompare(catName(b)));
  const more = extra.filter(([, , n]) => n > 0);
  if (cats.length < 2 && !more.length) return null;
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`;
  return (
    <fieldset className={`flex flex-wrap gap-1.5 ${extra.length ? "" : "mt-3"}`} aria-label={tx("Catégorie")}>
      <button type="button" className={chip(!cat)} aria-pressed={!cat} onClick={() => setCat("")}>{tx("Toutes")} <b className="text-dim">{types.length}</b></button>
      {more.map(([id, label, n, tone]) => <button key={id} type="button" className={`${chip(cat === id)} ${CHIP[tone]}`} aria-pressed={cat === id} onClick={() => setCat(cat === id ? "" : id)}><span className={`h-2 w-2 rounded-full ${DOT[tone]}`} aria-hidden />{label} <b>{n}</b></button>)}
      {cats.map((c) => <button key={c} type="button" className={chip(cat === c)} aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>{catName(c)} <b className="text-dim">{counts.get(c)}</b></button>)}
    </fieldset>
  );
}

/** Réponse de l'essai d'un connecteur : message, version et ce que la lecture a rapporté (preuve que le connecteur lit vraiment) */
interface TestOut { ok: boolean; message: string; version: string | null; version_tested: boolean | null; found?: { name: string; count: number }[] }

/** One help step: its first line is the text, the following lines (when there are some) a command to copy */
function GuideStep({ step }: Readonly<{ step: string }>) {
  const [text, ...code] = step.split("\n");
  return <li>{text}{code.length > 0 && <div className="mt-1.5"><Copyable text={code.join("\n")} oneLine /></div>}</li>;
}

async function runTest(type: string, body: unknown): Promise<TestOut> {
  try {
    return await send<TestOut>("POST", `connectors/settings/${type}/test`, body);
  } catch (e) {
    if (e instanceof LoginRequired) location.replace(LOGIN);
    return { ok: false, message: (e as Error).message, version: null, version_tested: null };
  }
}

/** Résultat d'un essai : cadre vert ou rouge, version, puis une pastille par type d'information lue */
function TestReport({ r, onClose }: Readonly<{ r: TestOut; onClose: () => void }>) {
  const total = (r.found ?? []).reduce((n, f) => n + f.count, 0);
  return (
    <div role="status" className={`mt-3 rounded-xl border px-3 py-2 text-sm ${r.ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5"}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={`min-w-0 flex-1 break-words ${r.ok ? "text-ok" : "text-bad"}`}>{r.ok ? "✓" : "⚠"} {r.ok ? tx("Lecture réussie") : tx("Échec")} · <span className="text-muted">{r.message}</span></span>
        <button type="button" className="rounded-md p-1 text-sm text-muted hover:bg-bg2 hover:text-txt" onClick={onClose} aria-label={tx("Fermer")}>✕</button>
      </div>
      {r.ok && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {r.version && <Badge tone={r.version_tested === false ? "warn" : "info"} title={r.version_tested === false ? tx("Version non testée : l'API a pu changer") : undefined}>{tx("version {0}", r.version)}{r.version_tested === false ? ` · ${tx("non testée")}` : ""}</Badge>}
          {(r.found ?? []).map((f) => <Badge key={f.name} tone={f.count ? "ok" : "off"}>{f.name} : {f.count}</Badge>)}
          {!(r.found ?? []).length && <Dim>{tx("connexion réussie, aucun détail renvoyé")}</Dim>}
          {total === 0 && (r.found ?? []).length > 0 && <Dim>{tx("connexion réussie mais rien à lire pour l'instant")}</Dim>}
        </div>
      )}
    </div>
  );
}

/** Les applis reconnues qui ont un connecteur mais pas encore d'accès réglé : une ligne chacune, le clic ouvre le formulaire déjà rempli.
 *  Facultatif (comme les suggestions de Découverte) : cadre replié, à ouvrir quand on veut. Celles déjà reliées n'y sont pas ; rien à montrer, rien d'affiché. */
/** Same id as the discovery of this app (discoveries.py: « connector:<type>@<ip> »), so « Forget » here and in Discovery is one choice */
const discoveryId = (p: Proposal) => `connector:${p.connector}@${p.ip ?? "None"}`;

/** What it brings, then « new » (green) or « already read by … » (grey, the sources in the tooltip) */
function ValueBadges({ v }: Readonly<{ v: DetectedValue }>) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {v.brings.map((b) => <Badge key={b} tone="off">{b}</Badge>)}
      {v.coveredBy.length
        ? <Badge tone="off" title={tx("Ces données sont déjà lues par : {0}. L'activer ne servirait qu'en complément ou en secours.", v.coveredBy.join(", "))}>{tx("déjà lu par {0}", v.coveredBy.join(", "))}</Badge>
        : <Badge tone="ok" title={tx("Aucune autre source ne donne ces données : l'activer les ajoute.")}>{tx("nouveau")}</Badge>}
    </span>
  );
}

function DetectedServices({ apps, instances, types, machines, dockerOk, onOpen }: Readonly<{ apps: Proposal[]; instances: ConnectorInstance[]; types: ConnectorType[];
  machines: Machine[]; dockerOk: Set<string>; onOpen: (p: Proposal) => void }>) {
  const [disc, reloadDisc] = useDiscoveries();
  const [note, setNote] = useState<Note>(null);
  const muted = new Set((disc?.items ?? []).filter((x) => x.muted).map((x) => x.id));
  // « linked » comes with the next collection (a minute or two): a connector saved a moment ago already hides its row
  const all = apps.filter((p) => !p.linked && !savedFor(p, instances));
  // running containers first: docker ps -a also lists stopped ones, which have nothing to read until they run again
  const value = new Map(all.map((p) => [discoveryId(p), detectedValue(p, types.find((t) => t.type === p.connector)?.kinds ?? [], { machines, instances, dockerOk })]));
  // what nobody reads yet first, then what is already covered; a stopped container last in each
  const rank = (p: Proposal) => (value.get(discoveryId(p))!.coveredBy.length ? 2 : 0) + Number(p.running === false);
  const rows = all.filter((p) => !muted.has(discoveryId(p))).sort((a, b) => rank(a) - rank(b)), forgotten = all.filter((p) => muted.has(discoveryId(p)));
  // every column sorts; by machine at first (equal keys keep the order above: what nobody reads first, a stopped container last)
  const keyOf = (p: Proposal, k: string): string | number => {
    if (k === "service") return p.label.toLowerCase();
    if (k === "state") return RUN_RANK[String(p.running)] ?? 1;   // running, unknown, stopped
    if (k === "value") return rank(p);
    return (p.machine || p.ip || "~").toLowerCase();
  };
  const sort = useSort(rows, keyOf, "machine");
  const forget = (p: Proposal, on: boolean) => void act(() => send("PUT", "discoveries/muted", { id: discoveryId(p), muted: on }),
    on ? tx("{0} oublié : plus proposé", p.label) : tx("{0} rappelé : de nouveau proposé", p.label), setNote).then(() => reloadDisc());
  return (
    <Card>
      <h2 className="flex flex-wrap items-center gap-2 font-bold">
        <ScanSearch size={16} aria-hidden />{tx("Services détectés non configurés")} <Count n={rows.length} />
        <span className="font-normal text-muted">{tx("facultatif : à activer quand vous voulez")}</span>
      </h2>
      {all.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucun service détecté à relier pour l'instant.")}</p>}
      <InfoNote className="mt-1">{tx("MyServices a reconnu ces applis mais ne les lit pas encore. Cliquez sur l'une d'elles pour renseigner son accès en lecture.")}</InfoNote>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr>
              <Th k="service" sort={sort} className="!pl-1">{tx("Service")}</Th><Th k="machine" sort={sort}>{tx("Machine")}</Th><Th k="state" sort={sort}>{tx("État")}</Th>
              <Th k="value" sort={sort} className="!text-right" title={tx("Ce que personne ne lit encore d'abord, puis ce qui est déjà couvert")}>{tx("Activation")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {sort.sorted.map((p) => (
              <tr key={`${p.connector}@${p.ip}`} className={p.running === false ? "opacity-70" : ""}>
                <td className="py-1 pr-3">
                  <button type="button" onClick={() => onOpen(p)} title={tx("Renseigner l'accès et activer")} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-link/10">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2">
                      {appIcon([p.label]) ? <img src={appIcon([p.label])!} alt="" className="h-4 w-4" /> : <Plug size={14} className="text-muted" aria-hidden />}
                    </span>
                    <b className="underline decoration-dotted underline-offset-2">{p.label}</b>
                  </button>
                </td>
                <td className="px-3 py-2.5"><span className="flex items-center gap-2">{(() => { const m = machines.find((x) => x.ip === p.ip); return m ? <MachineIcon m={m} /> : <MachineIcon m={{}} />; })()}
                  <span><b className="font-semibold">{p.machine || p.ip}</b>{p.machine && <Dim> · {p.ip}</Dim>}</span></span></td>
                <td className="px-3 py-2.5">{p.running === true ? <Badge tone="ok" title={runningTip(p.state)}>{tx("actif")}</Badge>
                  : p.running === false ? <Badge tone="off" title={stoppedTip(p.state)}>{tx("arrêté")}</Badge> : <Dim>-</Dim>}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center gap-2">
                    <ValueBadges v={value.get(discoveryId(p))!} />
                    <button type="button" className={primary} onClick={() => onOpen(p)}><Plus size={14} />{tx("Activer")}</button>
                    <button type="button" className={quiet} onClick={() => forget(p, true)} title={tx("Ne plus le proposer, ni dans la cloche ni sur l'accueil. Il reste dans « Oubliés » pour le rappeler plus tard.")}><EyeOff size={14} />{tx("Oublier")}</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {forgotten.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3 text-sm">
          <span className="inline-flex items-center gap-1.5 text-dim"><EyeOff size={14} aria-hidden />{tx("Oubliés")} <Count n={forgotten.length} /></span>
          {forgotten.map((p) => (
            <span key={discoveryId(p)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg2/50 py-0.5 pl-2.5 pr-1">
              {p.label} <Dim>{p.machine || p.ip}</Dim>
              <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-link hover:bg-link/10" onClick={() => forget(p, false)}>
                <RotateCcw size={12} aria-hidden />{tx("Rappeler")}</button>
            </span>
          ))}
        </div>
      )}
      <NoteLine note={note} />
    </Card>
  );
}

/** What happened when the collection was turned on or off, in the card of that connector; a failed safety test opens in a window over the page, with a
 *  way to turn it on anyway, and stays in the card (same frame) once the window is closed */
function ToggleNote({ note, onForce }: Readonly<{ note: Note; onForce?: () => void }>) {
  const [closed, setClosed] = useState<Note>(null);
  if (!note) return null;
  if (note.ok) return <NoteLine note={note} />;
  const untested = note.text.includes("collecte non allumée");
  const force = untested && onForce ? <button type="button" className={`${quiet} mt-2`} onClick={onForce}>{tx("Rallumer quand même (sans test)")}</button> : null;
  return (
    <>
      {closed !== note && (
        <Overlay title={<>⚠ {tx("Attention")}</>} onClose={() => setClosed(note)}>
          <p className="mt-3 text-sm text-bad">{note.text}</p>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">{force}<button type="button" className={primary} onClick={() => setClosed(note)}>{tx("OK")}</button></div>
        </Overlay>
      )}
      <InfoNote tone="warn" open className="mt-2"><span className="block">{note.text}</span>{force}</InfoNote>
    </>
  );
}

/** The outline of a card: blue while it is open or pointed at, else the colour of its state */
function cardRing(active: boolean, tone: CardTone): string {
  if (active) return "border-link ring-2 ring-link";
  if (tone === "bad") return "border-bad/60";
  if (tone === "info") return "border-link/40";
  return tone === "warn" ? "border-warn/50" : "border-dim/50";
}

function openTip(locked: boolean): string {
  return locked ? tx("Un autre formulaire est ouvert : terminez-le ou annulez-le d'abord") : tx("Ouvrir : infos, adresse, accès et options du connecteur");
}

/** The first line of a card: logo, name, version and state */
function CardHead({ inst, category, view, notice, open }: Readonly<{ inst: ConnectorInstance; category?: string; view: CardView; notice: CardNotice | null; open: boolean }>) {
  const s = inst.status, icon = appIcon([inst.label]), tip = noticeTip(notice, view);
  const sub = [inst.name === inst.type ? "" : inst.name, category ? catName(category) : ""].filter(Boolean).join(" · ");
  return (
    <span className="flex items-center gap-2.5 rounded-t-xl border-b border-line/40 bg-bg px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">
        {icon ? <img src={icon} alt="" className="h-5 w-5" /> : <Plug size={16} className="text-muted" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-sm">{inst.label}</b>
        <span className="block truncate text-xs text-muted" title={sub}>{sub}{s?.version && <>{sub && " · "}<span className={s.version_tested === false ? "text-warn" : ""} title={s.version_tested === false ? tx("version non testée") : undefined}>v{s.version}</span></>}</span>
      </span>
      <span title={tip} data-tip-large className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold ${TEXT[view.tone]} ${tip ? "cursor-help" : ""}`}><span className={`h-2 w-2 rounded-full ${DOT[view.tone]}`} aria-hidden />{view.state}</span>
      {!open && <ChevronDown size={18} className="shrink-0 -rotate-90 text-muted group-hover:text-link" aria-hidden />}
    </span>
  );
}

/** The last line of a card: where it reads and how often; a connector turned off keeps its settings */
function CardWhere({ inst, url }: Readonly<{ inst: ConnectorInstance; url?: string }>) {
  if (!inst.enabled) return tx("Réglages gardés, plus rien de lu");
  return (
    <>
      {url ? <a className="inline-flex max-w-full items-center gap-1 align-bottom text-link hover:underline" href={url} target="_blank" rel="noopener noreferrer" title={url}><span className="truncate">{url.replace(/^https?:\/\//, "")}</span><ExternalLink size={11} className="shrink-0" aria-hidden /></a> : ""}
      {typeof inst.config.every === "number" && inst.config.every > 0 && <span title={tx("Période de lecture propre à ce connecteur")}>{url ? " · " : ""}{tx("toutes les {0} min", inst.config.every)}</span>}
    </>
  );
}

/** A connector that fails or reads old data: what it means, what still holds, what to check first; the words of the tool stay folded */
function CardFix({ notice, kept }: Readonly<{ notice: CardNotice; kept: boolean }>) {
  const { advice, raw } = notice, bad = notice.tone === "bad";
  if (!advice) return null;
  return (
    <section className={`rounded-lg border px-3 py-2 text-sm ${bad ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/10"}`}>
      <h4 className={`flex items-center gap-1.5 font-bold ${TEXT[notice.tone]}`}><AlertTriangle size={14} aria-hidden />{advice.short}</h4>
      <p className="mt-1">{advice.meaning}</p>
      {kept && <p className="mt-1"><b>{tx("Ce qui reste valable")} :</b> {tx("Les chiffres affichés viennent du dernier relevé réussi. Le service lui-même n'est pas forcément en panne.")}</p>}
      <p className="mt-1"><b>{tx("À vérifier d'abord")} :</b> {advice.tip}</p>
      <details className="mt-1.5 text-xs text-muted"><summary className="cursor-pointer">{tx("Message technique")}</summary><p className="mt-1 break-words font-mono">{raw}</p></details>
    </section>
  );
}

/** Where a warning comes from, side by side: the reading by MyServices (the connector), and what the tool itself reports */
function Origin({ inst, view, notice, url }: Readonly<{ inst: ConnectorInstance; view: CardView; notice: CardNotice | null; url?: string }>) {
  const s = inst.status, reading = view.source === "read" && notice;
  const head = (tag: string, title: string, tone: string) => (
    <h4 className="flex items-center gap-2 whitespace-nowrap bg-bg px-3 py-2 text-sm font-bold"><span className={`rounded px-1.5 text-[10px] uppercase tracking-wide ${tone}`}>{tag}</span>{title}</h4>
  );
  let read: ReactNode = <p className="font-semibold text-ok">{tx("Le connecteur fonctionne")}{s?.version && <span className="font-normal text-muted"> · v{s.version}{s.version_tested === false ? ` (${tx("version non testée")})` : ""}</span>}</p>;
  if (!inst.enabled) read = <p className="text-muted">{tx("Coupé : réglages gardés, plus rien de lu")}</p>;
  else if (!s || s.pending) read = <p className="text-muted">{view.state}</p>;
  else if (reading && notice.advice) read = <CardFix notice={notice} kept={view.figures.length > 0} />;
  else if (reading) read = <><p className={`font-semibold ${TEXT[view.tone]}`}>{view.state}</p><p>{notice.text}</p></>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section className="overflow-hidden rounded-lg border border-line">
        {head(tx("Lecture"), tx("Le connecteur, côté MyServices"), TAG[view.source === "read" ? view.tone : "ok"])}
        <div className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">{read}</div>
      </section>
      <section className="overflow-hidden rounded-lg border border-line">
        {head(tx("Outil"), tx("Signalé par {0}", inst.label), "bg-link/15 text-link")}
        <div className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
          {view.problems.length ? <>
            <p className="font-semibold text-link">{view.problems.length > 1 ? tx("{0} points à regarder", view.problems.length) : tx("1 point à regarder")}</p>
            <ul className="list-disc pl-5">{view.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            <p className="text-xs text-muted">{tx("À traiter dans {0}, pas dans MyServices.", inst.label)}</p>
            {url && <a className="inline-flex items-center gap-1 self-start text-xs font-semibold text-link hover:underline" href={url} target="_blank" rel="noopener noreferrer">{tx("Ouvrir {0}", inst.label)}<ExternalLink size={11} aria-hidden /></a>}
          </> : <p className="text-muted">{tx("{0} ne remonte aucun point.", inst.label)}</p>}
        </div>
      </section>
    </div>
  );
}

/** The right column of a connector's page: what the connector reads */
function CardDetail({ view, page }: Readonly<{ view: CardView; page?: string }>) {
  return (
    <>
      {view.facts.length > 0 && <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{tx("Ce que le connecteur lit")}</h4>
          {page && <a href={`#${page}`} className="text-xs font-semibold text-link hover:underline">{tx("Ouvrir la page")}</a>}
        </div>
        <dl className="grid overflow-hidden rounded-lg border border-line bg-bg2 [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]">{/* the negative margins hide the separators on the outer edge */}
          {view.facts.map((f) => <div key={f.label} className="-mb-px -mr-px min-w-0 border-b border-r border-line px-3 py-2"><dd className={`break-words text-sm font-semibold ${f.tone ? TEXT[f.tone] : ""}`}>{f.value}</dd><dt className="text-xs text-muted">{f.label}</dt></div>)}
        </dl>
      </div>}
    </>
  );
}

function InstanceCard({ inst, view, hosts, devices, collect, type, reload, onCollect, toggling, toggleNote, onForce, open, locked, onOpen, onClose, onLeave, onDirty }: Readonly<{
  view: CardView; toggling?: boolean; toggleNote?: Note; onForce?: () => void; inst: ConnectorInstance; hosts: Host[]; devices?: TapoDevice[]; collect: ReturnType<typeof useCollectTask>; type: ConnectorType; reload: () => void; onCollect: (on: boolean) => void;
  open: boolean; locked: boolean; onOpen: () => void; onClose: () => void; onLeave: () => void; onDirty: (d: boolean) => void;   // open: alone on its own page; locked: the add form is open
}>) {
  const [note, setNote] = useState<Note>(null);
  const url = inst.config.url as string | undefined;
  const path = `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}`;
  const s = inst.status;
  const notice = cardNotice(inst, view);
  return (
    <div id={`connector-${inst.type}-${inst.name}`} className="min-w-0"><div className={`flex h-full flex-col rounded-xl border bg-bg2 ${cardRing(open, view.tone)} ${inst.enabled ? "" : "opacity-80"}`}>
      {/* the whole top of the card opens its own page: state, what it reads, its settings and its test, in one place */}
      <button type="button" className="group rounded-t-xl text-left hover:bg-link/10 disabled:cursor-default disabled:hover:bg-transparent" disabled={locked || open}
        title={open ? undefined : openTip(locked)} onClick={onOpen}>
        <CardHead inst={inst} category={type.category} view={view} notice={notice} open={open} />
        {open ? <span className="block h-2" /> : <span className="grid min-h-12 grid-cols-3 gap-2 px-3 pb-1.5 pt-2">{view.figures.map((f) => <Figure key={f.label} f={f} />)}</span>}
      </button>
      <div className="mt-auto flex items-center gap-1 border-t border-dashed border-line/60 py-1 pl-3 pr-2">
        <span className="min-w-0 flex-1 truncate text-xs text-dim"><CardWhere inst={inst} url={url} /></span>
        {inst.enabled && <RereadButton compact label={tx("Relire {0}", inst.label)} tip={tx("Lire ce connecteur maintenant, sans attendre sa période")} run={readConnector(inst.type, inst.name)} onNote={setNote} />}
        <span className="ml-1 flex items-center" title={tx("Le connecteur est lu par le serveur à sa période (voir Modifier) ; coupé, ses réglages sont gardés mais plus rien n'est lu")}>
          <Switch on={inst.enabled} disabled={toggling} label={`${tx("Collecte")} ${inst.label} : ${inst.enabled ? tx("coupé") : tx("activé")}`} onChange={onCollect} />
        </span>
      </div>
      <div className="px-3 empty:hidden">
        {toggling && <output className="inline-flex items-center gap-1.5 pb-2 text-xs text-warn"><Loader2 size={13} className="animate-spin" aria-hidden />{tx("Test de la connexion en cours, cela peut durer une minute…")}</output>}
        <ToggleNote note={toggleNote ?? null} onForce={onForce} />
        {open && <div className="mb-3 mt-1"><Origin inst={inst} view={view} notice={notice} url={url} /></div>}
        {open && <ConnectorForm type={type} inst={inst} hosts={hosts} devices={devices} onDirty={onDirty} aside={<>
          {inst.enabled && (!s || s.pending) && <p className="text-sm"><StatusLine s={s && { ...s, found: [] }} collect={collect} /></p>}
          <CardDetail view={view} page={PAGE[inst.type]} />
        </>} onSaved={reload} onDone={onClose} onCancel={onLeave}
          onDelete={() => void act(() => send("DELETE", path), tx("connecteur supprimé"), setNote).then((ok) => { if (ok) onClose(); })} />}
        <NoteLine note={note} />
      </div>
    </div></div>
  );
}

/** The buttons of a connector's modes: the agent's in green, and pulsing when an agent already reads this service */
function modeLook(picked: boolean, agent: boolean, suggested: boolean): string {
  if (agent && suggested) return "nudge-ok border-ok bg-ok/15 text-ok";
  if (agent) return picked ? "border-ok bg-ok/15 text-txt" : "border-ok/50 text-ok hover:border-ok";
  return picked ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:border-link hover:text-txt";
}

/** A required field stands out, and turns orange while it is empty; an optional one stays in the background */
function fieldBox(need: boolean, empty: boolean): string {
  if (!need) return input;
  return `${input} ${empty ? "!border-warn" : "!border-link/70"}`;
}

function Required({ text }: Readonly<{ text: string }>) {
  return <span className="font-semibold text-txt">{text}<b className="ml-0.5 text-bad" title={tx("requis")} aria-label={tx("requis")}>*</b></span>;
}

function FieldGroup({ title, stacked, children }: Readonly<{ title: string; stacked: boolean; children: ReactNode }>) {
  return <section><h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</h4><div className={`grid gap-x-4 gap-y-3 ${stacked ? "" : "sm:grid-cols-2"}`}>{children}</div></section>;
}

function Figure({ f }: Readonly<{ f: CardView["figures"][number] }>) {
  return (
    <span className="min-w-0" title={`${f.label} : ${f.value}`}>
      <span className={`block truncate text-sm font-semibold tabular-nums ${f.tone ? TEXT[f.tone] : ""}`}>{f.value}</span>
      <span className="block truncate text-[11px] leading-tight text-muted">{f.label}</span>
    </span>
  );
}

type ConfValue = string | number | boolean;
type Conf = Record<string, ConfValue>;

/** « · user@host » after a machine in the list of a field, when it has one */
function aliasTail(a: SshAlias): string {
  const host = a.ip || a.host, user = a.user ? `${a.user}@` : "";
  return a.user || host ? ` · ${user}${host}` : "";
}

/** Choices whose values have a logo (Sonarr, Tailscale…): icon buttons, no menu */
function iconOption(c: string) {
  const src = appIcon([c]);
  return { value: c, label: c.charAt(0).toUpperCase() + c.slice(1), icon: src ? <img src={src} alt="" className="h-7 w-7" /> : <Package size={24} className="text-muted" aria-hidden /> };
}

/** A field with choices: icon buttons when its values have a logo, else a list */
function ChoiceInput({ f, v, box, put }: Readonly<{ f: ConnectorField; v?: ConfValue; box: string; put: (x: ConfValue) => void }>) {
  if (f.choices.some((c) => appIcon([c]))) return <IconChoice label={tx(f.label)} value={String(v ?? f.default ?? "")} onPick={put} options={f.choices.map(iconOption)} />;
  return (
    <select className={box} value={String(v ?? "")} onChange={(e) => put(e.target.value)}>
      {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

/** The input of a field, by its kind; `put` gives its new value */
function FieldInput({ f, v, box, need, kept, inst, picksMachine, aliases, devices, put }: Readonly<{
  f: ConnectorField; v?: ConfValue; box: string; need: boolean; kept: boolean; inst?: ConnectorInstance; picksMachine: boolean; aliases: SshAlias[]; devices: TapoDevice[]; put: (x: ConfValue) => void;
}>) {
  const text = String(v ?? "");
  const reveal = inst ? (password: string) => send<{ value: string }>("POST", `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}/reveal`, { field: f.name, password }).then((r) => r.value) : undefined;
  if (f.kind === "accounts") return <CameraAccounts value={text} kept={kept} reveal={reveal} devices={devices} box={box} put={put} />;
  if (f.kind === "bool") return <input type="checkbox" className="h-4 w-4" checked={!!v} onChange={(e) => put(e.target.checked)} />;
  if (f.name === "ssh" && picksMachine) return (
    <select className={box} value={text} onChange={(e) => put(e.target.value)} required={need}>
      <option value="">{need ? tx("Choisir la machine…") : tx("aucune : dans le conteneur")}</option>
      {aliases.map((a) => <option key={a.alias} value={a.alias}>{a.alias}{aliasTail(a)}</option>)}
    </select>
  );
  if (f.choices.length) return <ChoiceInput f={f} v={v} box={box} put={put} />;
  if (f.secret) return (
    <SecretInput value={text} onChange={put} kept={kept} className={box}
      placeholder={kept ? tx("déjà renseigné : laisser vide pour garder") : ""}
      reveal={reveal} />
  );
  if (f.name === "every") return (   // minutes, within what connectors/base.py period() keeps
    <span className="flex items-center gap-2"><input className={`${box} !w-28`} type="number" inputMode="numeric" min={1} max={1440} step={1} value={text} placeholder={tx("défaut")} onChange={(e) => put(e.target.value)} /><span className="text-sm text-muted">{tx("minutes")}</span></span>
  );
  return (
    <input className={box} type={f.kind === "number" ? "number" : "text"} autoComplete="off"
      value={text} placeholder={String(f.default ?? "")}
      onChange={(e) => put(e.target.value)} />
  );
}

export function ConnectorForm({ type, inst, prefill, found, hosts, devices = [], quietSave = false, aside, onSaved, onDone, onCancel, onDelete, onDirty }: Readonly<{ aside?: ReactNode; onDelete?: () => void; onDirty?: (d: boolean) => void; type: ConnectorType; inst?: ConnectorInstance; devices?: TapoDevice[]; prefill?: Prefill | null; found?: Service; hosts?: Host[]; quietSave?: boolean; onSaved?: () => void; onDone: () => void; onCancel: () => void }>) {
  const [name, setName] = useState(inst?.name || prefill?.name || type.type);
  const [conf, setConf] = useState<Conf>(() => {
    const init: Conf = {};
    for (const f of type.fields) {
      const start = f.name === "verify_tls" && !inst ? false : f.default as ConfValue | null;   // a new connector does not assume a valid certificate
      if (!f.secret) init[f.name] = inst?.config[f.name] ?? (f.name === "url" ? prefill?.url : undefined) ?? start ?? "";
    }
    return init;
  });  // the install is known (found by the scan, or the app at the address typed): its exact command comes first in the help
  const setup = setupCommand(type.type, found ?? serviceAt(conf.url, hosts ?? [], type.type));

  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [help, setHelp] = useState(false);  // help folded: opened by its button, under the buttons
  // Façon de relier le service (NPM : API directe, par SSH, script) : décide des champs montrés, requis et envoyés
  const [mode, setMode] = useState(() => modeOf(type, inst?.config));
  const [start] = useState(() => JSON.stringify([name, conf, mode]));   // what was there on opening: anything else is unsaved
  useEffect(() => onDirty?.(JSON.stringify([name, conf, mode]) !== start), [name, conf, mode, start, onDirty]);
  const modeDef: ConnectorMode | undefined = (type.modes ?? []).find((m) => m.id === mode);
  const noCertificate = !!conf.url && !/^https:/i.test(String(conf.url));   // nothing to verify on a plain address
  const shown = (modeDef ? type.fields.filter((f) => modeDef.fields.includes(f.name)) : type.fields).filter((f) => f.name !== "verify_tls" || !noCertificate);
  const [aliases, setAliases] = useState<MachinesSettings["aliases"]>([]);
  useEffect(() => { if (type.modes?.length) read<MachinesSettings>("machines/settings").then((m) => setAliases(m.aliases)).catch(() => undefined); }, [type.modes]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  useEffect(() => { if (type.type === "npm") read<AgentsState>("agents").then((a) => setAgents(agentSummary(a.agents).live)).catch(() => undefined); }, [type.type]);
  const reader = mode === "agent" ? undefined : npmAgent(agents, conf, aliases);   // this NPM is read twice: the agent is the better way
  const pickMode = (id: string) => {
    setMode(id);
    if (id === "ssh" && !conf.url) setConf((c) => ({ ...c, url: "http://127.0.0.1:81" }));  // vu de la machine de NPM
    if (id === "agent" && reader) setConf((c) => ({ ...c, agent: reader.ip }));
  };
  const body = (collect = true) => ({ name, config: configFor(type, mode, conf), original: inst?.name ?? null, collect });
  const [report, setReport] = useState<TestOut | null>(null);
  const tryIt = async () => {
    setBusy(true); setNote(null);
    setReport(await runTest(type.type, body()));
    setBusy(false);
  };
  // collect false: « Save without collection » (service down, set up ahead): no test, the collection stays off
  const save = async (collect: boolean) => {
    setBusy(true);
    let off = "";   // saved with the collection off (test failed, or asked): server message
    const ok = await act(async () => {
      const r = await send<{ enabled?: boolean; failed?: boolean; message?: string }>("PUT", `connectors/settings/${type.type}`, body(collect));
      if (r?.enabled === false) off = r.message ?? "";
      if (r?.failed) {   // the reason comes from the test route (the saved settings: secrets left empty are the saved ones)
        const why = await runTest(type.type, { ...body(collect), original: name });
        if (why.message) off = `${off} (${why.message})`;
      }
    }, quietSave ? "" : tx("enregistré : relecture lancée, l'état se met à jour dans une minute"), setNote);
    setBusy(false);
    if (ok) onSaved?.();   // saved: the lists update now, without waiting for the form to close
    if (ok && off) { setNote({ ok: !collect, text: off }); setTimeout(onDone, 4000); }
    else if (ok) quietSave ? onDone() : setTimeout(onDone, 900);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(true); };
  const needed = (f: ConnectorField) => (modeDef ? modeDef.required.includes(f.name) : f.required);
  const renderField = (f: ConnectorField) => {
    const kept = inst && f.secret && inst.set[f.name];
    const v = conf[f.name];
    const need = needed(f), box = fieldBox(need, !kept && (v === undefined || v === ""));
    const input = <FieldInput f={f} v={v} box={box} need={need} kept={!!kept} inst={inst} picksMachine={!!modeDef} aliases={aliases} devices={devices} put={(x) => setConf({ ...conf, [f.name]: x })} />;
    const help = f.help && <span className="text-xs text-dim">{tx(f.help)}</span>;
    if (f.kind === "bool") return <div key={f.name} className="flex flex-col gap-1"><label className="flex items-center gap-2 text-sm text-muted">{input}{tx(f.label)}</label>{help}</div>;
    return <Field key={f.name} label={need ? <Required text={tx(f.label)} /> : tx(f.label)}>{input}{help}</Field>;
  };
  const fields = <>
      {modeDef && (
        <div className="flex flex-col gap-2.5">
          <span className="text-sm text-muted">{tx("Comment MyServices lit ce service")}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tx("Comment MyServices lit ce service")}>
            {(type.modes ?? []).map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => pickMode(m.id)}
                className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-1.5 text-center text-sm font-semibold ${modeLook(mode === m.id, m.id === "agent", !!reader)}`}>{tx(m.label)}</button>
            ))}
          </div>
          {reader && <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm">{tx("L'agent de {0} lit déjà ce NPM. Choisissez « Agent Machine » : plus besoin du SSH ni du compte NPM ici, et NPM n'est plus lu deux fois.", reader.name)}</p>}
          <InfoNote>{tx(modeDef.help)}</InfoNote>
        </div>
      )}
      <FieldGroup title={tx("Obligatoire")} stacked={!!inst}>
        <Field label={<Required text={tx("Nom de l'instance (unique pour ce type)")} />}>
          <input className={fieldBox(true, !name)} required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {shown.filter(needed).map(renderField)}
      </FieldGroup>
      {shown.some((f) => !needed(f)) && <FieldGroup title={tx("Facultatif")} stacked={!!inst}>{shown.filter((f) => !needed(f)).map(renderField)}</FieldGroup>}
      {type.type === "npm" && mode === "script" && <NpmScript conf={conf} setConf={setConf} />}
      {type.tested.length > 0 && <p className="text-xs text-dim">{tx("Versions testées :")} {type.tested.join(", ")}</p>}
  </>;
  const buttons = (
      <div className={`flex flex-wrap gap-2 ${inst ? "mt-auto justify-end" : ""}`}>
        <button type="button" className={quiet} disabled={busy} onClick={() => void tryIt()}>{tx("Tester")}</button>
        <button type="submit" className={primary} disabled={busy}><Plus size={14} />{inst ? tx("Enregistrer") : tx("Ajouter")}</button>
        <button type="button" className={quiet} disabled={busy} title={tx("Service arrêté ou pas encore prêt : réglages gardés, sans test ni collecte ; l'allumer plus tard")}
          onClick={() => void save(false)}>{tx("Enregistrer sans collecte")}</button>
        <button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button>
        {onDelete && <span className={`flex flex-wrap gap-1.5 ${inst ? "" : "ml-auto"}`}>{confirm ? <>
          <button type="button" className={danger} onClick={onDelete}>{tx("Confirmer")}</button>
          <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
        </> : <button type="button" className={danger} onClick={() => setConfirm(true)} title={tx("Supprimer : retire ce connecteur et ses réglages (une confirmation est demandée)")}><Trash2 size={15} aria-hidden />{tx("Supprimer")}</button>}</span>}
        {type.guide && type.guide.length > 0 && (
          <button type="button" className={`${quiet} ${inst ? "" : "ml-auto"}`} aria-expanded={help} onClick={() => setHelp(!help)}>
            <HelpCircle size={14} aria-hidden />{tx("Besoin d'aide pour obtenir ces accès ?")}
          </button>
        )}
        {busy && <span className="self-center text-sm text-dim">…</span>}
      </div>
  );
  const extras = <>
      {help && type.guide && (setup ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-bg2/60 p-3 text-sm text-muted">
          <p><b className="text-txt">{tx("Pour votre installation détectée")}</b> <Dim>({setup.title})</Dim> : {tx("lancez cette commande sur la machine, puis copiez le jeton affiché dans le champ ci-dessus.")}</p>
          <Copyable text={setup.code} oneLine />
          <details><summary className="cursor-pointer text-link">{tx("Autres installations et explications")}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-6">{type.guide.map((g) => <GuideStep key={g} step={g} />)}</ol>
          </details>
        </div>
      ) : (
        <ol className="list-decimal space-y-1 rounded-lg border border-line/70 bg-bg2/60 py-2 pl-8 pr-3 text-sm text-muted">{type.guide.map((g) => <GuideStep key={g} step={g} />)}</ol>
      ))}
      {report && <TestReport r={report} onClose={() => setReport(null)} />}
      <NoteLine note={note} />
  </>;
  return (
    // Editing happens inside the instance card (already outlined in blue, with its logo and title): no inner frame nor header there
    <form onSubmit={submit} className={`mb-3 flex flex-col gap-4 ${inst ? "rounded-xl border border-line/60 p-4" : "mt-3 rounded-xl border-2 border-link bg-link/5 p-4"}`}>
      {!inst && (
        <div className="flex items-center gap-3 border-b border-line/60 pb-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card">
            {appIcon([type.label]) ? <img src={appIcon([type.label])!} alt="" className="h-6 w-6" /> : <Plug size={18} className="text-muted" aria-hidden />}
          </span>
          <div className="min-w-0"><b className="block truncate">{type.label}</b><span className="text-xs text-dim">{tx("Nouveau connecteur")}</span></div>
        </div>
      )}
      {inst ? (
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">{fields}</div>
          <div className="flex min-w-0 flex-col gap-3">{aside}{extras}{buttons}</div>
        </div>
      ) : <>{fields}{buttons}{extras}</>}
    </form>
  );
}

const TIP = { ok: ["text-ok", "✓"], warn: ["text-warn", "⚠"], bad: ["text-bad", "✗"] } as const;

/** Mode « script npm-api.sh » : conseils sur le chemin (vu de la machine qui l'exécutera) et installation du script sur cette machine */
function NpmScript({ conf, setConf }: Readonly<{ conf: Conf; setConf: (c: Conf) => void }>) {
  const api = String(conf.api ?? ""), ssh = String(conf.ssh ?? "");
  const [tips, setTips] = useState<ScriptTip[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [install, setInstall] = useState(false), [done, setDone] = useState<string[]>([]);
  const [f, setF] = useState({ directory: "npm-api", ip: "127.0.0.1", port: "81", user: "", password: "" });
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN); else setError((e as Error).message);
    }
    setBusy(false);
  };
  const check = () => guard(async () => {
    setTips((await send<{ tips: ScriptTip[] }>("POST", "connectors/settings/npm/script/check", { api, ssh: ssh || null })).tips);
  });
  const run = () => guard(async () => {
    const r = await send<{ path: string; lines: string[]; tips: ScriptTip[] }>("POST", "connectors/settings/npm/script/install",
      { ssh, directory: f.directory, ip: f.ip, port: Number(f.port), user: f.user, password: f.password });
    setDone(r.lines); setTips(r.tips); setConf({ ...conf, api: r.path });
    setF({ ...f, password: "" }); setInstall(false);
  });
  const where = ssh || tx("le conteneur");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-bg2/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={quiet} disabled={busy || !api} onClick={() => void check()}>
          {busy && !install ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}{tx("Vérifier le chemin")}
        </button>
        <button type="button" className={quiet} disabled={busy || !ssh} aria-expanded={install} onClick={() => setInstall(!install)}
          title={ssh ? undefined : tx("Choisissez d'abord la machine ci-dessus")}>
          <Plus size={14} aria-hidden />{tx("Installer npm-api.sh sur cette machine")}
        </button>
        {!ssh && <span className="text-xs text-dim">{tx("Sans machine, le chemin est cherché dans le conteneur, qui ne contient pas le script.")}</span>}
      </div>
      {tips && (
        <ul className="flex flex-col gap-1 text-sm" aria-label={tx("Résultat de la vérification")}>
          {tips.map((t, i) => <li key={i} className={TIP[t.level][0]}><b>{TIP[t.level][1]}</b> {t.text}</li>)}
        </ul>
      )}
      {done.length > 0 && <ul className="text-sm text-ok">{done.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {install && (
        <div className="flex flex-col gap-2 rounded-lg border border-link/40 bg-link/5 p-3">
          <InfoNote>
            {tx("MyServices va, sur")} <b className="text-txt">{where}</b>{tx(" : télécharger npm-api.sh")} <b className="text-txt">v{"3.6.9"}</b> {tx("(dépôt Erreur32/nginx-proxy-manager-Bash-API, empreinte SHA-256 vérifiée avant installation), l'installer dans le dossier ci-dessous, et écrire à côté un fichier npm-api.conf (droits 600) avec le compte NPM saisi ici. Rien d'autre n'est modifié. Un npm-api.conf déjà présent est conservé. Le mot de passe n'est pas gardé par MyServices.")}
          </InfoNote>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={<>{tx("Dossier d'installation")}<b className="ml-0.5 text-bad">*</b></>}><input className={input} value={f.directory} onChange={(e) => setF({ ...f, directory: e.target.value })} /></Field>
            <Field label={<>{tx("Adresse de NPM vue de la machine")}<b className="ml-0.5 text-bad">*</b></>}><input className={input} value={f.ip} onChange={(e) => setF({ ...f, ip: e.target.value })} /></Field>
            <Field label={<>{tx("Port de NPM")}<b className="ml-0.5 text-bad">*</b></>}><input className={input} inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} /></Field>
            <Field label={<>{tx("Compte NPM (e-mail)")}<b className="ml-0.5 text-bad">*</b></>}><input className={input} autoComplete="off" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} /></Field>
            <Field label={<>{tx("Mot de passe NPM")}<b className="ml-0.5 text-bad">*</b></>}><SecretInput value={f.password} autoComplete="new-password" onChange={(x) => setF({ ...f, password: x })} /></Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy || !f.directory || !f.ip || !f.user || !f.password} onClick={() => void run()}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}{tx("Installer")}
            </button>
            <button type="button" className={quiet} onClick={() => setInstall(false)}>{tx("Annuler")}</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-bad">⚠ {error}</p>}
    </div>
  );
}
