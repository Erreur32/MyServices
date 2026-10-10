// Guide de l'accès SSH d'une machine, en lecture seule : ce qu'il faut faire SUR la machine (rien à coller de MyServices, seulement
// autoriser sa clé publique). Windows : Serveur OpenSSH + clé d'un compte administrateur (PowerShell). Linux : clé dans authorized_keys.
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field } from "./form";
import { input, primary, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { SystemState } from "../types";

const WIN_SETUP = `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd; Set-Service sshd -StartupType Automatic`;
const LINUX_SETUP = `sudo apt install -y openssh-server && sudo systemctl enable --now ssh`;

type Kind = "windows" | "linux";

interface Props {
  ip: string;
  /** système supposé (TTL, scan, réglage) : le choix reste à l'utilisateur */
  guess: Kind;
  /** l'accès est créé avec le compte donné, puis la machine est enregistrée selon son système */
  onReady: (alias: string, kind: Kind) => Promise<void>;
  onCancel: () => void;
}

export function SshGuide({ ip, guess, onReady, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(guess);
  const win = kind === "windows";
  const [user, setUser] = useState(guess === "windows" ? "" : "root"), [pub, setPub] = useState<string | null>(null), [authorize, setAuthorize] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [lines, setLines] = useState<string[] | null>(null), [applied, setApplied] = useState("");
  useEffect(() => { read<SystemState>("system").then((s) => { setPub(s.ssh.public); setAuthorize(s.ssh.authorize ?? ""); }).catch(() => undefined); }, []);
  const winKey = pub ? `Add-Content C:\\ProgramData\\ssh\\administrators_authorized_keys '${pub}'\nicacls C:\\ProgramData\\ssh\\administrators_authorized_keys /inheritance:r /grant Administrateurs:F /grant SYSTEM:F` : "";
  const ok = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(user);
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN); else setError((e as Error).message);
    }
    setBusy(false);
  };
  const prepare = () => guard(async () => {
    const r = await send<{ alias: string }>("POST", "machines/ssh-alias", { ip, user });
    await onReady(r.alias, kind);
    if (!win) setApplied(user);  // Linux : le guide reste ouvert pour tester la connexion
  });
  const test = () => guard(async () => {
    setLines(null);
    const r = await send<{ lines: string[] }>("POST", `machines/settings/${ip}/check`);
    setLines(r.lines);
    setTimeout(() => setLines(null), 15_000);
  });
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl border border-link/40 bg-link/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tx("Système de la machine")}>
        <span className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Système de la machine")}</span>
        {(["linux", "windows"] as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} disabled={busy}
            onClick={() => { setKind(k); setUser(k === "windows" ? "" : "root"); setApplied(""); setError(""); }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === k ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
            {k === "windows" ? "Windows" : "Linux"}{k === guess && <span className="ml-1 font-normal text-dim">{tx("(détecté)")}</span>}
          </button>
        ))}
      </div>
      <p className="text-muted">
        <b className="text-txt">{win ? tx("PC Windows") : tx("Machine Linux")}</b> {tx(": rien de MyServices à installer, seulement autoriser sa clé sur la machine. Une fois.")}
      </p>
      <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-muted">
        <li>{win ? tx("Dans PowerShell ouvert en administrateur : la première ligne installe le Serveur OpenSSH (une minute, Windows Update doit être accessible), la seconde le démarre. « Service sshd introuvable » veut dire qu'il n'est pas encore installé :")
          : tx("Si SSH n'est pas installé sur la machine (sinon, passez à l'étape suivante) :")}
          <Copyable text={win ? WIN_SETUP : LINUX_SETUP} oneLine={!win} /></li>
        <li>{win ? tx("Autorisez la clé de l'app pour un compte administrateur (sur un Windows en anglais : Administrators au lieu de Administrateurs) :")
          : tx("Sur la machine, connecté avec le compte choisi ci-dessous, autorisez la clé de l'app :")}
          {(win ? winKey : authorize) ? <Copyable text={win ? winKey : authorize} /> : <span className="block text-warn">{tx("Clé de l'app introuvable : voir Réglages → Clé SSH.")}</span>}</li>
        <li>{win ? tx("Indiquez le nom du compte Windows administrateur (celui du PC, pas root) :") : tx("Compte utilisé pour se connecter (root par défaut ; un compte dédié du groupe docker est plus sûr) :")}
          <div className="mt-1.5 max-w-xs"><Field label={win ? tx("Compte Windows") : tx("Compte")}>
            <input className={input} value={user} onChange={(e) => { setUser(e.target.value.trim()); setApplied(""); }} placeholder={win ? "Administrateur" : "root"} maxLength={32} autoComplete="off" />
          </Field></div></li>
      </ol>
      {error && <p className="text-bad">⚠ {error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={!ok || busy || (win && !pub) || (!win && !!applied)} onClick={() => void prepare()}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{win ? tx("Préparer l'accès Windows") : applied ? tx("Accès activé") : tx("Activer l'accès")}</button>
        {!win && <button type="button" className={quiet} disabled={busy} onClick={() => void test()}>{tx("Tester la connexion")}</button>}
        <button type="button" className={quiet} onClick={onCancel}>{tx("Fermer")}</button>
        {win && <span className="text-xs text-dim">{tx("Ensuite, « Vérifier » teste la connexion.")}</span>}
      </div>
      {lines && (
        <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
          {lines.map((l, i) => <li key={i} className={l.startsWith("✓") ? "text-ok" : l.startsWith("✗") ? "text-bad" : "text-warn"}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}
