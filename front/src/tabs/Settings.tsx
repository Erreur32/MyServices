// Réglages (admins) : une section à la fois, menu à gauche (en haut sur mobile). Comptes : son mot de passe,
// les comptes (ajout, rôle, activation, nouveau mot de passe, suppression) et le journal des actions.
// Apparence : thème et largeur de la page (« Page width » de GpuViewR), retenus par le navigateur.
// Menu en quatre groupes (Données, Surveillance, Accès et sécurité, Application). Autres sections : un fichier chacune dans tabs/.
import { KeyRound, Moon, MoveHorizontal, Plus, RotateCcw, Sun, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { dateTime } from "../lib/format";
import { CONTENT_WIDTH, type Theme } from "../theme";
import { LANG, setLang, type Lang } from "../lib/i18n";
import type { User } from "../types";
import { Badge, Card, Dim } from "../components/ui";
import { Field, NoteLine } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Alerts } from "./Alerts";
import { Connectors } from "./Connectors";
import { MachinesSettings } from "./MachinesSettings";
import { NetworkSettings } from "./NetworkSettings";
import { ApiMcp } from "./ApiMcp";
import { AuditLog } from "./AuditLog";
import { Sources } from "./Sources";
import { SystemSettings } from "./SystemSettings";
import { tx } from "../lib/i18n";
import { checkPassword, okField, PASSWORD_MIN } from "../lib/password";
import { PasswordRules } from "../components/PasswordRules";

/** Menu en quatre groupes ; les identifiants restent ceux des liens directs (#settings/<section>) */
const GROUPS: { label: string; sections: { id: string; label: string }[] }[] = [
  { label: tx("Données"), sections: [
    { id: "machines", label: tx("Machines") }, { id: "connectors", label: tx("Connecteurs") }, { id: "sources", label: tx("Sources") },
  ] },
  { label: tx("Surveillance"), sections: [{ id: "alerts", label: tx("Alertes") }, { id: "network", label: tx("Recherche réseau") }, { id: "tasks", label: tx("Tâches et horaires") }] },
  { label: tx("Accès et sécurité"), sections: [{ id: "accounts", label: tx("Comptes") }, { id: "ssh", label: tx("Clé SSH") }, { id: "audit", label: tx("Journal d'audit") }, { id: "api", label: tx("API et MCP") }] },
  { label: tx("Application"), sections: [{ id: "look", label: tx("Apparence") }, { id: "system", label: tx("Système") }] },
];
const SECTIONS = GROUPS.flatMap((g) => g.sections);


const ROLE: Record<User["role"], string> = { admin: "admin", viewer: tx("lecture seule") };

/** Réglages d'apparence tenus par App (appliqués à toute la page). */
export interface Look {
  theme: Theme;
  setTheme: (t: Theme) => void;
  width: number;
  setWidth: (px: number) => void;
}

