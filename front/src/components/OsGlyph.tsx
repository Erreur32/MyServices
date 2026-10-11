// Icône d'un système d'exploitation : le logo de la distribution quand on la reconnaît (Debian, Ubuntu…), sinon l'icône de la famille.
import { Apple, Cpu, Monitor, Router, Smartphone, Terminal } from "lucide-react";
import { distroIcon } from "../lib/osIcon";
import type { OsKind } from "../lib/machines";

export const OS_ICON: Record<OsKind, typeof Terminal> = { linux: Terminal, windows: Monitor, macos: Apple, ios: Smartphone, network: Router, pi: Cpu };

export function OsGlyph({ kind, name, size = 14 }: { kind: OsKind; name?: string | null; size?: number }) {
  const logo = distroIcon(name);
  if (logo) return <img src={logo} alt="" style={{ width: size, height: size }} className="shrink-0" />;
  const Icon = OS_ICON[kind];
  return <Icon size={size} className="shrink-0 text-muted" aria-hidden />;
}
