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
- `unifi-device-card.d.ts` (new, MyServices): the module only registers the `unifi-device-card` element, nothing is imported from it.

Excluded from SonarCloud (`sonar.exclusions`).
- `unifi-device-card-editor.js` (lines of the colour table) and `unique-id.js` (one line): a `// safety:allow` comment is appended. Those lines hold the words "token" (a design token name) and "password" (an entity name of the UniFi integration), which the sensitive-data guard flags; they are not credentials.
