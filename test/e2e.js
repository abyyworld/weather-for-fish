/*
 * End-to-end test in a real browser (Playwright + Chromium), opened from
 * file:// exactly like double-clicking index.html. Every external API is
 * mocked with Open-Meteo / iNaturalist-shaped responses from fixtures/synth.js.
 *
 *   node test/e2e.js            (needs the `playwright` package)
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert/strict');
var S = require('./fixtures/synth.js');
var FM = require('../js/fishmath.js');

var chromium;
try { chromium = require('playwright').chromium; } catch (e) {
  console.log('Playwright is not installed: npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

var ROOT = path.join(__dirname, '..');
var URL = 'file://' + path.join(ROOT, 'index.html');
var OUT = path.join(__dirname, 'e2e-artifacts');
fs.mkdirSync(OUT, { recursive: true });
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqLpVDwAEbwGUrRwYFwAAAABJRU5ErkJggg==', 'base64');
var NOW = Date.UTC(2026, 9, 28, 22, 0);

function json(route, body, status) {
  return route.fulfill({ status: status || 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
}

// Which fixture world does a coordinate belong to?
function world(lat) { return Math.abs(lat - S.MONTEREY.lat) < 1 ? S.MONTEREY : S.LAKE; }

async function mockApis(page, opts) {
  opts = opts || {};
  var calls = { forecast: 0, marine: 0, taxa: 0, observations: 0 };
  await page.route(/^https?:\/\//, function (route) {
    var u = new globalThis.URL(route.request().url()), host = u.hostname, q = u.searchParams;
    if (opts.offline) return route.abort('internetdisconnected');
    if (/tile\.openstreetmap\.org|arcgisonline\.com/.test(host)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (host === 'api.open-meteo.com') {
      calls.forecast++;
      if (opts.failForecast) return json(route, { error: true, reason: 'down' }, 500);
      var w = world(+q.get('latitude'));
      assert.equal(q.get('timezone'), 'auto');
      assert.equal(q.get('past_days'), '7');
      return json(route, S.forecast(Object.assign({}, w, { now: NOW })));
    }
    if (host === 'marine-api.open-meteo.com') {
      calls.marine++;
      if (opts.failMarine) return route.abort('connectionrefused');
      return json(route, S.marine(Object.assign({}, world(+q.get('latitude')), { now: NOW })));
    }
    if (host === 'geocoding-api.open-meteo.com') {
      return json(route, { results: [{ name: 'Test Reservoir', latitude: S.LAKE.lat, longitude: S.LAKE.lng, country: 'United Kingdom', admin1: 'England' }] });
    }
    if (host === 'nominatim.openstreetmap.org') {
      if (u.pathname.indexOf('reverse') >= 0) return json(route, { name: 'Monterey Bay', address: {} });
      return json(route, []);
    }
    if (host === 'api.inaturalist.org') {
      if (opts.failRadar) return route.abort('connectionrefused');
      if (u.pathname === '/v1/taxa') { calls.taxa++; return json(route, S.taxaSearch(q.get('q'))); }
      if (u.pathname === '/v1/observations') {
        calls.observations++;
        assert.ok(q.get('taxon_id').split(',').length >= 15, 'all predator taxa in one query');
        assert.ok(q.get('d1') && q.get('radius') && q.get('lat') && q.get('lng'));
        return json(route, S.observations(Object.assign({}, world(+q.get('lat')), { now: NOW })));
      }
    }
    return route.abort('blockedbyclient');
  });
  return calls;
}

async function newPage(browser, opts) {
  opts = opts || {};
  var ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  var page = await ctx.newPage();
  var errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // Freeze the clock at the fixture time and record speech instead of playing it.
  await page.addInitScript(function (now) {
    var RealDate = Date;
    var offset = now - RealDate.now();
    function FakeDate(a, b, c, d, e, f, g) {
      if (!(this instanceof FakeDate)) return new RealDate(RealDate.now() + offset).toString();
      return arguments.length ? new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))() : new RealDate(RealDate.now() + offset);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = function () { return RealDate.now() + offset; };
    FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
    window.__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speaking: false, getVoices: function () { return [{ name: 'Samantha', lang: 'en-US' }]; }, cancel: function () {},
      speak: function (u) { window.__spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate }); setTimeout(function () { if (u.onend) u.onend(); }, 50); }
    } });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  }, NOW);
  return { ctx: ctx, page: page, errors: errors, calls: await mockApis(page, opts) };
}

async function step(name, fn) {
  process.stdout.write('• ' + name + ' … ');
  await fn();
  process.stdout.write('ok\n');
}

(async function main() {
  var browser = await chromium.launch();
  try {
    var t = await newPage(browser);
    var page = t.page;

    await step('opens from file:// with no errors, footer present', async function () {
      await page.goto(URL);
      assert.equal(await page.title(), 'Weather for Fish');
      assert.match(await page.textContent('.footer'), /Not intended for use by fish\./);
      assert.match(await page.textContent('.tagline'), /Smartphone adoption among target audience: 0%/);
      assert.equal(await page.locator('.fish-option').count(), 5);
    });

    await step('1. map: clicking the map picks the spot and loads the forecast', async function () {
      await page.locator('#spots .chip', { hasText: 'Monterey Bay' }).click();
      await page.waitForFunction(function () { return document.getElementById('gradeLetter').getAttribute('data-grade'); });
      // Now click the map itself somewhere else in the bay.
      var box = await page.locator('#map').boundingBox();
      await page.mouse.click(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20);
      await page.waitForFunction(function () { return window.WFF.state.forecast && !window.WFF.state.loading.forecast; });
      var st = await page.evaluate(function () { return { lat: window.WFF.state.lat, place: window.WFF.state.place }; });
      assert.ok(Math.abs(st.lat - 36.66) < 0.3, 'clicked near Monterey: ' + st.lat);
      await page.waitForFunction(function () { return /Monterey Bay/.test(document.getElementById('spotName').textContent); });
    });

    await step('2+3. water report for a trout at sea: SST, feels-like, oxygen, waves, currents, tides, bladder', async function () {
      await page.waitForFunction(function () { return /Perfect/.test(document.getElementById('mTemp').textContent); });
      var temp = await page.textContent('#mTemp');
      assert.match(temp, /Feels like for a trout: Perfect/);
      assert.match(temp, /sea-surface temperature/i);
      var ox = await page.textContent('#mOxygen');
      assert.match(ox, /mg\/L/);
      assert.match(ox, /needs 6 mg\/L/);
      assert.match(await page.textContent('#mWaves'), /\/ 10/);
      assert.match(await page.textContent('#mCurrent'), /trout-lengths per second/);
      assert.match(await page.textContent('#mTide'), /High|Low/);
      assert.match(await page.textContent('#mTide'), /tide pool/);
      assert.match(await page.textContent('#mBladder'), /hPa/);
      assert.match(await page.textContent('#spotName'), /Salt water/);
    });

    await step('4. predator radar: taxa looked up by name, one observations query, blips clickable', async function () {
      await page.waitForFunction(function () { return window.WFF.state.observations; });
      assert.ok(t.calls.taxa >= 15, 'taxa lookups: ' + t.calls.taxa);
      assert.ok(t.calls.observations >= 1);
      var cached = await page.evaluate(function () { return JSON.parse(localStorage.getItem('wff.taxa.v1')); });
      assert.equal(cached.Ardeidae, S.taxonId('Ardeidae'), 'exact match cached, decoy ignored');
      await page.waitForFunction(function () { return /\d/.test(document.getElementById('threat').textContent); });
      var threat = await page.textContent('#threat');
      assert.match(threat, /\d+\/100/);
      // Click the strongest blip on the canvas at its projected position.
      var pos = await page.evaluate(function () {
        var b = window.WFF.state.report.predators.blips[0], c = document.getElementById('radar').getBoundingClientRect();
        var R = c.width / 2 - 26, r = Math.min(1, b.distanceKm / 25) * R, a = b.bearing * Math.PI / 180;
        return { x: c.left + c.width / 2 + r * Math.sin(a), y: c.top + c.height / 2 - r * Math.cos(a), name: b.commonName };
      });
      await page.locator('#radar').scrollIntoViewIfNeeded();
      pos = await page.evaluate(function () {
        var b = window.WFF.state.report.predators.blips[0], c = document.getElementById('radar').getBoundingClientRect();
        var R = c.width / 2 - 26, r = Math.min(1, b.distanceKm / 25) * R, a = b.bearing * Math.PI / 180;
        return { x: c.left + c.width / 2 + r * Math.sin(a), y: c.top + c.height / 2 - r * Math.cos(a), name: b.commonName };
      });
      await page.mouse.click(pos.x, pos.y);
      await page.waitForSelector('#blipDetail:not([hidden])');
      var detail = await page.textContent('#blipDetail');
      assert.match(detail, / km (N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW) · seen /);
      assert.match(detail, /View on iNaturalist/);
      assert.ok(detail.indexOf(pos.name) >= 0, 'clicked the right blip');
      assert.ok(+(await page.textContent('#sightCount')) > 20);
    });

    await step('5+6. Hook Danger and Snack Index', async function () {
      assert.match(await page.textContent('#hookCard'), /\/ 100/);
      assert.match(await page.textContent('#hookCard'), /Peak in the next 24 h/);
      assert.match(await page.textContent('#snackCard'), /\/ 100/);
      assert.equal(await page.locator('#hookCard .spark i').count(), 24);
    });

    await step('7. solunar tables: periods, moon phase, four days', async function () {
      var txt = await page.textContent('#solunarCard');
      assert.match(txt, /John Alden Knight, 1926/);
      assert.match(txt, /Moon|Gibbous|Crescent|Quarter/);
      assert.equal(await page.locator('#solunarCard tbody tr').count(), 4);
      assert.ok(await page.locator('#solunarCard .day-bar .p.major').count() >= 1);
    });

    await step('8. 72-hour timeline, best times, swim grade', async function () {
      assert.equal(await page.locator('#timeline .lane').first().locator('i').count(), 73);
      assert.match(await page.textContent('#gradeLetter'), /^[ABCDF]$/);
      assert.ok(await page.locator('#bestTimes .best').count() >= 3);
      var hit = await page.locator('.tl-hit').boundingBox();
      await page.mouse.move(hit.x + hit.width * 0.5, hit.y + 5);
      assert.match(await page.textContent('#tlDetail'), /Swim [ABCDF]/);
    });

    await step('9. news anchor reads the top alert aloud, ending in "Blub."', async function () {
      await page.click('#speakBtn');
      var spoken = await page.evaluate(function () { return window.__spoken; });
      assert.equal(spoken.length, 1);
      assert.match(spoken[0].text, /Blub\.$/);
      assert.ok(spoken[0].pitch >= 1.5, 'high, bubbly voice');
      assert.match(spoken[0].text, /^Good (morning|afternoon|evening|night), trout of Monterey Bay\./);
    });

    await step('esoteric almanac: Shipping Forecast (with the pips), ichthyomancy, folklore', async function () {
      var sf = await page.textContent('#shippingCard');
      assert.match(sf, /Maritime and Codguard Agency/);
      assert.match(sf, /MONTEREY BAY|Monterey Bay/);
      assert.match(sf, /Wind(North|Northeast|East|Southeast|South|Southwest|West|Northwest) \d/);
      assert.match(sf, /Sea state(Calm|Smooth|Slight|Moderate|Rough|Very rough|High)/);
      assert.match(await page.textContent('#oracleCard'), /The Moon is in (Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)/);
      assert.equal(await page.locator('#folkloreCard .rhyme li.on').count(), 1);
      assert.match(await page.textContent('#folkloreCard'), /plankton/);
      await page.click('#shippingBtn');
      await page.waitForFunction(function () { return window.__spoken.length >= 2; }, null, { timeout: 12000 });
      var last = await page.evaluate(function () { return window.__spoken[window.__spoken.length - 1]; });
      assert.match(last.text, /^And now the Shipping Forecast, issued by the Fish Office/);
      assert.match(last.text, /Blub\.$/);
    });

    await step('2. switching Trout to Clownfish changes the forecast', async function () {
      var before = { grade: await page.textContent('#gradeLetter'), temp: await page.textContent('#mTemp'), head: await page.textContent('#headline') };
      await page.locator('.fish-option[data-key="clownfish"]').click();
      await page.waitForFunction(function () { return /clownfish/.test(document.getElementById('mTemp').textContent); });
      var after = { grade: await page.textContent('#gradeLetter'), temp: await page.textContent('#mTemp'), speech: await page.textContent('#speech') };
      assert.match(after.temp, /Brisk/);
      assert.notEqual(after.grade, before.grade);
      assert.match(after.speech, /Cold warning|Predator/);
      assert.equal(await page.evaluate(function () { return localStorage.getItem('wff.species'); }), '"clownfish"');
    });

    await step('lakes: air-temperature estimate, no sea cards, wrong-water alert for a clownfish', async function () {
      await page.fill('#searchInput', 'reservoir');
      await page.click('#searchForm button[type=submit]');
      await page.locator('#searchResults button').first().click();
      await page.waitForFunction(function () { return /moving average/.test(document.getElementById('mTemp').textContent); });
      assert.match(await page.textContent('#spotName'), /Fresh water/);
      assert.match(await page.textContent('#mTide'), /no tides/i);
      assert.match(await page.textContent('#headline'), /saltwater fish in fresh water/);
      await page.locator('.fish-option[data-key="trout"]').click();
    });

    await step('save current data as demo (download + localStorage)', async function () {
      var dl = page.waitForEvent('download');
      await page.click('#saveDemoBtn');
      var d = await dl;
      assert.equal(d.suggestedFilename(), 'demo-data.js');
      var body = fs.readFileSync(await d.path(), 'utf8');
      assert.match(body, /^\/\* Weather for Fish demo snapshot/);
      var w = {}; new Function('window', body)(w);
      assert.equal(w.DEMO.place, 'Test Reservoir');
      assert.ok(w.DEMO.forecast.hourly.time.length > 200);
      assert.equal(w.DEMO.synthetic, false);
      assert.ok(await page.evaluate(function () { return !!localStorage.getItem('wff.demo'); }));
    });

    await step('demo mode loads the snapshot', async function () {
      await page.evaluate(function () { localStorage.removeItem('wff.demo'); });
      await page.click('#demoBtn');
      await page.waitForSelector('#demoBanner:not([hidden])');
      assert.match(await page.textContent('#demoBanner'), /Monterey Bay/);
      assert.match(await page.textContent('#gradeLetter'), /^[ABCDF]$/);
      await page.evaluate(function () { document.querySelectorAll('.reveal').forEach(function (e) { e.classList.add('in'); }); });
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, 'desktop.png'), fullPage: true });
    });
    assert.deepEqual(t.errors, [], 'no page errors');
    await t.ctx.close();

    await step('phone width: no horizontal scroll', async function () {
      var p = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await p.page.goto(URL + '?demo');
      await p.page.waitForFunction(function () { return document.getElementById('gradeLetter').getAttribute('data-grade'); });
      await p.page.evaluate(function () { document.querySelectorAll('.reveal').forEach(function (e) { e.classList.add('in'); }); });
      await p.page.waitForTimeout(900);
      var sw = await p.page.evaluate(function () { return [document.documentElement.scrollWidth, window.innerWidth]; });
      assert.ok(sw[0] <= sw[1], 'scrollWidth ' + sw[0] + ' > ' + sw[1]);
      await p.page.screenshot({ path: path.join(OUT, 'phone.png'), fullPage: true });
      assert.deepEqual(p.errors, []);
      await p.ctx.close();
    });

    await step('offline: demo mode works with zero network from file://', async function () {
      var p = await newPage(browser, { offline: true });
      await p.page.goto(URL + '?demo');
      await p.page.waitForFunction(function () { return document.getElementById('gradeLetter').getAttribute('data-grade'); });
      assert.match(await p.page.textContent('#mTemp'), /°C/);
      assert.ok(+(await p.page.textContent('#sightCount')) > 10);
      // No tiles: the map falls back to bundled coastlines.
      await p.page.waitForSelector('#map.offline-map', { timeout: 15000 });
      assert.ok(await p.page.locator('#map path.leaflet-interactive, #map svg path').count() > 0);
      await p.page.locator('#map').screenshot({ path: path.join(OUT, 'offline-map.png') });
      assert.deepEqual(p.errors, []);
      await p.ctx.close();
    });

    await step('one API down, the rest still works', async function () {
      var p = await newPage(browser, { failRadar: true, failMarine: true });
      await p.page.goto(URL);
      await p.page.locator('#spots .chip', { hasText: 'Monterey Bay' }).click();
      await p.page.waitForFunction(function () { return /heron is standing on the antenna/.test(document.getElementById('radarCard').textContent); });
      await p.page.waitForFunction(function () { return document.getElementById('gradeLetter').getAttribute('data-grade'); });
      assert.match(await p.page.textContent('#spotName'), /ocean model offline/);
      assert.match(await p.page.textContent('#solunarCard'), /Major/);
      await p.ctx.close();

      var q = await newPage(browser, { failForecast: true });
      await q.page.goto(URL);
      await q.page.locator('#spots .chip', { hasText: 'Monterey Bay' }).click();
      await q.page.waitForFunction(function () { return /pelican swallowed the weather balloon/.test(document.getElementById('mTemp').textContent); });
      await q.page.waitForFunction(function () { return window.WFF.state.observations; });
      assert.ok(+(await q.page.textContent('#sightCount')) > 10, 'radar still works');
      assert.match(await q.page.textContent('#solunarCard'), /Major/);
      assert.match(await q.page.textContent('#headline'), /Predator warning/);
      await q.ctx.close();
    });

    console.log('\nAll browser checks passed. Screenshots in test/e2e-artifacts/. Blub.');
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error('\nFAILED:', e && e.stack || e); process.exit(1); });
