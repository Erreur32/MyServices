// Image chosen by the user for a machine or a service icon -> the data URL the server checks. A photo or logo is shrunk to 128 px
// (an icon is shown at 16 to 28 px; this keeps the file light and drops its EXIF data); a GIF or an SVG is sent as is.
import { tx } from "./i18n";

export const ICON_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
export const ICON_MAX_BYTES = 512 * 1024;
const ICON_SIDE = 128;

const asUrl = (b: Blob) => new Promise<string>((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(typeof r.result === "string" ? r.result : "");
  r.onerror = () => ko(r.error ?? new Error(tx("image illisible")));
  r.readAsDataURL(b);
});

/** The type of the file: the browser leaves it empty for a .svg when the system does not know the extension, so the name tells */
export const typeOf = (file: { type: string; name: string }): string => file.type || (/\.svg$/i.test(file.name) ? "image/svg+xml" : "");

export async function iconData(file: File): Promise<string> {
  const type = typeOf(file);
  if (type === "image/svg+xml" || type === "image/gif") {
    if (file.size > ICON_MAX_BYTES) throw new Error(tx("image trop lourde : 512 Ko au plus"));
    return asUrl(file.type ? file : new Blob([file], { type }));   // a data URL with an empty type is refused by the server
  }
  const img = await createImageBitmap(file);
  const scale = Math.min(1, ICON_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));   // PNG keeps the transparency of a logo
  return asUrl(blob ?? file);
}
