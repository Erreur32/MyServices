import type { Machine } from "../types";

export interface MachineGroup { key: string; title: string; host?: Machine; list: Machine[] }

/** Where a machine sits in a hypervisor: « instance/node » for a VM and for the node that runs it, else null */
const placeOf = (m: Machine): { key: string; node: string } | null => {
  const l = m.links, p = l?.guest ?? l?.hypervisor;
  return p ? { key: `${p.instance}/${p.node ?? ""}`, node: p.node ?? p.instance } : null;
};

/** The listed machines grouped by hypervisor node, the node's own machine first then its VMs; the others come last under no title.
 *  Order inside and between groups follows the list given (the page's sort). */
export function groupByHost(list: Machine[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>(), rest: Machine[] = [];
  for (const m of list) {
    const p = placeOf(m);
    if (!p) { rest.push(m); continue; }
    const g = groups.get(p.key) ?? { key: p.key, title: p.node, list: [] };
    groups.set(p.key, g);
    if (m.links?.hypervisor && !m.links.guest) { g.host = m; g.list.unshift(m); } else g.list.push(m);
  }
  return [...groups.values(), ...(rest.length ? [{ key: "", title: "", list: rest }] : [])];
}
