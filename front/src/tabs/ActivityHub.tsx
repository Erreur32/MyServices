// Activité : trois sous-pages du menu, choisies par l'adresse. « Requêtes » compte les appels aux connecteurs ; « Journal d'audit » liste les actions
// des comptes ; « Journaux » montre ce que le conteneur écrit. Les anciennes pages à part #audit et #logs mènent ici.
import { Activity, FileText, ScrollText, type LucideIcon } from "lucide-react";
import { RequestsSettings } from "../components/RequestStats";
import { useRoute } from "../lib/route";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";
import { AuditLog } from "./AuditLog";
import { Logs } from "./Logs";

type Part = "requests" | "audit" | "logs";
const PARTS: [Part, string, LucideIcon, string][] = [
  ["requests", tx("Requêtes"), Activity, tx("Les appels aux connecteurs : nombre, durée, erreurs")],
  ["audit", tx("Journal d'audit"), ScrollText, tx("Les actions des comptes : connexions, échecs, changements")],
  ["logs", tx("Journaux"), FileText, tx("Ce que le conteneur écrit, comme « docker logs »")],
];
const isPart = (v: string | null | undefined): v is Part => PARTS.some(([id]) => id === v);

export function ActivityHub() {
  const inUrl = useRoute().split("/")[2];   // each part is a sub-page of the menu: #settings/requests, …/audit, …/logs; followed on every click
  const part: Part = isPart(inUrl) ? inUrl : "requests";
  return (
    <div className="flex flex-col gap-4">
      <InfoNote>{PARTS.find(([id]) => id === part)![3]}</InfoNote>
      {part === "requests" && <RequestsSettings />}
      {part === "audit" && <AuditLog />}
      {part === "logs" && <Logs />}
    </div>
  );
}
