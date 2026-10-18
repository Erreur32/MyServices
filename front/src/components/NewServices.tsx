// Accueil : services apparus sur les machines ces 7 derniers jours (conteneurs, process), « les suivre ? » (GET services/new).
// Suivre = rien ne change, ils ne sont plus proposés ; ne pas suivre = en pause (ni sonde ni alerte), à reprendre depuis leur fiche.
import { Boxes, Check, ChevronRight, Cpu, EyeOff, Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { appIcon, appIconByText } from "../lib/appIcons";
import { dateTime } from "../lib/format";
import { act, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { NoteLine } from "./form";
import { Badge, Count } from "./ui";
import { InfoNote } from "./InfoNote";
import { FOLD_HEADER, headerToggle } from "../lib/foldHeader";

export interface NewService {
  key: string; name: string; kind: string; image?: string | null; app?: string | null;
  machine?: string | null; ip?: string | null; port?: number | null; since?: number | null;
}

const FOLD_KEY = "ms.home.newservices.folded";

export function NewServices({ generated }: { generated?: string }) {   // generated: read again when a collection ends
  const [items, setItems] = useState<NewService[]>([]), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* storage refused: the choice lasts this visit */ } };
  const load = useCallback(() => {
    read<{ items: NewService[] }>("services/new").then((d) => setItems(d.items))
      .catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); });
  }, []);
  useEffect(load, [load, generated]);
  if (!items.length) return null;
  const decide = async (how: "follow" | "ignore", keys: string[]) => {
    setBusy(true);
    const ok = await act(() => send("POST", `services/new/${how}`, { keys }),
      how === "follow" ? tx("suivi : plus proposé") : tx("pas suivi : en pause, à reprendre depuis sa fiche dans Services"), setNote);
    setBusy(false);
    if (ok) setItems((xs) => xs.filter((x) => !keys.includes(x.key)));
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-link/40 bg-card shadow-sm" aria-label={tx("Nouveaux services sur les machines")}>
      <div className={`flex flex-wrap items-center gap-3 bg-link/10 px-5 py-3.5 ${FOLD_HEADER}`} onClick={headerToggle(() => fold(!folded))}>
        <button type="button" onClick={() => fold(!folded)} aria-expanded={!folded} title={folded ? tx("Déplier") : tx("Replier")}
          className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-link/20 text-link"><Boxes size={18} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-base font-bold">{tx("Nouveaux services sur les machines")} <Count n={items.length} /></h2>
            <InfoNote>{tx("Apparus ces 7 derniers jours : les suivre ? Sans réponse, ils sont suivis comme les autres.")}</InfoNote>
          </span>
          <ChevronRight size={18} className={`shrink-0 text-txt transition-transform ${folded ? "" : "rotate-90"}`} aria-hidden />
        </button>
        {items.length > 1 && <button type="button" className={quiet} disabled={busy} onClick={() => void decide("follow", items.map((x) => x.key))}><Check size={14} aria-hidden />{tx("Tout suivre")}</button>}
      </div>
      {!folded && <ul className="flex flex-col divide-y divide-line/60">
        {items.map((x) => {
          const icon = appIcon(x.app ? [x.app] : undefined) ?? appIconByText(x.name, x.image);
          return (
            <li key={x.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">
                {icon ? <img src={icon} alt="" className="h-5 w-5" /> : x.kind === "process" ? <Cpu size={16} className="text-muted" aria-hidden /> : <Package size={16} className="text-muted" aria-hidden />}
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{x.app || x.name}</b>{x.app && x.app !== x.name && <span className="text-dim">· {x.name}</span>}
                  <Badge tone="off">{x.kind === "docker" ? "Docker" : x.kind === "process" ? tx("process") : x.kind}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-dim">
                  {x.machine ? <b className="font-semibold text-muted">{x.machine}</b> : null}{x.ip ? ` · ${x.ip}:${x.port}` : ""}
                  {x.since ? ` · ${tx("vu le {0}", dateTime(x.since * 1000))}` : ""}{x.image ? ` · ${x.image}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className={primary} disabled={busy} onClick={() => void decide("follow", [x.key])}><Check size={14} aria-hidden />{tx("Suivre")}</button>
                <button type="button" className={quiet} disabled={busy} onClick={() => void decide("ignore", [x.key])}
                  title={tx("Mis en pause : ni sonde ni alerte. Reste visible dans Services, d'où on peut reprendre le suivi.")}><EyeOff size={14} aria-hidden />{tx("Ne pas suivre")}</button>
              </div>
            </li>
          );
        })}
      </ul>}
      {note && <div className="px-5 pb-3"><NoteLine note={note} /></div>}
    </section>
  );
}
