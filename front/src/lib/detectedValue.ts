// Services detected but not connected: what each would bring, and whether that is already read for its machine by another
// source (SSH, agent, Beszel, another connector). « new » first: what is worth connecting.
import { tx } from "./i18n";
import type { ConnectorInstance, Machine, Proposal } from "../types";

/** What a connector feeds; Glances and Netdata also read their machine's health, GpuViewR its GPUs */
const BRINGS: Record<string, string[]> = { glances: ["health"], netdata: ["health"], gpuviewr: ["gpu"] };
const KIND_LABEL: Record<string, string> = {   // tx() here: the language is fixed when the page loads
  containers: tx("Conteneurs"), health: tx("Santé de la machine"), virtualization: tx("Virtualisation"), network: tx("Réseau"),
  security: tx("Sécurité"), backups: tx("Sauvegardes"), status: tx("État du service"), logs: tx("Journaux"), dns: tx("DNS"),
  services: tx("Services"), inventory: tx("Inventaire"), gpu: tx("Cartes graphiques"),
};
const CONTAINER_TOOLS = ["dockhand", "dozzle", "arcane", "portainer"];

export interface DetectedValue { brings: string[]; coveredBy: string[] }

export interface Context {
  machines: Machine[];
  instances: ConnectorInstance[];
  dockerOk: Set<string>;   // machines whose containers are read over SSH
}

const onMachine = (i: ConnectorInstance, ip: string) => Object.values(i.config).some((v) => typeof v === "string" && v.includes(ip));

/** Sources already giving one kind of data for this machine (empty: nobody, the connector would bring it) */
function sources(kind: string, p: Proposal, m: Machine | undefined, ctx: Context, self: string): string[] {
  const seen = (m?.links?.sources ?? []).filter((s) => s.source !== self);
  const by = (names: string[]) => seen.filter((s) => names.includes(s.source)).map((s) => s.label);
  const set = (type: string) => ctx.instances.filter((i) => i.type === type && i.type !== self);
  switch (kind) {
    case "containers":
      return [...(ctx.dockerOk.has(p.ip) ? ["SSH"] : []), ...by(CONTAINER_TOOLS)];
    case "health":
      return [...(m?.ssh ? ["SSH"] : []), ...(m?.agent ? [tx("agent")] : []), ...by(["beszel"]),
        ...["glances", "netdata"].flatMap((t) => set(t).filter((i) => onMachine(i, p.ip)).map((i) => i.label))];
    case "virtualization":
      return [...set("proxmox"), ...set("pdm"), ...set("pulse")].map((i) => i.label);
    case "network":
      return set("mynetwork").map((i) => i.label);
    default:
      return [];   // its own card or data: nobody else gives it
  }
}

export function detectedValue(p: Proposal, kinds: string[], ctx: Context): DetectedValue {
  const what = BRINGS[p.connector] ?? kinds.filter((k) => k !== "alerts");
  const m = ctx.machines.find((x) => x.ip === p.ip);
  const per = what.map((k) => sources(k, p, m, ctx, p.connector));
  // covered only when every part of what it brings is already read somewhere
  const coveredBy = per.every((s) => s.length) ? [...new Set(per.flat())] : [];
  return { brings: what.map((k) => KIND_LABEL[k] ?? k), coveredBy };
}
