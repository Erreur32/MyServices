// Réglages → Système → E-mail : the SMTP server that sends the « Forgot your password? » links, and a test sent to one's own address
import { Mail, Send, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { read, send } from "../api";
import { Copyable, Field, NoteLine } from "./form";
import { SecretInput } from "./SecretInput";
import { IconChoice } from "./IconChoice";
import { Badge, Card } from "./ui";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

interface MailState { suggested_host?: string; host: string; port: number; security: "starttls" | "ssl" | "none"; user: string; password_set: boolean; from: string; page_url: string; ready: boolean }

const PORTS: Record<MailState["security"], number> = { starttls: 587, ssl: 465, none: 25 };

const CHECK = "ss -ltn | grep ':25'";
const INSTALL = "sudo apt install postfix\nsudo systemctl enable --now postfix";
const ALLOW = "sudo postconf -e 'mynetworks = 127.0.0.0/8 [::1]/128'\n# or, to send through your provider's server:\n# sudo postconf -e 'relayhost = [smtp.provider.example]:587'\nsudo systemctl reload postfix";

/** What to do when the mail relay does not answer or refuses: install one, or use a provider's SMTP instead (opens by itself after a failure) */
function MailHelp({ open }: Readonly<{ open: boolean }>) {
  return (
    <details open={open} className="rounded-lg border border-line bg-bg/50 px-3 py-2 text-sm [&[open]]:border-warn/50">
      <summary className="cursor-pointer font-semibold text-muted">{tx("Ça ne marche pas ? Que faire")}</summary>
      <ol className="mt-2 flex list-decimal flex-col gap-3 pl-5 text-muted">
        <li className="flex flex-col gap-1.5"><span>{tx("Vérifier qu'un courrier tourne sur l'hôte et écoute. La commande doit afficher une ligne (127.0.0.1:25 convient).")}</span><Copyable text={CHECK} oneLine /></li>
        <li className="flex flex-col gap-1.5"><span>{tx("Pas installé ? Sur Debian ou Ubuntu, installer postfix (choisir « Site Internet », ou « Système satellite » si vous avez un relais), puis le démarrer.")}</span><Copyable text={INSTALL} oneLine /></li>
        <li className="flex flex-col gap-1.5"><span>{tx("Message refusé (relais non autorisé) : autoriser l'adresse de MyServices dans postfix, ou envoyer par le serveur de votre fournisseur (retirer le « # » de la ligne relayhost et mettre son adresse), puis recharger.")}</span><Copyable text={ALLOW} oneLine /></li>
        <li>{tx("Autre option, sans rien installer : « Réglages avancés (SMTP complet) » avec le serveur d'envoi de votre fournisseur d'accès, de Gmail (mot de passe d'application), Brevo ou Mailgun.")}</li>
      </ol>
    </details>
  );
}

export function MailSettings() {
  const [st, setSt] = useState<MailState | null>(null), [pw, setPw] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [advanced, setAdvanced] = useState(false), [relay, setRelay] = useState(""), [failed, setFailed] = useState(false);
  useEffect(() => {
    read<MailState>("system/mail").then((s) => {
      setSt({ ...s, page_url: s.page_url || location.origin });
      setRelay(s.host ? (s.port === 25 ? s.host : `${s.host}:${s.port}`) : "");
      setAdvanced(Boolean(s.user || s.password_set || (s.host && s.security !== "none")));   // an existing full SMTP setup stays visible
    }).catch(() => undefined);
  }, []);
  if (!st) return null;
  const set = (k: Partial<MailState>) => setSt({ ...st, ...k });
  /** What the simple form stands for: the relay on port 25 unless « host:port » says otherwise; the sender and the page address are worked out */
  const relayPayload = () => {
    const [host, port = "25"] = relay.trim().split(":");
    const name = location.hostname, domain = /[a-z]/i.test(name) && name.includes(".") ? name : "myservices.local";
    return { host, port: Number(port), security: "none", user: "", password: "-", sender: `myservices@${domain}`, page_url: location.origin };
  };
  const fullPayload = () => ({ host: st.host, port: st.port, security: st.security, user: st.user, password: pw || null, sender: st.from, page_url: st.page_url });
  const payload = () => (advanced ? fullPayload() : relayPayload());
  const save = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(async () => { setSt(await send<MailState>("PUT", "system/mail", payload())); setPw(""); }, tx("enregistré"), setNote);
    setFailed(!ok);
    setBusy(false);
  };
  /** Tries what is typed, before saving anything */
  const test = async () => {
    setBusy(true);
    const ok = await act(() => send("POST", "system/mail/test", payload()), tx("e-mail de test envoyé : regardez votre boîte (et les indésirables)"), setNote);
    setFailed(!ok);
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
      <button type="button" className={quiet} disabled={busy || !(advanced ? st.host : relay.trim())} onClick={() => void test()} title={tx("Essaie ce qui est saisi, sans l'enregistrer, et envoie un message à l'adresse de votre profil")}><Send size={14} aria-hidden />{tx("Tester")}</button>
      <button type="submit" className={primary} disabled={busy}><Mail size={14} aria-hidden />{tx("Enregistrer")}</button>
    </div>
  );
  if (!advanced) {
    return (
      <Card>
        {title}
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field label={tx("Relais de courrier de l'hôte")}>
            <input className={`${input} max-w-sm font-mono`} value={relay} placeholder={st.suggested_host || "172.17.0.1"} onChange={(e) => setRelay(e.target.value)} />
          </Field>
          <p className="text-xs text-dim">{tx("L'adresse du courrier (postfix, sendmail, exim…) installé sur la machine qui héberge Docker, port 25 par défaut. Avec le réseau de l'hôte (les fichiers compose fournis), 127.0.0.1 convient et postfix n'a rien à changer. L'expéditeur et l'adresse de la page sont déduits.")}</p>
          {actions}
          <NoteLine note={note} />
          <MailHelp open={failed} />
          <button type="button" className="inline-flex items-center gap-1.5 self-start text-xs text-link hover:underline" onClick={() => setAdvanced(true)}><SlidersHorizontal size={12} aria-hidden />{tx("Réglages avancés (SMTP complet)")}</button>
        </form>
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
        <NoteLine note={note} />
        <MailHelp open={failed} />
        <button type="button" className="inline-flex items-center gap-1.5 self-start text-xs text-link hover:underline" onClick={() => setAdvanced(false)}>{tx("Retour au réglage simple")}</button>
      </form>
    </Card>
  );
}
