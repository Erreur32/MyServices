// Réglages → Alertes, sur le modèle de GpuViewR : canaux (Discord, Telegram, webhook ; bouton Essayer),
// règles (genres d'événements, machine, texte, canaux, délai, retours à la normale), préréglages ajoutés
// désactivés, et les derniers envois. Les secrets ne reviennent jamais du serveur : champ vide = inchangé.
import { Bell, ChevronDown, ChevronUp, Eye, EyeOff, History, ListChecks, Pencil, Plus, Radio, Send, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Field, NoteLine } from "../components/form";
import { IconChoice } from "../components/IconChoice";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { dateTime } from "../lib/format";
import type { AlertChannel, AlertRule, AlertsState, ChannelType } from "../types";
import { tx } from "../lib/i18n";

/** Logo de chaque type de canal (public/icons, simple-icons) ; le webhook générique n'a pas de marque : icône d'objet */
export const CHANNEL_ICON: Record<ChannelType, React.ReactNode> = {
  discord: <img src={`${import.meta.env.BASE_URL}icons/discord.svg`} alt="" className="h-7 w-7" />,
  telegram: <img src={`${import.meta.env.BASE_URL}icons/telegram.svg`} alt="" className="h-7 w-7" />,
  webhook: <Webhook size={26} className="text-muted" aria-hidden />,
};

export const TYPES: Record<ChannelType, { label: string; fields: { k: string; label: string; secret?: boolean; hint: string }[] }> = {
  discord: { label: tx("Discord"), fields: [
    { k: "url", label: tx("URL du webhook"), secret: true, hint: tx("Salon → Modifier → Intégrations → Webhooks → Copier l'URL") },
  ] },
  telegram: { label: tx("Telegram"), fields: [
    { k: "token", label: tx("Jeton du bot"), secret: true, hint: tx("donné par @BotFather") },
    { k: "chat_id", label: tx("Conversation (chat_id)"), hint: tx("écrire d'abord au bot ; un groupe commence par -") },
  ] },
  webhook: { label: tx("Webhook"), fields: [
    { k: "url", label: tx("URL (POST JSON)"), secret: true, hint: tx("ntfy, Home Assistant, n8n, Gotify (via relais)…") },
    { k: "token", label: tx("Jeton Bearer (facultatif)"), secret: true, hint: tx("envoyé dans l'en-tête Authorization") },
  ] },
};

const HIDE_KEY = "ms.alerts.status.hidden";

/** État du moteur d'alertes. Le cadre explicatif peut se masquer (choix retenu) : il reste alors une ligne d'état avec « Afficher ». */
function Status({ active }: { active: boolean }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  const set = (h: boolean) => { setHidden(h); try { localStorage.setItem(HIDE_KEY, h ? "1" : "0"); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  const badge = <Badge tone={active ? "ok" : "warn"}>{active ? tx("alertes actives") : tx("aucune règle active")}</Badge>;
  if (hidden) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Bell size={15} aria-hidden />{badge}
        <button type="button" className={quiet} onClick={() => set(false)}><Eye size={13} aria-hidden />{tx("Afficher l'explication")}</button>
      </div>
    );
  }
  return (
    <Card tone={active ? "ok" : "warn"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><Bell size={16} />{tx("Alertes")} {badge}</h2>
        <button type="button" className={quiet} onClick={() => set(true)} title={tx("Masquer ce cadre ; l'état reste affiché en une ligne")}><EyeOff size={13} aria-hidden />{tx("Masquer")}</button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {active
          ? tx("Actives : chaque nouvel événement (panne, machine hors ligne, santé…) passe par les règles ci-dessous, après la collecte et la santé.")
          : tx("Aucune règle active avec un canal actif : les anciens envois de config.json (s'il y en a) continuent tels quels.")}
        {" "}{tx("Les pannes sont déjà confirmées sur plusieurs passages avant d'arriver ici.")}
      </p>
    </Card>
  );
}

export function Alerts() {
  const [st, setSt] = useState<AlertsState | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    read<AlertsState>("alerts")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);

  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <Status active={st.active} />
      <Channels st={st} reload={reload} />
      <Rules st={st} reload={reload} />
      <Sent st={st} />
    </div>
  );
}

