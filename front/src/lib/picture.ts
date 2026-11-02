// Why a camera picture failed: an <img> gives no reason, so the same address is asked once more and its JSON error read
// (a picture is small; never used for a live feed, which would open a second one).
export function pictureReason(url: string, set: (reason: string) => void): void {
  fetch(url, { cache: "no-store" }).then((r) => r.json()).then((j: { error?: unknown }) => { if (typeof j.error === "string" && j.error) set(j.error); }).catch(() => undefined);
}
