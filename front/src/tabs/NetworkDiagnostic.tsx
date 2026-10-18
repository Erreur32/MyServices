// Réseau, sous-page « Diagnostic » : problèmes possibles lus sur les équipements UniFi (via MynetworK). Surtout les ports qui ont négocié une
// vitesse plus basse que leur maximum (câble, port, ou carte réseau de l'appareil branché) ; aussi équipement hors ligne, lien WAN coupé,
// mise à jour en attente, équipement très chargé. Lecture seule, relue toutes les 30 s.
import { CircleCheck, CircleHelp, OctagonAlert, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { read } from "../api";
import { Badge, Dim, Empty } from "../components/ui";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";

type Severity = "bad" | "warn" | "info";
interface Finding { severity: Severity; kind: string; code: string; args: Record<string, string | number | null>; device: string; mac: string | null; port: number | null; speed: number | null; max: number | null; peer: string | null; text: string }
interface Doc { source: string | null; at: number; error: string; devices: number; summary: Record<Severity, number>; findings: Finding[] }

const KIND: Record<string, string> = { speed: tx("Vitesse du port"), link: tx("Liaison entre équipements"), offline: tx("Équipement hors ligne"), wan: tx("Lien WAN"), firmware: tx("Mise à jour"), load: tx("Charge"),
  mesh: tx("Liaison radio"), nic: tx("Carte réseau de la machine"), temp: tx("Température"), reboot: tx("Redémarrage"), clients: tx("Clients"), wifi: tx("Wi-Fi"), conflict: tx("Adresse IP"), latency: tx("Latence") };
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
    case "nic_low": return tx("la carte sait faire plus que ce qu'elle négocie : câble ou port à vérifier");
    case "nic_mismatch": return tx("la carte annonce {0} et le port du switch {1} : les deux ne s'accordent pas", link(f.speed), link(Number(a.port_speed)));
    default: return f.text;
  }
};

export function NetworkDiagnostic() {
  const [doc, setDoc] = useState<Doc | null>(null), [failed, setFailed] = useState(false);
  const load = useCallback(() => { read<Doc>("network/diagnostics").then((d) => { setDoc(d); setFailed(false); }).catch(() => setFailed(true)); }, []);
  usePoll(load, 30_000);
  if (failed && !doc) return <Empty>{tx("Lecture du diagnostic impossible pour l'instant.")}</Empty>;
  if (!doc) return null;
  if (!doc.source) return <Empty>{doc.error || tx("Aucun équipement UniFi lisible : le diagnostic des ports demande MynetworK 0.11.1 ou plus relié à UniFi.")}</Empty>;
  const s = doc.summary;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h3 className="font-bold">{tx("Diagnostic du réseau")}</h3>
        <Dim>{doc.devices} {tx("équipement(s) UniFi analysés")}</Dim>
        {s.bad > 0 && <Badge tone="bad">{s.bad} {tx("à corriger")}</Badge>}
        {s.warn > 0 && <Badge tone="warn">{s.warn} {tx("à vérifier")}</Badge>}
        {s.info > 0 && <Badge tone="off">{s.info} {tx("pour info")}</Badge>}
      </div>
      {doc.findings.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-ok"><CircleCheck size={16} aria-hidden />{tx("Aucun souci détecté : tous les ports en liaison tournent à leur vitesse maximale.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                <th className="px-4 py-2">{tx("Niveau")}</th><th className="px-3 py-2">{tx("Contrôle")}</th><th className="px-3 py-2">{tx("Équipement")}</th><th className="px-3 py-2">{tx("Port")}</th>
                <th className="px-3 py-2">{tx("Négocié / maximum")}</th><th className="px-3 py-2">{tx("Branché")}</th><th className="px-4 py-2">{tx("Constat")}</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(even)]:bg-bg/50 [&>tr]:border-b [&>tr]:border-line/60">
              {doc.findings.map((f, i) => {
                const Icon = f.severity === "bad" ? OctagonAlert : f.severity === "warn" ? TriangleAlert : CircleHelp;
                return (
                  <tr key={`${f.mac}/${f.kind}/${f.port}/${i}`}>
                    <td className="whitespace-nowrap px-4 py-2 align-top"><Badge tone={TONE[f.severity]}><Icon size={12} aria-hidden />{LABEL[f.severity]}</Badge></td>
                    <td className="px-3 py-2 align-top">{KIND[f.kind] ?? f.kind}</td>
                    <td className="px-3 py-2 align-top font-semibold">{f.device}</td>
                    <td className="px-3 py-2 align-top tabular-nums">{f.port ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">{f.kind === "speed" || f.kind === "link" ? <><b>{link(f.speed)}</b> <Dim>/ {link(f.max)}</Dim></> : <Dim>-</Dim>}</td>
                    <td className="px-3 py-2 align-top">{f.peer ?? <Dim>-</Dim>}</td>
                    <td className="px-4 py-2 align-top text-muted">{textOf(f)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line/60 px-4 py-2 text-xs text-dim">{tx("Le maximum d'un port vient de son type (100 Mb/s, 1, 2,5, 10 Gb/s). Un appareil qui n'a qu'une carte à 1 Gb/s ou à 100 Mb/s (pont, concentrateur d'objets connectés) donne un constat « à vérifier » normal.")}</p>
    </section>
  );
}
