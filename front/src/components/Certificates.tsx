// Certificats des services (Web-Check et Uptime Kuma), le plus proche de l'expiration d'abord : onglet Sécurité.
import { ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import type { Snapshot } from "../api";
import { tx } from "../lib/i18n";
import { FoldPanel } from "./FoldPanel";
import { Badge } from "./ui";

export const CERT_SOON = 30;   // days

/** Certificates of the services (Web-Check and Uptime Kuma), expiring first */
export function Certificates({ snap }: Readonly<{ snap: Snapshot }>) {
  const certs = useMemo(() => {
    const out = new Map<string, { name: string; days: number; by: string }>();
    for (const r of snap.data.hosts) {
      const name = r.domains?.[0];
      if (!name) continue;
      const found: [number | null | undefined, string][] = [[r.webcheck?.cert_days, "Web-Check"], ...(r.uptime ?? []).map((u): [number | null | undefined, string] => [u.cert_days, "Uptime Kuma"])];
      for (const [d, by] of found) if (d != null && (!out.has(name) || d < out.get(name)!.days)) out.set(name, { name, days: d, by });
    }
    return [...out.values()].sort((a, b) => a.days - b.days);
  }, [snap.data.hosts]);
  if (!certs.length) return null;
  const soon = certs.filter((c) => c.days <= CERT_SOON);
  return (
    <FoldPanel id="security.certs" icon={ShieldCheck} title={tx("Certificats")} count={certs.length}
      extra={soon.length > 0 ? <Badge tone="warn">{tx("{0} expirent dans moins de {1} jours", soon.length, CERT_SOON)}</Badge> : null}>
      <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
        {certs.slice(0, 30).map((c) => (
          <li key={c.name} className="flex min-w-0 items-baseline gap-2" title={tx("lu par {0}", c.by)}>
            <Badge tone={c.days < 7 ? "bad" : c.days <= CERT_SOON ? "warn" : "ok"}>{c.days < 0 ? tx("expiré") : tx("{0} j", c.days)}</Badge>
            <span className="truncate">{c.name}</span>
          </li>
        ))}
      </ul>
      {certs.length > 30 && <p className="mt-1 text-xs text-dim">{tx("Les 30 plus proches de l'expiration.")}</p>}
    </FoldPanel>
  );
}
