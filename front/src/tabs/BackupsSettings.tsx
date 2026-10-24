// Backups → Settings: « Add backups » (the sources as tiles, the wired ones first; a click opens the wizard of that source under the
// tiles), « To link » (local backup folders and cron lines no followed set claims), copies elsewhere, searched locations, and the page of
// one followed set (#settings/backups/<set id>), opened by « Set » in Backups → Sets. The wizards themselves (Veeam, PBS, Synology,
// vzdump, remote folder, Home Assistant, SSH search) do not change.
import { Archive, ArchiveRestore, ChevronRight, Copy, FolderPen, FolderSearch, FolderTree, HardDrive, Home, Loader2, Pencil, PenLine, ServerCog, DatabaseBackup, SlidersHorizontal, Trash2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine, Switch, TagInput } from "../components/form";
import { Badge, Card, Dim, Loading } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { appIcon } from "../lib/appIcons";
import { BackupsHa, type HaState } from "./BackupsHa";
import { BackupsVeeam, type VeeamState } from "./BackupsVeeam";
import { BackupsPbs, type PbsState } from "./BackupsPbs";
import { BackupsSynology, type SynologyState } from "./BackupsSynology";
import { BackupsRemote, type RemoteAccountState } from "./BackupsRemote";
import { BackupsVzdump, type VzdumpState } from "./BackupsVzdump";
import { MachineIcon } from "../components/MachineIcon";
import type { Backups, Machine } from "../types";
import { CopyGuesses, LocationForm, SetCopies, type CopyRow, type LocRow, type SshMachine } from "./BackupsCopies";
import { UnlinkedBackups } from "./Backups";
import { useRoute } from "../lib/route";
import { InfoNote } from "../components/InfoNote";

export interface SetRow { id: string; label: string; origin: string; origin_ip?: string | null; path: string | null; veeam_job: string | null; agent_backup?: string | null; pbs_group: string | null; synology_task?: string | null; vzdump?: string | null; remote?: boolean; max_age_days: number; ha: boolean; editable: boolean; expect_offsite: boolean; copies?: CopyRow[]; cadence_days?: number | null; archived?: boolean; schedule?: string; retention?: string; note?: string; mode?: "latest" | "each"; locations?: LocRow[] }
const AGES = [2, 8, 15, 31];   // thresholds advised from the observed rhythm: daily, weekly, every 15 days, monthly
interface Current { sets: SetRow[]; exists: boolean; tab: boolean; patterns: string[]; host_patterns?: Record<string, string[]>; default_path: string; machines: number; ssh_machines?: SshMachine[]; veeam: VeeamState; ha: HaState; pbs: PbsState; synology?: SynologyState; vzdump: VzdumpState; remote?: RemoteAccountState[] }
interface Folder { path: string; size: number | null; newest: number | null; newest_name: string; readable: boolean; followed: boolean; default?: boolean }
interface Found { ip: string; name: string; ssh: string; ok: boolean; error: string; folders: Folder[] }
interface Choice { on: boolean; label: string; age: string }

type SourceId = "folders" | "remote" | "veeam" | "pbs" | "synology" | "vzdump" | "ha";
/** Source of a followed set: icon (logo or glyph) and short name */
const SRC: Record<SourceId, { icon: string; Icon: LucideIcon; label: string }> = {
  folders: { icon: "", Icon: FolderSearch, label: tx("Dossier SSH") }, remote: { icon: "", Icon: FolderTree, label: tx("Dossier distant") }, veeam: { icon: "Veeam", Icon: ServerCog, label: "Veeam" },
  pbs: { icon: "Proxmox Backup Server", Icon: DatabaseBackup, label: "Proxmox Backup" }, synology: { icon: "Synology DSM", Icon: HardDrive, label: "Synology" },
  vzdump: { icon: "Proxmox VE", Icon: Archive, label: "vzdump" }, ha: { icon: "Home Assistant", Icon: Home, label: "Home Assistant" },
};

const keyOf = (ip: string, path: string) => `${ip}${path}`;

/** State line of a source tile that works through a connector or an account: what is followed, else why nothing is */
function sourceState(followed: number, some: string, none: string, ready: boolean, missing: string): string {
  if (followed) return some;
  return ready ? none : missing;
}

type Issue = Backups["issues"][number];
const ISSUE_TONE: Record<string, "warn" | "bad"> = { warn: "warn", crit: "bad", down: "bad" };

/** The worst issue of a set (crit or down before warn), or none */
function worstOf(list: Issue[]): Issue | undefined {
  return list.find((i) => i.level === "crit" || i.level === "down") ?? list[0];
}

/** Source of a followed set, as the tiles name them */
export function sourceOf(s: SetRow): SourceId {
  if (s.remote) return "remote";
  if (s.veeam_job || s.agent_backup) return "veeam";
  if (s.pbs_group) return "pbs";
  if (s.synology_task) return "synology";
  if (s.vzdump) return "vzdump";
  return s.ha ? "ha" : "folders";
}

