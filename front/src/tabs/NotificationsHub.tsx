// Réglages → Notifications : deux catégories sur les mêmes canaux. « Alertes » prévient d'un problème (règles sur les événements) ;
// « Notifications » envoie des messages que l'on compose (rapports de machines, flux d'événements filtrés).
import { Bell, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { showInUrl } from "../lib/settingsNav";
import { tx } from "../lib/i18n";
import { Alerts } from "./Alerts";
import { Notifications } from "./Notifications";

type Part = "alerts" | "notifications";
const KEY = "ms.notifications.part";
const PARTS: [Part, string, typeof Bell, string][] = [
  ["alerts", tx("Alertes"), Bell, tx("Vous préviennent d'un problème : panne, machine hors ligne, santé critique…")],
  ["notifications", tx("Notifications"), Send, tx("Vos messages : rapports de machines à heure fixe, événements en direct filtrés")],
];

export function NotificationsHub() {
  const [part, setPart] = useState<Part>(() => {
    const inUrl = location.hash.split("/")[2];   // #settings/alerts/notifications: the address wins over the last choice
    if (inUrl === "alerts" || inUrl === "notifications") return inUrl;
    try { return localStorage.getItem(KEY) === "notifications" ? "notifications" : "alerts"; } catch { return "alerts"; }
  });
  useEffect(() => showInUrl(`settings/alerts/${part}`, true), [part]);
  const pick = (p: Part) => { setPart(p); try { localStorage.setItem(KEY, p); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Catégorie")}>
        {PARTS.map(([id, label, Icon, hint]) => (
          <button key={id} type="button" onClick={() => pick(id)} aria-current={part === id ? "page" : undefined} title={hint}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
              part === id ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
            <Icon size={15} strokeWidth={1.75} aria-hidden />{label}
          </button>
        ))}
      </nav>
      {part === "alerts" ? <Alerts /> : <Notifications />}
    </div>
  );
}
