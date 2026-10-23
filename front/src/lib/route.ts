// Current address (#machines, #settings/alerts…) as React state: the side menu follows it, including the changes made with
// history.pushState (Settings sections), which fire no « hashchange ».
import { useSyncExternalStore } from "react";

export const ROUTE_EVENT = "ms-route";

/** Tells the listeners that the address changed without a « hashchange » (pushState, replaceState) */
export const notifyRoute = (): void => { dispatchEvent(new Event(ROUTE_EVENT)); };

function subscribe(fn: () => void): () => void {
  for (const e of ["hashchange", "popstate", ROUTE_EVENT]) addEventListener(e, fn);
  return () => { for (const e of ["hashchange", "popstate", ROUTE_EVENT]) removeEventListener(e, fn); };
}

export const useRoute = (): string => useSyncExternalStore(subscribe, () => location.hash, () => "");
