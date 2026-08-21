/*
 * Computer opponent decision making for five-card stud.
 * Heuristic strength model based on the bot's own cards plus a read of
 * opponents' visible (face-up) cards, mixed with pot odds and a little bluff.
 */
(function (global) {
  'use strict';

  // Estimate the strength (0..1) of a partial or complete stud hand from
  // the set of cards this bot can see of its own (hole + up cards).
  function ownStrength(cards) {
    var n = cards.length;
    if (n === 0) return 0.2;

    var ranks = cards.map(function (c) { return c.rank; });
    var suits = cards.map(function (c) { return c.suit; });

    // Rank multiplicities.
    var counts = {};
    ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    var groups = Object.keys(counts).map(function (r) {
      return { rank: Number(r), n: counts[r] };
    }).sort(function (a, b) {
      if (b.n !== a.n) return b.n - a.n;
      return b.rank - a.rank;
    });

    var topGroup = groups[0];
    var high = Math.max.apply(null, ranks);

    var strength;
    if (topGroup.n >= 4) {
      strength = 0.98;
    } else if (topGroup.n === 3) {
      strength = 0.9;
    } else if (topGroup.n === 2 && groups[1] && groups[1].n === 2) {
      strength = 0.75; // two pair
    } else if (topGroup.n === 2) {
      // one pair — value scaled by pair rank
      strength = 0.5 + (topGroup.rank - 2) / 12 * 0.2;
    } else {
      // no pair — high card value
      strength = 0.15 + (high - 2) / 12 * 0.25;
    }

    // Flush / straight draw bonuses when the hand is still developing.
    var suitCounts = {};
    suits.forEach(function (s) { suitCounts[s] = (suitCounts[s] || 0) + 1; });
    var maxSuit = Math.max.apply(null, Object.keys(suitCounts).map(function (s) { return suitCounts[s]; }));
    if (n < 5) {
      if (maxSuit === 4) strength += 0.18;
      else if (maxSuit === 3) strength += 0.08;

      var uniq = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
      var span = uniq[uniq.length - 1] - uniq[0];
      if (uniq.length >= 3 && span <= 4) strength += 0.06;
    }

    return Math.max(0, Math.min(1, strength));
  }

  // How scary do opponents' visible cards look? Returns 0..1.
  function boardThreat(opponents) {
    var threat = 0;
    opponents.forEach(function (op) {
      if (op.folded) return;
      var up = op.upCards || [];
      var counts = {};
      up.forEach(function (c) { counts[c.rank] = (counts[c.rank] || 0) + 1; });
      var maxN = 0;
      var maxRank = 0;
      Object.keys(counts).forEach(function (r) {
        if (counts[r] > maxN) { maxN = counts[r]; maxRank = Number(r); }
      });
      var t = 0;
      if (maxN >= 3) t = 0.8;
      else if (maxN === 2) t = 0.45 + (maxRank - 2) / 12 * 0.2;
      else {
        var hi = up.length ? Math.max.apply(null, up.map(function (c) { return c.rank; })) : 0;
        t = (hi - 2) / 12 * 0.25;
      }
      if (t > threat) threat = t;
    });
    return threat;
  }

  // ctx: {
  //   cards, opponents, currentBet, roundBet, betSize, maxRaises, raises,
  //   pot, chips, canCheck, street
  // }
  function decide(ctx) {
    var strength = ownStrength(ctx.cards);
    var threat = boardThreat(ctx.opponents);

    // Net read: our strength discounted by scary boards.
    var read = strength - threat * 0.35;
    read = Math.max(0, Math.min(1, read));

    // A touch of randomness + occasional bluff.
    var noise = (Math.random() - 0.5) * 0.12;
    var effective = Math.max(0, Math.min(1, read + noise));

    var toCall = ctx.currentBet - ctx.roundBet;
    var canRaise = ctx.raises < ctx.maxRaises && ctx.chips > toCall;

    // Nothing to call: check or open.
    if (toCall <= 0) {
      var bluff = Math.random() < 0.12;
      if ((effective > 0.55 || bluff) && ctx.chips >= ctx.betSize && canRaise) {
        return { action: 'bet' };
      }
      return { action: 'check' };
    }

    // Facing a bet — evaluate pot odds.
    var potOdds = toCall / (ctx.pot + toCall);

    // Strong: raise a good chunk of the time.
    if (effective > 0.72 && canRaise && Math.random() < 0.6) {
      return { action: 'raise' };
    }
    // Playable: call if the read beats the price.
    if (effective > potOdds + 0.08) {
      return { action: 'call' };
    }
    // Semi-bluff raise occasionally on later streets.
    if (canRaise && effective > 0.4 && Math.random() < 0.08) {
      return { action: 'raise' };
    }
    // Cheap call as a crying call sometimes.
    if (toCall <= ctx.betSize && effective > 0.3 && Math.random() < 0.35) {
      return { action: 'call' };
    }
    return { action: 'fold' };
  }

  global.AI = { decide: decide, ownStrength: ownStrength };
})(typeof window !== 'undefined' ? window : this);
