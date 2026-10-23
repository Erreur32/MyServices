// The Wazuh card of a machine page: what Wazuh knows of the machine through its agent (configuration score, vulnerabilities, inventory).
// Left out when no Wazuh instance has an agent on this machine.
import { ShieldCheck } from "lucide-react";
import type { Snapshot } from "../api";
import { tx } from "../lib/i18n";
import { scoreTone, vulnTone, wazuhOf } from "../lib/wazuh";
import { DetailRow, DetailSection } from "./DetailSection";
import { COLOR } from "./StatTile";

export function WazuhCard({ snap, ip, name }: Readonly<{ snap: Snapshot; ip: string; name: string }>) {
  const w = wazuhOf(snap.data.services_status, ip, name, new Set(snap.data.machine_list.map((x) => x.ip)));
  if (!w) return null;
  const { m } = w, v = m.vulns, hw = m.hardware;
  const active = m.status === "active";
  return (
    <DetailSection sec="wazuh" icon={ShieldCheck} title="Wazuh" tone={active ? "ok" : "warn"} right={<span className="text-dim">{w.instance}{w.stale && ` · ${tx("relevé périmé")}`}</span>}>
      <DetailRow k={tx("Agent Wazuh")}>
        <span className={active ? COLOR.ok : COLOR.warn}>{m.agent ?? "?"} · {active ? tx("actif") : (m.status ?? "?")}</span>
      </DetailRow>
      {v && (
        <DetailRow k={tx("Vulnérabilités")}>
          <span className={`font-semibold ${COLOR[vulnTone(v)]}`}>{tx("{0} critiques, {1} hautes", v.critical, v.high)}</span>
          <span className="text-dim">{tx("{0} moyennes, {1} basses", v.medium, v.low)}</span>
        </DetailRow>
      )}
      {v && v.worst.length > 0 && (
        <DetailRow k={tx("Les plus graves")} wide>
          <ul className="flex flex-col gap-0.5">
            {v.worst.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-2">
                <span className={c.severity === "Critical" ? COLOR.bad : COLOR.warn}>{c.id}</span>
                {c.package && <span className="text-muted">{c.package}</span>}
              </li>
            ))}
          </ul>
        </DetailRow>
      )}
      {m.sca?.map((p) => (
        <DetailRow key={p.name} k={tx("Conformité")} title={tx("Contrôle de configuration Wazuh (SCA)")}>
          <span className={`font-semibold ${COLOR[scoreTone(p.score)]}`}>{p.score} %</span>
          <span className="text-dim">{p.name} · {tx("{0} réussis, {1} en échec", p.pass, p.fail)}</span>
        </DetailRow>
      ))}
      {hw && <DetailRow k={tx("Matériel")}>{[hw.cpu, hw.cores && tx("{0} cœurs", hw.cores), hw.ram_gb && `${hw.ram_gb} Go`].filter(Boolean).join(" · ")}</DetailRow>}
      {m.packages != null && <DetailRow k={tx("Paquets")}>{m.packages}</DetailRow>}
      {!!m.ports?.length && <DetailRow k={tx("Ports en écoute")}>{tx("{0}, dans la carte Ports ouverts", m.ports.length)}</DetailRow>}
    </DetailSection>
  );
}
