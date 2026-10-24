import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { Host, ServiceStatus } from "../types";
import { addrOf, aiAlerts, aiCards, aiGpus, aiLinks, aiModels, hasAi } from "./ai";

const host = (h: Partial<Host>): Host => ({ id: 1, type: "local", enabled: true, domains: [], backend: { up: true, ms: 1 }, ...h } as Host);
const conn = (c: Partial<ServiceStatus>): ServiceStatus => ({ connector: "x", name: "x", label: "X", ok: true, stale: false, message: "OK", ...c });
const snap = (hosts: Host[], status: ServiceStatus[]): Snapshot =>
  ({ data: { hosts, services_status: status, machine_list: [{ ip: "10.0.0.10", name: "Jarvis" }, { ip: "10.0.0.9", name: "Tower" }] } } as unknown as Snapshot);

const ollama = conn({ connector: "ollama", name: "jarvis", url: "http://10.0.0.10:11434", version: "0.12.6",
  ai: { role: "engine", engine: "Ollama", models: [{ name: "qwen3:8b", loaded: true, vram: 6e9 }, { name: "gemma3:12b" }] } });
const llama = conn({ connector: "llamacpp", name: "l", url: "http://10.0.0.10:8081", ai: { role: "engine", engine: "llama.cpp", models: [{ name: "qwen3-coder-30b", loaded: true }] } });
const hermes = conn({ connector: "hermes", name: "h", url: "http://10.0.0.9:19119", problems: ["plateforme « telegram » : bad token"],
  ai: { role: "agent", engine: "Hermes Agent", platforms: [{ name: "telegram", state: "error", error: "bad token" }], uses: [{ model: "Qwen3-Coder-30B", provider: "custom" }] } });
const webui = conn({ connector: "open-webui", name: "w", url: "http://10.0.0.10:3080",
  ai: { role: "interface", engine: "Open WebUI", uses: [{ url: "http://10.0.0.10:11434", kind: "ollama" }, { url: "https://api.example.com", kind: "openai" }] } });
const gpu = conn({ connector: "gpuviewr", name: "g", label: "GpuViewR", url: "http://10.0.0.10:7510" });
Object.assign(gpu, { machines: [{ name: "Win-Gamer32", online: true, ips: ["10.0.0.10"], gpus: [{ name: "RTX", index: 0, mem_used: 9500, mem_total: 10000 }],
  models: [{ model: "Mistral-7B", alias: "mistral", runtime: "vllm", state: "loaded", mem_mb: 4096 }, { model: "qwen3:8b", runtime: "ollama" }],
  processes: [{ name: "vllm", gpu: 0, mem_mb: 4096 }] }] });

