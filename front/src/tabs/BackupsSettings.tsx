// Réglages → Sauvegardes : choisir, depuis la page, les dossiers de sauvegarde à surveiller. La recherche passe par SSH, en lecture
// seule, dans les emplacements habituels de chaque machine ; on coche, on nomme, on fixe l'âge maximum du dernier fichier.
// Veeam (BackupsVeeam.tsx) et Home Assistant (BackupsHa.tsx) ont leur assistant plus bas ; Proxmox… viendra ensuite.
import { FolderSearch, HardDrive, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine, Switch, TagInput } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { BackupsHa, type HaState } from "./BackupsHa";
import { BackupsVeeam, type VeeamState } from "./BackupsVeeam";

interface SetRow { id: string; label: string; origin: string; path: string | null; veeam_job: string | null; max_age_days: number; ha: boolean; editable: boolean; expect_offsite: boolean }
const AGES = [2, 8, 15, 31];   // paliers proposés : quotidienne, hebdomadaire, tous les 15 jours, mensuelle
interface Current { sets: SetRow[]; exists: boolean; tab: boolean; patterns: string[]; default_path: string; machines: number; veeam: VeeamState; ha: HaState }
interface Folder { path: string; size: number | null; newest: number | null; newest_name: string; readable: boolean; followed: boolean; default?: boolean }
interface Found { ip: string; name: string; ssh: string; ok: boolean; error: string; folders: Folder[] }
interface Choice { on: boolean; label: string; age: string }

const keyOf = (ip: string, path: string) => `${ip}${path}`;

export function BackupsSettings() {
  const [cur, setCur] = useState<Current | null>(null), [error, setError] = useState("");
  const [found, setFound] = useState<Found[] | null>(null), [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(""), [busyId, setBusyId] = useState("");
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
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><HardDrive size={16} />{tx("Sauvegardes suivies")} <Dim>· {cur.sets.length}</Dim></h2>
        <p className="mb-3 text-sm text-muted">
          {tx("MyServices regarde l'âge du fichier le plus récent de chaque dossier et vous prévient s'il est trop vieux. Lecture seule : rien n'est modifié sur les machines.")}
        </p>
        {cur.sets.length === 0 ? <Dim>{tx("Aucune sauvegarde suivie pour l'instant.")}</Dim> : (
          <ul className="flex flex-col divide-y divide-line/60">
            {cur.sets.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <div className="min-w-[200px] flex-1">
                  <b>{s.label}</b>
                  <div className="font-mono text-xs text-dim">{s.path ?? (s.veeam_job ? `Veeam : ${s.veeam_job}` : s.ha ? "Home Assistant" : "—")}</div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-dim" title={tx("Sauvegarde quotidienne : 2 j ; hebdomadaire : 8 j. Au-delà du double, le jeu devient critique.")}>{tx("alerte après")}
                    {AGES.map((d) => (
                      <button key={d} type="button" aria-pressed={s.max_age_days === d} disabled={s.id === busyId} onClick={() => void change(s.id, { max_age_days: d })}
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${s.max_age_days === d ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>{d} {tx("j")}</button>
                    ))}
                    {!AGES.includes(s.max_age_days) && <Badge tone="info">{s.max_age_days} {tx("j")}</Badge>}
                  </span>
                  {!s.ha && !s.veeam_job && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-dim" title={tx("Activé : une copie à jour sur une autre machine est exigée (sinon le jeu est critique). Désactivé : seule la source est surveillée.")}>
                      <Switch on={s.expect_offsite} label={tx("Exiger une copie hors machine")} disabled={s.id === busyId} onChange={(on) => void change(s.id, { expect_offsite: on })} />{tx("copie hors machine exigée")}
                    </span>
                  )}
                </div>
                {confirm === s.id ? <>
                  <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `backups/settings/${s.id}`), tx("sauvegarde retirée"), setNote).then((ok) => { if (ok) { setConfirm(""); load(); } })}>{tx("Confirmer le retrait")}</button>
                  <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
                </> : <button type="button" className={quiet} onClick={() => setConfirm(s.id)} aria-label={tx("Ne plus suivre {0}", s.label)}><Trash2 size={14} />{tx("Retirer")}</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

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
              <section key={m.ip} className="rounded-xl border border-line/60 p-3">
                <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">{m.name} <Dim>{m.ip}</Dim>
                  {!m.ok && <Badge tone="bad">{tx("illisible")}</Badge>}</h3>
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

      <BackupsVeeam key={`${cur.veeam.url}|${cur.veeam.user}`} state={cur.veeam} reload={load} />
      <BackupsHa key={`${cur.ha.connector}|${cur.ha.connectors.join()}`} state={cur.ha} reload={load} />
    </div>
  );
}
