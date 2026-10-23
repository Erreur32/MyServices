import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Sidebar } from "./Sidebar";

const snap = (over: Record<string, unknown> = {}): Snapshot =>
  ({ me: { role: "admin" }, backups: { issues: [] }, data: {
    machine_list: [{ info: { sshd: true } }], hosts: [], services_status: [], containers: [], network: [{ unifi: {} }], virtualization: [], security: [{ id: "x" }], dns: null, ...over,
  } } as unknown as Snapshot);
const noop = () => undefined;

describe("Sidebar", () => {
  it("les groupes et leurs entrées, dans l'ordre", () => {
    const html = renderToStaticMarkup(<Sidebar snap={snap()} badges={{}} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />);
    const order = ["MyServices", "ensemble", ">Accueil<", "Inventaire", "Machines", "Réseau", "Protection", "Sauvegardes", "Sécurité", "Alertes", "Administration", "Connecteurs", "Comptes et accès", "Application"].map((l) => html.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('href="#security/sites"');   // nothing to watch: « To watch » is left out, the entry opens its first page
    const watched = renderToStaticMarkup(<Sidebar snap={snap()} badges={{ security: "warn" }} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />);
    expect(watched).toContain('href="#security/watch"');   // an entry with sub-pages opens its first one
  });
  it("une pastille cliquable sur l'entrée de l'onglet en alerte", () => {
    const html = renderToStaticMarkup(<Sidebar snap={snap()} badges={{ backups: "crit" }} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />);
    expect(html).toContain("Voir les problèmes");
  });
  it("en tiroir (téléphone) : un fond qui ferme le menu", () => {
    const html = renderToStaticMarkup(<Sidebar snap={snap()} badges={{}} onNavigate={noop} onBadge={noop} mobileOpen onClose={noop} />);
    expect(html).toContain("Fermer le menu");
  });
});
