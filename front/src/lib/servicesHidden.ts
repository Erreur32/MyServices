// Services hidden from « To watch » (Services page), from the tab's dot and from the home page, kept on the server ({key: {sig, name, at}}).
// A service stays hidden while its problem keeps the same signature (state, label, points to check): a new problem shows it again by itself.
// A service no longer followed (hidden while it had no problem, or stopped on purpose) carries the signature ALWAYS: hidden whatever happens.
// One copy for the whole page, so the tab bar and the Services page agree as soon as a button is clicked.
import { useEffect, useState } from "react";
import { read, send } from "../api";
import type { Host } from "../types";
import { liveChecks } from "./servicesState";
import { status } from "./status";

export interface HiddenEntry { sig: string; name: string; at: number }
export type HiddenMap = Record<string, HiddenEntry>;

/** Stable key of a service row (NPM host or local service) */
export const serviceKey = (r: Host): string => `${r.type}${r.id}`;
/** What the hidden problem was: a change of state, label or points to check makes another signature */
export const problemSig = (r: Host): string => { const [cls, label] = status(r); return `${cls}|${label}|${[...liveChecks(r)].sort((a, b) => a.localeCompare(b)).join(",")}`; };
/** Signature of a service no longer followed at all, until it is shown again */
export const ALWAYS = "*";
export const isHidden = (r: Host, map: HiddenMap): boolean => { const sig = map[serviceKey(r)]?.sig; return sig === ALWAYS || sig === problemSig(r); };

let current: HiddenMap = {};
let loaded = false;
const listeners = new Set<(m: HiddenMap) => void>();
const publish = (m: HiddenMap) => { current = m; for (const l of listeners) l(m); };
const load = () => read<HiddenMap>("services/watch-hidden").then(publish).catch(() => undefined);   // unreadable: nothing hidden, everything shows

/** The hidden services as last read, for the counters worked out outside a component (the page is drawn again on each change, App follows them) */
export const hiddenNow = (): HiddenMap => current;

/** The hidden services, read once and kept in step with every change */
export function useServicesHidden(): HiddenMap {
  const [map, setMap] = useState<HiddenMap>(current);
  useEffect(() => {
    listeners.add(setMap);
    if (!loaded) { loaded = true; void load(); }
    return () => { listeners.delete(setMap); };
  }, []);
  return map;
}

/** Hide a service (with the signature of its current problem, or ALWAYS: no longer followed) or show it again; the page follows at once, the server keeps it */
export async function setServiceHidden(r: Host, name: string, hidden: boolean, always = false): Promise<void> {
  const key = serviceKey(r), next = { ...current }, sig = always ? ALWAYS : problemSig(r);
  if (hidden) next[key] = { sig, name, at: Math.floor(Date.now() / 1000) };
  else delete next[key];
  publish(next);
  try { await send("POST", "services/watch-hidden", { key, sig, name, hidden }); } catch { void load(); }   // refused: back to what the server keeps
}
