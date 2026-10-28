#!/usr/bin/env node
/*
 * Writes a SYNTHETIC placeholder js/demo-data.js (generated, not real data).
 * The app labels it "SYNTHETIC SAMPLE". Replace it with a real capture:
 * tools/capture-demo.js, or the "Save as demo" button in the app.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var S = require('../test/fixtures/synth.js');
var D = require('../js/data.js');

var capturedAt = Date.parse(process.argv[2] || '2026-10-28T22:00:00Z');
var sc = S.scenario(S.MONTEREY, capturedAt);
var taxa = {};
D.PREDATORS.forEach(function (p) { p.taxa.forEach(function (n) { taxa[n] = S.taxonId(n); }); });
var snap = {
  version: 1, synthetic: true, capturedAt: capturedAt, place: S.MONTEREY.place, lat: S.MONTEREY.lat, lng: S.MONTEREY.lng,
  species: 'trout', forecast: sc.forecast, marine: sc.marine, taxa: taxa, observations: sc.observations.results
};
var out = path.join(__dirname, '..', 'js', 'demo-data.js');
fs.writeFileSync(out, '/* SYNTHETIC placeholder demo snapshot (generated test data, NOT real).\n' +
  ' * Replace with a real capture: node tools/capture-demo.js, or the "Save as demo" button. */\n' +
  'window.DEMO = ' + JSON.stringify(snap) + ';\n');
console.log('Wrote ' + out);
