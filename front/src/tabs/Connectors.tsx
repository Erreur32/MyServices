// Réglages → Connecteurs : services lus par leur API (NPM, Beszel, Uptime Kuma, Dozzle, Web-Check…), en
// lecture seule. Formulaire généré depuis les champs déclarés par chaque connecteur, bouton Tester (sans
// enregistrer), état au dernier passage. Ce qui est lu par SSH (Docker, process, AdGuard) : section Machines.
import { ArrowRight, Ban, HelpCircle, Pencil, Plug, Plus, Server, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { StatusLine } from "../components/ssh";
import type { ConnectorInstance, ConnectorsState, ConnectorType, MachinesSettings } from "../types";
import { takePrefill, type Prefill } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";
import { appIcon } from "../lib/appIcons";

const KIND: Record<string, string> = {
  services: "services", health: tx("santé"), logs: "journaux", dns: "DNS", inventory: "inventaire", backups: "sauvegardes",
};

// Proposé depuis « Premiers pas » : lu une seule fois, à l'ouverture de l'onglet
export function Connectors() {
  const [prefill] = useState(takePrefill);
  const [st, setSt] = useState<ConnectorsState | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string>(() => prefill?.type ?? "");
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
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><Plug size={16} />{tx("Connecteurs")} <Dim>· {st.instances.length}</Dim></h2>
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
      {st.instances.map((i, n) => (
        <InstanceCard key={`${i.type}/${i.name}`} inst={i} type={st.types.find((t) => t.type === i.type)!} reload={reload}
          source={i.type in SHOWN && st.instances.findIndex((x) => x.type === i.type) === n && i.type in src ? { label: SHOWN[i.type], on: src[i.type], set: (on) => toggleSource(i.type, on) } : undefined} />
      ))}
      <Card>
        <h2 className="mb-1 font-bold">{tx("Lus sans connecteur")}</h2>
        <p className="mb-2 text-sm text-muted">{tx("Ces sources n'ont pas d'URL ni de jeton à régler ici : leur interrupteur décide seulement si la page les affiche.")}</p>
        <ul className="flex flex-col divide-y divide-line/60">
          <li className="flex items-center gap-3 py-2.5">
            <Switch on={!!src.apache} onChange={(on) => toggleSource("apache", on)} label={`${src.apache ? tx("Couper") : tx("Activer")} Apache`} />
            <Server size={16} className="text-muted" aria-hidden />
            <div className="min-w-0 flex-1"><b>Apache</b> <Dim>· {tx("vhosts lus par SSH sur chaque machine, comme services (accès : Réglages → Machines)")}</Dim></div>
          </li>
          <li className="flex items-center gap-3 py-2.5 opacity-60">
            <Switch on={false} disabled onChange={() => undefined} label="Fail2ban" />
            <Ban size={16} className="text-muted" aria-hidden />
            <div className="min-w-0 flex-1"><b>Fail2ban</b> <Badge tone="off">{tx("à venir")}</Badge> <Dim>· {tx("bannissements et prisons, par LogviewR (arrive avec son connecteur)")}</Dim></div>
          </li>
        </ul>
        <NoteLine note={srcNote} />
        {changed && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            {tx("Pris en compte à la prochaine collecte.")}
            <button type="button" className={primary}
              onClick={() => void act(() => send("POST", "system/tasks/collect/run"), tx("collecte lancée : la page se met à jour à la fin"), setSrcNote)}>
              {tx("Lancer la collecte maintenant")}
            </button>
          </div>
        )}
      </Card>
      <SshReads />
    </div>
  );
}


/** Lus par SSH : pas d'URL ni de jeton ici, l'accès se règle avec la machine (Réglages → Machines) ; chaque ligne ouvre la bonne carte */
function SshReads() {
  const [m, setM] = useState<MachinesSettings | null>(null);
  useEffect(() => { read<MachinesSettings>("machines/settings").then(setM).catch(() => undefined); }, []);
  const rows = m ? Object.entries(m.machines).filter(([, c]) => c.ssh || c.health).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })) : [];
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Server size={16} />{tx("Lus par SSH")} <Dim>· {rows.length}</Dim></h2>
      <p className="mb-2 text-sm text-muted">{tx("Docker, services en écoute et AdGuard natif sont lus par SSH : l'accès et ce qui est lu se règlent machine par machine.")}</p>
      {rows.length === 0 ? <Dim>{tx("Aucune machine lue par SSH pour l'instant.")}</Dim> : (
        <ul className="flex flex-col divide-y divide-line/60">
          {rows.map(([ip, c]) => {
            const reads = [c.os === "windows" ? tx("santé Windows") : "Docker", m!.process_hosts[ip] && tx("services en écoute"), c.adguard && "AdGuard"].filter(Boolean).join(" · ");
            return (
              <li key={ip}>
                <a href={`#settings/machines/${ip}`} className="group flex items-center gap-3 py-2.5 text-sm hover:bg-bg2/60">
                  <b className="min-w-0 flex-1 truncate">{c.name} <Dim>· {ip}</Dim></b>
                  <span className="hidden truncate text-xs text-dim sm:inline">{reads}</span>
                  <Badge tone="off">SSH {String((c.os === "windows" ? c.health : c.ssh) ?? "")}</Badge>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-link">{tx("Régler")}<ArrowRight size={13} aria-hidden className="transition-transform group-hover:translate-x-0.5" /></span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Connecteurs dont l'affichage sur la page est une source activable (le même interrupteur vaut pour toutes les instances du type) */
const SHOWN: Record<string, string> = { npm: tx("Afficher les services et compteurs NPM sur la page"), adguard: tx("Afficher l'onglet DNS et les compteurs AdGuard (toutes les instances)") };

function InstanceCard({ inst, type, reload, source }: { inst: ConnectorInstance; type: ConnectorType; reload: () => void; source?: { label: string; on: boolean; set: (on: boolean) => void } }) {
  const [edit, setEdit] = useState(false), [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
  const url = inst.config.url as string | undefined;
  const path = `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}`;
  const toggle = (on: boolean) => void act(() => send("PATCH", path, { enabled: on }),
    on ? tx("allumé : relu au prochain passage de la collecte") : tx("coupé : réglages gardés, plus rien de lu"), setNote).then((ok) => ok && reload());
  return (
    <Card className={inst.enabled ? "" : "opacity-80"}>
      <div className="-mx-4 -mt-4 mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-t-2xl border-b border-line/60 bg-bg2/50 px-4 py-2.5 text-sm">
        <label className="flex items-center gap-2">
          <Switch on={inst.enabled} onChange={toggle} label={inst.enabled ? `Couper ${inst.label}` : `Allumer ${inst.label}`} />
          <span className={inst.enabled ? "font-semibold text-txt" : "text-dim"}>{inst.enabled ? tx("Collecte active") : tx("Collecte coupée")}</span>
        </label>
        {source && (
          <label className="flex items-center gap-2">
            <Switch on={source.on} onChange={source.set} label={source.label} />
            <span className={source.on ? "text-muted" : "text-dim"} title={source.label}>{source.on ? tx("Affiché sur la page") : tx("Masqué sur la page")}</span>
          </label>
        )}
        <span className="ml-auto text-xs text-dim">{tx("Réglages de l'accès ci-dessous")}</span>
      </div>
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
