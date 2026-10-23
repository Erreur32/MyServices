// Réglages (admins) : une section à la fois, ouverte depuis le menu de gauche (Administration, ou le sujet qu'elle règle).
// Comptes : les comptes (ajout, rôle, activation, nouveau mot de passe, suppression). Autres sections : un fichier chacune dans tabs/.
import { ArrowRight, Eye, KeyRound, Plus, ShieldCheck, Timer, Trash2, UserCheck, UserPlus, UserRound, Users, UserX } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { dateTime } from "../lib/format";
import type { User } from "../types";
import { Badge, Card, Count, Dim } from "../components/ui";
import { Field, NoteLine } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { NotificationsHub } from "./NotificationsHub";
import { Connectors, connectorsPart } from "./Connectors";
import { MachinesSection } from "./MachinesSection";
import { NetworkSettings } from "./NetworkSettings";
import { IconChoice, type IconOption } from "../components/IconChoice";
import { UpdatesSettings } from "./UpdatesSettings";
import { ActivityHub } from "./ActivityHub";
import { ApiMcp } from "./ApiMcp";
import { BackupsSettings } from "./BackupsSettings";
import { SystemSettings } from "./SystemSettings";
import { tx } from "../lib/i18n";
import { lastSettingsSection, normalizeSection, rememberSettingsSection, showInUrl } from "../lib/settingsNav";
import { navTrail } from "../lib/tabs";
import { checkPassword, okField, PASSWORD_MIN } from "../lib/password";
import { PasswordRules } from "../components/PasswordRules";
import { InfoNote } from "../components/InfoNote";

/** The sections, reached from the side menu (#settings/<section>[/<part>]); their place in the menu: lib/tabs.ts (NAV) */
const SECTIONS = ["machines", "connectors", "network", "backups", "alerts", "accounts", "api", "ssh", "tasks", "updates", "requests", "mail", "export"];

const ROLE: Record<User["role"], string> = { admin: "admin", viewer: tx("lecture seule") };
const ROLE_CHOICE: IconOption<User["role"]>[] = [
  { value: "viewer", label: tx("Lecture seule"), hint: tx("Voit la page et peut demander un passage (⟳)"), icon: <Eye size={26} className="text-ok" aria-hidden /> },
  { value: "admin", label: tx("Admin"), hint: tx("Tout, réglages compris"), icon: <ShieldCheck size={26} className="text-link" aria-hidden /> },
];

/** The panel of the open section; Tasks and schedules is the fallback */
function SectionPanel({ section, snap }: Readonly<{ section: string; snap: Snapshot }>) {
  switch (section) {
    case "accounts": return <Accounts me={snap.me.username} />;
    case "alerts": return <NotificationsHub />;
    case "connectors": return <Connectors snap={snap} part={connectorsPart(location.hash.split("/")[2])} />;
    case "machines": return <MachinesSection snap={snap} />;
    case "network": return <NetworkSettings snap={snap} />;
    case "updates": return <UpdatesSettings />;
    case "requests": return <ActivityHub />;
    case "api": return <ApiMcp />;
    case "ssh": return <SystemSettings part="ssh" snap={snap} />;
    case "mail": return <SystemSettings part="mail" snap={snap} />;
    case "export": return <SystemSettings part="export" snap={snap} />;
    case "backups": return <BackupsSettings machines={snap.data.machine_list} issues={snap.backups?.issues ?? []} />;
    default: return <SystemSettings part="tasks" snap={snap} />;
  }
}

/** The section wanted by an id read from the address or from memory: follows a redirect (an old section, now a page apart), else a known section, else the fallback */
function sectionFromId(id: string): string {
  const norm = normalizeSection(id);
  if (norm.redirect) { location.hash = norm.redirect; return "accounts"; }
  return SECTIONS.includes(norm.section!) ? norm.section! : "accounts";
}

