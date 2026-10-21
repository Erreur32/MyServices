// The « Edit » window of a service (pencil in the Services list and in the detail): category (one of the existing ones), description, tags,
// kind of interface, public on purpose, direct access on purpose, pause. Written in services-meta.json by PUT services/meta; the page follows at once.
import { Globe, Pause, Plug, Save, Unplug, Webhook } from "lucide-react";
import { useEffect, useState, type SyntheticEvent } from "react";
import { read, send } from "../api";
import { tx } from "../lib/i18n";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import type { Host } from "../types";
import { Field, NoteLine, TagInput } from "./form";
import { IconChoice, type IconOption } from "./IconChoice";
import { Overlay } from "./Overlay";

type Web = "auto" | "ui" | "api" | "none";
const WEB: IconOption<Web>[] = [
  { value: "auto", label: tx("Automatique"), hint: tx("ce que la détection trouve"), icon: <Plug size={22} className="text-dim" aria-hidden /> },
  { value: "ui", label: tx("Page web"), hint: tx("une interface à ouvrir"), icon: <Globe size={22} className="text-link" aria-hidden /> },
  { value: "api", label: "API", hint: tx("répond, sans page"), icon: <Webhook size={22} className="text-link" aria-hidden /> },
  { value: "none", label: tx("Pas de web"), hint: tx("un port, sans HTTP"), icon: <Unplug size={22} className="text-dim" aria-hidden /> },
];

const AUTO = "";   // the « Automatic » category: the rules choose
interface MetaDoc { key: string | null; entry: { category?: string; description?: string; tags?: string[]; web?: Exclude<Web, "auto">; public?: boolean; direct_ok?: boolean; pause?: string }; categories: string[] }

export function ServiceEdit({ r, name, onClose }: Readonly<{ r: Host; name: string; onClose: () => void }>) {
  const [cats, setCats] = useState<string[] | null>(null), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [category, setCategory] = useState(AUTO), [description, setDescription] = useState(""), [tags, setTags] = useState("");
  const [web, setWeb] = useState<Web>("auto"), [pub, setPub] = useState(false), [direct, setDirect] = useState(false), [pause, setPause] = useState(false);
  useEffect(() => {   // the form starts from what is set by hand (services-meta.json), not from what the detection shows: « Automatic » stays automatic
    read<MetaDoc>(`services/meta?type=${encodeURIComponent(r.type)}&id=${encodeURIComponent(String(r.id))}`).then((d) => {
      const e = d.entry;
      setCats(d.categories);
      setCategory(e.category && d.categories.includes(e.category) ? e.category : AUTO);
      setDescription(e.description ?? ""); setTags((e.tags ?? []).join(", ")); setWeb(e.web ?? "auto");
      setPub(!!e.public); setDirect(!!e.direct_ok); setPause(!!e.pause);
    }).catch((err) => { setCats([]); setNote({ ok: false, text: (err as Error).message }); });
  }, [r.type, r.id]);
  const npmOpen = r.type === "proxy" && !r.acl && !r.acl_adv;   // « public on purpose » only means something for an NPM host without protection
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", "services/meta", {
      type: r.type, id: String(r.id), category: category || null, description, tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      web: web === "auto" ? null : web, public: npmOpen && pub, direct_ok: direct, pause,
    }), tx("enregistré"), setNote);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Overlay medium onClose={onClose} title={<>{tx("Modifier")} {name}</>}>
      <form className="mt-3 flex flex-col gap-4" onSubmit={(e) => void save(e)}>
        <Field label={tx("Catégorie")}>
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)} disabled={!cats}>
            <option value={AUTO}>{tx("Automatique (d'après les règles)")}{r.category ? ` : ${r.category}` : ""}</option>
            {(cats ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={tx("Description")}>
          <textarea className={`${input} min-h-[3.5rem]`} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={r.description ?? r.service?.description ?? tx("celle de la détection")} />
        </Field>
        <TagInput label={tx("Étiquettes")} value={tags} onChange={setTags} max={300} placeholder={tx("Entrée ou virgule pour ajouter")} />
        <div className="flex flex-col gap-1 text-sm text-muted">
          <span>{tx("Interface")}</span>
          <IconChoice label={tx("Interface")} value={web} options={WEB} onPick={setWeb} />
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {npmOpen && <Check on={pub} set={setPub} label={tx("Site public voulu")} hint={tx("Ouvert à Internet volontairement : plus de « ⚠ public ? »")} icon={<Globe size={14} aria-hidden />} />}
          <Check on={direct} set={setDirect} label={tx("Accès direct voulu")} hint={tx("Interface ouverte hors NPM volontairement : pas comptée comme un accès à protéger")} icon={<Plug size={14} aria-hidden />} />
          <Check on={pause} set={setPause} label={tx("En pause")} hint={tx("Ni sonde ni alerte, toujours listé")} icon={<Pause size={14} aria-hidden />} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/60 pt-3">
          <span className="mr-auto text-xs text-dim">{tx("Enregistré dans services-meta.json, la page suit tout de suite.")}</span>
          <NoteLine note={note} />
          <button type="button" className={quiet} onClick={onClose}>{tx("Annuler")}</button>
          <button type="submit" className={primary} disabled={busy}><Save size={14} aria-hidden />{tx("Enregistrer")}</button>
        </div>
      </form>
    </Overlay>
  );
}

function Check({ on, set, label, hint, icon }: Readonly<{ on: boolean; set: (v: boolean) => void; label: string; hint: string; icon: React.ReactNode }>) {
  return (
    <label className="flex cursor-pointer items-start gap-2" aria-label={label}>
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => set(e.target.checked)} aria-label={label} />
      <span><span className="inline-flex items-center gap-1.5 font-semibold text-txt">{icon}{label}</span><span className="block text-xs text-dim">{hint}</span></span>
    </label>
  );
}
