// « IA et agents » page: the AI services as Services and the AI connectors see them, put together. Nothing is probed here: the state of a
// service is the one of its Services row, its content (models, platforms, links, GPU) the one its connector read.
import type { Snapshot } from "../api";
import type { AiModel, GpuMachine, GpuProcess, GpuRead, Host, ServiceStatus } from "../types";
import type { Prefill } from "./connectorPrefill";
import { tx } from "./i18n";
import { hostName, status } from "./status";
import { serviceKey } from "./servicesHidden";

export type AiRole = "engine" | "agent" | "interface" | "mcp" | "gpu" | "other";
type Tone = "ok" | "warn" | "bad" | "off";

/** One card of the overview: an AI connector, or an AI service of Services that no connector reads (`unread`) */
export interface AiCard {
  key: string; title: string; role: AiRole; engine?: string; app?: string;
  ip?: string; port?: number; machine?: string; version?: string | null;
  tone: Tone; state: string;
  conn?: ServiceStatus; host?: Host; serviceHash?: string;   // serviceHash: the page of its Services row
  models: AiModel[]; problems: string[]; unread: boolean; partial: boolean;
  connector?: string | null;   // unread: the connector that would read it, if there is one
  prefill?: Prefill;            // unread with a connector: its form, filled with this address
}

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
const TONE_ORDER: Tone[] = ["bad", "warn", "ok", "off"];
const RUNTIME: Record<string, string> = { ollama: "Ollama", llamacpp: "llama.cpp", vllm: "vLLM", sglang: "SGLang", koboldcpp: "KoboldCpp", lmstudio: "LM Studio" };

/** Host and port of an address (« http://10.0.0.5:11434/v1 » -> 10.0.0.5, 11434), the scheme's port when none is written */
export function addrOf(url?: string | null): { host: string; port: number } | null {
  try {
    const u = new URL(String(url ?? ""));
    return { host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80) };
  } catch {
    return null;
  }
}

const rowIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";

/** The rows of Services by « ip:port » of their backend, a direct row before one behind the proxy */
function rowsByAddr(hosts: Host[]): Map<string, Host> {
  const out = new Map<string, Host>();
  for (const r of [...hosts].sort((a, b) => Number(b.type === "local") - Number(a.type === "local"))) {
    const k = `${rowIp(r)}:${r.port}`;
    if (rowIp(r) && r.port && !out.has(k)) out.set(k, r);
  }
  return out;
}

/** The Services row an address leads to: same ip:port, else a domain of a row */
function rowOf(url: string | null | undefined, byAddr: Map<string, Host>, hosts: Host[]): Host | undefined {
  const a = addrOf(url);
  if (!a) return undefined;
  return byAddr.get(`${a.host}:${a.port}`) ?? hosts.find((r) => r.domains?.includes(a.host));
}

export const gpuMachines = (c?: ServiceStatus): GpuMachine[] => {
  const m = (c as unknown as { machines?: unknown } | undefined)?.machines;
  return Array.isArray(m) ? (m as GpuMachine[]) : [];
};

function connTone(c: ServiceStatus, r?: Host): [Tone, string] {
  if (!c.ok) return ["bad", c.message || tx("injoignable")];
  if (c.stale) return ["warn", tx("dernier relevé conservé")];
  if (r) { const [cls, label] = status(r); if (cls === "bad" || cls === "off") return [cls, label]; }
  return (c.problems ?? []).length ? ["warn", tx("à regarder")] : ["ok", tx("en ligne")];
}

/** Every AI service, one card each: the AI connectors first read, then the AI rows of Services that none of them covers */
export function aiCards(snap: Snapshot): AiCard[] {
  const hosts = snap.data.hosts ?? [], byAddr = rowsByAddr(hosts);
  const names = machinesByIp(snap);
  const out: AiCard[] = [], covered = new Set<string>(), readOn = new Set<string>();   // readOn: « connector type @ ip », to skip the other ports of the same app
  for (const c of snap.data.services_status ?? []) {
    const known = AI_TYPES[c.connector];
    if (!c.ai && !known) continue;
    const a = addrOf(c.url), r = rowOf(c.url, byAddr, hosts), ip = r ? rowIp(r) : a?.host;
    const [tone, state] = connTone(c, r);
    if (r) covered.add(`${rowIp(r)}:${r.port}`);
    if (a) covered.add(`${a.host}:${a.port}`);
    if (ip) readOn.add(`${c.connector}@${ip}`);
    out.push({
      key: `c:${c.connector}/${c.instance ?? c.name}`, title: c.ai?.engine ?? known?.[1] ?? c.label, role: c.ai?.role ?? known?.[0] ?? "other",
      engine: c.ai?.engine ?? known?.[1], ip, port: a?.port, machine: r?.machine || (ip ? names.get(ip) : undefined), version: c.version,
      tone, state, conn: c, host: r, serviceHash: r ? `#services/item/${encodeURIComponent(serviceKey(r))}` : undefined,
      models: c.ai?.models ?? [], problems: c.problems ?? [], unread: false, partial: !!c.ai?.partial,
    });
  }
  const seen = new Set<string>();
  for (const r of hosts) {
    const k = `${rowIp(r)}:${r.port}`;
    if (r.category !== "IA" || r.app?.agent_of || covered.has(k) || seen.has(k)) continue;
    if (r.app?.connector && readOn.has(`${r.app.connector}@${rowIp(r)}`)) continue;   // another port of an app already read on this machine
    seen.add(k);
    const best = byAddr.get(k) ?? r, [cls, label] = status(best);
    out.push({
      key: `h:${k}`, title: best.app?.label ?? best.name ?? hostName(best), app: best.app?.key, role: ROLE_OF_APP[best.app?.key ?? ""] ?? "other",
      ip: rowIp(best), port: best.port, machine: best.machine || names.get(rowIp(best)), tone: cls, state: label, host: best,
      serviceHash: `#services/item/${encodeURIComponent(serviceKey(best))}`, models: [], problems: [], unread: true, partial: false, connector: best.app?.connector ?? null,
      prefill: best.app?.connector && rowIp(best) ? { type: best.app.connector, name: (best.machine || names.get(rowIp(best)) || rowIp(best)).toLowerCase(), url: `http://${rowIp(best)}:${best.port}` } : undefined,
    });
  }
  return out.sort((x, y) => TONE_ORDER.indexOf(x.tone) - TONE_ORDER.indexOf(y.tone) || ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role) || x.title.localeCompare(y.title));
}

