// Relecture périodique d'une route : à l'arrêt quand l'onglet du navigateur est masqué, relue tout de suite au retour.
// Le délai change selon le besoin (court seulement pendant qu'une tâche tourne) sans relancer une lecture à chaque changement.
import { useEffect, useRef } from "react";

export function usePoll(load: () => void, ms: number, immediate = true) {   // immediate : première lecture au montage (sinon l'appelant la fait déjà)
  const first = useRef(immediate);
  useEffect(() => {
    if (first.current) { first.current = false; load(); }
    const tick = () => { if (!document.hidden) load(); };
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [load, ms]);
}
