// Tooltips of the « running » and « stopped » badges of a detected app: what they mean, with the state Docker gives when known
import { tx } from "./i18n";

export const runningTip = (state?: string | null) =>
  tx("Actif : l'appli tourne en ce moment (vu à la dernière collecte{0}). Son connecteur pourra la lire dès qu'il sera activé.", state ? ` : ${state}` : "");

export const stoppedTip = (state?: string | null) =>
  tx("Arrêté : le conteneur existe mais ne tourne pas (vu par docker ps -a{0}). Rien à lire tant qu'il n'est pas relancé ; l'activer peut attendre.", state ? ` : ${state}` : "");
