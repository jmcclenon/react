/*
 * UI controller: builds the table, renders game state, and wires the
 * action buttons to the engine.
 */
(function () {
  'use strict';

  var STARTING_BANKROLL = 1000;
  var AI_STACK = 1000;
  var BANKROLL_KEY = 'fiveCardStud.bankroll';

  var SEATS = ['You', 'Ava', 'Boone', 'Cleo'];

  function loadBankroll() {
    try {
      var v = parseInt(localStorage.getItem(BANKROLL_KEY), 10);
      if (!isNaN(v) && v > 0) return v;
    } catch (e) {}
    return STARTING_BANKROLL;
  }

  function saveBankroll(v) {
    try { localStorage.setItem(BANKROLL_KEY, String(v)); } catch (e) {}
  }

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var game = null;
  var handInProgress = false;
  var revealAll = false;

  // ---- Table construction --------------------------------------------------

  function buildSeats() {
    var container = $('#table');
    container.innerHTML =
      '<div class="pot-display"><span class="pot-label">POT</span>' +
      '<span id="pot-amount">0</span></div>' +
      '<div class="felt-logo">FIVE&nbsp;CARD&nbsp;STUD</div>';

    SEATS.forEach(function (name, i) {
      var seat = document.createElement('div');
      seat.className = 'seat seat-' + i + (i === 0 ? ' seat-human' : '');
      seat.id = 'seat-' + i;
      seat.innerHTML =
        '<div class="seat-info">' +
        '<span class="seat-name">' + name + '</span>' +
        '<span class="seat-chips" id="chips-' + i + '">0</span>' +
        '</div>' +
        '<div class="cards-row" id="cards-' + i + '"></div>' +
        '<div class="seat-status" id="status-' + i + '"></div>' +
        '<div class="hand-label" id="handlabel-' + i + '"></div>';
      container.appendChild(seat);
    });
  }

  // ---- Rendering -----------------------------------------------------------

  function render(state) {
    $('#pot-amount').textContent = state.pot;

    state.players.forEach(function (p, i) {
      $('#chips-' + i).textContent = '$' + p.chips;

      // Cards. The hole card is only shown face-up to its owner (you), or to
      // everyone at showdown (revealAll). Up cards are always face-up.
      var row = $('#cards-' + i);
      var html = '';
      if (p.hole) {
        var holeFaceUp = p.isHuman || revealAll;
        html += Cards.cardHTML(p.hole, holeFaceUp);
      }
      (p.up || []).forEach(function (c) { html += Cards.cardHTML(c, true); });
      row.innerHTML = html;

      // Seat visual state
      var seat = $('#seat-' + i);
      seat.classList.toggle('folded', !!p.folded);
      seat.classList.toggle('active-turn', !!p.isTurn);
      seat.classList.toggle('is-dealer', !!p.isDealer);

      // Status line
      var status = $('#status-' + i);
      var bits = [];
      if (p.isDealer) bits.push('<span class="badge dealer">D</span>');
      if (p.folded) bits.push('<span class="badge fold">Folded</span>');
      else if (p.allIn) bits.push('<span class="badge allin">All-In</span>');
      else if (p.roundBet > 0) bits.push('<span class="badge bet">$' + p.roundBet + '</span>');
      if (p.lastAction && !p.folded) bits.push('<span class="last-action">' + p.lastAction + '</span>');
      status.innerHTML = bits.join(' ');

      $('#handlabel-' + i).textContent = (revealAll || p.isHuman) && p.handLabel ? p.handLabel : '';
    });
  }

  // ---- Message log ---------------------------------------------------------

  function logMessage(text, kind) {
    var log = $('#log');
    var line = document.createElement('div');
    line.className = 'log-line log-' + (kind || 'info');
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 60) log.removeChild(log.firstChild);
  }

  // ---- Action controls -----------------------------------------------------

  function showActions(idx, opts) {
    var bar = $('#action-bar');
    bar.classList.add('visible');
    bar.innerHTML = '';

    function btn(label, action, cls) {
      var b = document.createElement('button');
      b.className = 'action-btn ' + (cls || '');
      b.textContent = label;
      b.onclick = function () {
        hideActions();
        game.humanAction(action);
      };
      bar.appendChild(b);
    }

    btn('Fold', 'fold', 'btn-fold');
    if (opts.canCheck) btn('Check', 'check', 'btn-check');
    if (opts.canCall) btn('Call $' + opts.toCall, 'call', 'btn-call');
    if (opts.canBet) btn('Bet $' + opts.betSize, 'bet', 'btn-bet');
    if (opts.canRaise) btn('Raise to $' + (state_currentBet() + opts.betSize), 'raise', 'btn-raise');
  }

  var _lastState = null;
  function state_currentBet() {
    return _lastState ? _lastState.currentBet : 0;
  }

  function hideActions() {
    var bar = $('#action-bar');
    bar.classList.remove('visible');
    bar.innerHTML = '';
  }

  // ---- Bankroll / lifecycle ------------------------------------------------

  function refreshBankrollUI() {
    var human = game.players[0];
    $('#bankroll').textContent = '$' + human.chips;
    saveBankroll(human.chips);
  }

  function newHand() {
    if (handInProgress) return;
    // Rebuy any broke AI so the table stays full.
    game.players.forEach(function (p, i) {
      if (!p.isHuman && p.chips <= 0) {
        p.chips = AI_STACK;
        logMessage(p.name + ' buys back in for $' + AI_STACK + '.', 'info');
      }
    });

    if (game.players[0].chips <= 0) {
      $('#broke-modal').classList.add('visible');
      return;
    }

    revealAll = false;
    handInProgress = true;
    $('#deal-btn').disabled = true;
    hideActions();
    game.startHand();
  }

  function onHandEnd() {
    handInProgress = false;
    $('#deal-btn').disabled = false;
    refreshBankrollUI();
  }

  // ---- Boot ----------------------------------------------------------------

  function init() {
    buildSeats();

    var bankroll = loadBankroll();

    var players = SEATS.map(function (name, i) {
      return {
        name: name,
        isHuman: i === 0,
        chips: i === 0 ? bankroll : AI_STACK,
      };
    });

    game = new Game({
      players: players,
      callbacks: {
        update: function (state) {
          _lastState = state;
          render(state);
        },
        message: function (text, kind) { logMessage(text, kind); },
        awaitAction: function (idx, opts) { showActions(idx, opts); },
        reveal: function () { revealAll = true; render(game.snapshot()); },
        handEnd: function () { onHandEnd(); },
        needRebuy: function () {
          handInProgress = false;
          $('#deal-btn').disabled = false;
        },
      },
    });

    render(game.snapshot());
    refreshBankrollUI();

    $('#deal-btn').addEventListener('click', newHand);

    $('#rebuy-btn').addEventListener('click', function () {
      game.players[0].chips += STARTING_BANKROLL;
      $('#broke-modal').classList.remove('visible');
      refreshBankrollUI();
      logMessage('You bought in for another $' + STARTING_BANKROLL + '.', 'info');
    });

    $('#reset-btn').addEventListener('click', function () {
      if (!confirm('Reset your bankroll to $' + STARTING_BANKROLL + '?')) return;
      game.players[0].chips = STARTING_BANKROLL;
      saveBankroll(STARTING_BANKROLL);
      refreshBankrollUI();
      logMessage('Bankroll reset to $' + STARTING_BANKROLL + '.', 'info');
    });

    logMessage('Welcome to Five Card Stud. Press DEAL to start a hand.', 'info');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
