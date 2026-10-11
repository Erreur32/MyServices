// Réglages → Sauvegardes : choisir, depuis la page, les dossiers de sauvegarde à surveiller. La recherche passe par SSH, en lecture
// seule, dans les emplacements habituels de chaque machine ; on coche, on nomme, on fixe l'âge maximum du dernier fichier.
// Veeam (BackupsVeeam.tsx) et Home Assistant (BackupsHa.tsx) ont leur assistant plus bas ; Proxmox… viendra ensuite.
import { ChevronDown, ChevronRight, Database, DatabaseBackup, FolderSearch, HardDrive, Home, Loader2, ServerCog, Trash2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine, Switch, TagInput } from "../components/form";
import { Badge, Card, Count, Dim } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { appIcon } from "../lib/appIcons";
import { BackupsHa, type HaState } from "./BackupsHa";
import { BackupsVeeam, type VeeamState } from "./BackupsVeeam";
import { BackupsPbs, type PbsState } from "./BackupsPbs";
import { MachineIcon } from "../components/MachineIcon";
import type { Machine } from "../types";
import { CopyGuesses, SetCopies, type CopyRow, type SshMachine } from "./BackupsCopies";

interface SetRow { id: string; label: string; origin: string; origin_ip?: string | null; path: string | null; veeam_job: string | null; pbs_group: string | null; max_age_days: number; ha: boolean; editable: boolean; expect_offsite: boolean; copies?: CopyRow[]; cadence_days?: number | null }
const AGES = [2, 8, 15, 31];   // paliers proposés : quotidienne, hebdomadaire, tous les 15 jours, mensuelle
interface Current { sets: SetRow[]; exists: boolean; tab: boolean; patterns: string[]; default_path: string; machines: number; ssh_machines?: SshMachine[]; veeam: VeeamState; ha: HaState; pbs: PbsState }
interface Folder { path: string; size: number | null; newest: number | null; newest_name: string; readable: boolean; followed: boolean; default?: boolean }
interface Found { ip: string; name: string; ssh: string; ok: boolean; error: string; folders: Folder[] }
interface Choice { on: boolean; label: string; age: string }

/** Origine d'un jeu suivi : icône (logo ou pictogramme) et nom court */
const SRC: Record<"folder" | "veeam" | "pbs" | "ha", { icon: string; Icon: LucideIcon; label: string }> = {
  folder: { icon: "", Icon: FolderSearch, label: tx("Dossier") }, veeam: { icon: "Veeam", Icon: ServerCog, label: "Veeam" },
  pbs: { icon: "Proxmox Backup Server", Icon: DatabaseBackup, label: "Proxmox Backup" }, ha: { icon: "Home Assistant", Icon: Home, label: "Home Assistant" },
};

const keyOf = (ip: string, path: string) => `${ip}${path}`;

/** Custom threshold: a « … j » pill that opens a number field (0.1 to 365 days), saved on Enter or when leaving the field */
function CustomAge({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (d: number) => void }) {
  const custom = !AGES.includes(value);
  const [edit, setEdit] = useState(false), [v, setV] = useState(String(value));
  const ok = Number(v) >= 0.1 && Number(v) <= 365;
  const save = () => { setEdit(false); if (ok && Number(v) !== value) onSave(Number(v)); };
  if (edit)
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus type="number" min={0.1} max={365} step="any" value={v} aria-label={tx("Seuil d'alerte en jours")}
          className={`${input.replace("w-full", "w-20")} py-0.5 text-xs ${ok ? "" : "border-bad"}`} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEdit(false); setV(String(value)); } }} onBlur={save} />{tx("j")}
      </span>
    );
  return (
    <button type="button" disabled={disabled} aria-pressed={custom} onClick={() => { setV(String(value)); setEdit(true); }} title={tx("Seuil personnalisé, en jours")}
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${custom ? "border-link bg-link/15 text-txt" : "border-dashed border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
      {custom ? `${value} ${tx("j")}` : tx("autre…")}
    </button>
  );
}