/** What is followed: the folder, the job, the group… */
const whatOf = (s: SetRow) => s.path ?? s.veeam_job ?? s.agent_backup ?? s.pbs_group ?? s.synology_task ?? (s.ha ? tx("sauvegarde automatique") : "-");

/** Attention badge of a set: its worst level, the texts in the tooltip */
function IssueBadge({ list }: Readonly<{ list: Issue[] }>) {
  const w = worstOf(list);
  if (!w) return <Badge tone="ok">OK</Badge>;
  const label = w.level === "down" ? tx("injoignable") : w.level === "crit" ? tx("critique") : tx("en retard");
  return <Badge tone={ISSUE_TONE[w.level] ?? "warn"} title={list.map((i) => i.text).join("\n")}>{label}{list.length > 1 ? ` (${list.length})` : ""}</Badge>;
}

/** Icon of a set: its machine, else the logo of its source */
function SetIcon({ s, m }: Readonly<{ s: SetRow; m?: Machine }>) {
  const kind = SRC[sourceOf(s)];
  const glyph = <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2">{appIcon([kind.icon]) ? <img src={appIcon([kind.icon])!} alt="" className="h-4 w-4" /> : <kind.Icon size={14} className="text-muted" aria-hidden />}</span>;
  return m ? <MachineIcon m={m} reserve empty={glyph} /> : glyph;
}

/** A text or number field saved when leaving it or on Enter, only if the value changed; Escape puts the old value back */
function InlineField({ value, onSave, type = "text", min, max, placeholder, label, width, disabled, suffix, maxLength = 40 }: Readonly<{
  value: string; onSave: (v: string) => void; type?: "text" | "number"; min?: number; max?: number; placeholder?: string; label: string; width: string; disabled?: boolean; suffix?: string; maxLength?: number;
}>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const ok = type === "text" || (Number(v) >= (min ?? -Infinity) && Number(v) <= (max ?? Infinity));
  const save = () => { if (ok && v.trim() !== value) onSave(v.trim()); else if (!ok) setV(value); };
  return (
    <span className="inline-flex items-center gap-1">
      <input type={type} min={min} max={max} step={type === "number" ? "any" : undefined} value={v} placeholder={placeholder} aria-label={label} disabled={disabled} maxLength={maxLength}
        className={`${input.replace("w-full", width)} py-1 text-xs ${ok ? "" : "border-bad"}`} onChange={(e) => setV(e.target.value)} onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setV(value); (e.target as HTMLInputElement).blur(); }
        }} />
      {suffix && <span className="text-xs text-dim">{suffix}</span>}
    </span>
  );
}

/** A one-line field opened by the row menu (rename, change the folder): Enter saves, Escape closes */
function EditLine({ initial, label, onSave, onClose, mono = false }: Readonly<{ initial: string; label: string; onSave: (v: string) => void; onClose: () => void; mono?: boolean }>) {
  const [v, setV] = useState(initial);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);   // the field was asked for from the row menu: the keyboard goes there
  const ok = v.trim().length > 0 && v.trim().length <= (mono ? 300 : 80);
  return (
    <span className="flex items-center gap-1.5">
      <input ref={box} value={v} aria-label={label} className={`${input} py-1 text-xs ${mono ? "font-mono" : ""} ${ok ? "" : "border-bad"}`} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) { onSave(v.trim()); }
          else if (e.key === "Escape") { onClose(); }
        }} />
      <button type="button" className={`${primary} py-1`} disabled={!ok} onClick={() => onSave(v.trim())}>{tx("OK")}</button>
      <button type="button" className={`${quiet} py-1`} onClick={onClose} aria-label={tx("Annuler")}><X size={14} aria-hidden /></button>
    </span>
  );
}

/** « Confirm removal » and « Cancel », in the row of the set */
function RemoveConfirm({ onConfirm, onCancel }: Readonly<{ onConfirm: () => void; onCancel: () => void }>) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" className={`${danger} py-1`} onClick={onConfirm}>{tx("Confirmer le retrait")}</button>
      <button type="button" className={`${quiet} py-1`} onClick={onCancel}>{tx("Annuler")}</button>
    </span>
  );
}

/** The threshold advised from the observed rhythm of a set (a quarter more than the time between two archives), or null */
function advisedAge(s: SetRow): number | null {
  if (!s.cadence_days) return null;
  return AGES.find((d) => d >= s.cadence_days! * 1.25) ?? AGES.at(-1)!;
}

type SetChange = { label?: string; max_age_days?: number; expect_offsite?: boolean; archived?: boolean; schedule?: string; path?: string; retention?: string; note?: string; mode?: "latest" | "each" };

/** One line of the set page: its name on the left, its control on the right */
function SetField({ k, children }: Readonly<{ k: string; children: ReactNode }>) {
  return (
    <div className="grid gap-1 border-t border-line/60 py-2.5 sm:grid-cols-[12rem_1fr] sm:items-center">
      <span className="text-sm text-muted">{k}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>
    </div>
  );
}

