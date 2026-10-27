// Network in « state » mode: a title line, five figures and « To watch » (equipment offline, a network connector failing, what the
// box or firewall reports, firmware updates, weak Wi-Fi links) above the sub-menu: Cards (scan statistics, UniFi cards), Equipment and
// devices (Internet access, UniFi gear, clients by access point or switch, devices found by MynetworK, with search and filters),
// Diagnostic. Shown only when one of these sources answers or has answered. Read only.
import { usePageView } from "../lib/route";
import { Cable, ChevronDown, ChevronRight, Monitor, Network as NetworkIcon, Router, Wifi, type LucideIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { dur } from "../lib/format";
import { tx } from "../lib/i18n";
import { NETWORK_CARDS, hasNetwork } from "../lib/network";
import type { ServiceStatus } from "../types";
import { Badge, Cards, Count, Dim, Empty, FilterBar, Table, Td, Th } from "../components/ui";
import { quiet } from "../lib/forms";
import { StatTile } from "../components/StatTile";
import { Dot } from "../components/marks";
import { ServiceCard } from "../components/ServiceStatusCards";
import { NetworkDiagnostic } from "./NetworkDiagnostic";
import { NetworkScanStats } from "./NetworkScanStats";
import { UnifiCards } from "./UnifiCards";
import { HeadTags } from "../components/HeadTags";
import { ConnectorsLink, PageHead } from "../components/PageHead";

const INTERNET = ["freebox", "opnsense", "speedtest-tracker"];
type Kind = "gear" | "wifi" | "wired" | "device";
const KIND: Record<Kind, string> = { gear: tx("Équipement réseau"), wifi: tx("Client wifi"), wired: tx("Client filaire"), device: tx("Appareil trouvé") };

type Gear = { name?: string | null; model?: string | null; type?: string | null; mac?: string | null; ip?: string | null; state?: string | null; version?: string | null;
  clients?: number | null; uptime?: number | null; online?: boolean; updatable?: boolean };
type Client = { name?: string | null; ip?: string | null; mac?: string | null; wired?: boolean | null; essid?: string | null; signal_dbm?: number | null;
  ap_mac?: string | null; switch_mac?: string | null; switch_port?: number | null };
type UnifiLists = { clients?: Client[]; devices?: Gear[] } | null | undefined;

/** One line of the page, whatever its source: the filters apply to all of them */
interface Row {
  key: string; kind: Kind; name: string; ip: string; mac: string; up: boolean; source: string;
  vendor: string;        // maker or model
  via: string;           // access point or switch of a client
  detail: string;        // port, Wi-Fi network and signal, ping
  machine: string | null; // followed machine of that IP
  gear?: Gear;
  signal?: number | null; // Wi-Fi client: its signal, dBm
}

const WEAK_DBM = -75;   // a Wi-Fi link under this is poor (drops, low rate)

interface Watch { key: string; sev: "bad" | "warn"; area: string; title: string; detail: string; sub: Sub; href?: string }

/** What needs a look on the network, red first: gear offline, a source failing, what the Internet access reports, firmware updates, weak Wi-Fi links */
/** What the Internet access cards report (the Freebox ones open its own sub-tab) */
function internetWatch(internet: ServiceStatus[]): Watch[] {
  return internet.filter((x) => x.ok && x.connector !== "unifi").flatMap((c) => (c.problems ?? []).map((pb): Watch => (
    { key: `net/${c.name}/${pb}`, sev: "warn", area: c.label, title: pb, detail: "", sub: c.connector === "freebox" ? "freebox" : "list" })));
}

function toWatch(rows: Row[], internet: ServiceStatus[], sources: { label: string; ok: boolean; message: string; stale?: boolean }[]): Watch[] {
  const out: Watch[] = [];
  for (const c of sources.filter((x) => !x.ok)) out.push({ key: `src/${c.label}`, sev: "bad", area: tx("Source"), title: c.label, detail: c.stale ? c.message + " (" + tx("dernier relevé gardé") + ")" : c.message, sub: "diagnostic" });
  for (const r of rows.filter((x) => x.kind === "gear" && !x.up)) out.push({ key: `down/${r.key}`, sev: "bad", area: tx("Équipement"), title: r.name, detail: tx("hors ligne"), sub: "list", href: r.machine ? `#machines/${r.ip}` : undefined });
  out.push(...internetWatch(internet));
  for (const r of rows.filter((x) => x.kind === "gear" && x.up && x.gear?.updatable)) out.push({ key: `upd/${r.key}`, sev: "warn", area: tx("Équipement"), title: r.name, detail: tx("mise à jour disponible (installée : {0})", r.gear?.version || "?"), sub: "list" });
  for (const r of rows.filter((x) => x.kind === "wifi" && x.signal != null && x.signal < WEAK_DBM)) out.push({ key: `wifi/${r.key}`, sev: "warn", area: tx("Wifi"), title: r.name, detail: tx("signal faible, {0} dBm sur {1}", r.signal, r.via), sub: "list", href: r.machine ? `#machines/${r.ip}` : undefined });
  return out.sort((a, b) => Number(b.sev === "bad") - Number(a.sev === "bad"));
}

const mac = (m?: string | null) => (m || "").toLowerCase();
const gearUp = (g: Gear) => g.online ?? !/offline|disconnect|interrupt|isolat/i.test(String(g.state ?? "online"));

const FOLD_KEY = "ms.network.folded";
/** Folded sections when the person never chose: all but the Internet access and gateways */
const ALL_BUT_INTERNET = ["others", "gear", "clients", "devices"];

/** Which sections the person folded, remembered in this browser only (null: never chosen, the page picks; works without storage) */
function useFolded(): [string[] | null, (next: string[]) => void] {
  const [stored, setStored] = useState<string[] | null>(() => {
    try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "null"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null; } catch { return null; }
  });
  const save = (next: string[]) => { setStored(next); try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* navigation privée : tant pis */ } };
  return [stored, save];
}

