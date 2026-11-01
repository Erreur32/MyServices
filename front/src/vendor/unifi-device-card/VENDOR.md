# unifi-device-card (vendored)

Source: https://github.com/bluenazgul/unifi-device-card (MIT, see LICENSE).
Copied from the `src/` directory of the upstream repository.

This copy comes from the one vendored by MynetworK (https://github.com/Erreur32/MynetworK, `src/vendor/unifi-device-card`, branch
`feat/card-uplink-detection`, commit c63b54f, i.e. MynetworK 0.11.1); to refresh from the released version once it is out. The local changes
below are MynetworK's, copied as they are:

- `mynetwork-adapter.js` (new): builds the device context and a synthetic `hass.states` from UniFi devices (the shape served by MynetworK's
  `GET /api/plugins/unifi/card-devices`) instead of Home Assistant entities.
- `helpers.js`: `buildDeviceContext` delegates `mn:` device ids to the adapter.
- `unifi-device-card.js`: front panel background reads `--udc-panel-bg` (theming); the initial port selection prefers the real uplink; port RX/TX
  are shown as bit/s, kbit/s, Mbit/s, Gbit/s; `VERSION` is a constant (no build-time define); ports with live traffic get a `has-traffic` class
  and a faster LED blink (`port_led_traffic_blink_speed`).
- `unifi-device-card.js` (MyServices): config `mark_port: <n>` puts a `marked` class on that port (`_renderPortButton`) and a frame around it (`.port.marked` in `_styles`); used by the machine window to show the port a machine is plugged into. To redo after a refresh from upstream: those two spots only.
- `unifi-device-card.js` (MyServices): `_measuredCardWidth` and `_measuredFrontPanelContentWidth` read the layout width first: the Network page zooms the card with a transform, which must not fold the rows.
- `unifi-device-card.js` (MyServices): `.header`, `.detail-grid`, `.detail-title`, `.panel-label` and `.port-num` read `--udc-text-zoom`: the Network page keeps the texts at their size at any zoom of the card, only images and ports follow it.
- `unifi-device-card.js` (MyServices): `.detail-grid` lays its items out in as many columns as fit, and the port title sits in that grid as its first column: the port details read on one line.
- `unifi-device-card.js` (MyServices): `.integrated-port-section` sizes the front panel of an access point to its ports, the port details take the rest of the width.
- `unifi-device-card.js` (MyServices): the port rows of `.frontpanel.integrated-ports` are zoomed by 1.4: bigger ports on access points only.
- `unifi-device-card.d.ts` (new, MyServices): the module only registers the `unifi-device-card` element, nothing is imported from it.

Excluded from SonarCloud (`sonar.exclusions`).
- `unifi-device-card-editor.js` (lines of the colour table) and `unique-id.js` (one line): a `// safety:allow` comment is appended. Those lines hold the words "token" (a design token name) and "password" (an entity name of the UniFi integration), which the sensitive-data guard flags; they are not credentials.
