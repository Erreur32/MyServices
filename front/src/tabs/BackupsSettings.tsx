// Réglages → Sauvegardes : choisir, depuis la page, les dossiers de sauvegarde à surveiller. La recherche passe par SSH, en lecture
// seule, dans les emplacements habituels de chaque machine ; on coche, on nomme, on fixe l'âge maximum du dernier fichier.
// Veeam, Home Assistant, Proxmox… viennent ensuite (leurs jeux déjà décrits sont gardés et listés ici).
import { FolderSearch, HardDrive, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime } from "../lib/format";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

interface SetRow { id: string; label: string; origin: string; path: string | null; veeam_job: string | null; max_age_days: number; editable: boolean }
interface Current { sets: SetRow[]; exists: boolean; tab: boolean; patterns: string[]; machines: number }
interface Folder { path: string; size: number | null; newest: number | null; newest_name: string; readable: boolean; followed: boolean }
interface Found { ip: string; name: string; ssh: string; ok: boolean; error: string; folders: Folder[] }
interface Choice { on: boolean; label: string; age: string }

const keyOf = (ip: string, path: string) => `${ip}${path}`;

export function BackupsSettings() {
  const [cur, setCur] = useState<Current | null>(null), [error, setError] = useState("");
  const [found, setFound] = useState<Found[] | null>(null), [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState("");
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
        if (!f.followed) next[keyOf(m.ip, f.path)] = { on: false, label: `${m.name} : ${f.path}`, age: "2" };
      setPick(next);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setSearching(false);
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
                  <div className="font-mono text-xs text-dim">{s.path ?? (s.veeam_job ? `Veeam : ${s.veeam_job}` : "—")}</div>
                </div>
                <Badge tone="off">{tx("alerte après {0} j", s.max_age_days)}</Badge>
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
        {searching && <p className="mt-2 text-sm text-dim">{tx("Lecture des dossiers en cours (taille et fichier le plus récent) : jusqu'à une minute.")}</p>}
        {found && (
          <div className="mt-3 flex flex-col gap-3">
            {found.every((m) => m.ok && m.folders.length === 0) && (
              <p className="rounded-lg bg-bg2/60 px-3 py-2 text-sm text-muted">{tx("Aucun dossier de sauvegarde trouvé dans ces emplacements. Si vos sauvegardes sont ailleurs, un prochain réglage permettra d'indiquer le dossier.")}</p>
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
    </div>
  );
}
