// Réglages → Connecteurs : services lus par leur API (NPM, Beszel, Uptime Kuma, Dozzle, Web-Check…), en
// lecture seule. Formulaire généré depuis les champs déclarés par chaque connecteur, bouton Tester (sans
// enregistrer), état au dernier passage. Ce qui est lu par SSH (Docker, process, AdGuard) : section Machines.
import { HelpCircle, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { StatusLine } from "../components/ssh";
import type { ConnectorInstance, ConnectorsState, ConnectorType } from "../types";
import { takePrefill, type Prefill } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";

const KIND: Record<string, string> = {
  services: "services", health: tx("santé"), logs: "journaux", dns: "DNS", inventory: "inventaire", backups: "sauvegardes",
};

// Proposé depuis « Premiers pas » : lu une seule fois, à l'ouverture de l'onglet
export function Connectors() {
  const [prefill] = useState(takePrefill);
  const [st, setSt] = useState<ConnectorsState | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string>(() => prefill?.type ?? "");
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
          <select className={`${input} max-w-[240px]`} value="" onChange={(e) => setAdding(e.target.value)} aria-label={tx("Ajouter un connecteur")}>
            <option value="">{tx("+ Ajouter un connecteur…")}</option>
            {st.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </div>
        <p className="mt-1 text-sm text-muted">
          {tx("Services lus par leur API,")} <b className="text-txt">{tx("en lecture seule")}</b> {tx(": prévoir un compte ou une clé lecture seule. « Tester » essaie les réglages sans les enregistrer ; un changement est pris en compte au prochain passage de la collecte.")}
        </p>
        {type && <ConnectorForm key={type.type} type={type} prefill={prefill?.type === type.type ? prefill : null} onDone={() => { setAdding(""); reload(); }} onCancel={() => setAdding("")} />}
      </Card>
      {st.instances.map((i) => (
        <InstanceCard key={`${i.type}/${i.name}`} inst={i} type={st.types.find((t) => t.type === i.type)!} reload={reload} />
      ))}
      <p className="px-1 text-sm text-muted">
        {tx("Docker, services en écoute et AdGuard sont lus")} <b className="text-txt">{tx("par SSH")}</b> {tx(": leur accès et leur état se règlent avec chaque machine, dans Réglages → Machines.")}
      </p>
    </div>
  );
}


function InstanceCard({ inst, type, reload }: { inst: ConnectorInstance; type: ConnectorType; reload: () => void }) {
  const [edit, setEdit] = useState(false), [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
  const url = inst.config.url as string | undefined;
  const path = `connectors/settings/${inst.type}/${encodeURIComponent(inst.name)}`;
  const toggle = (on: boolean) => void act(() => send("PATCH", path, { enabled: on }),
    on ? tx("allumé : relu au prochain passage de la collecte") : tx("coupé : réglages gardés, plus rien de lu"), setNote).then((ok) => ok && reload());
  return (
    <Card className={inst.enabled ? "" : "opacity-70"}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Switch on={inst.enabled} onChange={toggle} label={inst.enabled ? `Couper ${inst.label}` : `Allumer ${inst.label}`} />
            <b>{inst.label}</b><Dim>· {inst.name}</Dim>
            {!inst.enabled && <Badge tone="off">{tx("coupé")}</Badge>}
            {type.kinds.map((k) => <Badge key={k} tone="info">{KIND[k] || k}</Badge>)}
          </div>
          {url && <div className="mt-0.5 font-mono text-xs text-dim">{url}</div>}
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

export function ConnectorForm({ type, inst, prefill, onDone, onCancel }: { type: ConnectorType; inst?: ConnectorInstance; prefill?: Prefill | null; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(inst?.name || prefill?.name || type.type);
  const [conf, setConf] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {};
    for (const f of type.fields) if (!f.secret) init[f.name] = inst?.config[f.name] ?? (f.name === "url" ? prefill?.url : undefined) ?? (f.default as string | number | boolean | null) ?? "";
    return init;
  });
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
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
    const ok = await act(() => send("PUT", `connectors/settings/${type.type}`, body()), tx("enregistré : pris en compte au prochain passage de la collecte"), setNote);
    setBusy(false);
    if (ok) setTimeout(onDone, 900);
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-bg2/50 p-3">
      {type.guide && type.guide.length > 0 && (
        <details open={!inst} className="rounded-lg border border-line/70 bg-bg2/60 px-3 py-2 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-txt"><HelpCircle size={15} aria-hidden />{tx("Besoin d'aide pour obtenir ces accès ?")}</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">{type.guide.map((g) => <li key={g}>{g}</li>)}</ol>
        </details>
      )}
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
        {busy && <span className="self-center text-sm text-dim">…</span>}
      </div>
      <NoteLine note={note} />
    </form>
  );
}
