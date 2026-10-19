// Réseau, sous-page « Diagnostic » : problèmes possibles lus sur les équipements UniFi (via MynetworK). Surtout les ports qui ont négocié une
// vitesse plus basse que leur maximum (câble, port, ou carte réseau de l'appareil branché) ; aussi équipement hors ligne, lien WAN coupé,
// mise à jour en attente, équipement très chargé. Lecture seule, relue toutes les 30 s.
import { Check, CircleCheck, CircleHelp, OctagonAlert, Timer, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import { read, send, type Snapshot } from "../api";
import { Badge, Dim, Empty, Th } from "../components/ui";
import { FoldPanel } from "../components/FoldPanel";
import { useSort } from "../lib/filter";
import { useStoredFlag } from "../lib/storedFlag";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";
import { SystemSettings } from "./SystemSettings";

type Severity = "bad" | "warn" | "info";
interface Nic { machine: string | null; name: string | null; speed: number | null; max: number | null; duplex: "full" | "half" | null; setting: string | null }
interface Finding { key: string; accepted: boolean; nic?: Nic | null; severity: Severity; kind: string; code: string; args: Record<string, string | number | null>; device: string; mac: string | null; port: number | null; speed: number | null; max: number | null; peer: string | null; text: string }
interface OkPort { nic?: Nic | null; device: string; mac: string | null; port: number | null; speed: number | null; max: number | null; peer: string | null; name: string | null }
interface Doc { source: string | null; at: number; error: string; devices: number; summary: Record<Severity, number>; findings: Finding[]; ok_ports: OkPort[] }

/** One line of the table: a finding, or (on request) a port that is up and fine */
interface Row { nic: Nic | null; accept: { key: string; label: string; accepted: boolean } | null; level: 0 | 1 | 2 | 3; severity: Severity | "ok"; kind: string; device: string; port: number | null; speed: number | null; max: number | null; peer: string | null; text: string; key: string }
const RANK: Record<Severity | "ok", 0 | 1 | 2 | 3> = { bad: 0, warn: 1, info: 2, ok: 3 };

const KIND: Record<string, string> = { speed: tx("Vitesse du port"), link: tx("Liaison entre équipements"), offline: tx("Équipement hors ligne"), wan: tx("Lien WAN"), firmware: tx("Mise à jour"), load: tx("Charge"),
  mesh: tx("Liaison radio"), nic: tx("Carte réseau de la machine"), temp: tx("Température"), reboot: tx("Redémarrage"), clients: tx("Clients"), wifi: tx("Wi-Fi"), conflict: tx("Adresse IP"), latency: tx("Latence") };
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

export function NetworkDiagnostic({ snap }: Readonly<{ snap: Snapshot }>) {
  const admin = snap.me.role === "admin";
  const tasksFold = admin && (
    <FoldPanel id="network-tasks" icon={Timer} title={tx("Tâches de fond et horaires")} startFolded>
      <SystemSettings part="tasks" snap={snap} />
    </FoldPanel>
  );
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
  if (failed && !doc) return <><Empty>{tx("Lecture du diagnostic impossible pour l'instant.")}</Empty>{tasksFold}</>;
  if (!doc) return <>{tasksFold}</>;
  if (!doc.source) return <><Empty>{doc.error || tx("Aucun équipement UniFi lisible : le diagnostic des ports demande MynetworK 0.11.1 ou plus relié à UniFi.")}</Empty>{tasksFold}</>;
  const s = doc.summary, nOk = doc.ok_ports?.length ?? 0;
  return (
    <>
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
    {tasksFold}
    </>
  );
}
