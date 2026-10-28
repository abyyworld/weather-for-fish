'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var execFileSync = require('node:child_process').execFileSync;

var FM = require('../js/fishmath.js');
var D = require('../js/data.js');
var SunCalc = require('../vendor/suncalc.js');
var S = require('./fixtures/synth.js');

var HOUR = 3600000, DAY = 86400000;
var near = function (actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, (msg || '') + ' expected ' + expected + ' ± ' + tol + ', got ' + actual);
};
function allTaxa() {
  var t = {};
  D.PREDATORS.forEach(function (p) { p.taxa.forEach(function (n) { t[n] = S.taxonId(n); }); });
  return t;
}
function report(base, now, speciesKey, extra) {
  var sc = S.scenario(base, now);
  return FM.buildReport(Object.assign({
    forecast: sc.forecast, marine: sc.marine, observations: sc.observations.results, taxa: allTaxa(),
    species: D.FISH[speciesKey], predators: D.PREDATORS, now: now, lat: base.lat, lng: base.lng, place: base.place
  }, extra || {}));
}

test('Open-Meteo local times are parsed with the API offset, not the browser timezone', function () {
  // 14:00 in UTC-7 is 21:00 UTC.
  assert.equal(FM.parseLocalTime('2026-10-28T14:00', -25200), Date.UTC(2026, 9, 28, 21, 0));
  assert.equal(FM.parseLocalTime('2026-10-28T00:30', 19800), Date.UTC(2026, 9, 27, 19, 0)); // UTC+5:30
  var t = FM.parseLocalTime('2026-12-31T23:00', 3600);
  var p = FM.localParts(t, 3600);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.weekdayName], [2026, 12, 31, 23, 'Thursday']);
  assert.equal(FM.formatClock(t, 3600), '23:00');
  assert.equal(FM.localMidnight(t, 3600), FM.parseLocalTime('2026-12-31T00:00', 3600));
});

test('time parsing gives identical results whatever TZ the process runs in', function () {
  var script = 'var FM=require(' + JSON.stringify(path.join(__dirname, '..', 'js', 'fishmath.js')) + ');' +
    'var t=FM.parseLocalTime("2026-03-29T01:30",3600);' +
    'process.stdout.write(t+" "+FM.formatClock(t,3600)+" "+FM.localParts(t,3600).dateKey);';
  var outputs = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata'].map(function (tz) {
    return execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: tz }) }).toString();
  });
  outputs.forEach(function (o) { assert.equal(o, outputs[0]); });
  assert.match(outputs[0], / 01:30 2026-03-29$/);
});

test('units are converted to m/s', function () {
  near(FM.toMetresPerSecond(36, 'km/h'), 10, 1e-9);
  near(FM.toMetresPerSecond(10, 'kn'), 5.14444, 1e-4);
  assert.equal(FM.toMetresPerSecond(4, 'm/s'), 4);
  assert.equal(FM.toMetresPerSecond(null, 'km/h'), null);
});

test('great-circle distance and bearing', function () {
  near(FM.haversineKm(51.5074, -0.1278, 48.8566, 2.3522), 343.5, 1.5, 'London to Paris');
  near(FM.bearingDeg(0, 0, 0, 1), 90, 1e-6);
  near(FM.bearingDeg(0, 0, 1, 0), 0, 1e-6);
  near(FM.bearingDeg(0, 0, -1, 0), 180, 1e-6);
  assert.equal(FM.compassPoint(359), 'N');
  assert.equal(FM.compassPoint(225), 'SW');
  assert.equal(FM.compassPoint(292.5), 'WNW');
});

test('oxygen saturation polynomial matches reference values', function () {
  near(FM.doSaturation(0), 14.652, 1e-9);
  near(FM.doSaturation(20), 9.02, 0.01);
  near(FM.doSaturation(30), 7.44, 0.01);
  near(FM.doSaturation(20, { saline: true }), 0.8 * FM.doSaturation(20), 1e-9);
  // Henry's law: a lake at ~2000 m (800 hPa) holds ~21% less oxygen.
  near(FM.doSaturation(10, { pressureHPa: 800 }) / FM.doSaturation(10), 800 / 1013.25, 1e-9);
});

