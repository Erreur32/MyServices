// Réseau : accès Internet (Freebox, pare-feu, test de débit), équipements (UniFi), clients par borne ou switch, et appareils trouvés sur le réseau
// (MynetworK). Une barre de recherche et des filtres communs (type, état, suivi, borne ou switch, fabricant, source), comme les autres onglets.
// Affiché seulement quand une de ces sources répond ou a déjà répondu. Lecture seule.
import { ArrowUpCircle, Cable, Monitor, Router, Wifi, type LucideIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { Snapshot } from "../api";
import { dur } from "../lib/format";
import { useFilter, useSort, type Facet } from "../lib/filter";
import { tx } from "../lib/i18n";
import { NETWORK_CARDS, hasNetwork } from "../lib/network";
import type { ServiceStatus } from "../types";
import { Badge, Cards, Count, Dim, Empty, FilterBar, Table, Td, Th } from "../components/ui";
import { Dot } from "../components/marks";
import { ServiceCard } from "../components/ServiceStatusCards";

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
}

const mac = (m?: string | null) => (m || "").toLowerCase();
const gearUp = (g: Gear) => g.online ?? !/offline|disconnect|interrupt|isolat/i.test(String(g.state ?? "online"));

function Tile({ value, label, tone, icon: Icon }: { value: number | string; label: string; tone: "ok" | "warn" | "bad" | "off"; icon: LucideIcon }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-muted";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <Icon size={20} className={color} aria-hidden />
      <div><div className={`font-mono text-xl font-bold leading-tight ${color}`}>{value}</div><div className="text-xs text-dim">{label}</div></div>
    </div>
  );
}

function Section({ icon: Icon, title, n, children }: { icon: LucideIcon; title: string; n?: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 border-b border-line/60 pb-1 text-xs font-bold uppercase tracking-wider text-dim"><Icon size={14} aria-hidden />{title}{n != null && <Count n={n} tone="off" />}</h2>
      {children}
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
      vendor: "", via: via || (c.wired ? tx("switch inconnu") : tx("borne inconnue")), machine: (c.ip && followed.get(c.ip)) || null,
      detail: c.wired ? (c.switch_port != null ? tx("port {0}", c.switch_port) : "") : [c.essid, c.signal_dbm != null ? `${c.signal_dbm} dBm` : ""].filter(Boolean).join(" · ") });
  }
  for (const c of net) for (const d of c.devices ?? []) {
    rows.push({ key: `d/${c.name}/${d.ip}`, kind: "device", name: d.hostname || "", ip: d.ip, mac: d.mac || "", up: d.status === "online", source: c.label,
      vendor: d.vendor || "", via: "", detail: d.ping_ms != null ? `${Math.round(d.ping_ms)} ms` : "", machine: followed.get(d.ip) || null });
  }
  return rows;
}

/** UniFi at a glance, next to the Freebox: gateway (UniFi OS console), its version and uptime, equipment online, clients, updates. Built from the
 * merged lists, so it shows with MynetworK alone; the UniFi connector's own card replaces it only when that connector fails. */
