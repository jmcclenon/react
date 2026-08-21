/*
 * Five-card poker hand evaluator.
 * Evaluates exactly 5 cards and returns a comparable score plus a label.
 *
 * Card model: { rank: 2..14, suit: 'S'|'H'|'D'|'C' }
 * rank 11=J, 12=Q, 13=K, 14=A.
 */
(function (global) {
  'use strict';

  var HAND_NAMES = {
    9: 'Straight Flush',
    8: 'Four of a Kind',
    7: 'Full House',
    6: 'Flush',
    5: 'Straight',
    4: 'Three of a Kind',
    3: 'Two Pair',
    2: 'One Pair',
    1: 'High Card',
  };

  var RANK_LABEL = {
    14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten',
    9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five',
    4: 'Four', 3: 'Three', 2: 'Two',
  };

  function rankLabel(r) {
    return RANK_LABEL[r] || String(r);
  }

  // Returns a numeric score. Higher is always better. Ties are broken by
  // packing the hand category and up to five kicker ranks into one integer.
  function evaluate(cards) {
    if (!cards || cards.length !== 5) {
      throw new Error('evaluate() requires exactly 5 cards');
    }

    var ranks = cards.map(function (c) { return c.rank; }).sort(function (a, b) { return b - a; });
    var suits = cards.map(function (c) { return c.suit; });

    var isFlush = suits.every(function (s) { return s === suits[0]; });

    // Count rank occurrences.
    var counts = {};
    ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });

    // Distinct ranks sorted first by count (desc) then by rank (desc).
    var distinct = Object.keys(counts).map(Number).sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return b - a;
    });

    var countPattern = distinct.map(function (r) { return counts[r]; }).join('');

    // Straight detection (Ace can be low: A-2-3-4-5).
    var uniqueDesc = Object.keys(counts).map(Number).sort(function (a, b) { return b - a; });
    var isStraight = false;
    var straightHigh = 0;
    if (uniqueDesc.length === 5) {
      if (uniqueDesc[0] - uniqueDesc[4] === 4) {
        isStraight = true;
        straightHigh = uniqueDesc[0];
      } else if (
        uniqueDesc[0] === 14 &&
        uniqueDesc[1] === 5 &&
        uniqueDesc[2] === 4 &&
        uniqueDesc[3] === 3 &&
        uniqueDesc[4] === 2
      ) {
        // Wheel: Ace plays low, straight is 5-high.
        isStraight = true;
        straightHigh = 5;
      }
    }

    var category;
    var tiebreakers;
    var name;

    if (isStraight && isFlush) {
      category = 9;
      tiebreakers = [straightHigh];
      name = straightHigh === 14 ? 'Royal Flush' : 'Straight Flush, ' + rankLabel(straightHigh) + ' high';
    } else if (countPattern === '41') {
      category = 8;
      tiebreakers = distinct; // [quad, kicker]
      name = 'Four of a Kind, ' + rankLabel(distinct[0]) + 's';
    } else if (countPattern === '32') {
      category = 7;
      tiebreakers = distinct; // [trips, pair]
      name = 'Full House, ' + rankLabel(distinct[0]) + 's over ' + rankLabel(distinct[1]) + 's';
    } else if (isFlush) {
      category = 6;
      tiebreakers = ranks;
      name = 'Flush, ' + rankLabel(ranks[0]) + ' high';
    } else if (isStraight) {
      category = 5;
      tiebreakers = [straightHigh];
      name = 'Straight, ' + rankLabel(straightHigh) + ' high';
    } else if (countPattern === '311') {
      category = 4;
      tiebreakers = distinct; // [trips, k1, k2]
      name = 'Three of a Kind, ' + rankLabel(distinct[0]) + 's';
    } else if (countPattern === '221') {
      category = 3;
      tiebreakers = distinct; // [highPair, lowPair, kicker]
      name = 'Two Pair, ' + rankLabel(distinct[0]) + 's and ' + rankLabel(distinct[1]) + 's';
    } else if (countPattern === '2111') {
      category = 2;
      tiebreakers = distinct; // [pair, k1, k2, k3]
      name = 'Pair of ' + rankLabel(distinct[0]) + 's';
    } else {
      category = 1;
      tiebreakers = ranks;
      name = rankLabel(ranks[0]) + ' high';
    }

    // Pack into a single comparable score.
    // category in the top slot, then up to 5 kickers in base-15 digits.
    var score = category;
    for (var i = 0; i < 5; i++) {
      var k = tiebreakers[i] || 0;
      score = score * 15 + k;
    }

    return {
      score: score,
      category: category,
      categoryName: HAND_NAMES[category],
      name: name,
      tiebreakers: tiebreakers,
    };
  }

  // Best 5-card evaluation. In five-card stud each player has exactly 5,
  // so this just forwards, but it's here for clarity/extensibility.
  function best(cards) {
    return evaluate(cards);
  }

  global.HandEvaluator = {
    evaluate: evaluate,
    best: best,
    rankLabel: rankLabel,
    HAND_NAMES: HAND_NAMES,
  };
})(typeof window !== 'undefined' ? window : this);
