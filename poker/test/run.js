/*
 * Headless test suite for the poker engine. No browser required:
 *   node test/run.js
 * Loads the same source files the browser uses and asserts on them.
 */
'use strict';
var path = require('path');
global.window = global;
function load(f) { require(path.join(__dirname, '..', 'public', 'js', f)); }
load('handEvaluator.js');
load('cards.js');
load('ai.js');
load('game.js');

var E = global.HandEvaluator;
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name); }
}
function c(r, s) { return { rank: r, suit: s }; }
function ev(cards) { return E.evaluate(cards); }

// ---- Hand ranking ----
console.log('Hand evaluator:');
var royal = ev([c(14, 'S'), c(13, 'S'), c(12, 'S'), c(11, 'S'), c(10, 'S')]);
var sf = ev([c(9, 'H'), c(8, 'H'), c(7, 'H'), c(6, 'H'), c(5, 'H')]);
ok('royal flush is category 9', royal.category === 9);
ok('royal beats straight flush', royal.score > sf.score);

var wheel = ev([c(14, 'S'), c(2, 'D'), c(3, 'C'), c(4, 'H'), c(5, 'S')]);
ok('A-2-3-4-5 is a straight', wheel.category === 5);
ok('wheel is five-high', /Five high/.test(wheel.name));
var sixHigh = ev([c(6, 'S'), c(2, 'D'), c(3, 'C'), c(4, 'H'), c(5, 'S')]);
ok('6-high straight beats the wheel', sixHigh.score > wheel.score);

var quads = ev([c(9, 'S'), c(9, 'D'), c(9, 'C'), c(9, 'H'), c(2, 'S')]);
var boat = ev([c(8, 'S'), c(8, 'D'), c(8, 'C'), c(3, 'H'), c(3, 'S')]);
ok('quads beat a full house', quads.score > boat.score);

var flush = ev([c(14, 'D'), c(10, 'D'), c(7, 'D'), c(4, 'D'), c(2, 'D')]);
var straight = ev([c(10, 'S'), c(9, 'D'), c(8, 'C'), c(7, 'H'), c(6, 'S')]);
ok('flush beats a straight', flush.score > straight.score);

var tpA = ev([c(14, 'S'), c(14, 'D'), c(9, 'C'), c(9, 'H'), c(5, 'S')]);
var tpB = ev([c(14, 'C'), c(14, 'H'), c(9, 'S'), c(9, 'D'), c(4, 'S')]);
ok('two-pair kicker breaks ties', tpA.score > tpB.score);

var t1 = ev([c(14, 'S'), c(13, 'D'), c(9, 'C'), c(6, 'H'), c(2, 'S')]);
var t2 = ev([c(14, 'H'), c(13, 'C'), c(9, 'S'), c(6, 'D'), c(2, 'D')]);
ok('identical hands tie exactly', t1.score === t2.score);

// ---- Deck integrity ----
console.log('Deck:');
var deck = global.Cards.makeDeck();
ok('deck has 52 cards', deck.length === 52);
var ids = {};
deck.forEach(function (card) { ids[card.suit + card.rank] = true; });
ok('all 52 cards are unique', Object.keys(ids).length === 52);

// ---- Full-game simulation: chip conservation ----
console.log('Game simulation (chip conservation over many hands):');
var Game = global.Game;
var players = [
  { name: 'You', isHuman: true, chips: 1000 },
  { name: 'Ava', isHuman: false, chips: 1000 },
  { name: 'Boone', isHuman: false, chips: 1000 },
  { name: 'Cleo', isHuman: false, chips: 1000 },
];
var hp = 0, rebuys = 0, leaked = false;
var TARGET = 200;
var g = new Game({
  players: players,
  aiThinkMs: 0, streetPauseMs: 0, actionGapMs: 0,
  callbacks: {
    update: function () {}, message: function () {}, reveal: function () {},
    awaitAction: function (idx, opts) {
      var r = Math.random(), a;
      if (opts.canRaise && r < 0.15) a = 'raise';
      else if (opts.canCheck) a = (r < 0.3 && opts.canBet) ? 'bet' : 'check';
      else if (opts.toCall <= opts.betSize && r < 0.75) a = 'call';
      else a = r < 0.4 ? 'call' : 'fold';
      setTimeout(function () { g.humanAction(a); }, 0);
    },
    handEnd: function () {
      hp++;
      var total = players.reduce(function (s, p) { return s + p.chips; }, 0);
      if (total !== 4000 + rebuys * 1000) { leaked = true; done(total); return; }
      if (hp >= TARGET) { done(total); return; }
      setTimeout(function () {
        players.forEach(function (p) { if (p.chips <= 0) { p.chips = 1000; rebuys++; } });
        g.startHand();
      }, 0);
    },
    needRebuy: function () {
      players.forEach(function (p) { if (p.chips <= 0) { p.chips = 1000; rebuys++; } });
      setTimeout(function () { g.startHand(); }, 0);
    },
  },
});

function done(total) {
  ok(hp + ' hands completed without deadlock', hp >= TARGET);
  ok('chips conserved (' + total + ' == ' + (4000 + rebuys * 1000) + ')', !leaked);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

var guard = setTimeout(function () {
  console.log('  FAIL: simulation timed out at hand ' + hp);
  process.exit(1);
}, 60000);
guard.unref && guard.unref();

g.startHand();
