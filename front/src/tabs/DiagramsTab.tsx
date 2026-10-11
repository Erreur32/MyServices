// Onglet Schémas : tous les schémas de l'infra (Archify) au même endroit, avec aperçu, ouverture dans un onglet et régénération.
import { Eye, EyeOff, ExternalLink, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { ROOT, send } from "../api";
import { NoteLine } from "../components/form";
import { useDiagrams, type Diagram } from "../components/Diagrams";
import { Badge, Card, Count, Empty } from "../components/ui";
import { dateTime } from "../lib/format";
import { act, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

function DiagramCard({ d, open, toggle, onRemove }: { d: Diagram; open: boolean; toggle: () => void; onRemove?: () => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-bold">{d.title}</h3>
        {!d.available ? <Badge tone="off">{tx("source non activée")}</Badge> : d.exists ? <Badge tone="ok">{tx("à jour")}</Badge> : <Badge tone="warn">{tx("pas encore généré")}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">{d.what}</p>
      {d.updated && <p className="mt-1 text-xs text-dim">{tx("Généré le {0}", dateTime(d.updated * 1000))}</p>}
      {d.exists && (
        <div className="mt-3 flex flex-wrap gap-2">
          <a className={primary} href={`${ROOT}${d.file}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden />{tx("Ouvrir")}</a>
          <button type="button" className={quiet} onClick={toggle} aria-expanded={open}>{open ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}{open ? tx("Masquer l'aperçu") : tx("Aperçu")}</button>
          {onRemove && <button type="button" className={quiet} onClick={onRemove} title={tx("Retirer ce schéma de la liste")}><Trash2 size={14} aria-hidden />{tx("Retirer")}</button>}
        </div>
      )}
      {open && d.exists && <iframe title={d.title} src={`${ROOT}${d.file}`} loading="lazy" sandbox="allow-scripts" className="mt-3 h-[28rem] w-full rounded-xl border border-line bg-bg2" />}
    </Card>
  );
}

export function DiagramsTab({ admin }: { admin: boolean }) {
  const [d, reload] = useDiagrams();
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null);
  if (!d) return <p className="py-6 text-muted">{tx("Chargement…")}</p>;
  const rebuild = async () => {
    setBusy(true);
    await act(() => send("POST", "diagrams/rebuild"), tx("régénération lancée : quelques secondes"), setNote);
    setTimeout(() => { reload(); setBusy(false); }, 6000);
  };
  const ask = async (x: Diagram, on: boolean) => {
    setBusy(true);
    const ok = await act(() => send("PUT", `diagrams/${x.id}`, { enabled: on }), on ? tx("création lancée : quelques secondes") : tx("schéma retiré"), setNote);
    setTimeout(() => { reload(); setBusy(false); }, ok && on ? 8000 : 500);
  };
  const list = d.diagrams.filter((x) => x.available && (!x.optional || x.enabled));
  const proposals = d.diagrams.filter((x) => x.optional && !x.enabled);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">{tx("Schémas de l'infrastructure")} <Count n={`${list.filter((x) => x.exists).length}/${list.length}`} /></h2>
            <p className="text-sm text-muted">{tx("Tous les schémas générés à partir de ce que MyServices sait de votre infra. Ils se mettent à jour après chaque collecte quand les données changent.")}</p>
          </div>
          {admin && d.archify && <button type="button" className={quiet} disabled={busy} onClick={() => void rebuild()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}{tx("Regénérer maintenant")}</button>}
        </div>
        <NoteLine note={note} />
        <p className="mt-2 text-xs text-dim">{tx("Générés avec")} <a className="text-link hover:underline" href={d.archify_url} target="_blank" rel="noopener noreferrer">Archify</a></p>
      </Card>
      {!d.archify ? <Empty>{tx("Archify n'est pas installé dans cette image : aucun schéma ne peut être généré.")}</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((x) => <DiagramCard key={x.id} d={x} open={open === x.id} toggle={() => setOpen(open === x.id ? null : x.id)} onRemove={admin && x.optional ? () => void ask(x, false) : undefined} />)}
        </div>
      )}
      {d.archify && proposals.length > 0 && (
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-bold"><Sparkles size={16} aria-hidden />{tx("Schémas à créer")} <Count n={proposals.length} /></h2>
          <p className="mb-3 text-sm text-muted">{tx("Des schémas en plus, construits à la demande depuis ce que MyServices sait déjà. Un clic sur « Créer » le génère (quelques secondes) et il rejoint la liste ci-dessus.")}</p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {proposals.map((x) => (
              <li key={x.id} className={`flex flex-col gap-2 rounded-xl border bg-bg2/30 p-3 ${x.available ? "border-line" : "border-line/60 opacity-70"}`}>
                <b>{x.title}</b>
                <p className="text-sm text-muted">{x.what}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  {admin && <button type="button" className={primary} disabled={busy || !x.available} onClick={() => void ask(x, true)}>
                    {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />}{tx("Créer ce schéma")}</button>}
                  {!x.available && <Badge tone="off">{tx("rien à montrer pour l'instant")}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
