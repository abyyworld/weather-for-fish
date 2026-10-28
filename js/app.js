/*
 * Weather for Fish: the app. Wires the map, the APIs and the forecast maths
 * (js/fishmath.js) to the page. All the science lives in FishMath; this file
 * only fetches, renders and animates.
 */
(function () {
  'use strict';

  var FM = window.FishMath, D = window.FishData, API = window.FishAPI;
  var RADIUS_KM = 25, LOOKBACK_DAYS = 30;
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MSG = {
    forecast: 'Weather offline: a pelican swallowed the weather balloon.',
    marine: 'Ocean model offline: the tide gauge is being used as a crab apartment.',
    radar: 'Radar offline: a heron is standing on the antenna.',
    geocode: 'Search offline: the librarian is a carp. Click the map instead.',
    tiles: 'Map tiles offline: the cartographer is a sea cucumber. Click anyway, the maths still works.'
  };

  var state = {
    lat: null, lng: null, place: null,
    species: API.store('wff.species') || 'trout',
    waterMode: 'auto',
    forecast: null, marine: null, observations: null, taxa: null,
    loading: {}, errors: {},
    demo: null, report: null, req: 0
  };
  if (!D.FISH[state.species]) state.species = 'trout';

  var $ = function (id) { return document.getElementById(id); };
  var map, marker, rangeCircle, radar;

  // ---------------------------------------------------------------- helpers

  function now() { return state.demo ? state.demo.capturedAt : Date.now(); }
  function sp() { return D.FISH[state.species]; }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v, dp) { return FM.isNum(v) ? v.toFixed(dp === undefined ? 1 : dp) : '–'; }
  function clock(t, r) { return FM.formatClock(t, (r || state.report || {}).offsetSec || 0); }
  function dayName(t, r) { return FM.localParts(t, (r || state.report).offsetSec).weekdayName.slice(0, 3); }
  function coordLabel(lat, lng) {
    return Math.abs(lat).toFixed(3) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(lng).toFixed(3) + '°' + (lng >= 0 ? 'E' : 'W');
  }
  function ago(days) {
    if (days < 1 / 24) return 'just now';
    if (days < 1) return Math.round(days * 24) + ' h ago';
    if (days < 2) return 'yesterday';
    return Math.round(days) + ' days ago';
  }

  var toastTimer;
  function toast(msg, ms) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3500);
  }

  // Count numbers up to their new value.
  function countUp(el, to, dp, suffix) {
    if (!el) return;
    if (!FM.isNum(to)) { el.textContent = '–'; return; }
    var from = parseFloat(el.getAttribute('data-v'));
    el.setAttribute('data-v', to);
    if (REDUCED || !FM.isNum(from) || from === to) { el.textContent = to.toFixed(dp) + (suffix || ''); return; }
    var t0 = performance.now(), dur = 650;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(dp) + (suffix || '');
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function num(id, value, dp, suffix) {
    return '<span class="num" data-num="' + id + '" data-to="' + (FM.isNum(value) ? value : '') + '" data-dp="' + dp + '" data-suffix="' + esc(suffix || '') + '"></span>';
  }
  function runCounters(root) {
    root.querySelectorAll('.num').forEach(function (el) {
      var key = el.getAttribute('data-num'), prev = counterMemory[key];
      var to = parseFloat(el.getAttribute('data-to')), dp = +el.getAttribute('data-dp');
      if (FM.isNum(prev)) el.setAttribute('data-v', prev);
      countUp(el, FM.isNum(to) ? to : null, dp, el.getAttribute('data-suffix'));
      counterMemory[key] = to;
    });
  }
  var counterMemory = {};
  var placeTimelineHost = null;
  window.addEventListener('resize', function () { if (placeTimelineHost) placeTimelineHost(); });

  function setBody(el, html) {
    el.innerHTML = html;
    runCounters(el);
  }

  function retrigger(el, cls) {
    if (!el || REDUCED) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ------------------------------------------------------------- ambience

  function initBubbles() {
    var box = $('bubbles');
    var n = window.innerWidth < 600 ? 12 : 22;
    for (var i = 0; i < n; i++) {
      var b = document.createElement('span');
      var size = 6 + Math.random() * 22;
      b.className = 'bubble';
      b.style.width = b.style.height = size + 'px';
      b.style.left = (Math.random() * 100) + '%';
      b.style.animationDuration = (9 + Math.random() * 14) + 's';
      b.style.animationDelay = (-Math.random() * 20) + 's';
      box.appendChild(b);
    }
  }

  var SHARK = '<svg class="fish-svg" viewBox="0 0 260 120"><path d="M8 62 C40 40 100 30 170 40 L190 8 L200 44 C220 48 240 54 254 62 C236 70 214 76 196 78 L184 104 L170 80 C110 88 50 86 8 62 Z M20 62 L0 34 L6 62 L0 92 Z" fill="#0a1d2c"/></svg>';

  // A school of fish drifting past in the background, and now and then a shark.
  function initSwimmers() {
    if (REDUCED) return;
    var box = $('bubbles'), keys = Object.keys(D.FISH), live = 0;
    function spawn() {
      if (document.hidden || live >= 5) return;
      var el = document.createElement('div');
      var shark = Math.random() < 0.12;
      var ltr = Math.random() < 0.5, depth = Math.random();
      var size = shark ? 180 + depth * 120 : 36 + depth * 70;
      el.className = 'swimmer' + (ltr ? '' : ' rtl') + (shark ? ' shark' : '');
      el.innerHTML = shark ? SHARK : FishArt.svg(D.FISH[keys[Math.floor(Math.random() * keys.length)]]);
      el.style.width = size + 'px';
      el.style.top = (8 + Math.random() * 80) + 'vh';
      el.style.opacity = shark ? 0.35 : (0.14 + depth * 0.22).toFixed(2);
      el.style.filter = 'blur(' + ((1 - depth) * 2.2).toFixed(1) + 'px)';
      el.style.animationDuration = (shark ? 16 : 22 + (1 - depth) * 22) + 's';
      live++;
      el.addEventListener('animationend', function () { el.remove(); live--; });
      box.appendChild(el);
    }
    spawn();
    setInterval(spawn, 4500);
  }

  function initKelp() {
    var k = document.createElement('div');
    k.className = 'kelp';
    k.setAttribute('aria-hidden', 'true');
    var strands = '';
    for (var i = 0; i < 9; i++) {
      var x = 4 + i * 11.5 + Math.random() * 4, h = 90 + Math.random() * 110;
      strands += '<svg class="strand" style="left:' + x + '%;height:' + h + 'px;animation-delay:' + (-Math.random() * 6).toFixed(1) + 's" viewBox="0 0 40 200" preserveAspectRatio="none">' +
        '<path d="M20 200 C6 160 34 130 18 96 C4 64 32 40 20 0" fill="none" stroke="' + (i % 2 ? '#1f7a5a' : '#2c8f62') + '" stroke-width="7" stroke-linecap="round"/></svg>';
    }
    k.innerHTML = strands;
    document.body.appendChild(k);
  }

  // Bubbles wherever you tap.
  function initTapBubbles() {
    if (REDUCED) return;
    document.addEventListener('pointerdown', function (e) {
      for (var i = 0; i < 6; i++) {
        var b = document.createElement('span');
        b.className = 'tap-bubble';
        var s = 4 + Math.random() * 9;
        b.style.width = b.style.height = s + 'px';
        b.style.left = (e.clientX + (Math.random() - 0.5) * 24) + 'px';
        b.style.top = (e.clientY + (Math.random() - 0.5) * 10) + 'px';
        b.style.animationDuration = (0.7 + Math.random() * 0.7) + 's';
        b.addEventListener('animationend', function () { this.remove(); });
        document.body.appendChild(b);
      }
    }, { passive: true });
  }

  function initReveal() {
    var cards = document.querySelectorAll('.layout > .card, .report > .card');
    if (REDUCED || !window.IntersectionObserver) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.08 });
    cards.forEach(function (c, i) {
      c.classList.add('reveal');
      c.style.transitionDelay = Math.min(i % 4, 3) * 60 + 'ms';
      io.observe(c);
    });
  }

  // A small bubbly "blub" made with the Web Audio API.
  var audio;
  function blub() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime;
      [0, 0.11, 0.2].forEach(function (d, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(260 + i * 90, t + d);
        o.frequency.exponentialRampToValueAtTime(900 + i * 200, t + d + 0.09);
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
        o.connect(g); g.connect(audio.destination);
        o.start(t + d); o.stop(t + d + 0.12);
      });
    } catch (e) { /* no audio, no problem */ }
  }

  // ------------------------------------------------------------------- map

  function initMap() {
    map = L.map('map', { worldCopyJump: true, zoomControl: true }).setView([25, -30], 2);
    // Keyless tiles only. OpenStreetMap needs a Referer, which file:// pages
    // don't send, so a double-clicked index.html starts on Esri's street map.
    var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    var street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors'
    });
    var seafloor = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 13, attribution: 'Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org'
    });
    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics'
    });
    var human = location.protocol === 'file:' ? street : osm;
    human.addTo(map);
    var layers = { '🗺️ Human map': human, '🐋 Seafloor': seafloor, '🛰️ Satellite': satellite };
    layers[human === osm ? '🧭 Esri streets' : '🧭 OpenStreetMap'] = human === osm ? street : osm;
    L.control.layers(layers, null, { position: 'topright' }).addTo(map);

    var tileErrors = 0, warned = false;
    [osm, street, seafloor, satellite].forEach(function (layer) {
      layer.on('tileerror', function () {
        if (++tileErrors >= 6 && !warned) {
          warned = true;
          $('mapHint').textContent = MSG.tiles;
          $('mapHint').hidden = false;
          loadOfflineLand();
        }
      });
    });

    map.on('click', function (e) {
      ripple(e.latlng);
      chooseSpot(e.latlng.lat, wrapLng(e.latlng.lng), null);
    });
  }

  // No tiles (no Wi-Fi): draw Natural Earth land polygons, loaded on demand.
  var landLoaded = false;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  function loadOfflineLand() {
    if (landLoaded) return;
    landLoaded = true;
    loadScript('vendor/land/topojson-client.min.js').then(function () { return loadScript('vendor/land/land-50m.js'); }).then(function () {
      var land = topojson.feature(window.LAND_TOPO, window.LAND_TOPO.objects.land);
      L.geoJSON(land, { interactive: false, style: { color: '#b9a46c', weight: 1, fillColor: '#e3d3a4', fillOpacity: 1 } }).addTo(map);
      document.getElementById('map').classList.add('offline-map');
    }).catch(function () { landLoaded = false; });
  }

  function wrapLng(lng) { return ((lng + 540) % 360) - 180; }

  function ripple(latlng) {
    if (REDUCED) return;
    var r = L.marker(latlng, {
      icon: L.divIcon({ className: 'ripple-icon', html: '<span></span><span></span><span></span>', iconSize: [80, 80] }),
      interactive: false, keyboard: false
    }).addTo(map);
    setTimeout(function () { map.removeLayer(r); }, 1400);
  }

  function updateMarker() {
    if (!map || state.lat === null) return;
    var icon = L.divIcon({ className: 'fish-marker', html: '<div class="marker-fish">' + FishArt.svg(sp()) + '</div>', iconSize: [56, 40], iconAnchor: [28, 20] });
    if (!marker) {
      marker = L.marker([state.lat, state.lng], { icon: icon, keyboard: false }).addTo(map);
      rangeCircle = L.circle([state.lat, state.lng], { radius: RADIUS_KM * 1000, color: '#5eead4', weight: 1.5, dashArray: '6 6', fillOpacity: 0.04, interactive: false }).addTo(map);
    } else {
      marker.setLatLng([state.lat, state.lng]).setIcon(icon);
      rangeCircle.setLatLng([state.lat, state.lng]);
    }
    $('mapHint').hidden = true;
  }

  // ---------------------------------------------------------------- search

  function initSearch() {
    $('searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('searchInput').value.trim();
      if (!q) return;
      var list = $('searchResults');
      list.hidden = false;
      list.innerHTML = '<li class="muted small">Searching the seven seas…</li>';
      API.geocode(q).then(function (results) {
        if (!results.length) { list.innerHTML = '<li class="muted small">No water by that name. Try clicking the map.</li>'; return; }
        list.innerHTML = '';
        results.forEach(function (r) {
          var li = document.createElement('li'), b = document.createElement('button');
          b.type = 'button';
          b.innerHTML = esc(r.name) + ' <small>' + esc(r.label || '') + '</small>';
          b.addEventListener('click', function () {
            list.hidden = true;
            map.setView([r.lat, r.lng], 11);
            chooseSpot(r.lat, r.lng, r.name);
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }).catch(function () {
        list.innerHTML = '<li class="offline">' + esc(MSG.geocode) + '</li>';
      });
    });

    $('locateBtn').addEventListener('click', function () {
      if (!navigator.geolocation) { toast('No GPS. Fish navigate by magnetism; you will have to click.'); return; }
      toast('Finding you…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        map.setView([pos.coords.latitude, pos.coords.longitude], 13);
        toast('Found you. Now tap the nearest water: I cannot forecast a car park.', 5000);
      }, function () { toast('Location blocked. Fish respect your privacy.'); }, { timeout: 10000 });
    });

    var spots = $('spots');
    D.SPOTS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = s.emoji + ' ' + s.name;
      b.addEventListener('click', function () {
        map.setView([s.lat, s.lng], 10);
        ripple(L.latLng(s.lat, s.lng));
        chooseSpot(s.lat, s.lng, s.name);
      });
      spots.appendChild(b);
    });
  }

  // ------------------------------------------------------------ fish picker

  function initPicker() {
    var box = $('fishPicker');
    Object.keys(D.FISH).forEach(function (k) {
      var f = D.FISH[k], b = document.createElement('button');
      b.type = 'button'; b.className = 'fish-option'; b.setAttribute('role', 'radio'); b.dataset.key = k;
      var label = f.name + (k === 'salmon' || k === 'carp' ? ' <span class="emoji">' + f.emoji + '</span>' : '');
      b.innerHTML = FishArt.svg(f) + '<span>' + label + '</span>';
      b.addEventListener('click', function () { setSpecies(k); });
      box.appendChild(b);
    });
    box.addEventListener('keydown', function (e) {
      var keys = Object.keys(D.FISH), i = keys.indexOf(state.species);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setSpecies(keys[(i + 1) % keys.length]); focusSpecies(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setSpecies(keys[(i + keys.length - 1) % keys.length]); focusSpecies(); e.preventDefault(); }
    });
    renderPicker();
  }
  function focusSpecies() { var el = document.querySelector('.fish-option[aria-checked="true"]'); if (el) el.focus(); }

  function renderPicker() {
    document.querySelectorAll('.fish-option').forEach(function (b) {
      var on = b.dataset.key === state.species;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    var f = sp();
    $('fishBlurb').innerHTML = '<b>' + esc(f.name) + '</b> <i>(' + esc(f.latin) + ')</i>: ' + esc(f.blurb) +
      ' Likes ' + f.tempMin + '–' + f.tempMax + ' °C, needs ' + f.doMin + ' mg/L of oxygen.';
    $('logoFish').innerHTML = FishArt.svg(f);
    $('anchorFish').innerHTML = FishArt.svg(f);
  }

  function setSpecies(k) {
    if (k === state.species) return;
    state.species = k;
    API.store('wff.species', k);
    renderPicker();
    var opt = document.querySelector('.fish-option[data-key="' + k + '"]');
    retrigger(opt, 'flip');
    retrigger($('anchorFish'), 'swim-in');
    blub();
    updateMarker();
    render();
  }

  function initWaterMode() {
    $('waterMode').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.waterMode = b.dataset.mode;
      $('waterMode').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      render();
    });
  }

  // ---------------------------------------------------------------- loading

  function chooseSpot(lat, lng, name) {
    if (state.demo) exitDemo(true);
    state.lat = lat; state.lng = lng; state.place = name || null;
    state.forecast = state.marine = state.observations = null;
    state.errors = {};
    API.store('wff.spot', { lat: lat, lng: lng, place: state.place });
    updateMarker();
    fetchAll();
    if (!name) {
      var req = state.req;
      API.reverseName(lat, lng).then(function (n) {
        if (n && req === state.req && !state.place) { state.place = n; API.store('wff.spot', { lat: lat, lng: lng, place: n }); render(); }
      }).catch(function () {});
    }
  }

  function fetchAll() {
    var req = ++state.req, lat = state.lat, lng = state.lng;
    state.loading = { forecast: true, marine: true, radar: true };
    render();
    var done = function (key, fn) {
      return function (v) { if (req !== state.req) return; state.loading[key] = false; fn(v); render(); };
    };
    API.forecast(lat, lng).then(done('forecast', function (j) { state.forecast = j; }),
      done('forecast', function (e) { state.errors.forecast = e; console.warn('forecast', e); }));
    API.marine(lat, lng).then(done('marine', function (j) { state.marine = j; }),
      done('marine', function (e) { state.errors.marine = e; console.warn('marine', e); }));

    var names = [];
    D.PREDATORS.forEach(function (p) { names = names.concat(p.taxa); });
    var d1 = new Date(Date.now() - LOOKBACK_DAYS * FM.DAY).toISOString().slice(0, 10);
    API.lookupTaxa(names).then(function (taxa) {
      if (req !== state.req) return null;
      state.taxa = taxa;
      var tix = FM.predatorTaxonIndex(D.PREDATORS, taxa);
      if (!tix.ids.length) throw new Error('no predator taxa resolved');
      return API.observations(lat, lng, tix.ids, d1, RADIUS_KM);
    }).then(done('radar', function (obs) { if (obs) state.observations = obs.map(API.slimObservation); }),
      done('radar', function (e) { state.errors.radar = e; console.warn('radar', e); }));
  }

  // ------------------------------------------------------------------ demo

  function savedSnapshot() { return API.store('wff.demo'); }

  function loadDemo(which) {
    var snap = which === 'bundled' ? window.DEMO : (savedSnapshot() || window.DEMO);
    if (!snap) { toast('No demo snapshot bundled yet. Pick a spot and press 💾 Save as demo.'); return; }
    state.req++;
    state.demo = snap;
    state.lat = snap.lat; state.lng = snap.lng; state.place = snap.place;
    state.forecast = snap.forecast; state.marine = snap.marine;
    state.observations = snap.observations; state.taxa = snap.taxa;
    state.loading = {}; state.errors = {};
    if (snap.species && D.FISH[snap.species] && which !== 'keep-fish') { state.species = snap.species; renderPicker(); }
    updateMarker();
    if (map) map.setView([snap.lat, snap.lng], 10);
    var b = $('demoBanner'), saved = savedSnapshot();
    var when = FM.localParts(snap.capturedAt, snap.forecast ? snap.forecast.utc_offset_seconds : 0);
    b.innerHTML = '<span class="tag">DEMO</span>' + (snap.synthetic ? '<span class="tag warn">SYNTHETIC SAMPLE</span>' : '') +
      esc(snap.place) + ' snapshot from ' + when.weekdayName + ' ' + when.dateKey + ' ' + clock(snap.capturedAt, { offsetSec: snap.forecast ? snap.forecast.utc_offset_seconds : 0 }) +
      ' local. The clock is frozen at capture time. ' +
      (snap.synthetic ? 'These numbers are generated test data, not real: capture a real snapshot with 💾 before the demo. ' : '') +
      (saved && window.DEMO && snap !== window.DEMO ? '<button class="chip" type="button" data-act="bundled">Use bundled snapshot</button> ' : '') +
      '<button class="chip" type="button" data-act="exit">Exit demo</button>';
    b.hidden = false;
    $('saveDemoBtn').disabled = true;
    render();
  }

  function exitDemo(silent) {
    state.demo = null;
    $('demoBanner').hidden = true;
    if (!silent) {
      var spot = API.store('wff.spot');
      if (spot && FM.isNum(spot.lat)) { map.setView([spot.lat, spot.lng], 10); chooseSpot(spot.lat, spot.lng, spot.place); }
      else render();
    }
  }

  // Inline up to 30 photos as data URLs so the demo works with no Wi-Fi.
  function inlinePhotos(observations) {
    var jobs = observations.slice(0, 30).map(function (o) {
      var p = o.photos && o.photos[0];
      if (!p || !p.url) return Promise.resolve();
      return Promise.race([
        fetch(p.url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (blob) {
          return new Promise(function (res) {
            var fr = new FileReader();
            fr.onload = function () { p.dataUrl = fr.result; res(); };
            fr.onerror = function () { res(); };
            fr.readAsDataURL(blob);
          });
        }),
        new Promise(function (res) { setTimeout(res, 5000); })
      ]).catch(function () {});
    });
    return Promise.all(jobs);
  }

  function saveDemo() {
    if (!state.forecast) { toast('Nothing to save yet: pick a spot first.'); return; }
    var snap = {
      version: 1, synthetic: false, capturedAt: Date.now(), place: state.place || coordLabel(state.lat, state.lng),
      lat: state.lat, lng: state.lng, species: state.species,
      forecast: state.forecast, marine: state.marine, taxa: state.taxa,
      observations: (state.observations || []).map(function (o) { return JSON.parse(JSON.stringify(o)); })
    };
    toast('Packing the snapshot (and the predator photos)…', 8000);
    inlinePhotos(snap.observations).then(function () {
      var js = '/* Weather for Fish demo snapshot: ' + snap.place + ', captured ' + new Date(snap.capturedAt).toISOString() + ' */\n' +
        'window.DEMO = ' + JSON.stringify(snap) + ';\n';
      var stored = true;
      try { localStorage.setItem('wff.demo', JSON.stringify(snap)); } catch (e) {
        stored = false;
        try { localStorage.setItem('wff.demo', JSON.stringify(Object.assign({}, snap, { observations: snap.observations.map(function (o) { o.photos.forEach(function (p) { delete p.dataUrl; }); return o; }) }))); stored = true; } catch (e2) { /* full */ }
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
      a.download = 'demo-data.js';
      document.body.appendChild(a); a.click(); a.remove();
      toast((stored ? 'Saved! 🎬 Demo mode now loads this snapshot. ' : 'Downloaded. ') + 'Put demo-data.js in /js to bundle it for good.', 7000);
    });
  }

  // ---------------------------------------------------------------- render

  function render() {
    if (state.lat === null) return;
    var r = FM.buildReport({
      forecast: state.forecast, marine: state.marine, observations: state.observations, taxa: state.taxa || {},
      species: sp(), predators: D.PREDATORS, waterMode: state.waterMode, now: now(),
      lat: state.lat, lng: state.lng, place: state.place, radiusKm: RADIUS_KM
    });
    state.report = r;
    renderSpot(r);
    renderAnchor(r);
    renderGrade(r);
    renderTemp(r);
    renderOxygen(r);
    renderBladder(r);
    renderSea(r);
    renderRadar(r);
    renderGauge('hook', r);
    renderGauge('snack', r);
    renderSolunar(r);
    renderEsoteric(r);
    renderTimeline(r);
    $('saveDemoBtn').disabled = !!state.demo || !state.forecast;
    document.body.classList.toggle('is-sea', !!r.isSea);
  }

  function weatherState(el) {
    if (state.loading.forecast) { setBody(el, '<p class="muted loading">Dipping the thermometer…</p>'); return false; }
    if (!state.forecast) { setBody(el, '<p class="offline">' + esc(MSG.forecast) + '</p>'); return false; }
    return true;
  }

  function renderSpot(r) {
    var name = r.place || 'Unnamed water';
    var kind = r.isSea ? '🌊 Salt water' : '🏞️ Fresh water';
    var why = state.waterMode !== 'auto' ? ' (set by you)'
      : state.loading.marine ? ' (checking with the ocean…)'
      : state.errors.marine ? ' (ocean model offline, assuming fresh)'
      : r.seaDetection.isSea ? ' (sea temperature found)' : ' (no sea here, so a lake or river)';
    $('spotName').innerHTML = esc(name) + '<small>' + coordLabel(r.lat, r.lng) + ' · ' + kind + why + '</small>';
  }

  function renderAnchor(r) {
    var b = r.broadcast, speech = $('speech');
    var headline = state.loading.forecast ? 'Hold on, I am reading the water…' : b.headline;
    var prev = $('headline').textContent;
    $('headline').textContent = headline;
    var more = b.alerts.slice(1, 3).map(function (a) { return a.icon + ' ' + a.text; });
    if (!state.loading.forecast && r.grade) more.push('Swim grade: ' + r.grade.letter + '. Blub.');
    $('speechMore').textContent = more.join('  ');
    speech.classList.toggle('alert', b.kind !== 'clear');
    if (prev !== headline) retrigger(speech, 'pop');
    var items = b.alerts.map(function (a) { return a.icon + ' ' + a.text; });
    if (!items.length) items = ['✅ Conditions are great, go be a fish'];
    $('ticker').textContent = items.join('  ·  ') + '  ·  Smartphone adoption among fish holds steady at 0%  ·  ';
  }

  function renderGrade(r) {
    var el = $('gradeLetter');
    if (!r.grade) {
      el.textContent = state.loading.forecast ? '…' : '?';
      el.removeAttribute('data-grade');
      $('gradeSummary').textContent = state.loading.forecast ? 'Grading the water…' : (state.forecast ? '' : MSG.forecast);
      $('bestTimes').innerHTML = '';
      return;
    }
    if (el.textContent !== r.grade.letter) retrigger(el, 'stamp');
    el.textContent = r.grade.letter;
    el.setAttribute('data-grade', r.grade.letter);
    var words = { A: 'Excellent day to be a fish.', B: 'Good swimming. Stay alert.', C: 'Swimmable, with caveats.', D: 'Poor. Consider staying under a rock.', F: 'Do not go out there.' };
    $('gradeSummary').textContent = 'Score ' + r.grade.score + '/100 for a ' + sp().name.toLowerCase() + '. ' + words[r.grade.letter];
    $('bestTimes').innerHTML = r.bestTimes.map(function (bt) {
      return '<span class="best">' + (bt.daylight ? '☀️' : '🌙') + ' Best swim ' + esc(bt.weekday.slice(0, 3)) + ': <b>' + clock(bt.t, r) + '</b> (' + bt.grade + ')' +
        (bt.night ? ' <span class="muted">· safest 🌙 ' + clock(bt.night.t, r) + '</span>' : '') + '</span>';
    }).join('');
  }

  function statusFor(key) {
    return { perfect: 'good', brisk: 'cool', ice: 'cool', hot: 'critical' }[key] || '';
  }

  function rangeBar(T, f) {
    var lo = Math.min(f.tempColdLethal, T) - 2, hi = Math.max(f.tempLethal, T) + 2;
    var pos = function (v) { return ((v - lo) / (hi - lo) * 100).toFixed(1) + '%'; };
    return '<div class="bar" title="Your happy range"><i style="left:' + pos(f.tempMin) + ';width:calc(' + pos(f.tempMax) + ' - ' + pos(f.tempMin) + ')"></i><b style="left:' + pos(T) + '"></b></div>';
  }

  function renderTemp(r) {
    var el = $('mTemp').querySelector('.metric-body');
    if (!weatherState(el)) return;
    var c = r.current, f = sp();
    var html = '<div class="big">' + num('wt', c.waterTemp, 1, '') + '<small> °C</small></div>' +
      '<span class="pill ' + statusFor(c.feels.key) + '">' + c.feels.emoji + ' Feels like for a ' + esc(f.name.toLowerCase()) + ': ' + esc(c.feels.label) + '</span>' +
      rangeBar(c.waterTemp, f) +
      '<p class="detail">' + esc(c.feels.detail) + '</p>' +
      (r.salinity.note ? '<p class="detail">' + (r.salinity.ok ? '🧭 ' : '🧂 ') + esc(r.salinity.note) + '</p>' : '') +
      '<p class="fine">' + (r.waterSource === 'sst'
        ? 'Real sea-surface temperature from the Open-Meteo marine model. Air: ' + fmt(c.airTemp) + ' °C.'
        : 'Lake estimate: water lags the air, so this is a 4-day moving average of the last 7 days of air temperature (now ' + fmt(c.airTemp) + ' °C).') + '</p>';
    setBody(el, html);
  }

  function renderOxygen(r) {
    var el = $('mOxygen').querySelector('.metric-body');
    if (!weatherState(el)) return;
    var c = r.current, b = c.breath, f = sp();
    var cls = ['good', 'good', 'warn', 'serious', 'critical'][b.level];
    var low = c.oxygenLow;
    var html = '<div class="big">' + num('do', c.oxygen.mgL, 1, '') + '<small> mg/L O₂</small></div>' +
      '<span class="pill ' + cls + '">' + b.emoji + ' ' + esc(b.label) + '</span>' +
      '<div class="bar"><i style="width:' + Math.min(100, b.ratio / 2.5 * 100).toFixed(1) + '%;background:' + (b.level >= 3 ? 'var(--critical)' : b.level === 2 ? 'var(--warn)' : 'var(--foam)') + '"></i><b style="left:' + (100 / 2.5).toFixed(1) + '%"></b></div>' +
      '<p class="detail">A ' + esc(f.name.toLowerCase()) + ' needs ' + f.doMin + ' mg/L (white line). The water is ' + Math.round(c.oxygen.pct) + '% saturated' + (c.oxygen.ice ? ', under ice, so no wind gets in' : '') + '.</p>' +
      (low ? '<p class="detail">Lowest in the next 24 h: <b>' + fmt(low.mgL) + ' mg/L at ' + clock(low.t, r) + '</b>, because algae breathe all night and stop making oxygen in the dark.</p>' : '') +
      '<p class="fine">Saturation: 14.652 − 0.41022T + 0.007991T² − 0.000077774T³' + (r.isSea ? ' × 0.8 for sea water' : '') + ', scaled by air pressure. Then an hourly oxygen budget: algae make it in sunlight, everything respires (faster when warm), wind mixes it back in.</p>';
    setBody(el, html);
  }

  function renderBladder(r) {
    var el = $('mBladder').querySelector('.metric-body');
    if (!weatherState(el)) return;
    var p = r.current.pressure;
    if (!p) { setBody(el, '<p class="muted">No barometer reading.</p>'); return; }
    var cls = p.falling ? (Math.abs(p.delta3h) > 3.5 ? 'serious' : 'warn') : 'good';
    var html = '<div class="big">' + num('hpa', p.pressure, 0, '') + '<small> hPa</small></div>' +
      '<span class="pill ' + cls + '">' + (p.falling ? '📉' : p.delta3h > 0.1 ? '📈' : '➖') + ' ' + esc(p.label) + ' (' + (p.delta3h > 0 ? '+' : '') + fmt(p.delta3h) + ' hPa in 3 h)</span>' +
      '<p class="detail">' + (p.falling
        ? 'Your swim bladder is expanding by ' + fmt(p.bladderPct, 2) + '%. It feels like drifting ' + fmt(p.equivalentDepthCm) + ' cm upwards. You may feel floaty.'
        : Math.abs(p.delta3h) < 0.1 ? 'Swim bladder steady. Buoyancy nominal.'
        : 'Your swim bladder is being squeezed by ' + fmt(-p.bladderPct, 2) + '%, like sinking ' + fmt(-p.equivalentDepthCm) + ' cm.') + '</p>' +
      (p.falling ? '<p class="detail">⚠️ Anglers believe fish bite on a falling barometer. Expect humans.</p>' : '') +
      '<p class="fine">Boyle\'s law at 1 m depth: 1 hPa of air pressure equals about 1 cm of water.</p>';
    setBody(el, html);
  }

  function renderSea(r) {
    var w = $('mWaves').querySelector('.metric-body'), c = $('mCurrent').querySelector('.metric-body'), t = $('mTide').querySelector('.metric-body');
    ['mWaves', 'mCurrent', 'mTide'].forEach(function (id) { $(id).classList.toggle('off', !r.isSea); });
    if (!r.isSea) {
      var lake = state.errors.marine ? esc(MSG.marine) + ' ' : '';
      setBody(w, '<p class="muted">' + lake + 'Fresh water: no ocean swell here. The Washing Machine is unplugged.</p>');
      setBody(c, '<p class="muted">No ocean currents in a lake. In a river: swim upstream, it builds character.</p>');
      setBody(t, '<p class="muted">Lakes have no tides worth mentioning. You cannot get stranded in a tide pool. Enjoy that.</p>');
      return;
    }
    [w, c, t].forEach(function (el) { weatherState(el); });
    if (!state.forecast) return;
    var cur = r.current, f = sp();
    var wm = cur.waves;
    if (wm) {
      var cls = wm.index < 3 ? 'good' : wm.index < 5.5 ? 'warn' : wm.index < 7.5 ? 'serious' : 'critical';
      setBody(w, '<div class="big">' + num('wmi', wm.index, 1, '') + '<small> / 10</small></div>' +
        '<span class="pill ' + cls + '"><span class="spin">🌀</span> ' + esc(wm.label) + '</span>' +
        '<p class="detail">Waves ' + fmt(wm.heightM) + ' m every ' + fmt(wm.periodS, 0) + ' s, carrying ' + fmt(wm.kwPerM, 0) + ' kW per metre of wave front.</p>' +
        '<p class="detail">Escape the spin cycle below ~' + fmt(wm.calmDepthM, 0) + ' m: wave motion fades to 4% at half a wavelength.</p>' +
        '<p class="fine">Energy flux ρg²H²T/64π.</p>');
    } else setBody(w, '<p class="muted">No wave data here.</p>');
    var cv = cur.current;
    if (cv) {
      var ccls = cv.verdict === 'Swimmable upstream' ? 'good' : cv.verdict === 'Hard work' ? 'warn' : 'serious';
      setBody(c, '<div class="big">' + num('cur', cv.speedMs, 2, '') + '<small> m/s</small></div>' +
        '<span class="pill ' + ccls + '">' + esc(cv.verdict) + '</span>' +
        '<p class="detail">That is <b>' + fmt(cv.bodyLengthsPerSec) + ' ' + esc(f.name.toLowerCase()) + '-lengths per second</b>' +
        (cv.toward ? ', flowing toward the ' + cv.toward + ' <span class="arrow" style="transform:rotate(' + Math.round(cv.towardDeg) + 'deg)">⬆️</span>' : '') + '.</p>' +
        '<p class="fine">You can cruise at about ' + f.ucritBL + ' body lengths per second (' + fmt(f.ucritBL * f.bodyLengthM, 2) + ' m/s).</p>');
    } else setBody(c, '<p class="muted">No current data for this spot.</p>');
    var tides = cur.tides || [];
    if (tides.length) {
      var nextLow = tides.filter(function (x) { return x.type === 'low'; })[0];
      setBody(t, '<ul class="tide-list">' + tides.map(function (x) {
        return '<li><span>' + (x.type === 'high' ? '⬆️ High' : '⬇️ Low') + ' · ' + dayName(x.t, r) + ' ' + clock(x.t, r) + '</span><span>' + (x.level >= 0 ? '+' : '') + fmt(x.level, 2) + ' m</span></li>';
      }).join('') + '</ul>' +
        (nextLow ? '<p class="detail">⚠️ Next low tide ' + clock(nextLow.t, r) + ': don\'t get stranded in a tide pool.</p>' : '') +
        '<p class="fine">From modelled sea level (tides plus surge). Not for navigation, especially if you are a boat.</p>');
    } else setBody(t, '<p class="muted">No tide data for this spot.</p>');
  }

  // ----------------------------------------------------------------- radar

  function renderRadar(r) {
    var th = $('threat');
    if (state.loading.radar) {
      radar.setBlips([], RADIUS_KM); radar.setStatus('Scanning…');
      th.innerHTML = '<span class="muted">Scanning…</span>';
      $('blipDetail').hidden = true;
      return;
    }
    if (!r.predators) {
      radar.setBlips([], RADIUS_KM); radar.setStatus('No signal');
      th.innerHTML = '';
      $('radarNote').innerHTML = '<span class="offline">' + esc(MSG.radar) + '</span>';
      $('sightList').innerHTML = ''; $('sightCount').textContent = '0';
      return;
    }
    var p = r.predators, t = p.threat;
    $('radarNote').textContent = p.blips.length
      ? 'Real iNaturalist sightings within ' + RADIUS_KM + ' km over the last ' + LOOKBACK_DAYS + ' days. Tap a blip.'
      : 'No predators reported within ' + RADIUS_KM + ' km in the last ' + LOOKBACK_DAYS + ' days. Suspiciously quiet.';
    var cls = t.score >= 80 ? 'critical' : t.score >= 55 ? 'serious' : t.score >= 30 ? 'warn' : 'good';
    th.innerHTML = '<span class="pill ' + cls + '">' + t.emoji + ' ' + esc(t.label) + '</span><span class="score">' + num('threat', t.score, 0, '') + '</span><span class="muted small">/100</span>';
    runCounters(th);
    var changed = radar.blips.length !== p.blips.length || (radar.blips[0] && p.blips[0] && radar.blips[0].id !== p.blips[0].id);
    if (changed) { radar.setBlips(p.blips, RADIUS_KM); $('blipDetail').hidden = true; }
    radar.setStatus(p.blips.length ? '' : 'All clear');
    $('sightCount').textContent = p.blips.length;
    var list = $('sightList');
    list.innerHTML = '';
    p.blips.slice(0, 120).forEach(function (b) {
      var li = document.createElement('li'), btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<span>' + b.emoji + ' ' + esc(b.commonName || b.name) + '</span><span>' + fmt(b.distanceKm) + ' km ' + b.compass + ' · ' + ago(b.ageDays) + '</span>';
      btn.addEventListener('click', function () { radar.select(b); showBlip(b); });
      li.appendChild(btn); list.appendChild(li);
    });
  }

  function showBlip(b) {
    var el = $('blipDetail');
    var date = b.observedMs ? FM.localParts(b.observedMs, state.report.offsetSec) : null;
    var photo = b.photo
      ? '<div class="photo"><img src="' + esc(b.photo) + '" alt="' + esc(b.commonName || b.name) + '" onerror="this.parentNode.textContent=\'' + b.emoji + '\'"></div>'
      : '<div class="photo">' + b.emoji + '</div>';
    el.innerHTML = photo + '<div><h4>' + esc(b.commonName || b.name) + (b.sciName ? ' <i class="muted small">' + esc(b.sciName) + '</i>' : '') + '</h4>' +
      '<p class="meta">' + fmt(b.distanceKm) + ' km ' + b.compass + ' · seen ' + ago(b.ageDays) + (date ? ' (' + date.weekdayName.slice(0, 3) + ' ' + date.dateKey + ')' : '') + (b.obscured ? ' · location blurred by observer' : '') +
        (b.clusterCount > 1 ? ' · +' + (b.clusterCount - 1) + ' more ' + esc(b.plural || b.name.toLowerCase() + 's') + ' right here' : '') + '</p>' +
      '<p>' + esc(b.blurb) + '</p>' +
      '<p class="credit">' + (b.photoAttribution ? 'Photo ' + esc(b.photoAttribution) + ' · ' : '') + (b.user ? 'Observed by ' + esc(b.user) + ' · ' : '') +
      (b.uri ? '<a href="' + esc(b.uri) + '" target="_blank" rel="noopener">View on iNaturalist ↗</a>' : '') + '</p></div>';
    el.hidden = false;
    retrigger(el, 'pop');
  }

  // ---------------------------------------------------- hook danger, snacks

  function renderGauge(kind, r) {
    var el = $(kind + 'Body');
    if (!weatherState(el)) return;
    var cur = r.current[kind], tl = r.timeline.slice(0, 24);
    var peak = tl.reduce(function (a, x) { return x[kind].score > a[kind].score ? x : a; }, tl[0]);
    var hookCls = function (s) { return s >= 75 ? 'critical' : s >= 50 ? 'serious' : s >= 25 ? 'warn' : 'good'; };
    var snackCls = function (s) { return s >= 70 ? 'good' : s >= 45 ? 'cool' : ''; };
    var cls = kind === 'hook' ? hookCls(cur.score) : snackCls(cur.score);
    var icon = kind === 'hook' ? { "Hook o'clock": '🚨', 'Rods out': '🎣', 'A few rods': '🪝', 'Humans elsewhere': '😴' }[cur.label]
      : { Buffet: '🍽️', 'Snacks about': '🪱', 'Slim pickings': '🥢', Fasting: '🫙' }[cur.label];
    var bars = tl.map(function (x) {
      var night = x.sunAlt < -6;
      var color = kind === 'hook' ? (x.hook.score >= 75 ? 'var(--critical)' : x.hook.score >= 50 ? 'var(--serious)' : x.hook.score >= 25 ? 'var(--warn)' : 'var(--good)') : 'var(--foam)';
      return '<i class="' + (night ? 'night' : '') + '" style="height:' + Math.max(4, x[kind].score) + '%;background:' + color + '" title="' + clock(x.t, r) + ': ' + x[kind].score + '"></i>';
    }).join('');
    var html = '<div class="score-row"><div class="big">' + num(kind, cur.score, 0, '') + '<small> / 100</small></div>' +
      '<span class="pill ' + cls + '">' + icon + ' ' + esc(cur.label) + '</span></div>' +
      (cur.reasons.length ? '<ul class="reasons">' + cur.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="spark" aria-hidden="true">' + bars + '</div>' +
      '<div class="spark-axis"><span>now</span><span>+12 h</span><span>+24 h</span></div>' +
      '<p class="detail">' + (kind === 'hook'
        ? 'Peak in the next 24 h: <b>' + clock(peak.t, r) + '</b> (' + peak.hook.score + '). Humans with rods like weekends, dawn and dusk, calm, dry, pleasant weather, and a falling barometer.'
        : 'Best snacking in the next 24 h: <b>' + clock(peak.t, r) + '</b> (' + peak.snack.score + '). Rain washes worms in, insects hatch at dusk, and the moon does the rest.') + '</p>';
    setBody(el, html);
  }

  // --------------------------------------------------------------- solunar

  var TYPE_LABEL = { overhead: 'Moon overhead', underfoot: 'Moon underfoot', moonrise: 'Moonrise', moonset: 'Moonset' };

  function renderSolunar(r) {
    var s = r.solunar, today = s.today, off = r.offsetSec;
    var pct = function (t) { return ((t - today.dayStart) / FM.DAY * 100).toFixed(2) + '%'; };
    var span = function (p) {
      var a = Math.max(p.start, today.dayStart), b = Math.min(p.end, today.dayStart + FM.DAY);
      return 'left:' + pct(a) + ';width:calc(' + pct(b) + ' - ' + pct(a) + ')';
    };
    var rating = function (n) { return new Array(n + 1).join('🐟') + '<span style="opacity:.25">' + new Array(5 - n).join('🐟') + '</span>'; };
    var active = s.activeNow;
    var bar = '<div class="day-bar" aria-label="Today\'s feeding periods">' +
      today.periods.map(function (p) {
        return '<div class="p ' + p.kind + '" style="' + span(p) + '" title="' + TYPE_LABEL[p.type] + ' ' + clock(p.peak, r) + '"></div>' +
          '<div class="lab" style="left:' + pct(Math.min(Math.max(p.peak, today.dayStart + 1.2 * FM.HOUR), today.dayStart + 22.8 * FM.HOUR)) + '">' + (p.kind === 'major' ? 'Major ' : 'Minor ') + clock(p.peak, r) + '</div>';
      }).join('') +
      [6, 12, 18].filter(function (h) {
        var t = today.dayStart + h * FM.HOUR;
        return [today.sun.sunrise, today.sun.sunset].every(function (s) { return !s || Math.abs(s - t) > 1.6 * FM.HOUR; });
      }).map(function (h) { return '<div class="tick" style="left:' + (h / 24 * 100) + '%">' + (h < 10 ? '0' : '') + h + ':00</div>'; }).join('') +
      (today.sun.sunrise ? '<div class="sun" style="left:' + pct(today.sun.sunrise) + '">☀︎ ' + clock(today.sun.sunrise, r) + '</div>' : '') +
      (today.sun.sunset ? '<div class="sun" style="left:' + pct(today.sun.sunset) + '">☾ ' + clock(today.sun.sunset, r) + '</div>' : '') +
      (r.now >= today.dayStart && r.now < today.dayStart + FM.DAY ? '<div class="nowmark" style="left:' + pct(r.now) + '" title="Now"></div>' : '') +
      '</div>';
    var cell = function (day, type) {
      var p = day.periods.filter(function (x) { return x.type === type; });
      if (!p.length) return '<td>—</td>';
      return '<td>' + p.map(function (x) { return clock(x.start, r) + '–' + clock(x.end, r); }).join('<br>') + '</td>';
    };
    var rows = s.days.map(function (d) {
      var lp = FM.localParts(d.dayStart + 12 * FM.HOUR, off);
      return '<tr><td>' + lp.weekdayName.slice(0, 3) + ' ' + lp.day + '</td>' + cell(d, 'overhead') + cell(d, 'underfoot') +
        cell(d, 'moonrise') + cell(d, 'moonset') + '<td class="rating" aria-label="' + d.rating + ' of 4">' + rating(d.rating) + '</td></tr>';
    }).join('');
    var next = s.next;
    var html = '<div class="moon-row"><div class="moon">' + r.moon.emoji + '</div><div><b>' + esc(r.moon.name) + '</b><br>' +
      Math.round(r.moon.fraction * 100) + '% illuminated</div><div>Today\'s rating<br><span class="rating">' + rating(today.rating) + '</span></div></div>' +
      '<p class="now-line">' + (active
        ? 'A ' + active.toUpperCase() + ' PERIOD IS IN PROGRESS. Feed now.'
        : next ? 'Next period: ' + next.kind + ' (' + TYPE_LABEL[next.type].toLowerCase() + '), ' + clock(next.start, r) + ' to ' + clock(next.end, r) + '.' : '') + '</p>' +
      bar +
      '<div class="table-wrap"><table><thead><tr><th>Day</th><th>Major<br>(overhead)</th><th>Major<br>(underfoot)</th><th>Minor<br>(moonrise)</th><th>Minor<br>(moonset)</th><th>Rating</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="footnote">Major periods run one hour either side of the moon\'s upper and lower transit; minor periods half an hour either side of moonrise and moonset. ' +
      'Activity is strongest near the new and full moon, and when a period coincides with sunrise or sunset. Lunar positions computed for ' + coordLabel(r.lat, r.lng) +
      '; times are local (UTC' + (off >= 0 ? '+' : '−') + Math.floor(Math.abs(off) / 3600) + (Math.abs(off) % 3600 ? ':' + ('0' + Math.round(Math.abs(off) % 3600 / 60)).slice(-2) : '') + ').' +
      (today.missing.length ? ' No ' + today.missing.join(' or ') + ' occurs on this date.' : '') + '</p>';
    $('solunarBody').innerHTML = html;
  }

  // ------------------------------------------------------- esoteric almanac

  function renderEsoteric(r) {
    var sb = $('shippingBody');
    if (weatherState(sb) && r.shipping) {
      var p = r.shipping.parts;
      var row = function (k, v) { return v ? '<div class="sf-row"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
      setBody(sb, '<p class="sf-issued">Issued by the Fish Office on behalf of the Maritime and Codguard Agency at ' +
        clock(r.now, r).replace(':', '') + ' today.</p>' +
        (p.gale ? '<p class="sf-gale">⚠️ ' + esc(p.gale) + '</p>' : '') +
        '<p class="sf-area">' + esc(p.area) + '</p>' +
        row('Wind', p.wind) + row('Sea state', p.sea) + row('Weather', p.weather) + row('Visibility', p.visibility) +
        row('Predators', p.predators) + row('Humans', p.humans) +
        '<p class="fine">Beaufort scale, WMO sea state and the official visibility terms (good: over 5 nautical miles). Read in the traditional order.</p>');
    }
    $('shippingBtn').disabled = !r.shipping;

    var o = r.oracle;
    if (o) {
      var lucky = o.luckyHour ? clock(o.luckyHour, r) : null;
      $('oracleBody').innerHTML = '<div class="sign">' + o.sign.symbol + '</div>' +
        '<p class="sign-name">The Moon is in ' + esc(o.sign.name) + '</p>' +
        '<p class="reading">“' + esc(o.reading) + '”</p>' +
        '<ul class="omens"><li>🍀 Lucky depth: <b>' + o.luckyDepthM + ' m</b></li>' +
        '<li>🪝 Avoid lures in <b>' + esc(o.unluckyLure) + '</b></li>' +
        (lucky ? '<li>⏳ Auspicious hour: <b>' + lucky + '</b></li>' : '') + '</ul>' +
        '<p class="fine">Ichthyomancy: the ancient art of divination by inspecting fish. We have reversed it. ' +
        'Moon at ecliptic longitude ' + o.sign.longitude.toFixed(1) + '°.</p>';
    }

    var fb = $('folkloreBody');
    if (weatherState(fb)) {
      var w = r.rhyme, sun = r.solunar.today.sun;
      var lines = ['North', 'East', 'South', 'West'].map(function (q) {
        var line = { North: 'When the wind is in the north, then the fishes do come forth.', East: 'When the wind is in the east, then the fishes bite the least.',
          South: "When the wind is in the south, it blows the bait in the fish's mouth.", West: 'When the wind is in the west, then the fishes bite the best.' }[q];
        return '<li class="' + (w && w.quarter === q ? 'on' : '') + '">' + esc(line) + '</li>';
      }).join('');
      setBody(fb, (w ? '<p class="wind-now">The wind is from the <b>' + esc(w.from.toLowerCase()) + '</b> <span class="arrow" style="transform:rotate(' + Math.round(r.current && r.timeline[0].windDir || 0) + 'deg)">⬇️</span>, so the old rhyme says:</p>' : '') +
        '<ol class="rhyme">' + lines + '</ol>' +
        '<p class="fine">Traditional anglers\' rhyme, quoted in fishing books for 400 years. Peer review pending.</p>' +
        '<h4 class="elevator-title">🦐 The plankton elevator</h4>' +
        '<p class="detail">' + (sun.sunset ? 'Tonight at <b>' + clock(sun.sunset, r) + '</b>' : 'Tonight') + ', billions of zooplankton ride up from the deep to graze at the surface, and they go back down at ' +
        (sun.sunrise ? '<b>' + clock(sun.sunrise, r) + '</b>' : 'dawn') + '. Diel vertical migration: the largest migration on Earth by biomass, every single night. Dinner comes to you.</p>');
    }
  }

  // Greenwich Time Signal: five short pips and a long one, a second apart.
  function pips(done) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime + 0.1;
      for (var i = 0; i < 6; i++) {
        var o = audio.createOscillator(), g = audio.createGain(), len = i === 5 ? 0.5 : 0.1;
        o.frequency.value = 1000;
        g.gain.setValueAtTime(0.0001, t + i);
        g.gain.exponentialRampToValueAtTime(0.18, t + i + 0.01);
        g.gain.setValueAtTime(0.18, t + i + len - 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i + len);
        o.connect(g); g.connect(audio.destination);
        o.start(t + i); o.stop(t + i + len + 0.02);
      }
      setTimeout(done, 5800);
    } catch (e) { done(); }
  }

  function readShipping() {
    var r = state.report;
    if (!r || !r.shipping) return;
    var card = $('shippingCard');
    if (card.classList.contains('on-air')) { stopSpeech(); card.classList.remove('on-air'); return; }
    card.classList.add('on-air');
    $('shippingBtn').textContent = '⏹ Stop';
    pips(function () {
      if (!card.classList.contains('on-air')) return;
      say(r.shipping.text, { voice: /Daniel|Google UK English Male|Arthur|en-GB/i, pitch: 0.95, rate: 0.88 }, function () {
        card.classList.remove('on-air');
        $('shippingBtn').textContent = '📻 Read the Shipping Forecast';
      });
    });
  }

  // -------------------------------------------------------------- timeline

  // Diverging scale: coral (bad for you) <- slate -> blue (good for you).
  var BAD = [229, 72, 77], MID = [58, 70, 84], GOOD = [59, 158, 255];
  function goodness(g) {
    if (!FM.isNum(g)) return 'rgba(255,255,255,0.06)';
    g = FM.clamp(g, 0, 1);
    var a = g < 0.5 ? BAD : MID, b = g < 0.5 ? MID : GOOD, k = g < 0.5 ? g * 2 : (g - 0.5) * 2;
    return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }).join(',') + ')';
  }

  var LANES = [
    { key: 'swim', label: 'Swim score', g: function (x) { return x.score / 100; } },
    { key: 'temp', label: 'Temperature', g: function (x) { return x.feels ? x.feels.comfort : null; } },
    { key: 'oxygen', label: 'Oxygen', g: function (x) { return x.breath ? (x.breath.ratio - 0.8) / 0.7 : null; } },
    { key: 'pred', label: 'Predators', g: function (x) { return x.threat === null ? null : 1 - x.threat / 100; } },
    { key: 'hook', label: 'Fishermen', g: function (x) { return 1 - x.hook.score / 100; } },
    { key: 'snack', label: 'Snacks', g: function (x) { return x.snack.score / 100; } }
  ];

  function renderTimeline(r) {
    var box = $('timeline');
    if (!weatherState(box)) { $('tlDetail').textContent = ''; return; }
    var tl = r.timeline, n = tl.length, cols = 'grid-template-columns:repeat(' + n + ',minmax(0,1fr))';
    var html = '<div></div><div class="axis">' + tl.map(function (x, i) {
      var lp = FM.localParts(x.t, r.offsetSec), left = ((i + 0.5) / n * 100).toFixed(2) + '%';
      if (lp.hour === 0) return '<span class="day" style="left:' + (i / n * 100).toFixed(2) + '%">' + lp.weekdayName.slice(0, 3) + '</span>';
      if (lp.hour % 6 === 0) return '<span style="left:' + left + '">' + (lp.hour < 10 ? '0' : '') + lp.hour + '</span>';
      return '';
    }).join('') + '<span class="day" style="left:0">' + (FM.localParts(tl[0].t, r.offsetSec).hour === 0 ? '' : 'Now') + '</span></div>';
    LANES.forEach(function (lane) {
      html += '<div class="lane-label">' + lane.label + '</div><div class="lane" style="' + cols + '">' +
        tl.map(function (x) { return '<i style="background:' + goodness(lane.g(x)) + (x.sunAlt < -6 ? ';opacity:.78' : '') + '"></i>'; }).join('') + '</div>';
    });
    html += '<div class="lane-label">Solunar</div><div class="lane sol" style="' + cols + '">' +
      tl.map(function (x) { return '<i class="' + (x.solunar || '') + '"></i>'; }).join('') + '</div>';
    html += '<div class="lane-label">Night</div><div class="lane night" style="' + cols + '">' +
      tl.map(function (x) { return '<i style="background:' + (x.sunAlt < -6 ? '#0b1626' : x.sunAlt < 0 ? '#36506e' : '#f7d46b') + '"></i>'; }).join('') + '</div>';
    box.innerHTML = html;
    var lanes = box.querySelectorAll('.lane');
    var overlay = document.createElement('div');
    overlay.className = 'tl-overlay';
    var host = document.createElement('div');
    host.className = 'tl-hit';
    host.tabIndex = 0;
    host.setAttribute('role', 'slider');
    host.setAttribute('aria-label', '72-hour timeline: use arrow keys to move through the hours');
    host.setAttribute('aria-valuemin', 0); host.setAttribute('aria-valuemax', n - 1);
    box.style.position = 'relative';
    box.appendChild(host);
    host.appendChild(overlay);
    function place() {
      var first = lanes[0].getBoundingClientRect(), last = lanes[lanes.length - 1].getBoundingClientRect(), b = box.getBoundingClientRect();
      host.style.left = (first.left - b.left) + 'px';
      host.style.width = first.width + 'px';
      host.style.top = (first.top - b.top) + 'px';
      host.style.height = (last.bottom - first.top) + 'px';
    }
    place();
    placeTimelineHost = place;
    var sel = 0;
    function show(i) {
      sel = FM.clamp(i, 0, n - 1);
      var x = tl[sel], lp = FM.localParts(x.t, r.offsetSec);
      overlay.style.left = ((sel + 0.5) / n * 100) + '%';
      overlay.style.opacity = 1;
      host.setAttribute('aria-valuenow', sel);
      $('tlDetail').innerHTML = '<b>' + lp.weekdayName.slice(0, 3) + ' ' + clock(x.t, r) + '</b> · Swim <b>' + x.grade + '</b> (' + x.score + ') · ' +
        'Water ' + fmt(x.waterTemp) + ' °C ' + (x.feels ? x.feels.emoji : '') + ' · O₂ ' + fmt(x.oxygen.mgL) + ' mg/L · ' +
        'Predators ' + (x.threat === null ? '–' : x.threat) + ' · Fishermen ' + x.hook.score + ' · Snacks ' + x.snack.score +
        (x.solunar ? ' · 🌙 solunar ' + x.solunar : '') + (x.waves ? ' · Waves ' + fmt(x.waves.heightM) + ' m' : '');
      host.setAttribute('aria-valuetext', $('tlDetail').textContent);
    }
    function fromEvent(e) {
      var rect = host.getBoundingClientRect();
      show(Math.floor((e.clientX - rect.left) / rect.width * n));
    }
    host.addEventListener('pointermove', fromEvent);
    host.addEventListener('pointerdown', fromEvent);
    host.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { show(sel + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { show(sel - 1); e.preventDefault(); }
    });
    show(0);
  }

  // ---------------------------------------------------------------- speech

  var BUBBLY = /Samantha|Karen|Tessa|Moira|Zira|Google UK English Female|Google US English|Female|Jenny|Aria/i;
  function pickVoice(pref) {
    var voices = window.speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    return voices.filter(function (v) { return pref.test(v.name) || pref.test(v.lang); })[0] || voices[0] || null;
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // Speak text; onEnd always fires (even if the engine forgets to).
  function say(text, opts, onEnd) {
    if (!('speechSynthesis' in window)) { toast('Your browser cannot talk. Neither can fish. Blub.'); if (onEnd) onEnd(); return null; }
    var u = new SpeechSynthesisUtterance(text.replace(/°C/g, 'degrees').replace(/mg\/L/g, 'milligrams per litre').replace(/ km /g, ' kilometres '));
    var v = pickVoice(opts.voice || BUBBLY);
    if (v) u.voice = v;
    u.pitch = opts.pitch; u.rate = opts.rate; u.volume = 1;
    var finished = false;
    var finish = function () { if (finished) return; finished = true; if (onEnd) onEnd(); };
    u.onend = u.onerror = finish;
    if (opts.onBoundary) u.onboundary = opts.onBoundary;
    if (opts.onStart) u.onstart = opts.onStart;
    // Chrome can drop an utterance spoken straight after cancel(), so only cancel when needed.
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setTimeout(finish, 2000 + text.length * 90 / (opts.rate || 1));
    return u;
  }

  function speechText(t) {
    return t.replace(/°C/g, 'degrees').replace(/mg\/L/g, 'milligrams per litre').replace(/ km /g, ' kilometres ');
  }

  // A three-note news sting.
  function sting() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime + 0.05;
      [[392, 0], [523.25, 0.16], [783.99, 0.32], [1046.5, 0.32]].forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'triangle'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(0.2, t + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + (n[1] > 0.3 ? 0.9 : 0.18));
        o.connect(g); g.connect(audio.destination);
        o.start(t + n[1]); o.stop(t + n[1] + 1);
      });
    } catch (e) { /* silent news */ }
  }

  var newsroom = { open: false, timer: null, clockTimer: null };

  function closeNewsroom() {
    if (!newsroom.open) return;
    newsroom.open = false;
    clearInterval(newsroom.timer); clearInterval(newsroom.clockTimer);
    stopSpeech();
    var el = $('newsroom');
    el.classList.add('leaving');
    setTimeout(function () { el.hidden = true; el.classList.remove('leaving', 'live'); }, 450);
    $('anchorFish').classList.remove('talking');
    $('speakBtn').textContent = '🔊 Read it to me';
  }

  // Full-screen broadcast with subtitles that follow the voice.
  function speak() {
    var r = state.report;
    if (!r) { toast('Pick some water first. I need something to read.'); return; }
    if (newsroom.open) { closeNewsroom(); return; }
    var b = r.broadcast, el = $('newsroom'), fish = $('nrFish');
    newsroom.open = true;
    fish.innerHTML = FishArt.svg(sp());
    fish.className = 'nr-fish talking';
    $('nrHeadline').textContent = b.icon + ' ' + b.headline;
    $('nrBreaking').textContent = b.kind === 'clear' ? 'FISH NEWS TONIGHT' : 'BREAKING FISH NEWS';
    var items = b.alerts.map(function (a) { return a.icon + ' ' + a.text; });
    if (r.shipping) items.push('📻 ' + r.shipping.parts.area + ': ' + r.shipping.parts.wind + ' ' + r.shipping.parts.weather);
    if (r.oracle) items.push(r.oracle.sign.symbol + ' The Moon is in ' + r.oracle.sign.name);
    items.push('Smartphone adoption among fish holds steady at 0%');
    $('nrTicker').textContent = items.join('   ·   ') + '   ·   ';
    var tick = function () { $('nrClock').textContent = (r.place || 'Unnamed water') + ' · ' + clock(now(), r); };
    tick(); newsroom.clockTimer = setInterval(tick, 10000);
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('live');
    $('anchorFish').classList.add('talking');
    $('speakBtn').textContent = '⏹ Stop';

    var lines = b.lines.map(speechText), starts = [], pos = 0;
    lines.forEach(function (l) { starts.push(pos); pos += l.length + 1; });
    var text = lines.join(' '), current = -1, boundaries = false;
    function showLine(i) {
      if (i === current || i >= lines.length) return;
      current = i;
      $('nrSub').innerHTML = '<span>' + esc(b.lines[i]) + '</span>';
      retrigger($('nrSub'), 'pop');
    }
    function chomp() {
      fish.classList.remove('chomp'); void fish.offsetWidth; fish.classList.add('chomp');
    }
    showLine(0);
    sting();
    setTimeout(function () {
      if (!newsroom.open) return;
      var t0 = Date.now(), rate = 1.08;
      // Fallback pacing if the voice engine sends no word boundaries.
      newsroom.timer = setInterval(function () {
        if (boundaries) return;
        var chars = (Date.now() - t0) / 1000 * 14 * rate, i = 0;
        while (i + 1 < starts.length && starts[i + 1] <= chars) i++;
        showLine(i);
      }, 200);
      say(text, {
        pitch: 1.9, rate: rate,
        onBoundary: function (e) {
          if (e.name && e.name !== 'word') return;
          if (!boundaries) { boundaries = true; fish.classList.remove('talking'); }
          chomp();
          var i = 0;
          while (i + 1 < starts.length && starts[i + 1] <= e.charIndex) i++;
          showLine(i);
        }
      }, function () {
        blub();
        showLine(lines.length - 1);
        fish.classList.remove('talking');
        setTimeout(closeNewsroom, 2200);
      });
    }, 1100);
  }

  // ------------------------------------------------------------------ boot

  function init() {
    initBubbles();
    initKelp();
    initSwimmers();
    initTapBubbles();
    initPicker();
    initMap();
    initSearch();
    initWaterMode();
    radar = new Radar($('radar'), { onSelect: showBlip });
    $('sonarBtn').addEventListener('click', function () {
      var on = radar.setSound(!radar.sound);
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.textContent = on ? '🔊 Sonar on' : '🔈 Sonar off';
    });
    $('speakBtn').addEventListener('click', speak);
    $('shippingBtn').addEventListener('click', readShipping);
    $('nrClose').addEventListener('click', closeNewsroom);
    $('newsroom').addEventListener('click', function (e) { if (e.target === this) closeNewsroom(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNewsroom(); });
    var stars = document.querySelector('.oracle .stars');
    for (var si = 0; si < 26; si++) {
      var st = document.createElement('i');
      st.style.left = (Math.random() * 100) + '%'; st.style.top = (Math.random() * 100) + '%';
      st.style.animationDelay = (-Math.random() * 3) + 's';
      stars.appendChild(st);
    }
    $('demoBtn').addEventListener('click', function () { loadDemo(); });
    $('saveDemoBtn').addEventListener('click', saveDemo);
    $('demoBanner').addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'exit') exitDemo();
      if (act === 'bundled') loadDemo('bundled');
    });
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
    initReveal();
    renderPicker();

    var params = new URLSearchParams(location.search);
    var spot = API.store('wff.spot');
    if (params.has('demo')) loadDemo();
    else if (spot && FM.isNum(spot.lat)) { map.setView([spot.lat, spot.lng], 10); chooseSpot(spot.lat, spot.lng, spot.place); }

    // Live mode: keep the clock moving and the data fresh.
    setInterval(function () { if (!state.demo && state.forecast) render(); }, 5 * 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WFF = { state: state, render: render, loadDemo: loadDemo, chooseSpot: chooseSpot, setSpecies: setSpecies, get radar() { return radar; } };
})();