test('wind speeds up gas exchange; warm water has a lower Schmidt number', function () {
  assert.ok(FM.oxygenTransferVelocity(10, 15) > 3 * FM.oxygenTransferVelocity(1, 15));
  assert.ok(FM.schmidtO2(25) < FM.schmidtO2(5));
  near(FM.schmidtO2(20), 530, 2);
});

test('lake water temperature is a 4-day exponential moving average of air temperature', function () {
  var flat = FM.emaWaterTemps(new Array(200).fill(12));
  flat.forEach(function (v) { near(v, 12, 1e-9); });
  // Step from 10 to 20 °C: after one time constant (96 h) we are 63% of the way.
  var air = new Array(24).fill(10).concat(new Array(200).fill(20));
  var w = FM.emaWaterTemps(air);
  near(w[23 + 96], 10 + 10 * (1 - Math.exp(-1)), 0.05);
  near(w[w.length - 1], 20 - 10 * Math.exp(-200 / 96), 0.05);
});

test('fresh water clamps at 0 °C and reads "Under the ice"', function () {
  var hours = new Array(48).fill(0).map(function (_, i) { return { t: i * HOUR, airTemp: -8, sst: null }; });
  var wt = FM.waterTemperatures(hours, false);
  assert.equal(wt.source, 'ema');
  assert.equal(wt.temps[47], 0);
  assert.equal(FM.feelsLike(0, D.FISH.trout, false).label, 'Under the ice');
});

test('feels-like labels depend on the fish', function () {
  assert.equal(FM.feelsLike(13, D.FISH.trout, false).label, 'Perfect');
  assert.equal(FM.feelsLike(13, D.FISH.clownfish, true).label, 'Brisk');
  assert.equal(FM.feelsLike(23, D.FISH.trout, false).label, 'Hot tub warning');
  assert.equal(FM.feelsLike(23, D.FISH.carp, false).label, 'Perfect');
  assert.equal(FM.feelsLike(13, D.FISH.clownfish, true).comfort, 0);
});

test('oxygen model: lowest just before dawn, worst on hot, cloudy, windless days', function () {
  var lat = 45, lng = 0, start = Date.UTC(2026, 6, 1);
  function run(opt) {
    var hours = [];
    for (var i = 0; i < 24 * 5; i++) {
      var t = start + i * HOUR, alt = FM.sunAltitudeDeg(t - 1800000, lat, lng);
      hours.push({ t: t, wind: opt.wind, pressure: 1013, cloud: opt.cloud,
        radiation: FM.estimateRadiation(alt, opt.cloud) });
    }
    var temps = hours.map(function () { return opt.temp; });
    return { hours: hours, ox: FM.simulateOxygen(hours, temps, { isSea: false }) };
  }
  var nice = run({ temp: 18, cloud: 0, wind: 3 });
  // Day 4: find the minimum and compare with sunrise.
  var d4 = nice.ox.slice(72, 96), minI = 0;
  d4.forEach(function (o, i) { if (o.mgL < d4[minI].mgL) minI = i; });
  var sunrise = SunCalc.getTimes(new Date(start + 3 * DAY + 12 * HOUR), lat, lng).sunrise.getTime();
  near(start + (72 + minI) * HOUR, sunrise, 2 * HOUR, 'minimum oxygen near sunrise');
  var maxI = 0;
  d4.forEach(function (o, i) { if (o.mgL > d4[maxI].mgL) maxI = i; });
  assert.ok(d4[maxI].mgL - d4[minI].mgL > 0.3, 'visible day/night swing');

  var awful = run({ temp: 29, cloud: 100, wind: 0.3 });
  var last = function (r) { return r.ox[r.ox.length - 1]; };
  assert.ok(last(awful).pct < last(nice).pct - 10, 'hot cloudy calm is much worse');
  var windy = run({ temp: 29, cloud: 100, wind: 9 });
  assert.ok(last(windy).pct > last(awful).pct + 5, 'wind mixes oxygen back in');
});

test('breathability compares with each fish\'s minimum', function () {
  assert.equal(FM.breathability(9, D.FISH.trout).label, 'Breathe easy');
  assert.equal(FM.breathability(5, D.FISH.trout).label, 'Gasping');
  assert.equal(FM.breathability(5, D.FISH.carp).label, 'Breathe easy');
  assert.equal(FM.breathability(3, D.FISH.trout).label, 'Suffocating');
});