/** A framed section: a dark header strip that folds and unfolds the content (title, count, chevron) */
function FoldSection({ id, icon: Icon, title, n, folded, onToggle, children }: Readonly<{ id: string; icon: LucideIcon; title: string; n?: number; folded: boolean; onToggle: () => void; children: React.ReactNode }>) {
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <h2 className="m-0">
        <button type="button" onClick={onToggle} aria-expanded={!folded}
          className={`flex w-full items-center gap-2 bg-bg px-4 py-3 text-left hover:bg-bg2/60 ${folded ? "" : "border-b border-line/60"}`}>
          {folded ? <ChevronRight size={15} className="text-dim" aria-hidden /> : <ChevronDown size={15} className="text-dim" aria-hidden />}
          <Icon size={15} className="text-muted" aria-hidden /><span className="text-sm font-bold">{title}</span>{n != null && <Count n={n} tone="off" />}
        </button>
      </h2>
      {!folded && <div className="flex flex-col gap-3 p-4">{children}</div>}
    </section>
  );
}

const State = ({ up }: { up: boolean }) => <Badge tone={up ? "ok" : "off"}>{up ? tx("en ligne") : tx("hors ligne")}</Badge>;

/** Rows of every source: UniFi equipment and clients (MynetworK and the UniFi connector merged by MAC, the direct connector last: fresher)
 * and the devices of the network inventory */
