// État des services lus par leur API (connecteurs « status », aujourd'hui Home Assistant) : en ligne, version,
// entités, mises à jour disponibles (information, sans alerte). Affiché sous la barre de recherche de l'onglet Infra.
import { AlertTriangle, ArrowUpCircle, CheckCircle2, ChevronRight, Home, Layers, Plug, Puzzle } from "lucide-react";
import { useState } from "react";
import { ROOT } from "../api";
import { dur } from "../lib/format";
import type { ServiceStatus } from "../types";
import { tx } from "../lib/i18n";
import { Count } from "./ui";
import { CardHead } from "./InfraCards";

function Tile({ icon, value, label, tone }: { icon: React.ReactNode; value: string | number; label: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-bg2/60 px-3 py-2">
      <span className="text-dim" aria-hidden>{icon}</span>
      <div className="min-w-0"><div className={`font-mono text-base font-bold leading-tight ${tone ?? "text-txt"}`}>{value}</div><div className="truncate text-xs text-dim">{label}</div></div>
    </div>
  );
}

/** Mises à jour par famille : le cœur de Home Assistant (dit s'il est à jour), ses modules, puis les autres appareils */
const GROUPS: ["core" | "addon" | "other", string][] = [["core", tx("Home Assistant")], ["addon", tx("Modules complémentaires")], ["other", tx("Autres appareils et intégrations")]];

/** Gauge of the machine that hosts Home Assistant: value, bar, colour by threshold */
function HostGauge({ label, value, pct, warn = 80, bad = 90 }: { label: string; value: string; pct: number | null | undefined; warn?: number; bad?: number }) {
  if (pct == null) return null;
  const tone = pct >= bad ? "bad" : pct >= warn ? "warn" : "ok";
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-bg2/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2 text-xs"><span className="text-dim">{label}</span><b className={`font-mono text-sm ${tone === "ok" ? "text-txt" : tone === "warn" ? "text-warn" : "text-bad"}`}>{value}</b></div>
      <span className="block h-1.5 overflow-hidden rounded-full bg-bg2"><span className={`block h-full rounded-full ${tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-bad"}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>
    </div>
  );
}

/** Small list folded under a title with its count; open when it is short and worth a look */
function Fold({ title, tone, items, open }: { title: string; tone: "warn" | "off"; items: React.ReactNode[]; open?: boolean }) {
  if (!items.length) return null;
  return (
    <details className="group rounded-lg border border-line/60" open={open}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg2/50">
        <ChevronRight size={14} className="text-dim transition-transform group-open:rotate-90" aria-hidden />
        <span className={tone === "warn" ? "text-warn" : "text-muted"}>{title}</span><Count n={items.length} tone={tone === "warn" ? "warn" : "off"} />
      </summary>
      <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto border-t border-line/40 px-3 py-1.5 text-sm text-muted">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </details>
  );
}

/** Add-ons installed in Home Assistant, with their icon (read by the server with the token) and version; an update waiting in orange */
export function HaAddons({ s }: Readonly<{ s: ServiceStatus }>) {
  const list = s.addons ?? [];
  if (!list.length) return null;
  const iconUrl = (slug: string) => addonIconUrl(s, slug);
  return (
    <details className="group rounded-lg border border-line/60">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg2/50">
        <ChevronRight size={14} className="text-dim transition-transform group-open:rotate-90" aria-hidden />
        <span className="text-muted">{tx("Modules installés")}</span><Count n={list.length} tone="off" />
        {/* folded: the first icons, then « +N » for the others; open: the full list below */}
        <span className="ml-auto group-open:hidden"><AddonStrip s={s} /></span>
      </summary>
      <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto border-t border-line/40 p-2 sm:grid-cols-2">
        {list.map((a) => (
          <li key={a.slug} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-bg2/50" title={[a.name, a.version, a.latest && `→ ${a.latest}`].filter(Boolean).join(" ")}>
            <AddonIcon src={iconUrl(a.slug)} />
            <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
            {a.latest && <span className="shrink-0 font-mono text-[11px] text-warn">→ {a.latest}</span>}
            {!a.latest && a.version && <span className="shrink-0 truncate font-mono text-[11px] text-dim">{a.version}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

const PREVIEW = 7;   // icons shown on the folded list
const addonIconUrl = (s: ServiceStatus, slug: string) => `${ROOT}api/v1/ha/${encodeURIComponent(s.instance ?? s.name)}/addon-icon/${slug}`;

/** The first add-on icons of a Home Assistant, then « +N » for the others (names on hover): folded lists and machine cards */
export function AddonStrip({ s, max = PREVIEW }: Readonly<{ s: ServiceStatus; max?: number }>) {
  const list = s.addons ?? [];
  if (!list.length) return null;
  return (
    <span className="flex items-center gap-1" title={tx("Modules installés")}>
      {list.slice(0, max).map((a) => <AddonIcon key={a.slug} src={addonIconUrl(s, a.slug)} title={a.name} small />)}
      {list.length > max && <span className="rounded-md bg-bg2 px-1.5 py-0.5 text-[11px] font-semibold text-muted" title={list.slice(max).map((a) => a.name).join(", ")}>+{list.length - max}</span>}
    </span>
  );
}

/** Icon of an add-on; a puzzle piece when Home Assistant gives none. `small`: in the folded title */
function AddonIcon({ src, title, small = false }: Readonly<{ src: string; title?: string; small?: boolean }>) {
  const [failed, setFailed] = useState(false);
  const [box, img, glyph] = small ? ["h-5 w-5", "h-4 w-4", 11] : ["h-6 w-6", "h-5 w-5", 13];
  return (
    <span className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-md bg-bg2`} title={title}>
      {failed ? <Puzzle size={glyph} className="text-dim" aria-hidden /> : <img src={src} alt="" loading="lazy" className={`${img} object-contain`} onError={() => setFailed(true)} />}
    </span>
  );
}

