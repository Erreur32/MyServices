// A service's sheet in editing, under its row in the card: the same three blocks as in reading, each value that can be set becomes its field, in place,
// with where it comes from and « Reset ». Written in services-meta.json by PUT services/meta; the page follows at once.
import { Bell, BellOff, BellRing, Globe, Pause, Plug, RotateCcw, Save, Unplug, Webhook } from "lucide-react";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { read, send } from "../api";
import { tx } from "../lib/i18n";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { autoUrl, detectedName } from "../lib/status";
import type { Host } from "../types";
import { BlockFrame, Src } from "../tabs/ServiceDetail";
import { NoteLine, TagInput } from "./form";
import { IconChoice, type IconOption } from "./IconChoice";
import { IconPicker } from "./IconPicker";
import { InfoNote } from "./InfoNote";

type Web = "auto" | "ui" | "api" | "none";
const WEB: IconOption<Web>[] = [
  { value: "auto", label: tx("Automatique"), hint: tx("ce que la détection trouve"), icon: <Plug size={22} className="text-dim" aria-hidden /> },
  { value: "ui", label: tx("Page web"), hint: tx("une interface à ouvrir"), icon: <Globe size={22} className="text-link" aria-hidden /> },
  { value: "api", label: "API", hint: tx("répond, sans page"), icon: <Webhook size={22} className="text-link" aria-hidden /> },
  { value: "none", label: tx("Pas de web"), hint: tx("un port, sans HTTP"), icon: <Unplug size={22} className="text-dim" aria-hidden /> },
];
type Alerts = "all" | "down" | "none";
const ALERTS: IconOption<Alerts>[] = [
  { value: "all", label: tx("Toutes"), hint: tx("panne, certificat, sécurité"), icon: <BellRing size={22} className="text-link" aria-hidden /> },
  { value: "down", label: tx("Panne seulement"), hint: tx("panne et retour"), icon: <Bell size={22} className="text-warn" aria-hidden /> },
  { value: "none", label: tx("Aucune"), hint: tx("aucune notification"), icon: <BellOff size={22} className="text-dim" aria-hidden /> },
];

const AUTO = "";   // « Automatic »: the detection or the rules choose
interface Entry {
  name?: string; icon?: string; category?: string; description?: string; tags?: string[]; app?: string; web?: Exclude<Web, "auto">; open_url?: string;
  public?: boolean; direct_ok?: boolean; pause?: string; alerts?: Exclude<Alerts, "all">;
}
interface MetaDoc { key: string | null; entry: Entry; categories: string[]; apps: { key: string; label: string }[] }
interface Form {
  name: string; icon: string; category: string; description: string; tags: string; app: string; web: Web; open_url: string;
  public: boolean; direct_ok: boolean; pause: boolean; alerts: Alerts;
}

/** The form from what is set by hand (services-meta.json), not from what the detection shows: « Automatic » stays automatic */
function formOf(e: Entry, cats: string[]): Form {
  return {
    name: e.name ?? "", icon: e.icon ?? "", category: e.category && cats.includes(e.category) ? e.category : AUTO, description: e.description ?? "",
    tags: (e.tags ?? []).join(", "), app: e.app ?? AUTO, web: e.web ?? "auto", open_url: e.open_url ?? "",
    public: !!e.public, direct_ok: !!e.direct_ok, pause: !!e.pause, alerts: e.alerts ?? "all",
  };
}

/** The machine of a row, with its address when it has one */
function machineLabel(r: Host): string {
  if (!r.machine) return tx("inconnue");
  const ip = r.host_ip || r.ip;
  return ip ? `${r.machine} · ${ip}` : r.machine;
}

const changed = (a: Form, b: Form) => (Object.keys(a) as (keyof Form)[]).filter((k) => a[k] !== b[k]).length;

