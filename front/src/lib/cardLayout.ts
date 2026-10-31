import { useCallback, useEffect, useState } from "react";

// Layout of the UniFi cards: display order, width (columns of a 12-column grid), height and uplink port chosen by hand.
// Kept in this browser only; every access is guarded because storage can be blocked.
const STORAGE_KEY = "myservices.unifi.cardLayout.v1";

export const GRID_COLUMNS = 12;
export const MIN_SPAN = 3;
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

/** Default order and size of a card, by kind of device; a card resized by hand keeps its own */
export const TYPE_ORDER: Record<string, number> = { gateway: 0, switch: 1, access_point: 2 };
export function cardDefaults(type: string, ports: number): { span: number; height: number } {
  if (type !== "access_point") return { span: 4, height: 455 };
  return ports > 0 ? { span: 4, height: 420 } : { span: 3, height: 473 };
}

const MIN_SCALE = 0.5, MAX_SCALE = 2;
const MIN_TEXT_SCALE = 0.95, MAX_TEXT_SCALE = 1.05;

/** Width a card is laid out at before its zoom, which sets its default size: a switch or gateway gets the bigger image, and ports stay on two rows at most */
export const cardLayoutWidth = (ports: number): number => Math.max(ports > 2 ? 380 : 470, Math.ceil(ports / 2) * 40 + 28);

/** Zoom of a card in its box: it fills the width and stays under the chosen height or MAX_HEIGHT, so its handles stay on screen. MIN_SCALE stops the spiral of fixed texts, which take more room as the zoom falls */
export function cardScale(boxWidth: number, layoutWidth: number, naturalHeight: number, height?: number): number {
  if (boxWidth <= 0 || naturalHeight <= 0) return 1;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, boxWidth / layoutWidth, (height ?? MAX_HEIGHT) / naturalHeight));
}

/** Correction applied to the texts of a card zoomed by `scale`: they keep about their size while ports and images follow the card */
export const textZoom = (scale: number): number => Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, scale)) / scale;

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
