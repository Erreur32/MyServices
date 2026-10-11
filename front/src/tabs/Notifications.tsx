// Réglages → Notifications : des messages que l'on compose soi-même (rapports de machines à heure fixe, événements en direct filtrés),
// envoyés sur les mêmes canaux que les alertes. Des exemples fonctionnels s'ajoutent d'un clic ; « Envoyer maintenant » envoie un vrai message.
import { BarChart3, CalendarClock, Pencil, Plus, Radio, Send, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { IconChoice } from "../components/IconChoice";
import { Badge, Card, Count, Dim } from "../components/ui";
import { dateTime } from "../lib/format";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { AlertChannel, NotificationItem, NotificationsState } from "../types";
import { CHANNEL_ICON } from "./Alerts";

const DAYS = [tx("Lun"), tx("Mar"), tx("Mer"), tx("Jeu"), tx("Ven"), tx("Sam"), tx("Dim")];
const COOLDOWNS: [number, string][] = [[0, tx("aucun")], [5, "5 min"], [60, "1 h"], [360, "6 h"], [1440, "24 h"]];
const KIND_CHOICE = [
  { value: "report" as const, label: tx("Rapport de machines"), hint: tx("Un message à heure fixe avec les capteurs de votre choix"), icon: <BarChart3 size={26} className="text-link" aria-hidden /> },
  { value: "events" as const, label: tx("Événements en direct"), hint: tx("Chaque événement correspondant au filtre, dès qu'il arrive"), icon: <Radio size={26} className="text-warn" aria-hidden /> },
];

const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`;
const toggled = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Notifications() {
  const [st, setSt] = useState<NotificationsState | null>(null), [error, setError] = useState("");
  const reload = useCallback(() => {
    read<NotificationsState>("notifications").then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 font-bold"><Send size={16} />{tx("Notifications")}</h2>
        <p className="mt-1 text-sm text-muted">{tx("Des messages que vous composez : un rapport de vos machines à heure fixe, ou les événements d'un service ou d'une machine en direct. Ils partent sur les canaux de l'onglet Alertes (Discord, Telegram, webhook).")}</p>
        {st.channels.filter((c) => c.enabled).length === 0 && <p className="mt-2 text-sm text-warn">{tx("Aucun canal actif : ajoutez-en un dans l'onglet Alertes pour recevoir quoi que ce soit.")}</p>}
      </Card>
      <List st={st} reload={reload} />
      <Examples st={st} reload={reload} />
      <Sent st={st} />
    </div>
  );
}

function describe(n: NotificationItem, st: NotificationsState): string {
  const c = n.config;
  if (n.kind === "report") {
    const days = c.days.length === 7 ? tx("tous les jours") : c.days.map((d) => DAYS[d]).join(" ");
    const who = c.machines.length ? tx("{0} machine(s)", c.machines.length) : tx("toutes les machines");
    return `${days} · ${c.at.join(", ")} · ${who} · ${tx("{0} capteur(s)", c.sensors.length)}`;
  }
  const kinds = c.kinds.length ? c.kinds.map((k) => st.kinds.find((x) => x.id === k)?.label ?? k).join(", ") : tx("tous les événements");
  return [kinds, c.machine && `${tx("machine")} « ${c.machine} »`, c.match && `« ${c.match} »`, c.cooldown_min ? tx("au plus 1 fois / {0} min", c.cooldown_min) : null].filter(Boolean).join(" · ");
}

function List({ st, reload }: { st: NotificationsState; reload: () => void }) {
  const [editing, setEditing] = useState<NotificationItem | "new" | null>(null), [note, setNote] = useState<Note>(null), [confirm, setConfirm] = useState(0), [busy, setBusy] = useState(0);
  const chName = (id: number) => st.channels.find((c) => c.id === id)?.name;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{tx("Mes notifications")} <Count n={st.notifications.length} /></h2>
        {!editing && <button type="button" className={quiet} onClick={() => setEditing("new")}><Plus size={14} />{tx("Nouvelle notification")}</button>}
      </div>
      {st.notifications.length === 0 && !editing && <p className="text-sm text-muted">{tx("Aucune notification. Ajoutez un exemple ci-dessous ou créez la vôtre.")}</p>}
      <ul className="flex flex-col gap-2">
        {st.notifications.map((n) => (
          <li key={n.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-bg2/30 px-3 py-2.5 ${n.enabled ? "border-line" : "border-line/60 opacity-75"}`}>
            <Switch on={n.enabled} label={n.enabled ? tx("Désactiver") : tx("Activer")} onChange={(on) => void act(() => send("PATCH", `notifications/${n.id}`, { enabled: on }), on ? tx("activée") : tx("désactivée"), setNote).then(reload)} />
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg2">
              {n.kind === "report" ? <CalendarClock size={17} className="text-link" aria-hidden /> : <Radio size={17} className="text-warn" aria-hidden />}
            </span>
            <div className="min-w-[220px] flex-1">
              <div className="flex flex-wrap items-center gap-2"><b>{n.name}</b>
                <Badge tone={n.kind === "report" ? "info" : "warn"}>{n.kind === "report" ? <CalendarClock size={11} aria-hidden /> : <Radio size={11} aria-hidden />}{n.kind === "report" ? tx("rapport") : tx("en direct")}</Badge>
                {n.channels.map((c) => chName(c)).filter(Boolean).map((nm) => <Badge key={nm} tone="off">{nm}</Badge>)}
                {n.channels.length === 0 && <Badge tone="warn">{tx("aucun canal")}</Badge>}
              </div>
              <p className="text-xs text-dim">{describe(n, st)}{n.last_sent && <> · {tx("dernier envoi")} {dateTime(n.last_sent * 1000)}</>}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button type="button" className={quiet} disabled={busy === n.id} onClick={() => { setBusy(n.id); void act(async () => { const r = await send<{ results: string[] }>("POST", `notifications/${n.id}/send`); return r; }, tx("message envoyé : vérifiez le canal"), setNote).then(() => { setBusy(0); reload(); }); }}
                title={tx("Envoie un vrai message de cette notification, avec les valeurs du moment")}><Send size={13} aria-hidden />{tx("Envoyer maintenant")}</button>
              <button type="button" className={quiet} onClick={() => setEditing(n)}><Pencil size={13} aria-hidden />{tx("Modifier")}</button>
              {confirm === n.id ? <>
                <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `notifications/${n.id}`), tx("notification supprimée"), setNote).then(() => { setConfirm(0); reload(); })}>{tx("Confirmer")}</button>
                <button type="button" className={quiet} onClick={() => setConfirm(0)}>{tx("Annuler")}</button>
              </> : <button type="button" className={quiet} onClick={() => setConfirm(n.id)} aria-label={tx("Supprimer {0}", n.name)}><Trash2 size={13} aria-hidden /></button>}
            </div>
          </li>
        ))}
      </ul>
      <NoteLine note={note} />
      {editing && <Form key={editing === "new" ? "new" : editing.id} st={st} item={editing === "new" ? undefined : editing} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />}
    </Card>
  );
}

