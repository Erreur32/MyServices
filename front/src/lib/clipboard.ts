// Copie dans le presse-papiers. `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS ou localhost) :
// la page servie en http://<IP du LAN> passe par un champ caché et execCommand("copy").
import { tx } from "./i18n";

async function write(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refus du navigateur : repli ci-dessous
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** A short message at the bottom of the page, the same for every copy button */
function notify(ok: boolean): void {
  const note = document.createElement("div");
  note.setAttribute("role", "status");
  note.textContent = ok ? tx("Copié dans le presse-papiers") : tx("Copie impossible : sélectionner le texte et le copier à la main");
  note.className = `fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg border bg-card px-3 py-2 text-sm font-semibold shadow-lg ${ok ? "border-ok/50 text-ok" : "border-warn/50 text-warn"}`;
  document.body.appendChild(note);
  setTimeout(() => note.remove(), ok ? 2500 : 6000);
}

export async function copyText(text: string): Promise<boolean> {
  const ok = await write(text);
  notify(ok);
  return ok;
}
