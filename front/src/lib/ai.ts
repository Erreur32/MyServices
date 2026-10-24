// « IA et agents » page: the AI services as Services and the AI connectors see them, put together. Nothing is probed here: the state of a
// service is the one of its Services row, its content (models, platforms, links, GPU) the one its connector read.
import type { Snapshot } from "../api";
import type { AiModel, GpuMachine, GpuProcess, GpuRead, ServiceStatus } from "../types";
import { tx } from "./i18n";
import { addrOf, cardAlerts, machinesByIp, serviceCards, sortCards, unreadAlerts, type Family, type ServiceCard, type WatchLine } from "./serviceCards";

export { addrOf } from "./serviceCards";
export type AiRole = "engine" | "agent" | "interface" | "mcp" | "gpu" | "other";

/** One card of the overview: an AI connector, or an AI service of Services that no connector reads (`unread`) */
export interface AiCard extends ServiceCard<AiRole> { models: AiModel[] }

/** The AI connector types, with their role and name when their row has no « ai » block yet (data written before it existed) */
const AI_TYPES: Record<string, [AiRole, string]> = {
  hermes: ["agent", "Hermes Agent"], ollama: ["engine", "Ollama"], llamacpp: ["engine", "llama.cpp"], "openai-compatible": ["engine", "API compatible OpenAI"],
  "open-webui": ["interface", "Open WebUI"], gpuviewr: ["gpu", "GpuViewR"],
};

const ROLE_OF_APP: Record<string, AiRole> = {
  ollama: "engine", llamacpp: "engine", vllm: "engine", localai: "engine", lmstudio: "engine", koboldcpp: "engine", litellm: "engine",
  hermes: "agent", "open-webui": "interface", mcpo: "mcp", gpuviewr: "gpu",
};
const ROLE_ORDER: AiRole[] = ["engine", "agent", "interface", "mcp", "gpu", "other"];
const RUNTIME: Record<string, string> = { ollama: "Ollama", llamacpp: "llama.cpp", vllm: "vLLM", sglang: "SGLang", koboldcpp: "KoboldCpp", lmstudio: "LM Studio" };

const AI: Family<AiRole> = {
  conn: (c) => {
    const known = AI_TYPES[c.connector];
    return c.ai || known ? { role: c.ai?.role ?? known?.[0] ?? "other", title: c.ai?.engine ?? known?.[1] ?? c.label, partial: !!c.ai?.partial } : null;
  },
  row: (r) => r.category === "IA" && !r.app?.agent_of,
  roleOfApp: (key) => ROLE_OF_APP[key ?? ""] ?? "other",
};

export const gpuMachines = (c?: ServiceStatus): GpuMachine[] => {
  const m = (c as unknown as { machines?: unknown } | undefined)?.machines;
  return Array.isArray(m) ? (m as GpuMachine[]) : [];
};

/** Every AI service, one card each: the AI connectors first read, then the AI rows of Services that none of them covers */
export function aiCards(snap: Snapshot): AiCard[] {
  return sortCards(serviceCards(snap, AI).map((c) => ({ ...c, models: c.conn?.ai?.models ?? [] })), ROLE_ORDER);
}

export const hasAi = (snap: Snapshot): boolean =>
  (snap.data.services_status ?? []).some((c) => !!AI.conn(c)) || (snap.data.hosts ?? []).some(AI.row);

/** One row of the Models page */
export interface ModelRow extends AiModel { engine: string; machine?: string; card?: AiCard; via?: "GpuViewR" }

/** Every model of every engine read, then the AI processes GpuViewR sees on a GPU that no engine connector lists */
export function aiModels(snap: Snapshot, cards = aiCards(snap)): ModelRow[] {
  const out: ModelRow[] = cards.filter((c) => c.role === "engine").flatMap((c) => c.models.map((m) => ({ ...m, engine: c.engine ?? c.title, machine: c.machine, card: c })));
  const known = new Set(out.map((m) => `${m.machine}|${m.name.toLowerCase()}`)), byIp = machinesByIp(snap);
  for (const g of (snap.data.services_status ?? []).filter((c) => c.connector === "gpuviewr"))
    for (const m of gpuMachines(g)) {
      const machine = machineName(byIp, m);
      for (const p of m.models) {
        const name = p.alias || p.model;
        if (!name || known.has(`${machine}|${name.toLowerCase()}`) || (p.model && known.has(`${machine}|${p.model.toLowerCase()}`))) continue;
        known.add(`${machine}|${name.toLowerCase()}`);
        out.push({ name, engine: RUNTIME[p.runtime ?? ""] ?? p.runtime ?? "?", machine, loaded: p.state !== "idle", vram: p.mem_mb ? p.mem_mb * 2 ** 20 : undefined, via: "GpuViewR" });
      }
    }
  return out;
}

