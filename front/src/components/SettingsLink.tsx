// « Open the settings of this » everywhere: the same small sliders icon (as in the Machines table), the name in its tooltip. Editing in place
// keeps the pencil; a page's way back is BackButton.
import { SlidersHorizontal } from "lucide-react";
import { tx } from "../lib/i18n";

export function SettingsLink({ href, of }: Readonly<{ href: string; of?: string }>) {
  const label = of ? tx("Réglages de {0}", of) : tx("Réglages");
  return (
    <a href={href} aria-label={label} title={label} className="inline-grid h-6 w-6 place-items-center rounded-md text-dim no-underline hover:bg-bg2 hover:text-txt">
      <SlidersHorizontal size={14} aria-hidden />
    </a>
  );
}