test('waves: Washing Machine Index and the calm depth below the waves', function () {
  var calm = FM.washingMachine(0.2, 6), storm = FM.washingMachine(5, 14);
  assert.equal(calm.label, 'Off (glassy)');
  assert.equal(storm.label, 'Industrial laundromat');
  assert.ok(storm.index > calm.index + 5);
  near(FM.washingMachine(2, 10).kwPerM, 19.6, 0.1); // 0.49 H² T
  near(FM.washingMachine(1, 10).calmDepthM, 78, 0.1); // half of gT²/2π
  assert.equal(FM.washingMachine(null, 10), null);
});

test('currents are measured in body lengths per second', function () {
  var c = FM.currentVerdict(0.35, 90, D.FISH.trout);
  near(c.bodyLengthsPerSec, 1, 1e-9);
  assert.equal(c.toward, 'E');
  assert.equal(FM.currentVerdict(1.2, 0, D.FISH.clownfish).verdict, 'Go with the flow');
});

test('tides: next highs and lows from sea level, interpolated between hours', function () {
  var t0 = Date.UTC(2026, 0, 1), times = [], levels = [];
  for (var i = 0; i < 48; i++) {
    times.push(t0 + i * HOUR);
    levels.push(Math.cos(2 * Math.PI * (i - 2.5) / 12.42));
  }
  var tides = FM.findTides(times, levels, t0, 4);
  assert.deepEqual(tides.map(function (x) { return x.type; }), ['high', 'low', 'high', 'low']);
  near(tides[0].t, t0 + 2.5 * HOUR, 6 * 60000);
  near(tides[1].t, t0 + (2.5 + 6.21) * HOUR, 6 * 60000);
  near(tides[0].level, 1, 0.01);
});

test('swim bladder: falling pressure expands it (Boyle) like swimming upwards', function () {
  var hours = [1012, 1010, 1008, 1005].map(function (p, i) { return { t: i * HOUR, pressure: p }; });
  var tend = FM.pressureTendency(hours, 3);
  assert.equal(tend.label, 'Falling very rapidly');
  assert.equal(tend.falling, true);
  near(tend.equivalentDepthCm, 7 * 1.0194, 0.01);
  assert.ok(tend.bladderPct > 0);
});

test('iNaturalist taxa: only exact scientific-name matches are kept', function () {
  assert.equal(FM.exactTaxonMatch(S.taxaSearch('Ardeidae').results, 'Ardeidae'), S.taxonId('Ardeidae'));
  assert.equal(FM.exactTaxonMatch([{ id: 1, name: 'Ardeola' }], 'Ardeidae'), null);
  assert.equal(FM.exactTaxonMatch([{ id: 2, name: 'Esox', iconic_taxon_name: 'Plantae' }], 'Esox'), null);
});

test('predator blips get real distance, bearing, and a weighted threat', function () {
  var taxa = { Ardeidae: 10, Selachimorpha: 20 };
  var idx = FM.predatorTaxonIndex(D.PREDATORS, taxa);
  var now = Date.UTC(2026, 9, 28, 12);
  var obs = [
    { id: 1, taxon: { id: 99, ancestor_ids: [1, 10, 99] }, geojson: { coordinates: [0, 0.09] }, time_observed_at: new Date(now - DAY).toISOString() },
    { id: 2, taxon: { id: 98, ancestry: '1/20/98' }, geojson: { coordinates: [0.18, 0] }, time_observed_at: new Date(now - 10 * DAY).toISOString() },
    { id: 3, taxon: { id: 5, ancestor_ids: [1, 5] }, geojson: { coordinates: [0, 0.01] }, observed_on: '2026-10-27' }
  ];
  var blips = FM.predatorBlips(obs, { lat: 0, lng: 0, now: now, radiusKm: 25, idToKey: idx.idToKey, predators: D.PREDATORS, offsetSec: 0 });
  assert.equal(blips.length, 2, 'unrelated taxon ignored');
  var heron = blips.filter(function (b) { return b.key === 'heron'; })[0];
  var shark = blips.filter(function (b) { return b.key === 'shark'; })[0];
  near(heron.distanceKm, 10, 0.1);
  assert.equal(heron.compass, 'N');
  assert.equal(shark.compass, 'E');
  near(heron.ageDays, 1, 1e-9);

  assert.ok(FM.threatWeight(1, 1, 0, 25) > FM.threatWeight(1, 10, 0, 25), 'closer is worse');
  assert.ok(FM.threatWeight(1, 5, 0, 25) > FM.threatWeight(1, 5, 7, 25), 'recent is worse');
  near(FM.threatWeight(1, 0, 7, 25), 0.5, 1e-9, 'one-week half-life');
  assert.ok(FM.threatWeight(1, 5, 0, 25) > FM.threatWeight(0.35, 5, 0, 25), 'sharks beat gulls');

  // Diminishing returns: 30 gull photos are not 30x the danger.
  var gulls = [];
  for (var i = 0; i < 30; i++) gulls.push({ key: 'gull', weight: 0.3 });
  var many = FM.predatorThreat(gulls), one = FM.predatorThreat(gulls.slice(0, 1));
  assert.ok(many.score < 3 * one.score);
  assert.ok(FM.predatorThreat([]).score === 0);
});