describe("AI page", () => {
  it("reads an address: host and port, the scheme's port when none is written", () => {
    expect(addrOf("http://10.0.0.5:11434/v1")).toEqual({ host: "10.0.0.5", port: 11434 });
    expect(addrOf("https://host.lan")).toEqual({ host: "host.lan", port: 443 });
    expect(addrOf("nope")).toBeNull();
  });

  it("one card per connector, then the AI rows of Services no connector covers, problems first", () => {
    const hosts = [
      host({ id: 1, ip: "10.0.0.10", port: 11434, category: "IA", name: "ollama", app: { key: "ollama", label: "Ollama", confidence: "sure", connector: "ollama" } }),
      host({ id: 2, type: "proxy", target_ip: "10.0.0.10", port: 11434, category: "IA", domains: ["ai.lan"] }),   // same backend behind the proxy
      host({ id: 3, ip: "10.0.0.9", port: 8642, category: "IA", app: { key: "hermes", label: "Hermes Agent", confidence: "probable", connector: "hermes" } }),   // another port of Hermes, read
      host({ id: 4, ip: "10.0.0.9", port: 8000, category: "IA", name: "vllm", app: { key: "vllm", label: "vLLM", confidence: "sure", connector: "openai-compatible" } }),
      host({ id: 5, ip: "10.0.0.9", port: 9999, category: "IA", app: { key: "gpuviewr-agent", label: "GpuViewR (agent)", confidence: "sure", connector: null, agent_of: "gpuviewr" } }),
      host({ id: 6, ip: "10.0.0.9", port: 80, category: "Médias", name: "jellyfin" }),
    ];
    const cards = aiCards(snap(hosts, [ollama, hermes]));
    expect(cards.map((c) => [c.title, c.role, c.tone, c.unread, c.machine])).toEqual([
      ["Hermes Agent", "agent", "warn", false, "Tower"],
      ["Ollama", "engine", "ok", false, "Jarvis"],
      ["vLLM", "engine", "ok", true, "Tower"],
    ]);
    expect(cards[1].serviceHash).toBe("#services/item/local1");
    expect(cards[2].prefill).toEqual({ type: "openai-compatible", name: "tower", url: "http://10.0.0.9:8000" });
  });

  it("an AI connector whose row has no « ai » block yet still covers its service", () => {
    const hosts = [host({ id: 3, ip: "10.0.0.9", port: 8642, category: "IA", app: { key: "hermes", label: "Hermes Agent", confidence: "probable", connector: "hermes" } })];
    const cards = aiCards(snap(hosts, [conn({ connector: "hermes", url: "http://10.0.0.9:8644" })]));
    expect(cards.map((c) => [c.title, c.role, c.unread])).toEqual([["Hermes Agent", "agent", false]]);
  });

  it("a connector that does not answer is in red, with its message", () => {
    const [c] = aiCards(snap([], [conn({ connector: "ollama", url: "http://10.0.0.10:11434", ok: false, message: "délai dépassé", ai: { role: "engine", engine: "Ollama" } })]));
    expect([c.tone, c.state]).toEqual(["bad", "délai dépassé"]);
  });

  it("the menu entry exists with an AI connector or an AI service, not with an agent alone", () => {
    expect(hasAi(snap([], [ollama]))).toBe(true);
    expect(hasAi(snap([host({ category: "IA", app: { key: "gpuviewr-agent", label: "a", confidence: "sure", connector: null, agent_of: "gpuviewr" } })], []))).toBe(false);
    expect(hasAi(snap([host({ category: "IA" })], []))).toBe(true);
    expect(hasAi(snap([host({ category: "Médias" })], []))).toBe(false);
  });

  it("models of every engine, then what GpuViewR sees running that no engine lists", () => {
    const rows = aiModels(snap([], [ollama, llama, gpu]));
    expect(rows.map((m) => [m.name, m.engine, m.machine, m.via ?? ""])).toEqual([
      ["qwen3-coder-30b", "llama.cpp", "Jarvis", ""], ["qwen3:8b", "Ollama", "Jarvis", ""], ["gemma3:12b", "Ollama", "Jarvis", ""],   // engines by name
      ["mistral", "vLLM", "Jarvis", "GpuViewR"],   // qwen3:8b is already listed by Ollama
    ]);
    expect(rows[3].vram).toBe(4096 * 2 ** 20);
  });

  it("who talks to whom: an interface's settings, an agent's model found on an engine (a guess), else the outside server", () => {
    const links = aiLinks(snap([], [ollama, llama, hermes, webui]));
    expect(links.map((l) => [l.from.title, l.toLabel, l.to?.title ?? null, l.guess])).toEqual([
      ["Hermes Agent", "llama.cpp", "llama.cpp", true],
      ["Open WebUI", "Ollama", "Ollama", false],
      ["Open WebUI", "api.example.com:443", null, false],
    ]);
    const alone = aiLinks(snap([], [hermes]));
    expect([alone[0].toLabel, alone[0].toSub]).toEqual(["Qwen3-Coder-30B", "fournisseur « custom »"]);
  });

  it("GPUs with the followed machine's name, and what to watch", () => {
    const gpus = aiGpus(snap([], [gpu]));
    expect(gpus.map((g) => [g.machine, g.gpu.name, g.processes.length])).toEqual([["Jarvis", "RTX", 1]]);
    const alerts = aiAlerts(aiCards(snap([host({ id: 9, ip: "10.0.0.9", port: 1234, category: "IA", app: { key: "lmstudio", label: "LM Studio", confidence: "sure", connector: "openai-compatible" } })], [hermes])), gpus);
    expect(alerts.map((a) => [a.tone, a.title])).toEqual([
      ["warn", "Hermes Agent : plateforme « telegram » : bad token"],
      ["warn", "GPU de Jarvis à 95 % de mémoire"],
      ["off", "LM Studio sur Tower : contenu non lu"],
    ]);
  });
});
