/*
 * Deck construction, shuffling, and SVG-based card rendering.
 * No external image assets — every card face is drawn with inline SVG/HTML
 * so the game works fully offline and behind any network policy.
 */
(function (global) {
  'use strict';

  var SUITS = ['S', 'H', 'D', 'C'];
  var SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_COLOR = { S: 'black', C: 'black', H: 'red', D: 'red' };
  var RANK_SYMBOL = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
  };

  function makeDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 2; r <= 14; r++) {
        deck.push({ rank: r, suit: SUITS[s], id: SUITS[s] + r });
      }
    }
    return deck;
  }

  // Fisher-Yates shuffle.
  function shuffle(deck) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  // Returns an HTML string for one card. faceUp=false renders the back.
  function cardHTML(card, faceUp) {
    if (!faceUp) {
      return (
        '<div class="card card-back" aria-label="face down card">' +
        '<div class="card-back-pattern"></div>' +
        '</div>'
      );
    }
    var color = SUIT_COLOR[card.suit];
    var sym = SUIT_SYMBOL[card.suit];
    var rank = RANK_SYMBOL[card.rank];
    var label = rank + ' of ' + card.suit;
    return (
      '<div class="card card-face ' + color + '" aria-label="' + label + '">' +
      '<div class="corner top">' +
      '<span class="rank">' + rank + '</span>' +
      '<span class="suit">' + sym + '</span>' +
      '</div>' +
      '<div class="pip-center">' + sym + '</div>' +
      '<div class="corner bottom">' +
      '<span class="rank">' + rank + '</span>' +
      '<span class="suit">' + sym + '</span>' +
      '</div>' +
      '</div>'
    );
  }

  global.Cards = {
    makeDeck: makeDeck,
    shuffle: shuffle,
    cardHTML: cardHTML,
    SUIT_SYMBOL: SUIT_SYMBOL,
    RANK_SYMBOL: RANK_SYMBOL,
  };
})(typeof window !== 'undefined' ? window : this);
