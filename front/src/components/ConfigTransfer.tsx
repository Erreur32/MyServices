// Settings -> Backup and info: export the configuration (all of it or some parts) and import an archive (preview first, then the parts you pick).
import { CheckCircle2, ChevronDown, ChevronRight, Download, FileUp, KeyRound, Loader2, ShieldAlert, Upload, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { download, read, send } from "../api";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { bytes, dateTime } from "../lib/format";
import type { TaskInfo } from "../lib/tasks";
import { useStoredFlag } from "../lib/storedFlag";
import { tx } from "../lib/i18n";
import { Field, NoteLine } from "./form";
import { Badge, Card, Dim } from "./ui";
import { InfoNote } from "./InfoNote";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";

type PartId = "settings" | "machines" | "backups" | "decisions" | "accounts" | "secrets" | "ssh";
interface PartInfo { id: PartId; label: string; hint: string }
const PARTS: PartInfo[] = [
  { id: "settings", label: tx("Réglages et connecteurs"), hint: tx("Tâches et horaires, notifications, connecteurs, comptes de service (mots de passe chiffrés).") },
  { id: "machines", label: tx("Machines et services"), hint: tx("La liste des machines, leurs rôles, accès et services suivis.") },
  { id: "backups", label: tx("Sauvegardes suivies"), hint: tx("Les sauvegardes déclarées et leurs copies.") },
  { id: "decisions", label: tx("Décisions mémorisées"), hint: tx("Vos choix : services suivis ou écartés, constats du Diagnostic marqués « c'est normal », avancement de l'assistant, ajouts automatiques.") },
  { id: "accounts", label: tx("Comptes et historique"), hint: tx("Comptes (mots de passe hachés), jetons d'API, agents, règles d'alerte, historique, journal d'audit et disponibilité. Les connexions en cours ne sont pas gardées.") },
  { id: "secrets", label: tx("Clé de chiffrement"), hint: tx("Ouvre les mots de passe et jetons des réglages. Sans elle, ils ne sont pas lisibles sur une autre installation.") },
  { id: "ssh", label: tx("Clés et accès SSH"), hint: tx("Tout le dossier SSH : les clés privées, le fichier config (les alias, comptes et ports) et known_hosts. Chaque fichier du même nom est remplacé ; la clé propre de cette installation est gardée sauf demande. À importer avec « Machines ».") },
];
const SENSITIVE = new Set<PartId>(["accounts", "secrets", "ssh"]);
const ALL: PartId[] = PARTS.map((p) => p.id);

interface Available { parts: { id: PartId; files: string[]; sensitive: boolean }[] }
interface PreviewPart { needs_key?: boolean; id: PartId; files: string[]; bytes: number; sensitive: boolean; facts: { users?: number; events?: number }; problems: string[]; exists_here: boolean; protected?: string[] }
interface Preview { manifest: { format?: number; app?: string; created?: number }; parts: PreviewPart[]; ignored: string[]; secrets: { with_archive_key: string; with_current_key: string; swap_unsafe: boolean } }
interface Applied { written: string[]; kept: string[]; restart: boolean; relogin: boolean; reloaded?: boolean; skipped?: string[]; parts: string[] }

/** A file as base64, in chunks (a spread of the whole array would overflow the call stack) */
async function toBase64(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  let out = "";
  for (let i = 0; i < data.length; i += 0x8000) out += String.fromCodePoint(...data.subarray(i, i + 0x8000));
  return btoa(out);
}

function PartCheck({ part, checked, onChange, extra, disabled }: Readonly<{ part: PartInfo; checked: boolean; onChange: (on: boolean) => void; extra?: React.ReactNode; disabled?: boolean }>) {
  const sensitive = SENSITIVE.has(part.id);
  return (
    <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 motion-safe:transition-colors ${checked && !disabled ? "border-link bg-link/10 ring-1 ring-link/50" : "border-line bg-bg/60"} ${disabled ? "opacity-50" : "cursor-pointer hover:border-link/60"}`}>
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} aria-label={part.label} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold">{part.label}{sensitive && <Badge tone="warn"><KeyRound size={11} aria-hidden />{tx("sensible")}</Badge>}{extra}</span>
        <span className="block text-xs text-muted">{part.hint}</span>
      </span>
    </label>
  );
}

/** A card that opens on its title and stays folded by default; the choice is remembered in this browser */
function FoldCard({ id, icon: Icon, title, children }: Readonly<{ id: string; icon: LucideIcon; title: string; children: ReactNode }>) {
  const [folded, setFolded] = useStoredFlag(`myservices.settings.${id}Folded`, true);
  const Chevron = folded ? ChevronRight : ChevronDown;
  return (
    <Card>
      <h2 className={`flex items-center gap-2 font-bold ${FOLD_HEADER} ${folded ? "" : "mb-1"}`} {...foldHeaderProps(() => setFolded(!folded))}>
        <button type="button" className="flex flex-1 items-center gap-2 text-left" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          <Chevron size={16} className="text-dim" aria-hidden /><Icon size={16} aria-hidden />{title}
        </button>
      </h2>
      {!folded && children}
    </Card>
  );
}

function ExportCard() {
  const [have, setHave] = useState<Available | null>(null), [all, setAll] = useState(true), [picked, setPicked] = useState<PartId[]>(ALL);
  const [pw, setPw] = useState(""), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => { read<Available>("system/config-parts").then(setHave).catch(() => undefined); }, []);
  const existing = (id: PartId) => (have?.parts.find((p) => p.id === id)?.files.length ?? 0) > 0;
  const chosen = all ? ALL.filter(existing) : picked.filter(existing);
  const toggle = (id: PartId, on: boolean) => setPicked(on ? [...picked, id] : picked.filter((x) => x !== id));
  const go = async () => {
    setBusy(true); setNote(null);
    try {
      const { blob, name } = await download("system/export", { password: pw, parts: all ? null : chosen });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      setPw("");
      setNote({ ok: true, text: tx("{0} téléchargé ({1}) : à garder en lieu sûr", name, bytes(blob.size)) });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <FoldCard id="export" icon={Download} title={tx("Exporter la configuration")}>
      <InfoNote tone="warn" className="mb-3">{tx("Une archive à garder en lieu sûr, pour tout réinstaller ou pour reprendre seulement une partie. Elle peut contenir la clé de chiffrement et des clés SSH : ne la partagez pas.")}</InfoNote>
      <fieldset className="m-0 mb-3 inline-flex min-w-0 rounded-lg border border-line bg-card p-0.5" aria-label={tx("Quoi exporter")}>
        {([[true, tx("Tout")], [false, tx("Au choix")]] as [boolean, string][]).map(([v, label]) => (
          <button key={label} type="button" aria-pressed={all === v} onClick={() => setAll(v)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${all === v ? "border-link bg-link/15 text-txt ring-1 ring-link/50" : "border-transparent text-muted hover:text-txt"}`}>{label}</button>
        ))}
      </fieldset>
      <div className="mb-3 flex flex-col gap-2">
        {PARTS.map((p) => (
          <PartCheck key={p.id} part={p} checked={all ? existing(p.id) : picked.includes(p.id) && existing(p.id)} disabled={all || !existing(p.id)} onChange={(on) => toggle(p.id, on)}
            extra={!existing(p.id) && have ? <Dim>{tx("rien à exporter ici")}</Dim> : null} />
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label={tx("Ton mot de passe")}>
          <input className={`${input} w-64`} type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <button type="submit" className={primary} disabled={busy || chosen.length === 0}><Download size={14} aria-hidden />{tx("Télécharger")}</button>
      </form>
      <NoteLine note={note} />
    </FoldCard>
  );
}

function PreviewSummary({ pv }: Readonly<{ pv: Preview }>) {
  const m = pv.manifest;
  return (
    <p className="text-sm text-muted">
      {m.created ? tx("Archive du {0}", dateTime(m.created * 1000)) : tx("Archive sans date")}{m.app ? ` · MyServices ${m.app}` : ""}
      {pv.ignored.length > 0 && <> · <Dim>{tx("{0} fichier(s) étranger(s) ignoré(s)", pv.ignored.length)}</Dim></>}
    </p>
  );
}

/** Why the chosen parts would not work together, in plain words (the server refuses it as well) */
function keyWarning(pv: Preview, picked: PartId[]): string | null {
  if (picked.includes("secrets") && !picked.includes("settings") && pv.secrets.swap_unsafe) return tx("Remplacer la clé sans reprendre aussi « Réglages et connecteurs » rendrait illisibles les mots de passe actuels de cette installation : cochez aussi les réglages.");
  if (!picked.includes("settings")) return null;
  const hasKey = pv.parts.some((p) => p.id === "secrets");
  if (picked.includes("secrets")) return pv.secrets.with_archive_key === "unreadable" ? tx("La clé de l'archive n'ouvre pas les mots de passe de ses réglages.") : null;
  if (pv.secrets.with_current_key !== "unreadable") return null;
  return hasKey ? tx("Les mots de passe des réglages ne s'ouvrent pas avec la clé de cette installation : cochez aussi « Clé de chiffrement ».") : tx("Les mots de passe des réglages ne s'ouvrent pas avec la clé de cette installation, et l'archive n'a pas la sienne.");
}

function ImportCard() {
  const [pv, setPv] = useState<Preview | null>(null), [archive, setArchive] = useState(""), [picked, setPicked] = useState<PartId[]>([]);
  const [pw, setPw] = useState(""), [sure, setSure] = useState(false), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [done, setDone] = useState<Applied | null>(null), [replaceKey, setReplaceKey] = useState(false);
  const reset = () => { setPv(null); setArchive(""); setPicked([]); setPw(""); setSure(false); setReplaceKey(false); };
  const choose = async (file: File | undefined) => {
    reset(); setDone(null); setNote(null);
    if (!file) return;
    setBusy(true);
    try {
      const b64 = await toBase64(file);
      const got = await send<Preview>("POST", "system/import/preview", { archive: b64 });
      setArchive(b64); setPv(got); setPicked(got.parts.filter((p) => p.problems.length === 0).map((p) => p.id));
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const toggle = (id: PartId, on: boolean) => setPicked(on ? [...picked, id] : picked.filter((x) => x !== id));
  const apply = async () => {
    setBusy(true); setNote(null);
    const ok = await act(async () => { const res = await send<Omit<Applied, "parts">>("POST", "system/import", { archive, parts: picked, password: pw, replace_app_keys: replaceKey });
      setDone({ ...res, parts: PARTS.filter((p) => picked.includes(p.id)).map((p) => p.label) });
    }, tx("Import terminé"), setNote);
    if (ok) reset();
    setBusy(false);
  };
  const warning = pv ? keyWarning(pv, picked) : null;
  const heldKeys = pv?.parts.find((p) => p.id === "ssh")?.protected ?? [];   // this installation's own SSH key files that differ from the archive's
  const sshAlone = picked.includes("ssh") !== picked.includes("machines");   // the SSH aliases (config) and the machine list refer to each other
  const risky = pv?.parts.some((p) => picked.includes(p.id) && p.exists_here);
  return (
    <FoldCard id="import" icon={Upload} title={tx("Importer une configuration")}>
      <InfoNote className="mb-3">{tx("Choisissez une archive exportée ici : elle est d'abord lue sans rien changer, puis vous cochez les parties à reprendre. Chaque fichier remplacé est gardé à côté en « .avant-import ».")}</InfoNote>
      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg2 px-3 py-1.5 text-sm font-semibold hover:border-link">
        <FileUp size={14} aria-hidden />{tx("Choisir une archive (.zip)")}
        <input type="file" accept=".zip,.tar.gz,.tgz,application/zip,application/gzip" className="sr-only" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {pv && (
        <div className="flex flex-col gap-3">
          <PreviewSummary pv={pv} />
          <div className="flex flex-col gap-2">
            {pv.parts.map((p) => {
              const info = PARTS.find((x) => x.id === p.id)!;
              return (
                <PartCheck key={p.id} part={info} checked={picked.includes(p.id)} disabled={p.problems.length > 0} onChange={(on) => toggle(p.id, on)}
                  extra={<><Dim>{p.facts.users === undefined ? tx("{0} fichier(s), {1}", p.files.length, bytes(p.bytes)) : tx("{0} compte(s), {1} événement(s), {2}", p.facts.users, p.facts.events ?? 0, bytes(p.bytes))}</Dim>{p.exists_here && <Badge tone="info">{tx("remplace l'existant")}</Badge>}{p.needs_key && <Badge tone="warn"><KeyRound size={11} aria-hidden />{tx("mots de passe chiffrés : demande la clé")}</Badge>}{p.problems.map((x) => <Badge key={x} tone="bad">{x}</Badge>)}</>} />
              );
            })}
          </div>
          {picked.includes("accounts") && <p className="flex items-start gap-2 rounded-lg border border-link/50 bg-link/10 px-3 py-2 text-sm text-txt"><ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />{tx("Les comptes de cette installation seront remplacés par ceux de l'archive : vous devrez vous reconnecter avec l'un d'eux.")}</p>}
          {picked.includes("ssh") && heldKeys.length > 0 && (
            <InfoNote tone="warn">
              {tx("La clé SSH propre à cette installation n'est pas la même que celle de l'archive. Les machines où vous l'avez autorisée refuseraient la nouvelle : elle est donc gardée telle quelle.")}
              <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={replaceKey} onChange={(e) => setReplaceKey(e.target.checked)} />{tx("La remplacer quand même (à vos risques)")}</label>
            </InfoNote>
          )}
          {sshAlone && <InfoNote tone="warn">{tx("Les alias SSH (clés SSH) et la liste des machines vont ensemble : un alias absent ou une machine sans alias coupe sa lecture. Importez les deux, ou aucun des deux.")}</InfoNote>}
          {warning && <p className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-warn"><ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />{warning}</p>}
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
            <Field label={tx("Ton mot de passe")}>
              <input className={`${input} w-64`} type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            {risky && <label className="flex items-center gap-2 pb-2 text-sm text-muted"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />{tx("Je sais que les fichiers existants seront remplacés")}</label>}
            <button type="submit" className={primary} disabled={busy || picked.length === 0 || Boolean(warning) || (Boolean(risky) && !sure)}><Upload size={14} aria-hidden />{tx("Importer la sélection")}</button>
            <button type="button" className={quiet} disabled={busy} onClick={() => { reset(); setNote(null); }}><X size={14} aria-hidden />{tx("Annuler")}</button>
          </form>
        </div>
      )}
      <NoteLine note={note} />
      {done && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          <p><b>{done.parts.join(", ")}</b> <span className="text-muted">· {tx("{0} fichier(s) écrit(s)", done.written.length)}</span></p>
          {done.kept.length > 0 && <p className="text-muted">{tx("{0} ancien(s) fichier(s) gardé(s) à côté, en « .avant-import »", done.kept.length)}</p>}
          {done.relogin && <InfoNote tone="warn">{tx("Les comptes ont été remplacés : reconnectez-vous avec un compte de l'archive.")}</InfoNote>}
          {done.restart && <InfoNote tone="warn">{tx("Redémarrez le conteneur pour appliquer les réglages et la clé importés.")}</InfoNote>}
          {!!done.skipped?.length && <InfoNote tone="warn">{tx("Gardés tels quels (clé propre de cette installation) : {0}", done.skipped.map((f) => f.replace("ssh/", "")).join(", "))}</InfoNote>}
          {done.reloaded && <p className="text-muted">{tx("Réglages relus sans redémarrage : les horaires importés sont déjà appliqués.")}</p>}
          <AfterImport />
          <button type="button" className={`${quiet} self-start`} onClick={() => window.location.reload()}>{tx("Recharger la page")}</button>
        </div>
      )}
    </FoldCard>
  );
}

const SETTLE_MS = 20_000;   // the chained tasks start a moment after the import answers: not finished before they had the time to appear

/** What follows an import: the collection, the watch and the health run one after the other; says so while any of them runs, then that the data is up to date */
function AfterImport() {
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const t0 = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = () => {
      if (document.hidden) return;
      void read<Record<string, TaskInfo>>("tasks")
        .then((t) => {
          const still = Date.now() - t0 < SETTLE_MS || Object.values(t).some((x) => x.running);
          setBusy(still);
          if (!still) clearInterval(timer);   // done: no more reads (the message stays)
        }).catch(() => undefined);
    };
    void check();
    timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);
  return busy
    ? <output className="flex items-center gap-2 text-warn"><Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />{tx("Mise à jour en cours : la collecte, la veille et la santé relisent les données importées, cela peut durer quelques minutes. Les machines importées apparaissent au fil de l'eau.")}</output>
    : <p className="flex items-center gap-2 text-ok"><CheckCircle2 size={14} className="shrink-0" aria-hidden />{tx("Mise à jour terminée : les données importées sont à jour.")}</p>;
}

export function ConfigTransfer() {
  return <><ExportCard /><ImportCard /></>;
}
