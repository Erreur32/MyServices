import { useState } from "react";

export function readFlag(key: string | undefined, initial: boolean): boolean {
  if (!key) return initial;
  try {
    const v = localStorage.getItem(key);
    return v === null ? initial : v === "1";
  } catch {
    return initial;
  }
}

/** A true/false choice remembered in this browser only; the page works without it (private window, blocked storage). No key: not remembered. */
export function useStoredFlag(key: string | undefined, initial: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readFlag(key, initial));
  const set = (v: boolean) => {
    setOn(v);
    if (!key) return;
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch { /* navigation privée : tant pis */ }
  };
  return [on, set];
}
