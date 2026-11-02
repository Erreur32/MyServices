import { tx } from "./i18n";

/** The line of a tile whose picture failed: the server's reason when it gave one */
export function pictureText(failed: string | boolean, live = false): string {
  if (typeof failed === "string") return tx("Image non lue : {0}", failed);
  return live ? tx("Flux non lu : l'outil n'a pas répondu.") : tx("Image non lue : l'outil n'a pas répondu.");
}

// Why a camera picture failed: an <img> gives no reason, so the same address is asked once more and its JSON error read
// (a picture is small; never used for a live feed, which would open a second one).
export function pictureReason(url: string, set: (reason: string) => void): void {
  fetch(url, { cache: "no-store" }).then((r) => r.json()).then((j: { error?: unknown }) => { if (typeof j.error === "string" && j.error) set(j.error); }).catch(() => undefined);
}
