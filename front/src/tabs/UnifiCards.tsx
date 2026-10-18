// Cartes UniFi (onglet Réseau) : face avant réaliste des switches, passerelles et bornes (ports, vitesse, PoE, trafic en direct), d'après le
// composant unifi-device-card (MIT, copie dans src/vendor). Les données viennent de GET unifi/cards (MynetworK) ; l'agencement (ordre, largeur,
// hauteur, port d'uplink choisi) est gardé dans ce navigateur. Lecture seule.
import { ChevronDown, ChevronUp, GripVertical, Network, RotateCcw, Router, Wifi, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { read } from "../api";
import { Badge, Dim, Empty } from "../components/ui";
import { input, quiet } from "../lib/forms";
import { appIcon, modelIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";
import { useStoredFlag } from "../lib/storedFlag";
import { applyOrder, clampSpan, DEFAULT_SPAN, GRID_COLUMNS, useCardLayout } from "../lib/cardLayout";
import { createMynetworkHass, type MnDevice } from "../vendor/unifi-device-card/mynetwork-adapter";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";

const NO_DEVICES: Record<string, unknown>[] = [];   // stable: a new empty array at each render would rebuild the cards
const LIVE_REFRESH_MS = 10_000;   // each reading asks the controller behind the source: calm on purpose

interface CardsDoc { source: string | null; devices: Record<string, unknown>[]; at: number; error: string }

// The card's own palette onto the colours of the page (they follow the dark and the light theme). Set on the element itself, because the
// card's :host rule would win otherwise.
const THEME_VARS: Record<string, string> = {
  "--udc-card-bg": "transparent",
  "--udc-chrome-bg": "rgb(var(--bg2))",
  "--udc-panel-bg": "rgb(var(--bg2))",
  "--udc-label-color": "rgb(var(--muted))",
  "--udc-bg": "rgb(var(--bg))",
  "--udc-surface": "rgb(var(--bg2))",
  "--udc-surf2": "rgb(var(--card))",
  "--udc-border": "rgb(var(--line))",
  "--udc-text": "rgb(var(--txt))",
  "--udc-dim": "rgb(var(--muted))",
  "--udc-muted": "rgb(var(--dim))",
  "--udc-accent": "rgb(var(--link))",
  "--udc-green": "rgb(var(--ok))",
  "--udc-orange": "rgb(var(--warn))",
  "--udc-port-size": "26px",   // smaller than the 36 px default: several cards side by side
  "--udc-ap-scale": "0.45",
};

const TYPE_ICON: Record<MnDevice["type"], [LucideIcon, string]> = { gateway: [Router, tx("Passerelle")], switch: [Network, tx("Switch")], access_point: [Wifi, tx("Borne Wi-Fi")] };

type CardElement = HTMLElement & { setConfig: (c: Record<string, unknown>) => void; hass: unknown };

/** One card. With a chosen height it keeps its natural layout and is reduced proportionally to fit (never enlarged, no deformation). */
function DeviceCard({ deviceId, hass, showPanel, height, uplinkPort }: Readonly<{ deviceId: string; hass: unknown; showPanel: boolean; height?: number; uplinkPort?: number }>) {
  const hostRef = useRef<HTMLDivElement>(null), cardRef = useRef<CardElement | null>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = document.createElement("unifi-device-card") as CardElement;
    for (const [name, value] of Object.entries(THEME_VARS)) el.style.setProperty(name, value);
    el.setConfig({
      type: "custom:unifi-device-card", device_id: deviceId, show_panel: showPanel,
      default_uplink_port: "auto",   // without a detected uplink, open on a connected special port (SFP+, 10G)
      ...(uplinkPort == null ? {} : { uplink_port: uplinkPort }),
      port_led_blink: true, port_led_blink_speed_rj45: 1, port_led_blink_speed_sfp: 1, port_led_traffic_blink_speed: 0.5,   // up: slow blink, traffic: faster
    });
    host.appendChild(el);
    cardRef.current = el;
    return () => { el.remove(); cardRef.current = null; };
  }, [deviceId, showPanel, uplinkPort]);

  useEffect(() => { if (cardRef.current) cardRef.current.hass = hass; });

  useEffect(() => {   // a transform does not change the layout box: this keeps reporting the natural height
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setNaturalHeight(host.offsetHeight));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const scale = height != null && naturalHeight > 0 ? Math.min(1, height / naturalHeight) : 1;
  return (
    <div data-card-area className="relative" style={height == null ? undefined : { height, overflow: "hidden" }}>
      <div ref={hostRef} style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: "top center" } : undefined} />
    </div>
  );
}

