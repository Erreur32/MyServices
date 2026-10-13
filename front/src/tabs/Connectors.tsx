// Réglages → Connecteurs : services lus par leur API (NPM, Beszel, Uptime Kuma, Dozzle, Web-Check…), en
// lecture seule. Formulaire généré depuis les champs déclarés par chaque connecteur, bouton Tester (sans
// enregistrer), état au dernier passage. Ce qui est lu par SSH (Docker, process, AdGuard) : section Machines.
import { Check, ChevronRight, EyeOff, HelpCircle, Loader2, Package, Pencil, Play, Plug, Plus, RotateCcw, ScanSearch, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { Overlay } from "../components/Overlay";
import { Field, NoteLine, Switch } from "../components/form";
import { IconChoice } from "../components/IconChoice";
import { SecretInput } from "../components/SecretInput";
import { FOLD, FOLD_HEAD } from "../components/NetworkStep";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { StatusLine } from "../components/ssh";
import { useCollectTask } from "../components/ScheduleCard";
import { useDiscoveries } from "../components/DiscoveryCard";
import type { ConnectorInstance, ConnectorMode, ConnectorsState, ConnectorType, MachinesSettings, Proposal, ScriptTip } from "../types";
import { configFor, modeOf } from "../lib/connectorModes";
import { takePrefill, type Prefill } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";
import { savedFor } from "../lib/savedFor";
import { appIcon } from "../lib/appIcons";

const KIND: Record<string, string> = {
  services: "services", health: tx("santé"), logs: tx("Docker · journaux"), dns: "DNS", inventory: "inventaire", backups: "sauvegardes", network: tx("réseau"), security: tx("sécurité"), containers: "Docker",
};

// Proposé depuis « Premiers pas » : lu une seule fois, à l'ouverture de l'onglet
export function Connectors({ snap }: { snap: Snapshot }) {
  const [prefill] = useState(takePrefill);
  const [st, setSt] = useState<ConnectorsState | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string>(() => prefill?.type ?? "");
  const [edited, setEditing] = useState("");  // « type/nom » de l'instance en cours de modification : un seul formulaire à la fois
  const [overlay, setOverlay] = useState<Proposal | null>(null);   // service détecté à activer : son formulaire s'ouvre par-dessus
  const [saved, setSaved] = useState<string[]>([]);   // detected services just activated: hidden at once, before any reload
  const [picking, setPicking] = useState(false);  // mini cartes des connecteurs disponibles, ouvertes par le « + »
  const [cat, setCat] = useState(""), [query, setQuery] = useState("");   // category and search of the picker (empty: all)
  const [srcNote, setSrcNote] = useState<Note>(null), [changed, setChanged] = useState(false);
  const collect = useCollectTask();
  const reload = useCallback(() => {
    read<ConnectorsState>("connectors/settings")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload, snap.data.generated]);   // read again when a collection ends: states and versions up to date without F5

  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const type = st.types.find((t) => t.type === adding);
  // Read over SSH because a machine declares it (AdGuard): shown with « My connectors », nothing to add for them
  const bySsh = st.others.filter((o) => o.via === "ssh" || st.types.some((t) => t.type === o.type));
  // An instance deleted (or renamed) while its form was open no longer locks the other buttons
  const editing = st.instances.some((i) => `${i.type}/${i.name}` === edited) ? edited : "";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><Plug size={16} />{tx("Mes connecteurs")} <Count n={st.instances.length} /></h2>
          <button type="button" className={`${primary} disabled:opacity-50`} aria-expanded={picking} disabled={!!editing && !picking}
            title={editing ? tx("Terminez ou annulez la modification en cours avant d'ajouter un connecteur") : undefined} onClick={() => setPicking(!picking)}>
            {picking ? <X size={14} /> : <Plus size={14} />}{picking ? tx("Fermer") : tx("Ajouter un connecteur")}
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">{tx("Un connecteur lit par son API, en lecture seule, les services d'un outil que vous utilisez déjà (Nginx Proxy Manager, AdGuard Home, Beszel…) : une clé ou un compte sans droit de modification suffit.")}</p>
        {picking && (
          <label className="mt-3 flex max-w-md items-center gap-2 rounded-lg border border-line bg-bg2 px-3 py-2 focus-within:border-link">
            <Search size={16} className="text-dim" aria-hidden />
            <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx("Chercher un connecteur (nom, catégorie…)")}
              className="w-full bg-transparent text-sm text-txt outline-none placeholder:text-dim" />
          </label>
        )}
        {picking && <CategoryChips types={st.types} cat={cat} setCat={setCat} />}
        {picking && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={tx("Connecteurs disponibles")}>
            {st.types.filter((t) => (!cat || t.category === cat) && hits(query, t.label, t.type, catName(t.category ?? ""), ...t.kinds.map((k) => KIND[k] || k)))
              .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })).map((t) => {
              const icon = appIcon([t.label]), n = st.instances.filter((i) => i.type === t.type).length, ssh = bySsh.filter((o) => o.type === t.type).length;
              return (
                <li key={t.type}>
                  <button type="button" onClick={() => { setAdding(t.type); setPicking(false); }}
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
        {type && <ConnectorForm key={type.type} type={type} prefill={prefill?.type === type.type ? prefill : null} onSaved={reload} onDone={() => { setAdding(""); reload(); }} onCancel={() => setAdding("")} />}
      </Card>
      <DetectedServices apps={(snap.data.detected_apps ?? []).filter((p) => !saved.includes(discoveryId(p)))} instances={st.instances} onOpen={setOverlay} />
      {bySsh.length > 0 && (   // folded by default, like the detected services above
        <details className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
          <summary className={FOLD_HEAD}>
            <ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
            <Plug size={16} aria-hidden />{tx("Déjà lus par SSH")} <Count n={bySsh.length} />
            <span className="font-normal text-muted">{tx("rien à ajouter pour eux")}</span>
          </summary>
          <p className="mt-1 text-sm text-muted">{tx("Trouvés sur une machine suivie et lus par SSH (AdGuard, Proxmox, ESXi, KVM…) : inutile de les ajouter ici. Un connecteur n'apporte quelque chose que s'il lit une API que SSH ne voit pas.")}</p>
          <ul className="mt-2 flex flex-col divide-y divide-line/60">
            {bySsh.map((o) => {
              const label = st.types.find((t) => t.type === o.type)?.label ?? o.label ?? o.type, icon = appIcon([label]);
              return (
                <li key={`${o.type}/${o.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">{icon ? <img src={icon} alt="" className="h-5 w-5" /> : <Plug size={16} className="text-muted" aria-hidden />}</span>
                  <b>{label}</b><Dim>· {o.name}</Dim><Badge tone="off">SSH</Badge>
                  <span className="ml-auto"><StatusLine s={o} collect={collect} /></span>
                  <a href="#settings/machines" className="text-xs text-link hover:underline">{tx("Réglages → Machines")}</a>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {overlay && st.types.find((t) => t.type === overlay.connector) && (
        <Overlay title={<>{appIcon([overlay.label]) && <img src={appIcon([overlay.label])!} alt="" className="h-6 w-6" />}{tx("Activer")} {overlay.label} <Dim>· {overlay.machine || overlay.ip}</Dim></>} onClose={() => setOverlay(null)}>
          <ConnectorForm key={overlay.connector} type={st.types.find((t) => t.type === overlay.connector)!} prefill={{ type: overlay.connector, name: overlay.connector, url: overlay.url }}
            onSaved={() => { setSaved((x) => [...x, discoveryId(overlay)]); reload(); }}
            onDone={() => { setOverlay(null); reload(); }} onCancel={() => setOverlay(null)} />
        </Overlay>
      )}
      {st.instances.length === 0 && !type && (
        <Card><p className="text-sm text-muted">{tx("Aucun connecteur pour l'instant. Cliquez sur « Ajouter un connecteur » : les outils que MyServices sait lire s'affichent en petites cartes.")}</p></Card>
      )}
      {[...st.instances].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name)).map((i) => (   // alphabetical, like the picker
        <InstanceCard key={`${i.type}/${i.name}`} inst={i} collect={collect} type={st.types.find((t) => t.type === i.type)!} reload={reload}
          onCollect={(on) => void act(() => send("PATCH", `connectors/settings/${i.type}/${encodeURIComponent(i.name)}`, { enabled: on }),
            on ? tx("allumé : relecture lancée") : tx("coupé : réglages gardés, plus rien de lu"), setSrcNote).then((ok) => { if (ok) { setChanged(true); reload(); } })}
          editing={editing === `${i.type}/${i.name}`} locked={(!!editing && editing !== `${i.type}/${i.name}`) || picking || !!adding} setEditing={(on) => setEditing(on ? `${i.type}/${i.name}` : "")} />
      ))}
      <NoteLine note={srcNote} />
      {changed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg2/40 px-4 py-3 text-sm text-muted">
          {tx("Pris en compte à la prochaine collecte.")}
          <button type="button" className={primary}
            onClick={() => void act(() => send("POST", "system/tasks/collect/run"), tx("collecte lancée : la page se met à jour à la fin"), setSrcNote)}>
            {tx("Lancer la collecte maintenant")}
          </button>
        </div>
      )}


    </div>
  );
}

/** Every word of the search found in one of the texts (accents and case ignored) */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const hits = (q: string, ...texts: string[]) => { const all = fold(texts.join(" ")); return fold(q).split(/\s+/).every((w) => all.includes(w)); };

// Categories sent by the server (connectors/settings.py: category), translated here
const CATEGORY: Record<string, string> = {
  "Infra / virtualisation": tx("Infra / virtualisation"), Monitoring: tx("Monitoring"), "Réseau / DNS": tx("Réseau / DNS"), Médias: tx("Médias"),
  Sauvegardes: tx("Sauvegardes"), Domotique: tx("Domotique"), "Fichiers / sync": tx("Fichiers / sync"), IA: tx("IA"), Outils: tx("Outils"),
  Système: tx("Système"), Sécurité: tx("Sécurité"), "Web / perso": tx("Web / perso"), Autre: tx("Autre"),
};
const catName = (c: string) => CATEGORY[c] ?? c;

/** Picker filter: one chip per category, with its count, alphabetical */
function CategoryChips({ types, cat, setCat }: { types: ConnectorType[]; cat: string; setCat: (c: string) => void }) {
  const counts = new Map<string, number>();
  for (const t of types) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => catName(a).localeCompare(catName(b)));
  if (cats.length < 2) return null;
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={tx("Catégorie")}>
      <button type="button" className={chip(!cat)} aria-pressed={!cat} onClick={() => setCat("")}>{tx("Toutes")} <b className="text-dim">{types.length}</b></button>
      {cats.map((c) => <button key={c} type="button" className={chip(cat === c)} aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>{catName(c)} <b className="text-dim">{counts.get(c)}</b></button>)}
    </div>
  );
}

/** Réponse de l'essai d'un connecteur : message, version et ce que la lecture a rapporté (preuve que le connecteur lit vraiment) */
interface TestOut { ok: boolean; message: string; version: string | null; version_tested: boolean | null; found?: { name: string; count: number }[] }

async function runTest(type: string, body: unknown): Promise<TestOut> {
  try {
    return await send<TestOut>("POST", `connectors/settings/${type}/test`, body);
  } catch (e) {
    if (e instanceof LoginRequired) location.replace(LOGIN);
    return { ok: false, message: (e as Error).message, version: null, version_tested: null };
  }
}

/** Résultat d'un essai : cadre vert ou rouge, version, puis une pastille par type d'information lue */
function TestReport({ r, onClose }: { r: TestOut; onClose: () => void }) {
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

function DetectedServices({ apps, instances, onOpen }: { apps: Proposal[]; instances: ConnectorInstance[]; onOpen: (p: Proposal) => void }) {
  const [disc, reloadDisc] = useDiscoveries();
  const [note, setNote] = useState<Note>(null);
  const muted = new Set((disc?.items ?? []).filter((x) => x.muted).map((x) => x.id));
  // « linked » comes with the next collection (a minute or two): a connector saved a moment ago already hides its row
  const all = apps.filter((p) => !p.linked && !savedFor(p, instances));
  // running containers first: docker ps -a also lists stopped ones, which have nothing to read until they run again
  const rows = all.filter((p) => !muted.has(discoveryId(p))).sort((a, b) => Number(a.running === false) - Number(b.running === false)), forgotten = all.filter((p) => muted.has(discoveryId(p)));
  const forget = (p: Proposal, on: boolean) => void act(() => send("PUT", "discoveries/muted", { id: discoveryId(p), muted: on }),
    on ? tx("{0} oublié : plus proposé", p.label) : tx("{0} rappelé : de nouveau proposé", p.label), setNote).then(() => reloadDisc());
  if (!all.length) return null;
  return (
    <details className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
      <summary className={FOLD_HEAD}>
        <ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
        <ScanSearch size={16} aria-hidden />{tx("Services détectés non configurés")} <Count n={rows.length} />
        <span className="font-normal text-muted">{tx("facultatif : à relier quand vous voulez")}</span>
      </summary>
      <p className="mt-1 text-sm text-muted">{tx("MyServices a reconnu ces applis mais ne les lit pas encore. Cliquez sur l'une d'elles pour renseigner son accès en lecture.")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-dim">
              <th className="py-2 pr-3 font-semibold">{tx("Service")}</th><th className="px-3 py-2 font-semibold">{tx("Machine")}</th><th className="px-3 py-2 font-semibold">{tx("État")}</th><th className="px-3 py-2 text-right font-semibold">{tx("Activation")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((p) => (
              <tr key={`${p.connector}@${p.ip}`} className={p.running === false ? "opacity-70" : ""}>
                <td className="py-1 pr-3">
                  <button type="button" onClick={() => onOpen(p)} title={tx("Renseigner l'accès et activer")} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-link/10">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2">
                      {appIcon([p.label]) ? <img src={appIcon([p.label])!} alt="" className="h-4 w-4" /> : <Plug size={14} className="text-muted" aria-hidden />}
                    </span>
                    <b className="underline decoration-dotted underline-offset-2">{p.label}</b>
                  </button>
                </td>
                <td className="px-3 py-2.5"><b className="font-semibold">{p.machine || p.ip}</b>{p.machine && <Dim> · {p.ip}</Dim>}</td>
                <td className="px-3 py-2.5">{p.running === true ? <Badge tone="ok" title={p.state || undefined}>{tx("actif")}</Badge>
                  : p.running === false ? <Badge tone="off" title={p.state || undefined}>{tx("arrêté")}</Badge> : <Dim>-</Dim>}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center gap-2">
                    <Badge tone="info">{tx("facultatif")}</Badge>
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
    </details>
  );
}

function InstanceCard({ inst, collect, type, reload, onCollect, editing: edit, locked, setEditing: setEdit }: {
  inst: ConnectorInstance; collect: ReturnType<typeof useCollectTask>; type: ConnectorType; reload: () => void; onCollect: (on: boolean) => void; editing: boolean; locked: boolean; setEditing: (on: boolean) => void;  // locked : un autre formulaire est ouvert
}) {
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null), [report, setReport] = useState<TestOut | null>(null), [testing, setTesting] = useState(false);
  const url = inst.config.url as string | undefined;
  const path = `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}`;
  return (
    <div id={`connector-${inst.type}-${inst.name}`} className="scroll-mt-24"><Card className={`${inst.enabled ? "" : "opacity-80"} ${edit ? "!border-link ring-1 ring-link" : "!border-dim/50"}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">
              {appIcon([inst.label]) ? <img src={appIcon([inst.label])!} alt="" className="h-5 w-5" /> : <Plug size={16} className="text-muted" aria-hidden />}
            </span>
            <b>{inst.label}</b><Dim>· {inst.name}</Dim>
            {type.kinds.map((k) => <Badge key={k} tone="info">{KIND[k] || k}</Badge>)}
          </div>
          {url && <a className="mt-1 inline-block break-all font-mono text-xs text-dim hover:text-link hover:underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={quiet} disabled={testing || edit} onClick={async () => {
            setTesting(true); setReport(null);
            setReport(await runTest(inst.type, { name: inst.name, config: configFor(type, modeOf(type, inst.config), inst.config as Record<string, string | number | boolean>), original: inst.name }));
            setTesting(false);
          }} title={tx("Essayer la lecture avec les réglages enregistrés, sans ouvrir le formulaire")}><Play size={14} />{testing ? tx("Essai…") : tx("Tester")}</button>
          <button type="button" className={quiet} disabled={locked} onClick={() => setEdit(!edit)} aria-expanded={edit}
            title={locked ? tx("Un autre formulaire est ouvert : terminez-le ou annulez-le d'abord") : undefined}><Pencil size={14} />{tx("Modifier")}</button>
          {confirm ? <>
            <button type="button" className={danger} onClick={() => void act(() => send("DELETE", path), tx("connecteur supprimé"), setNote).then((ok) => { if (ok) { setEdit(false); reload(); } })}>{tx("Confirmer")}</button>
            <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
          </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Supprimer")}</button>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {inst.enabled ? <StatusLine s={inst.status} collect={collect} /> : <Badge tone="off">{tx("collecte coupée")}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted">
          <span className="flex items-center gap-2" title={tx("Le connecteur est lu à chaque collecte ; coupé, ses réglages sont gardés mais plus rien n'est lu")}>
            <Switch on={inst.enabled} label={`${tx("Collecte")} ${inst.label} : ${inst.enabled ? tx("coupé") : tx("activé")}`} onChange={onCollect} />{tx("Collecte")}
          </span>
        </div>
      </div>
      {report && !edit && <TestReport r={report} onClose={() => setReport(null)} />}
      {edit && <ConnectorForm type={type} inst={inst} onSaved={reload} onDone={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} />}
      <NoteLine note={note} />
    </Card></div>
  );
}

/** quietSave : pas de message vert « enregistré » (l'appelant confirme lui-même, comme dans Premiers pas) */
export function ConnectorForm({ type, inst, prefill, quietSave = false, onSaved, onDone, onCancel }: { type: ConnectorType; inst?: ConnectorInstance; prefill?: Prefill | null; quietSave?: boolean; onSaved?: () => void; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(inst?.name || prefill?.name || type.type);
  const [conf, setConf] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {};
    for (const f of type.fields) if (!f.secret) init[f.name] = inst?.config[f.name] ?? (f.name === "url" ? prefill?.url : undefined) ?? (f.default as string | number | boolean | null) ?? "";
    return init;
  });
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [help, setHelp] = useState(!inst);  // aide dépliée à l'ajout, sous les boutons
  // Façon de relier le service (NPM : API directe, par SSH, script) : décide des champs montrés, requis et envoyés
  const [mode, setMode] = useState(() => modeOf(type, inst?.config));
  const modeDef: ConnectorMode | undefined = (type.modes ?? []).find((m) => m.id === mode);
  const shown = modeDef ? type.fields.filter((f) => modeDef.fields.includes(f.name)) : type.fields;
  const [aliases, setAliases] = useState<MachinesSettings["aliases"]>([]);
  useEffect(() => { if (type.modes?.length) read<MachinesSettings>("machines/settings").then((m) => setAliases(m.aliases)).catch(() => undefined); }, [type.modes]);
  const pickMode = (id: string) => {
    setMode(id);
    if (id === "ssh" && !conf.url) setConf((c) => ({ ...c, url: "http://127.0.0.1:81" }));  // vu de la machine de NPM
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
    const ok = await act(async () => { const r = await send<{ enabled?: boolean; message?: string }>("PUT", `connectors/settings/${type.type}`, body(collect)); if (r?.enabled === false) off = r.message ?? ""; },
      quietSave ? "" : tx("enregistré : relecture lancée, l'état se met à jour dans une minute"), setNote);
    setBusy(false);
    if (ok) onSaved?.();   // saved: the lists update now, without waiting for the form to close
    if (ok && off) { setNote({ ok: !collect, text: off }); setTimeout(onDone, 4000); }
    else if (ok) quietSave ? onDone() : setTimeout(onDone, 900);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(true); };
  return (
    // Editing happens inside the instance card (already outlined in blue, with its logo and title): no inner frame nor header there
    <form onSubmit={submit} className={`mt-3 flex flex-col gap-3 ${inst ? "border-t border-line/60 pt-3" : "rounded-xl border-2 border-link bg-link/5 p-3"}`}>
      {!inst && (
        <div className="flex items-center gap-3 border-b border-line/60 pb-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card">
            {appIcon([type.label]) ? <img src={appIcon([type.label])!} alt="" className="h-6 w-6" /> : <Plug size={18} className="text-muted" aria-hidden />}
          </span>
          <div className="min-w-0"><b className="block truncate">{type.label}</b><span className="text-xs text-dim">{tx("Nouveau connecteur")}</span></div>
        </div>
      )}
      <Field label={tx("Nom de l'instance (unique pour ce type)")}>
        <input className={input} required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {modeDef && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">{tx("Comment MyServices lit ce service")}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tx("Comment MyServices lit ce service")}>
            {(type.modes ?? []).map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => pickMode(m.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${mode === m.id ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>{tx(m.label)}</button>
            ))}
          </div>
          <p className="text-xs text-dim">{tx(modeDef.help)}</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((f) => {
          const kept = inst && f.secret && inst.set[f.name];
          const v = conf[f.name];
          const need = modeDef ? modeDef.required.includes(f.name) : f.required;
          return (
            <Field key={f.name} label={<>{tx(f.label)}{need ? <b className="ml-0.5 text-bad" title={tx("requis")} aria-label={tx("requis")}>*</b> : <span className="text-dim">{tx(" (facultatif)")}</span>}</>}>
              {f.kind === "bool" ? (
                <input type="checkbox" className="h-4 w-4" checked={!!v} onChange={(e) => setConf({ ...conf, [f.name]: e.target.checked })} />
              ) : f.name === "ssh" && modeDef ? (
                <select className={input} value={String(v ?? "")} onChange={(e) => setConf({ ...conf, ssh: e.target.value })} required={need}>
                  <option value="">{need ? tx("Choisir la machine…") : tx("aucune : dans le conteneur")}</option>
                  {aliases.map((a) => <option key={a.alias} value={a.alias}>{a.alias}{a.user || a.ip || a.host ? ` · ${a.user ? `${a.user}@` : ""}${a.ip || a.host}` : ""}</option>)}
                </select>
              ) : f.choices.length && f.choices.some((c) => appIcon([c])) ? (   // choix dont les valeurs ont un logo (Sonarr, Tailscale…) : boutons-icônes, pas de menu
                <IconChoice label={tx(f.label)} value={String(v ?? f.default ?? "")} onPick={(c) => setConf({ ...conf, [f.name]: c })}
                  options={f.choices.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1), icon: appIcon([c]) ? <img src={appIcon([c])!} alt="" className="h-7 w-7" /> : <Package size={24} className="text-muted" aria-hidden /> }))} />
              ) : f.choices.length ? (
                <select className={input} value={String(v ?? "")} onChange={(e) => setConf({ ...conf, [f.name]: e.target.value })}>
                  {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : f.secret ? (
                <SecretInput value={String(v ?? "")} onChange={(x) => setConf({ ...conf, [f.name]: x })} kept={!!kept}
                  placeholder={kept ? tx("déjà renseigné : laisser vide pour garder") : ""}
                  reveal={inst ? (password) => send<{ value: string }>("POST", `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}/reveal`, { field: f.name, password }).then((r) => r.value) : undefined} />
              ) : (
                <input className={input} type={f.kind === "number" ? "number" : "text"} autoComplete="off"
                  value={String(v ?? "")} placeholder={String(f.default ?? "")}
                  onChange={(e) => setConf({ ...conf, [f.name]: e.target.value })} />
              )}
              {f.help && <span className="text-xs text-dim">{tx(f.help)}</span>}
            </Field>
          );
        })}
      </div>
      {type.type === "npm" && mode === "script" && <NpmScript conf={conf} setConf={setConf} />}
      {type.tested.length > 0 && <p className="text-xs text-dim">{tx("Versions testées :")} {type.tested.join(", ")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={busy} onClick={() => void tryIt()}>{tx("Tester")}</button>
        <button type="submit" className={primary} disabled={busy}><Plus size={14} />{inst ? tx("Enregistrer") : tx("Ajouter")}</button>
        <button type="button" className={quiet} disabled={busy} title={tx("Service arrêté ou pas encore prêt : réglages gardés, sans test ni collecte ; l'allumer plus tard")}
          onClick={() => void save(false)}>{tx("Enregistrer sans collecte")}</button>
        <button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button>
        {type.guide && type.guide.length > 0 && (
          <button type="button" className={`${quiet} ml-auto`} aria-expanded={help} onClick={() => setHelp(!help)}>
            <HelpCircle size={14} aria-hidden />{tx("Besoin d'aide pour obtenir ces accès ?")}
          </button>
        )}
        {busy && <span className="self-center text-sm text-dim">…</span>}
      </div>
      {help && type.guide && (
        <ol className="list-decimal space-y-1 rounded-lg border border-line/70 bg-bg2/60 py-2 pl-8 pr-3 text-sm text-muted">{type.guide.map((g) => <li key={g}>{g}</li>)}</ol>
      )}
      {report && <TestReport r={report} onClose={() => setReport(null)} />}
      <NoteLine note={note} />
    </form>
  );
}

const TIP = { ok: ["text-ok", "✓"], warn: ["text-warn", "⚠"], bad: ["text-bad", "✗"] } as const;

/** Mode « script npm-api.sh » : conseils sur le chemin (vu de la machine qui l'exécutera) et installation du script sur cette machine */
function NpmScript({ conf, setConf }: { conf: Record<string, string | number | boolean>; setConf: (c: Record<string, string | number | boolean>) => void }) {
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
          <p className="text-sm text-muted">
            {tx("MyServices va, sur")} <b className="text-txt">{where}</b>{tx(" : télécharger npm-api.sh")} <b className="text-txt">v{"3.6.9"}</b> {tx("(dépôt Erreur32/nginx-proxy-manager-Bash-API, empreinte SHA-256 vérifiée avant installation), l'installer dans le dossier ci-dessous, et écrire à côté un fichier npm-api.conf (droits 600) avec le compte NPM saisi ici. Rien d'autre n'est modifié. Un npm-api.conf déjà présent est conservé. Le mot de passe n'est pas gardé par MyServices.")}
          </p>
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
