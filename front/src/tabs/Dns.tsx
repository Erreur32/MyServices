// DNS AdGuard : synchro entre instances, état de chaque instance, écarts et réécritures à revoir, puis les
// domaines NPM dont la résolution pose problème.
import { useEffect, useState, type ReactNode } from "react";
import type { Snapshot } from "../api";
import { hm } from "../lib/format";
import { dnsSync, hostName } from "../lib/status";
import type { Rewrite } from "../types";
import type { Selected } from "../lib/filter";
import { Badge, Card, Dim, Empty } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";

function Kv({ k, children, tone }: { k: string; children: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted">{k}</span>
      <b className={`text-right font-medium ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : ""}`}>{children}</b>
    </div>
  );
}

function List({ title, tone, items, render, note, id, lit }: { title: string; tone: "bad" | "warn" | "info"; items: Rewrite[]; render: (x: Rewrite) => ReactNode; note?: string; id?: string; lit?: string }) {
  if (!items.length) return null;
  return (
    <Anchor id={id} lit={lit}>
    <Card>
      <h3 className="mb-2 flex items-center gap-2 font-bold">
        {title}<Badge tone={tone === "info" ? "off" : tone}>{items.length}</Badge>
      </h3>
      {note && <p className="mb-2 text-sm text-muted">{note}</p>}
      <ul className="flex flex-col gap-1 text-sm">{items.map((x, i) => <li key={i}>{render(x)}</li>)}</ul>
    </Card>
    </Anchor>
  );
}

/** Bloc que l'accueil peut viser (clic sur un compteur) : la page défile jusqu'à lui et il s'entoure de bleu un instant */
function Anchor({ id, lit, children }: { id?: string; lit?: string; children: ReactNode }) {
  return <div id={id && `dns-${id}`} className={`scroll-mt-24 rounded-2xl transition-shadow duration-500 ${id && lit === id ? "ring-2 ring-link" : ""}`}>{children}</div>;
}

const code = (t: string) => <code className="rounded bg-bg2 px-1.5 py-0.5 font-mono text-xs">{t}</code>;

