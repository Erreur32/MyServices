// SSH access of a machine, the same block when adding one and in its window: address, port and account of the access written in
// the app's SSH config (alias « m-<ip> »), the app key to authorize on the machine, and a connection test with its lines.
import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "./form";
import { input, quiet, type Note } from "../lib/forms";
import { Badge, Dim } from "./ui";
import { tx } from "../lib/i18n";
import { authorizeFor, homeOf } from "../lib/ssh";
import type { SshAlias, SystemState } from "../types";
import { InfoNote } from "./InfoNote";

export type SshKind = "linux" | "windows";
export type CheckResult = { lines: string[]; failed: number };

/** Colour of one line of the access check: ✓ ok, ✗ failed, anything else a warning */
function lineTone(l: string): string {
  if (l.startsWith("✓")) return "text-ok";
  return l.startsWith("✗") ? "text-bad" : "text-warn";
}

/** The app key the machine must accept, as the command to run there for the given account */
export function KeyToAuthorize({ user, kind }: Readonly<{ user: string; kind: SshKind }>) {
  const [authorize, setAuthorize] = useState(""), [esxiKey, setEsxiKey] = useState<string | null>(null);
  useEffect(() => { read<SystemState>("system").then((s) => { setAuthorize(s.ssh.authorize ?? ""); setEsxiKey(s.ssh.public_esxi ?? null); }).catch(() => undefined); }, []);
  if (kind === "windows") return <InfoNote>{tx("Windows par SSH : OpenSSH Server doit être installé et la clé de l'app autorisée pour ce compte. Sans serveur SSH, préférez l'agent.")}</InfoNote>;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{tx("Sur la machine, en root ou avec ce compte, autorisez la clé de l'app dans")} <code className="font-mono text-xs text-txt">{homeOf(user || "root")}/.ssh/authorized_keys</code> :</span>
      {authorize ? <Copyable text={authorizeFor(authorize, user, esxiKey)} /> : <span className="text-warn">{tx("Clé de l'app introuvable : voir")} <a className="underline hover:text-txt" href="#settings/machines/ssh">{tx("Machines › Connexions SSH")}</a>.</span>}
      {(user || "root") === "root" && <Dim>{tx("VMware ESXi : la commande met aussi la clé ECDSA de l'app dans /etc/ssh/keys-root/authorized_keys (ESXi ignore ~/.ssh et refuse ed25519).")}</Dim>}
    </div>
  );
}

/**
 * Address, port and account of the access, « Enregistrer et tester ». apply: the alias is written (POST ssh-alias), then onApplied
 * (the machine's settings take the alias), then probe (the check whose lines are shown). An alias written by hand in the SSH config is
 * shown but not editable: it is changed there.
 */
export function SshParams({ ip, known, alias, defaults, onApplied, probe, first, onUser }: Readonly<{
  ip: string; known?: SshAlias; alias: string | null; defaults?: { port?: number; user?: string };
  onApplied: (r: { alias: string; created: boolean }) => Promise<void>; probe: () => Promise<CheckResult>;
  first?: boolean;   // first activation (no access yet): said above the fields
  onUser?: (user: string) => void;   // the account typed, for the key command shown next to the block
}>) {
  const handWritten = !!alias && !alias.startsWith("m-");
  const [host, setHost] = useState(known?.host || ip), [user, setUser] = useState(known?.user || defaults?.user || "root");
  const [port, setPort] = useState(String(known?.port || defaults?.port || 22));
  const [lines, setLines] = useState<string[] | null>(null), [failed, setFailed] = useState<boolean | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (known) { setHost(known.host || ip); setUser(known.user || "root"); setPort(String(known.port || 22)); } }, [known, ip]);
  useEffect(() => { onUser?.(user); }, [user, onUser]);
  const userOk = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(user), portN = Number(port), portOk = Number.isInteger(portN) && portN >= 1 && portN <= 65535;
  const hostOk = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host.trim());
  const apply = async () => {
    setBusy(true); setNote(null); setLines(null); setFailed(null);
    try {
      if (!handWritten) {
        const r = await send<{ alias: string; created: boolean }>("POST", "machines/ssh-alias", { ip, user, port: portN, host: host.trim() === ip ? null : host.trim() });
        await onApplied(r);
      }
      const r = await probe();
      setLines(r.lines); setFailed(r.failed > 0);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN); else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3">
      {first && <InfoNote>{tx("Première activation : indiquez le compte et le port, autorisez la clé de l'app sur la machine, puis « Enregistrer et tester ».")}</InfoNote>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={tx("Adresse SSH")}><input className={`${input} w-56`} maxLength={253} value={host} disabled={handWritten} autoComplete="off" onChange={(e) => setHost(e.target.value)} placeholder={ip} /></Field>
        <Field label={tx("Port")}><input className={`${input} w-24`} type="number" min={1} max={65535} value={port} disabled={handWritten} onChange={(e) => setPort(e.target.value)} /></Field>
        <Field label={tx("Compte")}><input className={`${input} w-40`} maxLength={32} value={user} disabled={handWritten} autoComplete="off" onChange={(e) => setUser(e.target.value.trim())} /></Field>
        <button type="button" className={quiet} disabled={busy || !userOk || !portOk || !hostOk} onClick={() => void apply()}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <KeyRound size={14} aria-hidden />}{handWritten ? tx("Tester la connexion") : tx("Enregistrer et tester")}
        </button>
        {failed === false && <Badge tone="ok">{tx("connexion OK")}</Badge>}
        {failed === true && <Badge tone="warn">{tx("connexion refusée")}</Badge>}
      </div>
      {handWritten
        ? <Dim>{tx("Accès « {0} » écrit à la main dans la config SSH de l'app : adresse, port et compte se changent là.", alias)}</Dim>
        : <Dim>{tx("L'adresse est l'IP de la machine, ou un nom DNS si elle est jointe par ailleurs ; root par défaut, un compte dédié du groupe docker est plus sûr. Écrit dans la config SSH de l'app, jamais sur la machine.")}</Dim>}
      {lines && (
        <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
          {lines.map((l) => <li key={l} className={lineTone(l)}>{l}</li>)}
        </ul>
      )}
      <NoteLine note={note} />
    </div>
  );
}
