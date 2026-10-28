/*
 * Weather for Fish: network layer. Free, keyless APIs only:
 * Open-Meteo (forecast, marine, geocoding), iNaturalist, Nominatim.
 */
(function (root) {
  'use strict';

  var URLS = {
    forecast: 'https://api.open-meteo.com/v1/forecast',
    marine: 'https://marine-api.open-meteo.com/v1/marine',
    geocode: 'https://geocoding-api.open-meteo.com/v1/search',
    nominatim: 'https://nominatim.openstreetmap.org',
    inat: 'https://api.inaturalist.org/v1'
  };
  var TAXA_CACHE = 'wff.taxa.v1';

  function qs(params) {
    return Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  function fetchJSON(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
    return value;
  }

  function forecast(lat, lng) {
    return fetchJSON(URLS.forecast + '?' + qs({
      latitude: lat.toFixed(4), longitude: lng.toFixed(4),
      hourly: 'temperature_2m,precipitation,cloud_cover,wind_speed_10m,pressure_msl,surface_pressure,shortwave_radiation,weather_code',
      past_days: 7, forecast_days: 4, timezone: 'auto', wind_speed_unit: 'ms'
    }));
  }

  // If the full variable list is ever rejected, fall back to the basics.
  function marine(lat, lng) {
    var base = { latitude: lat.toFixed(4), longitude: lng.toFixed(4), past_days: 1, forecast_days: 4, timezone: 'auto' };
    var full = 'wave_height,wave_period,wave_direction,swell_wave_height,ocean_current_velocity,ocean_current_direction,sea_surface_temperature,sea_level_height_msl';
    return fetchJSON(URLS.marine + '?' + qs(Object.assign({ hourly: full }, base))).catch(function (e) {
      if (e.status !== 400) throw e;
      return fetchJSON(URLS.marine + '?' + qs(Object.assign({ hourly: 'wave_height,wave_period,sea_surface_temperature' }, base)));
    });
  }

  function parseLatLng(q) {
    var m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (!m) return null;
    var lat = +m[1], lng = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  // Open-Meteo knows towns; Nominatim knows lakes, rivers and bays. Ask both.
  function geocode(q) {
    var ll = parseLatLng(q);
    if (ll) return Promise.resolve([{ name: q.trim(), label: 'Coordinates', lat: ll.lat, lng: ll.lng }]);
    var om = fetchJSON(URLS.geocode + '?' + qs({ name: q, count: 5, language: 'en', format: 'json' }), 8000)
      .then(function (j) {
        return (j.results || []).map(function (r) {
          return { name: r.name, label: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lng: r.longitude };
        });
      });
    var nom = fetchJSON(URLS.nominatim + '/search?' + qs({ q: q, format: 'jsonv2', limit: 5 }), 8000)
      .then(function (j) {
        return (j || []).map(function (r) {
          var parts = (r.display_name || '').split(', ');
          return { name: r.name || parts[0], label: parts.slice(1, 4).join(', '), lat: +r.lat, lng: +r.lon, kind: r.type };
        });
      });
    return Promise.allSettled([nom, om]).then(function (res) {
      var all = [], failed = 0;
      res.forEach(function (r) { if (r.status === 'fulfilled') all = all.concat(r.value); else failed++; });
      if (failed === res.length) throw new Error('geocoders unreachable');
      var out = [];
      all.forEach(function (r) {
        var dup = out.some(function (o) { return Math.abs(o.lat - r.lat) < 0.02 && Math.abs(o.lng - r.lng) < 0.02; });
        if (!dup && isFinite(r.lat) && isFinite(r.lng)) out.push(r);
      });
      return out.slice(0, 7);
    });
  }

  function reverseName(lat, lng) {
    return fetchJSON(URLS.nominatim + '/reverse?' + qs({ lat: lat, lon: lng, format: 'jsonv2', zoom: 12 }), 8000)
      .then(function (j) {
        if (!j || j.error) return null;
        var a = j.address || {};
        return j.name || a.water || a.bay || a.village || a.town || a.city || a.county || null;
      });
  }

  // Scientific name -> iNaturalist taxon id, exact matches only, cached forever.
  function lookupTaxa(names) {
    var cache = store(TAXA_CACHE) || {};
    var todo = names.filter(function (n) { return !(n in cache); });
    var failures = 0, i = 0;
    function worker() {
      if (i >= todo.length) return Promise.resolve();
      var name = todo[i++];
      return fetchJSON(URLS.inat + '/taxa?' + qs({ q: name, per_page: 30, is_active: true }), 10000)
        .then(function (j) { cache[name] = root.FishMath.exactTaxonMatch(j.results, name); },
          function () { failures++; })
        .then(worker);
    }
    var workers = [];
    for (var w = 0; w < 4; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      store(TAXA_CACHE, cache);
      if (todo.length && failures === todo.length && !names.some(function (n) { return cache[n]; })) {
        throw new Error('iNaturalist taxa lookup failed');
      }
      var map = {};
      names.forEach(function (n) { if (cache[n]) map[n] = cache[n]; });
      return map;
    });
  }

  function observations(lat, lng, taxonIds, d1, radiusKm) {
    return fetchJSON(URLS.inat + '/observations?' + qs({
      lat: lat.toFixed(4), lng: lng.toFixed(4), radius: radiusKm, d1: d1,
      taxon_id: taxonIds.join(','), per_page: 200, order_by: 'observed_on', order: 'desc',
      captive: false, geo: true
    }), 20000).then(function (j) { return j.results || []; });
  }

  // Keep only what the app reads, so demo snapshots stay small.
  function slimObservation(o) {
    var t = o.taxon || {};
    return {
      id: o.id, observed_on: o.observed_on, time_observed_at: o.time_observed_at,
      geojson: o.geojson, location: o.location, obscured: o.obscured, quality_grade: o.quality_grade,
      ident_taxon_ids: o.ident_taxon_ids,
      taxon: {
        id: t.id, name: t.name, rank: t.rank, preferred_common_name: t.preferred_common_name,
        ancestor_ids: t.ancestor_ids, ancestry: t.ancestry,
        default_photo: t.default_photo ? { square_url: t.default_photo.square_url, attribution: t.default_photo.attribution } : null
      },
      photos: (o.photos || []).slice(0, 1).map(function (p) {
        return { url: (p.url || '').replace('/square.', '/small.'), attribution: p.attribution };
      }),
      user: o.user ? { login: o.user.login } : null, uri: o.uri, place_guess: o.place_guess
    };
  }

  root.FishAPI = {
    URLS: URLS, fetchJSON: fetchJSON, store: store,
    forecast: forecast, marine: marine, geocode: geocode, reverseName: reverseName, parseLatLng: parseLatLng,
    lookupTaxa: lookupTaxa, observations: observations, slimObservation: slimObservation
  };
})(typeof self !== 'undefined' ? self : this);
