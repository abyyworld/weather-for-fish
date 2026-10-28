/*
 * Synthetic API responses shaped exactly like Open-Meteo and iNaturalist, for
 * tests and offline development. Deterministic (seeded). Not real data.
 */
'use strict';
var FishMath = require('../../js/fishmath.js');

var HOUR = 3600000, DAY = 86400000;

function rng(seed) {
  var s = seed >>> 0 || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Smooth noise: sum of a few sines with random phases.
function smooth(rand, periodsH) {
  var parts = periodsH.map(function (p) { return { p: p, ph: rand() * 2 * Math.PI, a: 0.5 + rand() }; });
  var norm = parts.reduce(function (s, x) { return s + x.a; }, 0);
  return function (hoursSinceStart) {
    return parts.reduce(function (s, x) { return s + x.a * Math.sin(2 * Math.PI * hoursSinceStart / x.p + x.ph); }, 0) / norm;
  };
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function localStamp(ms, offsetSec) {
  var d = new Date(ms + offsetSec * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + ':00';
}

function hourTimes(now, offsetSec, pastDays, forecastDays) {
  var start = FishMath.localMidnight(now, offsetSec) - pastDays * DAY;
  var n = (pastDays + forecastDays) * 24, out = [];
  for (var i = 0; i < n; i++) out.push(start + i * HOUR);
  return out;
}

var r1 = function (v) { return Math.round(v * 10) / 10; };
var r2 = function (v) { return Math.round(v * 100) / 100; };

function forecast(o) {
  var rand = rng(o.seed || 7);
  var times = hourTimes(o.now, o.offsetSec, 7, 4);
  var tNoise = smooth(rand, [71, 131, 260]), cNoise = smooth(rand, [17, 43, 97]);
  var wNoise = smooth(rand, [11, 29, 61]), pNoise = smooth(rand, [55, 140]);
  var h = {
    time: [], temperature_2m: [], precipitation: [], cloud_cover: [], wind_speed_10m: [],
    pressure_msl: [], surface_pressure: [], shortwave_radiation: [], is_day: [], weather_code: []
  };
  times.forEach(function (t, i) {
    var lp = FishMath.localParts(t, o.offsetSec);
    var diurnal = Math.sin(2 * Math.PI * (lp.hour - 9) / 24);
    var temp = o.airMean + o.airSwing * diurnal + 3 * tNoise(i);
    var cloud = Math.max(0, Math.min(100, 50 + 60 * cNoise(i) + (o.cloudBias || 0)));
    var rain = cloud > 85 ? r1((cloud - 85) / 6 * (0.3 + rand())) : 0;
    var wind = Math.max(0.2, (o.windMean || 4) + 2.5 * wNoise(i) + 1.2 * Math.max(0, diurnal));
    var press = 1015 + 7 * pNoise(i);
    var alt = FishMath.sunAltitudeDeg(t - 30 * 60000, o.lat, o.lng);
    var rad = FishMath.estimateRadiation(alt, cloud);
    h.time.push(localStamp(t, o.offsetSec));
    h.temperature_2m.push(r1(temp));
    h.precipitation.push(rain);
    h.cloud_cover.push(Math.round(cloud));
    h.wind_speed_10m.push(r1(wind));
    h.pressure_msl.push(r1(press));
    h.surface_pressure.push(r1(press - (o.elevation || 0) * 0.12));
    h.shortwave_radiation.push(Math.round(rad));
    h.is_day.push(FishMath.sunAltitudeDeg(t, o.lat, o.lng) > 0 ? 1 : 0);
    h.weather_code.push(rain > 0 ? 61 : cloud > 80 ? 3 : cloud > 40 ? 2 : 0);
  });
  return {
    latitude: o.lat, longitude: o.lng, generationtime_ms: 0.5, utc_offset_seconds: o.offsetSec,
    timezone: o.timezone || 'GMT', timezone_abbreviation: o.tzAbbr || 'GMT', elevation: o.elevation || 0,
    hourly_units: {
      time: 'iso8601', temperature_2m: '°C', precipitation: 'mm', cloud_cover: '%', wind_speed_10m: 'm/s',
      pressure_msl: 'hPa', surface_pressure: 'hPa', shortwave_radiation: 'W/m²', is_day: '', weather_code: 'wmo code'
    },
    hourly: h
  };
}

function marine(o) {
  var rand = rng((o.seed || 7) + 101);
  var times = hourTimes(o.now, o.offsetSec, 1, 4);
  var wave = smooth(rand, [19, 47, 90]), cur = smooth(rand, [12.42, 37]);
  var h = {
    time: [], wave_height: [], wave_period: [], wave_direction: [], swell_wave_height: [],
    ocean_current_velocity: [], ocean_current_direction: [], sea_surface_temperature: [], sea_level_height_msl: []
  };
  times.forEach(function (t, i) {
    var lp = FishMath.localParts(t, o.offsetSec);
    var hs = Math.max(0.2, (o.waveMean || 1.4) + 0.6 * wave(i));
    var hrs = t / HOUR;
    h.time.push(localStamp(t, o.offsetSec));
    if (!o.sea) {
      ['wave_height', 'wave_period', 'wave_direction', 'swell_wave_height', 'ocean_current_velocity',
        'ocean_current_direction', 'sea_surface_temperature', 'sea_level_height_msl'].forEach(function (k) { h[k].push(null); });
      return;
    }
    h.wave_height.push(r2(hs));
    h.wave_period.push(r1(10 + 2 * wave(i + 5)));
    h.wave_direction.push(Math.round(285 + 10 * wave(i + 9)));
    h.swell_wave_height.push(r2(hs * 0.8));
    h.ocean_current_velocity.push(r1(Math.max(0.1, 0.9 + 0.6 * cur(i))));
    h.ocean_current_direction.push(Math.round(150 + 40 * cur(i + 3)));
    h.sea_surface_temperature.push(r1(o.sstMean + 0.3 * Math.sin(2 * Math.PI * (lp.hour - 14) / 24)));
    h.sea_level_height_msl.push(r2(0.55 * Math.cos(2 * Math.PI * (hrs - 3.1) / 12.42) + 0.25 * Math.cos(2 * Math.PI * (hrs - 7) / 23.93)));
  });
  return {
    latitude: o.lat + 0.02, longitude: o.lng - 0.02, generationtime_ms: 0.4, utc_offset_seconds: o.offsetSec,
    timezone: o.timezone || 'GMT', timezone_abbreviation: o.tzAbbr || 'GMT', elevation: 0,
    hourly_units: {
      time: 'iso8601', wave_height: 'm', wave_period: 's', wave_direction: '°', swell_wave_height: 'm',
      ocean_current_velocity: 'km/h', ocean_current_direction: '°', sea_surface_temperature: '°C', sea_level_height_msl: 'm'
    },
    hourly: h
  };
}

// Stable fake iNaturalist ids per scientific name.
function taxonId(name) {
  var h = 2166136261;
  for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 100000 + ((h >>> 0) % 800000);
}

// /v1/taxa?q=<name>: an exact match plus a decoy that must be ignored.
function taxaSearch(name) {
  return {
    total_results: 2, page: 1, per_page: 30,
    results: [
      { id: taxonId(name + ' decoy'), name: name + 'ella', rank: 'genus', iconic_taxon_name: 'Animalia', is_active: true },
      { id: taxonId(name), name: name, rank: 'family', iconic_taxon_name: 'Animalia', is_active: true }
    ]
  };
}

var SCENES = {
  sea: [
    ['Lutrinae', 'Enhydra lutris', 'Sea Otter', 8, 1, 6],
    ['Otariidae', 'Zalophus californianus', 'California Sea Lion', 9, 1, 12],
    ['Phocidae', 'Phoca vitulina', 'Harbor Seal', 6, 1, 10],
    ['Pelecanidae', 'Pelecanus occidentalis', 'Brown Pelican', 7, 1, 14],
    ['Phalacrocoracidae', 'Urile penicillatus', "Brandt's Cormorant", 5, 1, 9],
    ['Larinae', 'Larus occidentalis', 'Western Gull', 10, 0.5, 15],
    ['Ardeidae', 'Ardea herodias', 'Great Blue Heron', 3, 1, 8],
    ['Delphinidae', 'Delphinus delphis', 'Common Dolphin', 2, 6, 20],
    ['Selachimorpha', 'Carcharodon carcharias', 'Great White Shark', 1, 8, 16],
    ['Pandion', 'Pandion haliaetus', 'Osprey', 1, 3, 12]
  ],
  lake: [
    ['Ardeidae', 'Ardea cinerea', 'Grey Heron', 4, 0.5, 6],
    ['Phalacrocoracidae', 'Phalacrocorax carbo', 'Great Cormorant', 3, 1, 8],
    ['Alcedinidae', 'Alcedo atthis', 'Common Kingfisher', 2, 0.5, 5],
    ['Esox', 'Esox lucius', 'Northern Pike', 2, 0.3, 4],
    ['Larinae', 'Chroicocephalus ridibundus', 'Black-headed Gull', 5, 1, 10],
    ['Lutrinae', 'Lutra lutra', 'Eurasian Otter', 1, 2, 9]
  ]
};

function observations(o) {
  var rand = rng((o.seed || 7) + 202), out = [], id = 900000000;
  SCENES[o.sea ? 'sea' : 'lake'].forEach(function (row) {
    for (var i = 0; i < row[3]; i++) {
      var dist = row[4] + rand() * (row[5] - row[4]);
      var brg = (o.sea ? 200 : 0) + rand() * (o.sea ? 200 : 360);
      var dLat = dist / 111.2 * Math.cos(brg * Math.PI / 180);
      var dLng = dist / (111.2 * Math.cos(o.lat * Math.PI / 180)) * Math.sin(brg * Math.PI / 180);
      var age = Math.pow(rand(), 1.6) * 20 * DAY;
      var t = o.now - age - 2 * HOUR;
      var lat = o.lat + dLat, lng = o.lng + dLng;
      var sid = taxonId(row[1]);
      out.push({
        id: id++, quality_grade: 'research', obscured: false,
        observed_on: localStamp(t, o.offsetSec).slice(0, 10),
        time_observed_at: new Date(t).toISOString(),
        geojson: { type: 'Point', coordinates: [lng, lat] }, location: lat.toFixed(5) + ',' + lng.toFixed(5),
        taxon: { id: sid, name: row[1], preferred_common_name: row[2], rank: 'species', ancestor_ids: [1, 2, taxonId(row[0]), sid] },
        photos: [], user: { login: 'synthetic-sample' }, place_guess: o.place || '',
        uri: 'https://www.inaturalist.org/observations/' + id
      });
    }
  });
  return { total_results: out.length, page: 1, per_page: 200, results: out };
}

// Monterey Bay at the end of October (PDT, UTC-7).
var MONTEREY = {
  lat: 36.66, lng: -121.88, place: 'Monterey Bay', offsetSec: -25200, timezone: 'America/Los_Angeles', tzAbbr: 'PDT',
  sea: true, airMean: 15, airSwing: 4, sstMean: 14.6, windMean: 4.5, waveMean: 1.5, cloudBias: -5, seed: 11
};
// A lowland English lake at the end of October (GMT).
var LAKE = {
  lat: 52.48, lng: -1.93, place: 'Test Reservoir', offsetSec: 0, timezone: 'Europe/London', tzAbbr: 'GMT',
  sea: false, airMean: 11, airSwing: 4, windMean: 3.5, seed: 5
};

function scenario(base, now) {
  var o = Object.assign({}, base, { now: now });
  return { forecast: forecast(o), marine: marine(o), observations: observations(o), options: o };
}

module.exports = {
  forecast: forecast, marine: marine, observations: observations, taxaSearch: taxaSearch, taxonId: taxonId,
  scenario: scenario, MONTEREY: MONTEREY, LAKE: LAKE
};
