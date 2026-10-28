/*
 * Weather for Fish: SVG fish portraits, one per species.
 * FishArt.svg(species, { cls }) returns markup. Facing right.
 */
(function (root) {
  'use strict';
  var uid = 0;

  var BODY = 'M40 70 C60 30 140 22 180 56 C191 64 191 77 180 85 C140 116 60 110 40 70 Z';
  var TAIL = 'M50 70 L12 34 Q24 70 12 106 Z';
  var FANCY_TAIL = 'M52 70 C34 38 2 18 6 46 C9 60 22 66 28 70 C22 74 9 80 6 94 C2 122 34 102 52 70 Z';

  function spots(color, pts) {
    return pts.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (p[2] || 2.6) + '" fill="' + color + '"/>'; }).join('');
  }

  function pattern(sp, id) {
    var c = sp.colors;
    switch (sp.key) {
      case 'trout':
        return '<path d="M44 72 C80 60 140 58 186 70 C140 80 80 82 44 72 Z" fill="' + c.stripe + '" opacity="0.85"/>' +
          spots(c.spots, [[70, 52], [86, 46], [100, 54], [116, 44], [128, 52], [142, 46], [92, 64], [60, 60], [150, 58], [108, 86], [80, 90], [132, 88], [62, 84]]);
      case 'salmon':
        return '<path d="M44 74 C90 66 140 66 186 72 C140 86 90 90 44 74 Z" fill="' + c.stripe + '" opacity="0.45"/>' +
          spots(c.spots, [[78, 48, 2], [96, 42, 2], [112, 46, 2], [128, 42, 2], [144, 48, 2], [104, 56, 1.6], [88, 56, 1.6]]);
      case 'carp':
        var scales = '';
        for (var row = 0; row < 5; row++) {
          for (var col = 0; col < 9; col++) {
            var x = 52 + col * 15 + (row % 2) * 7.5, y = 40 + row * 14;
            scales += '<path d="M' + (x - 7) + ' ' + y + ' Q' + x + ' ' + (y + 9) + ' ' + (x + 7) + ' ' + y + '" fill="none" stroke="' + c.spots + '" stroke-width="1.6" opacity="0.55"/>';
          }
        }
        return scales;
      case 'goldfish':
        return '<ellipse cx="110" cy="58" rx="56" ry="16" fill="#fff3c4" opacity="0.25"/>';
      case 'clownfish':
        return [[88, 22], [128, 18], [164, 14]].map(function (b) {
          var x = b[0], w = b[1];
          return '<path d="M' + (x - w / 2) + ' 10 C' + (x - w / 2 - 8) + ' 60 ' + (x - w / 2 - 8) + ' 80 ' + (x - w / 2) + ' 130 L' + (x + w / 2) + ' 130 C' + (x + w / 2 - 8) + ' 80 ' + (x + w / 2 - 8) + ' 60 ' + (x + w / 2) + ' 10 Z" ' +
            'fill="#fff" stroke="#111" stroke-width="3.5"/>';
        }).join('');
    }
    return '';
  }

  function svg(sp, opts) {
    opts = opts || {};
    var c = sp.colors, id = 'fish' + (++uid);
    var fancy = sp.key === 'goldfish', clown = sp.key === 'clownfish', carp = sp.key === 'carp';
    var edge = clown ? ' stroke="#111" stroke-width="3"' : '';
    var dorsal = carp ? 'M78 42 Q108 12 154 38 Z' : clown ? 'M88 36 Q104 14 120 32 Q138 12 160 42 Z' : 'M94 38 Q114 6 142 34 Z';
    var out = '<svg class="fish-svg ' + (opts.cls || '') + '" viewBox="0 0 200 140" role="img" aria-label="' + sp.name + '">' +
      '<defs>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + c.back + '"/><stop offset="0.55" stop-color="' + (clown ? c.back : c.stripe) + '" stop-opacity="' + (clown ? 1 : 0.35) + '"/>' +
      '<stop offset="1" stop-color="' + c.belly + '"/></linearGradient>' +
      '<clipPath id="' + id + 'c"><path d="' + BODY + '"/></clipPath>' +
      '</defs>' +
      '<g class="fish-tail"><path d="' + (fancy ? FANCY_TAIL : TAIL) + '" fill="' + c.fin + '"' + edge + ' opacity="0.95"/></g>' +
      '<path d="' + dorsal + '" fill="' + c.fin + '"' + edge + '/>' +
      '<path d="M100 104 Q112 126 128 104 Z" fill="' + c.fin + '"' + edge + ' opacity="0.9"/>' +
      '<path d="' + BODY + '" fill="url(#' + id + 'g)"/>' +
      '<g clip-path="url(#' + id + 'c)">' + pattern(sp, id) + '</g>' +
      '<path d="' + BODY + '" fill="none" stroke="' + (clown ? '#111' : 'rgba(0,0,0,0.25)') + '" stroke-width="' + (clown ? 3 : 1.5) + '"/>' +
      '<path d="M150 50 Q141 70 150 92" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="2.2" stroke-linecap="round"/>' +
      '<g class="fish-pec"><path d="M128 82 Q112 100 132 102 Q140 92 128 82 Z" fill="' + c.fin + '"' + edge + ' opacity="0.95"/></g>' +
      '<ellipse cx="164" cy="80" rx="7" ry="4" fill="#ff7f9f" opacity="0.45"/>' +
      '<circle cx="166" cy="62" r="10" fill="#fff"/><circle class="fish-pupil" cx="169" cy="63" r="5.5" fill="#101820"/>' +
      '<circle cx="171" cy="60" r="2" fill="#fff"/>' +
      '<ellipse class="fish-mouth" cx="185" cy="74" rx="3.2" ry="1.6" fill="#5a1f2b"/>' +
      (carp ? '<path d="M183 77 Q192 88 186 96 M180 79 Q184 90 178 98" fill="none" stroke="' + c.spots + '" stroke-width="1.8" stroke-linecap="round"/>' : '') +
      '</svg>';
    return out;
  }

  root.FishArt = { svg: svg };
})(typeof self !== 'undefined' ? self : this);