/** The grid spans only apply from the md breakpoint up; below it the cards stack full width. */
function useIsWide(): boolean {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);   // no matchMedia while rendered without a browser (tests)
  useEffect(() => {
    const mql = matchMedia(query), onChange = () => setWide(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
}

const pageLang = (): string => (typeof document === "undefined" ? "" : document.documentElement.lang).slice(0, 2) || "en";

/** The badge next to the title: where the cards come from, or why there are none (the reason is in its tooltip) */
function sourceBadge(doc: CardsDoc | null, failed: boolean): { tone: "ok" | "off" | "warn" | "bad"; label: string; title?: string } {
  if (!doc) return failed ? { tone: "bad", label: tx("illisible"), title: tx("Le serveur de MyServices n'a pas répondu") } : { tone: "off", label: "…" };
  if (doc.source !== "mynetwork") return { tone: "warn", label: tx("indisponible"), title: doc.error || tx("MynetworK ne donne pas la liste des équipements UniFi") };
  return { tone: doc.devices.length > 0 ? "ok" : "off", label: "MynetworK" };
}

/** Pointer capture on the grabbed handle, then every move is forwarded until release. */
function track(e: ReactPointerEvent<HTMLElement>, onMove: (ev: PointerEvent) => void) {
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const onUp = () => { handle.removeEventListener("pointermove", onMove); handle.removeEventListener("pointerup", onUp); };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
}

export function UnifiCards() {
  const [doc, setDoc] = useState<CardsDoc | null>(null), [failed, setFailed] = useState(false);
  const [cardReady, setCardReady] = useState(false), [showPanel, setShowPanel] = useState(false);
  const [folded, setFolded] = useStoredFlag("myservices.network.unifiCardsFolded", false);
  const load = useCallback(() => { if (!folded) read<CardsDoc>("unifi/cards").then((d) => { setDoc(d); setFailed(false); }).catch(() => setFailed(true)); }, [folded]);   // nothing is read while folded
  usePoll(load, LIVE_REFRESH_MS);

  useEffect(() => {   // the card is a plain custom element: loaded only when this part of the page is shown
    let cancelled = false;
    import("../vendor/unifi-device-card/unifi-device-card.js").then(() => { if (!cancelled) setCardReady(true); }).catch((e: unknown) => console.error("unifi-device-card", e));
    return () => { cancelled = true; };
  }, []);

  const raw = doc?.devices ?? NO_DEVICES;
  const { hass, devices } = useMemo(() => createMynetworkHass(raw, pageLang()), [raw]);
  const ids = useMemo(() => devices.map((d: MnDevice) => d.id), [devices]);
  const { order, spans, heights, uplinks, move, setSpan, setHeight, setUplink, reset } = useCardLayout(ids);
  const ordered = useMemo(() => applyOrder<MnDevice>(devices, order), [devices, order]);
  const wide = useIsWide(), gridRef = useRef<HTMLDivElement>(null), [dragged, setDragged] = useState<string | null>(null);

  const resize = (e: ReactPointerEvent<HTMLElement>, id: string, axis: "width" | "height" | "both") => {
    const card = e.currentTarget.parentElement, grid = gridRef.current, area = card?.querySelector("[data-card-area]");
    if (!card || !grid) return;
    const column = grid.getBoundingClientRect().width / GRID_COLUMNS, left = card.getBoundingClientRect().left;   // width: the span follows the pointer, in columns
    const rect = area?.getBoundingClientRect(), offset = rect ? rect.bottom - e.clientY : 0;                      // height: the bottom edge follows the pointer
    track(e, (ev) => {
      if (axis !== "height") setSpan(id, (ev.clientX - left) / column);
      if (axis !== "width" && rect) setHeight(id, ev.clientY + offset - rect.top);
    });
  };

  if (!folded && !doc && !failed) return null;   // folded: the header stays (nothing was read, so nothing is known)
  const noDevice = devices.length === 0;
  const badge = sourceBadge(doc, failed);
  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className={`flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3 ${FOLD_HEADER}`} {...foldHeaderProps(() => setFolded(!folded))}>
        <h3 className="font-bold">{tx("Cartes UniFi")}</h3>
        <Badge tone={badge.tone} title={badge.title}>{badge.label}</Badge>
        {!noDevice && !folded && (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showPanel} onChange={(e) => setShowPanel(e.target.checked)} />{tx("Vue matérielle")}</label>
            <button type="button" className={`${quiet} !px-2 !py-1 text-xs`} onClick={reset} title={tx("Remet l'ordre, les largeurs et les hauteurs par défaut")}><RotateCcw size={12} aria-hidden />{tx("Réinitialiser")}</button>
            <Dim>{tx("Glisser par la poignée, tirer le bord ou le coin pour redimensionner ; double-clic pour revenir à la taille d'origine.")}</Dim>
          </>
        )}
        <button type="button" className="ml-auto text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!folded)} title={folded ? tx("Déplier") : tx("Replier")}>
          {folded ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
        </button>
      </div>
      {!folded && <div className="p-4">
        {noDevice ? (
          <Empty>{failed ? tx("Lecture des cartes impossible pour l'instant.") : doc?.error || tx("Aucun équipement UniFi lisible : il faut MynetworK 0.11.1 ou plus relié à UniFi (ou le contrôleur UniFi lu directement).")}</Empty>
        ) : (
          <div ref={gridRef} className="grid grid-cols-1 items-start gap-4 md:grid-cols-12">
            {ordered.map((d: MnDevice) => (
              <div key={d.id} className={`relative min-w-0 rounded-xl border-2 border-link/40 bg-bg shadow-lg shadow-black/20 transition-colors hover:border-link/70 ${dragged === d.id ? "opacity-50" : ""}`}
                style={wide ? { gridColumn: `span ${clampSpan(spans[d.id] ?? DEFAULT_SPAN)}` } : undefined}
                onDragOver={(e) => { if (dragged) e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragged) {
                    move(dragged, d.id);
                  }
                  setDragged(null);
                }}>
                <span draggable title={tx("Glisser pour changer l'ordre")} className="absolute right-3 top-3 z-10 cursor-grab text-dim hover:text-txt active:cursor-grabbing"
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", d.id); setDragged(d.id); }} onDragEnd={() => setDragged(null)}>
                  <GripVertical size={18} aria-hidden />
                </span>
                <div className="flex flex-wrap items-center gap-2 rounded-t-[10px] border-b border-line bg-bg2 px-4 py-2.5 pr-10">
                  {(() => { const logo = d.type === "access_point" ? modelIcon(d.model) ?? appIcon(["unifi"]) : appIcon(["unifi"]); return logo ? <img src={logo} alt="UniFi" title="UniFi" className="h-6 w-6 shrink-0 object-contain" /> : null; })()}
                  <b>{d.name}</b>
                  {d.type !== "access_point" && d.ports.length > 0 && (
                    <label className="flex items-center gap-1 rounded border border-link/60 bg-bg2 px-2 py-0.5 text-xs text-muted">{tx("Uplink")}
                      <select className={`${input} !w-auto !border-0 !bg-transparent !px-1 !py-0 text-xs`} value={uplinks[d.id] ?? ""}
                        onChange={(e) => setUplink(d.id, e.target.value === "" ? null : Number(e.target.value))}>
                        <option value="">{d.uplinkPort == null ? tx("auto (aucun détecté)") : tx("auto (port {0})", d.uplinkPort)}</option>
                        {d.ports.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 px-4 pb-1 pt-3 text-xs">
                  <Badge tone="off">{tx("Modèle")} : {d.model}</Badge>
                  <Badge tone="off">{(() => { const [Icon, label] = TYPE_ICON[d.type]; return <><Icon size={12} aria-hidden />{label}</>; })()}</Badge>
                  <Badge tone={d.exact ? "ok" : "warn"} title={d.exact ? d.modelKey ?? "" : tx("Pas de face avant dédiée à ce modèle : une face générique est dessinée")}>{d.exact ? tx("face avant dédiée") : tx("face générique")}</Badge>
                  <Badge tone="off">{tx("{0} port(s)", d.portCount)}</Badge>
                </div>
                <div className="px-3 pb-4">
                  {cardReady && <DeviceCard deviceId={d.id} hass={hass} showPanel={showPanel} height={heights[d.id]} uplinkPort={uplinks[d.id]} />}
                </div>
                <div title={tx("Tirer pour changer la hauteur ; double-clic : taille d'origine")} className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize rounded-b-xl hover:bg-link/30"
                  onPointerDown={(e) => resize(e, d.id, "height")} onDoubleClick={() => setHeight(d.id, null)} />
                {wide && (
                  <>
                    <div title={tx("Tirer pour changer la largeur")} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-xl hover:bg-link/30" onPointerDown={(e) => resize(e, d.id, "width")} />
                    <div title={tx("Tirer pour changer la largeur et la hauteur ; double-clic : taille d'origine")} className="absolute bottom-1 right-1 z-20 h-4 w-4 cursor-nwse-resize text-dim hover:text-link"
                      onPointerDown={(e) => resize(e, d.id, "both")} onDoubleClick={() => { setHeight(d.id, null); setSpan(d.id, DEFAULT_SPAN); }}>
                      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M14 6 6 14M14 10l-4 4M14 2 2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>}
    </section>
  );
}