export function Dns({ snap, initial }: { snap: Snapshot; initial?: Selected }) {
  const g = snap.data.dns;
  const want = initial?.anchor?.[0];
  const [lit, setLit] = useState(want);
  useEffect(() => {
    if (!want) return;
    document.getElementById(`dns-${want}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setLit(undefined), 2500);
    return () => clearTimeout(t);
  }, [want]);
  if (!g) return <Empty>{tx("AdGuard n'est pas configuré.")}</Empty>;
  const st = dnsSync(g), sync = Object.values(g.sync || {})[0];
  const name = (ip?: string) => (ip && g.servers[ip]?.name) || ip || "?";
  const last = sync?.last_done ? Math.max(...Object.values(sync.last_done).map((t) => new Date(t).getTime())) : null;
  const rows = snap.data.hosts.filter((r) => r.dns && r.enabled && r.dns.issues.length);
  const diff = [...g.rewrites_diff, ...g.user_rules_diff];
  return (
    <div className="flex flex-col gap-4 py-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card">
          {appIcon(["AdGuard Home"]) && <img src={appIcon(["AdGuard Home"])!} alt="" className="h-7 w-7" />}
        </span>
        <div><h2 className="text-lg font-bold leading-tight">AdGuard Home</h2><p className="text-sm text-muted">{tx("DNS du réseau : synchronisation, réécritures et domaines à vérifier")}</p></div>
      </header>
      <Anchor id="servers" lit={lit}><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card className={st.cls === "ok" ? "" : st.cls === "warn" ? "border-warn/50" : "border-bad/50"}>
          <h3 className="mb-2 flex flex-wrap items-center gap-x-2 font-bold">{tx("Synchronisation")} <Badge tone="info">AdGuard</Badge></h3>
          <p className={`mb-3 text-lg font-bold ${st.cls === "ok" ? "text-ok" : st.cls === "warn" ? "text-warn" : "text-bad"}`}>{st.label}</p>
          {sync ? <>
            <Kv k={tx("Sens")}>{name(sync.origin)} → {Object.keys(sync.last_done || {}).map(name).join(", ") || "?"}</Kv>
            <Kv k={tx("Dernière synchro")} tone={st.cls === "bad" ? "bad" : undefined}>{last ? hm(last) : tx("aucune en 24 h")}</Kv>
            {sync.interval_min && <Kv k={tx("Fréquence")}>{tx("toutes les")} {sync.interval_min} {tx("min")}</Kv>}
            <Kv k={tx("Erreurs (24 h)")} tone={sync.errors_24h ? "bad" : "ok"}>{sync.errors_24h || 0}</Kv>
          </> : <Kv k="adguardhome-sync">{Object.keys(g.servers).length > 1 ? tx("absent : contenus comparés") : tx("sans objet")}</Kv>}
          <Kv k={tx("Contenu")} tone={diff.length ? "warn" : "ok"}>{diff.length ? tx("{0} différence(s)", diff.length) : tx("identique")}</Kv>
        </Card>
        {Object.entries(g.servers).map(([ip, v]) => {
          const ok = v.readable && !v.silent;
          return (
            <Card key={ip} className={ok ? "" : "border-bad/50"}>
              <h3 className="mb-2 flex flex-wrap items-center gap-x-2 font-bold">{v.name} <Badge tone="info">AdGuard</Badge><Dim>· {ip}{sync?.origin === ip ? tx(" · origine") : ""}</Dim></h3>
              <p className={`mb-3 text-lg font-bold ${ok ? "text-ok" : "text-bad"}`}>{ok ? tx("répond") : v.readable ? tx("requêtes perdues") : tx("config illisible")}</p>
              <Kv k={tx("Réécritures")}>{v.readable ? v.rewrites : "—"}</Kv>
              <Kv k={tx("Règles perso")}>{v.readable ? v.user_rules ?? "—" : "—"}</Kv>
              <Kv k={tx("Requêtes sans réponse")} tone={v.silent ? "bad" : "ok"}>{v.silent}</Kv>
              {v.container && <Kv k={tx("Conteneur")}>{v.container}</Kv>}
            </Card>
          );
        })}
      </div></Anchor>

      <List title={tx("Présent sur une seule instance")} tone="bad" items={diff}
        render={(x) => <>{x.rule ? <>{tx("règle")} {code(x.rule)}</> : code(`${x.domain} → ${x.answer}`)} <Dim>{tx("seulement sur")} {name(x.only)}</Dim></>}
        note={sync && st.cls === "warn" ? `Synchro à l'heure : sera recopié au prochain passage. Toujours modifier sur ${name(sync.origin)}.` : undefined} />
      <List id="orphans" lit={lit} title={tx("Réécritures vers NPM sans host NPM actif")} tone="warn" items={g.orphans}
        render={(x) => <>{code(`${x.domain} → ${x.answer}`)} <Dim>{x.why}</Dim></>} />
      <List title={tx("Réécritures au nom invalide (jamais résolues)")} tone="warn" items={g.invalid || []}
        render={(x) => code(`${x.domain} → ${x.answer}`)} />
      <List title={tx("Réécritures directes, sans NPM")} tone="info" items={g.direct || []}
        render={(x) => code(`${x.domain} → ${x.answer}`)} />

      <Anchor id="domains" lit={lit}><Card>
        <h3 className="mb-2 font-bold">{tx("Domaines NPM à vérifier")} <Badge tone={rows.length ? "warn" : "ok"}>{rows.length}</Badge></h3>
        {rows.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((r) => <li key={`${r.type}${r.id}`}><b>{hostName(r)}</b> <Dim>· {r.dns!.issues.map((x) => String(x[0]).replace("_", " ")).join(", ")}</Dim></li>)}
          </ul>
        ) : <p className="text-sm text-ok">{tx("Tous les domaines NPM actifs résolvent pareil sur chaque AdGuard.")}</p>}
        <p className="mt-3 text-xs text-dim">
          {tx("Chaque domaine des hosts NPM actifs est demandé à chaque AdGuard ; réécritures et règles perso lues dans AdGuardHome.yaml.")}{g.npm_ip ? ` NPM = ${g.npm_ip}.` : ""}
        </p>
      </Card></Anchor>
    </div>
  );
}
