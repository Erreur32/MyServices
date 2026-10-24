// The app's SSH key, as a band on top of Machines → SSH connections: its type, fingerprint and known hosts on one line, a copy of the
// command to run on a machine, and, unfolded, the steps to authorise it with the public keys (masked by default, copyable either way).
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import type { SystemState } from "../types";
import { copyText } from "../lib/clipboard";
import { button, primary, quiet, type Note } from "../lib/forms";
import { NoteLine } from "./form";
import { Badge, Card } from "./ui";
import { tx } from "../lib/i18n";

/** Clé publique avec un début et une fin lisibles et le milieu masqué : « ssh-ed25519 AAAAC3Nz…kSLsU myservices » */
function maskKey(key: string): string {
  const [type, body, ...comment] = key.trim().split(/\s+/);
  if (!body) return "•".repeat(24);
  return `${type} ${body.slice(0, 8)}${"•".repeat(24)}${body.slice(-5)}${comment.length ? ` ${comment.join(" ")}` : ""}`;
}
const maskCommand = (t: string) => t.replace(/'([^']*)'/g, (_, k: string) => `'${maskKey(k)}'`);

/** Copies a text, then tells for a while whether it worked */
function useCopy(): [Note, (text: string) => Promise<void>] {
  const [note, setNote] = useState<Note>(null);
  const copy = async (text: string) => {
    const ok = await copyText(text);
    setNote({ ok, text: ok ? tx("Copié dans le presse-papiers") : tx("Copie impossible : sélectionner le texte et le copier à la main") });
    setTimeout(() => setNote(null), ok ? 2500 : 6000);
  };
  return [note, copy];
}

/** Texte à copier, masqué par défaut : l'œil le montre, le bouton « copier » marche dans les deux cas */
function Secretish({ text, label, shown, mask }: Readonly<{ text: string; label: string; shown: boolean; mask: (t: string) => string }>) {
  const [note, copy] = useCopy();
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{label}</div>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg2 p-2.5 font-mono text-xs" aria-label={shown ? label : tx("{0} (masquée)", label)}>{shown ? text : mask(text)}</pre>
        <button type="button" onClick={() => void copy(text)} className={note?.ok ? `${button} border-ok bg-ok/15 text-ok` : quiet}>
          {note?.ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{note?.ok ? tx("copié") : tx("copier")}
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  );
}

/** Whether a machine signs in with the app's key (its fingerprint, « ED25519 SHA256:… », holds the app's « SHA256:… ») or its ESXi one */
export function keyOf(ssh: SystemState["ssh"] | null, identity?: string | null, fp?: string | null): "app" | "esxi" | "other" | "none" {
  if (!identity) return "none";
  if (identity.endsWith("_ecdsa")) return "esxi";
  return ssh?.fingerprint && fp?.includes(ssh.fingerprint) ? "app" : "other";
}

export function AppKeyBand({ ssh }: Readonly<{ ssh: SystemState["ssh"] }>) {
  const [shown, setShown] = useState(false), [open, setOpen] = useState(false);
  const [note, copy] = useCopy();
  const algo = ssh.public?.split(/\s+/)[0]?.replace(/^ssh-/, "").toUpperCase();
  const step = "flex gap-3 text-sm text-muted";
  const num = "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-link/15 text-xs font-bold text-link";
  return (
    <Card className="border-l-4 border-l-link">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><KeyRound size={16} aria-hidden />{tx("Clé de l'app")}</h2>
        {!ssh.public ? <span className="text-sm text-warn">{tx("Pas encore créée : elle l'est au démarrage du conteneur.")}</span> : (
          <span className="flex flex-wrap items-center gap-2">
            {algo && <Badge tone="info" title={tx("Type de clé")}>{algo}</Badge>}
            {ssh.fingerprint && <Badge tone="off" title={tx("Empreinte (SHA256) : sert à reconnaître la clé sans la montrer")}><span className="font-mono">{shown ? ssh.fingerprint : `${ssh.fingerprint.slice(0, 11)}${"•".repeat(10)}${ssh.fingerprint.slice(-4)}`}</span></Badge>}
            <Badge tone="off">{ssh.known_hosts} {tx("machine(s) connue(s)")}</Badge>
            <button type="button" className={quiet} onClick={() => { setShown(!shown); setOpen(!shown); }} aria-pressed={shown} title={shown ? tx("Masquer la clé") : tx("Afficher la clé")}>
              {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}{shown ? tx("Masquer") : tx("Afficher")}
            </button>
            <button type="button" onClick={() => void copy(ssh.authorize!)} className={note?.ok ? `${button} border-ok bg-ok/15 text-ok` : primary}>
              {note?.ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{note?.ok ? tx("copiée") : tx("Copier la commande")}
            </button>
          </span>
        )}
      </div>
      <NoteLine note={note} />
      {ssh.public && <>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-sm text-link hover:underline">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{tx("Autoriser la clé sur une machine")}
        </button>
        {open && (
          <div className="mt-3 flex flex-col gap-3">
            <ol className="flex flex-col gap-2.5">
              <li className={step}><span className={num}>1</span><span>{tx("Copiez la commande (le bouton « copier » fonctionne même clé masquée).")}</span></li>
              <li className={step}><span className={num}>2</span><span>{tx("Collez-la dans un terminal de la machine, connecté avec le compte que MyServices doit utiliser. Elle ajoute la clé à")} <code className="font-mono text-xs">~/.ssh/authorized_keys</code>.</span></li>
              <li className={step}><span className={num}>3</span><span>{tx("Sur la ligne de la machine ci-dessous, l'icône de réglage vérifie la connexion.")}</span></li>
            </ol>
            <Secretish text={ssh.public} label={tx("Clé publique")} shown={shown} mask={maskKey} />
            <Secretish text={ssh.authorize!} label={tx("Commande à lancer sur la machine, avec le compte visé")} shown={shown} mask={maskCommand} />
            {ssh.public_esxi && <Secretish text={ssh.public_esxi} label={tx("Clé publique ECDSA, pour VMware ESXi (à mettre dans /etc/ssh/keys-root/authorized_keys)")} shown={shown} mask={maskKey} />}
            <p className="rounded-lg bg-bg2/60 px-3 py-2 text-xs text-muted">{tx("La clé privée reste dans /config/ssh et ne quitte jamais le conteneur. Le plus sûr : un compte dédié, dans les groupes docker et adm, plutôt que root (voir le README). Pour retirer l'accès, supprimez cette ligne de authorized_keys sur la machine.")}</p>
          </div>
        )}
      </>}
    </Card>
  );
}
