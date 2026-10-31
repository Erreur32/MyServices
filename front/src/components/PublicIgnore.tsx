// Services page, in the page's title: the domains (or « *.domain » patterns) that are never asked « public? ». A host whose every name matches is left out of the
// « ⚠ public ? » check; its probes, certificate and DNS checks go on as before. The list is kept on the server (services/public-ignore).
import { ChevronDown, EyeOff, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { read, send } from "../api";
import { act, input, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { DROP_PANEL, DROP_PANEL_LEFT, useDropdown } from "./Dropdown";
import { InfoNote } from "./InfoNote";
import { NoteLine } from "./form";
import { Count } from "./ui";

const PANEL_PX = 480;   // the panel's 30rem

export function PublicIgnore() {
  const [list, setList] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  const { open, setOpen, box } = useDropdown();
  const [toRight, setToRight] = useState(false);
  // the panel hangs under the button, from its left edge unless the title line left it too close to the right of the window
  const toggle = (e: MouseEvent<HTMLElement>) => { setToRight(e.currentTarget.getBoundingClientRect().left + PANEL_PX > innerWidth); setOpen(!open); };
  useEffect(() => { read<{ domains: string[] }>("services/public-ignore").then((d) => setList(d.domains)).catch(() => setList([])); }, []);
  const save = async (next: string[]) => {
    const ok = await act(async () => { const d = await send<{ domains: string[] }>("PUT", "services/public-ignore", { domains: next }); setList(d.domains); }, tx("liste enregistrée"), setNote);
    if (ok) setText("");
  };
  const add = (e: FormEvent) => { e.preventDefault(); if (list && text.trim()) void save([...list, ...text.split(/[\s,;]+/)]); };
  return (
    <>
      <div ref={box} className="relative">
        <button type="button" onClick={toggle} aria-expanded={open}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-sm text-muted hover:bg-link/10 hover:text-txt">
          <EyeOff size={14} aria-hidden />{tx("Domaines ignorés")}{list != null && <Count n={list.length} tone="off" />}<ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {open && <div className={`${toRight ? DROP_PANEL : DROP_PANEL_LEFT} w-[min(30rem,calc(100vw-2rem))] p-3 max-sm:fixed max-sm:left-4 max-sm:right-4 max-sm:top-auto max-sm:w-auto`}>
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
        </div>}
      </div>
      {!!list?.length && <span className="min-w-0 max-w-[18rem] truncate font-mono text-xs text-muted" title={list.join("\n")}>{list.join(", ")}</span>}
    </>
  );
}