function buildRows(snap: Snapshot, cards: ServiceStatus[]): Row[] {
  const net = snap.data.network ?? [];
  const followed = new Map(snap.data.machine_list.map((m) => [m.ip, m.name]));
  const lists: [string, UnifiLists][] = [...net.map((c): [string, UnifiLists] => [c.label, c.unifi as UnifiLists]),
    ...cards.filter((c) => c.connector === "unifi").map((c): [string, UnifiLists] => [c.label, (c as ServiceStatus & { unifi?: UnifiLists }).unifi])];
  const gear = new Map<string, Gear & { source: string }>(), clients = new Map<string, Client & { source: string }>();
  for (const [source, u] of lists) {
    for (const d of u?.devices ?? []) { const k = mac(d.mac) || `${source}/${d.name}`; gear.set(k, { ...gear.get(k), ...d, source }); }
    for (const c of u?.clients ?? []) { const k = mac(c.mac) || `${c.ip}/${c.name}`; clients.set(k, { ...clients.get(k), ...c, source }); }
  }
  const nameOf = (m?: string | null) => (m && gear.get(mac(m))?.name) || "";
  const rows: Row[] = [...gear.entries()].map(([k, g]) => ({
    key: `g/${k}`, kind: "gear", name: g.name || g.mac || "?", ip: g.ip || "", mac: g.mac || "", up: gearUp(g), source: g.source,
    vendor: [g.model, g.type].filter(Boolean).join(" · "), via: "", detail: "", machine: (g.ip && followed.get(g.ip)) || null, gear: g,
  }));
  for (const [k, c] of clients) {
    const via = nameOf(c.wired ? c.switch_mac : c.ap_mac);
    rows.push({ key: `c/${k}`, kind: c.wired ? "wired" : "wifi", name: c.name || c.mac || "?", ip: c.ip || "", mac: c.mac || "", up: true, source: c.source,
      vendor: "", via: via || (c.wired ? tx("switch inconnu") : tx("borne inconnue")), machine: (c.ip && followed.get(c.ip)) || null, signal: c.wired ? null : c.signal_dbm,
      detail: c.wired ? (c.switch_port != null ? tx("port {0}", c.switch_port) : "") : [c.essid, c.signal_dbm != null ? `${c.signal_dbm} dBm` : ""].filter(Boolean).join(" · ") });
  }
  for (const c of net) for (const d of c.devices ?? []) {
    rows.push({ key: `d/${c.name}/${d.ip}`, kind: "device", name: d.hostname || "", ip: d.ip, mac: d.mac || "", up: d.status === "online", source: c.label,
      vendor: d.vendor || "", via: "", detail: d.ping_ms != null ? `${Math.round(d.ping_ms)} ms` : "", machine: followed.get(d.ip) || null });
  }
  return rows;
}

/** A UniFi gateway (Dream Machine, Cloud Gateway, Security Gateway…), by its type, model or name */
const isGateway = (r: Row) => /^(ud|ucg|uxg|usg|ugw|udr|ux|cloud gateway)/i.test(`${r.gear?.type ?? ""} ${r.gear?.model ?? ""}`.trim()) || /gateway/i.test(r.name);

/** UniFi at a glance, next to the Freebox: gateway (UniFi OS console), its version and uptime, equipment online, clients, updates. Built from the
 * merged lists, so it shows with MynetworK alone; the UniFi connector's own card replaces it only when that connector fails. */
function unifiCard(rows: Row[], conn: ServiceStatus | undefined): ServiceStatus | null {
  const gear = rows.filter((r) => r.kind === "gear");
  if (!gear.length) return null;
  const gw = gear.find(isGateway);
  const down = gear.filter((r) => !r.up), upd = gear.filter((r) => r.gear?.updatable);
  const n = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const facts: NonNullable<ServiceStatus["facts"]> = [];
  if (gw) facts.push({ label: tx("Passerelle"), value: [gw.name, gw.gear?.model].filter(Boolean).join(" · "), tone: gw.up ? "ok" : "bad" });
  if (gw?.gear?.uptime) facts.push({ label: tx("Allumée depuis"), value: dur(gw.gear.uptime) });
  facts.push({ label: tx("Équipements"), value: tx("{0}/{1} en ligne", gear.length - down.length, gear.length), tone: down.length ? "bad" : "ok" },
             { label: tx("Clients wifi"), value: String(n("wifi")) }, { label: tx("Clients filaires"), value: String(n("wired")) });
  if (upd.length) facts.push({ label: tx("Mises à jour"), value: String(upd.length), tone: "warn" });
  return { connector: "unifi", name: conn?.name ?? "unifi", label: "UniFi Network", ok: true, stale: !!conn?.stale, message: "OK",
           version: gw?.gear?.version ?? null, url: conn?.url ?? (gw?.ip ? `https://${gw.ip}` : null), facts,
           problems: [...down.map((r) => tx("« {0} » hors ligne", r.name)), ...upd.map((r) => tx("« {0} » : mise à jour disponible", r.name))] };
}

const ipKey = (ip: string) => ip.split(".").map((x) => x.padStart(3, "0")).join(".");

function MachineLink({ r, onMachine }: { r: Row; onMachine: (ip: string) => void }) {
  return r.machine
    ? <button type="button" onClick={() => onMachine(r.ip)} className="inline-flex items-center gap-1.5 text-left font-semibold hover:text-link" title={tx("Voir ses services")}><Monitor size={13} aria-hidden />{r.machine}</button>
    : <Dim>{tx("pas suivie")}</Dim>;
}