export function BackupsSettings({ machines = [] }: { machines?: Machine[] }) {
  const machineOf = (ip?: string | null) => machines.find((m) => m.ip === ip);
  const [cur, setCur] = useState<Current | null>(null), [error, setError] = useState("");
  const [found, setFound] = useState<Found[] | null>(null), [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(""), [busyId, setBusyId] = useState("");
  const [open, setOpen] = useState("");   // source dépliée (un seul cadre à la fois)
  const [extra, setExtra] = useState<string | null>(null);  // emplacements cherchés en plus du dossier par défaut (null = ceux du serveur)
  const load = useCallback(() => {
    read<Current>("backups/settings").then((c) => { setCur(c); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(load, [load]);

  const search = async () => {
    setSearching(true); setNote(null);
    try {
      const r = await send<{ machines: Found[] }>("POST", "backups/discover");
      setFound(r.machines);
      const next: Record<string, Choice> = {};
      for (const m of r.machines) for (const f of m.folders)
        if (!f.followed) next[keyOf(m.ip, f.path)] = { on: !!f.default && f.readable, label: `${m.name} : ${f.path}`, age: "2" };  // trouvé au chemin par défaut : déjà coché, il reste à valider
      setPick(next);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setSearching(false);
  };
  const change = async (id: string, body: { max_age_days?: number; expect_offsite?: boolean }) => {
    setBusyId(id);
    await act(() => send("PATCH", `backups/settings/${id}`, body), tx("jeu modifié : relevé en cours"), setNote);
    setBusyId(""); load();
  };
  const chosen = Object.entries(pick).filter(([, c]) => c.on);
  const valid = chosen.length > 0 && chosen.every(([, c]) => c.label.trim() && Number(c.age) >= 0.1 && Number(c.age) <= 365);
  const follow = async () => {
    setBusy(true);
    const items = chosen.map(([k, c]) => {
      const m = (found ?? []).find((x) => k.startsWith(`${x.ip}/`))!;
      return { ip: m.ip, path: k.slice(m.ip.length), label: c.label.trim(), max_age_days: Number(c.age) };
    });
    const ok = await act(() => send("PUT", "backups/settings", { items }), tx("{0} dossier(s) suivi(s) : premier relevé en cours, l'onglet Sauvegardes apparaît ensuite", items.length), setNote);
    setBusy(false);
    if (ok) { setFound(null); setPick({}); load(); }
  };

  const extras = extra ?? (cur?.patterns ?? []).filter((p) => p !== cur?.default_path).join(", ");
  const savePatterns = async () => {
    setBusy(true);
    const ok = await act(() => send("PUT", "backups/patterns", { patterns: extras.split(",").map((p) => p.trim()).filter(Boolean) }), tx("emplacements enregistrés"), setNote);
    setBusy(false);
    if (ok) { setExtra(null); setFound(null); load(); }
  };

  if (!cur) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const SEARCH = (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><FolderSearch size={16} />{tx("Chercher sur mes machines")}</h2>
        <button type="button" className={primary} disabled={searching || cur.machines === 0} onClick={() => void search()}>
          {searching ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FolderSearch size={14} aria-hidden />}{searching ? tx("Recherche…") : tx("Chercher")}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {cur.machines === 0 ? tx("Aucune machine n'est lue par SSH : activez l'accès SSH d'une machine (Réglages → Machines) pour y chercher des sauvegardes.")
          : tx("Cherche, sur les {0} machine(s) lues par SSH, les dossiers de sauvegarde habituels :", cur.machines)} {cur.machines > 0 && <code className="font-mono text-xs">{cur.patterns.join("  ")}</code>}
      </p>
      <div className="mt-3 rounded-lg bg-bg2/50 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-sm"><b>{tx("Dossier par défaut")}</b><code className="font-mono text-xs">{cur.default_path}</code>
          <Dim>{tx("toujours cherché ; s'il existe sur une machine, il est coché d'office.")}</Dim></div>
        <TagInput label={tx("Autres emplacements")} value={extras} onChange={setExtra} max={800} placeholder={tx("ex. /srv/sauvegardes, /mnt/*/save*")} />
        <p className="mt-1 text-xs text-dim">{tx("Un chemin absolu ; * permis (un motif). Entrée ou virgule pour en ajouter.")}</p>
        {extra !== null && <button type="button" className={`${primary} mt-2`} disabled={busy} onClick={() => void savePatterns()}>{tx("Enregistrer les emplacements")}</button>}
      </div>
      {searching && <p className="mt-2 text-sm text-dim">{tx("Lecture des dossiers en cours (taille et fichier le plus récent) : jusqu'à une minute.")}</p>}
      {found && (
        <div className="mt-3 flex flex-col gap-3">
          {found.every((m) => m.ok && m.folders.length === 0) && (
            <p className="rounded-lg bg-bg2/60 px-3 py-2 text-sm text-muted">{tx("Aucun dossier de sauvegarde trouvé dans ces emplacements. Si vos sauvegardes sont ailleurs, ajoutez leur dossier dans « Autres emplacements » puis relancez la recherche.")}</p>
          )}
          {found.map((m) => (
            <section key={m.ip} className="overflow-hidden rounded-xl border border-line">
              <h3 className="flex items-center gap-2 border-b border-line bg-bg px-3 py-2 text-sm font-semibold">
                {machineOf(m.ip) && <MachineIcon m={machineOf(m.ip)!} reserve />}{m.name} <Dim>{m.ip}</Dim>
                {!m.ok && <Badge tone="bad">{tx("illisible")}</Badge>}</h3>
              <div className="p-3">
              {!m.ok && <p className="text-xs text-bad">{m.error}</p>}
              {m.ok && m.folders.length === 0 && <Dim>{tx("aucun dossier trouvé")}</Dim>}
              <ul className="flex flex-col gap-2">
                {m.folders.map((f) => {
                  const k = keyOf(m.ip, f.path), c = pick[k];
                  return (
                    <li key={k} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg2/50 px-3 py-2 text-sm ${f.followed ? "opacity-60" : ""}`}>
                      <label className="flex min-w-[220px] flex-1 items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--link))]" disabled={f.followed || !f.readable} checked={!!c?.on}
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
            </section>
          ))}
          {Object.keys(pick).length > 0 && (
            <div><button type="button" className={primary} disabled={!valid || busy} onClick={() => void follow()}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{tx("Suivre la sélection")} {chosen.length > 0 && `(${chosen.length})`}</button></div>
          )}
        </div>
      )}
      <NoteLine note={note} />
    </Card>
  );
  const veeamSets = cur.sets.filter((x) => x.veeam_job).length, folderSets = cur.sets.filter((x) => x.path).length;
  const sources: { id: string; label: string; icon: string; Icon: LucideIcon; hint: string; state: string; tone: "ok" | "warn"; panel: ReactNode }[] = [
    { id: "folders", label: tx("Dossiers sur mes machines"), icon: "", Icon: FolderSearch, tone: folderSets ? "ok" : "warn", state: folderSets ? tx("{0} suivi(s)", folderSets) : tx("À chercher"),
      hint: tx("Lus par SSH : dossiers de sauvegarde, tâches cron"), panel: SEARCH },
    { id: "veeam", label: "Veeam Backup & Replication", icon: "Veeam", Icon: ServerCog, tone: veeamSets ? "ok" : "warn", state: veeamSets ? tx("{0} job(s) suivi(s)", veeamSets) : cur.veeam.configured ? tx("Aucun job suivi") : tx("À configurer"),
      hint: tx("API REST, compte en lecture seule"), panel: <BackupsVeeam key={`${cur.veeam.url}|${cur.veeam.user}`} state={cur.veeam} reload={load} /> },
    { id: "pbs", label: "Proxmox Backup Server", icon: "Proxmox Backup Server", Icon: DatabaseBackup, tone: cur.pbs.followed ? "ok" : "warn", state: cur.pbs.followed ? tx("{0} groupe(s) suivi(s)", cur.pbs.followed) : cur.pbs.connectors.length ? tx("Aucun groupe suivi") : tx("Connecteur à ajouter"),
      hint: tx("Groupes de sauvegarde, par le connecteur"), panel: <BackupsPbs state={cur.pbs} reload={load} /> },
    { id: "ha", label: "Home Assistant", icon: "Home Assistant", Icon: Home, tone: cur.ha.followed ? "ok" : "warn", state: cur.ha.followed ? tx("Suivi") : cur.ha.connectors.length ? tx("Pas suivi") : tx("Connecteur à ajouter"),
      hint: tx("Sauvegarde automatique, par le connecteur"), panel: <BackupsHa key={`${cur.ha.connector}|${cur.ha.connectors.join()}`} state={cur.ha} reload={load} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><HardDrive size={16} />{tx("Sauvegardes suivies")} <Count n={cur.sets.length} /></h2>
        <p className="mb-3 text-sm text-muted">
          {tx("MyServices regarde l'âge du fichier le plus récent de chaque dossier et vous prévient s'il est trop vieux. Lecture seule : rien n'est modifié sur les machines.")}
        </p>
        {folderSets > 0 && cur.machines > 0 && <CopyGuesses onDone={load} setNote={setNote} />}
        {cur.sets.length === 0 ? <Dim>{tx("Aucune sauvegarde suivie pour l'instant.")}</Dim> : (
          <ul className="flex flex-col gap-2">
            {cur.sets.map((s) => {
              const kind = s.veeam_job ? SRC.veeam : s.pbs_group ? SRC.pbs : s.ha ? SRC.ha : SRC.folder;
              return (
                <li key={s.id} className="overflow-hidden rounded-xl border border-line bg-bg2/30 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-bg px-3 py-2">
                    {machineOf(s.origin_ip)
                      ? <MachineIcon m={machineOf(s.origin_ip)!} reserve empty={<span className="grid h-6 w-6 place-items-center rounded-md bg-bg2"><kind.Icon size={14} className="text-muted" aria-hidden /></span>} />
                      : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2">
                          {appIcon([kind.icon]) ? <img src={appIcon([kind.icon])!} alt="" className="h-4 w-4" /> : <kind.Icon size={14} className="text-muted" aria-hidden />}
                        </span>}
                    <div className="min-w-[200px] flex-1">
                      <b className="block truncate">{s.label}</b>
                      {(() => {   // what is followed, unless the name already says it (« Dev : /home/backup »)
                        const what = s.path ?? s.veeam_job ?? s.pbs_group ?? (s.ha ? tx("sauvegarde automatique") : "—");
                        return s.label.includes(what) ? null : <span className="block truncate font-mono text-xs text-dim">{what}</span>;
                      })()}
                    </div>
                    <Badge tone="info">{kind.label}</Badge>
                    {confirm === s.id ? <>
                      <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `backups/settings/${s.id}`), tx("sauvegarde retirée"), setNote).then((ok) => { if (ok) { setConfirm(""); load(); } })}>{tx("Confirmer le retrait")}</button>
                      <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
                    </> : <button type="button" className={quiet} onClick={() => setConfirm(s.id)} aria-label={tx("Ne plus suivre {0}", s.label)}><Trash2 size={14} />{tx("Retirer")}</button>}
                  </div>
                  <div className="px-3 pb-2.5">
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-dim" title={tx("Sauvegarde quotidienne : 2 j ; hebdomadaire : 8 j. Au-delà du double, le jeu devient critique.")}>{tx("alerte après")}
                      {AGES.map((d) => (
                        <button key={d} type="button" aria-pressed={s.max_age_days === d} disabled={s.id === busyId} onClick={() => void change(s.id, { max_age_days: d })}
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${s.max_age_days === d ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>{d} {tx("j")}</button>
                      ))}
                      <CustomAge value={s.max_age_days} disabled={s.id === busyId} onSave={(d) => void change(s.id, { max_age_days: d })} />
                      {(() => {   // observed rhythm slower than the threshold: one click sets the advised one
                        const advised = s.cadence_days ? AGES.find((d) => d >= s.cadence_days! * 1.25) ?? AGES[AGES.length - 1] : null;
                        return advised && advised > s.max_age_days ? (
                          <button type="button" disabled={s.id === busyId} onClick={() => void change(s.id, { max_age_days: advised })}
                            className="rounded-full border border-warn/60 bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn hover:bg-warn/20"
                            title={tx("Les archives arrivent environ tous les {0} j : avec un seuil de {1} j, le jeu est en alerte entre deux passages.", s.cadence_days, s.max_age_days)}>
                            {tx("rythme observé ~{0} j : passer à {1} j", s.cadence_days, advised)}</button>
                        ) : null;
                      })()}
                    </span>
                    {!s.ha && !s.veeam_job && !s.pbs_group && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-dim" title={tx("Activé : une copie à jour sur une autre machine est exigée (sinon le jeu est critique). Désactivé : seule la source est surveillée.")}>
                        <Switch on={s.expect_offsite} label={tx("Exiger une copie hors machine")} disabled={s.id === busyId} onChange={(on) => void change(s.id, { expect_offsite: on })} />{tx("copie hors machine exigée")}
                      </span>
                    )}
                  </div>
                  </div>
                  {s.path && <div className="px-3 pb-2.5"><SetCopies setId={s.id} origin={s.origin} copies={s.copies ?? []} machines={cur.ssh_machines ?? []} found={found} busy={s.id === busyId} onDone={load} setNote={setNote} /></div>}
                </li>
              );
            })}
          </ul>
        )}
        <NoteLine note={note} />
      </Card>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><Database size={16} />{tx("Sources de sauvegarde")}</h2>
        <p className="mb-3 text-sm text-muted">{tx("D'où viennent les sauvegardes à surveiller. Cliquez sur une source : ses champs à remplir se déplient.")}</p>
        <ul className="flex flex-col gap-2">
          {sources.map((x) => {
            const on = open === x.id;
            return (
              <li key={x.id} className={`rounded-xl border bg-bg2/30 ${on ? "border-link/60" : x.tone === "warn" ? "border-warn/60 bg-warn/10" : "border-line"}`}>
                <button type="button" onClick={() => setOpen(on ? "" : x.id)} aria-expanded={on} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left">
                  {on ? <ChevronDown size={16} className="shrink-0 text-txt" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-txt" aria-hidden />}
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2">
                    {appIcon([x.icon]) ? <img src={appIcon([x.icon])!} alt="" className="h-4 w-4" /> : <x.Icon size={14} className="text-muted" aria-hidden />}
                  </span>
                  <b className="min-w-[160px]">{x.label}</b>
                  <span className="min-w-0 flex-1 text-xs text-dim">{x.hint}</span>
                  <Badge tone={x.tone}>{x.state}</Badge>
                </button>
                {on && <div className="px-3 pb-3 [&_h2]:hidden [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 [&>section]:shadow-none">{x.panel}</div>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
