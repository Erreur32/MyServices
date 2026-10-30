// « Domotique › Tapo »: plugs with their power and energy, cameras with their state, the other devices, then the table of everything the account shows.
import { Camera, Plug } from "lucide-react";
import type { Snapshot } from "../api";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { StatTile } from "../components/StatTile";
import { appIcon } from "../lib/appIcons";
import { linePath, scaleOf } from "../lib/domotique";
import { LOCALE, tx } from "../lib/i18n";
import { tapoGroups, tapoState, tapoSummary, wifiBars, type TapoTone } from "../lib/tapo";
import type { TapoDevice } from "../types";

// Tapo's turquoise
const TEAL = "#4acbd6";
const PANEL = "overflow-hidden rounded-2xl border border-[#4acbd6]/30 bg-card/70 shadow-sm";
const HEAD = "flex items-baseline justify-between gap-3 border-b border-[#4acbd6]/30 bg-[#4acbd6]/10 px-4 py-2.5";
const CARD = "flex min-w-0 flex-col gap-2.5 rounded-2xl border border-[#4acbd6]/30 bg-card px-3.5 py-3 shadow-sm";
const BORDER: Record<string, string> = { bad: "border-bad", warn: "border-warn" };
const TRACK = "relative h-2 rounded-full bg-muted/20";
const TEXT: Record<TapoTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };
const DOT: Record<TapoTone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

const n = (v: number, digits = 0) => v.toLocaleString(LOCALE, { maximumFractionDigits: digits });

function Wifi({ rssi }: Readonly<{ rssi?: number | null }>) {
  const bars = wifiBars(rssi);
  return (
    <span className="inline-flex h-3.5 items-end gap-0.5" role="img" aria-label={rssi == null ? tx("Signal inconnu") : tx("Signal Wi-Fi {0} dBm", rssi)}>
      {[4, 7, 10, 14].map((h, i) => <i key={h} className={`w-[3px] rounded-[1px] ${i < bars ? "bg-[#4acbd6]" : "bg-muted/25"}`} style={{ height: h }} />)}
    </span>
  );
}

function State({ d }: Readonly<{ d: TapoDevice }>) {
  const tone: TapoTone = !d.online || d.error ? "bad" : "ok";
  let label = tx("En ligne");
  if (!d.online) label = tx("Hors ligne");
  else if (d.error) label = tx("Lecture impossible");
  return <span className={`flex items-center gap-1.5 whitespace-nowrap text-xs font-bold ${TEXT[tone]}`}><span className={`size-2 rounded-full ${DOT[tone]}`} />{label}</span>;
}

function Title({ d }: Readonly<{ d: TapoDevice }>) {
  return <div className="min-w-0"><h3 className="truncate text-[14.5px] font-bold">{d.name}</h3><p className="truncate text-[11.5px] text-muted">{[d.model, d.parent].filter(Boolean).join(" · ")}</p></div>;
}

function Switch({ on }: Readonly<{ on: boolean | null | undefined }>) {
  if (on == null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold">
      <i className={`relative inline-block h-4 w-[30px] rounded-full ${on ? "bg-[#4acbd6]" : "bg-muted/25"}`}><i className={`absolute top-0.5 size-3 rounded-full ${on ? "right-0.5 bg-card" : "left-0.5 bg-muted"}`} /></i>
      {on ? tx("Allumée") : tx("Éteinte")}
    </span>
  );
}