/** The name MyServices gives a GpuViewR machine: the followed machine with one of its addresses, else GpuViewR's own name */
function machineName(byIp: Map<string, string>, m: GpuMachine): string {
  return m.ips.map((ip) => byIp.get(ip)).find(Boolean) ?? m.name;
}

/** One line of « Qui parle à qui »: from a service to another one (or to an outside server), and how it is known */
export interface AiLink { from: AiCard; to?: AiCard; toLabel: string; toSub?: string; via: string; guess: boolean }

const KIND: Record<string, string> = { ollama: "Ollama", openai: "API OpenAI", mcp: tx("serveur MCP"), tools: tx("serveur d'outils") };

type AiUse = NonNullable<NonNullable<ServiceStatus["ai"]>["uses"]>[number];

/** A link set in the settings of « c » (an address): to the card at that address, else to the address itself */
function urlLink(c: AiCard, url: string, kind: string | undefined, byAddr: Map<string, AiCard>): AiLink {
  const a = addrOf(url), to = a ? byAddr.get(`${a.host}:${a.port}`) : undefined;
  const addr = a ? `${a.host}:${a.port}` : url;
  return { from: c, to, toLabel: to?.title ?? addr, toSub: to?.machine ?? KIND[kind ?? ""], via: tx("réglage de {0}", c.title), guess: false };
}

/** A link through a model « c » uses: to the engine that serves the same model (a guess), else to the model and its provider */
function modelLink(c: AiCard, model: string, provider: string | undefined, engines: AiCard[]): AiLink {
  const name = model.toLowerCase(), to = engines.find((e) => e.models.some((m) => m.name.toLowerCase() === name));
  if (to) return { from: c, to, toLabel: to.title, toSub: to.machine, via: tx("même modèle « {0} »", model), guess: true };
  return { from: c, toLabel: model, toSub: provider ? tx("fournisseur « {0} »", provider) : undefined, via: tx("modèle de {0}", c.title), guess: false };
}

export function aiLinks(snap: Snapshot, cards = aiCards(snap)): AiLink[] {
  const byAddr = new Map(cards.filter((c) => c.ip && c.port).map((c) => [`${c.ip}:${c.port}`, c]));
  const engines = cards.filter((c) => c.role === "engine");
  const linkOf = (c: AiCard, u: AiUse): AiLink => ("url" in u ? urlLink(c, u.url, u.kind, byAddr) : modelLink(c, u.model, u.provider, engines));
  return cards.flatMap((c) => (c.conn?.ai?.uses ?? []).map((u) => linkOf(c, u)));
}

/** One GPU of the GPU page, with its machine and what takes it */
export interface GpuCard { key: string; machine: string; online: boolean; gpu: GpuRead; processes: GpuProcess[] }

export function aiGpus(snap: Snapshot): GpuCard[] {
  const byIp = machinesByIp(snap);
  return (snap.data.services_status ?? []).filter((c) => c.connector === "gpuviewr").flatMap((c) => gpuMachines(c).flatMap((m) => {
    const machine = machineName(byIp, m);
    return m.gpus.map((gpu, i) => ({ key: `${c.instance ?? c.name}/${m.name}/${gpu.index ?? i}`, machine, online: m.online, gpu,
      processes: (m.processes ?? []).filter((p) => m.gpus.length < 2 || p.gpu == null || p.gpu === (gpu.index ?? i)) }));
  }));
}

export const memPct = (g: GpuRead): number | null => (g.mem_used != null && g.mem_total ? Math.round((g.mem_used / g.mem_total) * 100) : null);
export const GPU_FULL = 90;

export type AiAlert = WatchLine;

export function aiAlerts(cards: AiCard[], gpus: GpuCard[]): AiAlert[] {
  const out = cardAlerts(cards, (c) => (c.role === "agent" ? "#ai/agents" : c.serviceHash));
  for (const g of gpus) {
    const pct = memPct(g.gpu);
    if (pct != null && pct >= GPU_FULL) out.push({ tone: "warn", title: tx("GPU de {0} à {1} % de mémoire", g.machine, pct), detail: g.gpu.name, hash: "#ai/gpu" });
  }
  return [...out, ...unreadAlerts(cards, ["engine", "agent", "interface"])];
}