/** One followed set on a settings page of its own (#settings/backups/<set id>), opened by « Set » in Backups → Sets */
function SetPage({ s, m, issues, sshMachines, found, busy, onChange, onRemove, onDone, setNote }: Readonly<{
  s: SetRow; m?: Machine; issues: Issue[]; sshMachines: SshMachine[]; found: Found[] | null; busy: boolean;
  onChange: (body: SetChange, done?: string) => Promise<boolean>; onRemove: () => void; onDone: () => void; setNote: (n: Note) => void;
}>) {
  const [edit, setEdit] = useState<"" | "rename" | "path" | "remove">("");
  const advised = advisedAge(s), managed = !!(s.ha || s.veeam_job || s.pbs_group || s.synology_task);
  const save = (body: SetChange, done?: string) => void onChange(body, done).then((ok) => ok && setEdit(""));
  const source = s.locations?.[0], folder = !!source?.editable;   // a folder place: every setting of it can change
  const raise = advised !== null && advised > s.max_age_days;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <SetIcon s={s} m={m} />
        <h2 className="font-bold">{s.label}</h2>
        <Badge tone="off">{SRC[sourceOf(s)].label}</Badge>
        {s.archived ? <Badge tone="off">{tx("archivé")}</Badge> : <IssueBadge list={issues} />}
        <a href="#backups/all" className="ml-auto text-sm text-link hover:underline">‹ {tx("Jeux")}</a>
        {m && <a href={`#machines/${m.ip}`} className="text-sm text-link hover:underline">{tx("Page de la machine")} ›</a>}
      </div>
      <SetField k={tx("Nom")}>
        {edit === "rename" ? <EditLine initial={s.label} label={tx("Nom")} onSave={(v) => save({ label: v }, tx("jeu renommé"))} onClose={() => setEdit("")} />
          : <><b>{s.label}</b><button type="button" className={`${quiet} py-1`} onClick={() => setEdit("rename")}><Pencil size={14} aria-hidden />{tx("Renommer")}</button></>}
      </SetField>
      <SetField k={tx("Ce qui est suivi")}>
        <code className="break-all font-mono text-xs">{whatOf(s)}</code><Dim>· {s.origin || "-"}</Dim>
        {folder ? <button type="button" className={`${quiet} py-1`} onClick={() => setEdit(edit === "path" ? "" : "path")}><FolderPen size={14} aria-hidden />{tx("Modifier l'emplacement")}</button>
          : s.path && !s.vzdump && <Dim>{tx("emplacement donné par sa source")}</Dim>}
        {source && folder && <Dim>{tx("fichiers {0} · profondeur {1}{2}", source.pattern, source.depth, source.via ? ` · ${source.via}` : "")}</Dim>}
        {edit === "path" && source && folder && <div className="w-full"><LocationForm setId={s.id} loc={source} machines={sshMachines} busy={busy} onDone={() => { setEdit(""); onDone(); }} onCancel={() => setEdit("")} setNote={setNote} /></div>}
      </SetField>
      <SetField k={tx("Attendu")}>
        <InlineField value={s.schedule ?? ""} label={tx("Attendu")} width="w-48" placeholder={tx("ex. lun. 01:30")} disabled={busy} onSave={(v) => save({ schedule: v }, tx("horaire attendu noté"))} />
      </SetField>
      <SetField k={tx("Âge maximum")}>
        <InlineField value={String(s.max_age_days)} type="number" min={0.1} max={365} label={tx("Âge maximum en jours")} width="w-20" suffix={tx("j")} disabled={busy} onSave={(v) => save({ max_age_days: Number(v) })} />
        {advised !== null && advised !== s.max_age_days && (
          <button type="button" disabled={busy} onClick={() => save({ max_age_days: advised })}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${raise ? "border-warn/60 bg-warn/10 text-warn hover:bg-warn/20" : "border-link/60 bg-link/10 text-link hover:bg-link/20"}`}
            title={raise ? tx("Les archives arrivent environ tous les {0} j : avec un seuil de {1} j, le jeu est en alerte entre deux passages.", s.cadence_days, s.max_age_days)
              : tx("Les archives arrivent environ tous les {0} j : avec un seuil de {1} j, une sauvegarde manquée ne serait signalée que très tard.", s.cadence_days, s.max_age_days)}>
            {tx("rythme ~{0} j : passer à {1} j", s.cadence_days, advised)}</button>
        )}
      </SetField>
      <SetField k={tx("Rétention")}>
        <InlineField value={s.retention ?? ""} label={tx("Rétention")} width="w-48" maxLength={60} placeholder={tx("ex. 3 archives, keep-last=7")} disabled={busy} onSave={(v) => save({ retention: v }, tx("rétention notée"))} />
      </SetField>
      <SetField k={tx("Note")}>
        <InlineField value={s.note ?? ""} label={tx("Note")} width="w-full max-w-xl" maxLength={300} placeholder={tx("ce qu'il faut savoir sur ce jeu")} disabled={busy} onSave={(v) => save({ note: v }, tx("note enregistrée"))} />
      </SetField>
      {s.path && (s.copies?.length ?? 0) > 0 && (
        <SetField k={tx("Comparer les copies")}>
          <Switch on={s.mode === "each"} label={tx("Comparer chaque archive")} disabled={busy} onChange={(on) => save({ mode: on ? "each" : "latest" })} />
          <Dim>{tx("Activé : chaque archive de la source doit se trouver sur les copies (dossier de fichiers qui ne changent pas). Désactivé : seule la plus récente est comparée.")}</Dim>
        </SetField>
      )}
      {!managed && (
        <SetField k={tx("Copie hors machine")}>
          <Switch on={s.expect_offsite} label={tx("Exiger une copie hors machine")} disabled={busy} onChange={(on) => save({ expect_offsite: on })} />
          <Dim>{tx("Activé : une copie à jour sur une autre machine est exigée (sinon le jeu est critique). Désactivé : seule la source est surveillée.")}</Dim>
        </SetField>
      )}
      {s.path && (
        <div className="border-t border-line/60 pt-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Copy size={14} aria-hidden />{tx("Copies ailleurs")}</h3>
          <SetCopies setId={s.id} origin={s.origin} copies={s.copies ?? []} locations={s.locations} machines={sshMachines} found={found} busy={busy} onDone={onDone} setNote={setNote} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
        <ArchiveButton archived={!!s.archived} busy={busy} onClick={() => save({ archived: !s.archived }, s.archived ? tx("jeu de nouveau surveillé : relevé en cours") : tx("jeu archivé : gardé dans la liste, plus surveillé"))} />
        <span className="ml-auto">{edit === "remove" ? <RemoveConfirm onConfirm={onRemove} onCancel={() => setEdit("")} />
          : <button type="button" className={danger} onClick={() => setEdit("remove")}><Trash2 size={14} aria-hidden />{tx("Retirer")}</button>}</span>
      </div>
    </Card>
  );
}

/** Archive (kept in the list, no longer watched) or watch again */
function ArchiveButton({ archived, busy, onClick }: Readonly<{ archived: boolean; busy: boolean; onClick: () => void }>) {
  if (archived) return <button type="button" className={quiet} disabled={busy} onClick={onClick}><ArchiveRestore size={14} aria-hidden />{tx("Désarchiver")}</button>;
  return <button type="button" className={quiet} disabled={busy} onClick={onClick} title={tx("Gardé dans la liste des jeux, plus surveillé")}><Archive size={14} aria-hidden />{tx("Archiver")}</button>;
}

/** Sub-pages of Backups → Settings in the side menu (#settings/backups/<part>); any other last part is a set (#settings/backups/<set id>) */
const PARTS = ["add", "unlinked", "copies", "paths"] as const;
type Part = "set" | (typeof PARTS)[number];

/** The sub-page shown: the one named in the address, else the page of the set named there, else « Add backups » */
function partOf(last: string): Part {
  return PARTS.find((x) => x === last) ?? (last ? "set" : "add");
}

export function BackupsSettings({ machines = [], issues = [], backups }: Readonly<{ machines?: Machine[]; issues?: Issue[]; backups?: Backups | null }>) {
  const machineOf = (ip?: string | null) => machines.find((m) => m.ip === ip);
  const [cur, setCur] = useState<Current | null>(null), [error, setError] = useState("");
  const [found, setFound] = useState<Found[] | null>(null), [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [busyId, setBusyId] = useState("");
  const [open, setOpen] = useState("");   // source tile opened (one wizard at a time)
  const [extra, setExtra] = useState<string | null>(null);  // locations searched besides the default folder (null = the server's)
  const [hostExtra, setHostExtra] = useState<Record<string, string>>({});  // per machine (ip), only the lists edited and not saved yet
  const [manual, setManual] = useState({ ip: "", path: "", label: "", age: "2" });
  const load = useCallback(() => {
    read<Current>("backups/settings").then((c) => { setCur(c); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(load, [load]);
  const route = useRoute(), last = route.split("/")[2] || "";   // a sub-page, or the id of a set (#settings/backups/<set id>)
  useEffect(() => { if (route === "#settings/backups") location.replace("#settings/backups/add"); }, [route]);   // bare address only (never while leaving): its first page
  const issuesOf = (id: string) => issues.filter((i) => i.set_id === id);

  const search = async () => {
    setSearching(true); setNote(null);
    try {
      const r = await send<{ machines: Found[] }>("POST", "backups/discover");
      setFound(r.machines);
      const next: Record<string, Choice> = {};
      for (const m of r.machines) for (const f of m.folders)
        if (!f.followed) next[keyOf(m.ip, f.path)] = { on: !!f.default && f.readable, label: `${m.name} : ${f.path}`, age: "2" };  // found at the default path: already ticked, left to confirm
      setPick(next);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setSearching(false);
  };
  const change = async (id: string, body: SetChange, done = tx("jeu modifié : relevé en cours")) => {
    setBusyId(id);
    const ok = await act(() => send("PATCH", `backups/settings/${id}`, body), done, setNote);
    setBusyId("");
    if (ok) load();
    return ok;
  };
  const remove = async (id: string) => {
    if (await act(() => send("DELETE", `backups/settings/${id}`), tx("sauvegarde retirée"), setNote)) location.hash = "backups/all";
  };
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365);
  const followItems = async (items: { ip: string; path: string; label: string; max_age_days: number }[]) => {
    setBusy(true);
    const ok = await act(() => send("PUT", "backups/settings", { items }), tx("{0} dossier(s) suivi(s) : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite", items.length), setNote);
    setBusy(false);
    return ok;
  };
  const follow = async () => {
    const items = chosen.map(([k, c]) => {
      const m = (found ?? []).find((x) => k.startsWith(`${x.ip}/`))!;
      return { ip: m.ip, path: k.slice(m.ip.length), label: c.label.trim(), max_age_days: Number(c.age) };
    });
    if (await followItems(items)) { setFound(null); setPick({}); load(); }
  };
  const manualOk = manual.ip && manual.path.startsWith("/") && manual.path.length > 1 && manual.label.trim() && Number(manual.age) >= 0.1 && Number(manual.age) <= 365;
  const followManual = async () => {
    if (await followItems([{ ip: manual.ip, path: manual.path.trim(), label: manual.label.trim(), max_age_days: Number(manual.age) }])) { setManual({ ip: "", path: "", label: "", age: "2" }); setOpen(""); load(); }
  };

  const extras = extra ?? (cur?.patterns ?? []).filter((p) => p !== cur?.default_path).join(", ");
  const hostExtras = (ip: string) => hostExtra[ip] ?? (cur?.host_patterns?.[ip] ?? []).join(", ");
  const splitList = (v: string) => v.split(",").map((p) => p.trim()).filter(Boolean);
  const dirty = extra !== null || Object.keys(hostExtra).length > 0;
  const savePatterns = async () => {
    setBusy(true);
    const byHost: Record<string, string[]> = {};
    for (const m of cur?.ssh_machines ?? []) byHost[m.ip] = splitList(hostExtras(m.ip));
    const ok = await act(() => send("PUT", "backups/patterns", { patterns: splitList(extras), by_host: byHost }), tx("emplacements enregistrés"), setNote);
    setBusy(false);
    if (ok) { setExtra(null); setHostExtra({}); setFound(null); load(); }
  };

  if (!cur) return <Loading error={error} />;
  const live = cur.sets.filter((s) => !s.archived);
  const countOf = (src: SourceId) => live.filter((s) => sourceOf(s) === src).length;

  const SEARCH = (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={searching || cur.machines === 0} onClick={() => void search()}>
          {searching ? <><Loader2 size={14} className="animate-spin" aria-hidden />{tx("Recherche…")}</> : <><FolderSearch size={14} aria-hidden />{tx("Chercher")}</>}
        </button>
        <span className="text-xs text-dim">
          {cur.machines === 0 ? tx("Aucune machine n'est lue par SSH : activez l'accès SSH d'une machine (Réglages → Machines) pour y chercher des sauvegardes.")
            : tx("Cherche, sur les {0} machine(s) lues par SSH, les dossiers de sauvegarde habituels :", cur.machines)} {cur.machines > 0 && <code className="font-mono text-xs">{cur.patterns.join("  ")}</code>}
          {cur.machines > 0 && <> · <a href="#settings/backups/paths" className="text-link hover:underline">{tx("autres emplacements : Emplacements cherchés")}</a></>}
        </span>
      </div>
      {searching && <p className="mt-2 text-sm text-dim">{tx("Lecture des dossiers en cours (taille et fichier le plus récent) : jusqu'à une minute.")}</p>}
      {found && (
        <div className="mt-3 flex flex-col gap-3">
          {found.every((m) => m.ok && m.folders.length === 0) && (
            <p className="rounded-lg bg-bg2/60 px-3 py-2 text-sm text-muted">{tx("Aucun dossier de sauvegarde trouvé dans ces emplacements. Si vos sauvegardes sont ailleurs, ajoutez leur dossier dans « Emplacements communs à toutes les machines » ou sous la machine concernée, puis relancez la recherche.")}</p>
          )}
          {found.map((m) => {   // one folded frame per machine: the summary says what was found and what is ticked
            const ticked = m.folders.filter((f) => pick[keyOf(m.ip, f.path)]?.on).length, followed = m.folders.filter((f) => f.followed).length;
            return (
            <details key={m.ip} className="group overflow-hidden rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 bg-bg px-3 py-2 text-sm font-semibold group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
                <ChevronRight size={15} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
                {machineOf(m.ip) && <MachineIcon m={machineOf(m.ip)!} reserve />}{m.name} <Dim>{m.ip}</Dim>
                {!m.ok ? <Badge tone="bad">{tx("illisible")}</Badge> : <Badge tone={m.folders.length ? "info" : "off"}>{tx("{0} dossier(s)", m.folders.length)}</Badge>}
                {followed > 0 && <Badge tone="ok">{tx("{0} déjà suivi(s)", followed)}</Badge>}
                {ticked > 0 && <Badge tone="info">{tx("{0} cochée(s)", ticked)}</Badge>}
              </summary>
              <div className="p-3">
              {!m.ok && <p className="text-xs text-bad">{m.error}</p>}
              {m.ok && m.folders.length === 0 && <Dim>{tx("aucun dossier trouvé")}</Dim>}
              <ul className="flex flex-col gap-2">
                {m.folders.map((f) => {
                  const k = keyOf(m.ip, f.path), c = pick[k];
                  return (
                    <li key={k} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${f.followed ? "opacity-60" : ""}`}>
                      <label className="flex min-w-[220px] flex-1 items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={f.followed || !f.readable} checked={!!c?.on} aria-label={f.path}
                          onChange={(e) => setPick({ ...pick, [k]: { ...c, on: e.target.checked } })} />
                        <span className="min-w-0">
                          <code className="break-all font-mono text-xs">{f.path}</code>
                          <span className="block text-xs text-dim">
                            {f.size != null ? bytes(f.size) : "?"}
                            {f.newest ? ` · ${tx("dernier fichier")} ${dateTime(f.newest * 1000)}${f.newest_name ? ` (${f.newest_name})` : ""}` : ` · ${tx("aucun fichier")}`}
                          </span>
                        </span>
                      </label>
                      {f.default && !f.followed && f.readable && <Badge tone="info" title={tx("Dossier de sauvegarde par défaut")}>{tx("chemin par défaut")}</Badge>}
                      {f.followed ? <Badge tone="ok">{tx("déjà suivi")}</Badge> : !f.readable ? <Badge tone="warn">{tx("illisible par le compte SSH")}</Badge> : c?.on && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input className={`${input} w-56 py-1 text-xs`} value={c.label} maxLength={80} aria-label={tx("Nom")}
                            onChange={(e) => setPick({ ...pick, [k]: { ...c, label: e.target.value } })} />
                          <label className="flex items-center gap-1 text-xs text-dim">{tx("alerte après")}
                            <input className={`${input} w-16 py-1 text-xs`} type="number" min={0.1} max={365} step="any" value={c.age} aria-label={tx("Âge maximum en jours")}
                              onChange={(e) => setPick({ ...pick, [k]: { ...c, age: e.target.value } })} />{tx("j")}
                          </label>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              </div>
            </details>
            );
          })}
          {Object.keys(pick).length > 0 && (
            <div><button type="button" className={primary} disabled={!valid || busy} onClick={() => void follow()}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre la sélection")} {chosen.length > 0 && `(${chosen.length})`}</button></div>
          )}
        </div>
      )}
    </div>
  );
  const MANUAL = (
    <div className="flex flex-col gap-2">
      <InfoNote>{tx("Un dossier que la recherche n'a pas vu : la machine (lue par SSH), son chemin absolu, un nom et l'âge maximum du dernier fichier. Lecture seule : rien n'est modifié sur la machine.")}</InfoNote>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">{tx("Machine")}
          <select className={`${input} w-44 py-1.5`} value={manual.ip} onChange={(e) => setManual({ ...manual, ip: e.target.value })}>
            <option value="">{tx("choisir…")}</option>
            {(cur.ssh_machines ?? []).map((m) => <option key={m.ip} value={m.ip}>{m.name}</option>)}
          </select>
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted">{tx("Dossier")}
          <input className={`${input} py-1.5 font-mono`} value={manual.path} placeholder="/srv/sauvegardes" maxLength={300} onChange={(e) => setManual({ ...manual, path: e.target.value })} />
        </label>
        <label className="flex min-w-[180px] flex-col gap-1 text-xs text-muted">{tx("Nom")}
          <input className={`${input} py-1.5`} value={manual.label} maxLength={80} onChange={(e) => setManual({ ...manual, label: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">{tx("Âge max (j)")}
          <input className={`${input} w-20 py-1.5`} type="number" min={0.1} max={365} step="any" value={manual.age} onChange={(e) => setManual({ ...manual, age: e.target.value })} />
        </label>
        <button type="button" className={primary} disabled={!manualOk || busy} onClick={() => void followManual()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <PenLine size={14} aria-hidden />}{tx("Déclarer le dossier")}</button>
      </div>
    </div>
  );
  const veeamSets = countOf("veeam"), remoteSets = countOf("remote"), folderSets = countOf("folders");
  type Tile = { id: string; label: string; icon: string; Icon: LucideIcon; hint: string; state: string; missing?: boolean; action: string; panel: ReactNode };
  const tiles: Tile[] = [
    { id: "folders", label: tx("Dossiers sur mes machines"), icon: "", Icon: FolderSearch, hint: tx("lus par SSH, cron détectés"), state: tx("{0} jeu(x)", folderSets), action: tx("Chercher"), panel: SEARCH },
    { id: "vzdump", label: tx("Proxmox VE (vzdump)"), icon: "Proxmox VE", Icon: Archive, hint: tx("lus par SSH sur l'hôte"), state: tx("{0} jeu(x)", cur.vzdump.followed), action: tx("Chercher"), panel: <BackupsVzdump state={cur.vzdump} reload={load} /> },
    { id: "ha", label: "Home Assistant", icon: "Home Assistant", Icon: Home, hint: tx("par le connecteur"), state: cur.ha.followed ? tx("{0} jeu(x)", 1) : tx("pas suivi"), missing: cur.ha.connectors.length === 0 && !cur.ha.followed, action: tx("Vérifier"), panel: <BackupsHa key={`${cur.ha.connector}|${cur.ha.connectors.join()}`} state={cur.ha} reload={load} /> },
    { id: "remote", label: tx("Dossier distant"), icon: "", Icon: FolderTree, hint: tx("FTP, FTPS, Samba"), state: tx("{0} compte(s)", (cur.remote ?? []).length) + (remoteSets ? ` · ${tx("{0} jeu(x)", remoteSets)}` : ""), action: tx("Ajouter un compte"),
      panel: <BackupsRemote accounts={cur.remote ?? []} sets={live.filter((x) => x.path && !x.vzdump && !x.remote).map((x) => ({ id: x.id, label: x.label }))} reload={load} /> },
    { id: "veeam", label: "Veeam", icon: "Veeam", Icon: ServerCog, hint: tx("API REST"), state: sourceState(veeamSets, tx("{0} job(s) suivi(s)", veeamSets), tx("aucun job suivi"), cur.veeam.configured, tx("compte à saisir")), action: tx("Chercher les jobs"), panel: <BackupsVeeam key={`${cur.veeam.url}|${cur.veeam.user}`} state={cur.veeam} reload={load} /> },
    { id: "pbs", label: "Proxmox Backup Server", icon: "Proxmox Backup Server", Icon: DatabaseBackup, hint: tx("par le connecteur"), state: sourceState(cur.pbs.followed, tx("{0} groupe(s) suivi(s)", cur.pbs.followed), tx("aucun groupe suivi"), cur.pbs.connectors.length > 0, tx("connecteur absent")), missing: cur.pbs.connectors.length === 0, action: tx("Chercher"), panel: <BackupsPbs state={cur.pbs} reload={load} /> },
    { id: "synology", label: "Synology Hyper Backup", icon: "Synology DSM", Icon: HardDrive, hint: tx("par le connecteur"), state: sourceState(cur.synology?.followed ?? 0, tx("{0} tâche(s) suivie(s)", cur.synology?.followed ?? 0), tx("aucune tâche suivie"), (cur.synology?.connectors.length ?? 0) > 0, tx("connecteur absent")), missing: !cur.synology?.connectors.length, action: tx("Chercher"), panel: <BackupsSynology state={cur.synology ?? { connectors: [], followed: 0 }} reload={load} /> },
    { id: "manual", label: tx("À la main"), icon: "", Icon: PenLine, hint: tx("un dossier que la recherche n'a pas vu"), state: cur.machines ? tx("{0} machine(s) lues par SSH", cur.machines) : tx("aucune machine lue par SSH"), missing: cur.machines === 0, action: tx("Déclarer un dossier"), panel: MANUAL },
  ].sort((a, b) => Number(!!a.missing) - Number(!!b.missing));   // the wired sources first, the ones needing a connector last
  const opened = tiles.find((t) => t.id === open);
  const wired = tiles.filter((t) => t.id !== "manual" && !t.missing).length;

  const one = cur.sets.find((x) => x.id === last);
  const pages: Record<Part, ReactNode> = {
      add: <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><SlidersHorizontal size={16} />{tx("Ajouter des sauvegardes")}</h2>
        <InfoNote className="mb-3">{tx("Les sources branchées d'abord ; une source grisée demande un connecteur. Un clic ouvre l'assistant de la source sous les tuiles.")}</InfoNote>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map((t) => {
            const on = open === t.id;
            return (
              <button key={t.id} type="button" aria-pressed={on} onClick={() => setOpen(on ? "" : t.id)}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${on ? "border-link bg-link/10" : "border-line bg-bg2/30 hover:border-link"} ${t.missing ? "opacity-60" : ""}`}>
                <span className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2">{appIcon([t.icon]) ? <img src={appIcon([t.icon])!} alt="" className="h-4 w-4" /> : <t.Icon size={15} className="text-muted" aria-hidden />}</span>
                  <b className="text-sm leading-tight">{t.label}</b>
                </span>
                <span className="text-xs text-dim">{t.hint} · {t.state}</span>
                {t.missing && t.id !== "manual" ? <a href="#settings/connectors" className="text-xs text-link hover:underline" onClick={(e) => e.stopPropagation()}>{tx("Ajouter le connecteur")} ›</a>
                  : <span className="text-xs font-semibold text-link">{on ? tx("Fermer") : t.action}</span>}
              </button>
            );
          })}
        </div>
        {opened && (
          <div className="mt-3 rounded-xl border border-link/60 bg-bg2/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              <b className="text-sm">{opened.label}</b><span className="text-xs text-dim">{opened.hint}</span>
              <button type="button" className={`${quiet} ml-auto py-1`} onClick={() => setOpen("")}><X size={14} aria-hidden />{tx("Fermer")}</button>
            </div>
            <div className="[&_h2]:hidden [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 [&>section]:shadow-none">{opened.panel}</div>
          </div>
        )}
      </Card>,

      copies: <Card>
            <h2 className="mb-1 flex items-center gap-2 font-bold"><Copy size={16} aria-hidden />{tx("Copies ailleurs")}</h2>
            <InfoNote className="mb-2">{tx("Où vos sauvegardes sont copiées (autre machine, NAS, box) : comparées à la source à chaque relevé. Pour un jeu précis : menu ⋯ › Copies ailleurs.")}</InfoNote>
            {live.some((x) => x.path) && cur.machines > 0 ? <CopyGuesses onDone={load} setNote={setNote} /> : <Dim>{tx("Rien à chercher : aucun dossier suivi sur une machine lue par SSH.")}</Dim>}
      </Card>,
      paths: <Card>
            <h2 className="mb-1 flex items-center gap-2 font-bold"><FolderSearch size={16} aria-hidden />{tx("Emplacements cherchés")}</h2>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm"><b>{tx("Dossier par défaut")}</b><code className="font-mono text-xs">{cur.default_path}</code>
              <Dim>{tx("toujours cherché ; s'il existe sur une machine, il est coché d'office.")}</Dim></div>
            <TagInput label={tx("Emplacements communs à toutes les machines")} value={extras} onChange={setExtra} max={800} placeholder={tx("ex. /srv/sauvegardes, /mnt/*/save*")} />
            <InfoNote className="mt-1">{tx("Un chemin absolu ; * permis (un motif). Entrée ou virgule pour en ajouter. Cherché sur chaque machine lue par SSH.")}</InfoNote>
            {(cur.ssh_machines ?? []).length > 0 && (
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-muted hover:text-txt [&::-webkit-details-marker]:hidden"><ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />{tx("Avancé : emplacements propres à une machine")}</summary>
                <InfoNote className="mb-2">{tx("Un dossier qui n'existe que sur une machine (ex. la sauvegarde de configuration d'un Proxmox) : il n'est cherché que là.")}</InfoNote>
                <ul className="flex flex-col gap-2">
                  {(cur.ssh_machines ?? []).map((m) => (
                    <li key={m.ip} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <span className="flex w-44 shrink-0 items-center gap-2 pt-1.5 text-sm">{machineOf(m.ip) && <MachineIcon m={machineOf(m.ip)!} reserve />}<span className="truncate" title={m.ip}>{m.name}</span></span>
                      <div className="min-w-[220px] flex-1">
                        <TagInput label={`${tx("Emplacements de")} ${m.name}`} value={hostExtras(m.ip)} max={800} placeholder={tx("ex. /mnt/nvme0/proxmox-host-backup/config")}
                          onChange={(v) => setHostExtra({ ...hostExtra, [m.ip]: v })} />
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {dirty && <button type="button" className={`${primary} mt-2`} disabled={busy} onClick={() => void savePatterns()}>{tx("Enregistrer les emplacements")}</button>}
      </Card>,
      unlinked: <UnlinkedBackups b={backups} />,
      set: one ? <SetPage s={one} m={machineOf(one.origin_ip)} issues={issuesOf(one.id)} sshMachines={cur.ssh_machines ?? []} found={found} busy={busyId === one.id}
        onChange={(body, done) => change(one.id, body, done)} onRemove={() => void remove(one.id)} onDone={load} setNote={setNote} />
        : <Card><p className="text-sm text-muted">{tx("Ce jeu n'existe plus.")} <a href="#backups/all" className="text-link hover:underline">{tx("Jeux")} ›</a></p></Card>,
  };
  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm text-muted">{tx("{0} jeu(x) suivi(s)", live.length)} · {tx("{0} source(s) branchée(s)", wired)}</span>
      <NoteLine note={note} />
      {pages[partOf(last)]}
    </div>
  );
}
