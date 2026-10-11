// Fail2ban, lu par LogviewR (connecteur « security ») : prisons, bannissements des dernières 24 h, menaces actives. Lecture seule.
import { Ban, ShieldAlert } from "lucide-react";
import type { Snapshot } from "../api";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { Badge, Card, Dim, Empty } from "../components/ui";

export function Fail2ban({ snap }: { snap: Snapshot }) {
  const items = snap.data.security ?? [];
  if (!items.length) return <Empty>{tx("LogviewR n'est pas relié : ajoutez le connecteur dans Réglages → Connecteurs.")}</Empty>;
  return (
    <div className="flex flex-col gap-4 py-1">
      {items.map((c) => {
        const bans = c.bans ?? [], byJail = new Map<string, number>();
        bans.forEach((b) => byJail.set(b.jail, (byJail.get(b.jail) ?? 0) + 1));
        return (
          <Card key={`${c.connector}/${c.name}`} className={c.ok ? "" : "border-bad/40"}>
            <h2 className="flex flex-wrap items-center gap-2 font-bold"><Ban size={16} aria-hidden />{c.label} <Dim>· {c.name}</Dim>
              <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>
              {c.version && <span className="font-mono text-xs text-dim">{c.version}</span>}
              {c.stale && <Badge tone="warn">{tx("relevé périmé")}</Badge>}</h2>
            {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-bg2/60 px-3 py-2"><div className="font-mono text-xl font-bold">{c.jails?.length ?? 0}</div><div className="text-xs text-dim">{tx("prisons")}</div></div>
                  <div className="rounded-lg bg-bg2/60 px-3 py-2"><div className="font-mono text-xl font-bold">{c.bans_24h ?? 0}</div><div className="text-xs text-dim">{tx("bannissements en 24 h")}</div></div>
                  <div className="rounded-lg bg-bg2/60 px-3 py-2"><div className={`font-mono text-xl font-bold ${(c.threat_count ?? 0) > 0 ? "text-bad" : ""}`}>{c.threat_count ?? 0}</div><div className="flex items-center gap-1 text-xs text-dim"><ShieldAlert size={12} aria-hidden />{tx("menaces actives")}</div></div>
                </div>
                {(c.jails ?? []).length > 0 && (
                  <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">{c.jails!.map((j) => <Badge key={j} tone={byJail.has(j) ? "warn" : "off"}>{j}{byJail.has(j) && ` · ${byJail.get(j)}`}</Badge>)}</p>
                )}
                {bans.length > 0 && (
                  <details className="mt-3 text-sm" open>
                    <summary className="cursor-pointer text-muted hover:text-txt">{tx("Derniers bannissements")} · {bans.length}</summary>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {bans.slice(0, 50).map((b, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-2"><code className="font-mono text-xs">{b.ip}</code><Badge tone="off">{b.jail}</Badge>
                          {b.failures ? <Dim>{b.failures} {tx("échecs")}</Dim> : null}<Dim>{b.time ? dateTime(b.time * 1000) : ""}</Dim></li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
