// Réglages → Sauvegardes → Dossier distant : un dossier de sauvegarde sur une Freebox, un NAS ou un serveur FTP / Samba.
// Même déroulement que Veeam : on saisit le compte, on essaie, on parcourt les dossiers (lecture seule, rien n'est enregistré),
// puis « Suivre » enregistre le compte (mot de passe chiffré, jamais réaffiché) et le dossier : comme un jeu à part, ou comme la
// copie d'un jeu déjà suivi (la sauvegarde d'une machine copiée sur la Freebox).
import { ArrowUp, FolderOpen, FolderTree, Globe, HardDrive, Loader2, Lock, PlugZap } from "lucide-react";
import { useState } from "react";
import { LOGIN, LoginRequired, send } from "../api";
import { Field, NoteLine } from "../components/form";
import { IconChoice } from "../components/IconChoice";
import { SecretInput } from "../components/SecretInput";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

type Proto = "ftp" | "ftps" | "smb";
export interface RemoteAccountState { name: string; protocol: Proto; host: string; port: string | number; user: string; share: string; password_set: boolean }
export interface RemoteSet { id: string; label: string }
interface Listing { path: string; folders: string[]; files: { name: string; size: number; mtime: number }[]; file_count: number; size: number; newest: number | null }

const PORTS: Record<Proto, string> = { ftp: "21", ftps: "21", smb: "445" };

