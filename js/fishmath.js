/*
 * Weather for Fish: forecast maths.
 *
 * Pure functions only: no DOM, no fetch, no clock. Every function takes the
 * current time as an argument so the same code runs in the browser, in demo
 * mode on a frozen snapshot, and under node:test.
 *
 * Times are epoch milliseconds (true instants). Open-Meteo's local wall-clock
 * strings are converted with the response's utc_offset_seconds, never with the
 * browser's timezone.
 */
(function (root, factory) {
  var sc = root && root.SunCalc;
  if (!sc && typeof require === 'function') sc = require('../vendor/suncalc.js');
  var api = factory(sc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FishMath = api;
})(typeof self !== 'undefined' ? self : this, function (SunCalc) {
  'use strict';

  var MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
  var RAD = Math.PI / 180;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function mean(arr) {
    var s = 0, n = 0;
    for (var i = 0; i < arr.length; i++) if (isNum(arr[i])) { s += arr[i]; n++; }
    return n ? s / n : null;
  }
  function round(v, dp) { var f = Math.pow(10, dp || 0); return Math.round(v * f) / f; }

  // ---------------------------------------------------------------- time ----

  // "2026-10-28T14:00" (location wall clock) -> epoch ms.
  function parseLocalTime(str, offsetSec) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(str || '');
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) -
      (offsetSec || 0) * 1000;
  }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Wall-clock parts at the location, independent of the browser timezone.
  function localParts(ms, offsetSec) {
    var d = new Date(ms + (offsetSec || 0) * 1000);
    var p = {
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay()
    };
    p.dateKey = p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
    p.weekdayName = WEEKDAYS[p.weekday];
    return p;
  }

  function localMidnight(ms, offsetSec) {
    var off = (offsetSec || 0) * 1000;
    return Math.floor((ms + off) / DAY) * DAY - off;
  }

  function formatClock(ms, offsetSec) {
    var p = localParts(Math.round(ms / MINUTE) * MINUTE, offsetSec);
    return pad2(p.hour) + ':' + pad2(p.minute);
  }

  // Fallback when the forecast API is down: solar time zone from longitude.
  function guessOffsetSec(lng) { return Math.round(lng / 15) * 3600 || 0; }

  // --------------------------------------------------------------- units ----

  function toMetresPerSecond(v, unit) {
    if (!isNum(v)) return null;
    switch ((unit || '').toLowerCase()) {
      case 'km/h': return v / 3.6;
      case 'mph': return v * 0.44704;
      case 'kn': case 'knots': return v * 0.514444;
      default: return v;
    }
  }

  // ----------------------------------------------------------------- geo ----

  function haversineKm(lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * RAD, dLng = (lng2 - lng1) * RAD;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Initial great-circle bearing, degrees clockwise from north.
  function bearingDeg(lat1, lng1, lat2, lng2) {
    var p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lng2 - lng1) * RAD;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compassPoint(deg) { return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }

  // ------------------------------------------------------------ astronomy ----

  function sunAltitudeDeg(ms, lat, lng) {
    return SunCalc.getPosition(new Date(ms), lat, lng).altitude / RAD;
  }
  function moonAltitudeDeg(ms, lat, lng) {
    return SunCalc.getMoonPosition(new Date(ms), lat, lng).altitude / RAD;
  }

  // Sunrise and sunset for the local day that starts at dayStart.
  function sunTimes(dayStart, lat, lng) {
    var t = SunCalc.getTimes(new Date(dayStart + 12 * HOUR), lat, lng);
    function ms(d) { return d && isFinite(d.getTime()) ? d.getTime() : null; }
    return { sunrise: ms(t.sunrise), sunset: ms(t.sunset), noon: ms(t.solarNoon) };
  }

  // Haurwitz (1945) clear-sky irradiance with Kasten & Czeplak (1980) cloud
  // attenuation. Used only when the forecast has no shortwave_radiation.
  function estimateRadiation(sunAltDeg, cloudPct) {
    var cosz = Math.sin(sunAltDeg * RAD);
    if (cosz <= 0) return 0;
    var clear = 1098 * cosz * Math.exp(-0.057 / cosz);
    var n = clamp((cloudPct || 0) / 100, 0, 1);
    return clear * (1 - 0.75 * Math.pow(n, 3.4));
  }

  // ------------------------------------------------------- forecast input ----

  function pick(arr, i) { return arr && isNum(arr[i]) ? arr[i] : null; }

  // Merge the Open-Meteo forecast and marine responses into one hourly series.
  function buildHourly(forecast, marine) {
    if (!forecast || !forecast.hourly || !forecast.hourly.time) return [];
    var off = forecast.utc_offset_seconds || 0, h = forecast.hourly, u = forecast.hourly_units || {};
    var byT = {};
    if (marine && marine.hourly && marine.hourly.time) {
      var moff = isNum(marine.utc_offset_seconds) ? marine.utc_offset_seconds : off;
      var mh = marine.hourly, mu = marine.hourly_units || {};
      for (var j = 0; j < mh.time.length; j++) {
        byT[parseLocalTime(mh.time[j], moff)] = {
          sst: pick(mh.sea_surface_temperature, j),
          waveHeight: pick(mh.wave_height, j),
          wavePeriod: pick(mh.wave_period, j),
          waveDir: pick(mh.wave_direction, j),
          swellHeight: pick(mh.swell_wave_height, j),
          currentSpeed: toMetresPerSecond(pick(mh.ocean_current_velocity, j), mu.ocean_current_velocity || 'km/h'),
          currentDir: pick(mh.ocean_current_direction, j),
          seaLevel: pick(mh.sea_level_height_msl, j)
        };
      }
    }
    var out = [];
    for (var i = 0; i < h.time.length; i++) {
      var t = parseLocalTime(h.time[i], off), m = byT[t] || {};
      out.push({
        t: t,
        airTemp: pick(h.temperature_2m, i),
        precip: pick(h.precipitation, i),
        cloud: pick(h.cloud_cover, i),
        wind: toMetresPerSecond(pick(h.wind_speed_10m, i), u.wind_speed_10m || 'km/h'),
        pressure: pick(h.pressure_msl, i),
        surfacePressure: pick(h.surface_pressure, i),
        radiation: pick(h.shortwave_radiation, i),
        weatherCode: pick(h.weather_code, i),
        sst: isNum(m.sst) ? m.sst : null,
        waveHeight: isNum(m.waveHeight) ? m.waveHeight : null,
        wavePeriod: isNum(m.wavePeriod) ? m.wavePeriod : null,
        waveDir: isNum(m.waveDir) ? m.waveDir : null,
        swellHeight: isNum(m.swellHeight) ? m.swellHeight : null,
        currentSpeed: isNum(m.currentSpeed) ? m.currentSpeed : null,
        currentDir: isNum(m.currentDir) ? m.currentDir : null,
        seaLevel: isNum(m.seaLevel) ? m.seaLevel : null
      });
    }
    return out;
  }

  // Index of the hour containing `now`.
  function nowIndex(hours, now) {
    var idx = 0;
    for (var i = 0; i < hours.length; i++) if (hours[i].t <= now) idx = i;
    return idx;
  }

  // Sea or lake? The marine API returns null sea-surface temperatures inland.
  // If it had to snap to a sea cell far away, we are inland too.
  function detectSea(marine, lat, lng) {
    var sst = marine && marine.hourly && marine.hourly.sea_surface_temperature;
    if (!sst || !sst.length) return { isSea: false, reason: 'no-marine' };
    var valid = 0;
    for (var i = 0; i < sst.length; i++) if (isNum(sst[i])) valid++;
    if (valid < sst.length * 0.5) return { isSea: false, reason: 'null-sst' };
    if (isNum(marine.latitude) && isNum(marine.longitude) && isNum(lat)) {
      var km = haversineKm(lat, lng, marine.latitude, marine.longitude);
      if (km > 30) return { isSea: false, reason: 'far-cell', cellKm: km };
    }
    return { isSea: true, reason: 'sst' };
  }

  // ------------------------------------------------------ water temperature ----

  // Lakes and rivers: exponential moving average of air temperature with a
  // ~4 day time constant, seeded with the first day's mean. Water has a heat
  // capacity about 3500x that of air per unit volume, so it lags and smooths.
  function emaWaterTemps(airTemps, tauHours, dtHours) {
    var tau = tauHours || 96, dt = dtHours || 1;
    var alpha = 1 - Math.exp(-dt / tau);
    var w = mean(airTemps.slice(0, 24));
    if (w === null) w = mean(airTemps);
    if (w === null) return airTemps.map(function () { return null; });
    return airTemps.map(function (T) {
      if (isNum(T)) w += alpha * (T - w);
      return w;
    });
  }

  function fillGaps(arr) {
    var out = arr.slice(), last = null, i;
    for (i = 0; i < out.length; i++) { if (isNum(out[i])) last = out[i]; else if (last !== null) out[i] = last; }
    last = null;
    for (i = out.length - 1; i >= 0; i--) { if (isNum(out[i])) last = out[i]; else if (last !== null) out[i] = last; }
    return out;
  }

  function waterTemperatures(hours, isSea) {
    if (isSea) {
      var sst = hours.map(function (h) { return h.sst; });
      if (sst.some(isNum)) return { temps: fillGaps(sst), source: 'sst' };
    }
    var ema = emaWaterTemps(hours.map(function (h) { return h.airTemp; }));
    // Fresh water does not go below 0 °C; it freezes instead.
    return { temps: ema.map(function (v) { return isNum(v) ? Math.max(isSea ? -1.8 : 0, v) : v; }), source: 'ema' };
  }

  function feelsLike(T, sp, isSea) {
    if (!isNum(T)) return null;
    var comfort;
    if (T >= sp.tempMin && T <= sp.tempMax) comfort = 1;
    else if (T < sp.tempMin) comfort = clamp((T - sp.tempColdLethal) / (sp.tempMin - sp.tempColdLethal), 0, 1);
    else comfort = clamp((sp.tempLethal - T) / (sp.tempLethal - sp.tempMax), 0, 1);
    var iceLine = isSea ? -1.0 : 1.0;
    var r = { comfort: comfort, tempC: T };
    if (T <= iceLine) {
      r.key = 'ice'; r.label = 'Under the ice'; r.emoji = '🧊';
      r.detail = isSea
        ? 'Sea ice forming. Stay deep and slow.'
        : 'The lake is lidded. Water is densest at 4 °C, so the bottom stays about 4 °C. Go deep and hold still.';
    } else if (T < sp.tempMin) {
      r.key = 'brisk'; r.label = 'Brisk'; r.emoji = '🥶';
      r.detail = round(sp.tempMin - T, 1) + ' °C below a ' + sp.name.toLowerCase() + "'s happy place (" + sp.tempMin + '–' + sp.tempMax + ' °C).';
    } else if (T > sp.tempMax) {
      r.key = 'hot'; r.label = 'Hot tub warning'; r.emoji = '♨️';
      r.detail = round(T - sp.tempMax, 1) + ' °C above a ' + sp.name.toLowerCase() + "'s happy place (" + sp.tempMin + '–' + sp.tempMax + ' °C)' +
        (T >= sp.tempLethal - 2 ? '. Approaching lethal.' : '.');
    } else {
      r.key = 'perfect'; r.label = 'Perfect'; r.emoji = '😌';
      r.detail = 'Right inside a ' + sp.name.toLowerCase() + "'s happy place (" + sp.tempMin + '–' + sp.tempMax + ' °C).';
    }
    return r;
  }

  function salinityCheck(sp, isSea) {
    if (sp.water === 'both') return { ok: true, note: sp.seaNote || null };
    if (sp.water === 'fresh' && isSea) {
      if (sp.seaNote) return { ok: true, note: sp.seaNote };
      return { ok: false, note: 'You are a freshwater fish in the sea. Salt water is pulling the water out of you through your gills. Osmotic emergency.' };
    }
    if (sp.water === 'sea' && !isSea) {
      return { ok: false, note: 'You are a saltwater fish in fresh water. Your cells are filling up with water. Osmotic emergency. (See: Finding Nemo, the dentist scene.)' };
    }
    return { ok: true, note: null };
  }

  // ------------------------------------------------------- dissolved oxygen ----

  // Saturation in mg/L (Elmore & Hayes polynomial, fresh water at 1 atm).
  // Sea water holds ~20% less; pressure scales it linearly (Henry's law), so
  // alpine lakes hold less oxygen than sea-level ones.
  function doSaturation(T, opts) {
    opts = opts || {};
    var s = 14.652 - 0.41022 * T + 0.007991 * T * T - 0.000077774 * T * T * T;
    if (opts.saline) s *= 0.8;
    if (isNum(opts.pressureHPa)) s *= opts.pressureHPa / 1013.25;
    return s;
  }

  // Schmidt number of O2 (Wanninkhof 1992).
  function schmidtO2(T, saline) {
    return saline
      ? 1953.4 - 128.0 * T + 3.9918 * T * T - 0.050091 * T * T * T
      : 1800.6 - 120.1 * T + 3.7818 * T * T - 0.047608 * T * T * T;
  }

  // Gas transfer velocity for O2 in m/h: Cole & Caraco (1998) k600 from wind,
  // scaled to O2 with the Schmidt number (exponent from Jähne et al. 1987).
  function oxygenTransferVelocity(windMs, T, saline) {
    var u = Math.max(0, windMs || 0);
    var k600 = 2.07 + 0.215 * Math.pow(u, 1.7); // cm/h
    var n = u < 3.7 ? 0.67 : 0.5;
    return k600 * Math.pow(Math.max(schmidtO2(T, saline), 50) / 600, -n) / 100;
  }

  // Open-water metabolism model (Odum 1956): each hour, algae add oxygen in
  // proportion to sunlight, everything respires (faster when warm, theta =
  // 1.047), and wind exchanges gas with the air. Night-time respiration with
  // no photosynthesis gives the classic pre-dawn minimum; hot, cloudy, calm
  // days give the fish-kill scenario.
  var METABOLISM = {
    fresh: { mixDepth: 2, gppRef: 2.0, r20: 1.6 },  // mg O2/L/day; gppRef per 6 kWh/m²/day of sun
    sea: { mixDepth: 10, gppRef: 1.0, r20: 0.8 }
  };

  function simulateOxygen(hours, temps, opts) {
    opts = opts || {};
    var p = opts.isSea ? METABOLISM.sea : METABOLISM.fresh;
    var out = [], DO = null;
    for (var i = 0; i < hours.length; i++) {
      var h = hours[i], T = isNum(temps[i]) ? temps[i] : 15;
      var press = isNum(h.surfacePressure) ? h.surfacePressure : (isNum(h.pressure) ? h.pressure : 1013.25);
      var sat = doSaturation(T, { saline: opts.isSea, pressureHPa: press });
      var light = isNum(h.radiation) ? h.radiation
        : (isNum(opts.lat) ? estimateRadiation(sunAltitudeDeg(h.t - 30 * MINUTE, opts.lat, opts.lng), h.cloud) : 0);
      var ice = !opts.isSea && T <= 0.5;
      if (ice) light *= 0.1; // snow and ice block most light
      var gpp = p.gppRef / 6000 * light * Math.pow(1.036, T - 20);
      var resp = p.r20 / 24 * Math.pow(1.047, T - 20);
      var k = ice ? 0 : oxygenTransferVelocity(h.wind, T, opts.isSea) / p.mixDepth;
      if (DO === null) DO = sat * 0.95;
      else {
        DO = DO + gpp - resp;
        DO = sat + (DO - sat) * Math.exp(-k);
      }
      DO = Math.max(0.1, DO);
      out.push({ mgL: DO, sat: sat, pct: DO / sat * 100, ice: ice });
    }
    return out;
  }

  function breathability(mgL, sp) {
    if (!isNum(mgL)) return null;
    var ratio = mgL / sp.doMin;
    var r = { ratio: ratio, mgL: mgL, need: sp.doMin };
    if (ratio >= 1.5) { r.level = 0; r.label = 'Breathe easy'; r.emoji = '🫧'; }
    else if (ratio >= 1.15) { r.level = 1; r.label = 'Fine'; r.emoji = '🙂'; }
    else if (ratio >= 1.0) { r.level = 2; r.label = 'Stuffy'; r.emoji = '😮‍💨'; }
    else if (ratio >= 0.7) { r.level = 3; r.label = 'Gasping'; r.emoji = '😵'; }
    else { r.level = 4; r.label = 'Suffocating'; r.emoji = '☠️'; }
    return r;
  }

  // ------------------------------------------------------------ sea state ----

  // Wave energy flux P = rho g^2 H^2 T / (64 pi) ~ 0.49 H^2 T kW per metre of crest.
  function washingMachine(heightM, periodS) {
    if (!isNum(heightM)) return null;
    var T = isNum(periodS) && periodS > 0 ? periodS : 8;
    var kw = 0.49 * heightM * heightM * T;
    var index = clamp(10 * Math.log(1 + kw) / Math.log(1 + 200), 0, 10);
    var label = heightM < 0.3 ? 'Off (glassy)' : heightM < 0.8 ? 'Delicates' : heightM < 1.5 ? 'Normal cycle'
      : heightM < 2.5 ? 'Heavy duty' : heightM < 4 ? 'Spin cycle' : 'Industrial laundromat';
    // Orbital motion decays as e^(-kz); at half a wavelength it is down to e^-pi = 4%.
    var calmDepth = 0.5 * 9.81 * T * T / (2 * Math.PI);
    return { index: index, label: label, kwPerM: kw, heightM: heightM, periodS: T, calmDepthM: calmDepth };
  }

  function currentVerdict(speedMs, dirDeg, sp) {
    if (!isNum(speedMs)) return null;
    var bl = speedMs / sp.bodyLengthM, cruise = sp.ucritBL * sp.bodyLengthM;
    var verdict = speedMs < 0.6 * cruise ? 'Swimmable upstream' : speedMs < cruise ? 'Hard work' : 'Go with the flow';
    return {
      speedMs: speedMs, bodyLengthsPerSec: bl, verdict: verdict,
      towardDeg: dirDeg, toward: isNum(dirDeg) ? compassPoint(dirDeg) : null
    };
  }

  // Local maxima/minima of sea level after `from`, refined with a parabola.
  function findTides(times, levels, from, max) {
    var out = [], lastLevel = null;
    for (var i = 1; i < levels.length - 1; i++) {
      var a = levels[i - 1], b = levels[i], c = levels[i + 1];
      if (!isNum(a) || !isNum(b) || !isNum(c)) continue;
      var high = b > a && b >= c, low = b < a && b <= c;
      if (!high && !low) continue;
      var denom = a - 2 * b + c;
      var dx = denom !== 0 ? clamp(0.5 * (a - c) / denom, -0.5, 0.5) : 0;
      var t = times[i] + dx * (times[i + 1] - times[i]);
      var level = b - 0.25 * (a - c) * dx;
      if (lastLevel !== null && Math.abs(level - lastLevel) < 0.05) continue; // ignore surge wiggles
      lastLevel = level;
      if (t >= from) out.push({ t: t, level: level, type: high ? 'high' : 'low' });
    }
    return out.slice(0, max || 4);
  }

  // ---------------------------------------------------------- swim bladder ----

  // Met Office pressure-tendency vocabulary over 3 hours.
  function pressureTendency(hours, idx) {
    if (!hours[idx] || !isNum(hours[idx].pressure)) return null;
    var j = Math.max(0, idx - 3);
    if (!isNum(hours[j].pressure) || j === idx) return null;
    var delta = hours[idx].pressure - hours[j].pressure, a = Math.abs(delta);
    var dir = delta < 0 ? 'falling' : 'rising';
    var label = a < 0.1 ? 'Steady' : a <= 1.5 ? dir + ' slowly' : a <= 3.5 ? dir : a <= 6 ? dir + ' quickly' : dir + ' very rapidly';
    label = label.charAt(0).toUpperCase() + label.slice(1);
    // Boyle's law for a fish at 1 m: total pressure = air + 98.1 hPa of water.
    var p2 = hours[idx].pressure + 98.1, p1 = p2 - delta;
    return {
      pressure: hours[idx].pressure, delta3h: delta, label: label, falling: delta <= -0.1,
      equivalentDepthCm: -delta * 100 / (1000 * 9.81) * 100,
      bladderPct: (p1 / p2 - 1) * 100
    };
  }

  // ------------------------------------------------------------- predators ----

  // name -> id map from iNaturalist, plus our predator list -> lookup tables.
  function predatorTaxonIndex(predators, taxaMap) {
    var idToKey = {}, ids = [];
    predators.forEach(function (p) {
      p.taxa.forEach(function (name) {
        var id = taxaMap && taxaMap[name];
        if (isNum(id) && !idToKey[id]) { idToKey[id] = p.key; ids.push(id); }
      });
    });
    return { idToKey: idToKey, ids: ids };
  }

  // Keep only results whose scientific name matches exactly (and are animals).
  function exactTaxonMatch(results, name) {
    var want = name.toLowerCase();
    for (var i = 0; i < (results || []).length; i++) {
      var r = results[i];
      if (!r || !r.name || r.name.toLowerCase() !== want) continue;
      if (r.iconic_taxon_name && /^(Plantae|Fungi|Chromista|Protozoa)$/.test(r.iconic_taxon_name)) continue;
      if (r.is_active === false) continue;
      return r.id;
    }
    return null;
  }

  function observationPredatorKey(obs, idToKey) {
    var ids = [];
    if (obs.taxon) {
      ids.push(obs.taxon.id);
      if (obs.taxon.ancestor_ids) ids = ids.concat(obs.taxon.ancestor_ids);
      if (typeof obs.taxon.ancestry === 'string') ids = ids.concat(obs.taxon.ancestry.split('/').map(Number));
    }
    if (obs.ident_taxon_ids) ids = ids.concat(obs.ident_taxon_ids);
    for (var i = 0; i < ids.length; i++) if (idToKey[ids[i]]) return idToKey[ids[i]];
    return null;
  }

  function observationLatLng(obs) {
    if (obs.geojson && obs.geojson.coordinates) return { lat: +obs.geojson.coordinates[1], lng: +obs.geojson.coordinates[0] };
    if (typeof obs.location === 'string') {
      var parts = obs.location.split(',');
      return { lat: +parts[0], lng: +parts[1] };
    }
    return null;
  }

  function observationTime(obs, offsetSec) {
    var t = obs.time_observed_at ? Date.parse(obs.time_observed_at) : NaN;
    if (!isFinite(t) && obs.observed_on) t = parseLocalTime(obs.observed_on + 'T12:00', offsetSec);
    return isFinite(t) ? t : null;
  }

  // Danger x proximity x recency. Proximity decays over a third of the radar
  // range; recency halves every 7 days.
  function threatWeight(danger, distanceKm, ageDays, radiusKm) {
    var prox = Math.exp(-distanceKm / ((radiusKm || 25) / 3));
    var rec = Math.pow(0.5, Math.max(0, ageDays) / 7);
    return danger * prox * rec;
  }

  function predatorBlips(observations, opts) {
    var byKey = {};
    opts.predators.forEach(function (p) { byKey[p.key] = p; });
    var out = [];
    (observations || []).forEach(function (obs) {
      var key = observationPredatorKey(obs, opts.idToKey);
      var pos = observationLatLng(obs);
      if (!key || !pos || !isNum(pos.lat) || !isNum(pos.lng)) return;
      var p = byKey[key], d = haversineKm(opts.lat, opts.lng, pos.lat, pos.lng);
      if (d > opts.radiusKm * 1.05) return;
      var when = observationTime(obs, opts.offsetSec);
      var age = when === null ? 30 : Math.max(0, (opts.now - when) / DAY);
      var brg = bearingDeg(opts.lat, opts.lng, pos.lat, pos.lng);
      var photo = obs.photos && obs.photos[0];
      var tx = obs.taxon || {};
      out.push({
        id: obs.id, key: key, name: p.name, plural: p.plural || null, emoji: p.emoji, danger: p.danger, blurb: p.blurb, activity: p.activity,
        lat: pos.lat, lng: pos.lng, distanceKm: d, bearing: brg, compass: compassPoint(brg),
        observedMs: when, observedOn: obs.observed_on || null, ageDays: age,
        weight: threatWeight(p.danger, d, age, opts.radiusKm),
        commonName: tx.preferred_common_name || null, sciName: tx.name || null,
        photo: photo ? (photo.dataUrl || photo.url) : (tx.default_photo && tx.default_photo.square_url) || null,
        photoAttribution: photo ? photo.attribution : (tx.default_photo && tx.default_photo.attribution) || null,
        uri: obs.uri || (obs.id ? 'https://www.inaturalist.org/observations/' + obs.id : null),
        user: obs.user && obs.user.login, obscured: !!obs.obscured
      });
    });
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out;
  }

  // Per predator type, extra sightings count for less (0.6^n): fifty photos of
  // the same gull colony is not fifty times the danger, just fifty tourists.
  function predatorWeightsByKey(blips) {
    var byKey = {};
    blips.forEach(function (b) { (byKey[b.key] = byKey[b.key] || []).push(b.weight); });
    var out = {};
    Object.keys(byKey).forEach(function (k) {
      var ws = byKey[k].sort(function (a, b) { return b - a; }), s = 0;
      for (var i = 0; i < ws.length; i++) s += ws[i] * Math.pow(0.6, i);
      out[k] = s;
    });
    return out;
  }

  function threatLevel(score) {
    if (score >= 80) return { label: 'MAXIMUM PERIL', emoji: '🚨' };
    if (score >= 55) return { label: 'Hide in the weeds', emoji: '🌿' };
    if (score >= 30) return { label: 'Keep an eye out', emoji: '👀' };
    if (score >= 10) return { label: 'Mostly quiet', emoji: '🙂' };
    return { label: 'Calm waters', emoji: '😌' };
  }

  function predatorThreat(blips) {
    var w = predatorWeightsByKey(blips), sum = 0;
    Object.keys(w).forEach(function (k) { sum += w[k]; });
    var score = Math.round(100 * (1 - Math.exp(-sum / 1.5)));
    var top = Object.keys(w).sort(function (a, b) { return w[b] - w[a]; });
    var lvl = threatLevel(score);
    return { score: score, label: lvl.label, emoji: lvl.emoji, byKey: w, topKeys: top, count: blips.length };
  }

  // How active a predator type is at a given sun altitude.
  function activityFactor(activity, sunAlt) {
    var twilight = sunAlt > -12 && sunAlt < 10, day = sunAlt >= 0;
    switch (activity) {
      case 'day': return day ? 1 : sunAlt > -6 ? 0.6 : 0.15;
      case 'twilight': return twilight ? 1.4 : day ? 0.8 : 0.5;
      case 'night': return day ? 0.6 : 1.3;
      default: return 1;
    }
  }

  function hourlyThreat(threat, predators, sunAlt) {
    if (!threat) return null;
    var act = {}, sum = 0;
    predators.forEach(function (p) { act[p.key] = p.activity; });
    Object.keys(threat.byKey).forEach(function (k) { sum += threat.byKey[k] * activityFactor(act[k], sunAlt); });
    return Math.round(100 * (1 - Math.exp(-sum / 1.5)));
  }

  // ------------------------------------------------------------ fishermen ----

  function nearSunEvent(t, sun, windowH) {
    var w = (windowH || 1.5) * HOUR;
    if (sun.sunrise !== null && Math.abs(t - sun.sunrise) <= w) return 'dawn';
    if (sun.sunset !== null && Math.abs(t - sun.sunset) <= w) return 'dusk';
    return null;
  }

  // People with rods come out at weekends, at dawn and dusk, in calm, dry,
  // pleasant weather, and when the barometer falls (anglers believe fish bite).
  function hookDanger(ctx) {
    var lp = localParts(ctx.t, ctx.offsetSec), reasons = [];
    var edge = nearSunEvent(ctx.t, ctx.sun), dark = ctx.sunAlt < -6;
    var base;
    if (edge) { base = 1; reasons.push(edge === 'dawn' ? 'dawn patrol' : 'dusk session'); }
    else if (dark) {
      base = ctx.speciesKey === 'carp' ? 0.45 : 0.08;
      if (ctx.speciesKey === 'carp') reasons.push('carp anglers camp overnight with bite alarms');
    } else base = 0.45;
    var wk = 0.8;
    if (lp.weekday === 0 || lp.weekday === 6) { wk = 1.5; reasons.push(lp.weekdayName); }
    else if (lp.weekday === 5 && lp.hour >= 16) { wk = 1.15; reasons.push('Friday evening'); }
    var wind = isNum(ctx.wind) ? ctx.wind : 3;
    var fw = wind < 4 ? 1 : wind < 8 ? 0.7 : 0.35;
    if (wind < 4) reasons.push('calm');
    var rain = isNum(ctx.precip) ? ctx.precip : 0;
    var fr = rain < 0.1 ? 1 : rain < 1 ? 0.7 : 0.35;
    if (rain < 0.1) reasons.push('dry');
    var T = isNum(ctx.airTemp) ? ctx.airTemp : 15;
    var ft = T >= 10 && T <= 25 ? 1 : (T >= 5 && T <= 30) ? 0.75 : 0.45;
    if (ft === 1) reasons.push('pleasant ' + Math.round(T) + ' °C');
    var fp = ctx.pressureDelta3h !== null && ctx.pressureDelta3h <= -1 ? 1.25 : 1;
    if (fp > 1) reasons.push('falling barometer (anglers believe you bite)');
    var raw = base * wk * fw * fr * ft * fp;
    var score = Math.round(clamp(raw / 1.4, 0, 1) * 100);
    var label = score >= 75 ? "Hook o'clock" : score >= 50 ? 'Rods out' : score >= 25 ? 'A few rods' : 'Humans elsewhere';
    return { score: score, label: label, reasons: reasons };
  }

  // ---------------------------------------------------------------- snacks ----

  function moonFeedingBoost(phase) { return Math.abs(Math.cos(2 * Math.PI * phase)); } // 1 at new and full

  // Rain washes worms and land insects in; mayflies and caddis hatch at dusk
  // (and dawn) once the water is warm enough; feeding peaks at new and full
  // moon and during solunar periods.
  function snackIndex(ctx) {
    var reasons = [];
    var rain6 = isNum(ctx.rain6h) ? ctx.rain6h : 0;
    var fRain = rain6 <= 0.2 ? 0 : rain6 > 15 ? 0.6 : clamp(rain6 / 4, 0, 1);
    if (fRain > 0.2) reasons.push(rain6 > 15 ? 'storm runoff (muddy but meaty)' : 'rain washing in worms and beetles');
    var edge = nearSunEvent(ctx.t, ctx.sun, 1.5);
    var warm = clamp(((ctx.waterTemp || 0) - 8) / 10, 0, 1);
    var fHatch = edge === 'dusk' ? warm : edge === 'dawn' ? 0.6 * warm : 0;
    if (fHatch > 0.2) reasons.push((edge === 'dusk' ? 'evening' : 'morning') + ' insect hatch');
    var fMoon = moonFeedingBoost(ctx.moonPhase || 0);
    if (fMoon > 0.8) reasons.push(ctx.moonPhase > 0.25 && ctx.moonPhase < 0.75 ? 'full moon' : 'new moon');
    var fSol = ctx.solunar === 'major' ? 1 : ctx.solunar === 'minor' ? 0.5 : 0;
    if (fSol) reasons.push('solunar ' + ctx.solunar + ' period');
    var score = Math.round(100 * clamp(0.12 + 0.3 * fRain + 0.3 * fHatch + 0.12 * fMoon + 0.2 * fSol, 0, 1));
    var label = score >= 70 ? 'Buffet' : score >= 45 ? 'Snacks about' : score >= 25 ? 'Slim pickings' : 'Fasting';
    return { score: score, label: label, reasons: reasons };
  }

  // -------------------------------------------------------------- solunar ----

  function goldenExtreme(f, a, b, findMax) {
    var g = (Math.sqrt(5) - 1) / 2, c = b - g * (b - a), d = a + g * (b - a);
    var sgn = findMax ? -1 : 1, fc = sgn * f(c), fd = sgn * f(d);
    for (var i = 0; i < 30; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sgn * f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sgn * f(d); }
    }
    return (a + b) / 2;
  }

  function bisect(f, a, b) {
    var fa = f(a);
    for (var i = 0; i < 25; i++) {
      var m = (a + b) / 2, fm = f(m);
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
    }
    return (a + b) / 2;
  }

  var MOON_HORIZON = 0.133; // degrees, as in SunCalc.getMoonTimes

  // All lunar events (transits and horizon crossings) in [from, to).
  function lunarEvents(from, to, lat, lng) {
    var step = 10 * MINUTE, ts = [], alts = [], ev = [];
    var alt = function (t) { return moonAltitudeDeg(t, lat, lng); };
    for (var t = from - step; t <= to + step; t += step) { ts.push(t); alts.push(alt(t)); }
    for (var i = 1; i < ts.length - 1; i++) {
      if (alts[i] > alts[i - 1] && alts[i] >= alts[i + 1]) ev.push({ type: 'overhead', t: goldenExtreme(alt, ts[i - 1], ts[i + 1], true) });
      if (alts[i] < alts[i - 1] && alts[i] <= alts[i + 1]) ev.push({ type: 'underfoot', t: goldenExtreme(alt, ts[i - 1], ts[i + 1], false) });
    }
    for (var j = 0; j < ts.length - 1; j++) {
      var a = alts[j] - MOON_HORIZON, b = alts[j + 1] - MOON_HORIZON;
      if ((a <= 0) !== (b <= 0)) {
        ev.push({ type: a <= 0 ? 'moonrise' : 'moonset', t: bisect(function (x) { return alt(x) - MOON_HORIZON; }, ts[j], ts[j + 1]) });
      }
    }
    ev = ev.filter(function (e) { return e.t >= from && e.t < to; });
    ev.sort(function (x, y) { return x.t - y.t; });
    return ev;
  }

  var PHASES = [
    { max: 0.0339, name: 'New Moon', n: '🌑', s: '🌑' },
    { max: 0.2161, name: 'Waxing Crescent', n: '🌒', s: '🌘' },
    { max: 0.2839, name: 'First Quarter', n: '🌓', s: '🌗' },
    { max: 0.4661, name: 'Waxing Gibbous', n: '🌔', s: '🌖' },
    { max: 0.5339, name: 'Full Moon', n: '🌕', s: '🌕' },
    { max: 0.7161, name: 'Waning Gibbous', n: '🌖', s: '🌔' },
    { max: 0.7839, name: 'Last Quarter', n: '🌗', s: '🌓' },
    { max: 0.9661, name: 'Waning Crescent', n: '🌘', s: '🌒' },
    { max: 1.0001, name: 'New Moon', n: '🌑', s: '🌑' }
  ];

  // In the southern hemisphere the moon is seen upside down, so the lit side
  // of a waxing moon is on the left: use the mirrored emoji.
  function moonPhase(ms, lat) {
    var il = SunCalc.getMoonIllumination(new Date(ms));
    var p = PHASES.filter(function (x) { return il.phase < x.max; })[0] || PHASES[0];
    return { phase: il.phase, fraction: il.fraction, name: p.name, emoji: lat < 0 ? p.s : p.n };
  }

  // John Alden Knight's Solunar Tables (1926): major periods (two hours) when
  // the moon is overhead or underfoot, minor periods (one hour) at moonrise
  // and moonset. Best when they line up with sunrise/sunset, and at new and
  // full moon.
  function solunarDay(dayStart, lat, lng) {
    var ev = lunarEvents(dayStart, dayStart + DAY, lat, lng);
    var sun = sunTimes(dayStart, lat, lng);
    var periods = ev.map(function (e) {
      var major = e.type === 'overhead' || e.type === 'underfoot';
      var half = major ? HOUR : 30 * MINUTE;
      return { kind: major ? 'major' : 'minor', type: e.type, peak: e.t, start: e.t - half, end: e.t + half };
    });
    var phase = moonPhase(dayStart + 12 * HOUR, lat);
    var boost = moonFeedingBoost(phase.phase);
    var coincide = periods.some(function (p) {
      return [sun.sunrise, sun.sunset].some(function (s) { return s !== null && s >= p.start - HOUR && s <= p.end + HOUR; });
    });
    var rating = clamp(1 + Math.round(2 * boost) + (coincide ? 1 : 0), 1, 4);
    return {
      dayStart: dayStart, periods: periods, sun: sun, phase: phase, rating: rating, sunCoincides: coincide,
      missing: ['moonrise', 'moonset'].filter(function (k) { return !ev.some(function (e) { return e.type === k; }); })
    };
  }

  function solunarAt(t, days) {
    var best = null;
    for (var i = 0; i < days.length; i++) {
      var ps = days[i].periods;
      for (var j = 0; j < ps.length; j++) {
        if (t >= ps[j].start && t <= ps[j].end) {
          if (ps[j].kind === 'major') return 'major';
          best = 'minor';
        }
      }
    }
    return best;
  }

  // ----------------------------------------------------------- swim grade ----

  function swimScore(f) {
    var survival = Math.min(f.comfort, f.oxygen, f.salinity === false ? 0.1 : 1);
    var safety = 0.35 * f.predatorSafety + 0.3 * f.hookSafety + 0.2 * f.snacks + 0.15 * f.calm;
    return Math.round(100 * Math.pow(clamp(survival, 0, 1), 0.6) * (0.3 + 0.7 * safety));
  }

  function letterGrade(score) {
    if (!isNum(score)) return null;
    return score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  }

  // ------------------------------------------------------------ the report ----

  function oxygenScore(b) { return b ? clamp((b.ratio - 0.8) / 0.6, 0, 1) : 1; }

  /*
   * Everything the UI shows, from raw API responses.
   * input: { forecast, marine, observations, taxa, species, predators,
   *          waterMode: 'auto'|'sea'|'fresh', now, lat, lng, place, radiusKm }
   */
  function buildReport(input) {
    var sp = input.species, now = input.now, lat = input.lat, lng = input.lng;
    var radiusKm = input.radiusKm || 25;
    var hours = buildHourly(input.forecast, input.marine);
    var hasWeather = hours.length > 0;
    var offsetSec = input.forecast && isNum(input.forecast.utc_offset_seconds)
      ? input.forecast.utc_offset_seconds
      : (input.marine && isNum(input.marine.utc_offset_seconds) ? input.marine.utc_offset_seconds : guessOffsetSec(lng));
    var detected = detectSea(input.marine, lat, lng);
    var isSea = input.waterMode === 'sea' ? true : input.waterMode === 'fresh' ? false : detected.isSea;

    var r = {
      place: input.place, lat: lat, lng: lng, now: now, offsetSec: offsetSec, species: sp,
      isSea: isSea, seaDetection: detected, waterMode: input.waterMode || 'auto',
      hasWeather: hasWeather, salinity: salinityCheck(sp, isSea)
    };

    // Solunar: pure astronomy, works even with every API down.
    var today = localMidnight(now, offsetSec);
    r.solunar = { days: [] };
    for (var d = 0; d < 4; d++) r.solunar.days.push(solunarDay(today + d * DAY, lat, lng));
    r.solunar.today = r.solunar.days[0];
    r.moon = moonPhase(now, lat);
    var nextPeriod = null;
    r.solunar.days.forEach(function (day) {
      day.periods.forEach(function (p) { if (!nextPeriod && p.end >= now) nextPeriod = p; });
    });
    r.solunar.next = nextPeriod;
    r.solunar.activeNow = solunarAt(now, r.solunar.days);

    // Predators
    if (input.observations) {
      var tix = predatorTaxonIndex(input.predators, input.taxa || {});
      var blips = predatorBlips(input.observations, {
        lat: lat, lng: lng, now: now, radiusKm: radiusKm, idToKey: tix.idToKey,
        predators: input.predators, offsetSec: offsetSec
      });
      r.predators = { blips: blips, threat: predatorThreat(blips), radiusKm: radiusKm };
    }

    if (!hasWeather) {
      r.broadcast = composeBroadcast(r);
      return r;
    }

    var water = waterTemperatures(hours, isSea);
    var oxygen = simulateOxygen(hours, water.temps, { isSea: isSea, lat: lat, lng: lng });
    r.waterSource = water.source;
    var idx = nowIndex(hours, now);
    r.nowIndex = idx;

    var sunCache = {};
    function sunFor(t) {
      var k = localMidnight(t, offsetSec);
      return sunCache[k] || (sunCache[k] = sunTimes(k, lat, lng));
    }

    // Per-hour derived values from now to +72 h.
    var timeline = [];
    var end = Math.min(hours.length, idx + 73);
    for (var i = idx; i < end; i++) {
      var h = hours[i], T = water.temps[i];
      var sunAlt = sunAltitudeDeg(h.t, lat, lng);
      var sun = sunFor(h.t);
      var rain6 = 0;
      for (var k = Math.max(0, i - 5); k <= i; k++) rain6 += hours[k].precip || 0;
      var tend = pressureTendency(hours, i);
      var sol = solunarAt(h.t, r.solunar.days);
      var feels = feelsLike(T, sp, isSea);
      var breath = breathability(oxygen[i].mgL, sp);
      var hook = hookDanger({
        t: h.t, offsetSec: offsetSec, sun: sun, sunAlt: sunAlt, wind: h.wind, precip: h.precip,
        airTemp: h.airTemp, pressureDelta3h: tend ? tend.delta3h : null, speciesKey: sp.key
      });
      var snack = snackIndex({
        t: h.t, sun: sun, rain6h: rain6, waterTemp: T, moonPhase: moonPhase(h.t, lat).phase, solunar: sol
      });
      var threat = r.predators ? hourlyThreat(r.predators.threat, input.predators, sunAlt) : null;
      var wm = isSea ? washingMachine(h.waveHeight, h.wavePeriod) : null;
      var score = swimScore({
        comfort: feels ? feels.comfort : 0.5,
        oxygen: oxygenScore(breath),
        salinity: r.salinity.ok,
        predatorSafety: threat === null ? 0.7 : 1 - threat / 100,
        hookSafety: 1 - hook.score / 100,
        snacks: snack.score / 100,
        calm: wm ? 1 - wm.index / 10 : 0.8
      });
      timeline.push({
        t: h.t, i: i, waterTemp: T, airTemp: h.airTemp, feels: feels, oxygen: oxygen[i], breath: breath,
        hook: hook, snack: snack, threat: threat, waves: wm, solunar: sol, sunAlt: sunAlt,
        precip: h.precip, wind: h.wind, pressure: h.pressure, score: score, grade: letterGrade(score)
      });
    }
    r.timeline = timeline;

    var cur = timeline[0], h0 = hours[idx];
    r.current = {
      t: h0.t, airTemp: h0.airTemp, waterTemp: cur.waterTemp, feels: cur.feels,
      oxygen: cur.oxygen, breath: cur.breath, hook: cur.hook, snack: cur.snack, threat: cur.threat,
      pressure: pressureTendency(hours, idx), wind: h0.wind, precip: h0.precip, cloud: h0.cloud
    };
    // Lowest oxygen in the next 24 h (usually just before dawn).
    var low = null;
    timeline.slice(0, 25).forEach(function (x) { if (!low || x.oxygen.mgL < low.oxygen.mgL) low = x; });
    r.current.oxygenLow = low ? { t: low.t, mgL: low.oxygen.mgL, breath: low.breath } : null;

    if (isSea) {
      r.current.waves = washingMachine(h0.waveHeight, h0.wavePeriod);
      r.current.swellHeight = h0.swellHeight;
      r.current.current = currentVerdict(h0.currentSpeed, h0.currentDir, sp);
      var tideTimes = [], tideLevels = [];
      hours.forEach(function (x) { tideTimes.push(x.t); tideLevels.push(x.seaLevel); });
      r.current.tides = findTides(tideTimes, tideLevels, now, 4);
    }

    // Best time to swim per local day, and the overall grade.
    var days = {}, order = [];
    timeline.forEach(function (x) {
      var key = localParts(x.t, offsetSec).dateKey;
      if (!days[key]) { days[key] = x; order.push(key); }
      else if (x.score > days[key].score) days[key] = x;
    });
    r.bestTimes = order.map(function (key) {
      var x = days[key], lp = localParts(x.t, offsetSec);
      return { dateKey: key, weekday: lp.weekdayName, t: x.t, score: x.score, grade: x.grade };
    });
    var next24 = timeline.slice(0, 24).map(function (x) { return x.score; });
    var gradeScore = Math.round(0.7 * mean(next24) + 0.3 * Math.min.apply(null, next24));
    r.grade = { score: gradeScore, letter: letterGrade(gradeScore) };

    r.broadcast = composeBroadcast(r);
    return r;
  }

  // ------------------------------------------------------------ broadcast ----

  function greeting(r) {
    var hr = localParts(r.now, r.offsetSec).hour;
    var part = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    var where = r.place ? ' of ' + r.place : '';
    return part + ', ' + r.species.name.toLowerCase() + where + '.';
  }

  /*
   * The anchor reads the most important alert first:
   * salinity, oxygen, predators, fishermen, temperature, otherwise all clear.
   */
  function composeBroadcast(r) {
    var sp = r.species, alerts = [], c = r.current || {};
    var clock = function (t) { return formatClock(t, r.offsetSec); };

    if (r.salinity && !r.salinity.ok) {
      alerts.push({ kind: 'salinity', icon: '🧂', text: r.salinity.note });
    }
    if (c.breath && c.breath.level >= 2) {
      alerts.push({ kind: 'oxygen', icon: '🫁', text: 'Oxygen alert: dissolved oxygen is ' + round(c.breath.mgL, 1) +
        ' mg/L and a ' + sp.name.toLowerCase() + ' needs ' + sp.doMin + '. ' + c.breath.label + '. Stay near the surface where the wind mixes air in.' });
    } else if (c.oxygenLow && c.oxygenLow.breath && c.oxygenLow.breath.level >= 2) {
      alerts.push({ kind: 'oxygen', icon: '🫁', text: 'Oxygen alert: algae will use up the oxygen overnight. It bottoms out at ' +
        round(c.oxygenLow.mgL, 1) + ' mg/L around ' + clock(c.oxygenLow.t) + '. A ' + sp.name.toLowerCase() + ' needs ' + sp.doMin + '.' });
    }
    if (r.predators && r.predators.threat.score >= 45) {
      var th = r.predators.threat, nearest = r.predators.blips.slice().sort(function (a, b) { return a.distanceKm - b.distanceKm; })[0];
      var names = th.topKeys.slice(0, 3).map(function (k) {
        var b = r.predators.blips.filter(function (x) { return x.key === k; })[0];
        return b ? (b.plural || b.name.toLowerCase() + 's') : k;
      });
      alerts.push({ kind: 'predators', icon: '🦈', text: 'Predator warning, threat ' + th.score + ' out of 100: ' + listJoin(names) +
        ' sighted nearby.' + (nearest ? ' Closest: a ' + nearest.name.toLowerCase() + ' ' + round(nearest.distanceKm, 1) + ' km ' + nearest.compass + '.' : '') });
    }
    var hookPeak = null;
    (r.timeline || []).slice(0, 7).forEach(function (x) { if (!hookPeak || x.hook.score > hookPeak.hook.score) hookPeak = x; });
    if (hookPeak && hookPeak.hook.score >= 60) {
      alerts.push({ kind: 'fishermen', icon: '🎣', text: 'Fishermen forecast: ' + hookPeak.hook.label + ' at ' + clock(hookPeak.t) +
        '. Humans with rods expected: ' + listJoin(hookPeak.hook.reasons.slice(0, 3)) + '. If a worm looks too good to be true, it is.' });
    }
    if (c.feels && (c.feels.key === 'hot' || ((c.feels.key === 'brisk' || c.feels.key === 'ice') && c.feels.comfort < 0.6))) {
      var hot = c.feels.key === 'hot';
      alerts.push({ kind: 'temperature', icon: hot ? '♨️' : '🥶', text: (hot ? 'Heat warning: ' : 'Cold warning: ') + 'the water is ' +
        round(c.waterTemp, 1) + ' °C. ' + c.feels.label + '. ' + c.feels.detail });
    }

    var lines = [greeting(r)];
    var allClear = !alerts.length;
    if (allClear) lines.push(r.hasWeather ? 'Conditions are great, go be a fish.' : 'The weather satellites are down, but the moon still works. Conditions: probably fine. Go be a fish.');
    alerts.slice(0, 3).forEach(function (a) { lines.push(a.text); });
    if (r.grade) lines.push('Overall swim grade: ' + r.grade.letter + '.');
    if (r.solunar && r.solunar.next) {
      var p = r.solunar.next;
      lines.push('Next solunar ' + p.kind + ' feeding period: ' + clock(p.start) + ' to ' + clock(p.end) + '.');
    }
    lines.push('Blub.');
    return {
      headline: allClear ? 'Conditions are great, go be a fish.' : alerts[0].text,
      kind: allClear ? 'clear' : alerts[0].kind, icon: allClear ? '✅' : alerts[0].icon,
      alerts: alerts, lines: lines, text: lines.join(' ')
    };
  }

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  return {
    HOUR: HOUR, DAY: DAY,
    isNum: isNum, clamp: clamp, round: round, mean: mean, listJoin: listJoin,
    parseLocalTime: parseLocalTime, localParts: localParts, localMidnight: localMidnight,
    formatClock: formatClock, guessOffsetSec: guessOffsetSec, toMetresPerSecond: toMetresPerSecond,
    haversineKm: haversineKm, bearingDeg: bearingDeg, compassPoint: compassPoint,
    sunAltitudeDeg: sunAltitudeDeg, moonAltitudeDeg: moonAltitudeDeg, sunTimes: sunTimes,
    estimateRadiation: estimateRadiation,
    buildHourly: buildHourly, nowIndex: nowIndex, detectSea: detectSea,
    emaWaterTemps: emaWaterTemps, waterTemperatures: waterTemperatures, feelsLike: feelsLike,
    salinityCheck: salinityCheck,
    doSaturation: doSaturation, schmidtO2: schmidtO2, oxygenTransferVelocity: oxygenTransferVelocity,
    simulateOxygen: simulateOxygen, breathability: breathability,
    washingMachine: washingMachine, currentVerdict: currentVerdict, findTides: findTides,
    pressureTendency: pressureTendency,
    predatorTaxonIndex: predatorTaxonIndex, exactTaxonMatch: exactTaxonMatch,
    observationPredatorKey: observationPredatorKey, observationLatLng: observationLatLng,
    threatWeight: threatWeight, predatorBlips: predatorBlips, predatorThreat: predatorThreat,
    activityFactor: activityFactor, hourlyThreat: hourlyThreat,
    hookDanger: hookDanger, snackIndex: snackIndex,
    lunarEvents: lunarEvents, moonPhase: moonPhase, solunarDay: solunarDay, solunarAt: solunarAt,
    swimScore: swimScore, letterGrade: letterGrade,
    buildReport: buildReport, composeBroadcast: composeBroadcast
  };
});
