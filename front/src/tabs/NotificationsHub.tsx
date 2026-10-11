// Réglages → Notifications : deux catégories sur les mêmes canaux. « Alertes » prévient d'un problème (règles sur les événements) ;
// « Notifications » envoie des messages que l'on compose (rapports de machines, flux d'événements filtrés).
import { Bell, Send } from "lucide-react";
import { useState } from "react";
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
  const [part, setPart] = useState<Part>(() => { try { return localStorage.getItem(KEY) === "notifications" ? "notifications" : "alerts"; } catch { return "alerts"; } });
  const pick = (p: Part) => { setPart(p); try { localStorage.setItem(KEY, p); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={tx("Catégorie")}>
        {PARTS.map(([id, label, Icon, hint]) => (
          <button key={id} type="button" role="tab" aria-selected={part === id} title={hint} onClick={() => pick(id)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${part === id ? "border-link bg-link/15 text-txt" : "border-line bg-card text-muted hover:border-link hover:text-txt"}`}>
            <Icon size={16} aria-hidden />{label}
          </button>
        ))}
      </div>
      {part === "alerts" ? <Alerts /> : <Notifications />}
    </div>
  );
}