/** The last 24 hours of a plug's power, a line filled below in a 200 × 56 box */
function Spark({ d }: Readonly<{ d: TapoDevice }>) {
  const pts = d.series ?? [], sc = scaleOf([pts]);
  if (!sc) return <div className="flex-1" />;
  const path = linePath(pts, sc, 200, 56, 4);
  return (
    <svg viewBox="0 0 200 56" preserveAspectRatio="none" className="h-14 min-w-0 flex-1" role="img" aria-label={tx("Puissance de {0} sur 24 h : de {1} à {2} W", d.name, n(sc.lo), n(sc.hi))}>
      <path d={`${path} L200 56 L0 56 Z`} fill={TEAL} opacity={0.16} />
      <path d={path} fill="none" stroke={TEAL} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PlugCard({ d }: Readonly<{ d: TapoDevice }>) {
  const w = d.power_w, peak = d.peak_w, pct = w != null && peak ? Math.min(100, Math.round((w / peak) * 100)) : null;
  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-2"><Title d={d} /><span className="flex flex-col items-end gap-1"><Switch on={d.on} /><State d={d} /></span></div>
      {w != null && (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="font-mono text-[38px] font-extrabold leading-none tabular-nums">{n(w)}<small className="text-[15px] font-semibold text-muted"> W</small></div>
            <Spark d={d} />
          </div>
          {pct !== null && (
            <div>
              <div className="mb-0.5 flex justify-between text-[11.5px] text-muted"><span>{tx("Puissance par rapport au pic des 24 h ({0} W)", n(peak ?? 0))}</span><b className="font-mono text-xs font-semibold text-txt">{pct} %</b></div>
              <div className={TRACK}><span className="absolute inset-y-0 left-0 rounded-full bg-[#4acbd6]" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          <dl className="grid grid-cols-3 gap-2">
            {([[tx("Aujourd'hui"), d.today_wh != null ? `${n(d.today_wh / 1000, 2)} kWh` : "-"], [tx("Ce mois"), d.month_wh != null ? `${n(d.month_wh / 1000, 1)} kWh` : "-"], [tx("Pic 24 h"), peak != null ? `${n(peak)} W` : "-"]] as const).map(([k, v]) => (
              <div key={k} className="rounded-[10px] bg-bg2 px-2.5 py-1.5"><dt className="text-[11px] text-muted">{k}</dt><dd className="font-mono text-sm font-bold">{v}</dd></div>
            ))}
          </dl>
        </>
      )}
      {d.error && <p className="text-xs text-bad">{d.error}</p>}
      <div className="flex items-center justify-between text-xs text-muted"><span>{tx("Signal Wi-Fi")}</span><Wifi rssi={d.rssi} /></div>
    </article>
  );
}

/** A camera tells whether it answers; its picture is not read in this version */
function CameraCard({ d }: Readonly<{ d: TapoDevice }>) {
  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-2"><Title d={d} /><State d={d} /></div>
      <div className="flex items-center gap-2.5 text-xs text-muted"><Camera size={18} className="shrink-0 text-[#4acbd6]" aria-hidden />{d.fw ? tx("Firmware {0}", d.fw) : tx("Firmware inconnu")}</div>
    </article>
  );
}

function OtherCard({ d }: Readonly<{ d: TapoDevice }>) {
  const values = [d.temperature != null && `${n(d.temperature, 1)}°`, d.humidity != null && `${n(d.humidity)} %`, d.brightness != null && tx("luminosité {0} %", d.brightness)].filter(Boolean);
  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-2"><Title d={d} /><span className="flex flex-col items-end gap-1"><Switch on={d.on} /><State d={d} /></span></div>
      {values.length > 0 && <p className="font-mono text-lg font-bold">{values.join(" · ")}</p>}
      {d.battery_low && <p className="text-xs font-semibold text-warn">{tx("Pile faible")}</p>}
    </article>
  );
}

function Banner({ snap, devices }: Readonly<{ snap: Snapshot; devices: number }>) {
  const st = tapoState(snap), text = ({ ok: tx("Compte Tapo connecté"), warn: tx("Dernière lecture ancienne") } as Record<string, string>)[st.tone] ?? st.message;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3 ${BORDER[st.tone] ?? "border-line"}`}>
      <div className="flex flex-wrap gap-x-8 gap-y-1">
        <div><span className="block text-[11px] text-muted">{tx("Connecteur")}</span><b className={`text-[13px] ${TEXT[st.tone]}`}>{text}</b></div>
        <div><span className="block text-[11px] text-muted">{tx("Appareils trouvés")}</span><b className="text-[13px]">{devices}</b></div>
        <div><span className="block text-[11px] text-muted">{tx("Images des caméras")}</span><b className="text-[13px]">{tx("pas lues dans cette version")}</b></div>
      </div>
      <span className="rounded-full border border-[#4acbd6]/35 bg-[#4acbd6]/10 px-2.5 py-0.5 text-[11.5px] font-bold text-[#0b8f9b] dark:text-[#4acbd6]">{tx("lecture seule")}</span>
    </div>
  );
}

const TH = "bg-bg2 px-3 py-2 text-left text-[11px] font-semibold text-muted";

export function Tapo({ snap }: Readonly<{ snap: Snapshot }>) {
  const s = tapoSummary(snap)!, g = tapoGroups(snap), online = g.all.filter((d) => d.online).length;
  return (
    <div className="flex flex-col gap-5 py-4">
      <PageHead icon={Plug} logo={appIcon(["tapo"])} title="Tapo" tags={null} actions={snap.me.role === "admin" ? <ConnectorsLink /> : undefined} />
      <section>
        <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">{g.all.length ? tx("{0} appareils Tapo, {1} en ligne.", g.all.length, online) : tx("Aucun appareil Tapo lu pour le moment.")}</h2>
        <p className="mt-1.5 text-[15px] text-muted">{tx("Prises avec leur consommation, caméras avec leur état, lus sur ton réseau avec ton compte Tapo.")}</p>
      </section>
      <Banner snap={snap} devices={g.all.length} />
      {s.problems.length > 0 && (
        <section className={PANEL} aria-label={tx("À traiter")}>
          <div className={HEAD}><h2 className="text-sm font-bold">{tx("À traiter")}</h2></div>
          <ul className="px-4 py-2">{s.problems.map((p) => <li key={p} className="py-1 text-sm font-semibold">{p}</li>)}</ul>
        </section>
      )}
      {g.all.length > 0 && (
        <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label={tx("Chiffres clés")}>
          {s.watts !== null && <StatTile n={`${n(s.watts)} W`} label={tx("Consommation maintenant")} sub={tx("{0} prise(s) allumée(s)", g.plugs.filter((d) => d.on && d.power_w != null).length)} />}
          {s.today_kwh !== null && <StatTile n={`${n(s.today_kwh, 2)} kWh`} label={tx("Aujourd'hui")} sub={tx("depuis minuit")} />}
          {s.month_kwh !== null && <StatTile n={`${n(s.month_kwh, 1)} kWh`} label={tx("Ce mois")} sub={tx("depuis le 1er")} />}
          {s.cameras.total > 0 && <StatTile n={`${s.cameras.up} / ${s.cameras.total}`} label={tx("Caméras")} sub={tx("en ligne")} tone={s.cameras.up < s.cameras.total ? "warn" : undefined} />}
        </nav>
      )}
      {g.plugs.length > 0 && (
        <section aria-label={tx("Prises connectées")}>
          <h2 className="mb-2.5 text-base font-bold">{tx("Prises connectées")}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{g.plugs.map((d) => <PlugCard key={d.id} d={d} />)}</div>
        </section>
      )}
      {g.cameras.length > 0 && (
        <section aria-label={tx("Caméras")}>
          <h2 className="mb-2.5 text-base font-bold">{tx("Caméras")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.cameras.map((d) => <CameraCard key={d.id} d={d} />)}</div>
        </section>
      )}
      {g.others.length > 0 && (
        <section aria-label={tx("Autres appareils")}>
          <h2 className="mb-2.5 text-base font-bold">{tx("Autres appareils")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.others.map((d) => <OtherCard key={d.id} d={d} />)}</div>
        </section>
      )}
      {g.all.length > 0 && (
        <section className={PANEL} aria-label={tx("Tous les appareils")}>
          <div className={HEAD}><h2 className="text-sm font-bold">{tx("Tous les appareils")}</h2><span className="text-xs text-muted">{tx("{0} trouvés", g.all.length)}</span></div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead><tr><th className={TH}>{tx("Nom")}</th><th className={TH}>{tx("Modèle")}</th><th className={TH}>{tx("Adresse")}</th><th className={TH}>{tx("Wi-Fi")}</th><th className={TH}>{tx("Firmware")}</th><th className={TH}>{tx("État")}</th></tr></thead>
              <tbody>
                {g.all.map((d) => (
                  <tr key={d.id} className="border-t border-line even:bg-bg2/60">
                    <td className="whitespace-nowrap px-3 py-2">{d.name}</td><td className="whitespace-nowrap px-3 py-2">{d.model}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{d.ip || "-"}</td><td className="whitespace-nowrap px-3 py-2">{d.rssi != null ? `${d.rssi} dBm` : "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{d.fw || "-"}</td><td className="whitespace-nowrap px-3 py-2"><State d={d} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