export function Settings({ snap, look }: { snap: Snapshot; look: Look }) {
  const [section, setSection] = useState(() => {
    const s = location.hash.split("/")[1]; // lien direct : #settings/<section> (menu du compte)
    return SECTIONS.some((x) => x.id === s) ? s : "accounts";
  });
  return (
    <div className="flex flex-col gap-4 py-4 md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col" aria-label={tx("Sections des réglages")}>
        {GROUPS.map((g, i) => (
          <div key={g.label} role="group" aria-label={g.label} className="flex shrink-0 gap-1 md:flex-col">
            <p className={`hidden px-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-dim md:block ${i ? "pt-3" : ""}`}>{g.label}</p>
            {g.sections.map((s) => (
              <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={s.id === section ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm font-semibold ${s.id === section ? "bg-card text-txt shadow-[inset_2px_0_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {section === "accounts" ? <Accounts me={snap.me.username} /> : section === "look" ? <Appearance look={look} /> : section === "alerts" ? <Alerts /> : section === "connectors" ? <Connectors /> : section === "machines" ? <MachinesSettings snap={snap} /> : section === "api" ? <ApiMcp /> : section === "sources" ? <Sources /> : section === "network" ? <NetworkSettings /> : section === "audit" ? <AuditLog /> : section === "tasks" || section === "ssh" ? <SystemSettings part={section} /> : <SystemSettings part="system" />}
      </div>
    </div>
  );
}

function Appearance({ look }: { look: Look }) {
  const themes: { id: Theme; label: string; icon: ReactNode; swatch: string }[] = [
    { id: "dark", label: tx("Sombre"), icon: <Moon size={16} />, swatch: "bg-[#0c0e14]" },
    { id: "light", label: tx("Clair"), icon: <Sun size={16} />, swatch: "bg-[#f4f6fa]" },
  ];
  // Le dernier cran (max + un pas) = pleine largeur, stockée 0
  const fullNotch = CONTENT_WIDTH.max + CONTENT_WIDTH.step;
  const full = look.width === CONTENT_WIDTH.full;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-3 font-bold">{tx("Thème")}</h2>
        <div className="flex flex-wrap gap-2">
          {themes.map((t) => (
            <button key={t.id} type="button" onClick={() => look.setTheme(t.id)} aria-pressed={look.theme === t.id}
              className={`flex w-40 items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold ${look.theme === t.id ? "border-link bg-link/10 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>
              <span className={`h-8 w-8 rounded-lg border border-line ${t.swatch}`} />
              <span className="inline-flex items-center gap-1.5">{t.icon}{t.label}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">{tx("Langue")}</h2>
        <div className="flex flex-wrap gap-2">
          {([["fr", "Français"], ["en", "English"]] as [Lang, string][]).map(([l, label]) => (
            <button key={l} type="button" onClick={() => l !== LANG && setLang(l)} aria-pressed={LANG === l}
              className={`w-40 rounded-xl border p-3 text-left text-sm font-semibold ${LANG === l ? "border-link bg-link/10 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>
              {label}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 font-bold"><MoveHorizontal size={16} />{tx("Largeur de la page")}</h2>
          <button type="button" className={quiet} onClick={() => look.setWidth(CONTENT_WIDTH.default)} disabled={look.width === CONTENT_WIDTH.default}>
            <RotateCcw size={14} />{tx("Par défaut")}
          </button>
        </div>
        <p className="mb-3 text-sm text-muted">
          {tx("Largeur maximale du contenu (en-tête, onglets, pages). Le cran le plus à droite utilise toute la largeur de l'écran.")}
        </p>
        <div className="flex items-center gap-4">
          <input type="range" className="range flex-1" min={CONTENT_WIDTH.min} max={fullNotch} step={CONTENT_WIDTH.step}
            value={full ? fullNotch : look.width} aria-label={tx("Largeur de la page")}
            onChange={(e) => { const px = Number(e.target.value); look.setWidth(px >= fullNotch ? CONTENT_WIDTH.full : px); }} />
          <span className="w-32 whitespace-nowrap text-right font-mono text-sm tabular-nums">{full ? tx("Pleine largeur") : `${look.width} px`}</span>
        </div>
      </Card>
      <p className="text-xs text-dim">{tx("Retenus par ce navigateur seulement.")}</p>
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
      <div className="grid gap-4 xl:grid-cols-2">
        <MyPassword />
        <AddUser onDone={reload} />
      </div>
      <Card>
        <h2 className="mb-1 font-bold">{tx("Comptes")} {users && <Dim>· {users.length}</Dim>}</h2>
        <p className="mb-3 text-sm text-muted">
          <b className="text-txt">{tx("Admin")}</b> {tx(": tout, réglages compris.")} <b className="text-txt">{tx("Lecture seule")}</b> {tx(": voit la page et peut demander un passage (⟳). Ton propre compte se gère dans « Mon mot de passe » : un admin ne peut pas se retirer ses droits, et il reste toujours au moins un admin actif.")}
        </p>
        {users === null ? <p className="text-sm text-muted">{tx("Chargement…")}</p> : (
          <ul className="flex flex-col divide-y divide-line/60">
            {users.map((u) => <UserRow key={u.username} u={u} self={u.username.toLowerCase() === me.toLowerCase()} onDone={reload} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MyPassword() {
  const [cur, setCur] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setNote({ ok: false, text: tx("les deux saisies diffèrent") });
    setBusy(true);
    const ok = await act(() => send("POST", "me/password", { current: cur, new: pw }), tx("mot de passe changé : reconnexion…"), setNote);
    setBusy(false);
    if (ok) setTimeout(() => location.replace(LOGIN), 1500); // toutes ses sessions sont fermées par le serveur
  };
  return (
    <Card>
      <h2 className="mb-3 font-bold">{tx("Mon mot de passe")}</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={tx("Mot de passe actuel")}>
          <input className={input} type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Nouveau ({0} caractères min.)", PASSWORD_MIN)}>
            <input className={`${input} ${okField(pw)}`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label={tx("Validation du mot de passe")}>
            <input className={`${input} ${pw2 && pw2 === pw ? "!border-ok/70" : ""}`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
        </div>
        <PasswordRules pw={pw} again={pw2} />
        <div><button className={primary} disabled={busy || !checkPassword(pw, pw2).ok}><KeyRound size={14} />{tx("Changer")}</button></div>
        <p className="text-xs text-dim">{tx("Toutes tes sessions (autres navigateurs compris) seront fermées.")}</p>
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
      <h2 className="mb-3 font-bold">{tx("Ajouter un compte")}</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Nom (lettres, chiffres, . _ @ -)")}>
            <input className={input} autoComplete="off" required minLength={2} maxLength={64} pattern="[a-zA-Z0-9._@\-]+" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={tx("Rôle")}>
            <select className={input} value={role} onChange={(e) => setRole(e.target.value as User["role"])}>
              <option value="viewer">{tx("lecture seule")}</option>
              <option value="admin">{tx("admin")}</option>
            </select>
          </Field>
        </div>
        <Field label={tx("Mot de passe ({0} caractères min., à lui transmettre)", PASSWORD_MIN)}>
          <input className={`${input} ${okField(pw)}`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <PasswordRules pw={pw} />
        <div><button className={primary} disabled={busy || !checkPassword(pw).ok}><Plus size={14} />{tx("Créer")}</button></div>
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
        <div className="min-w-[180px] flex-1">
          <b>{u.username}</b>{self && <Dim> {tx("· toi")}</Dim>}
          <div className="text-xs text-dim">
            {tx("dernière connexion :")} {u.last_login ? dateTime(u.last_login * 1000) : tx("jamais")} {tx("· créé le")} {dateTime(u.created * 1000)}
          </div>
        </div>
        <Badge tone={u.role === "admin" ? "info" : "off"}>{ROLE[u.role]}</Badge>
        {u.disabled ? <Badge tone="warn">{tx("désactivé")}</Badge> : <Badge tone="ok">{tx("actif")}</Badge>}
        {!self && (
          <div className="flex flex-wrap gap-1.5">
            <select className={`${quiet} bg-bg2`} value={u.role} aria-label={tx("Rôle de {0}", u.username)}
              onChange={(e) => void run(() => send("PATCH", path, { role: e.target.value }), `${u.username} : ${ROLE[e.target.value as User["role"]]}`)}>
              <option value="viewer">{tx("lecture seule")}</option>
              <option value="admin">{tx("admin")}</option>
            </select>
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
          <button className={primary}>{tx("Enregistrer")}</button>
        </form>
      )}
      <NoteLine note={note} />
    </li>
  );
}
