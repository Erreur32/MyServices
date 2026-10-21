// Réseau, sous-page « Diagnostic » : problèmes possibles lus sur les équipements UniFi (via MynetworK). Surtout les ports qui ont négocié une
// vitesse plus basse que leur maximum (câble, port, ou carte réseau de l'appareil branché) ; aussi équipement hors ligne, lien WAN coupé,
// mise à jour en attente, équipement très chargé. Lecture seule, relue toutes les 30 s.
import { Check, CircleCheck, CircleHelp, OctagonAlert, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import { read, send } from "../api";
import { Badge, Dim, Empty, Pct, Th } from "../components/ui";
import { useSort } from "../lib/filter";
import { useStoredFlag } from "../lib/storedFlag";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";

type Severity = "bad" | "warn" | "info";
interface Nic { machine: string | null; name: string | null; speed: number | null; max: number | null; duplex: "full" | "half" | null; setting: string | null }
interface Finding { key: string; accepted: boolean; nic?: Nic | null; severity: Severity; kind: string; code: string; args: Record<string, string | number | null>; device: string; mac: string | null; port: number | null; speed: number | null; max: number | null; peer: string | null; text: string }
interface OkPort { nic?: Nic | null; device: string; mac: string | null; port: number | null; speed: number | null; max: number | null; peer: string | null; name: string | null }
interface Sfp { device: string; mac: string | null; port: number | null; part: string | null; vendor: string | null; compliance: string | null; copper: boolean; temp: number | null; voltage: number | null; current: number | null;
  rx: number | null; tx: number | null; los: boolean; fault: boolean; state: Severity | "ok"; codes: string[] }
interface PortError { device: string; mac: string | null; port: number | null; rx_errors: number; tx_errors: number; rx_dropped: number; tx_dropped: number }
interface Doc { source: string | null; at: number; error: string; devices: number; summary: Record<Severity, number>; findings: Finding[]; ok_ports: OkPort[]; sfp?: Sfp[]; port_errors?: { known: boolean; ports: PortError[] } }

/** One line of the table: a finding, or (on request) a port that is up and fine */
interface Row { nic: Nic | null; accept: { key: string; label: string; accepted: boolean } | null; level: 0 | 1 | 2 | 3; severity: Severity | "ok"; kind: string; device: string; port: number | null; speed: number | null; max: number | null; peer: string | null; text: string; key: string }
const RANK: Record<Severity | "ok", 0 | 1 | 2 | 3> = { bad: 0, warn: 1, info: 2, ok: 3 };

const KIND: Record<string, string> = { speed: tx("Vitesse du port"), link: tx("Liaison entre équipements"), offline: tx("Équipement hors ligne"), wan: tx("Lien WAN"), firmware: tx("Mise à jour"), load: tx("Charge"),
  mesh: tx("Liaison radio"), nic: tx("Carte réseau de la machine"), temp: tx("Température"), reboot: tx("Redémarrage"), clients: tx("Clients"), wifi: tx("Wi-Fi"), conflict: tx("Adresse IP"), latency: tx("Latence"), sfp: tx("Module SFP") };
const ICON = { bad: OctagonAlert, warn: TriangleAlert, info: CircleHelp, ok: CircleCheck };
const TONE: Record<Severity, "bad" | "warn" | "off"> = { bad: "bad", warn: "warn", info: "off" };
const LABEL: Record<Severity, string> = { bad: tx("à corriger"), warn: tx("à vérifier"), info: tx("pour info") };

/** Mb/s -> « 100 Mb/s », « 2,5 Gb/s » */
const link = (mbps: number | null): string => {
  if (mbps == null) return "-";
  return mbps >= 1000 ? `${String(mbps / 1000).replace(".", ",")} Gb/s` : `${mbps} Mb/s`;
};

/** The sentence of a finding, from its code and its figures (the server sends a code, the page words it) */
const textOf = (f: Finding): string => {
  const a = f.args;
  switch (f.code) {
    case "speed_10": return tx("liaison à 10 Mb/s");
    case "speed_100": return tx("liaison à 100 Mb/s sur un port plus rapide : câble à vérifier, ou appareil limité à 100 Mb/s");
    case "speed_low": return tx("négocié sous le maximum du port : câble, ou carte réseau de l'appareil branché");
    case "link_slow": return tx("la liaison avec {0} tourne sous ce que permettent les deux ports", String(a.peer_name ?? "?"));
    case "offline": return tx("l'équipement n'est plus connecté au contrôleur");
    case "wan_down": return tx("le lien WAN est coupé");
    case "firmware": return a.version ? tx("mise à jour du firmware disponible ({0})", String(a.version)) : tx("mise à jour du firmware disponible");
    case "load_cpu": return tx("processeur à {0} %", String(a.value));
    case "load_mem": return tx("mémoire à {0} %", String(a.value));
    case "wifi_weak": return tx("signal Wi-Fi faible ({0} dBm) : rapprocher l'appareil de la borne ou ajouter une borne", String(a.value));
    case "ip_conflict": return tx("l'adresse {0} est vue avec {1} adresses MAC différentes : conflit d'adresse possible", String(a.ip), String(a.n));
    case "mesh": return tx("équipement relié par radio : son débit est partagé avec l'air, un câble serait préférable");
    case "temp": return tx("température élevée ({0} °C)", String(a.value));
    case "reboot": return tx("redémarré il y a {0} min", String(a.minutes));
    case "clients": return tx("{0} clients sur cette borne : envisager de répartir la charge", String(a.value));
    case "latency_wired": return tx("latence de {0} ms sur un appareil filaire : câble, port ou appareil à vérifier", String(a.value));
    case "latency": return tx("latence de {0} ms", String(a.value));
    case "nic_half": return tx("la carte réseau est en half duplex : câble, port ou réglage à corriger");
    case "nic_forced": return tx("vitesse et duplex forcés sur la carte ({0}) : repasser en négociation automatique", String(a.setting));
    case "nic_slow": return tx("la carte réseau de la machine tourne à {0} : rare pour une machine, câble, port ou carte à vérifier", link(f.speed));
    case "nic_low": return tx("la carte sait faire plus que ce qu'elle négocie : câble ou port à vérifier");
    case "sfp_los": return tx("{0} : le module ne reçoit aucun signal (perte de signal) : fibre, connecteur ou autre bout à vérifier", String(a.module));
    case "sfp_fault": return tx("{0} : le module signale un défaut d'émission", String(a.module));
    case "sfp_temp": return tx("{0} : module chaud ({1} °C, seuil {2} °C) : vérifier l'aération ; un module 10GBASE-T chauffe beaucoup", String(a.module), String(a.value), String(a.limit));
    case "sfp_rx_low": return tx("{0} : lumière reçue faible ({1} dBm) : fibre, connecteur ou autre bout à vérifier", String(a.module), String(a.value));
    case "sfp_rx_high": return tx("{0} : lumière reçue trop forte ({1} dBm) : il manque un atténuateur", String(a.module), String(a.value));
    case "sfp_volt": return tx("{0} : alimentation du module à {1} V (attendu 3,3 V)", String(a.module), String(a.value));
    case "nic_mismatch": return tx("la carte annonce {0} et le port du switch {1} : les deux ne s'accordent pas", link(f.speed), link(Number(a.port_speed)));
    default: return f.text;
  }
};

/** The machine's own card next to the switch port: its speed and duplex, and a flag when the two sides do not report the same speed */
function NicCell({ nic, portSpeed }: Readonly<{ nic: Nic | null; portSpeed: number | null }>) {
  if (!nic?.speed) return <span className="text-dim" title={tx("La machine ne rapporte pas sa carte réseau (SSH ou agent) : rien à comparer")}>?</span>;
  const differs = portSpeed != null && portSpeed !== nic.speed, half = nic.duplex === "half";
  return (
    <span className="inline-flex items-baseline gap-1.5" title={[nic.machine, nic.name, nic.setting].filter(Boolean).join(" · ")}>
      <b className={differs ? "text-warn" : ""}>{link(nic.speed)}</b>
      {nic.max ? <Dim>/ {link(nic.max)}</Dim> : null}
      {half && <Badge tone="bad">half</Badge>}
      {differs && <Badge tone="warn">≠</Badge>}
    </span>
  );
}

export function NetworkDiagnostic({ admin }: Readonly<{ admin: boolean }>) {
  const [doc, setDoc] = useState<Doc | null>(null), [failed, setFailed] = useState(false), [showOk, setShowOk] = useStoredFlag("myservices.network.diagShowOk", false);
  const [showAccepted, setShowAccepted] = useStoredFlag("myservices.network.diagShowAccepted", false);
  const load = useCallback(() => { read<Doc>("network/diagnostics").then((d) => { setDoc(d); setFailed(false); }).catch(() => setFailed(true)); }, []);
  usePoll(load, 30_000);
  const accept = (k: string, label: string, on: boolean) => void send("POST", "network/diagnostics/accepted", { key: k, label, accepted: on }).then(load).catch(() => setFailed(true));
  const nAccepted = (doc?.findings ?? []).filter((f) => f.accepted).length;
  const rows: Row[] = [
    ...(doc?.findings ?? []).filter((f) => showAccepted || !f.accepted).map((f, i): Row => ({ accept: { key: f.key, label: `${f.device} ${f.port ?? ""} ${KIND[f.kind] ?? f.kind}`.trim(), accepted: f.accepted }, nic: f.nic ?? null, level: RANK[f.severity], severity: f.severity, kind: f.kind, device: f.device, port: f.port, speed: f.speed, max: f.max, peer: f.peer, text: textOf(f), key: `${f.mac}/${f.kind}/${f.port}/${i}` })),
    ...(showOk ? (doc?.ok_ports ?? []).map((p): Row => ({ accept: null, nic: p.nic ?? null, level: 3, severity: "ok", kind: "speed", device: p.device, port: p.port, speed: p.speed, max: p.max, peer: p.peer,
      text: p.max && p.speed && p.speed >= p.max ? tx("au maximum du port") : tx("liaison active"), key: `ok/${p.mac}/${p.port}` })) : []),
  ];
  const keyOf = useCallback((r: Row, k: string): string | number => {
    switch (k) {
      case "kind": return (KIND[r.kind] ?? r.kind).toLowerCase();
      case "device": return r.device.toLowerCase();
      case "port": return r.port ?? -1;
      case "speed": return r.speed ?? -1;
      case "nic": return r.nic?.speed ?? -1;
      case "peer": return (r.peer ?? "~").toLowerCase();
      case "text": return r.text.toLowerCase();
      default: return r.level;
    }
  }, []);
  const sort = useSort(rows, keyOf, "level");
  if (failed && !doc) return <Empty>{tx("Lecture du diagnostic impossible pour l'instant.")}</Empty>;
  if (!doc) return null;
  if (!doc.source) return <Empty>{doc.error || tx("Aucun équipement UniFi lisible : le diagnostic des ports demande MynetworK 0.11.1 ou plus relié à UniFi.")}</Empty>;
  const s = doc.summary, nOk = doc.ok_ports?.length ?? 0;
  return (
    <div className="flex flex-col gap-4">
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h3 className="font-bold">{tx("Diagnostic du réseau")}</h3>
        <Dim>{doc.devices} {tx("équipement(s) UniFi analysés")}</Dim>
        {s.bad > 0 && <Badge tone="bad">{s.bad} {tx("à corriger")}</Badge>}
        {s.warn > 0 && <Badge tone="warn">{s.warn} {tx("à vérifier")}</Badge>}
        {s.info > 0 && <Badge tone="off">{s.info} {tx("pour info")}</Badge>}
        {nAccepted > 0 && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showAccepted} onChange={(e) => setShowAccepted(e.target.checked)} />{tx("Afficher les constats acceptés")} <Dim>({nAccepted})</Dim>
          </label>
        )}
        {nOk > 0 && (
          <label className={`${nAccepted > 0 ? "" : "ml-auto "}flex cursor-pointer items-center gap-2 text-sm text-muted`}>
            <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} />{tx("Afficher les ports OK")} <Dim>({nOk})</Dim>
          </label>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-ok"><CircleCheck size={16} aria-hidden />{tx("Aucun souci détecté : tous les ports en liaison tournent à leur vitesse maximale.")}</p>
      ) : (
        <div className="max-h-[42rem] overflow-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <Th k="level" sort={sort} className="!px-4">{tx("Niveau")}</Th><Th k="kind" sort={sort}>{tx("Contrôle")}</Th><Th k="device" sort={sort}>{tx("Équipement")}</Th>
                <Th k="port" sort={sort}>{tx("Port")}</Th><Th k="speed" sort={sort}>{tx("Côté switch : négocié / maximum")}</Th><Th k="peer" sort={sort}>{tx("Branché")}</Th><Th k="nic" sort={sort}>{tx("Côté machine : carte réseau")}</Th><Th k="text" sort={sort} className="!px-4">{tx("Constat")}</Th>{admin && <Th title={tx("Action")}><span className="sr-only">{tx("Action")}</span></Th>}
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(even)]:bg-bg/50 [&>tr]:border-b [&>tr]:border-line/60">
              {sort.sorted.map((r) => {
                const Icon = ICON[r.severity];
                return (
                  <tr key={r.key}>
                    <td className="whitespace-nowrap px-4 py-2 align-top"><Badge tone={r.severity === "ok" ? "ok" : TONE[r.severity]}><Icon size={12} aria-hidden />{r.severity === "ok" ? "OK" : LABEL[r.severity]}</Badge></td>
                    <td className="px-3 py-2 align-top">{KIND[r.kind] ?? r.kind}</td>
                    <td className="px-3 py-2 align-top font-semibold">{r.device}</td>
                    <td className="px-3 py-2 align-top tabular-nums">{r.port ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">{r.kind === "speed" || r.kind === "link" ? <><b>{link(r.speed)}</b> <Dim>/ {link(r.max)}</Dim></> : <Dim>-</Dim>}</td>
                    <td className="px-3 py-2 align-top">{r.peer ?? <Dim>-</Dim>}</td>
                    <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">{r.kind === "speed" || r.kind === "link" ? <NicCell nic={r.nic} portSpeed={r.speed} /> : <Dim>-</Dim>}</td>
                    <td className={`px-4 py-2 align-top ${r.severity === "ok" ? "text-dim" : "text-muted"}`}>{r.text}</td>
                    {admin && (
                      <td className="whitespace-nowrap px-3 py-2 align-top">
                        {r.accept && (r.accept.accepted
                          ? <button type="button" className="text-dim hover:text-ink" title={tx("Signaler de nouveau ce constat")} aria-label={tx("Signaler de nouveau ce constat")} onClick={() => accept(r.accept!.key, r.accept!.label, false)}><Undo2 size={15} aria-hidden /></button>
                          : <button type="button" className="text-dim hover:text-ok" title={tx("C'est normal : ne plus signaler ce constat")} aria-label={tx("C'est normal : ne plus signaler ce constat")} onClick={() => accept(r.accept!.key, r.accept!.label, true)}><Check size={15} aria-hidden /></button>)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line/60 px-4 py-2 text-xs text-dim">{tx("Le maximum d'un port vient de son type (100 Mb/s, 1, 2,5, 10 Gb/s). Un appareil qui n'a qu'une carte à 1 Gb/s ou à 100 Mb/s (pont, concentrateur d'objets connectés) donne un constat « à vérifier » normal.")}</p>
    </section>
    {(doc.sfp ?? []).length > 0 && <SfpModules list={doc.sfp!} />}
    <PortErrors doc={doc.port_errors} />
    </div>
  );
}

const STATE: Record<Severity | "ok", [string, "ok" | "warn" | "bad" | "off"]> = { ok: ["OK", "ok"], info: [tx("pour info"), "off"], warn: [tx("à vérifier"), "warn"], bad: [tx("à corriger"), "bad"] };
const num = (v: number | null, digits: number) => (v == null ? null : v.toFixed(digits).replace(".", ","));

/** One reading with its unit, coloured when one of the module's problem codes is about it */
function Reading({ value, unit, flagged, tone }: Readonly<{ value: string | null; unit: string; flagged: boolean; tone: Severity | "ok" }>) {
  if (value == null) return <Dim>-</Dim>;
  return <span className={flagged ? `font-bold ${tone === "bad" ? "text-bad" : "text-warn"}` : ""}><Pct value={value} unit={unit} /></span>;
}

/** Every transceiver with its sensors (DOM): temperature, light received and sent, supply voltage and laser current */
function SfpModules({ list }: Readonly<{ list: Sfp[] }>) {
  const count = (st: Sfp["state"]) => list.filter((m) => m.state === st).length;
  const th = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-dim";
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h3 className="font-bold">{tx("Modules SFP")}</h3>
        <Badge tone="off" outline>{tx("{0} module(s)", list.length)}</Badge>
        {count("ok") > 0 && <Badge tone="ok" outline>{count("ok")} OK</Badge>}
        {count("warn") > 0 && <Badge tone="warn" outline>{count("warn")} {tx("à vérifier")}</Badge>}
        {count("bad") > 0 && <Badge tone="bad" outline>{count("bad")} {tx("à corriger")}</Badge>}
        <Dim>{tx("sondes des modules (DOM), lues par UniFi via MynetworK")}</Dim>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm tabular-nums">
          <thead><tr className="border-b border-line">
            <th className={`${th} !px-4`}>{tx("Équipement")}</th><th className={th}>{tx("Port")}</th><th className={th}>{tx("Module")}</th><th className={th}>{tx("Température")}</th>
            <th className={th}>{tx("Reçu")}</th><th className={th}>{tx("Émis")}</th><th className={th}>{tx("Tension")}</th><th className={th}>{tx("Courant")}</th><th className={th}>{tx("État")}</th>
          </tr></thead>
          <tbody className="[&>tr:nth-child(even)]:bg-bg/50 [&>tr]:border-b [&>tr]:border-line/60">
            {list.map((m) => {
              const has = (...c: string[]) => c.some((x) => m.codes.includes(x));
              return (
                <tr key={`${m.mac}/${m.port}`}>
                  <td className="px-4 py-2 font-semibold">{m.device}</td>
                  <td className="px-3 py-2">{m.port ?? "-"}</td>
                  <td className="px-3 py-2">{m.part ?? "?"} <Dim>{[m.vendor, m.compliance].filter(Boolean).join(" · ")}</Dim></td>
                  <td className="px-3 py-2"><Reading value={num(m.temp, 0)} unit="°C" flagged={has("sfp_temp")} tone={m.state} /></td>
                  <td className="px-3 py-2"><Reading value={num(m.rx, 1)} unit="dBm" flagged={has("sfp_rx_low", "sfp_rx_high", "sfp_los")} tone={m.state} /></td>
                  <td className="px-3 py-2"><Reading value={num(m.tx, 1)} unit="dBm" flagged={has("sfp_fault")} tone={m.state} /></td>
                  <td className="px-3 py-2"><Reading value={num(m.voltage, 2)} unit="V" flagged={has("sfp_volt")} tone={m.state} /></td>
                  <td className="px-3 py-2"><Reading value={num(m.current, 1)} unit="mA" flagged={false} tone={m.state} /></td>
                  <td className="px-3 py-2"><Badge tone={STATE[m.state][1]}>{STATE[m.state][0]}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line/60 px-4 py-2 text-xs text-dim">{tx("Seuils : température à vérifier dès 75 °C, à corriger dès 85 °C ; lumière reçue à vérifier sous -14 dBm, à corriger sous -18 dBm ou au-dessus de +0,5 dBm ; tension hors de 3,13 à 3,47 V. Perte de signal ou défaut d'émission : à corriger. Un module cuivre (10GBASE-T) n'a pas de lumière : « - ».")}</p>
    </section>
  );
}

/** The error counters of the ports (received and sent errors, packets dropped), once the source gives them */
function PortErrors({ doc }: Readonly<{ doc?: { known: boolean; ports: PortError[] } }>) {
  const th = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-dim";
  let body: React.ReactNode;
  if (!doc?.known) body = <p className="px-4 py-3 text-sm text-dim">{tx("En attente de MynetworK : sa route card-devices ne transmet pas encore les compteurs d'erreurs des ports (rx_errors, tx_errors, paquets perdus).")}</p>;
  else if (!doc.ports.length) body = <p className="flex items-center gap-2 px-4 py-3 text-sm text-ok"><CircleCheck size={16} aria-hidden />{tx("Aucune erreur sur les ports.")}</p>;
  else body = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm tabular-nums">
        <thead><tr className="border-b border-line">
          <th className={`${th} !px-4`}>{tx("Équipement")}</th><th className={th}>{tx("Port")}</th><th className={th}>{tx("Erreurs reçues")}</th><th className={th}>{tx("Erreurs émises")}</th><th className={th}>{tx("Perdus en réception")}</th><th className={th}>{tx("Perdus en émission")}</th>
        </tr></thead>
        <tbody className="[&>tr:nth-child(even)]:bg-bg/50 [&>tr]:border-b [&>tr]:border-line/60">
          {doc.ports.map((p) => (
            <tr key={`${p.mac}/${p.port}`}>
              <td className="px-4 py-2 font-semibold">{p.device}</td><td className="px-3 py-2">{p.port ?? "-"}</td>
              <td className={`px-3 py-2 ${p.rx_errors ? "font-bold text-warn" : ""}`}>{p.rx_errors.toLocaleString()}</td><td className={`px-3 py-2 ${p.tx_errors ? "font-bold text-warn" : ""}`}>{p.tx_errors.toLocaleString()}</td>
              <td className="px-3 py-2">{p.rx_dropped.toLocaleString()}</td><td className="px-3 py-2">{p.tx_dropped.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h3 className="font-bold">{tx("Erreurs de ports")}</h3>
        <Dim>{tx("erreurs en réception et en émission, par port, depuis le dernier démarrage de l'équipement")}</Dim>
      </div>
      {body}
    </section>
  );
}