/** The views of the page, sub-pages of « Réseau › Vue » in the side menu (#network/<view>); UniFi, Freebox and Scan only when their source is there */
const SUBS = ["watch", "unifi", "freebox", "scan", "list", "diagnostic"] as const;
type Sub = (typeof SUBS)[number];

type Tone3 = "ok" | "warn" | "bad" | undefined;
interface Fig { n: string | number; tone: Tone3; sub: string }

/** Internet access: the box or firewall card, its first worrying fact under it */
function boxFigure(box?: ServiceStatus, fact?: { label: string; value: string }): Fig {
  if (!box) return { n: "-", tone: undefined, sub: tx("aucune box ni pare-feu relié") };
  const clean = box.ok && !(box.problems ?? []).length;
  return { n: box.ok ? "OK" : tx("erreur"), tone: clean ? "ok" : "warn", sub: fact ? `${fact.label} : ${fact.value}` : box.label };
}

/** Equipment online, with the firmware updates available */
function gearFigure(gearAll: Row[], gearDown: number, updates: number): Fig {
  if (!gearAll.length) return { n: "-", tone: undefined, sub: tx("aucun UniFi relié") };
  return { n: `${gearAll.length - gearDown}/${gearAll.length}`, tone: gearDown ? "bad" : "ok", sub: updates ? tx("{0} mise(s) à jour disponible(s)", updates) : tx("à jour") };
}

/** Devices online, with the ones not followed as a machine */
function devFigure(devAll: Row[], unfollowed: number): Fig {
  if (!devAll.length) return { n: "-", tone: undefined, sub: tx("tous suivis") };
  return { n: `${devAll.filter((r) => r.up).length}/${devAll.length}`, tone: unfollowed ? "warn" : "ok", sub: unfollowed ? tx("{0} pas suivi(s) comme machine", unfollowed) : tx("tous suivis") };
}

/** The five figures above the sub-menu */
function Figures({ box, boxFact, gearAll, gearDown, updates, wifi, wired, devAll, unfollowed, sourceNames, failing }: Readonly<{
  box?: ServiceStatus; boxFact?: { label: string; value: string }; gearAll: Row[]; gearDown: number; updates: number; wifi: number; wired: number; devAll: Row[]; unfollowed: number; sourceNames: string[]; failing: number;
}>) {
  const b = boxFigure(box, boxFact), g = gearFigure(gearAll, gearDown, updates), d = devFigure(devAll, unfollowed);
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      <StatTile n={b.n} label={tx("Accès Internet")} tone={b.tone} sub={b.sub} />
      <StatTile n={g.n} label={tx("Équipements en ligne")} tone={g.tone} sub={g.sub} />
      <StatTile n={wifi + wired} label={tx("Clients")} sub={tx("{0} wifi · {1} filaires", wifi, wired)} />
      <StatTile n={d.n} label={tx("Appareils en ligne")} tone={d.tone} sub={d.sub} />
      <StatTile n={sourceNames.length} label={tx("Sources")} tone={failing ? "bad" : "ok"} sub={failing ? tx("{0} en erreur", failing) : sourceNames.join(", ")} />
    </div>
  );
}

/** A row of the list in alert, as the menu's dot counts it: gear offline or with an update, weak Wi-Fi */
const rowAlert = (r: Row) => (r.kind === "gear" && (!r.up || !!r.gear?.updatable)) || (r.kind === "wifi" && r.signal != null && r.signal < WEAK_DBM);
/** The alerts that are not rows of the list (a source failing, what the Internet access reports): shown above it on « Alerts » */
const outsideList = (w: Watch) => w.key.startsWith("src/") || w.key.startsWith("net/");

