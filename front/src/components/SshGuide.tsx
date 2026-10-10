// Guide de l'accès d'une machine, en lecture seule : ce qu'il faut faire SUR la machine. Linux : SSH, la clé publique de l'app dans
// authorized_keys (rien d'autre à coller). Windows : pas de SSH, un agent PowerShell (Réglages → Connecteurs).
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field } from "./form";
import { input, primary, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { SystemState } from "../types";

const LINUX_SETUP = `sudo apt install -y openssh-server && sudo systemctl enable --now ssh`;

type Kind = "windows" | "linux";

interface Props {
  ip: string;
  /** système supposé (TTL, scan, réglage) : le choix reste à l'utilisateur */
  guess: Kind;
  /** l'accès SSH est créé avec le compte donné, puis la machine est enregistrée */
  onReady: (alias: string) => Promise<void>;
  onCancel: () => void;
}

export function SshGuide({ ip, guess, onReady, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(guess);
  const win = kind === "windows";
  const [user, setUser] = useState("root"), [authorize, setAuthorize] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [lines, setLines] = useState<string[] | null>(null), [applied, setApplied] = useState("");
  useEffect(() => { read<SystemState>("system").then((s) => setAuthorize(s.ssh.authorize ?? "")).catch(() => undefined); }, []);
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
    await onReady(r.alias);
    setApplied(user);  // le guide reste ouvert pour tester la connexion
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
            onClick={() => { setKind(k); setApplied(""); setError(""); }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === k ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
            {k === "windows" ? "Windows" : "Linux"}{k === guess && <span className="ml-1 font-normal text-dim">{tx("(détecté)")}</span>}
          </button>
        ))}
      </div>
      {win ? (
        <>
          <p className="text-muted">
            <b className="text-txt">{tx("PC Windows")}</b> {tx(": pas de SSH. Un petit agent PowerShell, en lecture seule, envoie lui-même la santé du PC à MyServices. Il s'installe en collant une commande dans PowerShell (administrateur), une fois.")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a className={primary} href={`#settings/agents/${ip}`}>{tx("Installer l'agent")}</a>
            <button type="button" className={quiet} onClick={onCancel}>{tx("Fermer")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted">
            <b className="text-txt">{tx("Machine Linux")}</b> {tx(": rien de MyServices à installer, seulement autoriser sa clé sur la machine. Une fois.")}
          </p>
          <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-muted">
            <li>{tx("Si SSH n'est pas installé sur la machine (sinon, passez à l'étape suivante) :")}
              <Copyable text={LINUX_SETUP} oneLine /></li>
            <li>{tx("Sur la machine, connecté avec le compte choisi ci-dessous, autorisez la clé de l'app :")}
              {authorize ? <Copyable text={authorize} /> : <span className="block text-warn">{tx("Clé de l'app introuvable : voir Réglages → Clé SSH.")}</span>}</li>
            <li>{tx("Compte utilisé pour se connecter (root par défaut ; un compte dédié du groupe docker est plus sûr) :")}
              <div className="mt-1.5 max-w-xs"><Field label={tx("Compte")}>
                <input className={input} value={user} onChange={(e) => { setUser(e.target.value.trim()); setApplied(""); }} placeholder="root" maxLength={32} autoComplete="off" />
              </Field></div></li>
          </ol>
          {error && <p className="text-bad">⚠ {error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={!ok || busy || !!applied} onClick={() => void prepare()}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{applied ? tx("Accès activé") : tx("Activer l'accès")}</button>
            <button type="button" className={quiet} disabled={busy} onClick={() => void test()}>{tx("Tester la connexion")}</button>
            <button type="button" className={quiet} onClick={onCancel}>{tx("Fermer")}</button>
          </div>
          {lines && (
            <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
              {lines.map((l, i) => <li key={i} className={l.startsWith("✓") ? "text-ok" : l.startsWith("✗") ? "text-bad" : "text-warn"}>{l}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
