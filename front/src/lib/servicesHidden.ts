// Services hidden from « To watch » (Services page), from the tab's dot and from the home page, kept on the server ({key: {sig, name, at}}).
// A service stays hidden while its problem keeps the same signature (state, label, points to check): a new problem shows it again by itself.
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
export const isHidden = (r: Host, map: HiddenMap): boolean => map[serviceKey(r)]?.sig === problemSig(r);

let current: HiddenMap = {};
let loaded = false;
const listeners = new Set<(m: HiddenMap) => void>();
const publish = (m: HiddenMap) => { current = m; for (const l of listeners) l(m); };
const load = () => read<HiddenMap>("services/watch-hidden").then(publish).catch(() => undefined);   // unreadable: nothing hidden, everything shows

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

/** Hide a service (with the signature of its current problem) or show it again; the page follows at once, the server keeps it */
export async function setServiceHidden(r: Host, name: string, hidden: boolean): Promise<void> {
  const key = serviceKey(r), next = { ...current };
  if (hidden) next[key] = { sig: problemSig(r), name, at: Math.floor(Date.now() / 1000) };
  else delete next[key];
  publish(next);
  try { await send("POST", "services/watch-hidden", { key, sig: problemSig(r), name, hidden }); } catch { void load(); }   // refused: back to what the server keeps
}
