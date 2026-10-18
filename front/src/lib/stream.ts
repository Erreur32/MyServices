// One event stream from the server (api/v1/stream, server-sent events) shared by the page: « manifest » when a produced file moved,
// « status » when the collector's state changed, « tasks » when a task started or ended. The browser reconnects by itself; while the
// stream is down, each consumer keeps its own slow fallback read.
import { ROOT } from "../api";

type Handler = (data: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let connected = false;

function open(): void {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource(`${ROOT}api/v1/stream`);
  source.onopen = () => { connected = true; handlers.get("open")?.forEach((h) => h(null)); };
  source.onerror = () => { connected = false; };   // the browser retries by itself (retry: 3000 from the server)
  for (const kind of ["manifest", "status", "tasks"]) {
    source.addEventListener(kind, (e) => {
      let data: unknown = null;
      try { data = JSON.parse((e as MessageEvent).data); } catch { return; }
      handlers.get(kind)?.forEach((h) => h(data));
    });
  }
}

/** Subscribes to one kind of event ("open" for each (re)connection); the stream is opened on the first subscriber. Returns the unsubscribe. */
export function onStream(kind: "manifest" | "status" | "tasks" | "open", h: Handler): () => void {
  let set = handlers.get(kind);
  if (!set) { set = new Set(); handlers.set(kind, set); }
  set.add(h);
  open();
  return () => { set!.delete(h); };
}

/** True while the stream is connected: a consumer can then read much less often on its own */
export function streamConnected(): boolean { return connected; }

/** Tests: closes and forgets the stream */
export function resetStream(): void { source?.close(); source = null; connected = false; handlers.clear(); }
