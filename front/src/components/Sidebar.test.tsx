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
    const order = ["MyServices", "En bref", ">Accueil<", "Inventaire", "Machines", "Réseau", "Protection", "Sauvegardes", "Sécurité", "Administration", "Connecteurs", "Notifications", "Comptes et accès", "Application"].map((l) => html.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('href="#security/overview"');   // Security opens its Overview, even with nothing to report
    const watched = renderToStaticMarkup(<Sidebar snap={snap()} badges={{ security: "warn" }} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />);
    expect(watched).toContain('href="#security/overview"');   // an entry with sub-pages opens its first one
  });
  it("une pastille cliquable sur l'entrée de l'onglet en alerte", () => {
    const html = renderToStaticMarkup(<Sidebar snap={snap()} badges={{ backups: "crit" }} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />);
    expect(html).toContain("Voir les problèmes");
  });
  it("une pastille sur l'entrée Connecteurs quand un connecteur est en alerte, et aucune sur l'onglet", () => {
    const html = renderToStaticMarkup(<Sidebar snap={snap()} badges={{ connectors: "warn" }} why={{ connectors: ["Connecteur **npm** (npm) : boom"] }} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />);
    const dot = html.indexOf("Voir ce qui est à surveiller");
    expect(dot).toBeGreaterThan(html.indexOf("Connecteurs"));
    expect(html.slice(dot)).toContain("Connecteur npm (npm) : boom");   // the tooltip lists the alert, without the bold marks
    expect(renderToStaticMarkup(<Sidebar snap={snap()} badges={{ settings: "warn" }} onNavigate={noop} onBadge={noop} mobileOpen={false} onClose={noop} />)).not.toContain("Voir ce qui est à surveiller");
  });
  it("en tiroir (téléphone) : un fond qui ferme le menu", () => {
    const html = renderToStaticMarkup(<Sidebar snap={snap()} badges={{}} onNavigate={noop} onBadge={noop} mobileOpen onClose={noop} />);
    expect(html).toContain("Fermer le menu");
  });
});
