// Réglages → Système → E-mail : the SMTP server that sends the « Forgot your password? » links, and a test sent to one's own address
import { Mail, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { read, send } from "../api";
import { Field, NoteLine } from "./form";
import { SecretInput } from "./SecretInput";
import { IconChoice } from "./IconChoice";
import { Badge, Card } from "./ui";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

interface MailState { host: string; port: number; security: "starttls" | "ssl" | "none"; user: string; password_set: boolean; from: string; page_url: string; ready: boolean }

const PORTS: Record<MailState["security"], number> = { starttls: 587, ssl: 465, none: 25 };

export function MailSettings() {
  const [st, setSt] = useState<MailState | null>(null), [pw, setPw] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => { read<MailState>("system/mail").then((s) => setSt({ ...s, page_url: s.page_url || location.origin })).catch(() => undefined); }, []);
  if (!st) return null;
  const set = (k: Partial<MailState>) => setSt({ ...st, ...k });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act(async () => {
      const r = await send<MailState>("PUT", "system/mail", { host: st.host, port: st.port, security: st.security, user: st.user, password: pw || null, sender: st.from, page_url: st.page_url });
      setSt(r); setPw("");
    }, tx("enregistré"), setNote);
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    await act(() => send("POST", "system/mail/test"), tx("e-mail de test envoyé : regardez votre boîte (et les indésirables)"), setNote);
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Mail size={16} aria-hidden />{tx("E-mail")}
        {st.ready ? <Badge tone="ok">{tx("prêt")}</Badge> : <Badge tone="off">{tx("non réglé")}</Badge>}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Serveur d'envoi pour « Mot de passe oublié ? » : chaque compte reçoit un lien à usage unique, valable 30 minutes, à l'adresse de son profil.")}</p>
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <Field label={tx("Serveur SMTP")}><input className={input} value={st.host} placeholder="smtp.exemple.fr" onChange={(e) => set({ host: e.target.value })} /></Field>
          <Field label={tx("Port")}><input className={input} type="number" min={1} max={65535} value={st.port} onChange={(e) => set({ port: Number(e.target.value) })} /></Field>
        </div>
        <Field label={tx("Sécurité")}>
          <IconChoice label={tx("Sécurité")} value={st.security} onPick={(v) => set({ security: v as MailState["security"], port: PORTS[v as MailState["security"]] })}
            options={[{ value: "starttls", label: "STARTTLS", icon: <Mail size={20} aria-hidden /> }, { value: "ssl", label: "SSL / TLS", icon: <Mail size={20} aria-hidden /> },
              { value: "none", label: tx("aucune"), icon: <Mail size={20} className="opacity-50" aria-hidden /> }]} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Compte")}><input className={input} autoComplete="off" value={st.user} onChange={(e) => set({ user: e.target.value })} /></Field>
          <Field label={tx("Mot de passe")}>
            <SecretInput value={pw} onChange={setPw} kept={st.password_set} placeholder={st.password_set ? tx("déjà renseigné : laisser vide pour garder") : ""} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Expéditeur")}><input className={input} type="email" value={st.from} placeholder="myservices@exemple.fr" onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label={tx("Adresse de la page")}><input className={input} value={st.page_url} placeholder="https://myservices.exemple.fr" onChange={(e) => set({ page_url: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-dim">{tx("L'adresse de la page est celle mise dans les liens des e-mails : celle que vous ouvrez dans le navigateur.")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primary} disabled={busy}><Mail size={14} />{tx("Enregistrer")}</button>
          <button type="button" className={quiet} disabled={busy || !st.ready} onClick={() => void test()} title={tx("Envoyé à l'adresse e-mail de votre profil")}><Send size={14} />{tx("Envoyer un e-mail de test")}</button>
        </div>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}
