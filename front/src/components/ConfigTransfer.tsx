// Settings -> Backup and info: export the configuration (all of it or some parts) and import an archive (preview first, then the parts you pick).
import { Download, FileUp, KeyRound, ShieldAlert, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { download, read, send } from "../api";
import { act, input, primary, type Note } from "../lib/forms";
import { bytes, dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { Field, NoteLine } from "./form";
import { Badge, Card, Dim } from "./ui";

type PartId = "settings" | "machines" | "backups" | "secrets" | "ssh";
interface PartInfo { id: PartId; label: string; hint: string }
const PARTS: PartInfo[] = [
  { id: "settings", label: tx("Réglages et connecteurs"), hint: tx("Tâches et horaires, notifications, connecteurs, comptes de service (mots de passe chiffrés).") },
  { id: "machines", label: tx("Machines et services"), hint: tx("La liste des machines, leurs rôles, accès et services suivis.") },
  { id: "backups", label: tx("Sauvegardes suivies"), hint: tx("Les sauvegardes déclarées et leurs copies.") },
  { id: "secrets", label: tx("Clé de chiffrement"), hint: tx("Ouvre les mots de passe et jetons des réglages. Sans elle, ils ne sont pas lisibles sur une autre installation.") },
  { id: "ssh", label: tx("Clés et accès SSH"), hint: tx("Les clés privées et les alias SSH utilisés pour lire vos machines.") },
];
const SENSITIVE: PartId[] = ["secrets", "ssh"];
const ALL: PartId[] = PARTS.map((p) => p.id);

interface Available { parts: { id: PartId; files: string[]; sensitive: boolean }[] }
interface PreviewPart { id: PartId; files: string[]; bytes: number; sensitive: boolean; problems: string[]; exists_here: boolean }
interface Preview { manifest: { format?: number; app?: string; created?: number }; parts: PreviewPart[]; ignored: string[]; secrets: { with_archive_key: string; with_current_key: string } }
interface Applied { written: string[]; kept: string[]; restart: boolean }

/** A file as base64, in chunks (a spread of the whole array would overflow the call stack) */
async function toBase64(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  let out = "";
  for (let i = 0; i < data.length; i += 0x8000) out += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(out);
}

function PartCheck({ part, checked, onChange, extra, disabled }: Readonly<{ part: PartInfo; checked: boolean; onChange: (on: boolean) => void; extra?: React.ReactNode; disabled?: boolean }>) {
  const sensitive = SENSITIVE.includes(part.id);
  return (
    <label className={`flex items-start gap-3 rounded-lg border border-line bg-bg/60 px-3 py-2 ${disabled ? "opacity-50" : "cursor-pointer hover:border-link/60"}`}>
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold">{part.label}{sensitive && <Badge tone="warn"><KeyRound size={11} aria-hidden />{tx("sensible")}</Badge>}{extra}</span>
        <span className="block text-xs text-muted">{part.hint}</span>
      </span>
    </label>
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
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Download size={16} aria-hidden />{tx("Exporter la configuration")}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Une archive à garder en lieu sûr, pour tout réinstaller ou pour reprendre seulement une partie. Elle peut contenir la clé de chiffrement et des clés SSH : ne la partagez pas.")}</p>
      <fieldset className="m-0 mb-3 inline-flex min-w-0 rounded-lg border border-line bg-card p-0.5" aria-label={tx("Quoi exporter")}>
        {([[true, tx("Tout")], [false, tx("Au choix")]] as [boolean, string][]).map(([v, label]) => (
          <button key={label} type="button" aria-pressed={all === v} onClick={() => setAll(v)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${all === v ? "bg-link/15 text-txt" : "text-muted hover:text-txt"}`}>{label}</button>
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
    </Card>
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
  if (!picked.includes("settings")) return null;
  const hasKey = pv.parts.some((p) => p.id === "secrets");
  if (picked.includes("secrets")) return pv.secrets.with_archive_key === "unreadable" ? tx("La clé de l'archive n'ouvre pas les mots de passe de ses réglages.") : null;
  if (pv.secrets.with_current_key !== "unreadable") return null;
  return hasKey ? tx("Les mots de passe des réglages ne s'ouvrent pas avec la clé de cette installation : cochez aussi « Clé de chiffrement ».") : tx("Les mots de passe des réglages ne s'ouvrent pas avec la clé de cette installation, et l'archive n'a pas la sienne.");
}

function ImportCard() {
  const [pv, setPv] = useState<Preview | null>(null), [archive, setArchive] = useState(""), [picked, setPicked] = useState<PartId[]>([]);
  const [pw, setPw] = useState(""), [sure, setSure] = useState(false), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [done, setDone] = useState<Applied | null>(null);
  const reset = () => { setPv(null); setArchive(""); setPicked([]); setPw(""); setSure(false); };
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
    const ok = await act(async () => { setDone(await send<Applied>("POST", "system/import", { archive, parts: picked, password: pw })); }, tx("Import terminé"), setNote);
    if (ok) reset();
    setBusy(false);
  };
  const warning = pv ? keyWarning(pv, picked) : null;
  const risky = pv?.parts.some((p) => picked.includes(p.id) && p.exists_here);
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Upload size={16} aria-hidden />{tx("Importer une configuration")}</h2>
      <p className="mb-3 text-sm text-muted">{tx("Choisissez une archive exportée ici : elle est d'abord lue sans rien changer, puis vous cochez les parties à reprendre. Chaque fichier remplacé est gardé à côté en « .avant-import ».")}</p>
      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg2 px-3 py-1.5 text-sm font-semibold hover:border-link">
        <FileUp size={14} aria-hidden />{tx("Choisir une archive (.tar.gz)")}
        <input type="file" accept=".gz,.tgz,.tar.gz,application/gzip" className="sr-only" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {pv && (
        <div className="flex flex-col gap-3">
          <PreviewSummary pv={pv} />
          <div className="flex flex-col gap-2">
            {pv.parts.map((p) => {
              const info = PARTS.find((x) => x.id === p.id)!;
              return (
                <PartCheck key={p.id} part={info} checked={picked.includes(p.id)} disabled={p.problems.length > 0} onChange={(on) => toggle(p.id, on)}
                  extra={<><Dim>{tx("{0} fichier(s), {1}", p.files.length, bytes(p.bytes))}</Dim>{p.exists_here && <Badge tone="info">{tx("remplace l'existant")}</Badge>}{p.problems.map((x) => <Badge key={x} tone="bad">{x}</Badge>)}</>} />
              );
            })}
          </div>
          {warning && <p className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-warn"><ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />{warning}</p>}
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
            <Field label={tx("Ton mot de passe")}>
              <input className={`${input} w-64`} type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            {risky && <label className="flex items-center gap-2 pb-2 text-sm text-muted"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />{tx("Je sais que les fichiers existants seront remplacés")}</label>}
            <button type="submit" className={primary} disabled={busy || picked.length === 0 || Boolean(warning) || (Boolean(risky) && !sure)}><Upload size={14} aria-hidden />{tx("Importer la sélection")}</button>
          </form>
        </div>
      )}
      <NoteLine note={note} />
      {done && (
        <div className="mt-3 text-sm">
          <p className="text-muted">{tx("{0} fichier(s) écrit(s)", done.written.length)}{done.kept.length > 0 && ` · ${tx("{0} ancien(s) gardé(s) en « .avant-import »", done.kept.length)}`}</p>
          {done.restart && <p className="mt-1 font-semibold text-warn">{tx("Redémarrez le conteneur pour appliquer les réglages et la clé importés.")}</p>}
        </div>
      )}
    </Card>
  );
}

export function ConfigTransfer() {
  return <><ExportCard /><ImportCard /></>;
}
