/*
 * Weather for Fish: reference data.
 * Fish physiology and predator profiles. Numbers come from the fisheries
 * literature where one exists; the jokes are original.
 */
(function (root, factory) {
  var data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.FishData = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // tempMin/tempMax: preferred range (°C). tempLethal / tempColdLethal: where
  // comfort reaches zero. doMin: minimum dissolved oxygen (mg/L) before stress.
  // bodyLengthM and ucritBL (critical swim speed in body lengths per second)
  // decide whether the fish can swim against a current.
  var FISH = {
    trout: {
      key: 'trout', name: 'Trout', latin: 'Oncorhynchus mykiss', emoji: '🐟',
      tempMin: 10, tempMax: 16, tempLethal: 25, tempColdLethal: -1.5,
      doMin: 6, water: 'fresh', bodyLengthM: 0.35, ucritBL: 2.5,
      blurb: 'Cold, clean, oxygen-rich water snob.',
      seaNote: 'Rainbow trout that go to sea are called steelhead. Steelhead mode: engaged.',
      colors: { back: '#5b6b2f', belly: '#f1e7c8', stripe: '#e8798b', fin: '#8a8f4a', spots: '#2a2a1a' }
    },
    salmon: {
      key: 'salmon', name: 'Salmon', latin: 'Salmo salar', emoji: '🍣',
      tempMin: 8, tempMax: 14, tempLethal: 24, tempColdLethal: -1,
      doMin: 6, water: 'both', bodyLengthM: 0.7, ucritBL: 2.0,
      blurb: 'Anadromous: born fresh, raised salty. We do not talk about the emoji.',
      seaNote: 'Anadromous. You contain multitudes.',
      colors: { back: '#3d5a73', belly: '#f4d6cf', stripe: '#f08a7a', fin: '#5c7a91', spots: '#1d2c3a' }
    },
    carp: {
      key: 'carp', name: 'Carp', latin: 'Cyprinus carpio', emoji: '🎏',
      tempMin: 18, tempMax: 28, tempLethal: 36, tempColdLethal: -1,
      doMin: 3, water: 'fresh', bodyLengthM: 0.5, ucritBL: 1.8,
      blurb: 'Hardy, whiskered, can gulp air at the surface. Symbol of perseverance.',
      colors: { back: '#7a5a1e', belly: '#f5d58a', stripe: '#c9932f', fin: '#a8742a', spots: '#5a3f12' }
    },
    goldfish: {
      key: 'goldfish', name: 'Goldfish', latin: 'Carassius auratus', emoji: '🐠',
      tempMin: 16, tempMax: 24, tempLethal: 34, tempColdLethal: -1,
      doMin: 4, water: 'fresh', bodyLengthM: 0.15, ucritBL: 4,
      blurb: 'Survives oxygen-free winters by brewing its own alcohol. Remembers things for months.',
      colors: { back: '#f26b1d', belly: '#ffc56b', stripe: '#ff8a2a', fin: '#ff9b45', spots: '#e2531a' }
    },
    clownfish: {
      key: 'clownfish', name: 'Clownfish', latin: 'Amphiprion ocellaris', emoji: '🐠',
      tempMin: 24, tempMax: 28, tempLethal: 33, tempColdLethal: 18,
      doMin: 5, water: 'sea', bodyLengthM: 0.09, ucritBL: 4,
      blurb: 'Lives in an anemone. Born male; the boss becomes female.',
      colors: { back: '#f46a12', belly: '#ff9a3c', stripe: '#ffffff', fin: '#f46a12', spots: '#111111' }
    }
  };

  // Each predator is looked up on iNaturalist by scientific name at runtime.
  // activity: when it hunts. 'day' (sight-hunting birds), 'twilight' (dawn and
  // dusk), 'night', or 'any'.
  var PREDATORS = [
    { key: 'shark', name: 'Shark', emoji: '🦈', danger: 1.0, activity: 'twilight',
      taxa: ['Selachimorpha', 'Carcharhiniformes', 'Lamniformes'],
      blurb: 'Shark: older than trees (by about 50 million years). Senses the electric field of your heartbeat. Act natural.' },
    { key: 'crocodile', name: 'Crocodilian', plural: 'crocodilians', emoji: '🐊', danger: 0.9, activity: 'night',
      taxa: ['Crocodylia'],
      blurb: 'Crocodilian: the strongest bite ever measured, about 16,000 newtons (Erickson et al., 2012). Has been waiting patiently since the Cretaceous.' },
    { key: 'dolphin', name: 'Dolphin', emoji: '🐬', danger: 0.85, activity: 'any',
      taxa: ['Delphinidae'],
      blurb: 'Dolphin: smiles constantly, hunts with sonar, herds your whole school into a "bait ball" with its friends. The smile is not for you.' },
    { key: 'seal', name: 'Seal', emoji: '🦭', danger: 0.8, activity: 'any',
      taxa: ['Phocidae'],
      blurb: 'Seal: a sea dog. Its whiskers can follow your wake 35 seconds after you swam past (Dehnhardt et al., 2001). There is no hiding the trail.' },
    { key: 'sealion', name: 'Sea lion', emoji: '🦭', danger: 0.8, activity: 'any',
      taxa: ['Otariidae'],
      blurb: 'Sea lion: loud, fast (40 km/h underwater), smug. Balances a ball at the aquarium, then goes home and eats you.' },
    { key: 'pike', name: 'Pike', plural: 'pike', emoji: '🦷', danger: 0.8, activity: 'day',
      taxa: ['Esox'],
      blurb: 'Pike: freshwater torpedo with backward-pointing teeth. Once you are in, there is only one direction. Swallows fish half its own length.' },
    { key: 'barracuda', name: 'Barracuda', emoji: '🗡️', danger: 0.8, activity: 'day',
      taxa: ['Sphyraena'],
      blurb: 'Barracuda: attracted to shiny things. You are a shiny thing. Goes 0 to 40 km/h from a standing start.' },
    { key: 'cormorant', name: 'Cormorant', emoji: '🦆', danger: 0.75, activity: 'day',
      taxa: ['Phalacrocoracidae'],
      blurb: 'Cormorant: its feathers soak up water on purpose so it sinks faster. Humans in Japan train them to fish (ukai). This one is freelance.' },
    { key: 'heron', name: 'Heron', emoji: '🦩', danger: 0.7, activity: 'twilight',
      taxa: ['Ardeidae'],
      blurb: 'Heron: stands perfectly still for 20 minutes. Do not trust the statue. A specially hinged sixth neck vertebra fires the beak like a spear.' },
    { key: 'osprey', name: 'Osprey', emoji: '🦅', danger: 0.7, activity: 'day',
      taxa: ['Pandion'],
      blurb: 'Osprey: hovers, folds, hits the water talons-first. Reversible outer toe and spiny foot pads, evolved for gripping slippery fish. You are a slippery fish.' },
    { key: 'bear', name: 'Brown bear', emoji: '🐻', danger: 0.65, activity: 'twilight',
      taxa: ['Ursus arctos'],
      blurb: 'Brown bear: stands at the top of the waterfall with its mouth open, and salmon jump in. Every year. Please stop jumping in. #FatBearWeek is powered by fish.' },
    { key: 'otter', name: 'Otter', emoji: '🦦', danger: 0.6, activity: 'twilight',
      taxa: ['Lutrinae'],
      blurb: 'Otter: adorable on the internet, a menace in the water. Eats about a quarter of its body weight every day. Holds hands while sleeping so it does not drift away from the buffet.' },
    { key: 'pelican', name: 'Pelican', emoji: '🦤', danger: 0.6, activity: 'day',
      taxa: ['Pelecanidae'],
      blurb: 'Pelican: "A wonderful bird is the pelican, his bill can hold more than his belican" (Merritt, 1910). The pouch holds about 11 litres. You fit. Your family fits.' },
    { key: 'kingfisher', name: 'Kingfisher', emoji: '🐦', danger: 0.4, activity: 'day',
      taxa: ['Alcedinidae'],
      blurb: 'Kingfisher: tiny, gorgeous, dives headfirst. Its beak inspired the nose of the 500-series Shinkansen bullet train. Aerodynamic, hungry and very blue.' },
    { key: 'gull', name: 'Gull', emoji: '🕊️', danger: 0.35, activity: 'day',
      taxa: ['Larinae'],
      blurb: 'Gull: will eat literally anything. Chips. A whole pigeon. You. Not a specialist, just relentless.' }
  ];

  // Ready-made spots for the demo and for showing off.
  var SPOTS = [
    { key: 'monterey', name: 'Monterey Bay', emoji: '🦦', lat: 36.66, lng: -121.88 },
    { key: 'reef', name: 'Great Barrier Reef', emoji: '🐠', lat: -16.87, lng: 146.2 },
    { key: 'lochness', name: 'Loch Ness', emoji: '🐉', lat: 57.318, lng: -4.433 },
    { key: 'brooks', name: 'Brooks Falls, Katmai', emoji: '🐻', lat: 58.554, lng: -155.79 },
    { key: 'amazon', name: 'Rio Negro, Manaus', emoji: '🐊', lat: -3.14, lng: -60.02 }
  ];

  return { FISH: FISH, PREDATORS: PREDATORS, SPOTS: SPOTS };
});
