// Services page: the domains (or « *.domain » patterns) that are never asked « public? ». A host whose every name matches is left out of the
// « ⚠ public ? » check; its probes, certificate and DNS checks go on as before. The list is kept on the server (services/public-ignore).
import { EyeOff, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { read, send } from "../api";
import { act, input, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { NoteLine } from "./form";

export function PublicIgnore() {
  const [list, setList] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  useEffect(() => { read<{ domains: string[] }>("services/public-ignore").then((d) => setList(d.domains)).catch(() => setList([])); }, []);
  const save = async (next: string[]) => {
    const ok = await act(async () => { const d = await send<{ domains: string[] }>("PUT", "services/public-ignore", { domains: next }); setList(d.domains); }, tx("liste enregistrée"), setNote);
    if (ok) setText("");
  };
  const add = (e: FormEvent) => { e.preventDefault(); if (list && text.trim()) void save([...list, ...text.split(/[\s,;]+/)]); };
  return (
    <FoldPanel id="services-public-ignore" icon={EyeOff} title={tx("Domaines ignorés")} count={list?.length} startFolded>
      <InfoNote>{tx("Un site qui répond à Internet sans liste d'accès est signalé « ⚠ public ? ». Les domaines de cette liste ne sont jamais signalés ainsi (un motif comme *.lan.monsite.fr couvre tous ses sous-domaines). Leurs sondes, certificats et DNS restent contrôlés. Un site qui porte aussi un autre domaine reste signalé.")}</InfoNote>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
        <label className="min-w-[14rem] flex-1 max-w-md"><span className="sr-only">{tx("Domaine ou motif")}</span>
          <input className={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="*.lan.monsite.fr" spellCheck={false} autoComplete="off" /></label>
        <button type="submit" className={primary} disabled={!list || !text.trim()}><Plus size={14} aria-hidden />{tx("Ajouter")}</button>
      </form>
      <NoteLine note={note} />
      {list?.length === 0 && <p className="mt-3 text-sm text-dim">{tx("Aucun domaine ignoré pour l'instant.")}</p>}
      {!!list?.length && <ul className="mt-3 flex flex-wrap gap-2" aria-label={tx("Domaines ignorés")}>
        {list.map((d) => (
          <li key={d} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg2 py-1 pl-3 pr-1.5 font-mono text-xs">
            {d}<button type="button" onClick={() => void save(list.filter((x) => x !== d))} aria-label={`${tx("Retirer")} ${d}`} title={tx("Retirer de la liste")} className="rounded-full p-0.5 text-dim hover:bg-bg hover:text-txt"><X size={12} aria-hidden /></button>
          </li>
        ))}
      </ul>}
    </FoldPanel>
  );
}
