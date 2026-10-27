// The tone of a figure of a tile (green, orange, red), by the rule of its kind: one place, so the pages agree and no tile nests ternaries.
export type FigureTone = "ok" | "warn" | "bad";

/** A level out of 100 that warns from `limit` up (processor, memory, temperature); undefined when not read */
export function levelTone(value: number | null, limit: number): FigureTone | undefined {
  if (value == null) return undefined;
  return value >= limit ? "warn" : "ok";
}

/** A count of things that answer out of a total: ok when all do, else `short` (warn by default); undefined without any */
export function shareTone(up: number, total: number, short: FigureTone = "warn"): FigureTone | undefined {
  if (!total) return undefined;
  return up < total ? short : "ok";
}

/** A score: ok from `good`, warn from `fair`, bad below */
export function scoreTone(score: number, good: number, fair: number): FigureTone {
  if (score >= good) return "ok";
  return score >= fair ? "warn" : "bad";
}