export function BackupsRemote({ accounts, sets, reload }: { accounts: RemoteAccountState[]; sets: RemoteSet[]; reload: () => void }) {
  const first = accounts[0];
  const [name, setName] = useState(first?.name ?? ""), [proto, setProto] = useState<Proto>(first?.protocol ?? "ftp");
  const [host, setHost] = useState(first?.host ?? ""), [port, setPort] = useState(first?.port ? String(first.port) : "");
  const [user, setUser] = useState(first?.user ?? ""), [password, setPassword] = useState(""), [share, setShare] = useState(first?.share ?? "");
  const [path, setPath] = useState("/"), [list, setList] = useState<Listing | null>(null);
  const [label, setLabel] = useState(""), [age, setAge] = useState("2"), [copyOf, setCopyOf] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<"" | "test" | "browse" | "follow">("");
  const saved = accounts.find((a) => a.name === name.trim());
  const account = { name: name.trim(), protocol: proto, host: host.trim(), port: port.trim(), user: user.trim(), password, share: share.trim() };
  const filled = account.name !== "" && account.host !== "" && (proto !== "smb" || account.share !== "");
  const ageOk = Number(age) >= 0.1 && Number(age) <= 365;
  const fail = (e: unknown) => { if (e instanceof LoginRequired) location.replace(LOGIN); else setNote({ ok: false, text: (e as Error).message }); };

  const pickAccount = (a: RemoteAccountState | null) => {   // a saved account fills the form (not the password); « new » empties it
    setName(a?.name ?? ""); setProto(a?.protocol ?? "ftp"); setHost(a?.host ?? ""); setPort(a?.port ? String(a.port) : "");
    setUser(a?.user ?? ""); setShare(a?.share ?? ""); setPassword(""); setList(null); setNote(null);
  };
  const test = async () => {
    setBusy("test"); setNote(null);
    try { const r = await send<{ ok: boolean; message: string }>("POST", "backups/remote/test", account); setNote({ ok: r.ok, text: r.message }); } catch (e) { fail(e); }
    setBusy("");
  };
  const browse = async (to: string) => {
    setBusy("browse"); setNote(null);
    try {
      const r = await send<Listing>("POST", "backups/remote/browse", { ...account, path: to });
      setList(r); setPath(r.path);
      if (!label) setLabel(`${account.name} : ${r.path}`.slice(0, 80));
    } catch (e) { fail(e); }
    setBusy("");
  };
  const up = () => browse(path.replace(/\/[^/]*\/?$/, "") || "/");
  const follow = async () => {
    setBusy("follow");
    const ok = await act(() => send("PUT", "backups/remote", { ...account, path, label: label.trim() || `${account.name} : ${path}`, max_age_days: Number(age), copy_of: copyOf }),
      copyOf ? tx("Copie ajoutée au jeu : premier relevé en cours") : tx("Dossier suivi : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite"), setNote);
    setBusy("");
    if (ok) { setList(null); setPassword(""); setCopyOf(""); setLabel(""); reload(); }
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><FolderTree size={16} />{tx("Dossier distant (FTP, FTPS, Samba)")}
        {accounts.length > 0 && <Badge tone="ok">{tx("{0} compte(s)", accounts.length)}</Badge>}</h2>
      <p className="mb-3 text-sm text-muted">
        {tx("Un dossier de sauvegarde sur une Freebox, un NAS ou un serveur FTP / Samba. MyServices ne fait que lister les fichiers (nom, date, taille) : rien n'est écrit ni supprimé là-bas. Le mot de passe est chiffré et n'est jamais réaffiché.")}
      </p>
      {accounts.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-dim">{tx("Compte :")}</span>
          {accounts.map((a) => (
            <button key={a.name} type="button" className={a.name === name.trim() ? primary : quiet} onClick={() => pickAccount(a)}>{a.name}</button>
          ))}
          <button type="button" className={!saved ? primary : quiet} onClick={() => pickAccount(null)}>{tx("Nouveau compte")}</button>
        </div>
      )}
      <div className="mb-3 flex flex-col gap-1 text-sm text-muted">{tx("Protocole")}
        <IconChoice label={tx("Protocole")} value={proto} onPick={(v) => { setProto(v); setList(null); }}
          options={[
            { value: "ftp", label: "FTP", icon: <Globe size={22} aria-hidden />, hint: tx("FTP simple : ce que propose la Freebox") },
            { value: "ftps", label: "FTPS", icon: <Lock size={22} aria-hidden />, hint: tx("FTP chiffré (certificat auto-signé accepté)") },
            { value: "smb", label: "Samba", icon: <HardDrive size={22} aria-hidden />, hint: tx("Partage Windows / NAS (SMB)") }]} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={tx("Nom du compte")}><input className={input} value={name} maxLength={60} placeholder="Freebox" onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label={tx("Adresse (IP ou nom)")}><input className={input} value={host} placeholder="192.168.1.254" onChange={(e) => setHost(e.target.value)} autoComplete="off" /></Field>
        <Field label={tx("Port")}><input className={input} value={port} placeholder={PORTS[proto]} inputMode="numeric" onChange={(e) => setPort(e.target.value)} autoComplete="off" /></Field>
        <Field label={tx("Compte (lecture seule)")}><input className={input} value={user} placeholder={tx("vide : accès anonyme")} onChange={(e) => setUser(e.target.value)} autoComplete="off" /></Field>
        <Field label={tx("Mot de passe")}>
          <SecretInput value={password} onChange={setPassword} autoComplete="new-password" placeholder={saved?.password_set ? tx("enregistré : laisser vide pour le garder") : ""} />
        </Field>
        {proto === "smb" && <Field label={tx("Nom du partage")}><input className={input} value={share} placeholder="sauvegardes" onChange={(e) => setShare(e.target.value)} autoComplete="off" /></Field>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button type="button" className={quiet} disabled={!filled || busy !== ""} onClick={() => void test()}>
          {busy === "test" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <PlugZap size={14} aria-hidden />}{tx("Tester la connexion")}
        </button>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm text-muted">{tx("Dossier à suivre")}
          <input className={`${input} font-mono text-xs`} value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Disque dur/sauvegardes" autoComplete="off" />
        </label>
        <button type="button" className={primary} disabled={!filled || busy !== ""} onClick={() => void browse(path.trim() || "/")}>
          {busy === "browse" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FolderOpen size={14} aria-hidden />}{tx("Parcourir")}
        </button>
      </div>
      <p className="mt-1 text-xs text-dim">{tx("L'essai et le parcours n'enregistrent rien : le compte n'est gardé que lorsque vous suivez un dossier.")}</p>
      {list && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg bg-bg2/50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono text-xs">{list.path}</code>
            {list.path !== "/" && <button type="button" className={quiet} disabled={busy !== ""} onClick={() => void up()}><ArrowUp size={14} aria-hidden />{tx("Dossier parent")}</button>}
          </div>
          {list.folders.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {list.folders.map((f) => (
                <li key={f}><button type="button" className={quiet} disabled={busy !== ""} onClick={() => void browse(`${list.path.replace(/\/$/, "")}/${f}`)}><FolderOpen size={14} aria-hidden />{f}</button></li>
              ))}
            </ul>
          )}
          <Dim>
            {list.file_count > 0
              ? `${tx("{0} fichier(s)", list.file_count)} · ${bytes(list.size)}${list.newest ? ` · ${tx("dernier fichier")} ${dateTime(list.newest * 1000)}` : ""}`
              : tx("aucun fichier directement dans ce dossier")}
          </Dim>
          {list.path !== "/" && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-3">
                <input className={`${input} w-64 py-1 text-xs`} value={label} maxLength={80} aria-label={tx("Nom")} onChange={(e) => setLabel(e.target.value)} />
                <label className="flex items-center gap-1 text-xs text-dim">{tx("alerte après")}
                  <input className={`${input} w-16 py-1 text-xs`} type="number" min={0.1} max={365} step="any" value={age} aria-label={tx("Âge maximum en jours")} onChange={(e) => setAge(e.target.value)} />{tx("j")}
                </label>
              </div>
              {sets.length > 0 && (
                <label className="flex flex-wrap items-center gap-2 text-xs text-dim">{tx("Ce dossier est")}
                  <select className={`${input} w-auto py-1 text-xs`} value={copyOf} onChange={(e) => setCopyOf(e.target.value)} aria-label={tx("Rôle du dossier")}>
                    <option value="">{tx("une sauvegarde à part")}</option>
                    {sets.map((s) => <option key={s.id} value={s.id}>{tx("la copie de : {0}", s.label)}</option>)}
                  </select>
                </label>
              )}
              <div><button type="button" className={primary} disabled={!ageOk || busy !== ""} onClick={() => void follow()}>
                {busy === "follow" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre ce dossier")}</button></div>
            </div>
          )}
        </div>
      )}
      <NoteLine note={note} />
    </Card>
  );
}