function ChannelPick({ channels, value, onChange }: { channels: AlertChannel[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <button key={c.id} type="button" aria-pressed={value.includes(c.id)} onClick={() => onChange(toggled(value, c.id))} className={chip(value.includes(c.id))}>
          <span className="grid h-4 w-4 place-items-center [&>*]:h-4 [&>*]:w-4">{CHANNEL_ICON[c.type]}</span>{c.name}{!c.enabled && <Dim> {tx("(coupé)")}</Dim>}
        </button>
      ))}
      {channels.length === 0 && <Dim>{tx("Aucun canal : à créer dans l'onglet Alertes.")}</Dim>}
    </div>
  );
}

function Form({ st, item, onDone, onCancel }: { st: NotificationsState; item?: NotificationItem; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"report" | "events">(item?.kind ?? "report");
  const [name, setName] = useState(item?.name ?? "");
  const [channels, setChannels] = useState<number[]>(item?.channels ?? st.channels.filter((c) => c.enabled).map((c) => c.id));
  const c0 = item?.config;
  const [machines, setMachines] = useState<string[]>(c0?.machines ?? []);
  const [sensors, setSensors] = useState<string[]>(c0?.sensors ?? ["level", "cpu", "mem", "disk"]);
  const [at, setAt] = useState<string[]>(c0?.at ?? ["08:00"]);
  const [days, setDays] = useState<number[]>(c0?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [kinds, setKinds] = useState<string[]>(c0?.kinds ?? []);
  const [machine, setMachine] = useState(c0?.machine ?? ""), [match, setMatch] = useState(c0?.match ?? "");
  const [resolved, setResolved] = useState(c0?.resolved ?? true), [cooldown, setCooldown] = useState(c0?.cooldown_min ?? 0);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const config = kind === "report" ? { machines, sensors, at: at.filter(Boolean), days } : { kinds, machine, match, resolved, cooldown_min: cooldown };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    const body = { name, kind, channels, config };
    const ok = await act(() => (item ? send("PATCH", `notifications/${item.id}`, body) : send("POST", "notifications", { ...body, enabled: true })), item ? tx("notification enregistrée") : tx("notification ajoutée : « Envoyer maintenant » pour l'essayer"), setNote);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4 rounded-xl border border-line bg-bg2/50 p-4">
      {!item && <Field label={tx("Type")}><IconChoice label={tx("Type de notification")} value={kind} onPick={setKind} options={KIND_CHOICE} /></Field>}
      <Field label={tx("Nom")}><input className={input} maxLength={80} placeholder={kind === "report" ? tx("ex. Rapport du matin") : tx("ex. Pannes de mes services")} value={name} onChange={(e) => setName(e.target.value)} /></Field>

      {kind === "report" ? (
        <>
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">{tx("Machines")} <Dim>· {machines.length ? tx("{0} choisie(s)", machines.length) : tx("toutes")}</Dim></legend>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={machines.length === 0} onClick={() => setMachines([])} className={chip(machines.length === 0)}>{tx("Toutes")}</button>
              {st.machines.map((m) => <button key={m.ip} type="button" aria-pressed={machines.includes(m.ip)} onClick={() => setMachines(toggled(machines, m.ip))} className={chip(machines.includes(m.ip))} title={m.ip}>{m.name}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">{tx("Capteurs affichés")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {st.sensors.map((s) => <button key={s.id} type="button" aria-pressed={sensors.includes(s.id)} onClick={() => setSensors(toggled(sensors, s.id))} className={chip(sensors.includes(s.id))}><span aria-hidden>{s.icon}</span>{s.label}</button>)}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-1.5 text-sm text-muted">{tx("Heures d'envoi")}</legend>
              <div className="flex flex-wrap items-center gap-2">
                {at.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1"><input type="time" className={`${input} w-28 py-1`} value={t} onChange={(e) => setAt(at.map((x, j) => (j === i ? e.target.value : x)))} aria-label={tx("Heure {0}", i + 1)} />
                    {at.length > 1 && <button type="button" className="text-dim hover:text-bad" onClick={() => setAt(at.filter((_, j) => j !== i))} aria-label={tx("Retirer cette heure")}>×</button>}</span>
                ))}
                {at.length < 6 && <button type="button" className={quiet} onClick={() => setAt([...at, "18:00"])}><Plus size={13} aria-hidden />{tx("heure")}</button>}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-sm text-muted">{tx("Jours")}</legend>
              <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(toggled(days, i).sort())} className={chip(days.includes(i))}>{d}</button>)}</div>
            </fieldset>
          </div>
        </>
      ) : (
        <>
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">{tx("Événements")} <Dim>· {kinds.length ? tx("{0} genre(s)", kinds.length) : tx("tous")}</Dim></legend>
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
              <button type="button" aria-pressed={kinds.length === 0} onClick={() => setKinds([])} className={chip(kinds.length === 0)}>{tx("Tous (flux en direct)")}</button>
              {Object.entries(st.groups).map(([g, gl]) => (
                <div key={g} className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-dim">{gl}</span>
                  <div className="flex flex-wrap gap-1.5">{st.kinds.filter((k) => k.group === g).map((k) => <button key={k.id} type="button" aria-pressed={kinds.includes(k.id)} onClick={() => setKinds(toggled(kinds, k.id))} className={chip(kinds.includes(k.id))}>{k.label}</button>)}</div></div>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx("Machine (nom ou IP, facultatif)")}><input className={input} list="notif-machines" maxLength={120} placeholder={tx("toutes")} value={machine} onChange={(e) => setMachine(e.target.value)} />
              <datalist id="notif-machines">{st.machines.map((m) => <option key={m.ip} value={m.name} />)}</datalist></Field>
            <Field label={tx("Service ou texte (facultatif)")}><input className={input} maxLength={120} placeholder={tx("ex. plex, nginx")} value={match} onChange={(e) => setMatch(e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--link))]" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />{tx("Envoyer aussi les retours à la normale (rétabli, en ligne, santé OK…)")}</label>
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">{tx("Même événement, au plus une fois en")}</legend>
            <div className="flex flex-wrap gap-1.5">{COOLDOWNS.map(([v, l]) => <button key={v} type="button" aria-pressed={cooldown === v} onClick={() => setCooldown(v)} className={chip(cooldown === v)}>{l}</button>)}</div>
          </fieldset>
        </>
      )}

      <fieldset><legend className="mb-1.5 text-sm text-muted">{tx("Envoyer sur")}</legend><ChannelPick channels={st.channels} value={channels} onChange={setChannels} /></fieldset>
      <div className="flex gap-2"><button className={primary} disabled={busy}>{item ? tx("Enregistrer") : tx("Ajouter")}</button><button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button></div>
      <NoteLine note={note} />
    </form>
  );
}

