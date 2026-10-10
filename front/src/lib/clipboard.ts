// Copie dans le presse-papiers. `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS ou localhost) :
// la page servie en http://<IP du LAN> passe par un champ caché et execCommand("copy").
export async function copyText(text: string): Promise<boolean> {
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