function unifiCard(rows: Row[], conn: ServiceStatus | undefined): ServiceStatus | null {
  const gear = rows.filter((r) => r.kind === "gear");
  if (!gear.length) return null;
  const gw = gear.find((r) => /^(ud|ucg|uxg|usg|ugw|udr|ux|cloud gateway)/i.test(`${r.gear?.type ?? ""} ${r.gear?.model ?? ""}`.trim()) || /gateway/i.test(r.name));
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

export function Network({ snap, onMachine }: { snap: Snapshot; onMachine: (ip: string) => void }) {
  const cards = useMemo(() => (snap.data.services_status ?? []).filter((c) => NETWORK_CARDS.includes(c.connector)), [snap.data.services_status]);
  const rows = useMemo(() => buildRows(snap, cards), [snap, cards]);
  const facets = useMemo<Facet<Row>[]>(() => [
    { key: "kind", label: tx("Type"), get: (r) => r.kind, name: (v) => KIND[v as Kind], order: ["gear", "wifi", "wired", "device"] },
    { key: "state", label: tx("État"), get: (r) => (r.up ? "up" : "down"), name: (v) => (v === "up" ? tx("en ligne") : tx("hors ligne")), order: ["up", "down"],
      mark: (v) => <Dot tone={v === "up" ? "ok" : "off"} /> },
    { key: "followed", label: tx("Suivi"), get: (r) => (r.machine ? "yes" : "no"), name: (v) => (v === "yes" ? tx("machine suivie") : tx("pas suivie")), order: ["yes", "no"] },
    { key: "via", label: tx("Borne ou switch"), get: (r) => r.via },
    { key: "vendor", label: tx("Fabricant ou modèle"), get: (r) => r.vendor },
    { key: "source", label: tx("Source"), get: (r) => r.source },
  ], []);
  const text = useCallback((r: Row) => [r.name, r.ip, r.mac, r.vendor, r.via, r.detail, r.machine ?? "", r.gear?.version ?? ""].join(" "), []);
  const f = useFilter(rows, facets, text);
  const keyOf = useCallback((r: Row, k: string): string | number => k === "ip" ? ipKey(r.ip) : k === "state" ? Number(!r.up) : k === "machine" ? r.machine ?? "~" : String(r[k as keyof Row] ?? "").toLowerCase(), []);
  const gearSort = useSort(f.shown.filter((r) => r.kind === "gear"), keyOf, "state");
  const devSort = useSort(f.shown.filter((r) => r.kind === "device"), keyOf, "ip");
  if (!hasNetwork(snap)) return <Empty>{tx("Aucune source réseau : reliez MynetworK, UniFi, OPNsense ou NetAlertX dans Réglages → Connecteurs.")}</Empty>;

  const net = snap.data.network ?? [];
  const unifiConn = cards.find((c) => c.connector === "unifi");
  const unifi = unifiConn && !unifiConn.ok && !unifiConn.stale ? unifiConn : unifiCard(rows, unifiConn);   // a failing connector shows its error
  const internet = [...cards.filter((c) => c.connector === "freebox"), ...(unifi ? [unifi] : []), ...cards.filter((c) => INTERNET.includes(c.connector) && c.connector !== "freebox")];
  const others = cards.filter((c) => !INTERNET.includes(c.connector) && c.connector !== "unifi");
  const all = (k: Kind) => rows.filter((r) => r.kind === k);
  const gearAll = all("gear"), gearDown = gearAll.filter((r) => !r.up).length, updates = gearAll.filter((r) => r.gear?.updatable).length;
  const devAll = all("device"), unfollowed = devAll.filter((r) => r.up && !r.machine).length;
  const groups = new Map<string, Row[]>();
  for (const r of f.shown) if (r.kind === "wifi" || r.kind === "wired") groups.set(`${r.kind}/${r.via}`, [...(groups.get(`${r.kind}/${r.via}`) ?? []), r]);
  const clientsShown = [...groups.values()].reduce((n, l) => n + l.length, 0);

  return (
    <div className="flex flex-col gap-4 py-4">
      {net.filter((c) => !c.ok).map((c) => (
        <p key={c.name} className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{c.label} : {c.message}{c.stale && ` (${tx("dernier relevé gardé")})`}</p>
      ))}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon={Router} value={gearAll.length ? `${gearAll.length - gearDown}/${gearAll.length}` : "-"} label={tx("équipements en ligne")} tone={gearDown ? "bad" : gearAll.length ? "ok" : "off"} />
        <Tile icon={ArrowUpCircle} value={updates} label={tx("mises à jour d'équipement")} tone={updates ? "warn" : "off"} />
        <Tile icon={Wifi} value={all("wifi").length} label={tx("clients wifi")} tone="off" />
        <Tile icon={Cable} value={all("wired").length} label={tx("clients filaires")} tone="off" />
        <Tile icon={Monitor} value={devAll.length ? `${devAll.filter((r) => r.up).length}/${devAll.length}` : "-"} label={unfollowed ? tx("appareils en ligne, {0} pas suivis", unfollowed) : tx("appareils en ligne")} tone={unfollowed ? "warn" : "off"} />
      </div>

      {internet.length > 0 && (
        <Section icon={Router} title={tx("Accès Internet et passerelles")} n={internet.length}>
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{internet.map((c) => <ServiceCard key={`${c.connector}/${c.name}`} s={c} />)}</div>
        </Section>
      )}
      {others.length > 0 && <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{others.map((c) => <ServiceCard key={`${c.connector}/${c.name}`} s={c} />)}</div>}

      {rows.length > 0 && <div className="-my-4"><FilterBar f={f} placeholder={tx("Nom, IP, MAC, fabricant, borne…")} /></div>}
      {f.shown.length === 0 && rows.length > 0 && <Empty>{tx("Rien pour ce filtre.")}</Empty>}

      {gearSort.sorted.length > 0 && (
        <Section icon={Router} title={tx("Équipements réseau")} n={gearSort.sorted.length}>
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
        </Section>
      )}

      {groups.size > 0 && (
        <Section icon={Wifi} title={tx("Clients par borne ou switch")} n={clientsShown}>
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => {
              const wired = key.startsWith("wired/");
              const Icon = wired ? Cable : Wifi;
              return (
                <article key={key} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
                  <header className="flex items-center gap-3 bg-bg2/50 px-4 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2"><Icon size={16} className="text-muted" aria-hidden /></span>
                    <div className="min-w-0 flex-1"><h3 className="truncate font-bold leading-tight">{list[0].via}</h3><span className="text-[11px] font-semibold uppercase tracking-wider text-dim">{wired ? tx("Filaire") : tx("Wifi")}</span></div>
                    <Count n={list.length} tone="off" />
                  </header>
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
                </article>
              );
            })}
          </div>
        </Section>
      )}

      {devSort.sorted.length > 0 && (
        <Section icon={Monitor} title={tx("Appareils du réseau")} n={devSort.sorted.length}>
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
        </Section>
      )}
    </div>
  );
}
