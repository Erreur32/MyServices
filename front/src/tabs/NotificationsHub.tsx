// Alertes, in the side menu: five sub-pages over the same channels. The alerts warn of a problem (rules on the events); the
// notifications are messages one composes (reports of machines at a set time, filtered live events). What was sent: both, one page.
import { useEffect } from "react";
import { showInUrl } from "../lib/settingsNav";
import { Alerts } from "./Alerts";
import { Notifications } from "./Notifications";

const PARTS = ["channels", "rules", "notifications", "examples", "sent"] as const;
type Part = (typeof PARTS)[number];

/** #settings/alerts/<part>; the old « alerts » sub-tab opens the channels, a bare address too */
function partOf(v?: string): Part {
  return PARTS.find((p) => p === v) ?? "channels";
}

export function NotificationsHub() {
  const part = partOf(location.hash.split("/")[2]);
  useEffect(() => showInUrl(`settings/alerts/${part}`, true), [part]);
  if (part === "notifications" || part === "examples") return <Notifications part={part} />;
  if (part === "sent") return <div className="flex flex-col gap-4"><Alerts part="sent" /><Notifications part="sent" /></div>;
  return <Alerts part={part} />;
}