test('herons and gulls rest at night; crocodiles do not', function () {
  assert.ok(FM.activityFactor('day', -20) < FM.activityFactor('day', 30));
  assert.ok(FM.activityFactor('night', -20) > FM.activityFactor('night', 30));
  assert.ok(FM.activityFactor('twilight', 2) > FM.activityFactor('twilight', 40));
});

test('Hook Danger: weekend dawn, calm, dry, pleasant and falling pressure bring the anglers', function () {
  var lat = 52, lng = 0, day = Date.UTC(2026, 9, 31); // Saturday
  var sun = FM.sunTimes(day, lat, lng);
  var base = { offsetSec: 0, sun: sun, wind: 2, precip: 0, airTemp: 15, pressureDelta3h: 0, speciesKey: 'trout' };
  var dawnSat = FM.hookDanger(Object.assign({}, base, { t: sun.sunrise, sunAlt: 0 }));
  var noonTue = FM.hookDanger(Object.assign({}, base, { t: sun.noon - 4 * DAY, sun: FM.sunTimes(day - 4 * DAY, lat, lng), sunAlt: 25 }));
  var stormy = FM.hookDanger(Object.assign({}, base, { t: sun.sunrise, sunAlt: 0, wind: 12, precip: 4 }));
  var falling = FM.hookDanger(Object.assign({}, base, { t: sun.noon, sunAlt: 25, wind: 5, pressureDelta3h: -2 }));
  var steady = FM.hookDanger(Object.assign({}, base, { t: sun.noon, sunAlt: 25, wind: 5 }));
  assert.ok(dawnSat.score >= 90, 'Saturday dawn: ' + dawnSat.score);
  assert.ok(noonTue.score < dawnSat.score / 2);
  assert.ok(stormy.score < 25);
  assert.ok(falling.score > steady.score);
  assert.ok(dawnSat.reasons.indexOf('Saturday') >= 0);
  // Carp anglers camp overnight.
  var night = Object.assign({}, base, { t: sun.sunset + 5 * HOUR, sunAlt: -40 });
  assert.ok(FM.hookDanger(Object.assign({}, night, { speciesKey: 'carp' })).score > FM.hookDanger(night).score);
});

test('Snack Index: rain, dusk hatches, new/full moon and solunar periods', function () {
  var day = Date.UTC(2026, 5, 15), sun = FM.sunTimes(day, 52, 0);
  var base = { t: sun.noon, sun: sun, rain6h: 0, waterTemp: 16, moonPhase: 0.25, solunar: null };
  var plain = FM.snackIndex(base).score;
  assert.ok(FM.snackIndex(Object.assign({}, base, { rain6h: 4 })).score > plain);
  assert.ok(FM.snackIndex(Object.assign({}, base, { t: sun.sunset })).score > plain);
  assert.ok(FM.snackIndex(Object.assign({}, base, { moonPhase: 0.5 })).score > plain);
  assert.ok(FM.snackIndex(Object.assign({}, base, { solunar: 'major' })).score > FM.snackIndex(Object.assign({}, base, { solunar: 'minor' })).score);
  // Cold water: no hatch.
  assert.equal(FM.snackIndex(Object.assign({}, base, { t: sun.sunset, waterTemp: 6 })).score, plain);
});

