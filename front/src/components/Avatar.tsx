// Avatar of an account (Profile → My avatar), or its initial when it has none; one shared version, so a new image shows everywhere at once
import { useEffect, useState } from "react";
import { ROOT } from "../api";

let current: Record<string, string | null> = {};
let preview: Record<string, string> = {};   // image just picked (data URL): shown at once, before the server has answered
const listeners = new Set<() => void>();

/** Tells every Avatar of this account that its image changed (version: fingerprint, null: removed; shown: the picked image itself) */
export function setAvatarVersion(username: string, version: string | null, shown?: string) {
  current = { ...current, [username]: version };
  if (shown) preview = { ...preview, [username]: shown };
  else { const { [username]: _gone, ...rest } = preview; preview = rest; }   // removed, or refused: back to the server's image
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
  const local = preview[username];
  if ((v || local) && !broken) {
    return <img src={local ?? `${ROOT}api/v1/users/${encodeURIComponent(username)}/avatar?v=${v}`} alt="" style={box} onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-bg2 object-cover" />;
  }
  return <span style={{ ...box, fontSize: Math.round(size * 0.42) }} aria-hidden
    className="grid shrink-0 place-items-center rounded-full bg-link/20 font-bold uppercase text-link">{username.slice(0, 1)}</span>;
}
