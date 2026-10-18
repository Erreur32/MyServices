// Réglages → Système → E-mail : the SMTP server that sends the « Forgot your password? » links, and a test sent to one's own address
import { Mail, Send, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { read, send } from "../api";
import { Field, NoteLine } from "./form";
import { SecretInput } from "./SecretInput";
import { IconChoice } from "./IconChoice";
import { Badge, Card } from "./ui";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

interface MailState { suggested_host?: string; host: string; port: number; security: "starttls" | "ssl" | "none"; user: string; password_set: boolean; from: string; page_url: string; ready: boolean }

const PORTS: Record<MailState["security"], number> = { starttls: 587, ssl: 465, none: 25 };

export function MailSettings() {
  const [st, setSt] = useState<MailState | null>(null), [pw, setPw] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [advanced, setAdvanced] = useState(false), [relay, setRelay] = useState("");
  useEffect(() => {
    read<MailState>("system/mail").then((s) => {
      setSt({ ...s, page_url: s.page_url || location.origin });
      setRelay(s.host ? (s.port === 25 ? s.host : `${s.host}:${s.port}`) : "");
      setAdvanced(Boolean(s.user || s.password_set || (s.host && s.security !== "none")));   // an existing full SMTP setup stays visible
    }).catch(() => undefined);
  }, []);
  if (!st) return null;
  const set = (k: Partial<MailState>) => setSt({ ...st, ...k });
  const save = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    await act(async () => {
      const r = await send<MailState>("PUT", "system/mail", { host: st.host, port: st.port, security: st.security, user: st.user, password: pw || null, sender: st.from, page_url: st.page_url });
      setSt(r); setPw("");
    }, tx("enregistré"), setNote);
    setBusy(false);
  };
  /** One field: the host's mail relay (« 172.17.0.1 » or « 172.17.0.1:25 »); the sender and the page address are worked out */
  const saveRelay = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const [host, port = "25"] = relay.trim().split(":");
    setBusy(true);
    await act(async () => {
      const name = location.hostname, domain = /[a-z]/i.test(name) && name.includes(".") ? name : "myservices.local";
      setSt(await send<MailState>("PUT", "system/mail", { host, port: Number(port), security: "none", user: "", password: "-", sender: `myservices@${domain}`, page_url: location.origin }));
    }, tx("enregistré"), setNote);
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    await act(() => send("POST", "system/mail/test"), tx("e-mail de test envoyé : regardez votre boîte (et les indésirables)"), setNote);
    setBusy(false);
  };
  const title = (
    <>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Mail size={16} aria-hidden />{tx("E-mail")}
        {st.ready ? <Badge tone="ok">{tx("prêt")}</Badge> : <Badge tone="off">{tx("non réglé")}</Badge>}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Envoi des e-mails de MyServices (« Mot de passe oublié ? » : un lien à usage unique, valable 30 minutes, envoyé à l'adresse du profil).")}</p>
    </>
  );
  const actions = (
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={primary} disabled={busy}><Mail size={14} aria-hidden />{tx("Enregistrer")}</button>
      <button type="button" className={quiet} disabled={busy || !st.ready} onClick={() => void test()} title={tx("Envoyé à l'adresse e-mail de votre profil")}><Send size={14} aria-hidden />{tx("Envoyer un e-mail de test")}</button>
    </div>
  );
  if (!advanced) {
    return (
      <Card>
        {title}
        <form onSubmit={saveRelay} className="flex flex-col gap-3">
          <Field label={tx("Relais de courrier de l'hôte")}>
            <input className={`${input} max-w-sm font-mono`} value={relay} placeholder={st.suggested_host || "172.17.0.1"} onChange={(e) => setRelay(e.target.value)} />
          </Field>
          <p className="text-xs text-dim">{tx("L'adresse du courrier (postfix, sendmail, exim…) installé sur la machine qui héberge Docker, port 25 par défaut. L'expéditeur et l'adresse de la page sont déduits. Postfix doit accepter le réseau Docker (mynetworks).")}</p>
          {actions}
          <button type="button" className="inline-flex items-center gap-1.5 self-start text-xs text-link hover:underline" onClick={() => setAdvanced(true)}><SlidersHorizontal size={12} aria-hidden />{tx("Réglages avancés (SMTP complet)")}</button>
        </form>
        <NoteLine note={note} />
      </Card>
    );
  }
  return (
    <Card>
      {title}
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
        {actions}
        <button type="button" className="inline-flex items-center gap-1.5 self-start text-xs text-link hover:underline" onClick={() => setAdvanced(false)}>{tx("Retour au réglage simple")}</button>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}
