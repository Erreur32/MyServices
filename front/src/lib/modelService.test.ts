import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { modelService } from "./modelService";

const host = (o: Partial<Host>): Host => ({ type: "local", ip: "10.0.0.5", port: 80, domains: [], name: "", ...o }) as Host;

describe("the service of an AI model", () => {
  const hosts = [host({ port: 8080, name: "llama-server" }), host({ port: 11434, name: "ollama" }), host({ ip: "10.0.0.9", port: 8080, name: "other machine" }), host({ type: "proxy", port: 8081 } as Partial<Host>)];
  it("is the service of the same machine on the model's port", () => {
    expect(modelService("10.0.0.5", { port: 11434, runtime: "ollama" }, hosts)?.name).toBe("ollama");
    expect(modelService("10.0.0.9", { port: 8080 }, hosts)?.name).toBe("other machine");   // not the one of another machine
  });
  it("else a service named after the runtime", () => {
    expect(modelService("10.0.0.5", { port: 9999, runtime: "llama.cpp" }, [host({ port: 8080, name: "llamacpp-server" })])?.name).toBe("llamacpp-server");
    expect(modelService("10.0.0.5", { port: null, runtime: "Ollama" }, hosts)?.name).toBe("ollama");
  });
  it("also finds a service declared in NPM, whose port is not the model's (the runtime tells)", () => {
    const behindNpm = [host({ type: "proxy", port: 8081, name: "", service: { name: "llamacpp" } } as Partial<Host>)];
    expect(modelService("10.0.0.5", { port: 8080, runtime: "llamacpp" }, behindNpm)?.port).toBe(8081);
  });
  it("none when nothing matches", () => {
    expect(modelService("10.0.0.5", { port: 7777, runtime: "vllm" }, hosts)).toBeNull();
    expect(modelService("10.0.0.5", {}, hosts)).toBeNull();
  });
});
