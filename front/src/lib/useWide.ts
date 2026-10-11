import { useEffect, useState } from "react";

/** Vrai quand l'écran est assez large pour deux colonnes (lg de Tailwind) */
export function useWide(query = "(min-width: 1024px)"): boolean {
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query), on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}