/** The alerts that are no row of the list, one row each, with a button to where they are */
function AlertsAbove({ watch, open }: Readonly<{ watch: Watch[]; open: (w: Watch) => void }>) {
  const bad = watch.some((w) => w.sev === "bad");
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${bad ? "border-bad/50" : "border-warn/50"}`} aria-label={tx("Alertes hors liste")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
            <th className="px-3 py-2">{tx("Domaine")}</th><th className="px-3 py-2">{tx("Quoi")}</th><th className="px-3 py-2">{tx("Détail")}</th><th className="w-28 px-3 py-2" />
          </tr></thead>
          <tbody>
            {watch.map((w) => (
              <tr key={w.key} className="border-t border-line/60 even:bg-bg/50 hover:bg-bg2/40">
                <td className="px-3 py-2"><Badge tone={w.sev}>{w.area}</Badge></td>
                <td className="px-3 py-2 font-semibold">{w.title}</td>
                <td className="px-3 py-2 text-muted">{w.detail}</td>
                <td className="px-3 py-2 text-right"><button type="button" onClick={() => open(w)} className={`${quiet} py-1`}>{w.href ? tx("Ouvrir") : tx("Voir")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const alertMark = () => <Dot tone="bad" />;
const FACETS: Facet<Row>[] = [   // the filters of the list; « Alerts » is ticked by the menu's dot
  { key: "alert", label: tx("Alertes"), get: (r) => (rowAlert(r) ? "on" : ""), name: () => tx("en alerte"), mark: alertMark },
  { key: "kind", label: tx("Type"), get: (r) => r.kind, name: (v) => KIND[v as Kind], order: ["gear", "wifi", "wired", "device"] },
  { key: "state", label: tx("État"), get: (r) => (r.up ? "up" : "down"), name: (v) => (v === "up" ? tx("en ligne") : tx("hors ligne")), order: ["up", "down"],
    mark: (v) => <Dot tone={v === "up" ? "ok" : "off"} /> },
  { key: "followed", label: tx("Suivi"), get: (r) => (r.machine ? "yes" : "no"), name: (v) => (v === "yes" ? tx("machine suivie") : tx("pas suivie")), order: ["yes", "no"] },
  { key: "via", label: tx("Borne ou switch"), get: (r) => r.via },
  { key: "vendor", label: tx("Fabricant ou modèle"), get: (r) => r.vendor },
  { key: "source", label: tx("Source"), get: (r) => r.source },
];

/** The view shown: « To watch » is no longer a page (the list on « Alerts »); a source gone (no UniFi, no Freebox): the first view there is */
function currentView(view: Sub, has: Record<Sub, boolean>, first: Sub): Sub {
  if (view === "watch") return "list";
  return has[view] ? view : first;
}

export function Network({ snap, onMachine, route, initial }: Readonly<{ snap: Snapshot; onMachine: (ip: string) => void; route: string; initial?: Selected }>) {
  const pickSub = (v: Sub) => { location.hash = `network/${v}`; };
  const cards = useMemo(() => (snap.data.services_status ?? []).filter((c) => NETWORK_CARDS.includes(c.connector)), [snap.data.services_status]);
  const rows = useMemo(() => buildRows(snap, cards), [snap, cards]);
  const text = useCallback((r: Row) => [r.name, r.ip, r.mac, r.vendor, r.via, r.detail, r.machine ?? "", r.gear?.version ?? ""].join(" "), []);
  const f = useFilter(rows, FACETS, text, route.startsWith("#network/watch") ? { alert: ["on"] } : initial);   // the old « To watch » address: the alerts
  const alertOn = !!f.sel.alert?.length;
  const keyOf = useCallback((r: Row, k: string): string | number => k === "ip" ? ipKey(r.ip) : k === "state" ? Number(!r.up) : k === "machine" ? r.machine ?? "~" : String(r[k as keyof Row] ?? "").toLowerCase(), []);
  const [stored, saveFolded] = useFolded();
  const gearSort = useSort(f.shown.filter((r) => r.kind === "gear"), keyOf, "state");
  const devSort = useSort(f.shown.filter((r) => r.kind === "device"), keyOf, "ip");
  const net = snap.data.network ?? [];
  const unifiConn = cards.find((c) => c.connector === "unifi");
  const unifi = unifiConn && !unifiConn.ok && !unifiConn.stale ? unifiConn : unifiCard(rows, unifiConn);   // a failing connector shows its error
  const internet = [...cards.filter((c) => c.connector === "freebox"), ...(unifi ? [unifi] : []), ...cards.filter((c) => INTERNET.includes(c.connector) && c.connector !== "freebox")];
  const others = cards.filter((c) => !INTERNET.includes(c.connector) && c.connector !== "unifi");
  const freebox = cards.find((c) => c.connector === "freebox");
  const has: Record<Sub, boolean> = { watch: true, unifi: !!unifi, freebox: !!freebox, scan: net.some((c) => c.connector === "mynetwork"), list: true, diagnostic: true };
  const all = (k: Kind) => rows.filter((r) => r.kind === k);
  const gearAll = all("gear"), gearDown = gearAll.filter((r) => !r.up).length, updates = gearAll.filter((r) => r.gear?.updatable).length;
  const devAll = all("device"), unfollowed = devAll.filter((r) => r.up && !r.machine).length;
  const groups = new Map<string, Row[]>();
  for (const r of f.shown) if (r.kind === "wifi" || r.kind === "wired") groups.set(`${r.kind}/${r.via}`, [...(groups.get(`${r.kind}/${r.via}`) ?? []), r]);
  const clientsShown = [...groups.values()].reduce((n, l) => n + l.length, 0);
  const effective = stored ?? ALL_BUT_INTERNET;   // never chosen: everything starts folded except the Internet access and gateways
  const isFolded = (id: string) => !alertOn && effective.includes(id);   // on « Alerts », every section open: the rows in alert are seen at once
  const toggleFold = (id: string) => saveFolded(isFolded(id) ? effective.filter((x) => x !== id) : [...effective, id]);
  const setFolded = (ids: string[], on: boolean) => saveFolded(on ? [...new Set([...effective, ...ids])] : effective.filter((x) => !ids.includes(x)));
  // The menu: every section that has something to show, to jump to it (it unfolds first) or to fold them all
  const sections: { key: string; id: string; icon: LucideIcon; title: string; n: number }[] = [
    { key: "internet", id: "net-internet", icon: Router, title: tx("Accès Internet"), n: internet.length },
    { key: "others", id: "net-others", icon: Cable, title: tx("Outils réseau"), n: others.length },
    { key: "gear", id: "net-gear", icon: Router, title: tx("Équipements"), n: gearSort.sorted.length },
    { key: "clients", id: "net-clients", icon: Wifi, title: tx("Clients"), n: clientsShown },
    { key: "devices", id: "net-devices", icon: Monitor, title: tx("Appareils"), n: devSort.sorted.length },
  ].filter((x) => x.n > 0);
  const jump = (key: string, id: string) => { setFolded([key], false); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  const watch = toWatch(rows, internet, net);
  const box = internet.find((c) => c.connector !== "unifi"), boxFact = box?.facts?.find((x) => x.tone === "bad" || x.tone === "warn") ?? box?.facts?.[0];
  const gearKinds = { gw: gearAll.filter(isGateway).length, sw: gearAll.filter((r) => /switch|^usw|^us-/i.test(`${r.gear?.type ?? ""} ${r.gear?.model ?? ""}`)).length };
  const gearWords = [gearKinds.gw ? tx("{0} passerelle(s)", gearKinds.gw) : "", gearKinds.sw ? tx("{0} switch(es)", gearKinds.sw) : "", gearAll.length - gearKinds.gw - gearKinds.sw > 0 ? tx("{0} borne(s)", gearAll.length - gearKinds.gw - gearKinds.sw) : ""].filter(Boolean);
  const sourceNames = [...new Set([...net.map((c) => c.label), ...cards.map((c) => c.label)])];
  const failing = net.filter((c) => !c.ok).length;
  const openWatch = (w: Watch) => { if (w.href) location.hash = w.href.slice(1); else pickSub(w.sub); };
  const firstView = SUBS.find((v) => v !== "watch" && has[v])!;
  const view = usePageView(route, "network", SUBS, initial?.alert ? "list" : firstView);   // the menu's dot: the list on « Alerts »
  const current = currentView(view, has, firstView);
  if (!hasNetwork(snap)) return <Empty>{tx("Aucune source réseau : reliez MynetworK, UniFi, OPNsense ou NetAlertX dans Réglages → Connecteurs.")}</Empty>;

  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={NetworkIcon} title={tx("Réseau")} tags={<HeadTags counts={gearWords} others={devAll.length > 0 ? [tx("{0} appareils", devAll.length)] : []} sources={sourceNames} at={snap.data.generated} />} actions={snap.me.role === "admin" && <ConnectorsLink />} />
      <Figures box={box} boxFact={boxFact} gearAll={gearAll} gearDown={gearDown} updates={updates} wifi={all("wifi").length} wired={all("wired").length} devAll={devAll} unfollowed={unfollowed} sourceNames={sourceNames} failing={failing} />

      {current === "unifi" && <UnifiCards />}
      {current === "freebox" && freebox && <div className="grid items-start gap-3 lg:grid-cols-2"><ServiceCard s={freebox} /></div>}
      {current === "scan" && <NetworkScanStats />}

      {current === "diagnostic" && <NetworkDiagnostic admin={snap.me.role === "admin"} />}

      {current === "list" && (
        <>
        {alertOn && watch.some(outsideList) && <AlertsAbove watch={watch.filter(outsideList)} open={openWatch} />}
        {rows.length > 0 && <FilterBar f={f} placeholder={tx("Nom, IP, MAC, fabricant, borne…")} primary={["alert", "kind", "state"]} oneLine />}{/* right under the menu, with its main filters shown */}

        {sections.length > 1 && (
          <nav aria-label={tx("Sections de la page")} className="flex flex-wrap items-center gap-1.5">
            {sections.map((x) => (
              <button key={x.key} type="button" onClick={() => jump(x.key, x.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-sm text-muted hover:border-link hover:text-txt">
                <x.icon size={13} aria-hidden />{x.title}<span className="font-mono text-xs text-dim">{x.n}</span>
              </button>
            ))}
            <span className="ml-auto flex gap-1.5">
              <button type="button" className={`${quiet} py-1 text-sm`} onClick={() => setFolded(sections.map((x) => x.key), true)}>{tx("Tout plier")}</button>
              <button type="button" className={`${quiet} py-1 text-sm`} onClick={() => setFolded(sections.map((x) => x.key), false)}>{tx("Tout déplier")}</button>
            </span>
          </nav>
        )}

        {internet.length > 0 && (
          <FoldSection id="net-internet" icon={Router} title={tx("Accès Internet et passerelles")} n={internet.length} folded={isFolded("internet")} onToggle={() => toggleFold("internet")}>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{internet.map((c) => <ServiceCard key={`${c.connector}/${c.name}`} s={c} />)}</div>
          </FoldSection>
        )}
        {others.length > 0 && (
          <FoldSection id="net-others" icon={Cable} title={tx("Outils réseau")} n={others.length} folded={isFolded("others")} onToggle={() => toggleFold("others")}>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{others.map((c) => <ServiceCard key={`${c.connector}/${c.name}`} s={c} />)}</div>
          </FoldSection>
        )}

        {f.shown.length === 0 && rows.length > 0 && <Empty>{tx("Rien pour ce filtre.")}</Empty>}

        {gearSort.sorted.length > 0 && (
          <FoldSection id="net-gear" icon={Router} title={tx("Équipements réseau")} n={gearSort.sorted.length} folded={isFolded("gear")} onToggle={() => toggleFold("gear")}>
            <Table head={<><Th k="state" sort={gearSort}>{tx("État")}</Th><Th k="name" sort={gearSort}>{tx("Équipement")}</Th><Th k="ip" sort={gearSort}>IP</Th>
              <Th>{tx("Version")}</Th><Th>{tx("Clients")}</Th><Th>{tx("En marche")}</Th><Th k="source" sort={gearSort}>{tx("Source")}</Th></>}>
              {gearSort.sorted.map((r) => (
                <tr key={r.key} className={`hover:bg-bg2/50 ${r.up ? "" : "text-muted"}`}>
                  <Td><State up={r.up} /></Td>
                  <Td><b className="text-txt">{r.name}</b>{r.vendor && <span className="block text-xs text-dim">{r.vendor}</span>}</Td>
                  <Td className="font-mono text-xs">{r.ip || "-"}</Td>
                  <Td className="font-mono text-xs">{r.gear?.version || "-"}{r.gear?.updatable && <span className="ml-1.5"><Badge tone="warn">{tx("mise à jour")}</Badge></span>}</Td>
                  <Td className="tabular-nums">{r.gear?.clients ?? "-"}</Td>
                  <Td className="tabular-nums">{r.gear?.uptime ? dur(r.gear.uptime) : <Dim>-</Dim>}</Td>
                  <Td className="text-xs text-dim">{r.source}</Td>
                </tr>
              ))}
            </Table>
            <Cards>
              {gearSort.sorted.map((r) => (
                <div key={r.key} className="rounded-2xl border border-line bg-card p-3.5">
                  <div className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="block truncate">{r.name}</b><Dim>{[r.vendor, r.ip].filter(Boolean).join(" · ")}</Dim></span><State up={r.up} /></div>
                  <p className="mt-1.5 text-xs text-muted">{[r.gear?.version, r.gear?.clients != null ? tx("{0} clients", r.gear.clients) : "", r.gear?.uptime ? dur(r.gear.uptime) : ""].filter(Boolean).join(" · ")}
                    {r.gear?.updatable && <span className="ml-1.5"><Badge tone="warn">{tx("mise à jour")}</Badge></span>}</p>
                </div>
              ))}
            </Cards>
          </FoldSection>
        )}

        {groups.size > 0 && (
          <FoldSection id="net-clients" icon={Wifi} title={tx("Clients par borne ou switch")} n={clientsShown} folded={isFolded("clients")} onToggle={() => toggleFold("clients")}>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => {
                const wired = key.startsWith("wired/");
                const Icon = wired ? Cable : Wifi;
                return (
                  <details key={key} open className="group overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center gap-3 bg-bg px-4 py-2.5 group-open:border-b group-open:border-line/60 [&::-webkit-details-marker]:hidden">
                      <ChevronRight size={14} className="shrink-0 text-dim transition-transform group-open:rotate-90" aria-hidden />
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2"><Icon size={16} className="text-muted" aria-hidden /></span>
                      <div className="min-w-0 flex-1"><h3 className="truncate font-bold leading-tight">{list[0].via}</h3><span className="text-xs font-semibold uppercase tracking-wider text-dim">{wired ? tx("Filaire") : tx("Wifi")}</span></div>
                      <Count n={list.length} tone="off" />
                    </summary>
                    <ul className="flex max-h-72 flex-col divide-y divide-line/50 overflow-y-auto px-4 text-sm">
                      {[...list].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
                        <li key={r.key} className="flex items-baseline justify-between gap-2 py-1.5">
                          <span className="min-w-0 truncate">{r.machine
                            ? <button type="button" onClick={() => onMachine(r.ip)} className="font-semibold hover:text-link" title={tx("Voir ses services")}>{r.name}</button>
                            : <span className="text-txt">{r.name}</span>} <span className="font-mono text-xs text-dim">{r.ip}</span></span>
                          <span className="shrink-0 text-xs text-dim">{r.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </FoldSection>
        )}

        {devSort.sorted.length > 0 && (
          <FoldSection id="net-devices" icon={Monitor} title={tx("Appareils du réseau")} n={devSort.sorted.length} folded={isFolded("devices")} onToggle={() => toggleFold("devices")}>
            <Table head={<><Th k="state" sort={devSort}>{tx("État")}</Th><Th k="ip" sort={devSort}>IP</Th><Th k="name" sort={devSort}>{tx("Nom")}</Th>
              <Th k="vendor" sort={devSort}>{tx("Fabricant")}</Th><Th>MAC</Th><Th k="machine" sort={devSort}>{tx("Machine")}</Th></>}>
              {devSort.sorted.map((r) => (
                <tr key={r.key} className={`hover:bg-bg2/50 ${r.up ? "" : "text-muted"}`}>
                  <Td><State up={r.up} /></Td>
                  <Td className="font-mono text-xs">{r.ip}{r.detail && <Dim> · {r.detail}</Dim>}</Td>
                  <Td>{r.name || <Dim>-</Dim>}</Td>
                  <Td>{r.vendor || <Dim>-</Dim>}</Td>
                  <Td className="font-mono text-xs text-dim">{r.mac || "-"}</Td>
                  <Td><MachineLink r={r} onMachine={onMachine} /></Td>
                </tr>
              ))}
            </Table>
            <Cards>
              {devSort.sorted.map((r) => (
                <div key={r.key} className="rounded-2xl border border-line bg-card p-3.5">
                  <div className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="block truncate">{r.name || r.ip}</b><Dim>{[r.ip, r.vendor].filter(Boolean).join(" · ")}</Dim></span><State up={r.up} /></div>
                  <div className="mt-1.5 text-sm"><MachineLink r={r} onMachine={onMachine} /></div>
                </div>
              ))}
            </Cards>
            {snap.data.dns && <p className="text-sm text-muted">{tx("Résolution des noms (AdGuard, Pi-hole…) :")} <a href="#dns" className="text-link hover:underline">{tx("onglet DNS")}</a></p>}
          </FoldSection>
        )}
        </>
      )}
    </div>
  );
}
