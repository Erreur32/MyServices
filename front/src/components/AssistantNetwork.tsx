// Étape « Le réseau » de l'assistant, volontairement simple : trois états (pas encore cherché, en cours, résultat), une seule décision
// (quelles machines suivre). Ni accès SSH, ni connecteurs, ni appareils oubliés : l'étape suivante s'occupe de la façon de lire chaque machine.
import { Check, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { send } from "../api";
import { appIcon } from "../lib/appIcons";
import { act, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { interesting, netState, roleOf, tagsOf } from "../lib/netScan";
import { pokeScan, rereadMachines } from "../lib/scan";
import { plural } from "../lib/summary";
import type { NetHost, NetScan } from "../types";
import { NoteLine } from "./form";
import { netPercent } from "./ScanBar";
import { Badge } from "./ui";

/** Ce que la machine est, en un seul mot : l'appli reconnue, sinon SSH, sinon la première étiquette */
export function whatIs(h: Pick<NetHost, "hints" | "apps" | "ssh_port">): string {
  return h.apps[0] ?? (h.ssh_port ? "SSH" : tagsOf(h)[0]?.label ?? "");
}

function Row({ h, on, toggle }: { h: NetHost; on: boolean; toggle: () => void }) {
  const what = whatIs(h), icon = appIcon(h.apps);
  return (
    <li>
      <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${on ? "border-link/50 bg-link/5" : "border-transparent bg-bg2/60 hover:bg-bg2"}`}>
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-[rgb(var(--link))]" checked={on} onChange={toggle} />
        {icon && <img src={icon} alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" />}
        <b className="min-w-0 truncate text-sm text-txt">{h.name || h.ip}</b>
        {h.name && <span className="font-mono text-xs text-dim">{h.ip}</span>}
        {what && <Badge tone={h.apps.length ? "info" : "off"}>{what}</Badge>}
      </label>
    </li>
  );
}

export function AssistantNetwork({ net, reload, known }: { net: NetScan | null; reload: () => void; known: string[] }) {
  const [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()), [added, setAdded] = useState(0);
  const state = netState(net), preselected = useRef<number | null>(null);
  useEffect(() => {   // fin d'une recherche : les machines intéressantes sont cochées d'office (décochables)
    if (net?.phase !== "done" || !net.ended || preselected.current === net.ended) return;
    preselected.current = net.ended;
    setPicked(new Set(net.found.filter((h) => !known.includes(h.ip) && !net.ignored?.includes(h.ip) && interesting(h)).map((h) => h.ip)));
  }, [net, known]);

  const start = async () => {
    setBusy(true); setAdded(0);
    await act(async () => { await send("POST", "network/scan"); pokeScan(); reload(); }, tx("recherche lancée"), setNote);
    setBusy(false);
  };
  const toggle = (ip: string) => setPicked((p) => { const n = new Set(p); if (n.has(ip)) n.delete(ip); else n.add(ip); return n; });

  if (state === "idle" && !net?.found.length) {
    return (
      <div className="mt-4 rounded-xl border border-line/60 bg-bg2/60 p-5 text-center">
        <Search size={28} className="mx-auto text-link" aria-hidden />
        <p className="mt-2 text-sm text-muted">{tx("MyServices envoie un ping à chaque adresse de votre réseau, demande son nom à chaque machine et regarde quelques ports. Rien n'est modifié.")}</p>
        <button type="button" className={`${primary} mt-4`} disabled={busy} onClick={() => void start()}><Search size={14} aria-hidden />{tx("Lancer la recherche")}</button>
        <NoteLine note={note} />
      </div>
    );
  }
  if (state === "run" && net) {
    return (
      <div className="mt-4 rounded-xl border border-line/60 bg-bg2/60 p-5" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-semibold"><Loader2 size={16} className="animate-spin text-link" aria-hidden />{tx("Recherche en cours…")} <span className="tabular-nums text-dim">{netPercent(net)} %</span></p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden><div className="scan-fill h-full rounded-full" style={{ width: `${Math.max(3, netPercent(net))}%` }} /></div>
        <p className="mt-2 text-xs text-dim">{tx("Machines trouvées jusqu'ici : {0}. Vous pouvez attendre ici : la liste s'affichera toute seule.", net.found.length)}</p>
      </div>
    );
  }

  const fresh = (net?.found ?? []).filter((h) => !known.includes(h.ip) && !net?.ignored?.includes(h.ip));
  const proposed = fresh.filter(interesting), others = fresh.filter((h) => !interesting(h));
  const chosen = proposed.filter((h) => picked.has(h.ip));
  const addPicked = async () => {
    setBusy(true);
    const done: string[] = [];
    await act(async () => {
      for (const h of chosen) {
        await send("PUT", `machines/settings/${h.ip}`, { machine: { name: h.name.trim() || h.ip, role: roleOf(h) }, extra: [] });
        done.push(h.ip);
      }
    }, tx("machines ajoutées : relevé et santé lancés"), setNote);
    setAdded((n) => n + done.length); setPicked(new Set());
    await rereadMachines(done).catch(() => undefined);
    setBusy(false);
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-muted">
        <b className="text-txt">{plural(net?.found.length ?? 0, "machine trouvée", "machines trouvées")}</b>
        {known.length > 0 && <> · {tx("{0} déjà suivies", known.length)}</>}
        {proposed.length > 0 ? <> · {tx("{0} à suivre, à mon avis", proposed.length)}</> : <> · {tx("rien de nouveau à suivre")}</>}
      </p>
      {proposed.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold">{tx("À suivre")}</h3>
          <ul className="flex flex-col gap-1.5">{proposed.map((h) => <Row key={h.ip} h={h} on={picked.has(h.ip)} toggle={() => toggle(h.ip)} />)}</ul>
        </section>
      )}
      {others.length > 0 && (   // caméras, objets connectés, téléphones : seulement un ping possible, pas dans l'assistant ; ajoutables après, depuis Découverte
        <p className="text-xs text-dim">{plural(others.length, "autre appareil vu", "autres appareils vus")} {tx("(caméras, objets connectés…) : vous pourrez les suivre plus tard, en simple ping, dans")} <a href="#settings/network" className="text-link hover:underline">{tx("Réglages → Découverte")}</a>.</p>
      )}
      {added > 0 && <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm font-semibold text-ok" role="status"><Check size={14} className="mr-1 inline" aria-hidden />{tx("{0} ajoutées. À l'étape suivante, vous choisissez comment les lire.", plural(added, "machine"))}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {chosen.length > 0 && <button type="button" className={primary} disabled={busy} onClick={() => void addPicked()}><Check size={14} aria-hidden />{tx("Suivre la sélection")} ({chosen.length})</button>}
        <button type="button" className={`${quiet} ml-auto`} disabled={busy} onClick={() => void start()}><RefreshCw size={14} aria-hidden />{tx("Relancer la recherche")}</button>
      </div>
      <NoteLine note={note} />
    </div>
  );
}
