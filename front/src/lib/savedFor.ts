import type { ConnectorInstance, Proposal } from "../types";

/** A detected app whose connector is already saved: same rule as the server (known_apps.is_linked), an instance of that type
 *  whose settings name the address. Lets the lists change at once, without waiting for the next collection. */
export const savedFor = (p: Proposal, instances: ConnectorInstance[]) =>
  !!p.ip && instances.some((i) => i.type === p.connector && Object.values(i.config).some((v) => typeof v === "string" && v.includes(p.ip!)));