// ── Canaux ──

function Channels({ st, reload }: { st: AlertsState; reload: () => void }) {
  const [adding, setAdding] = useState(st.channels.length === 0);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><Radio size={16} aria-hidden />{tx("Canaux")} <Count n={st.channels.length} /></h2>
        {!adding && <button type="button" className={quiet} onClick={() => setAdding(true)}><Plus size={14} />{tx("Ajouter un canal")}</button>}
      </div>
      {st.channels.length === 0 && <p className="mb-3 text-sm text-muted">{tx("Aucun canal : en ajouter un pour recevoir les alertes.")}</p>}
      <ul className="flex flex-col gap-2">
        {st.channels.map((c) => <ChannelRow key={c.id} c={c} reload={reload} />)}
      </ul>
      {adding && <ChannelForm onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
    </Card>
  );
}

function ChannelRow({ c, reload }: { c: AlertChannel; reload: () => void }) {
  const [note, setNote] = useState<Note>(null);
  const [edit, setEdit] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string, again = true) => {
    setBusy(true);
    if (await act(fn, done, setNote) && again) reload();
    setBusy(false);
  };
  return (
    <li className="rounded-xl border border-line bg-bg2/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg2 [&>*]:h-5 [&>*]:w-5">{CHANNEL_ICON[c.type]}</span>
        <div className="min-w-[160px] flex-1">
          <b>{c.name}</b>
          <div className="text-xs text-dim">{c.type === "telegram" ? `conversation ${c.config.chat_id}` : c.set.url ? tx("URL renseignée") : tx("URL manquante")}</div>
        </div>
        <Badge tone="info">{TYPES[c.type].label}</Badge>
        <Badge tone={c.enabled ? "ok" : "off"}>{c.enabled ? tx("actif") : tx("coupé")}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => send("POST", `alerts/channels/${c.id}/test`), tx("message d'essai envoyé : vérifier qu'il est arrivé"), false)}>
            <Send size={14} />{tx("Essayer")}
          </button>
          <button type="button" className={quiet} onClick={() => void run(() => send("PATCH", `alerts/channels/${c.id}`, { enabled: !c.enabled }), c.enabled ? tx("canal coupé") : tx("canal réactivé"))}>
            {c.enabled ? tx("Couper") : tx("Réactiver")}
          </button>
          <button type="button" className={quiet} onClick={() => setEdit(!edit)} aria-expanded={edit}><Pencil size={14} />{tx("Modifier")}</button>
          {confirm ? <>
            <button type="button" className={danger} onClick={() => void run(() => send("DELETE", `alerts/channels/${c.id}`), tx("canal supprimé"))}>{tx("Confirmer")}</button>
            <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
          </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Supprimer")}</button>}
        </div>
      </div>
      {edit && <ChannelForm channel={c} onDone={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} />}
      <NoteLine note={note} />
    </li>
  );
}

export function ChannelForm({ channel, onDone, onCancel }: { channel?: AlertChannel; onDone: () => void; onCancel: () => void }) {
  const [type, setType] = useState<ChannelType>(channel?.type || "discord");
  const [name, setName] = useState(channel?.name || "");
  const [conf, setConf] = useState<Record<string, string>>(channel?.config || {});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => channel
      ? send("PATCH", `alerts/channels/${channel.id}`, { name, config: conf })
      : send("POST", "alerts/channels", { name: name || TYPES[type].label, type, config: conf }),
    channel ? tx("canal enregistré") : tx("canal ajouté : l'essayer"), setNote);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-bg2/50 p-3">
      {!channel && (
        <Field label={tx("Type")}>
          <IconChoice label={tx("Type de canal")} value={type} onPick={(v) => { setType(v); setConf({}); }}
            options={(Object.keys(TYPES) as ChannelType[]).map((k) => ({ value: k, label: TYPES[k].label, icon: CHANNEL_ICON[k] }))} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Nom")}>
          <input className={input} maxLength={80} placeholder={TYPES[type].label} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      {TYPES[type].fields.map((f) => {
        const kept = channel && f.secret && channel.set[f.k];
        return (
          <Field key={f.k} label={f.label}>
            <input className={input} type={f.secret ? "password" : "text"} autoComplete="off" value={conf[f.k] || ""}
              placeholder={kept ? tx("déjà renseigné : laisser vide pour garder") : ""} onChange={(e) => setConf({ ...conf, [f.k]: e.target.value })} />
            <span className="text-xs text-dim">{f.hint}</span>
          </Field>
        );
      })}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>{channel ? tx("Enregistrer") : tx("Ajouter")}</button>
        <button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button>
      </div>
      <NoteLine note={note} />
    </form>
  );
}

