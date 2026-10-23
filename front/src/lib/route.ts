// Current address (#machines, #settings/alerts…) as React state: the side menu follows it, including the changes made with
// history.pushState (Settings sections), which fire no « hashchange ».
import { useEffect, useSyncExternalStore } from "react";

export const ROUTE_EVENT = "ms-route";

/** Tells the listeners that the address changed without a « hashchange » (pushState, replaceState) */
export const notifyRoute = (): void => { dispatchEvent(new Event(ROUTE_EVENT)); };

function subscribe(fn: () => void): () => void {
  for (const e of ["hashchange", "popstate", ROUTE_EVENT]) addEventListener(e, fn);
  return () => { for (const e of ["hashchange", "popstate", ROUTE_EVENT]) removeEventListener(e, fn); };
}

export const useRoute = (): string => useSyncExternalStore(subscribe, () => location.hash, () => "");

/** The view of a page named by the address (#backups/watch -> "watch"), if it is one of `views` */
export function routeView<V extends string>(route: string, views: readonly V[]): V | null {
  const v = route.replace(/^#/, "").split("/")[1];
  return views.includes(v as V) ? (v as V) : null;
}

/** The view of a page (a sub-page of the side menu): the one in the address, else `fallback`, written in the address
 *  (replaced, not one more step back) so the menu lights it */
export function usePageView<V extends string>(route: string, base: string, views: readonly V[], fallback: V): V {
  const named = routeView(route, views);
  useEffect(() => { if (!named) location.replace(`#${base}/${fallback}`); }, [named, base, fallback]);
  return named ?? fallback;
}
