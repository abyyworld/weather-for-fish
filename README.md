# 🐟 Weather for Fish

> **Target audience:** fish. **Smartphone adoption among target audience:** 0%.

A weather app whose users are fish. Every screen talks *to a fish* and answers a fish's questions: Can I breathe? Is it too hot? What's hunting me? Are the humans coming? Is there food?

It's a joke played completely straight. Underneath, every number comes from live data and real science.

![Not intended for use by fish](https://img.shields.io/badge/not%20intended%20for%20use%20by-fish-orange)

## Run it

**Double-click `index.html`.** That's it: no build step, no API keys, no server. It works from `file://`.

- **Demo mode:** click **🎬 Demo mode**, or open `index.html?demo`. It loads a bundled snapshot from `js/demo-data.js`, so it works with no Wi-Fi at all.
- **Capture a fresh demo at the venue:** pick your spot, then click **💾 Save as demo**. It downloads a new `demo-data.js` (predator photos included where the browser allows) and Demo mode uses it straight away. Drop the file into `js/` to bundle it permanently.
- **Or capture from the command line** (Node 18+, inlines the predator photos so it works offline):
  ```bash
  node tools/capture-demo.js 36.66 -121.88 "Monterey Bay" trout
  ```

> ⚠️ **Before the demo:** the bundled `js/demo-data.js` is currently a **synthetic placeholder** (generated test data, shown with a red "SYNTHETIC SAMPLE" tag). Replace it with a real capture using either method above. Then every number on screen really is real.

### Tests

```bash
npm test            # forecast maths, node:test (29 tests, no dependencies)
npm run test:e2e    # full app in Chromium via Playwright, from file://, all APIs mocked
```

The browser test clicks the map, reads the water report, clicks a radar blip, switches Trout → Clownfish, has the anchor read the forecast, saves and reloads a demo snapshot, checks a phone-width layout, runs fully offline, and knocks out each API in turn to make sure the rest keeps working.

## The pitch (30 seconds)

Weather apps are built for humans. Humans want to know if it'll rain. **Fish don't care if it rains. They're already wet.** A fish wants to know: is there enough oxygen in the water, is a heron standing suspiciously still nearby, and is it Saturday morning (because that's when the humans with rods come).

So we built the weather app for fish. Fish can't use it. But every number on it is real.

## What it does

| Feature | What the fish learns | Where the number comes from |
|---|---|---|
| 🗺️ **Map** | Where home is | Click anywhere, search (Open-Meteo geocoding + OSM Nominatim), or jump to a famous fish address |
| 🐟 **Fish picker** | Trout, Salmon 🍣, Carp 🎏, Goldfish, Clownfish | Each has its own preferred temperature range, lethal limits, oxygen minimum, body length and swim speed |
| 🌡️ **Water temperature** | *Feels like for a trout:* Perfect / Brisk / Hot tub warning / Under the ice | Sea: real sea-surface temperature (Open-Meteo Marine). Lakes and rivers: 4-day exponential moving average of the last 7 days of air temperature, because water lags the air |
| 🫧 **Breathability** | Can I breathe, now and at the pre-dawn low? | Oxygen saturation polynomial, then an hourly oxygen budget (see below) |
| 🌀 **Washing Machine Index** | How rough is it? How deep to escape? | Wave energy flux ρg²H²T/64π; wave motion fades to 4% at half a wavelength |
| ➰ **Currents** | Can I swim against it? | Current speed in **body lengths per second**, the unit fish physiologists actually use |
| 🌊 **Tides** | Next high and low. Don't get stranded in a tide pool | Turning points of modelled sea level, interpolated between hours |
| 🎈 **Swim bladder report** | Why do I feel floaty? | Met Office pressure-tendency terms + Boyle's law: 1 hPa ≈ 1 cm of water |
| 🦈 **Predator Radar** | What's hunting me, how far, which way | Real iNaturalist sightings, plotted at true distance and bearing |
| 🎣 **Hook Danger** | Are the humans coming? | Weekend, dawn/dusk, calm, dry, pleasant, falling barometer |
| 🪱 **Snack Index** | Is there food? | Rain washing worms in, dusk insect hatches, moon phase, solunar periods |
| 🌙 **Solunar Tables** | When to feed | John Alden Knight's 1926 theory, computed from the moon's actual position |
| 📅 **72-hour timeline** | Best time to swim each day, overall grade A–F | All of the above, hour by hour |
| 📺 **Fish News** | The most important thing, read aloud | Priority: salt water → oxygen → predators → fishermen → temperature → "Conditions are great, go be a fish." Always ends with "Blub." |

## The science (for the judges)

