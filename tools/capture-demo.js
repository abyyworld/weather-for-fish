#!/usr/bin/env node
/*
 * Capture a REAL demo snapshot from the live APIs and write js/demo-data.js.
 * Uses the app's own request code (js/api.js), so it fetches exactly what the
 * browser fetches. Predator photos are inlined so the demo works offline.
 *
 *   node tools/capture-demo.js                      # Monterey Bay
 *   node tools/capture-demo.js 52.4635 -1.9545 "Edgbaston Reservoir" trout
 */
'use strict';
var fs = require('fs');
var path = require('path');

global.self = global;
global.SunCalc = require('../vendor/suncalc.js');
global.FishMath = require('../js/fishmath.js');
var D = require('../js/data.js');
require('../js/api.js');
var API = global.FishAPI, FM = global.FishMath;

var lat = parseFloat(process.argv[2] || '36.66');
var lng = parseFloat(process.argv[3] || '-121.88');
var place = process.argv[4] || 'Monterey Bay';
var species = process.argv[5] || 'trout';
var RADIUS_KM = 25, LOOKBACK_DAYS = 30;

function log(m) { process.stdout.write(m + '\n'); }

function inline(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    var type = r.headers.get('content-type') || 'image/jpeg';
    return r.arrayBuffer().then(function (b) { return 'data:' + type + ';base64,' + Buffer.from(b).toString('base64'); });
  });
}

(async function main() {
  log('Capturing ' + place + ' (' + lat + ', ' + lng + ')…');
  var snap = { version: 1, synthetic: false, capturedAt: Date.now(), place: place, lat: lat, lng: lng, species: species };
  var res = await Promise.allSettled([API.forecast(lat, lng), API.marine(lat, lng)]);
  snap.forecast = res[0].status === 'fulfilled' ? res[0].value : null;
  snap.marine = res[1].status === 'fulfilled' ? res[1].value : null;
  log('  forecast: ' + (snap.forecast ? 'ok' : 'FAILED ' + res[0].reason));
  log('  marine:   ' + (snap.marine ? 'ok' : 'FAILED ' + res[1].reason));
  if (!snap.forecast) process.exitCode = 1;

  var names = [];
  D.PREDATORS.forEach(function (p) { names = names.concat(p.taxa); });
  try {
    snap.taxa = await API.lookupTaxa(names);
    var ids = FM.predatorTaxonIndex(D.PREDATORS, snap.taxa).ids;
    log('  taxa:     ' + Object.keys(snap.taxa).length + '/' + names.length + ' names resolved');
    var d1 = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    var obs = await API.observations(lat, lng, ids, d1, RADIUS_KM);
    snap.observations = obs.map(API.slimObservation);
    log('  sightings: ' + snap.observations.length);
    var photos = 0;
    for (var i = 0; i < Math.min(40, snap.observations.length); i++) {
      var p = snap.observations[i].photos[0];
      if (!p || !p.url) continue;
      try { p.dataUrl = await inline(p.url); photos++; } catch (e) { /* keep the URL */ }
    }
    log('  photos inlined: ' + photos);
  } catch (e) {
    log('  radar: FAILED ' + e.message);
    snap.taxa = {}; snap.observations = null;
  }

  var out = path.join(__dirname, '..', 'js', 'demo-data.js');
  fs.writeFileSync(out, '/* Weather for Fish demo snapshot: ' + place + ', captured ' + new Date(snap.capturedAt).toISOString() +
    ' by tools/capture-demo.js */\nwindow.DEMO = ' + JSON.stringify(snap) + ';\n');
  log('Wrote ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB). Blub.');
})();