function Examples({ st, reload }: { st: NotificationsState; reload: () => void }) {
  const have = new Set(st.notifications.map((n) => n.name));
  const todo = st.examples.filter((e) => !have.has(e.name));
  const [note, setNote] = useState<Note>(null);
  if (!todo.length) return null;
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Sparkles size={16} />{tx("Exemples prêts à l'emploi")}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Ajoutés désactivés, sur vos canaux actifs : relisez-les, essayez-les avec « Envoyer maintenant », puis activez-les.")}</p>
      <ul className="flex flex-col gap-1.5">
        {todo.map((e) => (
          <li key={e.name} className="flex flex-wrap items-center gap-3 rounded-lg bg-bg2/50 px-3 py-2 text-sm">
            <Badge tone={e.kind === "report" ? "info" : "warn"}>{e.kind === "report" ? tx("rapport") : tx("en direct")}</Badge>
            <span className="min-w-0 flex-1">{e.name}</span>
            <button type="button" className={quiet} onClick={() => void act(() => send("POST", "notifications/examples", { names: [e.name] }), tx("exemple ajouté (désactivé)"), setNote).then(reload)}><Plus size={13} aria-hidden />{tx("Ajouter")}</button>
          </li>
        ))}
      </ul>
      {todo.length > 1 && <button type="button" className={`${quiet} mt-3`} onClick={() => void act(() => send("POST", "notifications/examples", { names: todo.map((e) => e.name) }), tx("exemples ajoutés (désactivés)"), setNote).then(reload)}>{tx("Tout ajouter")}</button>}
      <NoteLine note={note} />
    </Card>
  );
}

function Sent({ st }: { st: NotificationsState }) {
  if (!st.sent.length) return null;
  return (
    <Card>
      <h2 className="mb-2 font-bold">{tx("Derniers envois")} <Count n={st.sent.length} /></h2>
      <ul className="flex flex-col divide-y divide-line/60 text-sm">
        {st.sent.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-mono text-xs text-dim">{dateTime(s.ts * 1000)}</span>
            <b className="min-w-0 flex-1 truncate">{s.rule.replace(/^🔔\s*/, "")}</b>
            <Badge tone="off">{s.channel}</Badge>
            <Badge tone={s.ok ? "ok" : "bad"} title={s.info}>{s.ok ? tx("envoyé") : tx("échec")}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