- **Oxygen saturation:** `DOsat = 14.652 − 0.41022T + 0.007991T² − 0.000077774T³` mg/L (fresh water), ×0.8 for sea water, scaled by surface air pressure (Henry's law), so mountain lakes hold less oxygen.
- **Oxygen over time:** an hourly open-water metabolism model (Odum, 1956). Algae add oxygen in proportion to measured sunlight (`shortwave_radiation`); everything respires faster when warm (θ = 1.047, as in Streeter-Phelps); wind exchanges gas with the air using the Cole & Caraco (1998) gas-transfer velocity, scaled to O₂ by its Schmidt number (Wanninkhof, 1992). The pre-dawn oxygen low, and the fish-kill risk on hot, cloudy, windless days, *emerge* from the model rather than being hard-coded. Ice cover stops wind exchange and dims the light (winterkill).
- **Lake temperature:** `Tw += (1 − e^(−Δt/τ))(Tair − Tw)` with τ = 96 h, spun up over 7 days of past data.
- **Predator threat:** each sighting weighs `danger × e^(−d/(R/3)) × 0.5^(age/7 days)`. Repeat sightings of the same predator type count for less (×0.6ⁿ), because fifty photos of one gull colony is fifty tourists, not fifty times the danger. Herons and gulls rest at night; crocodiles don't.
- **iNaturalist:** no hard-coded taxon IDs. Predators are looked up at runtime by scientific name via `/v1/taxa` (exact matches only, cached in `localStorage`), then **one** `/v1/observations` query with lat, lng, radius, d1 and every taxon ID.
- **Solunar tables:** moon altitude sampled every 10 minutes and refined by golden-section search (transits) and bisection (rise and set), checked against SunCalc to within 3 minutes in the tests. Southern-hemisphere users get the mirrored moon emoji, because that's how the moon looks from there.
- **Time zones:** Open-Meteo returns local wall-clock times without an offset. We parse the date and time parts ourselves and apply `utc_offset_seconds`, so a judge in a different time zone sees the fish's local time. A test runs the parser under four different `TZ` settings to prove it.

## Demo script (about 2 minutes)

1. **(0:00) Open on the nearest water.** Search for the lake, river or coast nearest the venue, or click it on the map. *"This is a weather app. The target audience is fish. Smartphone adoption among our target audience is 0%."*
2. **(0:20) The anchor reads the forecast.** Click **🔊 Read it to me.** Finn Gillespie, Fish News Channel 0, reads the most important alert first, in a high, bubbly voice. It ends with "Blub."
3. **(0:45) Predator radar.** Scroll to the radar as it sweeps and lights up real herons, cormorants, seals (whatever was actually seen nearby this week). Click a blip: real photo, date, distance, bearing, and a fish-facing warning. *"Heron: stands perfectly still for 20 minutes. Do not trust the statue."*
4. **(1:10) Switch Trout to Clownfish.** The water goes from *Perfect* to *Brisk*, the grade drops, and if you're on a lake the anchor declares an osmotic emergency.
5. **(1:30) The esoteric part.** Scroll to the Solunar Tables: John Alden Knight's 1926 theory of fish feeding times, computed from the moon's real position, with total seriousness.
6. **(1:50) Close:** *"Fish can't use this. But every number on screen is real."*

If the Wi-Fi dies, press **🎬 Demo mode** (or open `index.html?demo`). Everything, including the radar, runs from the bundled snapshot.

## How it's built

Plain HTML, CSS and JavaScript. Classic `<script>` tags (no modules) so it runs from `file://`. Leaflet, SunCalc and the Nunito font are vendored into `vendor/`; nothing loads from a CDN.

```
index.html            the page
css/style.css         underwater theme, animations, phone layout
js/fishmath.js        ALL forecast maths: pure functions, no DOM, tested with node:test
js/data.js            fish physiology, predator profiles, quick spots
js/api.js             Open-Meteo, iNaturalist, Nominatim (with fallbacks)
js/radar.js           the canvas radar
js/fishart.js         SVG fish portraits for each species
js/app.js             wiring, rendering, speech, demo mode, animations
js/demo-data.js       window.DEMO = {...} bundled snapshot (works offline)
tools/                capture a real snapshot / regenerate the placeholder
test/                 node:test unit tests, Playwright browser test, fixtures
```

If one API fails, the rest of the app keeps working, and the failure is reported in character: *"Radar offline: a heron is standing on the antenna."*

## Credits

Weather and marine data: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Predator sightings and photos: [iNaturalist](https://www.inaturalist.org/) observers (licences shown per photo). Maps: © OpenStreetMap contributors, Esri. Moon and sun: [SunCalc](https://github.com/mourner/suncalc). Map library: [Leaflet](https://leafletjs.com/). Font: Nunito (OFL). Solunar theory: John Alden Knight, 1926.

**Not intended for use by fish.**
