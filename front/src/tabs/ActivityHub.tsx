// Réglages → Requêtes et journaux : trois sous-onglets. « Requêtes » compte les appels aux connecteurs ; « Journal d'audit » liste les actions
// des comptes ; « Journaux » montre ce que le conteneur écrit. Les anciennes pages à part #audit et #logs mènent ici.
import { Activity, FileText, ScrollText, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { RequestsSettings } from "../components/RequestStats";
import { showInUrl } from "../lib/settingsNav";
import { tx } from "../lib/i18n";
import { SubTabNav } from "../components/SubTabNav";
import { AuditLog } from "./AuditLog";
import { Logs } from "./Logs";

type Part = "requests" | "audit" | "logs";
const KEY = "ms.activity.part";
const PARTS: [Part, string, LucideIcon, string][] = [
  ["requests", tx("Requêtes"), Activity, tx("Les appels aux connecteurs : nombre, durée, erreurs")],
  ["audit", tx("Journal d'audit"), ScrollText, tx("Les actions des comptes : connexions, échecs, changements")],
  ["logs", tx("Journaux"), FileText, tx("Ce que le conteneur écrit, comme « docker logs »")],
];
const isPart = (v: string | null | undefined): v is Part => PARTS.some(([id]) => id === v);

export function ActivityHub() {
  const [part, setPart] = useState<Part>(() => {
    const inUrl = location.hash.split("/")[2];   // #settings/requests/audit: the address wins over the last choice
    if (isPart(inUrl)) return inUrl;
    try { const kept = localStorage.getItem(KEY); return isPart(kept) ? kept : "requests"; } catch { return "requests"; }
  });
  useEffect(() => showInUrl(part === "requests" ? "settings/requests" : `settings/requests/${part}`, true), [part]);
  const pick = (p: Part) => { setPart(p); try { localStorage.setItem(KEY, p); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  return (
    <div className="flex flex-col gap-4">
      <SubTabNav parts={PARTS} part={part} onPick={pick} />
      {part === "requests" && <RequestsSettings />}
      {part === "audit" && <AuditLog />}
      {part === "logs" && <Logs />}
    </div>
  );
}
