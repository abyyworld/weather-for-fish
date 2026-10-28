/*
 * Weather for Fish: Predator Radar.
 * A canvas PPI scope. Blips sit at their true distance and compass bearing
 * and glow when the sweep passes over them, like phosphor on a real scope.
 */
(function (root) {
  'use strict';

  var SWEEP_MS = 4200;

  function Radar(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = (opts && opts.onSelect) || function () {};
    this.blips = [];
    this.radiusKm = 25;
    this.selected = null;
    this.status = 'Waiting for a spot';
    this.running = false;
    this.visible = true;
    this.reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t0 = performance.now();
    var self = this;
    canvas.addEventListener('click', function (e) { self.handleClick(e); });
    canvas.addEventListener('mousemove', function (e) {
      canvas.style.cursor = self.hit(e) ? 'pointer' : 'crosshair';
    });
    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    if (root.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        self.visible = entries[0].isIntersecting;
        if (self.visible) self.start();
      }).observe(canvas);
    }
    this.resize();
    this.start();
  }

  Radar.prototype.setBlips = function (blips, radiusKm) {
    this.blips = blips || [];
    this.radiusKm = radiusKm || 25;
    this.selected = null;
    this.cluster();
    this.draw();
  };

  // Merge same-type sightings that would overlap on screen into one blip.
  Radar.prototype.cluster = function () {
    var self = this, out = [];
    if (!this.size) { this.clusters = []; return; }
    this.blips.slice().sort(function (a, b) { return b.weight - a.weight; }).forEach(function (b) {
      var p = self.project(b), hit = null;
      for (var i = 0; i < out.length; i++) {
        if (out[i].key === b.key && Math.hypot(out[i].x - p.x, out[i].y - p.y) < 20) { hit = out[i]; break; }
      }
      if (hit) { hit.members.push(b); hit.ageDays = Math.min(hit.ageDays, b.ageDays); }
      else out.push({ key: b.key, emoji: b.emoji, danger: b.danger, bearing: b.bearing, ageDays: b.ageDays, x: p.x, y: p.y, members: [b] });
    });
    this.clusters = out;
  };

  Radar.prototype.setSound = function (on) {
    this.sound = on;
    if (on && !this.audio) {
      try { this.audio = new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { this.sound = false; }
    }
    if (on) this.ping();
    return this.sound;
  };

  // Submarine sonar: a high sine ping with a fading echo.
  Radar.prototype.ping = function () {
    var a = this.audio;
    if (!a) return;
    var t = a.currentTime, o = a.createOscillator(), g = a.createGain(), d = a.createDelay(), fb = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1350, t); o.frequency.exponentialRampToValueAtTime(1250, t + 1);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    d.delayTime.value = 0.32; fb.gain.value = 0.35;
    o.connect(g); g.connect(a.destination); g.connect(d); d.connect(fb); fb.connect(d); d.connect(a.destination);
    o.start(t); o.stop(t + 1.2);
  };

  Radar.prototype.blipTone = function (danger) {
    var a = this.audio;
    if (!a) return;
    var t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = 300 + 500 * danger;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.14);
  };

  Radar.prototype.setStatus = function (text) { this.status = text; this.draw(); };

  Radar.prototype.select = function (blip) { this.selected = blip; this.draw(); };

  Radar.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var size = Math.max(200, Math.round(rect.width));
    var dpr = root.devicePixelRatio || 1;
    this.size = size;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cluster();
    this.draw();
  };

  Radar.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    var self = this;
    function frame() {
      if (!self.visible || self.reduced) { self.running = false; self.draw(); return; }
      self.draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  // Compass bearing (deg) and distance (km) -> canvas pixels.
  Radar.prototype.project = function (b) {
    var c = this.size / 2, R = c - 26;
    var r = Math.min(1, b.distanceKm / this.radiusKm) * R;
    var a = b.bearing * Math.PI / 180;
    return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) };
  };

  Radar.prototype.sweepDeg = function () {
    return ((performance.now() - this.t0) % SWEEP_MS) / SWEEP_MS * 360;
  };

  Radar.prototype.draw = function () {
    var ctx = this.ctx, s = this.size, c = s / 2, R = c - 26;
    if (!s) return;
    ctx.clearRect(0, 0, s, s);

    var bg = ctx.createRadialGradient(c, c, 0, c, c, R);
    bg.addColorStop(0, '#0c3b3a');
    bg.addColorStop(1, '#04161c');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();

    // Range rings every 5 km.
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.22)';
    ctx.fillStyle = 'rgba(160, 240, 225, 0.75)';
    ctx.lineWidth = 1;
    ctx.font = '600 10px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'left';
    var step = this.radiusKm <= 10 ? 2 : 5;
    for (var km = step; km <= this.radiusKm + 0.01; km += step) {
      var rr = km / this.radiusKm * R;
      ctx.beginPath(); ctx.arc(c, c, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(km + ' km', c + 3, c - rr + 11);
    }
    ctx.beginPath();
    ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
    ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 12px Nunito, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200, 255, 245, 0.9)';
    ctx.fillText('N', c, c - R - 12); ctx.fillText('S', c, c + R + 12);
    ctx.fillText('E', c + R + 12, c); ctx.fillText('W', c - R - 12, c);

    var sweep = this.reduced ? null : this.sweepDeg();
    if (sweep !== null && this.sound && this.lastSweep !== undefined) {
      var from = this.lastSweep, crossed = function (b) { return from <= sweep ? b > from && b <= sweep : b > from || b <= sweep; };
      if (sweep < from) this.ping();
      var self0 = this;
      (this.clusters || []).forEach(function (c) { if (c.danger >= 0.75 && crossed(c.bearing)) self0.blipTone(c.danger); });
    }
    this.lastSweep = sweep === null ? undefined : sweep;
    if (sweep !== null) {
      var a = (sweep - 90) * Math.PI / 180;
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
      // Fading phosphor trail behind the beam.
      for (var k = 0; k < 24; k++) {
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, R, a - (k + 1) * 0.045, a - k * 0.045);
        ctx.closePath();
        ctx.fillStyle = 'rgba(94, 234, 212,' + (0.28 * (1 - k / 24)) + ')';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(180, 255, 240, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + R * Math.cos(a), c + R * Math.sin(a)); ctx.stroke();
      ctx.restore();
    }

    // Blips (clustered), least dangerous first so the worst sit on top.
    var self = this;
    var list = (this.clusters || []).slice().sort(function (x, y) { return x.danger - y.danger; });
    list.forEach(function (c) {
      var glow = 1;
      if (sweep !== null) {
        var since = ((sweep - c.bearing) % 360 + 360) % 360;
        glow = Math.exp(-since / 140);
      }
      var n = c.members.length;
      var fresh = Math.pow(0.5, c.ageDays / 7);
      var alpha = 0.35 + 0.65 * Math.max(glow, 0.15) * (0.4 + 0.6 * fresh);
      var size = 16 + 10 * c.danger + Math.min(8, 3 * Math.log(n) / Math.LN2);
      if (glow > 0.6) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, size * (1.6 - glow * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 120, 100,' + (0.25 * glow) + ')';
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
      ctx.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText(c.emoji, c.x, c.y);
      ctx.globalAlpha = 1;
      if (n > 1) {
        var label = '×' + n, bx = c.x + size * 0.45, by = c.y - size * 0.5;
        ctx.font = '900 10px Nunito, system-ui, sans-serif';
        var w = ctx.measureText(label).width + 8;
        ctx.fillStyle = 'rgba(255, 209, 102, 0.95)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx - w / 2, by - 7, w, 14, 7); else ctx.rect(bx - w / 2, by - 7, w, 14);
        ctx.fill();
        ctx.fillStyle = '#2b1700';
        ctx.fillText(label, bx, by + 0.5);
      }
      if (self.selected && c.members.some(function (m) { return m.id === self.selected.id; })) {
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, size * 0.85, 0, Math.PI * 2); ctx.stroke();
      }
    });

    // You are here.
    ctx.font = '22px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.fillText('🐟', c, c);
    if (!this.blips.length && this.status) {
      ctx.font = '700 13px Nunito, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(200, 255, 245, 0.85)';
      ctx.fillText(this.status, c, c + 34);
    }
  };

  // The clicked cluster's most threatening sighting, with how many it stands for.
  Radar.prototype.hit = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (this.size / rect.width), y = (e.clientY - rect.top) * (this.size / rect.height);
    var best = null, bestD = 24, cs = this.clusters || [];
    for (var i = 0; i < cs.length; i++) {
      var d = Math.hypot(cs[i].x - x, cs[i].y - y);
      if (d < bestD) { bestD = d; best = cs[i]; }
    }
    if (!best) return null;
    var top = best.members[0], out = {};
    for (var k in top) out[k] = top[k];
    out.clusterCount = best.members.length;
    return out;
  };

  Radar.prototype.handleClick = function (e) {
    var b = this.hit(e);
    if (b) { this.select(b); this.onSelect(b); }
  };

  root.Radar = Radar;
})(typeof self !== 'undefined' ? self : this);
