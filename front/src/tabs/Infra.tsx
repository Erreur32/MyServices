// Onglet Infra : les cartes personnalisées des services lus par leur API (Dockhand, Home Assistant, Uptime Kuma, Portainer…) et des conteneurs.
// Elles étaient sous le tableau de la page Santé ; elles ont leur page en attendant des cartes améliorées pour les services les plus importants.
import type { Snapshot } from "../api";
import { InfraCards } from "../components/InfraCards";
import { Empty } from "../components/ui";
import { infraCards, infraDocker } from "../lib/tabs";
import { tx } from "../lib/i18n";

export function Infra({ snap }: Readonly<{ snap: Snapshot }>) {
  const services = infraCards(snap), docker = infraDocker(snap);
  return (
    <div className="py-1">
      {services.length || docker.length ? <InfraCards docker={docker} services={services} /> : <Empty>{tx("Aucun service lu par son API pour l'instant.")}</Empty>}
    </div>
  );
}
