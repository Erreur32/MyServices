// DNS AdGuard : synchro entre instances, état de chaque instance, écarts et réécritures à revoir, puis les
// domaines NPM dont la résolution pose problème.
import { RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Snapshot } from "../api";
import { hm } from "../lib/format";
import { dnsSync, hostName } from "../lib/status";
import type { Selected } from "../lib/filter";
import { Badge, Empty, TableCard } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";

type Row = [label: string, value: string, tone?: "ok" | "warn" | "bad"];
const TEXT: Record<"ok" | "warn" | "bad", string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** Card of the page header (synchronisation, one per AdGuard server): coloured strip with icon, title, address and state, then label/value rows
 *  in two aligned columns separated by thin lines. */
function InfoCard({ icon, title, sub, tone, state, rows }: { icon: ReactNode; title: string; sub?: string; tone: "ok" | "warn" | "bad"; state: string; rows: Row[] }) {
  const strip = { ok: "bg-ok/10", warn: "bg-warn/10", bad: "bg-bad/10" }[tone], frame = { ok: "border-line", warn: "border-warn/50", bad: "border-bad/50" }[tone];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${strip}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-bg2">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold leading-tight">{title}</h3>
          {sub && <span className="block truncate font-mono text-xs text-dim">{sub}</span>}
        </div>
        <Badge tone={tone}>{state}</Badge>
      </div>
      <dl className="divide-y divide-line/60 text-sm">
        {rows.map(([k, v, t]) => (
          <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className={`text-right font-semibold ${t ? TEXT[t] : "text-txt"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** TableCard that the home page can aim at (click on a counter): the page scrolls to it and it is outlined in blue for a moment. */
function DataCard({ id, lit, ...rest }: { id?: string; lit?: string } & Parameters<typeof TableCard>[0]) {
  return <Anchor id={id} lit={lit}><TableCard {...rest} /></Anchor>;
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
  const all = [...g.rewrites_diff, ...g.user_rules_diff];
  const diff = all.filter((x) => !x.waiting), waiting = all.length - diff.length;   // a fresh difference waits one sync turn before it counts
  let content = tx("identique");
  if (diff.length) content = tx("{0} différence(s)", diff.length);
  else if (waiting) content = tx("{0} en attente de la synchro", waiting);
  return (
    <div className="flex flex-col gap-4 py-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card">
          {appIcon(["AdGuard Home"]) && <img src={appIcon(["AdGuard Home"])!} alt="" className="h-7 w-7" />}
        </span>
        <div><h2 className="text-lg font-bold leading-tight">AdGuard Home</h2><p className="text-sm text-muted">{tx("DNS du réseau : synchronisation, réécritures et domaines à vérifier")}</p></div>
      </header>
      <Anchor id="servers" lit={lit}><div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        <InfoCard icon={<RefreshCw size={18} className="text-muted" aria-hidden />} title={tx("Synchronisation")} sub={sync ? `${name(sync.origin)} → ${Object.keys(sync.last_done || {}).map(name).join(", ") || "?"}` : undefined}
          tone={st.cls} state={st.label}
          rows={[
            ...(sync ? [[tx("Dernière synchro"), last ? hm(last) : tx("aucune en 24 h"), st.cls === "bad" ? "bad" : undefined] as Row,
                        ...(sync.interval_min ? [[tx("Fréquence"), `${tx("toutes les")} ${sync.interval_min} ${tx("min")}`] as Row] : []),
                        [tx("Erreurs (24 h)"), String(sync.errors_24h || 0), sync.errors_24h ? "bad" : "ok"] as Row]
                    : [["adguardhome-sync", Object.keys(g.servers).length > 1 ? tx("absent : contenus comparés") : tx("sans objet")] as Row]),
            [tx("Contenu"), content, diff.length ? "warn" : "ok"] as Row,
          ]} />
        {Object.entries(g.servers).map(([ip, v]) => {
          const ok = v.readable && !v.silent;
          return (
            <InfoCard key={ip} icon={<img src={appIcon(["AdGuard Home"])!} alt="" className="h-5 w-5" />} title={v.name} sub={`${ip}${sync?.origin === ip ? tx(" · origine") : ""}`}
              tone={ok ? "ok" : "bad"} state={ok ? tx("répond") : v.readable ? tx("requêtes perdues") : tx("config illisible")}
              rows={[
                [tx("Réécritures"), v.readable ? String(v.rewrites) : "-"],
                [tx("Règles perso"), v.readable ? String(v.user_rules ?? "-") : "-"],
                [tx("Requêtes sans réponse"), String(v.silent), v.silent ? "bad" : "ok"],
                ...(v.container ? [[tx("Conteneur"), v.container] as Row] : []),
              ]} />
          );
        })}
      </div></Anchor>

      <DataCard title={tx("Présent sur une seule instance")} tone="bad" cols={[{ label: tx("Entrée"), className: "w-[55%]" }, { label: tx("Seulement sur") }]}
        rows={diff.map((x) => [x.rule ? <>{tx("règle")} {code(x.rule)}</> : code(`${x.domain} → ${x.answer}`), <b className="font-medium">{name(x.only)}</b>])}
        note={sync && st.cls === "warn" ? `Synchro à l'heure : sera recopié au prochain passage. Toujours modifier sur ${name(sync.origin)}.` : undefined} />
      <DataCard id="orphans" lit={lit} title={tx("Réécritures vers NPM sans host NPM actif")} tone="warn" cols={[{ label: tx("Domaine"), className: "w-[38%]" }, { label: tx("Réponse"), className: "w-[22%]" }, { label: tx("Pourquoi") }]}
        rows={g.orphans.map((x) => [<b className="font-medium">{x.domain}</b>, code(x.answer), <span className="text-muted">{x.why}</span>])} />
      <DataCard title={tx("Réécritures au nom invalide (jamais résolues)")} tone="warn" cols={[{ label: tx("Domaine"), className: "w-[55%]" }, { label: tx("Réponse") }]}
        rows={(g.invalid || []).map((x) => [<b className="font-medium">{x.domain}</b>, code(x.answer)])} />
      <DataCard title={tx("Réécritures directes, sans NPM")} tone="info" cols={[{ label: tx("Domaine"), className: "w-[55%]" }, { label: tx("Réponse") }]}
        rows={(g.direct || []).map((x) => [<b className="font-medium">{x.domain}</b>, code(x.answer)])} />
      <DataCard id="domains" lit={lit} title={tx("Domaines NPM à vérifier")} tone={rows.length ? "warn" : "ok"} cols={[{ label: tx("Domaine"), className: "w-[45%]" }, { label: tx("À vérifier") }]}
        rows={rows.map((r) => [<b className="font-medium">{hostName(r)}</b>, <span className="flex flex-wrap gap-1">{r.dns!.issues.map((x) => <Badge key={String(x[0])} tone="warn">{String(x[0]).replace("_", " ")}</Badge>)}</span>])}
        empty={tx("Tous les domaines NPM actifs résolvent pareil sur chaque AdGuard.")}
        note={`${tx("Chaque domaine des hosts NPM actifs est demandé à chaque AdGuard ; réécritures et règles perso lues dans AdGuardHome.yaml.")}${g.npm_ip ? ` NPM = ${g.npm_ip}.` : ""}`} />
    </div>
  );
}