// ── Règles ──

function Rules({ st, reload }: { st: AlertsState; reload: () => void }) {
  const [adding, setAdding] = useState(false), [presets, setPresets] = useState(false);
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><ListChecks size={16} aria-hidden />{tx("Règles")} <Count n={st.rules.length} /></h2>
        <div className="flex gap-1.5">
          <button type="button" className={quiet} onClick={() => setPresets(!presets)} aria-expanded={presets}>{tx("Préréglages")}</button>
          {!adding && <button type="button" className={quiet} onClick={() => setAdding(true)} disabled={!st.channels.length}><Plus size={14} />{tx("Nouvelle règle")}</button>}
        </div>
      </div>
      <p className="mb-3 text-sm text-muted">
        {tx("Une règle choisit les événements à prévenir et les canaux qui les reçoivent. Le délai évite de renvoyer la même alerte (même élément) trop souvent.")}
      </p>
      {presets && <PresetPicker st={st} onDone={() => { setPresets(false); reload(); }} />}
      {st.rules.length === 0 && !adding && <p className="text-sm text-muted">{tx("Aucune règle : partir des préréglages, ou en créer une.")}</p>}
      <ul className="flex flex-col gap-2">
        {st.rules.map((r) => <RuleRow key={r.id} r={r} st={st} reload={reload} />)}
      </ul>
      {adding && <RuleForm st={st} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
    </Card>
  );
}

const kindLabel = (st: AlertsState, k: string) => st.kinds.find((x) => x.id === k)?.label || k;