/** Home Assistant: its state, the machine that hosts it (System Monitor), key figures, then what to look at, folded */
function HomeAssistantCard({ s }: { s: ServiceStatus }) {
  const ups = s.updates ?? [], core = ups.filter((u) => u.group === "core"), rest = ups.filter((u) => u.group !== "core");
  const h = s.host, disk = h?.disks?.[0];
  const up = h?.boot ? (Date.now() - Date.parse(h.boot)) / 1000 : null;
  const running = !s.state || s.state === "RUNNING";
  const unav = s.unavailable ?? 0, low = s.batteries_low ?? [], auto = s.automations;
  const upd = (u: NonNullable<ServiceStatus["updates"]>[number]) => <span className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-txt">{u.name}</span>{u.installed && u.latest && <span className="font-mono text-xs text-dim">{u.installed} → {u.latest}</span>}</span>;
  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ${!s.ok ? "border-bad/40" : core.length ? "border-warn/50" : "border-line"}`}>
      <CardHead c={s} kind={tx("Domotique")} icon={<Home size={20} className="text-muted" aria-hidden />} />
      {!s.ok && !s.stale ? <p className="m-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{s.message}</p> : (
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${core.length ? "bg-warn/10" : running ? "bg-ok/10" : "bg-bad/10"}`}>
            {core.length ? <ArrowUpCircle size={20} className="shrink-0 text-warn" aria-hidden /> : running ? <CheckCircle2 size={20} className="shrink-0 text-ok" aria-hidden /> : <AlertTriangle size={20} className="shrink-0 text-bad" aria-hidden />}
            <div className="min-w-0 text-sm">
              <b className={core.length ? "text-warn" : running ? "text-ok" : "text-bad"}>
                {!running ? tx("Home Assistant pas démarré ({0})", s.state ?? "?") : core.length ? tx("Mise à jour disponible : {0}", core[0].latest ?? "") : tx("Home Assistant à jour")}</b>
              {s.name && <span className="block truncate text-xs text-dim">{s.name}{up != null && up > 0 ? ` · ${tx("hôte allumé depuis {0}", dur(up))}` : ""}</span>}
            </div>
          </div>
          {h && (
            <div className="grid grid-cols-2 gap-2">
              <HostGauge label={tx("Processeur")} value={`${Math.round(h.cpu ?? 0)} %`} pct={h.cpu} />
              <HostGauge label={tx("Mémoire")} value={`${Math.round(h.mem_pct ?? 0)} %`} pct={h.mem_pct} />
              {disk && <HostGauge label={tx("Disque")} value={disk.size_gb && disk.size_gb !== 100 ? `${Math.round(disk.used_pct)} % · ${Math.round(disk.size_gb)} Go` : `${Math.round(disk.used_pct)} %`} pct={disk.used_pct} />}
              <HostGauge label={tx("Température")} value={`${Math.round(h.temp ?? 0)} °C`} pct={h.temp} warn={70} bad={80} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-bg2/60 px-2 py-2"><div className="font-mono text-lg font-bold leading-tight">{s.entities ?? "-"}</div><div className="text-[11px] text-dim">{tx("entités")}</div></div>
            <div className="rounded-lg bg-bg2/60 px-2 py-2"><div className={`font-mono text-lg font-bold leading-tight ${unav ? "text-warn" : "text-ok"}`}>{unav}</div><div className="text-[11px] text-dim">{tx("indisponibles")}</div></div>
            <div className="rounded-lg bg-bg2/60 px-2 py-2"><div className="font-mono text-lg font-bold leading-tight">{auto ? `${auto.on}/${auto.total}` : "-"}</div><div className="text-[11px] text-dim">{tx("automatisations actives")}</div></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Fold title={tx("Mises à jour de Home Assistant")} tone="warn" items={core.map(upd)} open />
            <Fold title={tx("Piles faibles (20 % ou moins)")} tone="warn" items={low} open={low.length <= 4} />
            <Fold title={tx("Entités indisponibles")} tone="off" items={[...(s.unavailable_names ?? []), ...(unav > (s.unavailable_names?.length ?? 0) ? [tx("… et {0} autres", unav - (s.unavailable_names?.length ?? 0))] : [])]} />
            <Fold title={tx("Autres mises à jour (modules, appareils)")} tone="off" items={rest.map(upd)} />
            <HaAddons s={s} />
          </div>
          {!!h?.ips?.length && <p className="font-mono text-xs text-dim">{h.ips.join(" · ")}</p>}
        </div>
      )}
    </article>
  );
}

