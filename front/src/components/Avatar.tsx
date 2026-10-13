// Avatar of an account (Profile → My avatar), or its initial when it has none; one shared version, so a new image shows everywhere at once
import { useEffect, useState } from "react";
import { ROOT } from "../api";

let current: Record<string, string | null> = {};
const listeners = new Set<() => void>();

/** Tells every Avatar of this account that its image changed (version: fingerprint, null: removed) */
export function setAvatarVersion(username: string, version: string | null) {
  current = { ...current, [username]: version };
  listeners.forEach((f) => f());
}

export function Avatar({ username, version, size = 28 }: Readonly<{ username: string; version?: string | null; size?: number }>) {
  const [, tick] = useState(0);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const f = () => { tick((n) => n + 1); setBroken(false); };
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  const v = username in current ? current[username] : version;
  const box = { width: size, height: size };
  if (v && !broken) {
    return <img src={`${ROOT}api/v1/users/${encodeURIComponent(username)}/avatar?v=${v}`} alt="" style={box} onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-bg2 object-cover" />;
  }
  return <span style={{ ...box, fontSize: Math.round(size * 0.42) }} aria-hidden
    className="grid shrink-0 place-items-center rounded-full bg-link/20 font-bold uppercase text-link">{username.slice(0, 1)}</span>;
}
