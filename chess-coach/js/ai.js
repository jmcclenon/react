/*
 * ai.js — Chess AI: position evaluation + negamax/alpha-beta search, plus a
 * ladder of difficulty levels from Beginner to Grandmaster.
 *
 * The evaluation combines material, piece-square tables (with a middlegame /
 * endgame blend for the king), mobility, and small positional bonuses. Search
 * is negamax with alpha-beta pruning, MVV-LVA capture ordering, and a short
 * quiescence search to avoid the horizon effect on captures.
 *
 * Difficulty is expressed as a level object controlling search depth, how
 * often the AI deliberately picks a sub-optimal move ("blunderChance"), and
 * how much random noise is added to the evaluation.
 */
(function (global) {
  'use strict';

  var Chess = global.Chess;
  var fileOf = Chess.fileOf;
  var rankOf = Chess.rankOf;
  var typeOf = Chess.typeOf;
  var colorOf = Chess.colorOf;

  var PIECE_VALUE = {p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000};

  // Piece-square tables are written from White's perspective with index 0 = a8.
  // For Black we mirror vertically.
  var PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0,
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
    kEnd: [
      -50, -40, -30, -20, -20, -30, -40, -50,
      -30, -20, -10, 0, 0, -10, -20, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -30, 0, 0, 0, 0, -30, -30,
      -50, -30, -30, -30, -30, -30, -30, -50,
    ],
  };

  function mirror(sq) {
    // vertical mirror: rank 0<->7
    var r = rankOf(sq);
    var f = fileOf(sq);
    return (7 - r) * 8 + f;
  }

  // Count non-pawn, non-king material to decide game phase.
  function isEndgame(board) {
    var majorMinor = 0;
    var queens = 0;
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p === null) continue;
      var t = typeOf(p);
      if (t === 'q') queens++;
      else if (t === 'r' || t === 'b' || t === 'n') majorMinor++;
    }
    return queens === 0 || (queens <= 2 && majorMinor <= 2);
  }

  // Chebyshev (king-move) distance between two board indices.
  function chebyshev(a, b) {
    var dr = Math.abs(rankOf(a) - rankOf(b));
    var df = Math.abs(fileOf(a) - fileOf(b));
    return Math.max(dr, df);
  }

  // Tropism weight per piece type when measuring pressure on the enemy king.
  var TROPISM = {n: 2, b: 2, r: 3, q: 5, p: 0, k: 0};

  // Static evaluation from White's perspective (positive = White better).
  // An optional `style` reshapes the same position into a personality:
  //   material — multiplier on the raw material+PST balance
  //   attack   — weight on piece pressure toward the enemy king (both sides),
  //              so an aggressive engine will sacrifice material for an attack
  //   position — multiplier on positional bonuses (bishop pair, etc.)
  function evaluate(chess, style) {
    var board = chess.board;
    var base = 0; // material + piece-square tables
    var positional = 0; // style-scalable positional bonuses
    var endgame = isEndgame(board);
    var i, p, t, c;

    for (i = 0; i < 64; i++) {
      p = board[i];
      if (p === null) continue;
      t = typeOf(p);
      c = colorOf(p);
      var val = PIECE_VALUE[t];
      var table = t === 'k' ? (endgame ? PST.kEnd : PST.k) : PST[t];
      if (c === 'w') base += val + table[i];
      else base -= val + table[mirror(i)];
    }

    // Bishop pair bonus (a positional consideration).
    var wb = 0, bb = 0;
    for (i = 0; i < 64; i++) {
      if (board[i] === 'B') wb++;
      else if (board[i] === 'b') bb++;
    }
    if (wb >= 2) positional += 30;
    if (bb >= 2) positional -= 30;

    if (!style) return base + positional;

    var matMul = style.material == null ? 1 : style.material;
    var posMul = style.position == null ? 1 : style.position;
    var attackW = style.attack || 0;

    var score = base * matMul + positional * posMul;

    if (attackW !== 0) {
      var wk = chess.kingIndex('w');
      var bk = chess.kingIndex('b');
      var whiteAttack = 0, blackAttack = 0;
      for (i = 0; i < 64; i++) {
        p = board[i];
        if (p === null) continue;
        t = typeOf(p);
        if (t === 'k' || t === 'p') continue;
        c = colorOf(p);
        if (c === 'w') whiteAttack += (7 - chebyshev(i, bk)) * TROPISM[t];
        else blackAttack += (7 - chebyshev(i, wk)) * TROPISM[t];
      }
      score += attackW * (whiteAttack - blackAttack);
    }

    return score;
  }

  // Playing styles. `attack` is in centipawns per tropism point (small).
  var STYLES = {
    balanced: {key: 'balanced', label: 'Balanced', material: 1.0, position: 1.0, attack: 0.4, blurb: 'Plays solid, all-round chess.'},
    aggressive: {key: 'aggressive', label: 'Aggressive', material: 0.92, position: 1.0, attack: 1.6, blurb: 'Throws pieces at your king and loves the initiative.'},
    tactical: {key: 'tactical', label: 'Tactical', material: 0.82, position: 1.05, attack: 2.0, blurb: 'Sacrifices material for attacks and complications.'},
    positional: {key: 'positional', label: 'Positional', material: 1.0, position: 1.35, attack: 0.2, blurb: 'Squeezes slowly with structure and good pieces.'},
    defensive: {key: 'defensive', label: 'Solid / Defensive', material: 1.12, position: 0.95, attack: 0.15, blurb: 'Trades down, hoards material, and defends stubbornly.'},
  };

  // Opening repertoires per style. Keyed by the space-joined SAN history from
  // the start; the value is a list of preferred replies (most-favoured first).
  // Because the history length fixes whose turn it is, both White openings and
  // Black responses live in one table — the engine only consults the entry that
  // matches the current position on its move. Used only in the first few moves,
  // after which the engine searches normally.
  var REPERTOIRE = {
    balanced: {
      '': ['e4'],
      e4: ['e5'], d4: ['d5'], c4: ['e5'], Nf3: ['d5'],
      'e4 e5': ['Nf3'],
      'e4 e5 Nf3 Nc6': ['Bb5', 'Bc4'],
      'e4 c5': ['Nf3'], 'e4 e6': ['d4'], 'e4 c6': ['d4'],
    },
    aggressive: {
      '': ['e4'],
      e4: ['e5', 'c5'], d4: ['Nf6'], c4: ['e5'], Nf3: ['Nf6'],
      'e4 e5': ['Bc4', 'Nf3'],
      'e4 e5 Nf3 Nc6': ['Bc4'],
      'e4 e5 Bc4 Nc6': ['Nf3'],
      'e4 c5': ['Nf3'], 'e4 e6': ['d4'], 'e4 c6': ['d4'],
    },
    tactical: {
      '': ['e4'],
      e4: ['c5', 'e5'], d4: ['Nf6'], c4: ['e5'], Nf3: ['Nf6'],
      'e4 e5': ['f4', 'Bc4'], // King's Gambit
      'e4 e5 f4 exf4': ['Nf3'],
      'e4 e5 f4 Bc5': ['Nf3'],
      'e4 c5': ['Nf3'], 'e4 e6': ['d4'],
    },
    positional: {
      '': ['d4', 'c4'],
      e4: ['e6', 'c6'], d4: ['d5', 'Nf6'], c4: ['e5'], Nf3: ['d5'],
      'd4 d5': ['c4'], // Queen's Gambit
      'd4 Nf6': ['c4'],
      'd4 d5 c4 e6': ['Nc3'],
      'c4 e5': ['Nc3'],
    },
    defensive: {
      '': ['d4'],
      e4: ['c6', 'e6'], d4: ['d5'], c4: ['e6'], Nf3: ['d5'],
      'd4 d5': ['Nf3'], // slow, no gambit
      'd4 Nf6': ['Nf3'],
      'd4 d5 Nf3 Nf6': ['Bf4'], // London System
      'd4 d5 Nf3 Nc6': ['Bf4'],
    },
  };

  // Human-readable scouting notes per style, surfaced in the app so players can
  // prepare against each opponent.
  var STYLE_PROFILE = {
    balanced: {
      openingWhite: '1.e4 and classical development (Ruy López / Italian).',
      openingBlack: '1...e5 vs 1.e4; 1...d5 vs 1.d4 — sound, mainstream replies.',
      offense: 'Takes chances when they arise but does not force matters; converts advantages steadily.',
      defense: 'Reliable; defends accurately and rarely over-extends.',
      strength: 'Few weaknesses — punishes clearly bad moves.',
      weakness: 'No special agenda; out-play it with a concrete plan.',
    },
    aggressive: {
      openingWhite: '1.e4, aiming the bishop at f7 (Italian) for a fast attack.',
      openingBlack: 'Fights back with 1...e5 or the Sicilian 1...c5.',
      offense: 'Relentless — brings pieces toward your king and will give up material for the initiative.',
      defense: 'Impatient on defense; can neglect king safety when attacking.',
      strength: 'Dangerous in open, tactical positions.',
      weakness: 'Blunt its attack by trading pieces and castling early; if the assault fizzles it is often down material.',
    },
    tactical: {
      openingWhite: "Gambits — the King's Gambit (1.e4 e5 2.f4), sacrificing a pawn for open lines.",
      openingBlack: 'Sharp defenses, especially the Sicilian, to unbalance the game.',
      offense: 'Thrives on complications, sacrifices, and forcing tactics.',
      defense: 'Prefers counter-attack to passive defense.',
      strength: 'Lethal if you enter tactical slugfests unprepared.',
      weakness: 'Decline gambits or return material to reach a calm, technical position where its sacrifices lose their point.',
    },
    positional: {
      openingWhite: "1.d4 / 1.c4 — the Queen's Gambit and English, fighting for the center with pawns.",
      openingBlack: 'Solid, strategic setups: the French (1...e6) or Caro-Kann (1...c6).',
      offense: 'Slow squeeze — accumulates small advantages, good squares, and better structure.',
      defense: 'Excellent; avoids weaknesses and untangles patiently.',
      strength: 'Grinds out closed, maneuvering positions.',
      weakness: 'Create sharp tactical complications and direct threats before it consolidates its long-term edge.',
    },
    defensive: {
      openingWhite: '1.d4 into solid systems like the London (d4/Nf3/Bf4) — no early risks.',
      openingBlack: 'Rock-solid Caro-Kann (1...c6) and French (1...e6) structures.',
      offense: 'Minimal — happy to trade into a safe, simplified position.',
      defense: 'Stubborn; hoards material and defends every pawn.',
      strength: 'Very hard to break down; punishes reckless attacks.',
      weakness: 'Keep pieces on and build slowly; its passivity means it seldom creates its own threats — squeeze it.',
    },
  };

  var MATE = 100000;

  function AI(level) {
    this.setLevel(level || AI.LEVELS[0]);
    this.style = null; // null → objective evaluation (used by the analyzer)
    this.persona = null; // {name, styleKey, levelIndex}
    this.nodes = 0;
    this.deadline = Infinity;
    this.timedOut = false;
  }

  // Difficulty ladder.
  //   maxDepth   — the deepest search allowed (iterative deepening stops here).
  //   timeMs     — per-move thinking budget; search returns the best line found
  //                so far when this elapses, keeping the UI responsive.
  //   blunderChance — probability of playing a random legal move (weak levels).
  //   noise      — centipawn randomness added to evaluation to make lower
  //                levels imperfect and less repetitive.
  AI.LEVELS = [
    {name: 'Beginner', elo: 600, maxDepth: 1, timeMs: 300, blunderChance: 0.35, noise: 90, quiescence: false},
    {name: 'Casual', elo: 1000, maxDepth: 2, timeMs: 500, blunderChance: 0.18, noise: 55, quiescence: false},
    {name: 'Intermediate', elo: 1400, maxDepth: 3, timeMs: 800, blunderChance: 0.08, noise: 30, quiescence: true},
    {name: 'Advanced', elo: 1800, maxDepth: 4, timeMs: 1200, blunderChance: 0.03, noise: 12, quiescence: true},
    {name: 'Expert', elo: 2100, maxDepth: 5, timeMs: 2000, blunderChance: 0.0, noise: 4, quiescence: true},
    {name: 'Grandmaster', elo: 2500, maxDepth: 7, timeMs: 3000, blunderChance: 0.0, noise: 0, quiescence: true},
  ];

  AI.prototype.setLevel = function (level) {
    if (typeof level === 'string') {
      level = AI.LEVELS.find(function (l) {
        return l.name === level;
      }) || AI.LEVELS[0];
    } else if (typeof level === 'number') {
      level = AI.LEVELS[Math.max(0, Math.min(AI.LEVELS.length - 1, level))];
    }
    this.level = level;
  };

  AI.STYLES = STYLES;
  AI.STYLE_PROFILE = STYLE_PROFILE;
  AI.REPERTOIRE = REPERTOIRE;

  // A roster of named opponents: several distinct playing styles at each ELO
  // band. `level` indexes AI.LEVELS; `style` indexes AI.STYLES.
  AI.ROSTER = [
    // Beginner (~600)
    {name: 'Pip', level: 0, style: 'aggressive'},
    {name: 'Daisy', level: 0, style: 'balanced'},
    {name: 'Turtle Ted', level: 0, style: 'defensive'},
    // Casual (~1000)
    {name: 'Gambit Gwen', level: 1, style: 'tactical'},
    {name: 'Steady Sam', level: 1, style: 'positional'},
    {name: 'Reckless Rhea', level: 1, style: 'aggressive'},
    // Intermediate (~1400)
    {name: 'Tactician Tara', level: 2, style: 'tactical'},
    {name: 'Fortress Finn', level: 2, style: 'defensive'},
    {name: 'Centre Cara', level: 2, style: 'positional'},
    // Advanced (~1800)
    {name: 'Blitz Boris', level: 3, style: 'aggressive'},
    {name: 'Maestro Mira', level: 3, style: 'positional'},
    {name: 'Trapper Tom', level: 3, style: 'tactical'},
    // Expert (~2100)
    {name: 'Sniper Sena', level: 4, style: 'aggressive'},
    {name: 'Anchor Ana', level: 4, style: 'defensive'},
    {name: 'Professor Quill', level: 4, style: 'positional'},
    // Grandmaster (~2500)
    {name: 'GM Volkov', level: 5, style: 'aggressive'},
    {name: 'GM Petrosian-style', level: 5, style: 'defensive'},
    {name: 'GM Capablanca-style', level: 5, style: 'positional'},
    {name: 'GM Tal-style', level: 5, style: 'tactical'},
    // Opening specialists — you choose which opening book they play.
    {name: 'Book Specialist (Casual)', level: 1, style: 'balanced', specialist: true},
    {name: 'Book Specialist (Intermediate)', level: 2, style: 'balanced', specialist: true},
    {name: 'Book Specialist (Advanced)', level: 3, style: 'balanced', specialist: true},
    {name: 'Book Specialist (Expert)', level: 4, style: 'balanced', specialist: true},
    {name: 'Book Specialist (Grandmaster)', level: 5, style: 'balanced', specialist: true},
  ];

  // Configure this engine as a specific roster persona.
  AI.prototype.setPersona = function (persona) {
    this.persona = persona;
    this.setLevel(persona.level);
    this.style = STYLES[persona.style] || STYLES.balanced;
    this.displayName = persona.name;
    this.specialist = !!persona.specialist;
    this.chosenOpening = null; // cleared; a specialist gets one via setOpening
    return this;
  };

  // Tell an opening specialist which line to steer toward (array of SAN moves).
  AI.prototype.setOpening = function (moves) {
    this.chosenOpening = moves && moves.length ? moves : null;
  };

  // If a chosen opening line is set and the game still matches it, return the
  // next move from the line (for whichever side the engine is on).
  AI.prototype.followChosenOpening = function (chess, sanHistory) {
    var line = this.chosenOpening;
    if (!line || !sanHistory || sanHistory.length >= line.length) return null;
    for (var i = 0; i < sanHistory.length; i++) {
      if (sanHistory[i] !== line[i]) return null; // game has left the line
    }
    var want = line[sanHistory.length];
    var legal = chess.generateLegalMoves();
    for (var j = 0; j < legal.length; j++) {
      if (chess.toSan(legal[j]).replace(/[+#]$/, '') === want) return legal[j];
    }
    return null;
  };

  // Order moves to improve alpha-beta pruning: captures first (MVV-LVA),
  // then promotions, then quiet moves.
  function scoreMove(move) {
    var s = 0;
    if (move.captured) {
      s += 10 * PIECE_VALUE[typeOf(move.captured)] - PIECE_VALUE[typeOf(move.piece)];
    }
    if (move.promotion) s += PIECE_VALUE[typeOf(move.promotion)];
    return s;
  }

  function orderMoves(moves) {
    return moves
      .map(function (m) {
        return {m: m, s: scoreMove(m)};
      })
      .sort(function (a, b) {
        return b.s - a.s;
      })
      .map(function (x) {
        return x.m;
      });
  }

  AI.prototype.checkTime = function () {
    if ((this.nodes & 2047) === 0 && Date.now() >= this.deadline) {
      this.timedOut = true;
    }
    return this.timedOut;
  };

  // Quiescence search: only extend captures to reach a "quiet" position.
  AI.prototype.quiescence = function (chess, alpha, beta, color) {
    this.nodes++;
    if (this.checkTime()) return color === 'w' ? evaluate(chess, this.style) : -evaluate(chess, this.style);
    var standPat = color === 'w' ? evaluate(chess, this.style) : -evaluate(chess, this.style);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;

    var moves = chess.generateLegalMoves();
    var captures = orderMoves(
      moves.filter(function (m) {
        return m.captured || m.promotion;
      })
    );
    for (var i = 0; i < captures.length; i++) {
      var undo = chess._makeMove(captures[i]);
      var score = -this.quiescence(chess, -beta, -alpha, color === 'w' ? 'b' : 'w');
      chess._undoMove(undo);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  // Negamax with alpha-beta. Returns score from the perspective of `color`.
  AI.prototype.negamax = function (chess, depth, alpha, beta, color) {
    this.nodes++;
    if (this.checkTime()) return alpha;
    var moves = chess.generateLegalMoves();

    if (moves.length === 0) {
      if (chess.isCheck()) return -MATE - depth; // prefer faster mates
      return 0; // stalemate
    }
    if (depth === 0) {
      if (this.level.quiescence) {
        return this.quiescence(chess, alpha, beta, color);
      }
      return color === 'w' ? evaluate(chess, this.style) : -evaluate(chess, this.style);
    }

    moves = orderMoves(moves);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var undo = chess._makeMove(moves[i]);
      var score = -this.negamax(chess, depth - 1, -beta, -alpha, color === 'w' ? 'b' : 'w');
      chess._undoMove(undo);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // beta cutoff
    }
    return best;
  };

  // Search the root position with iterative deepening under a time budget.
  // Options: {maxDepth, timeMs, noise}. Returns the best move, its score, a
  // ranked list of root moves, and node/depth stats. Because each iteration
  // reorders the root by the previous scores, alpha-beta prunes far better and
  // the move returned on a timeout is still the best from the last full depth.
  AI.prototype.search = function (chess, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth != null ? opts.maxDepth : this.level.maxDepth;
    var timeMs = opts.timeMs != null ? opts.timeMs : this.level.timeMs;
    var noise = opts.noise != null ? opts.noise : 0;

    this.nodes = 0;
    this.timedOut = false;
    this.deadline = timeMs > 0 ? Date.now() + timeMs : Infinity;

    var color = chess.turn;
    var rootMoves = orderMoves(chess.generateLegalMoves());
    if (rootMoves.length === 0) return null;

    var enemy = color === 'w' ? 'b' : 'w';
    // Best complete result from the last fully-searched depth.
    var completed = rootMoves.map(function (m) {
      return {move: m, score: 0};
    });

    for (var depth = 1; depth <= maxDepth; depth++) {
      var iter = [];
      var alpha = -Infinity;
      var beta = Infinity;
      var aborted = false;

      for (var i = 0; i < rootMoves.length; i++) {
        var undo = chess._makeMove(rootMoves[i]);
        var score = -this.negamax(chess, depth - 1, -beta, -alpha, enemy);
        chess._undoMove(undo);
        if (this.timedOut) {
          aborted = true;
          break;
        }
        iter.push({move: rootMoves[i], score: score});
        if (score > alpha) alpha = score;
      }

      if (aborted) break; // keep the previous depth's complete result

      iter.sort(function (a, b) {
        return b.score - a.score;
      });
      completed = iter;
      // Order next iteration by this depth's scores (best first) for pruning.
      rootMoves = iter.map(function (x) {
        return x.move;
      });

      // Early exit on a forced mate.
      if (Math.abs(completed[0].score) > MATE - 1000) break;
      if (this.timedOut) break;
    }

    // Apply evaluation noise for weaker levels (kept out of the search itself).
    var ranked = completed.slice();
    if (noise > 0) {
      ranked = ranked.map(function (r) {
        return {move: r.move, score: r.score + Math.floor((Math.random() * 2 - 1) * noise)};
      });
      ranked.sort(function (a, b) {
        return b.score - a.score;
      });
    }

    return {
      best: ranked[0].move,
      score: ranked[0].score,
      ranked: ranked,
      nodes: this.nodes,
    };
  };

  // Choose a move for the AI to play, honoring the level's blunder chance.
  // Pick a move from this persona's opening repertoire, if one applies to the
  // current position. `sanHistory` is the list of SAN moves played so far.
  AI.prototype.repertoireMove = function (chess, sanHistory) {
    if (!this.style || !sanHistory) return null;
    var rep = REPERTOIRE[this.style.key];
    if (!rep) return null;
    if (sanHistory.length > 8) return null; // repertoire only covers the opening
    var cands = rep[sanHistory.join(' ')];
    if (!cands || cands.length === 0) return null;

    var legal = chess.generateLegalMoves();
    var options = [];
    for (var i = 0; i < cands.length; i++) {
      for (var j = 0; j < legal.length; j++) {
        if (chess.toSan(legal[j]).replace(/[+#]$/, '') === cands[i]) {
          options.push(legal[j]);
          break;
        }
      }
    }
    if (options.length === 0) return null;
    // Usually play the top choice; occasionally vary among the known replies.
    if (options.length === 1 || Math.random() < 0.7) return options[0];
    return options[Math.floor(Math.random() * options.length)];
  };

  AI.prototype.chooseMove = function (chess, sanHistory) {
    var legal = chess.generateLegalMoves();
    if (legal.length === 0) return null;

    // A specialist follows its chosen opening line while the game matches it.
    var chosen = this.followChosenOpening(chess, sanHistory);
    if (chosen) return chosen;

    // Opening book: play the persona's repertoire while it applies.
    var book = this.repertoireMove(chess, sanHistory);
    if (book) return book;

    // Deliberate blunder: pick a random legal move (weak levels only).
    if (this.level.blunderChance > 0 && Math.random() < this.level.blunderChance) {
      // Avoid hanging mate-in-one obviously; but keep it simple and human-like.
      return legal[Math.floor(Math.random() * legal.length)];
    }

    var result = this.search(chess, {noise: this.level.noise || 0});
    return result ? result.best : legal[0];
  };

  // Analysis helper: evaluate from White's perspective in centipawns using a
  // fixed analysis depth (independent of AI difficulty) with no noise.
  AI.prototype.analyze = function (chess, depth) {
    depth = depth || 3;
    var color = chess.turn;
    var result = this.search(chess, {maxDepth: depth, timeMs: 1500, noise: 0});
    if (!result) return null;
    // score is from side-to-move perspective; convert to White perspective.
    var whiteScore = color === 'w' ? result.score : -result.score;
    return {
      bestMove: result.best,
      scoreForSideToMove: result.score,
      whiteScore: whiteScore,
      ranked: result.ranked,
      nodes: result.nodes,
    };
  };

  AI.evaluate = evaluate;
  AI.PIECE_VALUE = PIECE_VALUE;
  AI.MATE = MATE;

  global.ChessAI = AI;
})(typeof window !== 'undefined' ? window : this);
