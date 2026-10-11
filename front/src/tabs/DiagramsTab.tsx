// Onglet Schémas : tous les schémas de l'infra (Archify) au même endroit, avec aperçu, ouverture dans un onglet et régénération.
import { Eye, EyeOff, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ROOT, send } from "../api";
import { NoteLine } from "../components/form";
import { useDiagrams, type Diagram } from "../components/Diagrams";
import { Badge, Card, Count, Empty } from "../components/ui";
import { dateTime } from "../lib/format";
import { act, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

function DiagramCard({ d, open, toggle }: { d: Diagram; open: boolean; toggle: () => void }) {
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
  const list = d.diagrams.filter((x) => x.available);
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
          {list.map((x) => <DiagramCard key={x.id} d={x} open={open === x.id} toggle={() => setOpen(open === x.id ? null : x.id)} />)}
        </div>
      )}
    </div>
  );
}