test('solunar: moonrise and moonset agree with SunCalc', function () {
  var lat = 36.66, lng = -121.88;
  for (var d = 0; d < 6; d++) {
    var day = Date.UTC(2026, 9, 26 + d);
    var ev = FM.lunarEvents(day, day + DAY, lat, lng);
    var mt = SunCalc.getMoonTimes(new Date(day), lat, lng, true);
    ['rise', 'set'].forEach(function (k) {
      var mine = ev.filter(function (e) { return e.type === 'moon' + k; })[0];
      if (mt[k]) {
        assert.ok(mine, 'found moon' + k + ' on day ' + d);
        near(mine.t, mt[k].getTime(), 3 * 60000, 'moon' + k);
      } else assert.equal(mine, undefined);
    });
  }
});

test('solunar: transits are the highest and lowest moon, one lunar day apart', function () {
  var lat = 52.48, lng = -1.9, from = Date.UTC(2026, 9, 1), ev = FM.lunarEvents(from, from + 10 * DAY, lat, lng);
  var over = ev.filter(function (e) { return e.type === 'overhead'; }).map(function (e) { return e.t; });
  var under = ev.filter(function (e) { return e.type === 'underfoot'; }).map(function (e) { return e.t; });
  assert.ok(over.length >= 9 && under.length >= 9);
  for (var i = 1; i < over.length; i++) near(over[i] - over[i - 1], 24.84 * HOUR, 25 * 60000, 'lunar day');
  // Upper transit is a true maximum of altitude.
  over.forEach(function (t) {
    var a = FM.moonAltitudeDeg(t, lat, lng);
    assert.ok(a >= FM.moonAltitudeDeg(t - 20 * 60000, lat, lng) && a >= FM.moonAltitudeDeg(t + 20 * 60000, lat, lng));
  });
  // Underfoot falls roughly half a lunar day after overhead.
  near(under.filter(function (t) { return t > over[0]; })[0] - over[0], 12.42 * HOUR, 60 * 60000);
});

test('solunar day: majors are 2 hours, minors 1 hour, rated 1-4', function () {
  var day = FM.solunarDay(Date.UTC(2026, 9, 28) + 7 * HOUR, 36.66, -121.88);
  day.periods.forEach(function (p) {
    assert.equal(p.end - p.start, p.kind === 'major' ? 2 * HOUR : HOUR);
    assert.equal(p.kind === 'major', p.type === 'overhead' || p.type === 'underfoot');
  });
  assert.ok(day.rating >= 1 && day.rating <= 4);
  assert.equal(FM.solunarAt(day.periods[0].peak, [day]), day.periods[0].kind);
  // 26 Oct 2026 is a full moon.
  assert.equal(FM.moonPhase(Date.UTC(2026, 9, 26, 6), 40).name, 'Full Moon');
});

test('southern hemisphere sees the moon mirrored', function () {
  var t = Date.UTC(2026, 9, 21); // waxing gibbous
  var n = FM.moonPhase(t, 50), s = FM.moonPhase(t, -33);
  assert.equal(n.name, s.name);
  assert.notEqual(n.emoji, s.emoji);
});

test('report: switching the fish changes the forecast', function () {
  var now = Date.UTC(2026, 9, 28, 22);
  var trout = report(S.MONTEREY, now, 'trout'), clown = report(S.MONTEREY, now, 'clownfish');
  assert.equal(trout.isSea, true);
  assert.equal(trout.waterSource, 'sst');
  assert.equal(trout.current.feels.label, 'Perfect');
  assert.equal(clown.current.feels.label, 'Brisk');
  assert.notEqual(trout.grade.letter, clown.grade.letter);
  assert.ok(trout.current.tides.length > 0);
  assert.ok(trout.current.waves && trout.current.current);
  assert.ok(trout.predators.blips.length > 20);
  assert.equal(trout.timeline.length, 73);
  assert.equal(trout.bestTimes.length >= 3, true);
});

test('report: lakes use the air-temperature moving average and no sea state', function () {
  var now = Date.UTC(2026, 9, 28, 20);
  var r = report(S.LAKE, now, 'trout');
  assert.equal(r.isSea, false);
  assert.equal(r.seaDetection.reason, 'null-sst');
  assert.equal(r.waterSource, 'ema');
  assert.equal(r.current.tides, undefined);
  var c = report(S.LAKE, now, 'clownfish');
  assert.equal(c.broadcast.kind, 'salinity');
  assert.equal(report(S.LAKE, now, 'trout', { waterMode: 'sea' }).isSea, true);
});

