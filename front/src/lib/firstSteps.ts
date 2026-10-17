// Mémoire des choix faits dans la recherche réseau (Réglages -> Découverte) : accès « passés », cadres de machines ajoutées. Ces clés servent
// à NetworkStep et à la carte des machines ; l'assistant les efface quand on le recommence (voir reopenAssistant dans lib/assistant.ts).
export const DISMISSED_KEY = "myservices-network-dismissed";
export const ADDED_KEY = "myservices-network-added";
export const LATER_HIDDEN_KEY = "myservices-network-later-hidden";  // rappel « accès passés » masqué
export const REOPEN_EVENT = "myservices:first-steps";   // les écrans qui ont lu cette mémoire la relisent

/** Efface les choix faits dans la recherche réseau : accès passés, rappels masqués, cadres de machines ouverts */
export function forgetChoices(): void {
  localStorage.removeItem(DISMISSED_KEY);
  localStorage.removeItem(LATER_HIDDEN_KEY);
  sessionStorage.removeItem(ADDED_KEY);
}
