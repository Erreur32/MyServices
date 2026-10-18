// The service a model read by GpuViewR belongs to: a service of the same machine (direct or behind NPM) on the model's port, else one named after its
// runtime (llama.cpp, Ollama…). The port is not always the same on both sides (a container's port against the one NPM forwards to), hence the runtime.
import type { Host } from "../types";

const letters = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

export function modelService(machineIp: string, model: { port?: number | null; runtime?: string | null }, hosts: Host[]): Host | null {
  const mine = hosts.filter((h) => h.ip === machineIp);
  const byPort = model.port ? mine.find((h) => h.port === model.port) : undefined;
  if (byPort) return byPort;
  const runtime = letters(model.runtime ?? "");
  if (!runtime) return null;
  return mine.find((h) => letters(`${h.service?.name ?? ""} ${h.app?.label ?? ""} ${h.name ?? ""}`).includes(runtime)) ?? null;
}