test('report: survives a total API outage (moon still works)', function () {
  var r = FM.buildReport({ forecast: null, marine: null, observations: null, taxa: {}, species: D.FISH.trout,
    predators: D.PREDATORS, now: Date.UTC(2026, 9, 28, 12), lat: 51, lng: -1, place: 'Nowhere' });
  assert.equal(r.hasWeather, false);
  assert.equal(r.offsetSec, 0);
  assert.ok(r.solunar.today.periods.length >= 3);
  assert.match(r.broadcast.text, /Blub\.$/);
});

test('broadcast priority: salinity, oxygen, predators, fishermen, temperature, else all clear', function () {
  var sp = D.FISH.trout, now = Date.UTC(2026, 9, 28, 12);
  function rep(o) {
    return Object.assign({
      species: sp, now: now, offsetSec: 0, place: 'Test Pond', hasWeather: true, salinity: { ok: true },
      current: { feels: { key: 'perfect', comfort: 1, label: 'Perfect' }, breath: { level: 0, mgL: 10 }, waterTemp: 12 },
      timeline: [{ t: now, hook: { score: 10, reasons: [], label: '' } }], grade: { letter: 'A' }
    }, o);
  }
  var hot = { feels: { key: 'hot', comfort: 0.2, label: 'Hot tub warning', detail: '' }, breath: { level: 0, mgL: 10 }, waterTemp: 24 };
  var gasp = Object.assign({}, hot, { breath: { level: 3, mgL: 4.5, label: 'Gasping' } });
  var hooks = [{ t: now, hook: { score: 90, reasons: ['Saturday'], label: "Hook o'clock" } }];
  var preds = { blips: [{ key: 'heron', name: 'Heron', distanceKm: 1, compass: 'N' }], threat: { score: 80, topKeys: ['heron'] } };

  assert.equal(FM.composeBroadcast(rep({})).kind, 'clear');
  assert.equal(FM.composeBroadcast(rep({})).headline, 'Conditions are great, go be a fish.');
  assert.equal(FM.composeBroadcast(rep({ current: hot })).kind, 'temperature');
  assert.equal(FM.composeBroadcast(rep({ current: hot, timeline: hooks })).kind, 'fishermen');
  assert.equal(FM.composeBroadcast(rep({ current: hot, timeline: hooks, predators: preds })).kind, 'predators');
  assert.equal(FM.composeBroadcast(rep({ current: gasp, timeline: hooks, predators: preds })).kind, 'oxygen');
  var all = FM.composeBroadcast(rep({ current: gasp, timeline: hooks, predators: preds, salinity: { ok: false, note: 'Salt!' } }));
  assert.equal(all.kind, 'salinity');
  assert.deepEqual(all.alerts.map(function (a) { return a.kind; }), ['salinity', 'oxygen', 'predators', 'fishermen', 'temperature']);
  [rep({}), rep({ current: gasp })].forEach(function (r) {
    assert.match(FM.composeBroadcast(r).text, /Blub\.$/);
  });
});

test('every fish and predator has what the UI needs', function () {
  Object.keys(D.FISH).forEach(function (k) {
    var f = D.FISH[k];
    ['name', 'tempMin', 'tempMax', 'tempLethal', 'tempColdLethal', 'doMin', 'water', 'bodyLengthM', 'ucritBL', 'colors'].forEach(function (p) {
      assert.ok(f[p] !== undefined, k + '.' + p);
    });
    assert.ok(f.tempColdLethal < f.tempMin && f.tempMin < f.tempMax && f.tempMax < f.tempLethal, k + ' ranges');
  });
  var keys = {};
  D.PREDATORS.forEach(function (p) {
    assert.ok(!keys[p.key], 'unique ' + p.key); keys[p.key] = 1;
    assert.ok(p.taxa.length && p.blurb && p.emoji && p.danger > 0 && p.danger <= 1, p.key);
  });
  assert.equal(D.PREDATORS.length, 15);
  assert.equal(D.PREDATORS.filter(function (p) { return p.key === 'heron'; })[0].blurb.indexOf('Do not trust the statue') > 0, true);
});
