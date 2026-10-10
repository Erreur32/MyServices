// Réglages → Connecteurs : services lus par leur API (NPM, Beszel, Uptime Kuma, Dozzle, Web-Check…), en
// lecture seule. Formulaire généré depuis les champs déclarés par chaque connecteur, bouton Tester (sans
// enregistrer), état au dernier passage. Ce qui est lu par SSH (Docker, process, AdGuard) : section Machines.
import { Ban, HelpCircle, MonitorUp, Pencil, Plug, Plus, Server, ToggleRight, Trash2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { StatusLine } from "../components/ssh";
import type { ConnectorInstance, ConnectorsState, ConnectorType } from "../types";
import { takePrefill, type Prefill } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";
import { appIcon } from "../lib/appIcons";
import { Agents } from "./Agents";

const KIND: Record<string, string> = {
  services: "services", health: tx("santé"), logs: "journaux", dns: "DNS", inventory: "inventaire", backups: "sauvegardes",
};

// Proposé depuis « Premiers pas » : lu une seule fois, à l'ouverture de l'onglet
export function Connectors({ agentIp }: { agentIp?: string }) {
  const [prefill] = useState(takePrefill);
  const [st, setSt] = useState<ConnectorsState | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string>(() => prefill?.type ?? "");
  const [part, setPart] = useState<Part>(agentIp ? "agents" : "connectors");  // sous-onglet ouvert (lien « Installer l'agent » : Agents)
  const [picking, setPicking] = useState(false);  // mini cartes des connecteurs disponibles, ouvertes par le « + »
  const [src, setSrc] = useState<Record<string, boolean>>({}), [srcNote, setSrcNote] = useState<Note>(null), [changed, setChanged] = useState(false);
  const loadSources = useCallback(() => { read<{ sources: Record<string, boolean> }>("sources").then((r) => setSrc(r.sources)).catch(() => undefined); }, []);
  useEffect(loadSources, [loadSources]);
  const toggleSource = (id: string, on: boolean) =>
    void act(() => send("PUT", `sources/${id}`, { enabled: on }), on ? tx("affichage activé") : tx("affichage coupé"), setSrcNote).then((ok) => { if (ok) { setChanged(true); loadSources(); } });
  const reload = useCallback(() => {
    read<ConnectorsState>("connectors/settings")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);

  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const type = st.types.find((t) => t.type === adding);
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Sous-onglets des connecteurs")}>
        {PARTS.map(([id, label, hint, Icon]) => (
          <button key={id} type="button" onClick={() => setPart(id)} aria-current={part === id ? "page" : undefined} title={hint}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
              part === id ? "bg-card text-txt shadow-[inset_0_-2px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
            <Icon size={15} strokeWidth={1.75} aria-hidden />{label}
            {id === "connectors" && <Dim>{st.instances.length}</Dim>}
          </button>
        ))}
      </nav>
      {part === "connectors" && <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><Plug size={16} />{tx("Mes connecteurs")} <Dim>· {st.instances.length}</Dim></h2>
          <button type="button" className={picking ? primary : quiet} aria-expanded={picking} onClick={() => setPicking(!picking)}>
            {picking ? <X size={14} /> : <Plus size={14} />}{picking ? tx("Fermer") : tx("Ajouter un connecteur")}
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          {tx("Un connecteur relie MyServices à un outil par son API (NPM, AdGuard, Beszel…) pour en lire les services et l'état.")}{" "}
          <b className="text-txt">{tx("Lecture seule")}</b> {tx(": donnez-lui un compte ou une clé qui ne peut rien modifier.")}
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-dim">
          <li>• {tx("« Tester » vérifie les réglages sans les enregistrer")}</li>
          <li>• {tx("Un changement est pris en compte à la prochaine collecte")}</li>
        </ul>
        {picking && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={tx("Connecteurs disponibles")}>
            {st.types.map((t) => {
              const icon = appIcon([t.label]), n = st.instances.filter((i) => i.type === t.type).length;
              return (
                <li key={t.type}>
                  <button type="button" onClick={() => { setAdding(t.type); setPicking(false); }}
                    className="flex h-full w-full items-center gap-3 rounded-xl border border-line bg-bg2/60 p-3 text-left transition-colors hover:border-link hover:bg-link/10">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card">
                      {icon ? <img src={icon} alt="" className="h-6 w-6" /> : <Plug size={18} className="text-muted" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm text-txt">{t.label}</b>
                      <span className="block truncate text-xs text-dim">{t.kinds.map((k) => KIND[k] || k).join(" · ")}{n > 0 && ` · ${tx("{0} déjà", n)}`}</span>
                    </span>
                    <Plus size={15} className="shrink-0 text-dim" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {type && <ConnectorForm key={type.type} type={type} prefill={prefill?.type === type.type ? prefill : null} onDone={() => { setAdding(""); reload(); }} onCancel={() => setAdding("")} />}
      </Card>
      {st.instances.length === 0 && !type && (
        <Card><p className="text-sm text-muted">{tx("Aucun connecteur pour l'instant. Cliquez sur « Ajouter un connecteur » : les outils que MyServices sait lire s'affichent en petites cartes.")}</p></Card>
      )}
      {st.instances.map((i) => (
        <InstanceCard key={`${i.type}/${i.name}`} inst={i} type={st.types.find((t) => t.type === i.type)!} reload={reload} />
      ))}

      </>}

      {part === "agents" && <Agents focusIp={agentIp} />}

      {part === "activation" && <>
      <p className="px-1 text-sm text-muted">{tx("Ce que la collecte lit et ce que la page affiche. Un changement est pris en compte à la prochaine collecte.")}</p>
      <Card>
        <p className="mb-3 text-sm text-muted">{tx("« Collecte » : le connecteur est lu ou non. « Affichage » : la page montre ou non ses services et compteurs (même réglage pour toutes les instances du type).")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-dim">
                <th className="py-2 pr-3 font-semibold">{tx("Service")}</th>
                <th className="w-28 px-3 py-2 text-center font-semibold">{tx("Collecte")}</th>
                <th className="w-28 px-3 py-2 text-center font-semibold">{tx("Affichage")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              <tr><th colSpan={3} className="pb-1 pt-3 text-left text-xs font-semibold text-muted"><Plug size={13} className="mr-1.5 inline" aria-hidden />{tx("Par un connecteur")} <Dim>· {st.instances.length}</Dim></th></tr>
              {st.instances.length === 0 && <tr><td colSpan={3} className="py-2"><Dim>{tx("Aucun connecteur.")}</Dim></td></tr>}
              {st.instances.map((i, n) => {
                const first = st.instances.findIndex((x) => x.type === i.type) === n, shown = i.type in SHOWN && i.type in src;
                return (
                  <tr key={`${i.type}/${i.name}`}>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2">
                          {appIcon([i.label]) ? <img src={appIcon([i.label])!} alt="" className="h-4 w-4" /> : <Plug size={14} className="text-muted" aria-hidden />}
                        </span>
                        <b className="truncate">{i.label}</b><Dim>· {i.name}</Dim>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Switch on={i.enabled} label={`${tx("Collecte")} ${i.label} : ${i.enabled ? tx("coupé") : tx("activé")}`}
                        onChange={(on) => void act(() => send("PATCH", `connectors/settings/${i.type}/${encodeURIComponent(i.name)}`, { enabled: on }),
                          on ? tx("allumé : relu au prochain passage de la collecte") : tx("coupé : réglages gardés, plus rien de lu"), setSrcNote).then((ok) => { if (ok) { setChanged(true); reload(); } })} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {shown && first ? <span title={SHOWN[i.type]}><Switch on={src[i.type]} label={`${tx("Affichage")} ${i.label} : ${src[i.type] ? tx("coupé") : tx("activé")}`} onChange={(on) => toggleSource(i.type, on)} /></span>
                        : shown ? <span className="text-xs text-dim">{tx("affichage : voir ci-dessus")}</span> : <span className="text-dim" aria-hidden>–</span>}
                    </td>
                  </tr>
                );
              })}
              <tr><th colSpan={3} className="pb-1 pt-4 text-left text-xs font-semibold text-muted"><Server size={13} className="mr-1.5 inline" aria-hidden />{tx("Natifs, sans connecteur")}
                <span className="ml-2 font-normal text-dim">{tx("Rien à relier ici : la collecte lit ces sources directement. L'interrupteur décide seulement si la page les affiche.")}</span></th></tr>
              <tr>
                <td className="py-2.5 pr-3"><span className="flex items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2"><Server size={14} className="text-muted" aria-hidden /></span>
                  <b>Apache</b><Dim>· {tx("vhosts lus par SSH sur chaque machine, comme services")}</Dim></span></td>
                <td className="px-3 py-2.5 text-center text-dim" aria-hidden>–</td>
                <td className="px-3 py-2.5 text-center"><Switch on={!!src.apache} onChange={(on) => toggleSource("apache", on)} label={`${src.apache ? tx("Couper") : tx("Activer")} Apache`} /></td>
              </tr>
              <tr className="opacity-60">
                <td className="py-2.5 pr-3"><span className="flex flex-wrap items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2"><Ban size={14} className="text-muted" aria-hidden /></span>
                  <b>Fail2ban</b><Badge tone="off">{tx("à venir")}</Badge><Dim>· {tx("bannissements et prisons, par LogviewR (arrive avec son connecteur)")}</Dim></span></td>
                <td className="px-3 py-2.5 text-center text-dim" aria-hidden>–</td>
                <td className="px-3 py-2.5 text-center"><Switch on={false} disabled onChange={() => undefined} label="Fail2ban" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
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
      </>}
    </div>
  );
}

type Part = "connectors" | "agents" | "activation";
const PARTS: [Part, string, string, LucideIcon][] = [
  ["connectors", tx("Connecteurs"), tx("L'accès à chaque outil : adresse, jeton, test"), Plug],
  ["agents", tx("Agents"), tx("Un PC Windows qui envoie lui-même sa santé, sans SSH"), MonitorUp],
  ["activation", tx("Activation"), tx("Ce que la collecte lit et ce que la page affiche"), ToggleRight],
];

/** Connecteurs dont l'affichage sur la page est une source activable (le même interrupteur vaut pour toutes les instances du type) */
const SHOWN: Record<string, string> = { npm: tx("Afficher les services et compteurs NPM sur la page"), adguard: tx("Afficher l'onglet DNS et les compteurs AdGuard (toutes les instances)") };

function InstanceCard({ inst, type, reload }: { inst: ConnectorInstance; type: ConnectorType; reload: () => void }) {
  const [edit, setEdit] = useState(false), [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
  const url = inst.config.url as string | undefined;
  const path = `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}`;
  return (
    <Card className={inst.enabled ? "" : "opacity-80"}>
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
          {!inst.enabled && <div className="mt-1"><Badge tone="off">{tx("collecte coupée (partie 2)")}</Badge></div>}
          {inst.enabled && <div className="mt-2 text-sm"><StatusLine s={inst.status} /></div>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={quiet} onClick={() => setEdit(!edit)} aria-expanded={edit}><Pencil size={14} />{tx("Modifier / Tester")}</button>
          {confirm ? <>
            <button type="button" className={danger} onClick={() => void act(() => send("DELETE", path), tx("connecteur supprimé"), setNote).then((ok) => ok && reload())}>{tx("Confirmer")}</button>
            <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
          </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Supprimer")}</button>}
        </div>
      </div>
      {edit && <ConnectorForm type={type} inst={inst} onDone={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} />}
      <NoteLine note={note} />
    </Card>
  );
}

/** quietSave : pas de message vert « enregistré » (l'appelant confirme lui-même, comme dans Premiers pas) */
export function ConnectorForm({ type, inst, prefill, quietSave = false, onDone, onCancel }: { type: ConnectorType; inst?: ConnectorInstance; prefill?: Prefill | null; quietSave?: boolean; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(inst?.name || prefill?.name || type.type);
  const [conf, setConf] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {};
    for (const f of type.fields) if (!f.secret) init[f.name] = inst?.config[f.name] ?? (f.name === "url" ? prefill?.url : undefined) ?? (f.default as string | number | boolean | null) ?? "";
    return init;
  });
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [help, setHelp] = useState(!inst);  // aide dépliée à l'ajout, sous les boutons
  const body = () => ({ name, config: conf, original: inst?.name ?? null });
  const tryIt = async () => {
    setBusy(true);
    try {
      const r = await send<{ ok: boolean; message: string; version: string | null; version_tested: boolean | null }>("POST", `connectors/settings/${type.type}/test`, body());
      setNote({ ok: r.ok, text: `${r.message}${r.version ? tx(" · version {0}{1}", r.version, r.version_tested === false ? tx(" (non testée)") : "") : ""}` });
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", `connectors/settings/${type.type}`, body()), quietSave ? "" : tx("enregistré : pris en compte au prochain passage de la collecte"), setNote);
    setBusy(false);
    if (ok) quietSave ? onDone() : setTimeout(onDone, 900);
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-bg2/50 p-3">
      <Field label={tx("Nom de l'instance (unique pour ce type)")}>
        <input className={input} required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {type.fields.map((f) => {
          const kept = inst && f.secret && inst.set[f.name];
          const v = conf[f.name];
          return (
            <Field key={f.name} label={`${f.label}${f.required ? "" : tx(" (facultatif)")}`}>
              {f.kind === "bool" ? (
                <input type="checkbox" className="h-4 w-4" checked={!!v} onChange={(e) => setConf({ ...conf, [f.name]: e.target.checked })} />
              ) : f.choices.length ? (
                <select className={input} value={String(v ?? "")} onChange={(e) => setConf({ ...conf, [f.name]: e.target.value })}>
                  {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input className={input} type={f.secret ? "password" : f.kind === "number" ? "number" : "text"} autoComplete="off"
                  value={String(v ?? "")} placeholder={kept ? tx("déjà renseigné : laisser vide pour garder") : f.secret ? "" : String(f.default ?? "")}
                  onChange={(e) => setConf({ ...conf, [f.name]: e.target.value })} />
              )}
              {f.help && <span className="text-xs text-dim">{f.help}</span>}
            </Field>
          );
        })}
      </div>
      {type.tested.length > 0 && <p className="text-xs text-dim">{tx("Versions testées :")} {type.tested.join(", ")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={busy} onClick={() => void tryIt()}>{tx("Tester")}</button>
        <button className={primary} disabled={busy}><Plus size={14} />{inst ? tx("Enregistrer") : tx("Ajouter")}</button>
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
      <NoteLine note={note} />
    </form>
  );
}
