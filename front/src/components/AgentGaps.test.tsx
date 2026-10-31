import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentTodo } from "./AgentGaps";
import type { AgentInfo } from "../types";

const agent = { gaps: ["docker"] } as AgentInfo;

describe("AgentTodo", () => {
  it("ne s'affiche que s'il y a quelque chose à faire", () => {
    expect(renderToStaticMarkup(<AgentTodo a={agent} ssh={false} />)).toContain("svg");
    expect(renderToStaticMarkup(<AgentTodo a={agent} ssh />)).toBe("");
    expect(renderToStaticMarkup(<AgentTodo a={{ ...agent, gaps: [] }} ssh={false} />)).toBe("");
  });
});
