import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentGaps, AgentTodo } from "./AgentGaps";
import type { AgentInfo } from "../types";

const agent = { gaps: ["docker"] } as AgentInfo;

describe("AgentTodo", () => {
  it("ne s'affiche que s'il y a quelque chose à faire", () => {
    expect(renderToStaticMarkup(<AgentTodo a={agent} ssh={false} />)).toContain("svg");
    expect(renderToStaticMarkup(<AgentTodo a={{ ...agent, gaps: ["sudo"] }} ssh />)).toBe("");   // SSH reads the ports instead
    expect(renderToStaticMarkup(<AgentTodo a={{ ...agent, gaps: [] }} ssh={false} />)).toBe("");
  });
  it("garde les droits sudo même avec un SSH, qui ne les remplace pas", () => {
    const out = renderToStaticMarkup(<AgentTodo a={{ ...agent, rights: ["fail2ban"] }} ssh />);
    expect(out).toContain("fail2ban");
    expect(out).not.toContain("MSV_SUDO");
  });
  it("garde Docker avec un SSH là où NPM tourne, le SSH ne lisant pas son trafic web", () => {
    const out = renderToStaticMarkup(<AgentTodo a={{ ...agent, gaps: ["docker", "sudo"] }} ssh npm />);
    expect(out).toContain("Lire Docker");
    expect(out).not.toContain("MSV_SUDO");
    expect(out).not.toContain("pas de SSH");
    expect(renderToStaticMarkup(<AgentTodo a={agent} ssh />)).toBe("");   // no NPM there: SSH reads the containers, no root rights to give
  });
  it("sur la page SSH, Docker sans NPM se lit par le SSH", () => {
    expect(renderToStaticMarkup(<AgentGaps gaps={["docker"]} />)).toContain("lus par le SSH");
    expect(renderToStaticMarkup(<AgentGaps gaps={["docker"]} npm />)).toContain("Nginx Proxy Manager");
  });
});
