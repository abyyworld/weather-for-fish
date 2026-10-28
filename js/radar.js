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
    this.draw();
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

    // Blips, faintest first so the dangerous ones sit on top.
    var self = this;
    var list = this.blips.slice().sort(function (x, y) { return x.weight - y.weight; });
    list.forEach(function (b) {
      var p = self.project(b);
      var glow = 1;
      if (sweep !== null) {
        var since = ((sweep - b.bearing) % 360 + 360) % 360;
        glow = Math.exp(-since / 140);
      }
      var fresh = Math.pow(0.5, b.ageDays / 7);
      var alpha = 0.35 + 0.65 * Math.max(glow, 0.15) * (0.4 + 0.6 * fresh);
      var size = 14 + 10 * b.danger;
      if (glow > 0.6) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * (1.6 - glow * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 120, 100,' + (0.25 * glow) + ')';
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
      ctx.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText(b.emoji, p.x, p.y);
      ctx.globalAlpha = 1;
      if (self.selected && self.selected.id === b.id) {
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.85, 0, Math.PI * 2); ctx.stroke();
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

  Radar.prototype.hit = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (this.size / rect.width), y = (e.clientY - rect.top) * (this.size / rect.height);
    var best = null, bestD = 22;
    for (var i = 0; i < this.blips.length; i++) {
      var p = this.project(this.blips[i]), d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = this.blips[i]; }
    }
    return best;
  };

  Radar.prototype.handleClick = function (e) {
    var b = this.hit(e);
    if (b) { this.select(b); this.onSelect(b); }
  };

  root.Radar = Radar;
})(typeof self !== 'undefined' ? self : this);