export const hasAi = (snap: Snapshot): boolean =>
  (snap.data.services_status ?? []).some((c) => !!c.ai || !!AI_TYPES[c.connector]) || (snap.data.hosts ?? []).some((r) => r.category === "IA" && !r.app?.agent_of);

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

const machinesByIp = (snap: Snapshot) => new Map(snap.data.machine_list.map((x) => [x.ip, x.name]));

/** The name MyServices gives a GpuViewR machine: the followed machine with one of its addresses, else GpuViewR's own name */
function machineName(byIp: Map<string, string>, m: GpuMachine): string {
  return m.ips.map((ip) => byIp.get(ip)).find(Boolean) ?? m.name;
}

/** One line of « Qui parle à qui »: from a service to another one (or to an outside server), and how it is known */
export interface AiLink { from: AiCard; to?: AiCard; toLabel: string; toSub?: string; via: string; guess: boolean }

const KIND: Record<string, string> = { ollama: "Ollama", openai: "API OpenAI", mcp: tx("serveur MCP"), tools: tx("serveur d'outils") };

export function aiLinks(snap: Snapshot, cards = aiCards(snap)): AiLink[] {
  const byAddr = new Map(cards.filter((c) => c.ip && c.port).map((c) => [`${c.ip}:${c.port}`, c]));
  const engines = cards.filter((c) => c.role === "engine");
  const out: AiLink[] = [];
  for (const c of cards)
    for (const u of c.conn?.ai?.uses ?? []) {
      if ("url" in u) {
        const a = addrOf(u.url), to = a ? byAddr.get(`${a.host}:${a.port}`) : undefined;
        out.push({ from: c, to, toLabel: to?.title ?? (a ? `${a.host}:${a.port}` : u.url), toSub: to?.machine ?? KIND[u.kind], via: tx("réglage de {0}", c.title), guess: false });
      } else {
        const name = u.model.toLowerCase(), to = engines.find((e) => e.models.some((m) => m.name.toLowerCase() === name));
        out.push(to ? { from: c, to, toLabel: to.title, toSub: to.machine, via: tx("même modèle « {0} »", u.model), guess: true }
          : { from: c, toLabel: u.model, toSub: u.provider ? tx("fournisseur « {0} »", u.provider) : undefined, via: tx("modèle de {0}", c.title), guess: false });
      }
    }
  return out;
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

/** One line of « À surveiller » */
export interface AiAlert { tone: Tone; title: string; detail?: string; hash?: string; prefill?: Prefill }

export function aiAlerts(cards: AiCard[], gpus: GpuCard[]): AiAlert[] {
  const out: AiAlert[] = [];
  for (const c of cards.filter((x) => !x.unread)) {
    if (c.tone === "bad") out.push({ tone: "bad", title: tx("{0} : {1}", c.title, c.state), detail: c.machine, hash: c.serviceHash });
    else for (const p of c.problems) out.push({ tone: "warn", title: tx("{0} : {1}", c.title, p), detail: c.machine, hash: c.role === "agent" ? "#ai/agents" : c.serviceHash });
  }
  for (const g of gpus) {
    const pct = memPct(g.gpu);
    if (pct != null && pct >= GPU_FULL) out.push({ tone: "warn", title: tx("GPU de {0} à {1} % de mémoire", g.machine, pct), detail: g.gpu.name, hash: "#ai/gpu" });
  }
  for (const c of cards.filter((x) => x.unread && x.prefill && (x.role === "engine" || x.role === "agent" || x.role === "interface")))
    out.push({ tone: "off", title: tx("{0} sur {1} : contenu non lu", c.title, c.machine ?? c.ip ?? "?"), detail: tx("En ligne dans Services, mais aucun connecteur ne le lit."), prefill: c.prefill });
  return out;
}
