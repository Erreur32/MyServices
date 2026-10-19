// Devices seen by a tool (MynetworK, Proxmox, Dockhand, Beszel…) but not followed here, with « Suivre » to add one as a machine.
// Shown in Settings → Machines (where machines are added), folded by default.
import { ChevronRight, Plus, Radar } from "lucide-react";
import { useMemo, useState } from "react";
import { LOGIN, LoginRequired, send, type Snapshot } from "../api";
import { ipNum } from "../lib/format";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { rereadMachines } from "../lib/scan";
import type { Unlinked } from "../types";
import { InfoNote } from "./InfoNote";
import { FOLD, FOLD_HEAD } from "./NetworkStep";
import { Badge, Count, Dim } from "./ui";

/** The matching layer's list (all tools), or MynetworK's inventory alone for an older data.json */
export function unlinkedOf(snap: Snapshot): Unlinked[] {
  if (snap.data.unlinked) return snap.data.unlinked;
  const followed = new Set(snap.data.machine_list.map((m) => m.ip));
  return (snap.data.network ?? []).flatMap((c) => c.devices ?? []).filter((d) => !followed.has(d.ip))
    .map((d) => ({ source: "mynetwork", label: "MynetworK", instance: "", ip: d.ip, mac: d.mac ?? undefined, name: d.hostname || d.vendor || undefined, online: d.status === "online" }));
}

export function UnlinkedDevices({ snap, onFollowed }: Readonly<{ snap: Snapshot; onFollowed?: () => void }>) {
  const untracked = useMemo(() => unlinkedOf(snap), [snap]);
  const bySource = useMemo(() => {
    const g = new Map<string, Unlinked[]>();
    for (const u of untracked) g.set(u.label, [...(g.get(u.label) ?? []), u]);
    for (const l of g.values()) l.sort((a, b) => (a.ip && b.ip ? ipNum(a.ip) - ipNum(b.ip) : (a.name ?? "").localeCompare(b.name ?? "")));
    return [...g.entries()];
  }, [untracked]);
  // « Suivre » an untracked device: added like a machine found by the network search, then read and checked (admin only)
  const [following, setFollowing] = useState<Record<string, "busy" | "done" | string>>({});
  const follow = async (d: Unlinked) => {
    if (!d.ip) return;
    const ip = d.ip;
    setFollowing((f) => ({ ...f, [ip]: "busy" }));
    try {
      await send("PUT", `machines/settings/${ip}`, { machine: { name: (d.name || ip).slice(0, 60), role: "" }, extra: [] });
      setFollowing((f) => ({ ...f, [ip]: "done" }));
      onFollowed?.();
      await rereadMachines([ip]).catch(() => undefined);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setFollowing((f) => ({ ...f, [ip]: (e as Error).message }));
    }
  };
  if (untracked.length === 0) return null;
  return (
    <details className={`${FOLD} [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
      <summary className={FOLD_HEAD}>
        <ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
        <Radar size={16} aria-hidden />{tx("Vus par vos outils, pas suivis ici")} <Count n={untracked.length} />
        <span className="font-normal text-muted">{tx("« Suivre » en fait une machine")}</span>
      </summary>
      {bySource.map(([label, list]) => (
        <div key={label} className="mt-2 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">{label} <span className="font-normal">({list.length})</span></h4>
          <ul className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {list.slice(0, 120).map((d, n) => (
              <li key={`${d.ip ?? d.name}-${n}`} className="flex min-w-0 items-baseline gap-2 whitespace-nowrap" title={[d.ip, d.name, d.mac].filter(Boolean).join(" · ")}>
                {d.online != null && <Badge tone={d.online ? "ok" : "off"}>{d.online ? tx("en ligne") : tx("hors ligne")}</Badge>}
                {d.ip && <span className="shrink-0 font-mono text-xs">{d.ip}</span>}<span className="min-w-0 truncate">{d.name ?? ""}</span>
                {d.vmid != null && <Dim>{d.type === "lxc" ? "LXC" : "VM"} {d.vmid}{d.node ? ` · ${d.node}` : ""}</Dim>}
                {d.mac && <span className="hidden shrink-0 font-mono text-[11px] text-dim 2xl:inline">{d.mac}</span>}
                {d.ip && (following[d.ip] === "done" ? <Badge tone="ok">{tx("suivie")}</Badge>
                  : <button type="button" className={`${quiet} ml-auto shrink-0 px-2 py-0.5 text-xs`} disabled={following[d.ip] === "busy"} onClick={() => void follow(d)}
                      title={following[d.ip] && following[d.ip] !== "busy" ? following[d.ip] : tx("Ajouter aux machines suivies (relevé et santé lancés)")}>
                      <Plus size={12} aria-hidden />{following[d.ip] && following[d.ip] !== "busy" ? <span className="text-bad">{tx("refusé")}</span> : tx("Suivre")}</button>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <InfoNote className="mt-2">{tx("« Suivre » l'ajoute aux machines (son accès SSH se règle ensuite dans sa carte).")}</InfoNote>
    </details>
  );
}
