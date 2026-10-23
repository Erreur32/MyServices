// Réglages → Notifications : deux catégories sur les mêmes canaux. « Alertes » prévient d'un problème (règles sur les événements) ;
// « Notifications » envoie des messages que l'on compose (rapports de machines, flux d'événements filtrés).
import { Bell, Send, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { showInUrl } from "../lib/settingsNav";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";
import { Alerts } from "./Alerts";
import { Notifications } from "./Notifications";

type Part = "alerts" | "notifications";
const KEY = "ms.notifications.part";
const PARTS: [Part, string, LucideIcon, string][] = [
  ["alerts", tx("Alertes"), Bell, tx("Vous préviennent d'un problème : panne, machine hors ligne, santé critique…")],
  ["notifications", tx("Notifications"), Send, tx("Vos messages : rapports de machines à heure fixe, événements en direct filtrés")],
];

export function NotificationsHub() {
  const [part] = useState<Part>(() => {
    const inUrl = location.hash.split("/")[2];   // #settings/alerts/notifications: the address wins over the last choice
    if (inUrl === "alerts" || inUrl === "notifications") return inUrl;
    try { return localStorage.getItem(KEY) === "notifications" ? "notifications" : "alerts"; } catch { return "alerts"; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, part); } catch { /* storage refused: the choice lasts this visit */ } showInUrl(`settings/alerts/${part}`, true); }, [part]);
  return (
    <div className="flex flex-col gap-4">
      <InfoNote>{PARTS.find(([id]) => id === part)![3]}</InfoNote>
      {part === "alerts" ? <Alerts /> : <Notifications />}
    </div>
  );
}
