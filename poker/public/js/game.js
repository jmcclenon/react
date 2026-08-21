/*
 * Five-Card Stud game engine.
 *
 * Rules implemented:
 *   - Every player antes.
 *   - Each player is dealt one hole card (face down) and one up card.
 *   - Betting round, then three more up cards are dealt one at a time,
 *     each followed by a betting round (four betting rounds total).
 *   - Fixed-limit betting: small bet on the first two rounds, big bet on
 *     the last two, capped number of raises per round.
 *   - Showdown with correct hand ranking and side-pot distribution.
 *
 * The engine is UI-agnostic. It drives the game via timers for pacing and
 * reports everything through the callbacks passed to the constructor.
 */
(function (global) {
  'use strict';

  var Cards = global.Cards;
  var AI = global.AI;
  var HandEvaluator = global.HandEvaluator;

  var DEFAULTS = {
    ante: 5,
    smallBet: 10,
    bigBet: 20,
    maxRaises: 4,
    aiThinkMs: 750,
    streetPauseMs: 850,
    actionGapMs: 200,
  };

  function Game(config) {
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.on = config.callbacks || {};
    this.players = config.players; // [{name, chips, isHuman}]
    this.dealerIndex = 0;
    this.handNumber = 0;
    this.timers = [];
    this.pendingHuman = null;
  }

  Game.prototype._emit = function (name) {
    var fn = this.on[name];
    if (fn) fn.apply(null, Array.prototype.slice.call(arguments, 1));
  };

  Game.prototype._later = function (fn, ms) {
    var t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  };

  Game.prototype._clearTimers = function () {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  };

  Game.prototype.message = function (text, kind) {
    this._emit('message', text, kind || 'info');
  };

  // ---- Public state snapshot for the UI and the AI -------------------------

  Game.prototype.snapshot = function () {
    return {
      players: this.players.map(function (p) {
        return {
          name: p.name,
          isHuman: p.isHuman,
          chips: p.chips,
          folded: p.folded,
          allIn: p.allIn,
          roundBet: p.roundBet,
          committed: p.committed,
          hole: p.hole,
          up: p.up,
          isDealer: p.isDealer,
          isTurn: p.isTurn,
          handLabel: p.handLabel,
          lastAction: p.lastAction,
        };
      }),
      pot: this.pot,
      currentBet: this.currentBet,
      betSize: this.betSize,
      cardsDealt: this.cardsDealt,
      phase: this.phase,
      handNumber: this.handNumber,
    };
  };

  Game.prototype.render = function () {
    this._emit('update', this.snapshot());
  };

  // ---- Hand lifecycle ------------------------------------------------------

  Game.prototype.startHand = function () {
    this._clearTimers();

    // Remove busted players from active play (chips === 0 and can't rebuy here).
    var seated = this.players.filter(function (p) { return p.chips > 0; });
    if (seated.length < 2) {
      this._emit('needRebuy', this.players);
      return;
    }

    this.handNumber++;
    this.deck = Cards.shuffle(Cards.makeDeck());
    this.pot = 0;
    this.currentBet = 0;
    this.cardsDealt = 0;
    this.phase = 'ante';

    this.players.forEach(function (p, i) {
      p.hole = null;
      p.up = [];
      p.folded = p.chips <= 0; // sit out if broke
      p.allIn = false;
      p.roundBet = 0;
      p.committed = 0;
      p.handLabel = '';
      p.lastAction = '';
      p.isDealer = false;
      p.isTurn = false;
    });

    // Advance the dealer button to the next player who has chips.
    do {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    } while (this.players[this.dealerIndex].chips <= 0);
    this.players[this.dealerIndex].isDealer = true;

    this.message('--- Hand #' + this.handNumber + ' --- Everyone antes ' + this.cfg.ante + '.', 'deal');

    // Antes.
    var self = this;
    this.players.forEach(function (p) {
      if (p.folded) return;
      var a = Math.min(self.cfg.ante, p.chips);
      p.chips -= a;
      p.committed += a;
      self.pot += a;
      if (p.chips === 0) p.allIn = true;
    });

    this.render();

    // Deal hole card + first up card to each active player.
    this._later(function () { self._dealInitial(); }, this.cfg.streetPauseMs);
  };

  Game.prototype._activePlayers = function () {
    return this.players.filter(function (p) { return !p.folded; });
  };

  Game.prototype._dealOne = function (p, faceUp) {
    var card = this.deck.pop();
    if (faceUp) p.up.push(card);
    else p.hole = card;
  };

  Game.prototype._dealInitial = function () {
    var self = this;
    this.phase = 'deal';
    this.players.forEach(function (p) {
      if (p.folded) return;
      self._dealOne(p, false); // hole
      self._dealOne(p, true); // first up
    });
    this.cardsDealt = 2;
    this.message('Hole cards down, first up-cards dealt.', 'deal');
    this.render();
    this._later(function () { self._beginBettingRound(true); }, this.cfg.streetPauseMs);
  };

  Game.prototype._dealNextStreet = function () {
    var self = this;
    this.phase = 'deal';
    this.players.forEach(function (p) {
      if (p.folded) return;
      self._dealOne(p, true);
    });
    this.cardsDealt++;
    this.message('Dealing up-card ' + (this.cardsDealt - 1) + '.', 'deal');
    this.render();
    this._later(function () { self._beginBettingRound(false); }, this.cfg.streetPauseMs);
  };

  // ---- Betting -------------------------------------------------------------

  // Seat indices after idx in turn order, wrapping around, EXCLUDING idx itself.
  Game.prototype._seatOrderAfter = function (idx) {
    var order = [];
    for (var k = 1; k < this.players.length; k++) {
      order.push((idx + k) % this.players.length);
    }
    return order;
  };

  Game.prototype._canAct = function (p) {
    return !p.folded && !p.allIn && p.chips > 0;
  };

  // Visible strength of a player's up cards, for deciding who acts first.
  Game.prototype._visibleStrength = function (p) {
    var up = p.up;
    if (!up.length) return 0;
    var counts = {};
    up.forEach(function (c) { counts[c.rank] = (counts[c.rank] || 0) + 1; });
    var best = 0;
    up.forEach(function (c) {
      var score = counts[c.rank] * 100 + c.rank;
      if (score > best) best = score;
    });
    return best;
  };

  Game.prototype._firstToAct = function (isFirstRound) {
    var self = this;
    var contenders = [];
    this.players.forEach(function (p, i) {
      if (self._canAct(p)) contenders.push(i);
    });
    if (!contenders.length) return -1;

    if (isFirstRound) {
      // Bring-in: lowest up card acts first.
      contenders.sort(function (a, b) {
        return self._visibleStrength(self.players[a]) - self._visibleStrength(self.players[b]);
      });
    } else {
      // Highest showing hand acts first.
      contenders.sort(function (a, b) {
        return self._visibleStrength(self.players[b]) - self._visibleStrength(self.players[a]);
      });
    }
    return contenders[0];
  };

  Game.prototype._beginBettingRound = function (isFirstRound) {
    // If only one player remains, go straight to payout.
    if (this._activePlayers().length <= 1) {
      this._resolveHand();
      return;
    }

    this.phase = 'betting';
    this.betSize = this.cardsDealt <= 3 ? this.cfg.smallBet : this.cfg.bigBet;
    this.currentBet = 0;
    this.raises = 0;
    this.players.forEach(function (p) { p.roundBet = 0; p.isTurn = false; });

    var first = this._firstToAct(isFirstRound);
    if (first < 0) {
      // Nobody can act (all all-in) — skip betting.
      this._endBettingRound();
      return;
    }

    // Build the action queue: first actor, then the rest in seat order.
    // Folded / all-in players are left in but skipped when their turn comes.
    this.queue = [first].concat(this._seatOrderAfter(first));
    this._requestNextAction();
  };

  Game.prototype._requestNextAction = function () {
    var self = this;

    // Close the round if only one active player remains.
    if (this._activePlayers().length <= 1) {
      this._endBettingRound();
      return;
    }

    while (this.queue.length) {
      var idx = this.queue[0];
      var p = this.players[idx];
      if (!this._canAct(p)) { this.queue.shift(); continue; }

      this.players.forEach(function (pp) { pp.isTurn = false; });
      p.isTurn = true;
      this.render();

      if (p.isHuman) {
        this._emit('awaitAction', idx, this._actionOptions(idx));
        return;
      }
      // AI acts after a short think.
      (function (index) {
        self._later(function () { self._aiAct(index); }, self.cfg.aiThinkMs);
      })(idx);
      return;
    }

    this._endBettingRound();
  };

  Game.prototype._actionOptions = function (idx) {
    var p = this.players[idx];
    var toCall = this.currentBet - p.roundBet;
    var canRaise = this.raises < this.cfg.maxRaises && p.chips > toCall;
    return {
      toCall: Math.max(0, toCall),
      canCheck: toCall <= 0,
      canCall: toCall > 0,
      canBet: toCall <= 0 && p.chips >= this.betSize,
      canRaise: canRaise && toCall > 0,
      betSize: this.betSize,
      chips: p.chips,
      pot: this.pot,
    };
  };

  Game.prototype._aiAct = function (idx) {
    var p = this.players[idx];
    var self = this;
    var opponents = this.players.map(function (op, i) {
      return { folded: op.folded, upCards: i === idx ? [] : op.up };
    }).filter(function (_, i) { return i !== idx; });

    var known = [];
    if (p.hole) known.push(p.hole);
    known = known.concat(p.up);

    var decision = AI.decide({
      cards: known,
      opponents: opponents,
      currentBet: this.currentBet,
      roundBet: p.roundBet,
      betSize: this.betSize,
      maxRaises: this.cfg.maxRaises,
      raises: this.raises,
      pot: this.pot,
      chips: p.chips,
      street: this.cardsDealt,
    });

    this._applyAction(idx, decision.action);
    this._later(function () { self._requestNextAction(); }, this.cfg.actionGapMs);
  };

  // Human entry point.
  Game.prototype.humanAction = function (action) {
    var idx = this.players.findIndex(function (p) { return p.isHuman; });
    if (idx < 0 || !this.players[idx].isTurn) return;
    this._applyAction(idx, action);
    var self = this;
    this._later(function () { self._requestNextAction(); }, this.cfg.actionGapMs);
  };

  Game.prototype._placeChips = function (p, amount) {
    var a = Math.min(amount, p.chips);
    p.chips -= a;
    p.roundBet += a;
    p.committed += a;
    this.pot += a;
    if (p.chips === 0) p.allIn = true;
    return a;
  };

  Game.prototype._applyAction = function (idx, action) {
    var p = this.players[idx];
    p.isTurn = false;
    if (this.queue[0] === idx) this.queue.shift();

    var toCall = this.currentBet - p.roundBet;

    // Normalize illegal actions defensively.
    if (action === 'check' && toCall > 0) action = 'call';
    if (action === 'bet' && this.currentBet > 0) action = 'raise';
    if (action === 'raise' && (this.raises >= this.cfg.maxRaises || p.chips <= toCall)) action = 'call';

    if (action === 'fold') {
      p.folded = true;
      p.lastAction = 'Fold';
      this.message(p.name + ' folds.');
    } else if (action === 'check') {
      p.lastAction = 'Check';
      this.message(p.name + ' checks.');
    } else if (action === 'call') {
      var called = this._placeChips(p, toCall);
      p.lastAction = 'Call ' + called;
      this.message(p.name + ' calls ' + called + '.');
    } else if (action === 'bet') {
      var bet = this._placeChips(p, this.betSize);
      this.currentBet = p.roundBet;
      this.raises++;
      p.lastAction = 'Bet ' + bet;
      this.message(p.name + ' bets ' + this.currentBet + '.', 'bet');
      this._reopenQueue(idx);
    } else if (action === 'raise') {
      var target = this.currentBet + this.betSize;
      var need = target - p.roundBet;
      this._placeChips(p, need);
      this.currentBet = p.roundBet;
      this.raises++;
      p.lastAction = 'Raise ' + this.currentBet;
      this.message(p.name + ' raises to ' + this.currentBet + '.', 'bet');
      this._reopenQueue(idx);
    }

    // If the fold left one player, end now.
    if (this._activePlayers().length <= 1) {
      this.queue = [];
    }
    this.render();
  };

  // After a bet/raise everyone else who can act must respond again.
  Game.prototype._reopenQueue = function (aggressorIdx) {
    var self = this;
    this.queue = this._seatOrderAfter(aggressorIdx).filter(function (i) {
      return self._canAct(self.players[i]);
    });
  };

  Game.prototype._endBettingRound = function () {
    var self = this;
    this.players.forEach(function (p) { p.isTurn = false; });
    this.render();

    if (this._activePlayers().length <= 1) {
      this._later(function () { self._resolveHand(); }, 400);
      return;
    }
    if (this.cardsDealt >= 5) {
      this._later(function () { self._showdown(); }, this.cfg.streetPauseMs);
      return;
    }
    this._later(function () { self._dealNextStreet(); }, this.cfg.streetPauseMs);
  };

  // ---- Resolution ----------------------------------------------------------

  // Everyone else folded — the last player standing wins the pot.
  Game.prototype._resolveHand = function () {
    var active = this._activePlayers();
    var self = this;
    if (active.length === 1) {
      var winner = active[0];
      winner.chips += this.pot;
      this.message(winner.name + ' wins ' + this.pot + ' (everyone else folded).', 'win');
      this._emit('handEnd', {
        winners: [{ name: winner.name, amount: this.pot, hand: null }],
        showdown: false,
      });
    }
    this.pot = 0;
    this.phase = 'handover';
    this.render();
  };

  Game.prototype._showdown = function () {
    var self = this;
    this.phase = 'showdown';

    var contenders = this._activePlayers();
    contenders.forEach(function (p) {
      var cards = [p.hole].concat(p.up);
      p.eval = HandEvaluator.evaluate(cards);
      p.handLabel = p.eval.name;
    });

    // Reveal everyone's hole cards.
    this.render();
    this._emit('reveal');

    // Side-pot distribution based on committed amounts.
    var payouts = this._distributePots();

    var results = payouts.map(function (pay) {
      var p = self.players[pay.playerIndex];
      p.chips += pay.amount;
      return { name: p.name, amount: pay.amount, hand: p.eval ? p.eval.name : null };
    });

    // Human-friendly summary of the best hand(s).
    var best = null;
    contenders.forEach(function (p) {
      if (!best || p.eval.score > best.eval.score) best = p;
    });
    if (best) {
      this.message('Showdown! ' + best.name + ' shows ' + best.eval.name + '.', 'win');
    }
    results.forEach(function (r) {
      if (r.amount > 0) self.message(r.name + ' wins ' + r.amount + '.', 'win');
    });

    this.pot = 0;
    this.phase = 'handover';
    this.render();
    this._emit('handEnd', { winners: results.filter(function (r) { return r.amount > 0; }), showdown: true });
  };

  // Build side pots from committed chips and award each to the best eligible
  // (non-folded) hand. Returns [{playerIndex, amount}].
  Game.prototype._distributePots = function () {
    var self = this;
    var contribs = this.players.map(function (p) { return p.committed; });
    var payouts = {};

    function addPay(i, amt) {
      payouts[i] = (payouts[i] || 0) + amt;
    }

    // Repeatedly peel off the smallest positive contribution as a pot layer.
    while (true) {
      var positive = [];
      this.players.forEach(function (p, i) {
        if (contribs[i] > 0) positive.push(i);
      });
      if (!positive.length) break;

      var min = Math.min.apply(null, positive.map(function (i) { return contribs[i]; }));
      var layer = 0;
      positive.forEach(function (i) {
        contribs[i] -= min;
        layer += min;
      });

      // Eligible winners: contributed to this layer AND not folded.
      var eligible = positive.filter(function (i) { return !self.players[i].folded; });
      if (!eligible.length) {
        // Dead layer (only folded contributors) — award to overall best hand.
        eligible = this._activePlayers().map(function (p) { return self.players.indexOf(p); });
      }

      var bestScore = -1;
      eligible.forEach(function (i) {
        var s = self.players[i].eval ? self.players[i].eval.score : -1;
        if (s > bestScore) bestScore = s;
      });
      var winners = eligible.filter(function (i) {
        return self.players[i].eval && self.players[i].eval.score === bestScore;
      });
      if (!winners.length) winners = eligible;

      var share = Math.floor(layer / winners.length);
      var remainder = layer - share * winners.length;
      winners.forEach(function (i, k) {
        addPay(i, share + (k < remainder ? 1 : 0)); // odd chip to earliest seats
      });
    }

    return Object.keys(payouts).map(function (i) {
      return { playerIndex: Number(i), amount: payouts[i] };
    });
  };

  global.Game = Game;
})(typeof window !== 'undefined' ? window : this);