export function ServiceCard({ s }: { s: ServiceStatus }) {
  if (s.connector === "home-assistant") return <HomeAssistantCard s={s} />;
  const ups = s.updates ?? [], group = (g: string) => ups.filter((u) => (u.group ?? "other") === g);
  const core = group("core").length, rest = ups.length - core;
  return (
            <article className={`flex flex-col overflow-hidden rounded-2xl border bg-card pb-3 shadow-sm ${s.ok ? "border-line" : "border-bad/40"}`}>
              <CardHead c={s} kind={tx("Service via API")} icon={<Plug size={20} className="text-muted" aria-hidden />} />
              {!s.ok && !s.stale ? <p className="mx-4 mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{s.message}</p> : (
                <div className="px-4">
                  {(s.facts?.length || s.problems) && (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {(s.facts ?? []).map((f) => <Tile key={f.label} icon={<Layers size={16} />} value={f.value} label={f.label} tone={f.tone === "bad" ? "text-bad" : f.tone === "warn" ? "text-warn" : f.tone === "ok" ? "text-ok" : undefined} />)}
                      </div>
                      {(s.problems ?? []).length > 0
                        ? <ul className="mt-2 flex flex-col gap-1 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{(s.problems ?? []).map((p, i) => <li key={i}>• {p}</li>)}</ul>
                        : <p className="mt-2 text-xs text-ok">{tx("Rien à signaler.")}</p>}
                    </>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {s.entities !== undefined && <Tile icon={<Layers size={16} />} value={s.entities} label={tx("entités")} />}
                    {s.updates && (core ? <Tile icon={<ArrowUpCircle size={16} />} value={core} label={tx("mise(s) à jour de Home Assistant")} tone="text-warn" />
                      : <Tile icon={<CheckCircle2 size={16} />} value="✓" label={tx("Home Assistant à jour")} tone="text-ok" />)}
                    {rest > 0 && <Tile icon={<Layers size={16} />} value={rest} label={tx("autres mises à jour (modules, appareils)")} tone="text-muted" />}
                  </div>
                  {ups.length > 0 && (
                    <details className="mt-2 text-sm" open={core > 0}>
                      <summary className="cursor-pointer text-muted hover:text-txt">{tx("Voir les mises à jour")}</summary>
                      {GROUPS.map(([g, title]) => group(g).length > 0 && (
                        <div key={g} className="mt-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">{title} <Count n={group(g).length} tone="off" /></h4>
                          <ul className="mt-1 flex flex-col gap-1 text-muted">
                            {group(g).slice(0, 8).map((u) => (
                              <li key={u.name} className="flex flex-wrap items-baseline gap-2">
                                <span className="text-txt">{u.name}</span>
                                {u.installed && u.latest && <span className="font-mono text-xs text-dim">{u.installed} → {u.latest}</span>}
                              </li>
                            ))}
                            {group(g).length > 8 && <li className="text-dim">… +{group(g).length - 8}</li>}
                          </ul>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}
            </article>
          );
}
