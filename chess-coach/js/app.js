/*
 * app.js — Application controller.
 *
 * Wires the engine, AI, and coach into a playable, teaching chess UI:
 *   - Board rendering & click/tap-to-move with legal-move hints and promotion.
 *   - AI opponent across six difficulty levels (Beginner … Grandmaster).
 *   - Optional chess clocks with increment.
 *   - Move history (SAN) with click-to-review navigation and PGN export.
 *   - Live analysis: evaluation bar, best lines, and per-move quality labels.
 *   - Coaching: opening recognition, strategic ideas, and principle-based tips.
 */
(function () {
  'use strict';

  var Chess = window.Chess;
  var ChessAI = window.ChessAI;
  var ChessCoach = window.ChessCoach;

  var GLYPH = {
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  };

  // ---- Application state -------------------------------------------------
  var state = {
    game: new Chess(),
    humanColor: 'w',
    orientation: 'w', // which color is at the bottom
    viewPly: 0, // which position index is being viewed
    positions: [], // fen after each ply; positions[0] = start
    records: [], // move records with quality metadata
    coach: new ChessCoach(),
    aiThinking: false,
    gameOver: false,
    selected: null, // selected square index
    legalForSelected: [], // move objects from selected square
    lastMove: null, // {from, to}
    hint: null, // {from, to}
    // analysis
    analysisEnabled: true,
    coachEnabled: true,
    showHints: true,
    lastEvalWhite: 0,
    preMoveAnalysis: null,
    // clocks
    clockEnabled: false,
    clockMs: {w: 0, b: 0},
    increment: 0,
    baseMinutes: 10,
    clockTimer: null,
    clockActive: null,
    lastTick: 0,
    // rating
    assistedThisGame: false, // coach/analysis/hint used → game is Casual (unrated)
    resultApplied: false, // guard so a game updates the rating only once
    // opponent / analysis engines
    ai: new ChessAI(), // the opponent (carries a persona + style)
    analyzer: new ChessAI(), // objective engine for eval bar / hints / grading
    // tournament
    match: null, // {format, needWins, games:[], you, opp, gameNo, persona, humanColorGame1, over, matchWinner}
    // replay
    reviewMode: false, // true when viewing a loaded/saved game (no live play)
  };

  // Persistent player rating profile (Elo-style). Only "uncoached" games count.
  var STARTING_RATING = 1000;
  var RATING_KEY = 'chessCoach.rating.v1';
  var profile = loadProfile();

  function loadProfile() {
    var def = {rating: STARTING_RATING, games: 0, wins: 0, losses: 0, draws: 0, rated: 0, history: []};
    try {
      var raw = localStorage.getItem(RATING_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        return {
          rating: typeof p.rating === 'number' ? p.rating : STARTING_RATING,
          games: p.games || 0,
          wins: p.wins || 0,
          losses: p.losses || 0,
          draws: p.draws || 0,
          rated: p.rated || 0,
          history: Array.isArray(p.history) ? p.history : [],
        };
      }
    } catch (e) {
      /* localStorage unavailable (e.g. some file:// contexts) — use defaults */
    }
    return def;
  }

  function saveProfile() {
    try {
      localStorage.setItem(RATING_KEY, JSON.stringify(profile));
    } catch (e) {
      /* ignore persistence failures */
    }
  }

  // Persistent store of finished/saved games (PGN + metadata) for replay.
  var GAMES_KEY = 'chessCoach.games.v1';
  var MAX_SAVED_GAMES = 60;
  var savedGames = loadGames();

  function loadGames() {
    try {
      var raw = localStorage.getItem(GAMES_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) {
      /* ignore */
    }
    return [];
  }

  function persistGames() {
    try {
      localStorage.setItem(GAMES_KEY, JSON.stringify(savedGames.slice(0, MAX_SAVED_GAMES)));
    } catch (e) {
      /* ignore */
    }
  }

  // A game counts toward the rating only if it was played without assistance:
  // Coach mode off, Live analysis off, and no Hint used during the game.
  function isRatedGame() {
    return !state.assistedThisGame && !state.coachEnabled && !state.analysisEnabled;
  }

  // Flag the current game as assisted (Casual). Called when the player turns on
  // the coach/analysis or asks for a hint.
  function markAssisted() {
    if (!state.assistedThisGame) {
      state.assistedThisGame = true;
      updateRatedBadge();
    }
  }

  function expectedScore(playerElo, oppElo) {
    return 1 / (1 + Math.pow(10, (oppElo - playerElo) / 400));
  }

  // Update the Rated/Casual badge to reflect the live game state.
  function updateRatedBadge() {
    var badge = $('ratedBadge');
    if (state.reviewMode) {
      badge.className = 'rated-badge casual';
      badge.textContent = 'Reviewing a saved game';
      return;
    }
    if (isRatedGame()) {
      badge.className = 'rated-badge rated';
      badge.textContent = 'Rated game — vs ' + aiName() + ' (~' + state.ai.level.elo + ')';
    } else {
      badge.className = 'rated-badge casual';
      var reason = state.coachEnabled
        ? 'Coach on'
        : state.analysisEnabled
        ? 'Analysis on'
        : state.assistedThisGame
        ? 'Hint used'
        : 'assisted';
      badge.textContent = 'Casual game (' + reason + ') — rating unchanged';
    }
  }

  function renderRating(deltaHtml) {
    $('ratingValue').textContent = profile.rating;
    var rec = profile.wins + 'W · ' + profile.losses + 'L · ' + profile.draws + 'D';
    $('ratingRecord').textContent = rec + '  (' + profile.games + ' games)';
    var sub = profile.rated < 10 ? 'Provisional — ' + profile.rated + ' rated games' : profile.rated + ' rated games';
    $('ratingSub').innerHTML = deltaHtml ? sub + '  ' + deltaHtml : sub;
    updateRatedBadge();
    renderRatingChart();
  }

  // A compact single-series rating-over-time line chart, drawn as inline SVG so
  // it inherits the app's theme tokens. Starts from the baseline rating and
  // plots the rating after each rated game; hovering shows that game's detail.
  function renderRatingChart() {
    var host = $('ratingChart');
    if (!host) return;
    var ratings = [STARTING_RATING];
    profile.history.forEach(function (h) { ratings.push(h.r); });

    if (ratings.length < 2) {
      host.innerHTML = '<div class="chart-empty">Play a rated game (Coach &amp; Analysis off) to start tracking your rating.</div>';
      return;
    }

    var W = Math.max(180, host.clientWidth || 240);
    var H = 110;
    var padL = 30, padR = 8, padT = 10, padB = 16;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var min = Math.min.apply(null, ratings);
    var max = Math.max.apply(null, ratings);
    if (max - min < 40) { var mid = (max + min) / 2; min = mid - 20; max = mid + 20; }
    var pad = (max - min) * 0.12;
    min -= pad; max += pad;

    var n = ratings.length;
    function xAt(i) { return padL + (n === 1 ? 0 : (i / (n - 1)) * plotW); }
    function yAt(v) { return padT + (1 - (v - min) / (max - min)) * plotH; }

    var accent = getVar('--accent') || '#7ca5ff';
    var muted = getVar('--muted') || '#9aa1ad';
    var border = getVar('--border') || '#3a3f49';

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Rating history line chart">';
    // gridlines: min, mid, max
    [min, (min + max) / 2, max].forEach(function (gv) {
      var y = yAt(gv);
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="' + border + '" stroke-width="1" opacity="0.5"/>';
      svg += '<text x="' + (padL - 5) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="' + muted + '">' + Math.round(gv) + '</text>';
    });
    // area + line path
    var d = '', area = 'M ' + xAt(0).toFixed(1) + ' ' + yAt(ratings[0]).toFixed(1);
    ratings.forEach(function (v, i) {
      var cmd = (i === 0 ? 'M' : 'L') + ' ' + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1);
      d += (i === 0 ? '' : ' ') + cmd;
      if (i > 0) area += ' L ' + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1);
    });
    area += ' L ' + xAt(n - 1).toFixed(1) + ' ' + (padT + plotH).toFixed(1) + ' L ' + xAt(0).toFixed(1) + ' ' + (padT + plotH).toFixed(1) + ' Z';
    svg += '<path d="' + area + '" fill="' + accent + '" opacity="0.12"/>';
    svg += '<path d="' + d + '" fill="none" stroke="' + accent + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    // emphasized endpoint
    svg += '<circle cx="' + xAt(n - 1).toFixed(1) + '" cy="' + yAt(ratings[n - 1]).toFixed(1) + '" r="3.5" fill="' + accent + '"/>';
    // invisible hover targets
    ratings.forEach(function (v, i) {
      svg += '<circle class="rc-pt" data-i="' + i + '" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(v).toFixed(1) + '" r="8" fill="transparent"/>';
    });
    svg += '</svg>';

    host.innerHTML = svg + '<div class="rc-tooltip" id="rcTip"></div>';

    // hover tooltip
    var pts = host.querySelectorAll('.rc-pt');
    var tip = $('rcTip');
    pts.forEach(function (pt) {
      pt.addEventListener('mouseenter', function () {
        var i = parseInt(pt.getAttribute('data-i'), 10);
        var scaleX = host.clientWidth / W;
        var cx = parseFloat(pt.getAttribute('cx')) * scaleX;
        var cy = parseFloat(pt.getAttribute('cy')) * (110 / H);
        var txt;
        if (i === 0) {
          txt = 'Start · ' + ratings[0];
        } else {
          var h = profile.history[i - 1];
          var resWord = h.res === 'win' ? 'W' : h.res === 'loss' ? 'L' : 'D';
          txt = 'Game ' + i + ' · ' + h.r + ' (' + resWord + ' vs ' + h.opp + ')';
        }
        tip.textContent = txt;
        tip.style.left = cx + 'px';
        tip.style.top = cy + 'px';
        tip.style.opacity = '1';
      });
      pt.addEventListener('mouseleave', function () { tip.style.opacity = '0'; });
    });
  }

  function getVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Apply a finished game's result (from the human's perspective) to the rating
  // profile. Runs at most once per game. Only uncoached games change the rating.
  function applyGameResult(humanResult) {
    if (state.resultApplied) return;
    if (state.records.length === 0) return; // ignore games with no moves played
    state.resultApplied = true;

    profile.games++;
    if (humanResult === 'win') profile.wins++;
    else if (humanResult === 'loss') profile.losses++;
    else profile.draws++;

    if (isRatedGame()) {
      var oppElo = state.ai.level.elo;
      var actual = humanResult === 'win' ? 1 : humanResult === 'draw' ? 0.5 : 0;
      var expected = expectedScore(profile.rating, oppElo);
      var k = profile.rated < 10 ? 40 : 24; // faster convergence while provisional
      var delta = Math.round(k * (actual - expected));
      profile.rating += delta;
      profile.rated++;
      profile.history.push({r: profile.rating, t: Date.now(), opp: aiName(), oppElo: oppElo, res: humanResult});
      if (profile.history.length > 200) profile.history.shift();
      saveProfile();
      var cls = delta >= 0 ? 'up' : 'down';
      var sign = delta >= 0 ? '+' : '';
      var deltaHtml = '<span class="rating-delta ' + cls + '">' + sign + delta + '</span>';
      renderRating(deltaHtml);
      addCoachMessage(
        delta >= 0 ? 'good' : 'warn',
        'Rating updated',
        'Rated game vs ' + aiName() + ' (~' + oppElo + '): ' + sign + delta +
          ' → your rating is now ' + profile.rating + '.'
      );
    } else {
      saveProfile();
      renderRating();
    }

    // Auto-save the finished game for later replay.
    autoSaveFinishedGame(humanResult);

    // Advance the tournament match, if one is in progress.
    if (state.match && !state.match.over) recordMatchResult(humanResult);
  }

  function resetRating() {
    profile = {rating: STARTING_RATING, games: 0, wins: 0, losses: 0, draws: 0, rated: 0, history: []};
    saveProfile();
    renderRating();
  }

  // ---- DOM refs ---------------------------------------------------------
  var $ = function (id) {
    return document.getElementById(id);
  };
  var boardEl = $('board');
  var statusEl = $('status');
  var els = {};

  // ---- Init -------------------------------------------------------------
  function init() {
    populateOpponents();
    buildBoardCells();
    bindControls();
    renderRating();
    renderSavedGames();
    newGame();
  }

  // Build the opponent picker, grouped into one <optgroup> per ELO band, each
  // listing the named personalities (styles) available at that strength.
  function populateOpponents() {
    var sel = $('opponent');
    sel.innerHTML = '';
    ChessAI.LEVELS.forEach(function (lvl, li) {
      var group = document.createElement('optgroup');
      group.label = lvl.name + '  (~' + lvl.elo + ')';
      ChessAI.ROSTER.forEach(function (persona, pi) {
        if (persona.level !== li) return;
        var opt = document.createElement('option');
        opt.value = pi;
        var style = ChessAI.STYLES[persona.style];
        opt.textContent = persona.name + ' — ' + style.label;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    });
    sel.value = 0;
    state.ai.setPersona(ChessAI.ROSTER[0]);
    updateLevelMeta();
    renderScouting();
  }

  function currentPersonaIndex() {
    return parseInt($('opponent').value, 10) || 0;
  }

  function updateLevelMeta() {
    var lvl = state.ai.level;
    var style = state.ai.style || ChessAI.STYLES.balanced;
    var strength = {
      Beginner: 'plays fast and blunders often',
      Casual: 'thinks a little, still slips up',
      Intermediate: 'solid tactics, a few moves deep',
      Advanced: 'rarely blunders',
      Expert: 'deep, accurate calculation',
      Grandmaster: 'maximum depth — a serious fight',
    };
    $('levelMeta').innerHTML =
      '<strong>' + (state.ai.displayName || lvl.name) + '</strong> · ~' + lvl.elo +
      ' · ' + style.label + '<br>' + style.blurb + ' (' + (strength[lvl.name] || '') + ')';
  }

  // Display name for the current opponent (persona name, else level name).
  function aiName() {
    return state.ai.displayName || state.ai.level.name;
  }

  // Render the scouting dossier for the currently selected opponent: strength,
  // style, opening book (as White and Black), offense, defense, and a "tell"
  // for how to play against them.
  function renderScouting() {
    var host = $('scoutingReport');
    if (!host) return;
    var lvl = state.ai.level;
    var style = state.ai.style || ChessAI.STYLES.balanced;
    var prof = ChessAI.STYLE_PROFILE[style.key] || ChessAI.STYLE_PROFILE.balanced;
    var think = lvl.maxDepth + (lvl.maxDepth === 1 ? ' ply' : ' plies') +
      ' · ~' + (lvl.timeMs / 1000) + 's/move' + (lvl.quiescence ? ' · quiescence' : '');

    host.innerHTML =
      '<div class="sc-head">' +
        '<span class="sc-name">' + aiName() + '</span>' +
        '<span class="sc-elo">~' + lvl.elo + ' Elo</span>' +
      '</div>' +
      '<span class="sc-style">' + style.label + '</span>' +
      '<div class="sc-blurb">' + style.blurb + '</div>' +
      '<dl>' +
        '<dt>Opening (W)</dt><dd>' + prof.openingWhite + '</dd>' +
        '<dt>Opening (B)</dt><dd>' + prof.openingBlack + '</dd>' +
        '<dt>Offense</dt><dd>' + prof.offense + '</dd>' +
        '<dt>Defense</dt><dd>' + prof.defense + '</dd>' +
        '<dt>Search</dt><dd>' + think + '</dd>' +
      '</dl>' +
      '<div class="sc-tell"><strong>How to beat it:</strong> ' + prof.weakness + '</div>';
  }

  // Build 64 square cells once; we update contents on render.
  function buildBoardCells() {
    boardEl.innerHTML = '';
    els.cells = [];
    for (var i = 0; i < 64; i++) {
      var cell = document.createElement('div');
      cell.className = 'square';
      cell.dataset.index = i;
      cell.addEventListener('click', onSquareClick);
      boardEl.appendChild(cell);
      els.cells.push(cell);
    }
  }

  function bindControls() {
    $('newGame').addEventListener('click', newGame);
    $('resign').addEventListener('click', resign);
    $('flipBoard').addEventListener('click', function () {
      state.orientation = state.orientation === 'w' ? 'b' : 'w';
      render();
    });
    $('hintBtn').addEventListener('click', showHint);
    $('opponent').addEventListener('change', function () {
      state.ai.setPersona(ChessAI.ROSTER[currentPersonaIndex()]);
      updateLevelMeta();
      updateRatedBadge();
      renderScouting();
    });
    $('side').addEventListener('change', function () {});
    $('clockEnabled').addEventListener('change', function () {
      state.clockEnabled = this.checked;
    });
    $('coachEnabled').addEventListener('change', function () {
      state.coachEnabled = this.checked;
      if (this.checked) markAssisted(); // enabling coaching makes the game Casual
      renderCoach();
      updateRatedBadge();
    });
    $('analysisEnabled').addEventListener('change', function () {
      state.analysisEnabled = this.checked;
      if (state.analysisEnabled) {
        markAssisted(); // enabling analysis makes the game Casual
        runAnalysis();
      } else {
        $('analysisStatus').classList.remove('hidden');
        $('analysisLines').innerHTML = '';
        setEvalBar(0, false);
      }
      updateRatedBadge();
    });
    $('showHints').addEventListener('change', function () {
      state.showHints = this.checked;
      render();
    });
    $('resetRating').addEventListener('click', function () {
      resetRating();
    });
    $('nextGame').addEventListener('click', startNextMatchGame);
    $('saveGame').addEventListener('click', saveCurrentGame);
    $('undoMove').addEventListener('click', undoMove);
    $('copyPgn').addEventListener('click', copyPgn);
    window.addEventListener('resize', debounce(renderRatingChart, 200));
    $('navStart').addEventListener('click', function () { navTo(0); });
    $('navPrev').addEventListener('click', function () { navTo(state.viewPly - 1); });
    $('navNext').addEventListener('click', function () { navTo(state.viewPly + 1); });
    $('navEnd').addEventListener('click', function () { navTo(state.records.length); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') navTo(state.viewPly - 1);
      else if (e.key === 'ArrowRight') navTo(state.viewPly + 1);
    });
  }

  // ---- New game ---------------------------------------------------------
  // Read the setup form, configure the opponent and (optionally) a match, then
  // begin the first game.
  function newGame() {
    exitReview(true); // leaving any saved-game review
    state.ai.setPersona(ChessAI.ROSTER[currentPersonaIndex()]);
    updateLevelMeta();
    renderScouting();

    // Persist the game-wide settings (they carry across a match's games).
    state.clockEnabled = $('clockEnabled').checked;
    state.baseMinutes = clampNum($('clockMinutes').value, 1, 180, 10);
    state.increment = clampNum($('clockIncrement').value, 0, 60, 0);
    state.coachEnabled = $('coachEnabled').checked;
    state.analysisEnabled = $('analysisEnabled').checked;
    state.showHints = $('showHints').checked;

    var format = parseInt($('matchFormat').value, 10) || 1;
    var chosenColor = $('side').value;
    if (format > 1) {
      setupMatch(format, chosenColor);
    } else {
      state.match = null;
    }
    renderMatch();

    beginGame(chosenColor);
  }

  // Reset the board and start a single game with the human on `humanColor`.
  // Assumes the opponent persona and game settings are already configured.
  function beginGame(humanColor) {
    stopClock();
    state.reviewMode = false;
    state.humanColor = humanColor;
    state.orientation = humanColor;
    state.game = new Chess();
    state.positions = [state.game.fen()];
    state.records = [];
    state.viewPly = 0;
    state.selected = null;
    state.legalForSelected = [];
    state.lastMove = null;
    state.hint = null;
    state.gameOver = false;
    state.aiThinking = false;
    state.lastEvalWhite = 0;
    state.preMoveAnalysis = null;
    state.assistedThisGame = false;
    state.resultApplied = false;
    coachLog.length = 0;

    state.clockMs = {
      w: state.baseMinutes * 60000,
      b: state.baseMinutes * 60000,
    };

    setStatus('');
    renderReviewBanner();
    render();
    renderCoach();
    renderRating();
    runAnalysis();

    if (state.clockEnabled) startClock('w');

    // If the human is Black, the engine (White) moves first.
    if (state.humanColor === 'b') {
      scheduleAiMove();
    }
  }

  function clampNum(v, lo, hi, def) {
    v = parseInt(v, 10);
    if (isNaN(v)) return def;
    return Math.max(lo, Math.min(hi, v));
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function resign() {
    if (state.gameOver || state.reviewMode) return;
    state.gameOver = true;
    stopClock();
    setStatus('You resigned. ' + (state.humanColor === 'w' ? 'Black' : 'White') + ' wins.');
    addCoachMessage('warn', 'Game over', 'You resigned. Review the moves with the arrows below to see where it went wrong — then start a new game and try again!');
    applyGameResult('loss');
  }

  // ---- Tournament / match ----------------------------------------------
  function setupMatch(format, humanColorGame1) {
    state.match = {
      format: format,
      needWins: Math.floor(format / 2) + 1,
      games: [], // {res:'win'|'loss'|'draw'} per game
      you: 0, // points (win 1, draw 0.5)
      opp: 0,
      gameNo: 1,
      persona: state.ai.persona,
      humanColorGame1: humanColorGame1,
      over: false,
      matchWinner: null,
    };
  }

  // Record a finished game's result into the active match and either declare a
  // match winner or offer the next game.
  function recordMatchResult(humanResult) {
    var m = state.match;
    m.games.push({res: humanResult});
    if (humanResult === 'win') m.you += 1;
    else if (humanResult === 'loss') m.opp += 1;
    else { m.you += 0.5; m.opp += 0.5; }

    if (m.you >= m.needWins || m.opp >= m.needWins) {
      m.over = true;
      m.matchWinner = m.you > m.opp ? 'you' : m.opp > m.you ? 'opp' : 'tie';
      var msg = m.matchWinner === 'you'
        ? 'You won the match ' + fmtScore(m.you) + '–' + fmtScore(m.opp) + '! 🏆'
        : m.matchWinner === 'opp'
        ? 'You lost the match ' + fmtScore(m.you) + '–' + fmtScore(m.opp) + '.'
        : 'The match ended tied ' + fmtScore(m.you) + '–' + fmtScore(m.opp) + '.';
      addCoachMessage(m.matchWinner === 'you' ? 'good' : 'warn', 'Match over', msg);
    }
    renderMatch();
  }

  function startNextMatchGame() {
    var m = state.match;
    if (!m || m.over) return;
    m.gameNo += 1;
    // Alternate colors each game for fairness.
    var color = m.gameNo % 2 === 1 ? m.humanColorGame1 : (m.humanColorGame1 === 'w' ? 'b' : 'w');
    renderMatch();
    beginGame(color);
  }

  function fmtScore(x) {
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  }

  function renderMatch() {
    var box = $('matchStatus');
    var m = state.match;
    if (!m) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    $('matchLabel').textContent = 'Best of ' + m.format + (m.persona ? ' · ' + m.persona.name : '');
    $('matchYou').textContent = 'You ' + fmtScore(m.you);
    $('matchOpp').textContent = aiName() + ' ' + fmtScore(m.opp);

    var dots = $('matchDots');
    dots.innerHTML = '';
    for (var i = 0; i < m.format; i++) {
      var d = document.createElement('span');
      d.className = 'match-dot';
      var g = m.games[i];
      if (g) {
        d.classList.add(g.res);
        d.textContent = g.res === 'win' ? 'W' : g.res === 'loss' ? 'L' : '½';
      } else {
        d.textContent = i + 1;
      }
      dots.appendChild(d);
    }

    var resultEl = $('matchResult');
    var nextBtn = $('nextGame');
    if (m.over) {
      resultEl.className = 'match-result ' + (m.matchWinner === 'you' ? 'win' : m.matchWinner === 'opp' ? 'loss' : '');
      resultEl.textContent = m.matchWinner === 'you' ? 'Match won 🏆' : m.matchWinner === 'opp' ? 'Match lost' : 'Match tied';
      nextBtn.classList.add('hidden');
    } else {
      resultEl.textContent = 'Game ' + m.gameNo + ' of up to ' + m.format;
      resultEl.className = 'match-result';
      // Offer "Next game" only once the current game has finished.
      nextBtn.classList.toggle('hidden', !(state.gameOver && !m.over));
    }
  }

  // ---- Saved games (save / reload / replay) -----------------------------
  function serializeCurrentGame(humanResult) {
    var sans = state.records.map(function (r) { return r.san; });
    return {
      id: 'g' + Date.now() + Math.floor(Math.random() * 1000),
      date: Date.now(),
      opponent: aiName(),
      oppElo: state.ai.level.elo,
      style: state.ai.style ? state.ai.style.label : '',
      humanColor: state.humanColor,
      result: humanResult || 'unfinished',
      rated: isRatedGame(),
      status: statusEl.textContent,
      sans: sans,
    };
  }

  function autoSaveFinishedGame(humanResult) {
    if (state.records.length === 0) return;
    savedGames.unshift(serializeCurrentGame(humanResult));
    if (savedGames.length > MAX_SAVED_GAMES) savedGames.length = MAX_SAVED_GAMES;
    persistGames();
    renderSavedGames();
  }

  function saveCurrentGame() {
    if (state.reviewMode) return;
    if (state.records.length === 0) {
      setStatus('Nothing to save yet — play a move first.');
      return;
    }
    var humanResult = state.gameOver ? inferHumanResult() : null;
    savedGames.unshift(serializeCurrentGame(humanResult));
    if (savedGames.length > MAX_SAVED_GAMES) savedGames.length = MAX_SAVED_GAMES;
    persistGames();
    renderSavedGames();
    setStatus('Game saved. Find it under Saved Games.');
  }

  function inferHumanResult() {
    var g = state.game;
    if (g.isCheckmate()) {
      var winner = g.turn === 'w' ? 'b' : 'w';
      return winner === state.humanColor ? 'win' : 'loss';
    }
    if (g.isStalemate() || g.isDraw()) return 'draw';
    return 'unfinished';
  }

  function renderSavedGames() {
    var host = $('savedGamesList');
    if (savedGames.length === 0) {
      host.innerHTML = '<div class="saved-empty">No saved games yet. Finished games are saved automatically, or use <strong>Save Game</strong>.</div>';
      return;
    }
    host.innerHTML = '';
    savedGames.forEach(function (game) {
      var card = document.createElement('div');
      card.className = 'saved-game';

      var top = document.createElement('div');
      top.className = 'sg-top';
      var title = document.createElement('span');
      title.className = 'sg-title';
      title.textContent = 'vs ' + game.opponent;
      var res = document.createElement('span');
      var rk = game.result === 'win' ? 'win' : game.result === 'loss' ? 'loss' : game.result === 'draw' ? 'draw' : '';
      res.className = 'sg-result ' + rk;
      res.textContent = game.result === 'win' ? 'Win' : game.result === 'loss' ? 'Loss' : game.result === 'draw' ? 'Draw' : '—';
      top.appendChild(title);
      top.appendChild(res);

      var meta = document.createElement('div');
      meta.className = 'sg-meta';
      var d = new Date(game.date);
      meta.textContent = (game.rated ? 'Rated · ' : 'Casual · ') + game.sans.length + ' plies · ' +
        d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

      var actions = document.createElement('div');
      actions.className = 'sg-actions';
      var replay = document.createElement('button');
      replay.className = 'btn';
      replay.textContent = 'Replay';
      replay.addEventListener('click', function () { loadSavedGame(game.id); });
      var del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'Delete';
      del.addEventListener('click', function () { deleteSavedGame(game.id); });
      actions.appendChild(replay);
      actions.appendChild(del);

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function deleteSavedGame(id) {
    savedGames = savedGames.filter(function (g) { return g.id !== id; });
    persistGames();
    renderSavedGames();
  }

  // Rebuild a saved game and enter read-only review mode (step through moves).
  function loadSavedGame(id) {
    var game = savedGames.find(function (g) { return g.id === id; });
    if (!game) return;
    stopClock();
    var g = new Chess();
    var positions = [g.fen()];
    var records = [];
    for (var i = 0; i < game.sans.length; i++) {
      var r = g.move(game.sans[i]);
      if (!r) break; // corrupt entry — stop where it fails
      records.push(r);
      positions.push(g.fen());
    }
    state.reviewMode = true;
    state.gameOver = true;
    state.aiThinking = false;
    state.match = null;
    renderMatch();
    state.game = g;
    state.positions = positions;
    state.records = records;
    state.humanColor = game.humanColor;
    state.orientation = game.humanColor;
    state.viewPly = 0;
    state.selected = null;
    state.legalForSelected = [];
    state.lastMove = null;
    state.hint = null;
    coachLog.length = 0;

    setStatus('Reviewing: vs ' + game.opponent + ' — ' + (game.status || ''));
    renderReviewBanner(game);
    render();
    renderCoach();
    updateRatedBadge();
    navTo(0);
  }

  function renderReviewBanner(game) {
    var main = document.querySelector('main.board-area');
    var existing = $('reviewBanner');
    if (!state.reviewMode) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'reviewBanner';
      existing.className = 'review-banner';
      main.insertBefore(existing, main.firstChild);
    }
    existing.innerHTML = '<span>Reviewing a saved game — use ◀ ▶ to step through moves.</span>';
    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Exit review';
    btn.addEventListener('click', function () { newGame(); });
    existing.appendChild(btn);
  }

  function exitReview(silent) {
    if (state.reviewMode) {
      state.reviewMode = false;
      renderReviewBanner();
      if (!silent) render();
    }
  }

  // ---- Rendering --------------------------------------------------------
  function boardAtView() {
    // Returns a Chess positioned at the currently viewed ply.
    return new Chess(state.positions[state.viewPly]);
  }

  function render() {
    var pos = boardAtView();
    var board = pos.board;
    var flip = state.orientation === 'b';
    var checkSq = -1;
    if (pos.isCheck(pos.turn)) checkSq = pos.kingIndex(pos.turn);

    // Determine last move squares for the viewed ply.
    var lm = null;
    if (state.viewPly > 0) {
      var rec = state.records[state.viewPly - 1];
      lm = {from: Chess.squareToIndex(rec.from), to: Chess.squareToIndex(rec.to)};
    }

    for (var visual = 0; visual < 64; visual++) {
      var idx = flip ? 63 - visual : visual;
      var cell = els.cells[visual];
      var r = Chess.rankOf(idx);
      var f = Chess.fileOf(idx);
      var isLight = (r + f) % 2 === 0;
      cell.className = 'square ' + (isLight ? 'light' : 'dark');
      cell.dataset.index = idx;

      // coordinates
      cell.innerHTML = '';
      var piece = board[idx];
      if (piece) {
        var span = document.createElement('span');
        span.className = 'piece';
        span.textContent = GLYPH[Chess.typeOf(piece)];
        if (Chess.colorOf(piece) === 'w') {
          span.style.color = '#fff';
          span.style.textShadow = '0 0 1px #000, 0 1px 2px rgba(0,0,0,.5)';
        } else {
          span.style.color = '#1a1a1a';
          span.style.textShadow = '0 1px 1px rgba(255,255,255,.15)';
        }
        cell.appendChild(span);
      }

      // edge coordinates
      var lastRow = flip ? r === 0 : r === 7;
      var firstCol = flip ? f === 7 : f === 0;
      if (lastRow) {
        var fl = document.createElement('span');
        fl.className = 'coord file';
        fl.textContent = String.fromCharCode(97 + f);
        fl.style.color = isLight ? '#739552' : '#ebecd0';
        cell.appendChild(fl);
      }
      if (firstCol) {
        var rk = document.createElement('span');
        rk.className = 'coord rank';
        rk.textContent = 8 - r;
        rk.style.color = isLight ? '#739552' : '#ebecd0';
        cell.appendChild(rk);
      }

      if (lm && (idx === lm.from || idx === lm.to)) cell.classList.add('lastmove');
      if (idx === checkSq) cell.classList.add('check');
      if (state.selected === idx) cell.classList.add('selected');
      if (state.hint && (idx === state.hint.from || idx === state.hint.to)) {
        cell.classList.add(idx === state.hint.from ? 'hintfrom' : 'hintto');
      }
    }

    // legal move dots for selection (only at live view)
    if (state.selected !== null && state.showHints && isLiveView()) {
      state.legalForSelected.forEach(function (m) {
        var visual = flip ? 63 - m.to : m.to;
        var cell = els.cells[visual];
        cell.classList.add('move-target');
        if (m.captured) cell.classList.add('capture');
        var dot = document.createElement('span');
        dot.className = 'move-dot';
        cell.appendChild(dot);
      });
    }

    renderPlayerBars(pos);
    renderMoves();
    renderClocks();
  }

  function renderPlayerBars(pos) {
    var humanBottom = state.orientation === state.humanColor;
    var bottomColor = state.orientation;
    var topColor = bottomColor === 'w' ? 'b' : 'w';

    $('bottomDot').className = 'dot ' + (bottomColor === 'w' ? 'white' : 'black');
    $('topDot').className = 'dot ' + (topColor === 'w' ? 'white' : 'black');
    $('bottomName').textContent = bottomColor === state.humanColor ? 'You' : aiName();
    $('topName').textContent = topColor === state.humanColor ? 'You' : aiName();

    var caps = capturedPieces();
    // captured shown next to the capturer
    $('bottomCaptured').textContent = renderCaptured(caps, bottomColor);
    $('topCaptured').textContent = renderCaptured(caps, topColor);
  }

  function renderCaptured(caps, color) {
    // pieces this color has captured (i.e., opponent pieces removed)
    var opp = color === 'w' ? caps.byWhite : caps.byBlack;
    return opp
      .map(function (t) {
        return GLYPH[t];
      })
      .join('');
  }

  function capturedPieces() {
    // Count material difference by replaying to viewed ply.
    var start = {p: 8, n: 2, b: 2, r: 2, q: 1};
    var white = {p: 0, n: 0, b: 0, r: 0, q: 0};
    var black = {p: 0, n: 0, b: 0, r: 0, q: 0};
    var pos = boardAtView();
    for (var i = 0; i < 64; i++) {
      var p = pos.board[i];
      if (!p) continue;
      var t = Chess.typeOf(p);
      if (t === 'k') continue;
      if (Chess.colorOf(p) === 'w') white[t]++;
      else black[t]++;
    }
    var byWhite = []; // black pieces captured by white
    var byBlack = [];
    ['q', 'r', 'b', 'n', 'p'].forEach(function (t) {
      for (var i = 0; i < start[t] - black[t]; i++) byWhite.push(t);
      for (var j = 0; j < start[t] - white[t]; j++) byBlack.push(t);
    });
    return {byWhite: byWhite, byBlack: byBlack};
  }

  // ---- Interaction ------------------------------------------------------
  function isLiveView() {
    return state.viewPly === state.records.length;
  }

  function onSquareClick(e) {
    if (state.gameOver || state.aiThinking) return;
    if (!isLiveView()) {
      // jump to live before interacting
      navTo(state.records.length);
    }
    if (state.game.turn !== state.humanColor) return;

    var idx = parseInt(e.currentTarget.dataset.index, 10);
    var piece = state.game.board[idx];

    if (state.selected === null) {
      if (piece && Chess.colorOf(piece) === state.humanColor) {
        selectSquare(idx);
      }
      return;
    }

    // clicking the same square deselects
    if (idx === state.selected) {
      clearSelection();
      render();
      return;
    }

    // clicking another own piece reselects
    if (piece && Chess.colorOf(piece) === state.humanColor) {
      selectSquare(idx);
      return;
    }

    // attempt a move
    var target = state.legalForSelected.filter(function (m) {
      return m.to === idx;
    });
    if (target.length === 0) {
      clearSelection();
      render();
      return;
    }

    // promotion?
    var promos = target.filter(function (m) {
      return m.promotion;
    });
    if (promos.length > 0) {
      askPromotion(state.selected, idx, function (pieceType) {
        clearSelection();
        doHumanMove({from: idx0(promos), to: idx, promotion: pieceType});
      });
      return;
    }

    var from = state.selected;
    clearSelection();
    doHumanMove({from: from, to: idx});
  }

  function idx0(arr) {
    return arr[0].from;
  }

  function selectSquare(idx) {
    state.selected = idx;
    state.legalForSelected = state.game.generateLegalMoves().filter(function (m) {
      return m.from === idx;
    });
    state.hint = null;
    render();
  }

  function clearSelection() {
    state.selected = null;
    state.legalForSelected = [];
  }

  // ---- Making moves -----------------------------------------------------
  function doHumanMove(input) {
    var pre = state.preMoveAnalysis; // analysis of the position BEFORE this move
    var rec = state.game.move(input);
    if (!rec) return;
    finalizeMove(rec, pre, true);
  }

  function finalizeMove(rec, pre, isHuman) {
    state.positions.push(state.game.fen());
    state.records.push(rec);
    state.viewPly = state.records.length;
    state.lastMove = {from: Chess.squareToIndex(rec.from), to: Chess.squareToIndex(rec.to)};
    state.hint = null;

    // clocks: add increment to the mover, switch to the other side
    if (state.clockEnabled && !state.gameOver) {
      state.clockMs[rec.color] += state.increment * 1000;
      switchClock(rec.color === 'w' ? 'b' : 'w');
    }

    render();

    // Grade the move against the pre-move analysis (centipawn loss vs best).
    classifyRecorded(rec, pre, isHuman);

    if (checkGameEnd()) return;

    if (state.game.turn !== state.humanColor) {
      scheduleAiMove();
    }
    // Analyze the new position for the eval bar, hints, and next move's grading.
    refreshAnalysis();
  }

  // Locate the played move within a pre-move analysis' ranked candidate list.
  function findRanked(pre, rec) {
    if (!pre || !pre.ranked) return null;
    var wantPromo = rec.move.promotion || null;
    for (var i = 0; i < pre.ranked.length; i++) {
      var m = pre.ranked[i].move;
      if (m.from === rec.move.from && m.to === rec.move.to && (m.promotion || null) === wantPromo) {
        return {entry: pre.ranked[i], rank: i};
      }
    }
    return null;
  }

  function classifyRecorded(rec, pre, isHuman) {
    var quality;
    var found = findRanked(pre, rec);
    if (found) {
      var cpLoss = pre.ranked[0].score - found.entry.score;
      quality = state.coach.classifyLoss(cpLoss, found.rank === 0);
    } else {
      quality = {label: 'Good', type: 'good', cp: 0};
    }
    var plyIndex = state.records.indexOf(rec);
    if (plyIndex >= 0) state.records[plyIndex].quality = quality;
    renderMoves();
    if (isHuman && state.coachEnabled) coachOnHumanMove(rec, quality);
    renderCoach();
  }

  function checkGameEnd() {
    var g = state.game;
    if (g.isCheckmate()) {
      state.gameOver = true;
      stopClock();
      var winner = g.turn === 'w' ? 'Black' : 'White';
      setStatus('Checkmate — ' + winner + ' wins!');
      var humanWon = (winner === 'White' && state.humanColor === 'w') || (winner === 'Black' && state.humanColor === 'b');
      addCoachMessage(humanWon ? 'good' : 'warn', 'Checkmate', humanWon ? 'Beautifully finished! You delivered checkmate.' : 'Checkmate. Study the final moves with the navigation arrows to see the mating pattern.');
      applyGameResult(humanWon ? 'win' : 'loss');
      return true;
    }
    if (g.isStalemate()) {
      state.gameOver = true;
      stopClock();
      setStatus('Stalemate — draw.');
      addCoachMessage('warn', 'Stalemate', 'The side to move has no legal moves but is not in check — it\'s a draw. Watch for this when you\'re far ahead!');
      applyGameResult('draw');
      return true;
    }
    if (g.isInsufficientMaterial()) {
      state.gameOver = true;
      stopClock();
      setStatus('Draw — insufficient material.');
      applyGameResult('draw');
      return true;
    }
    if (g.halfmoves >= 100) {
      state.gameOver = true;
      stopClock();
      setStatus('Draw — 50-move rule.');
      applyGameResult('draw');
      return true;
    }
    return false;
  }

  // ---- AI move ----------------------------------------------------------
  function scheduleAiMove() {
    if (state.gameOver) return;
    state.aiThinking = true;
    setStatus('<span class="thinking">' + aiName() + ' is thinking…</span>');
    // yield to the browser so the UI can paint the "thinking" state
    setTimeout(function () {
      if (state.gameOver) {
        state.aiThinking = false;
        return;
      }
      var pre = state.preMoveAnalysis;
      var sanHistory = state.records.map(function (r) { return r.san; });
      var move = state.ai.chooseMove(state.game, sanHistory);
      if (!move) {
        state.aiThinking = false;
        checkGameEnd();
        return;
      }
      var rec = state.game.move({from: move.from, to: move.to, promotion: move.promotion ? Chess.typeOf(move.promotion) : null});
      state.aiThinking = false;
      setStatus('');
      finalizeMove(rec, pre, false);
    }, 220);
  }

  // ---- Analysis & coaching ---------------------------------------------
  // Analyze the current live position. Always computes (the coach and Hint
  // depend on it); only renders the eval bar / lines when analysis display is
  // enabled. Runs on a timeout so the UI can paint first.
  function refreshAnalysis() {
    if (state.analysisEnabled) $('analysisStatus').classList.add('hidden');
    setTimeout(function () {
      var g = state.game;
      if (g.generateLegalMoves().length === 0) {
        state.preMoveAnalysis = null;
        if (state.analysisEnabled) {
          var w = g.isCheckmate() ? (g.turn === 'w' ? -ChessAI.MATE : ChessAI.MATE) : 0;
          setEvalBar(w, true);
          $('analysisLines').innerHTML = '';
        }
        return;
      }
      var res = state.analyzer.analyze(g, 3);
      if (!res) return;
      state.lastEvalWhite = res.whiteScore;
      state.preMoveAnalysis = res;
      if (state.analysisEnabled) {
        setEvalBar(res.whiteScore, true);
        renderAnalysisLines(res, g);
      }
    }, 10);
  }
  // Backwards-compatible alias used at game start / after undo.
  function runAnalysis() {
    refreshAnalysis();
  }

  function renderAnalysisLines(res, g) {
    var wrap = $('analysisLines');
    wrap.innerHTML = '';
    var top = res.ranked.slice(0, 3);
    top.forEach(function (r, i) {
      var probe = new Chess(g.fen());
      var san = probe.toSan(r.move);
      var line = document.createElement('div');
      line.className = 'analysis-line';
      var whiteCp = g.turn === 'w' ? r.score : -r.score;
      var label = document.createElement('span');
      label.className = 'san';
      label.textContent = (i + 1) + '. ' + san;
      var cp = document.createElement('span');
      cp.className = 'cp';
      cp.textContent = formatEval(whiteCp);
      line.appendChild(label);
      line.appendChild(cp);
      wrap.appendChild(line);
    });
  }

  function coachOnHumanMove(rec, quality) {
    // Move-quality feedback
    var beforeChess = new Chess(state.positions[state.viewPly - 1]);
    var qType = quality.type;
    if (qType === 'blunder') {
      addCoachMessage('blunder', 'Blunder', 'That move loses significant material or position. ' + suggestBetter() + ' Try the Hint button before moving when unsure.');
    } else if (qType === 'mistake') {
      addCoachMessage('warn', 'Mistake', 'There was a clearly better option here. ' + suggestBetter());
    } else if (qType === 'inaccuracy') {
      addCoachMessage('warn', 'Inaccuracy', 'A slightly better move was available. ' + suggestBetter());
    } else if (qType === 'best') {
      addCoachMessage('good', 'Best move', 'That\'s the engine\'s top choice — excellent.');
    }

    // Principle-based tips
    var tips = state.coach.principleTips(beforeChess, rec, state.records.length);
    tips.forEach(function (t) {
      addCoachMessage(t.type === 'good' ? 'good' : 'warn', t.type === 'good' ? 'Nice principle' : 'Coaching tip', t.text);
    });
  }

  function suggestBetter() {
    return 'Step back with ◀ and check the Analysis panel to compare with the engine\'s top lines.';
  }

  // ---- Coach panel ------------------------------------------------------
  var coachLog = [];
  function addCoachMessage(type, title, text) {
    coachLog.unshift({type: type, title: title, text: text});
    if (coachLog.length > 6) coachLog.pop();
    renderCoach();
  }

  function renderCoach() {
    var sanList = state.records.slice(0, state.viewPly).map(function (r) {
      return r.san;
    });
    var opening = state.coach.identifyOpening(sanList);
    $('openingName').textContent = opening ? opening.entry.name : 'Out of book';

    var wrap = $('coachMessages');
    wrap.innerHTML = '';

    if (!state.coachEnabled) {
      var off = document.createElement('div');
      off.className = 'coach-message';
      off.textContent = 'Coach mode is off. Turn it on for opening names, strategic ideas, and move-by-move tips.';
      wrap.appendChild(off);
      return;
    }

    // Opening ideas
    if (opening && opening.entry.ideas) {
      opening.entry.ideas.forEach(function (idea) {
        var d = document.createElement('div');
        d.className = 'idea';
        d.textContent = idea;
        wrap.appendChild(d);
      });
      // book recommendation for the side to move at the live position
      if (isLiveView() && !state.gameOver) {
        var book = state.coach.bookMove(state.game, sanList);
        if (book) {
          var b = document.createElement('div');
          b.className = 'coach-message good';
          b.innerHTML = '<span class="title">Book move</span>A principled continuation here is <strong>' + book.san + '</strong>.';
          wrap.appendChild(b);
        }
      }
    }

    // recent coaching messages
    coachLog.forEach(function (m) {
      var d = document.createElement('div');
      d.className = 'coach-message ' + (m.type || '');
      d.innerHTML = '<span class="title">' + m.title + '</span>' + m.text;
      wrap.appendChild(d);
    });

    // principles reminder when early
    if (state.viewPly <= 8) {
      var pr = document.createElement('div');
      pr.style.marginTop = '10px';
      var h = document.createElement('div');
      h.style.fontSize = '12px';
      h.style.color = 'var(--muted)';
      h.textContent = 'Opening principles:';
      pr.appendChild(h);
      var ul = document.createElement('ul');
      ul.className = 'principles';
      ChessCoach.OPENING_PRINCIPLES.slice(0, 5).forEach(function (p) {
        var li = document.createElement('li');
        li.textContent = p;
        ul.appendChild(li);
      });
      pr.appendChild(ul);
      wrap.appendChild(pr);
    }
  }

  // ---- Eval bar ---------------------------------------------------------
  function setEvalBar(whiteCp, show) {
    var fill = $('evalFill');
    var num = $('evalNum');
    if (!show) {
      fill.style.height = '50%';
      num.textContent = '0.0';
      return;
    }
    var mate = Math.abs(whiteCp) > ChessAI.MATE - 2000;
    var pct;
    if (mate) {
      pct = whiteCp > 0 ? 100 : 0;
    } else {
      var winProb = 1 / (1 + Math.pow(10, -whiteCp / 400));
      pct = winProb * 100;
    }
    fill.style.height = pct + '%';
    num.textContent = formatEval(whiteCp);
  }

  function formatEval(whiteCp) {
    if (Math.abs(whiteCp) > ChessAI.MATE - 2000) {
      return whiteCp > 0 ? 'M' : '-M';
    }
    var v = whiteCp / 100;
    return (v >= 0 ? '+' : '') + v.toFixed(1);
  }

  // ---- Hint -------------------------------------------------------------
  function showHint() {
    if (state.gameOver || state.aiThinking || !isLiveView()) return;
    if (state.game.turn !== state.humanColor) return;
    var res = state.preMoveAnalysis || state.analyzer.analyze(state.game, 3);
    if (res && res.bestMove) {
      markAssisted(); // using a hint makes the game Casual (unrated)
      state.hint = {from: res.bestMove.from, to: res.bestMove.to};
      var probe = new Chess(state.game.fen());
      var san = probe.toSan(res.bestMove);
      setStatus('Hint: consider <strong>' + san + '</strong>');
      render();
    }
  }

  // ---- Move history -----------------------------------------------------
  function renderMoves() {
    var tbody = $('movesTable').querySelector('tbody');
    tbody.innerHTML = '';
    var recs = state.records;
    for (var i = 0; i < recs.length; i += 2) {
      var tr = document.createElement('tr');
      var num = document.createElement('td');
      num.className = 'num';
      num.textContent = i / 2 + 1 + '.';
      tr.appendChild(num);

      tr.appendChild(moveCell(recs[i], i + 1));
      if (recs[i + 1]) tr.appendChild(moveCell(recs[i + 1], i + 2));
      else tr.appendChild(document.createElement('td'));
      tbody.appendChild(tr);
    }
    // scroll to bottom
    var wrap = $('movesWrap');
    wrap.scrollTop = wrap.scrollHeight;
  }

  function moveCell(rec, plyNumber) {
    var td = document.createElement('td');
    td.className = 'mv';
    if (state.viewPly === plyNumber) td.classList.add('current');
    td.textContent = rec.san;
    if (rec.quality && rec.quality.type !== 'good' && rec.quality.type !== 'best') {
      var q = document.createElement('span');
      q.className = 'q ' + rec.quality.type;
      q.textContent = rec.quality.type === 'inaccuracy' ? '?!' : rec.quality.type === 'mistake' ? '?' : rec.quality.type === 'blunder' ? '??' : '';
      td.appendChild(q);
    } else if (rec.quality && rec.quality.type === 'best') {
      var qb = document.createElement('span');
      qb.className = 'q best';
      qb.textContent = '!';
      td.appendChild(qb);
    }
    td.addEventListener('click', function () {
      navTo(plyNumber);
    });
    return td;
  }

  function navTo(ply) {
    ply = Math.max(0, Math.min(state.records.length, ply));
    state.viewPly = ply;
    clearSelection();
    state.hint = null;
    render();
    renderCoach();
  }

  function undoMove() {
    if (state.records.length === 0 || state.aiThinking || state.reviewMode) return;
    // Undo back to the human's previous turn: remove last ply, and if the
    // last mover was the engine, remove the human ply too so it's the human's move.
    var removeCount = 1;
    var lastColor = state.records[state.records.length - 1].color;
    if (lastColor !== state.humanColor && state.records.length >= 2) {
      removeCount = 2;
    }
    for (var i = 0; i < removeCount; i++) {
      if (state.records.length === 0) break;
      state.game.undo();
      state.records.pop();
      state.positions.pop();
    }
    state.viewPly = state.records.length;
    state.gameOver = false;
    state.lastMove = state.records.length > 0
      ? {from: Chess.squareToIndex(state.records[state.records.length - 1].from), to: Chess.squareToIndex(state.records[state.records.length - 1].to)}
      : null;
    clearSelection();
    setStatus('');
    render();
    runAnalysis();
    renderCoach();
    if (state.clockEnabled) switchClock(state.game.turn);
  }

  function copyPgn() {
    var pgn = '';
    for (var i = 0; i < state.records.length; i += 2) {
      pgn += i / 2 + 1 + '. ' + state.records[i].san + ' ';
      if (state.records[i + 1]) pgn += state.records[i + 1].san + ' ';
    }
    pgn = pgn.trim();
    if (navigator.clipboard && pgn) {
      navigator.clipboard.writeText(pgn).then(function () {
        setStatus('PGN copied to clipboard.');
      }).catch(function () {
        setStatus('PGN: ' + pgn);
      });
    } else {
      setStatus(pgn ? 'PGN: ' + pgn : 'No moves yet.');
    }
  }

  // ---- Clocks -----------------------------------------------------------
  function startClock(color) {
    state.clockActive = color;
    state.lastTick = Date.now();
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(tickClock, 100);
    renderClocks();
  }

  function switchClock(color) {
    if (!state.clockEnabled) return;
    if (!state.clockTimer) {
      startClock(color);
      return;
    }
    state.clockActive = color;
    state.lastTick = Date.now();
    renderClocks();
  }

  function stopClock() {
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = null;
    state.clockActive = null;
  }

  function tickClock() {
    if (!state.clockActive || state.gameOver) return;
    var now = Date.now();
    var delta = now - state.lastTick;
    state.lastTick = now;
    state.clockMs[state.clockActive] -= delta;
    if (state.clockMs[state.clockActive] <= 0) {
      state.clockMs[state.clockActive] = 0;
      state.gameOver = true;
      stopClock();
      var flagged = state.clockActive;
      var winner = flagged === 'w' ? 'Black' : 'White';
      setStatus('Time! ' + winner + ' wins on the clock.');
      applyGameResult(flagged === state.humanColor ? 'loss' : 'win');
    }
    renderClocks();
  }

  function renderClocks() {
    var topBar = $('topBar');
    var bottomBar = $('bottomBar');
    if (!state.clockEnabled) {
      $('topClock').style.visibility = 'hidden';
      $('bottomClock').style.visibility = 'hidden';
      return;
    }
    $('topClock').style.visibility = 'visible';
    $('bottomClock').style.visibility = 'visible';

    var bottomColor = state.orientation;
    var topColor = bottomColor === 'w' ? 'b' : 'w';
    setClockEl($('bottomClock'), state.clockMs[bottomColor], state.clockActive === bottomColor);
    setClockEl($('topClock'), state.clockMs[topColor], state.clockActive === topColor);
  }

  function setClockEl(el, ms, active) {
    el.textContent = formatTime(ms);
    el.classList.toggle('active', !!active && !state.gameOver);
    el.classList.toggle('low', ms <= 20000);
  }

  function formatTime(ms) {
    if (ms < 0) ms = 0;
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + ':' + pad(m) + ':' + pad(s);
    }
    return m + ':' + pad(s);
  }
  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ---- Status -----------------------------------------------------------
  function setStatus(html) {
    statusEl.innerHTML = html;
  }

  // ---- Promotion --------------------------------------------------------
  function askPromotion(from, to, callback) {
    var modal = $('promoModal');
    var choices = $('promoChoices');
    choices.innerHTML = '';
    var color = state.game.turn;
    ['q', 'r', 'b', 'n'].forEach(function (t) {
      var btn = document.createElement('button');
      btn.textContent = GLYPH[t];
      btn.style.color = color === 'w' ? '#fff' : '#1a1a1a';
      btn.style.textShadow = color === 'w' ? '0 0 2px #000' : 'none';
      btn.addEventListener('click', function () {
        modal.classList.remove('show');
        callback(t);
      });
      choices.appendChild(btn);
    });
    modal.classList.add('show');
  }

  // ---- Go ---------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