function RuleRow({ r, st, reload }: { r: AlertRule; st: AlertsState; reload: () => void }) {
  const [note, setNote] = useState<Note>(null), [edit, setEdit] = useState(false), [confirm, setConfirm] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => { if (await act(fn, done, setNote)) reload(); };
  const names = r.channels.map((id) => st.channels.find((c) => c.id === id)?.name).filter(Boolean);
  return (
    <li className={`rounded-xl border bg-bg2/30 px-3 py-2.5 ${r.enabled ? "border-line" : "border-line/60 opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg2"><Bell size={17} className={r.enabled ? "text-link" : "text-dim"} aria-hidden /></span>
        <div className="min-w-[220px] flex-1">
          <b>{r.name}</b>
          <div className="mt-0.5 text-xs text-muted">{r.kinds.map((k) => kindLabel(st, k)).join(" · ")}</div>
          <div className="mt-0.5 text-xs text-dim">
            → {names.length ? names.join(", ") : tx("aucun canal")}
            {r.machine && tx(" · machine « {0} »", r.machine)}{r.match && tx(" · contient « {0} »", r.match)}
            {` · ${r.cooldown_min ? tx("pas plus d'une fois en {0}", r.cooldown_min >= 60 ? `${r.cooldown_min / 60} h` : `${r.cooldown_min} min`) : tx("sans délai")}`}
            {r.resolved && tx(" · retours à la normale")}
          </div>
        </div>
        <Badge tone={r.enabled ? "ok" : "off"}>{r.enabled ? tx("active") : tx("désactivée")}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" className={quiet} onClick={() => void run(() => send("PATCH", `alerts/rules/${r.id}`, { enabled: !r.enabled }), r.enabled ? tx("règle désactivée") : tx("règle activée"))}>
            {r.enabled ? tx("Désactiver") : tx("Activer")}
          </button>
          <button type="button" className={quiet} onClick={() => setEdit(!edit)} aria-expanded={edit}><Pencil size={14} />{tx("Modifier")}</button>
          {confirm ? <>
            <button type="button" className={danger} onClick={() => void run(() => send("DELETE", `alerts/rules/${r.id}`), tx("règle supprimée"))}>{tx("Confirmer")}</button>
            <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
          </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Supprimer")}</button>}
        </div>
      </div>
      {edit && <RuleForm st={st} rule={r} onDone={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} />}
      <NoteLine note={note} />
    </li>
  );
}

const COOLDOWNS: [number, string][] = [[0, tx("sans délai")], [15, tx("15 min")], [60, "1 h"], [180, "3 h"], [360, "6 h"], [720, "12 h"], [1440, "24 h"]];

function RuleForm({ st, rule, onDone, onCancel }: { st: AlertsState; rule?: AlertRule; onDone: () => void; onCancel: () => void }) {
  const [r, setR] = useState<Omit<AlertRule, "id">>(rule || {
    name: "", kinds: [], machine: "", match: "", channels: st.channels.filter((c) => c.enabled).map((c) => c.id),
    cooldown_min: 60, resolved: true, enabled: true,
  });
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const toggle = <K extends "kinds" | "channels">(k: K, v: AlertRule[K][number]) =>
    setR({ ...r, [k]: (r[k] as unknown[]).includes(v) ? (r[k] as unknown[]).filter((x) => x !== v) : [...r[k], v] });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => rule ? send("PATCH", `alerts/rules/${rule.id}`, r) : send("POST", "alerts/rules", r),
      rule ? tx("règle enregistrée") : tx("règle ajoutée"), setNote);
    setBusy(false);
    if (ok) onDone();
  };
  const check = "h-4 w-4 accent-[rgb(var(--link))]";
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4 rounded-xl border border-line bg-bg2/50 p-3">
      <Field label={tx("Nom (facultatif)")}>
        <input className={input} maxLength={80} placeholder={tx("ex. Pannes NAS")} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm text-muted">{tx("Prévenir pour")}</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(st.groups).map(([g, gl]) => (
            <div key={g}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{gl}</div>
              {st.kinds.filter((k) => k.group === g).map((k) => (
                <label key={k.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" className={check} checked={r.kinds.includes(k.id)} onChange={() => toggle("kinds", k.id)} />{k.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className={check} checked={r.resolved} onChange={(e) => setR({ ...r, resolved: e.target.checked })} />
        {tx("Prévenir aussi du retour à la normale (rétabli, en ligne, santé OK…)")}
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={tx("Machine (nom ou IP, facultatif)")}>
          <input className={input} maxLength={120} placeholder={tx("toutes")} value={r.machine} onChange={(e) => setR({ ...r, machine: e.target.value })} />
        </Field>
        <Field label={tx("Contient le texte (facultatif)")}>
          <input className={input} maxLength={120} placeholder={tx("ex. nas, plex")} value={r.match} onChange={(e) => setR({ ...r, match: e.target.value })} />
        </Field>
        <Field label={tx("Même alerte, au plus une fois en")}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={tx("Même alerte, au plus une fois en")}>
            {COOLDOWNS.map(([v, l]) => <button key={v} type="button" aria-pressed={r.cooldown_min === v} onClick={() => setR({ ...r, cooldown_min: v })}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${r.cooldown_min === v ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>{l}</button>)}
          </div>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm text-muted">{tx("Canaux")}</legend>
        <div className="flex flex-wrap gap-x-4">
          {st.channels.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" className={check} checked={r.channels.includes(c.id)} onChange={() => toggle("channels", c.id)} />
              {c.name}{!c.enabled && <Dim> {tx("(coupé)")}</Dim>}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>{rule ? tx("Enregistrer") : tx("Ajouter")}</button>
        <button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button>
      </div>
      <NoteLine note={note} />
    </form>
  );
}

function PresetPicker({ st, onDone }: { st: AlertsState; onDone: () => void }) {
  const have = new Set(st.rules.map((r) => r.name));
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<Note>(null);
  return (
    <div className="mb-3 rounded-xl border border-line bg-bg2/50 p-3">
      <p className="mb-2 text-sm text-muted">{tx("Règles courantes, ajoutées")} <b className="text-txt">{tx("désactivées")}</b> {tx("sur tous les canaux : les relire, puis les activer une par une.")}</p>
      {st.presets.map((p) => (
        <label key={p.name} className={`flex items-center gap-2 py-0.5 text-sm ${have.has(p.name) ? "text-dim" : ""}`}>
          <input type="checkbox" className="h-4 w-4" disabled={have.has(p.name)} checked={picked.includes(p.name)}
            onChange={() => setPicked(picked.includes(p.name) ? picked.filter((x) => x !== p.name) : [...picked, p.name])} />
          {p.name} <Dim>· {p.kinds.map((k) => kindLabel(st, k)).join(", ")}{have.has(p.name) && tx(" · déjà ajoutée")}</Dim>
        </label>
      ))}
      <button type="button" className={`${primary} mt-2`} disabled={!picked.length || !st.channels.length}
        onClick={() => void act(() => send("POST", "alerts/presets", { names: picked }), `${picked.length} préréglage(s) ajouté(s), désactivés`, setNote).then((ok) => ok && onDone())}>
        {tx("Ajouter")} {picked.length || ""}
      </button>
      {!st.channels.length && <span className="ml-2 text-xs text-dim">{tx("ajouter d'abord un canal")}</span>}
      <NoteLine note={note} />
    </div>
  );
}

// ── Envois ──

function Sent({ st }: { st: AlertsState }) {
  const [open, setOpen] = useState<number | null>(null), [doc, setDoc] = useState(false);
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 font-bold"><History size={16} aria-hidden />{tx("Derniers envois")} <Count n={st.sent.length} /></h2>
      {st.sent.length === 0 ? <p className="text-sm text-muted">{tx("Rien envoyé pour l'instant.")}</p> : (
        <ul className="flex max-h-[420px] flex-col divide-y divide-line/60 overflow-y-auto text-sm">
          {st.sent.map((s, i) => (
            <li key={i} className="py-1.5">
              <button type="button" className="flex w-full flex-wrap items-center gap-x-3 text-left" onClick={() => setOpen(open === i ? null : i)}>
                <span className="whitespace-nowrap text-dim">{dateTime(s.ts * 1000)}</span>
                <span className="font-medium">{s.rule}</span>
                <Dim>→ {s.channel}</Dim>
                <span className={s.ok ? "text-ok" : "text-bad"}>{s.ok ? "✓" : "⚠"} {s.info}</span>
                <Dim>{s.n} {tx("événement")}{s.n > 1 ? "s" : ""}</Dim>
              </button>
              {open === i && <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-bg2 p-2 font-mono text-xs text-muted">{s.summary}</pre>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-3 inline-flex items-center gap-1 text-xs text-link hover:underline" onClick={() => setDoc(!doc)}>
        {doc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{tx("Ce que reçoit un webhook")}
      </button>
      {doc && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg2 p-3 font-mono text-xs text-muted">{tx("POST <URL>   Content-Type: application/json   (Authorization: Bearer <jeton>)\n{\n  \"source\": \"myservices\", \"test\": false, \"rule\": \"Pannes de services\",\n  \"message\": \"texte prêt à afficher\",\n  \"sent_at\": \"2026-10-10T12:00:00+02:00\",\n  \"events\": [{ \"state\": \"firing\" | \"resolved\", \"kind\": \"panne\", \"title\": \"Service en panne\",\n               \"label\": \"nas.lan\", \"machine\": \"Dev\", \"target\": \"192.168.1.5\",\n               \"detail\": \"injoignable ou erreur 5xx\", \"ts\": 1791640800 }]\n}")}</pre>
      )}
    </Card>
  );
}