export function ServiceEdit({ r, logo, onClose }: Readonly<{ r: Host; logo: ReactNode; onClose: () => void }>) {
  const [doc, setDoc] = useState<MetaDoc | null>(null), [start, setStart] = useState<Form | null>(null), [f, setF] = useState<Form | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    read<MetaDoc>(`services/meta?type=${encodeURIComponent(r.type)}&id=${encodeURIComponent(String(r.id))}`).then((d) => {
      const form = formOf(d.entry, d.categories);
      setDoc(d); setStart(form); setF(form);
    }).catch((err) => setNote({ ok: false, text: (err as Error).message }));
  }, [r.type, r.id]);
  if (!f || !start || !doc) return <NoteLine note={note} />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const npmOpen = r.type === "proxy" && !r.acl && !r.acl_adv;   // « public on purpose » only means something for an NPM host without protection
  const detectedApp = r.app && !r.app.hand ? r.app : undefined;
  const n = changed(f, start);
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", "services/meta", {
      type: r.type, id: String(r.id), name: f.name.trim() || null, icon: f.icon || null, category: f.category || null, description: f.description,
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), app: f.app || null, web: f.web === "auto" ? null : f.web, open_url: f.open_url.trim() || null,
      public: npmOpen && f.public, direct_ok: f.direct_ok, pause: f.pause, alerts: f.alerts === "all" ? null : f.alerts,
    }), tx("enregistré"), setNote);
    setBusy(false);
    if (ok) onClose();
  };
  const reset = (k: keyof Form, auto: Form[keyof Form]) => (f[k] !== auto ? <Reset onClick={() => set(k, auto as never)} /> : null);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
      <InfoNote>{tx("Un champ vide ou sur « Automatique » reprend ce que la détection trouve. « Rétablir » efface le réglage à la main. Enregistré dans services-meta.json, la page suit tout de suite.")}</InfoNote>
      <div className="grid gap-3 lg:grid-cols-3">
        <BlockFrame title={tx("Identité")} tone="link">
          <Fields>
            <Item label={tx("Nom affiché")} tail={reset("name", "")}>
              <input className={input} maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={detectedName(r)} />
              <Src>{tx("détecté : {0}", detectedName(r))}</Src>
            </Item>
            <Item label={tx("Icône")}>
              <IconPicker value={f.icon || undefined} onPick={(k) => set("icon", k ?? "")} auto={logo} autoHint={r.app ? tx("appli reconnue : {0}", r.app.label) : tx("d'après le service")} />
            </Item>
            <Item label={tx("Catégorie")} tail={reset("category", AUTO)}>
              <select className={input} value={f.category} onChange={(e) => set("category", e.target.value)}>
                <option value={AUTO}>{tx("Automatique (d'après les règles)")}{r.category && !r.hand?.includes("category") ? ` : ${r.category}` : ""}</option>
                {doc.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Item>
            <Item label={tx("Description")}>
              <textarea className={`${input} min-h-[3.5rem]`} maxLength={300} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder={r.service?.description ?? tx("celle de la détection")} />
            </Item>
            <TagInput label={tx("Étiquettes")} value={f.tags} onChange={(v) => set("tags", v)} max={300} placeholder={tx("Entrée ou virgule pour ajouter")} />
            <Item label="Machine">
              <span className="text-sm text-txt">{machineLabel(r)}</span>
              <Src>{tx("détecté, non modifiable")}</Src>
            </Item>
          </Fields>
        </BlockFrame>
        <BlockFrame title={tx("Service")} tone="violet">
          <Fields>
            <Item label={tx("Appli")} tail={reset("app", AUTO)}>
              <select className={input} value={f.app} onChange={(e) => set("app", e.target.value)}>
                <option value={AUTO}>{tx("Automatique")}{detectedApp ? ` : ${detectedApp.label}` : tx(" : aucune reconnue")}</option>
                {doc.apps.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <Src>{tx("pour corriger une appli mal reconnue ou en nommer une inconnue : change l'icône et le connecteur proposé")}</Src>
            </Item>
            <Item label={tx("Interface")} tail={reset("web", "auto")}>
              <IconChoice label={tx("Interface")} value={f.web} options={WEB} onPick={(v) => set("web", v)} />
            </Item>
            <Item label={tx("Adresse à ouvrir")} tail={reset("open_url", "")}>
              <input className={input} maxLength={300} value={f.open_url} onChange={(e) => set("open_url", e.target.value)} placeholder={autoUrl(r) ?? "https://"} />
              <Src>{tx("le bouton « Ouvrir » et le clic sur le nom mènent ici")}</Src>
            </Item>
            {r.service?.name && (
              <Item label={tx("Service")}>
                <span className="text-sm text-txt">{r.service.name}{r.service.image ? ` · ${r.service.image}` : ""}</span>
                <Src>{tx("détecté, non modifiable")}</Src>
              </Item>
            )}
          </Fields>
        </BlockFrame>
        <BlockFrame title={tx("Suivi et alertes")} tone="ok">
          <Fields>
            <Check on={f.pause} set={(v) => set("pause", v)} label={tx("En pause")} hint={tx("Ni sonde ni alerte, toujours listé dans Services")} icon={<Pause size={14} aria-hidden />} />
            {npmOpen && <Check on={f.public} set={(v) => set("public", v)} label={tx("Site public voulu")} hint={tx("Ouvert à Internet volontairement : plus de « ⚠ public ? »")} icon={<Globe size={14} aria-hidden />} />}
            <Check on={f.direct_ok} set={(v) => set("direct_ok", v)} label={tx("Accès direct voulu")} hint={tx("Interface ouverte hors NPM volontairement : pas comptée comme un accès à protéger")} icon={<Plug size={14} aria-hidden />} />
            <Item label={tx("Alertes")} tail={reset("alerts", "all")}>
              <IconChoice label={tx("Alertes")} value={f.alerts} options={ALERTS} onPick={(v) => set("alerts", v)} />
              <Src>{tx("les notifications envoyées pour ce service (Réglages › Alertes)")}</Src>
            </Item>
          </Fields>
        </BlockFrame>
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-line/60 bg-card/95 px-3 py-2">
        <span className="mr-auto text-sm text-muted">{n ? tx("{0} changement(s) non enregistré(s)", n) : tx("Aucun changement")}</span>
        <NoteLine note={note} />
        <button type="button" className={quiet} onClick={onClose}>{tx("Annuler")}</button>
        <button type="submit" className={primary} disabled={busy || !n}><Save size={14} aria-hidden />{tx("Enregistrer")}</button>
      </div>
    </form>
  );
}

function Fields({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="mx-3 mb-3 mt-2 flex flex-col gap-3">{children}</div>;
}

function Item({ label, tail, children }: Readonly<{ label: string; tail?: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="flex items-center gap-2 font-semibold text-muted">{label}{tail}</span>
      {children}
    </div>
  );
}

function Reset({ onClick }: Readonly<{ onClick: () => void }>) {
  return <button type="button" onClick={onClick} className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-link hover:underline" title={tx("Effacer le réglage à la main")}><RotateCcw size={12} aria-hidden />{tx("Rétablir")}</button>;
}

function Check({ on, set, label, hint, icon }: Readonly<{ on: boolean; set: (v: boolean) => void; label: string; hint: string; icon: ReactNode }>) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm" aria-label={label}>
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => set(e.target.checked)} aria-label={label} />
      <span><span className="inline-flex items-center gap-1.5 font-semibold text-txt">{icon}{label}</span><span className="block text-xs text-dim">{hint}</span></span>
    </label>
  );
}
