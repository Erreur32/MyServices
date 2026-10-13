// Profil (tout compte, admin ou lecture seule) : apparence de la page, changer son mot de passe, voir ses sessions ouvertes, fermer celles des autres appareils.
// Affiché par #profile (menu du compte), hors des onglets et des Réglages : un compte en lecture seule n'a pas accès aux Réglages.
import { ImagePlus, KeyRound, LogOut, Mail, MonitorSmartphone, Trash2 } from "lucide-react";
import { Avatar, setAvatarVersion } from "../components/Avatar";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Badge, Card, Count, Dim } from "../components/ui";
import { Appearance, type Look } from "../components/Appearance";
import { Field, NoteLine } from "../components/form";
import { PasswordRules } from "../components/PasswordRules";
import { dateTime } from "../lib/format";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { checkPassword, okField, PASSWORD_MIN } from "../lib/password";

interface MySession { created: number; expires: number; ip: string | null; current: boolean }

export function Profile({ username, role, email, avatar, look }: Readonly<{ username: string; role: "admin" | "viewer"; email: string; avatar: string | null; look: Look }>) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 py-4">
      <header className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
        <Avatar username={username} version={avatar} size={56} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{username}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-dim"><Badge tone="off">{role === "admin" ? "admin" : tx("lecture seule")}</Badge>{tx("Mon profil")}</div>
        </div>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4"><MyAvatar username={username} initial={avatar} /><MyEmail initial={email} /><MyPassword /><Sessions /></div>
        <section aria-label={tx("Apparence")}><h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-dim">{tx("Apparence")}</h2><Appearance look={look} /></section>
      </div>
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

const AVATAR_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const AVATAR_MAX = 512 * 1024;

/** A photo is cut square and shrunk to 256 px here (lighter, and its EXIF data, place and device, goes); a GIF or an SVG is sent as is */
async function avatarData(file: File): Promise<string> {
  const asUrl = (b: Blob) => new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(typeof r.result === "string" ? r.result : "");
    r.onerror = () => ko(r.error ?? new Error(tx("image illisible")));
    r.readAsDataURL(b);
  });
  if (file.type === "image/svg+xml" || file.type === "image/gif") return asUrl(file);
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height), out = Math.min(256, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = out;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.9));
  return asUrl(blob ?? file);
}

/** Picture shown in the header and the menu: PNG, JPEG, WebP, GIF or SVG */
function MyAvatar({ username, initial }: Readonly<{ username: string; initial: string | null }>) {
  const [version, setVersion] = useState(initial), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const pick = async (file?: File) => {
    if (!file) return;
    if (file.size > AVATAR_MAX && (file.type === "image/svg+xml" || file.type === "image/gif")) return setNote({ ok: false, text: tx("image trop lourde : 512 Ko au plus") });
    setBusy(true);
    const before = version;
    await act(async () => {
      const image = await avatarData(file);
      setVersion("new"); setAvatarVersion(username, "new", image);   // shown everywhere now; the server's answer only confirms
      try {
        const r = await send<{ avatar: string }>("PUT", "me/avatar", { image });
        setVersion(r.avatar); setAvatarVersion(username, r.avatar, image);
      } catch (e) {
        setVersion(before); setAvatarVersion(username, before);   // refused (format, size): the previous picture comes back
        throw e;
      }
    }, tx("avatar enregistré"), setNote);
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    const ok = await act(() => send("DELETE", "me/avatar"), tx("avatar retiré"), setNote);
    if (ok) { setVersion(null); setAvatarVersion(username, null); }
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-bold"><ImagePlus size={16} aria-hidden />{tx("Mon avatar")}</h2>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar username={username} version={version} size={64} />
        <div className="flex flex-wrap gap-2">
          <label className={`${primary} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
            <ImagePlus size={14} />{version ? tx("Changer") : tx("Ajouter une image")}
            <input type="file" accept={AVATAR_TYPES} className="sr-only" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {version && <button type="button" className={danger} disabled={busy} onClick={() => void remove()}><Trash2 size={14} />{tx("Retirer")}</button>}
        </div>
      </div>
      <p className="mt-3 text-xs text-dim">{tx("PNG, JPEG, WebP, GIF ou SVG, 512 Ko au plus. Une photo est recadrée en carré ; un SVG doit être un simple dessin (sans script ni lien vers l'extérieur).")}</p>
      <NoteLine note={note} />
    </Card>
  );
}

/** Address that receives the link of « Forgot your password? » on the sign-in page */
function MyEmail({ initial }: Readonly<{ initial: string }>) {
  const [email, setEmail] = useState(initial), [saved, setSaved] = useState(initial);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", "me/email", { email: email.trim() }), email.trim() ? tx("adresse enregistrée") : tx("adresse retirée"), setNote);
    setBusy(false);
    if (ok) setSaved(email.trim());
  };
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-bold"><Mail size={16} aria-hidden />{tx("Mon adresse e-mail")}</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={tx("Adresse e-mail")}>
          <input className={input} type="email" autoComplete="email" maxLength={254} value={email} placeholder="nom@exemple.fr" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div><button type="submit" className={primary} disabled={busy || email.trim() === saved}><Mail size={14} />{tx("Enregistrer")}</button></div>
        <p className="text-xs text-dim">{tx("Sert seulement à recevoir un lien si vous oubliez votre mot de passe (« Mot de passe oublié ? » sur la page de connexion).")}</p>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}

function MyPassword() {
  const [cur, setCur] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (pw !== pw2) return setNote({ ok: false, text: tx("les deux saisies diffèrent") });
    setBusy(true);
    const ok = await act(() => send("POST", "me/password", { current: cur, new: pw }), tx("mot de passe changé : reconnexion…"), setNote);
    setBusy(false);
    if (ok) setTimeout(() => location.replace(LOGIN), 1500); // toutes ses sessions sont fermées par le serveur
  };
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-bold"><KeyRound size={16} aria-hidden />{tx("Mon mot de passe")}</h2>
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
        <div><button type="submit" className={primary} disabled={busy || !checkPassword(pw, pw2).ok}><KeyRound size={14} />{tx("Changer")}</button></div>
        <p className="text-xs text-dim">{tx("Toutes tes sessions (autres navigateurs compris) seront fermées.")}</p>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}