export function Settings({ snap }: { snap: Snapshot }) {
  const [section, setSection] = useState(() => {
    const s = location.hash.split("/")[1]; // lien direct : #settings/<section> (menu du compte)
    if (s === "look") { location.hash = "profile"; return "accounts"; }   // Appearance moved to the profile (old link)
    return sectionFromId(s || lastSettingsSection());
  });
  useEffect(() => {
    rememberSettingsSection(section);
    // The address follows the section; a deeper part already there (#settings/machines/<ip>, #settings/network/hosts) is kept;
    // Machines, Notifications and Requests write their own sub-tab
    const s = location.hash.split("/")[1];
    if (s !== section && !(section === "machines" && s === "agents")) showInUrl(`settings/${section}`, !s);   // first opening of #settings: replaced, not one more step back
  }, [section]);
  useEffect(() => {   // a link to another section (#settings/connectors from Discovery…) while Settings is open: follow it
    const go = () => {
      if (!location.hash.startsWith("#settings/")) return;
      const s = location.hash.split("/")[1];
      const norm = normalizeSection(s);
      if (norm.redirect) { location.hash = norm.redirect; return; }
      if (SECTIONS.includes(norm.section!)) setSection(norm.section!);
    };
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, []);
  const { item, sub } = navTrail(location.hash);
  return (
    <div className="flex flex-col gap-4 py-4">
      {item && <h1 className="text-xl font-bold">{sub ? <><span className="font-normal text-muted">{item.label} ›</span> {sub.label}</> : item.label}</h1>}
      <SectionPanel section={section} snap={snap} />
    </div>
  );
}

function Accounts({ me }: { me: string }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    read<{ users: User[] }>("users")
      .then((u) => { setUsers(u.users); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">⚠ {error}</p>}
      <a href="#profile" className="group flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 transition-colors hover:border-link">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-link/20 text-link"><UserRound size={18} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm text-txt">{tx("Changer mon mot de passe ou fermer mes sessions ?")}</b>
          <span className="block text-xs text-dim">{tx("Cela se fait dans votre profil. Cette page gère les comptes de tous les utilisateurs.")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-link">{tx("Mon profil")}<ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" /></span>
      </a>
      <div className="grid gap-4 xl:grid-cols-2">
        <AddUser onDone={reload} />
        <SessionDays />
      </div>
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><Users size={16} aria-hidden />{tx("Comptes")} {users && <Count n={users.length} />}</h2>
        <InfoNote className="mb-3">
          <b className="text-txt">{tx("Admin")}</b> {tx(": tout, réglages compris.")} <b className="text-txt">{tx("Lecture seule")}</b> {tx(": voit la page et peut demander un passage (⟳). Ton propre mot de passe et tes sessions : menu du compte → « Profil ». Un admin ne peut pas se retirer ses droits, et il reste toujours au moins un admin actif.")}
        </InfoNote>
        {users && (
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge tone="info"><ShieldCheck size={11} aria-hidden />{tx("{0} admin", users.filter((u) => u.role === "admin" && !u.disabled).length)}</Badge>
            <Badge tone="off"><Eye size={11} aria-hidden />{tx("{0} en lecture seule", users.filter((u) => u.role === "viewer" && !u.disabled).length)}</Badge>
            {users.some((u) => u.disabled) && <Badge tone="warn">{tx("{0} désactivé(s)", users.filter((u) => u.disabled).length)}</Badge>}
          </div>
        )}
        {users === null ? <p className="text-sm text-muted">{tx("Chargement…")}</p> : (
          <ul className="flex flex-col divide-y divide-line/60">
            {users.map((u) => <UserRow key={u.username} u={u} self={u.username.toLowerCase() === me.toLowerCase()} onDone={reload} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SessionDays() {
  const [days, setDays] = useState(""), [note, setNote] = useState<Note>(null), [cur, setCur] = useState<number | null>(null);
  useEffect(() => { read<{ days: number }>("me/sessions").then((r) => { setCur(r.days); setDays(String(r.days)); }).catch(() => undefined); }, []);
  const n = Number(days), valid = Number.isInteger(n) && n >= 1 && n <= 90;
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Timer size={16} aria-hidden />{tx("Durée des sessions")}</h2>
      <InfoNote className="mb-3">{tx("Combien de temps un navigateur reste connecté sans que l'on redemande le mot de passe (de 1 à 90 jours). Vaut pour les prochaines connexions ; les sessions déjà ouvertes gardent leur échéance jusqu'à leur prochaine prolongation.")}</InfoNote>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) void act(() => send("PUT", "security/session-days", { days: n }), tx("enregistré : {0} jours", n), setNote).then((ok) => ok && setCur(n)); }}>
        <div className="flex flex-col gap-1 text-sm text-muted">{tx("Jours")}
          <span className="flex flex-wrap items-center gap-1.5">
            {[1, 7, 14, 30, 90].map((d) => <button key={d} type="button" aria-pressed={n === d} onClick={() => setDays(String(d))}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${n === d ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>{d}</button>)}
            <input className={`${input} w-20 py-1`} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} aria-label={tx("Jours")} />
          </span>
        </div>
        <button type="submit" className={quiet} disabled={!valid || n === cur}>{tx("Enregistrer")}</button>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}

function AddUser({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(""), [pw, setPw] = useState(""), [role, setRole] = useState<User["role"]>("viewer");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("POST", "users", { username: name, password: pw, role }), tx("compte « {0} » créé ({1})", name, ROLE[role]), setNote);
    setBusy(false);
    if (ok) { setName(""); setPw(""); setRole("viewer"); onDone(); }
  };
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-bold"><UserPlus size={16} aria-hidden />{tx("Ajouter un compte")}</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Nom (lettres, chiffres, . _ @ -)")}>
            <input className={input} autoComplete="off" required minLength={2} maxLength={64} pattern="[a-zA-Z0-9._@\-]+" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label={tx("Rôle")}>
          <IconChoice label={tx("Rôle")} value={role} onPick={setRole} options={ROLE_CHOICE} />
        </Field>
        <Field label={tx("Mot de passe ({0} caractères min., à lui transmettre)", PASSWORD_MIN)}>
          <input className={`${input} ${okField(pw)}`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <PasswordRules pw={pw} />
        <div><button type="submit" className={primary} disabled={busy || !checkPassword(pw).ok}><Plus size={14} />{tx("Créer")}</button></div>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}

function UserRow({ u, self, onDone }: { u: User; self: boolean; onDone: () => void }) {
  const [note, setNote] = useState<Note>(null);
  const [pwOpen, setPwOpen] = useState(false), [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (await act(fn, done, setNote)) onDone();
  };
  const path = `users/${encodeURIComponent(u.username)}`;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold uppercase ${u.disabled ? "bg-bg2 text-dim" : u.role === "admin" ? "bg-link/20 text-link" : "bg-ok/15 text-ok"}`}>{u.username.slice(0, 1)}</span>
        <div className="min-w-[180px] flex-1">
          <b className={u.disabled ? "text-dim line-through" : ""}>{u.username}</b>{self && <Dim> {tx("· toi")}</Dim>}
          <div className="text-xs text-dim">
            {tx("dernière connexion :")} {u.last_login ? dateTime(u.last_login * 1000) : tx("jamais")} {tx("· créé le")} {dateTime(u.created * 1000)}
          </div>
        </div>
        <Badge tone={u.role === "admin" ? "info" : "off"}>{u.role === "admin" ? <ShieldCheck size={11} aria-hidden /> : <Eye size={11} aria-hidden />}{ROLE[u.role]}</Badge>
        {u.disabled ? <Badge tone="warn">{tx("désactivé")}</Badge> : <Badge tone="ok">{tx("actif")}</Badge>}
        {!self && (
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex rounded-lg border border-line bg-bg2 p-0.5" role="radiogroup" aria-label={tx("Rôle de {0}", u.username)}>
              {ROLE_CHOICE.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={u.role === o.value} title={o.hint} disabled={u.role === o.value}
                  onClick={() => void run(() => send("PATCH", path, { role: o.value }), `${u.username} : ${ROLE[o.value]}`)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${u.role === o.value ? "bg-link/15 text-txt" : "text-muted hover:text-txt"}`}>
                  <span className="grid h-4 w-4 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">{o.icon}</span>{o.label}
                </button>
              ))}
            </span>
            <button type="button" className={quiet} onClick={() => void run(() => send("PATCH", path, { disabled: !u.disabled }),
              u.disabled ? `${u.username} réactivé` : `${u.username} désactivé, ses sessions fermées`)}>
              {u.disabled ? <><UserCheck size={14} />{tx("Réactiver")}</> : <><UserX size={14} />{tx("Désactiver")}</>}
            </button>
            <button type="button" className={quiet} onClick={() => { setPwOpen(!pwOpen); setNote(null); }} aria-expanded={pwOpen}>
              <KeyRound size={14} />{tx("Mot de passe")}
            </button>
            {confirm ? (
              <>
                <button type="button" className={danger} onClick={() => void run(() => send("DELETE", path), `${u.username} supprimé`)}>{tx("Confirmer")}</button>
                <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
              </>
            ) : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Supprimer")}</button>}
          </div>
        )}
      </div>
      {pwOpen && (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          void act(() => send("POST", `${path}/password`, { password: pw }), `nouveau mot de passe pour ${u.username}, ses sessions fermées`, setNote)
            .then((ok) => { if (ok) { setPw(""); setPwOpen(false); } });
        }}>
          <input className={`${input} max-w-xs`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN}
            placeholder={tx("nouveau mot de passe ({0} min.)", PASSWORD_MIN)} value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="submit" className={primary}>{tx("Enregistrer")}</button>
        </form>
      )}
      <NoteLine note={note} />
    </li>
  );
}
