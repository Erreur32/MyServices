// Profil (tout compte, admin ou lecture seule) : changer son mot de passe, voir ses sessions ouvertes, fermer celles des autres appareils.
// Affiché par #profile (menu du compte), hors des onglets et des Réglages : un compte en lecture seule n'a pas accès aux Réglages.
import { KeyRound, LogOut, MonitorSmartphone } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Badge, Card, Count, Dim } from "../components/ui";
import { Field, NoteLine } from "../components/form";
import { PasswordRules } from "../components/PasswordRules";
import { dateTime } from "../lib/format";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { checkPassword, okField, PASSWORD_MIN } from "../lib/password";

interface MySession { created: number; expires: number; ip: string | null; current: boolean }

export function Profile({ username, role }: { username: string; role: "admin" | "viewer" }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <header className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-link/20 text-xl font-bold uppercase text-link" aria-hidden>{username.slice(0, 1)}</span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{username}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-dim"><Badge tone="off">{role === "admin" ? "admin" : tx("lecture seule")}</Badge>{tx("Mon profil")}</div>
        </div>
      </header>
      <MyPassword />
      <Sessions />
    </div>
  );
}

function Sessions() {
  const [list, setList] = useState<MySession[] | null>(null), [days, setDays] = useState(0);
  const [note, setNote] = useState<Note>(null), [error, setError] = useState("");
  const load = useCallback(() => {
    read<{ sessions: MySession[]; days: number }>("me/sessions")
      .then((r) => { setList(r.sessions); setDays(r.days); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(load, [load]);
  const others = (list ?? []).filter((x) => !x.current).length;
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><MonitorSmartphone size={16} />{tx("Mes sessions")} {list && <Count n={list.length} />}</h2>
      {days > 0 && <p className="mb-3 text-sm text-muted">{tx("Navigateurs et appareils connectés à ce compte. Une session dure {0} jours et se prolonge à l'usage.", days)}</p>}
      {error && <p className="text-sm text-bad">⚠ {error}</p>}
      {list === null ? !error && <p className="text-sm text-muted">{tx("Chargement…")}</p> : (
        <ul className="flex flex-col divide-y divide-line/60">
          {list.map((x, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="font-mono text-xs">{x.ip || "?"}</span>
              {x.current && <Badge tone="ok">{tx("cette session")}</Badge>}
              <Dim>{tx("ouverte le {0}", dateTime(x.created * 1000))} · {tx("valable jusqu'au {0}", dateTime(x.expires * 1000))}</Dim>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <button type="button" className={quiet} disabled={others === 0}
          onClick={() => void act(() => send("POST", "me/sessions/revoke-others"), tx("autres sessions fermées"), setNote).then(() => load())}>
          <LogOut size={14} />{tx("Fermer les autres sessions")}
        </button>
      </div>
      <NoteLine note={note} />
    </Card>
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
