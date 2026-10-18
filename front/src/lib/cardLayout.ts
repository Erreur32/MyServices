import { useCallback, useEffect, useState } from "react";

// Layout of the UniFi cards: display order, width (columns of a 12-column grid), height and uplink port chosen by hand.
// Kept in this browser only; every access is guarded because storage can be blocked.
const STORAGE_KEY = "myservices.unifi.cardLayout.v1";

export const GRID_COLUMNS = 12;
export const MIN_SPAN = 3;
export const DEFAULT_SPAN = 4;
export const MIN_HEIGHT = 60;
export const MAX_HEIGHT = 700;

interface StoredLayout {
  order: string[];
  spans: Record<string, number>;
  heights: Record<string, number>;   // chosen card height in px; absent = natural height, the card shrinks to fit
  uplinks: Record<string, number>;   // uplink port chosen by hand; absent = detected by the adapter
}

const EMPTY: StoredLayout = { order: [], spans: {}, heights: {}, uplinks: {} };

const record = (v: unknown): Record<string, number> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {});

function load(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<StoredLayout>;
    return { order: Array.isArray(p.order) ? p.order.filter((v) => typeof v === "string") : [], spans: record(p.spans), heights: record(p.heights), uplinks: record(p.uplinks) };
  } catch {
    return EMPTY;
  }
}

function save(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // storage unavailable: the layout simply does not persist
  }
}

export const clampHeight = (height: number): number => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));
export const clampSpan = (span: number): number => Math.min(GRID_COLUMNS, Math.max(MIN_SPAN, Math.round(span)));

/** Saved order first; devices not seen before are appended in their natural order. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function useCardLayout(deviceIds: string[]) {
  const [layout, setLayout] = useState<StoredLayout>(load);
  useEffect(() => save(layout), [layout]);

  const move = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setLayout((prev) => {
      const known = prev.order.filter((id) => deviceIds.includes(id));
      for (const id of deviceIds) if (!known.includes(id)) known.push(id);
      const from = known.indexOf(fromId), to = known.indexOf(toId);
      if (from < 0 || to < 0) return prev;
      known.splice(to, 0, known.splice(from, 1)[0]);
      return { ...prev, order: known };
    });
  }, [deviceIds]);

  const setSpan = useCallback((id: string, span: number) => setLayout((prev) => ({ ...prev, spans: { ...prev.spans, [id]: clampSpan(span) } })), []);

  const setHeight = useCallback((id: string, height: number | null) => {
    setLayout((prev) => {
      const heights = { ...prev.heights };
      if (height == null) delete heights[id];
      else heights[id] = clampHeight(height);
      return { ...prev, heights };
    });
  }, []);

  const setUplink = useCallback((id: string, port: number | null) => {
    setLayout((prev) => {
      const uplinks = { ...prev.uplinks };
      if (port == null) delete uplinks[id];
      else uplinks[id] = port;
      return { ...prev, uplinks };
    });
  }, []);

  const reset = useCallback(() => setLayout(EMPTY), []);

  return { order: layout.order, spans: layout.spans, heights: layout.heights, uplinks: layout.uplinks, move, setSpan, setHeight, setUplink, reset };
}
