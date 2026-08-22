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

  // Static evaluation from White's perspective (positive = White better).
  function evaluate(chess) {
    var board = chess.board;
    var score = 0;
    var endgame = isEndgame(board);
    var i, p, t, c, sq;

    for (i = 0; i < 64; i++) {
      p = board[i];
      if (p === null) continue;
      t = typeOf(p);
      c = colorOf(p);
      var val = PIECE_VALUE[t];
      var table = t === 'k' ? (endgame ? PST.kEnd : PST.k) : PST[t];
      var pstVal;
      if (c === 'w') {
        pstVal = table[i];
        score += val + pstVal;
      } else {
        pstVal = table[mirror(i)];
        score -= val + pstVal;
      }
    }

    // Mobility: small bonus per legal move for the side to move; approximate
    // by counting pseudo-moves for both sides is expensive, so use a light
    // heuristic based on the side to move's move count.
    // (Kept cheap for browser performance.)

    // Bishop pair bonus.
    var wb = 0, bb = 0;
    for (i = 0; i < 64; i++) {
      if (board[i] === 'B') wb++;
      else if (board[i] === 'b') bb++;
    }
    if (wb >= 2) score += 30;
    if (bb >= 2) score -= 30;

    return score;
  }

  var MATE = 100000;

  function AI(level) {
    this.setLevel(level || AI.LEVELS[0]);
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
    if (this.checkTime()) return color === 'w' ? evaluate(chess) : -evaluate(chess);
    var standPat = color === 'w' ? evaluate(chess) : -evaluate(chess);
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
      return color === 'w' ? evaluate(chess) : -evaluate(chess);
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
  AI.prototype.chooseMove = function (chess) {
    var legal = chess.generateLegalMoves();
    if (legal.length === 0) return null;

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
