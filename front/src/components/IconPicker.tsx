// Choix de l'icône d'une machine : seule l'icône utilisée est affichée ; un clic ouvre le panneau (recherche + trois familles).
import { ChevronDown, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { read, send } from "../api";
import { MACHINE_ICONS, chosenIcon, customIcon, rememberCustomLabels, type ChosenIcon } from "../lib/machineIcons";
import { ICON_TYPES, iconData } from "../lib/iconImport";
import { NoteLine } from "./form";
import { act, danger, quiet, type Note } from "../lib/forms";
import { searchHit } from "../lib/filter";
import { tx } from "../lib/i18n";
import { input } from "../lib/forms";

const FAMILIES: [ChosenIcon["family"], string][] = [["app", tx("Applis et services")], ["system", tx("Systèmes")], ["object", tx("Objets")]];

export function IconGlyph({ icon, size = 20 }: { icon: ChosenIcon; size?: number }) {
  if ("url" in icon) return <img src={icon.url} alt="" style={{ width: size, height: size, objectFit: "contain" }} />;
  return "file" in icon
    ? <img src={`${import.meta.env.BASE_URL}icons/${icon.file}.svg`} alt="" style={{ width: size, height: size }} />
    : <icon.Icon size={size - 3} className="text-muted" aria-hidden />;
}

export function IconPicker({ value, onPick, disabled, autoHint, auto }: {
  value?: string | null; onPick: (key: string | undefined) => void; disabled?: boolean; autoHint: string;
  /** aperçu de l'icône automatique (celle que la détection choisit), montré tant qu'aucune icône n'est choisie */
  auto?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false), [q, setQ] = useState("");
  const current = chosenIcon(value);
  const shown = useMemo(() => MACHINE_ICONS.filter((i) => searchHit(`${i.label} ${i.key}`, q)), [q]);
  const pick = (key?: string) => { onPick(key); setOpen(false); setQ(""); };

  // « Mes icônes »: images imported by the user (PNG, JPEG, WebP, GIF, SVG), kept by the server and shared by every machine and service
  const [mine, setMine] = useState<{ key: string; label: string }[]>([]), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null), file = useRef<HTMLInputElement>(null);
  const loadMine = () => read<{ icons: { key: string; label: string }[] }>("icons").then((r) => { rememberCustomLabels(r.icons); setMine(r.icons); }).catch(() => undefined);
  useEffect(() => { if (open) { setNote(null); setAsking(null); void loadMine(); } }, [open]);
  const mineShown = useMemo(() => mine.filter((i) => searchHit(i.label, q)), [mine, q]);
  const importFile = async (f?: File) => {
    if (!f) return;
    setBusy(true); setNote(null);
    let key = "";
    const ok = await act(async () => { key = (await send<{ key: string }>("POST", "icons", { image: await iconData(f), name: f.name })).key; }, tx("icône importée"), setNote);
    setBusy(false);
    if (file.current) file.current.value = "";
    if (ok) { void loadMine(); pick(key); }
  };
  const drop = async (key: string) => {
    setBusy(true);
    const ok = await act(() => send("DELETE", `icons/${key}`), tx("icône supprimée"), setNote);
    setBusy(false); setAsking(null);
    if (ok) void loadMine();
  };
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} disabled={disabled} title={tx("Changer l'icône")}
        className="inline-flex items-center gap-2.5 rounded-lg border border-line bg-bg2/60 py-1.5 pl-2 pr-2.5 text-sm hover:border-link disabled:opacity-60">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-card">{current ? <IconGlyph icon={current} size={22} /> : auto ?? <span className="text-xs font-semibold text-dim">{tx("Auto")}</span>}</span>
        <span className="flex flex-col items-start leading-tight"><b className="font-semibold">{current ? current.label : tx("Automatique")}</b>
          <span className="text-xs text-dim">{current ? tx("choisie à la main") : autoHint}</span></span>
        <ChevronDown size={14} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-card p-3 shadow-lg shadow-black/20">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input className={`${input} w-56`} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Chercher : Debian, NAS, caméra…")} aria-label={tx("Chercher une icône")} />
            <button type="button" onClick={() => pick(undefined)} aria-pressed={!value}
              className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold ${!value ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>{tx("Automatique")}</button>
            <span className="text-xs text-dim">{shown.length} {tx("icônes")}</span>
          </div>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1" role="radiogroup" aria-label={tx("Icône de la machine")}>
            {FAMILIES.map(([fam, name]) => {
              const list = shown.filter((i) => i.family === fam);
              return list.length ? (
                <div key={fam}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((i) => (
                      <button key={i.key} type="button" role="radio" aria-checked={value === i.key} aria-label={i.label} title={i.label} onClick={() => pick(i.key)}
                        className={`grid h-9 w-9 place-items-center rounded-lg border ${value === i.key ? "border-link bg-link/15" : "border-line hover:border-link"}`}><IconGlyph icon={i} /></button>
                    ))}
                  </div>
                </div>
              ) : null;
            })}
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Mes icônes")}</span>
                <button type="button" className={`${quiet} ml-auto`} disabled={busy} onClick={() => file.current?.click()}><Upload size={14} aria-hidden />{busy ? tx("Envoi…") : tx("Importer une image ou un SVG")}</button>
                <input ref={file} type="file" accept={ICON_TYPES} className="hidden" aria-label={tx("Importer une image ou un SVG")} onChange={(e) => void importFile(e.target.files?.[0])} />
              </div>
              {mine.length === 0 && <p className="text-xs text-dim">{tx("Aucune icône importée : PNG, JPEG, WebP, GIF ou SVG, 512 Ko au plus.")}</p>}
              <div className="flex flex-wrap gap-1.5">
                {mineShown.map((i) => (
                  <span key={i.key} className="relative">
                    <button type="button" role="radio" aria-checked={value === i.key} aria-label={i.label} title={i.label} onClick={() => pick(i.key)}
                      className={`grid h-9 w-9 place-items-center rounded-lg border ${value === i.key ? "border-link bg-link/15" : "border-line hover:border-link"}`}><IconGlyph icon={customIcon(i.key, i.label)!} /></button>
                    <button type="button" aria-label={`${tx("Supprimer")} ${i.label}`} title={tx("Supprimer cette icône")} onClick={() => setAsking(i.key)}
                      className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border border-line bg-card text-dim hover:border-bad hover:text-bad"><Trash2 size={9} aria-hidden /></button>
                  </span>
                ))}
              </div>
              {asking && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{tx("Supprimer cette icône pour toutes les machines et services ?")}</span>
                  <button type="button" className={danger} disabled={busy} onClick={() => void drop(asking)}>{tx("Confirmer")}</button>
                  <button type="button" className={quiet} onClick={() => setAsking(null)}>{tx("Annuler")}</button>
                </div>
              )}
              <NoteLine note={note} />
            </div>
            {shown.length === 0 && mineShown.length === 0 && <p className="text-sm text-muted">{tx("Aucune icône pour cette recherche.")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
