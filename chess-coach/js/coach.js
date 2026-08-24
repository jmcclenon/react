/*
 * coach.js — The coaching brain.
 *
 * Two responsibilities:
 *   1. An opening book keyed by the sequence of SAN moves played so far. It
 *      recognizes named openings, recommends principled book moves, and
 *      explains the strategic ideas behind each opening.
 *   2. A principle engine that evaluates the human's moves against classic
 *      opening/positional principles and against the engine's own evaluation,
 *      producing plain-English coaching tips and move quality labels.
 */
(function (global) {
  'use strict';

  var Chess = global.Chess;
  var typeOf = Chess.typeOf;
  var colorOf = Chess.colorOf;
  var fileOf = Chess.fileOf;
  var rankOf = Chess.rankOf;

  // Opening book. Keys are space-joined SAN sequences from the start position.
  // Each entry: {name, moves: [recommended SAN replies], ideas: [strings]}.
  var BOOK = {
    '': {
      name: 'Starting position',
      moves: ['e4', 'd4', 'Nf3', 'c4'],
      ideas: [
        'Fight for the center. 1.e4 and 1.d4 stake an immediate claim; 1.Nf3 and 1.c4 are flexible.',
        'Your first job in the opening: control the center, develop pieces, and get your king safe.',
      ],
    },
    'e4': {
      name: "King's Pawn Opening",
      moves: ['e5', 'c5', 'e6', 'c6'],
      ideas: [
        "1.e4 opens lines for the bishop and queen and grabs central space.",
        'Black usually answers 1...e5 (open games), 1...c5 (Sicilian), 1...e6 (French), or 1...c6 (Caro-Kann).',
      ],
    },
    'e4 e5': {
      name: 'Open Game',
      moves: ['Nf3', 'Bc4', 'Nc3'],
      ideas: [
        'Develop knights toward the center: 2.Nf3 attacks e5 and prepares to castle.',
        'Aim to castle within the first handful of moves.',
      ],
    },
    'e4 e5 Nf3': {
      name: "King's Knight Opening",
      moves: ['Nc6', 'Nf6', 'd6'],
      ideas: [
        '2.Nf3 hits the e5-pawn — Black must defend it (2...Nc6) or counterattack (2...Nf6, Petrov).',
      ],
    },
    'e4 e5 Nf3 Nc6': {
      name: 'Open Game (main line)',
      moves: ['Bb5', 'Bc4', 'd4'],
      ideas: [
        '3.Bb5 is the Ruy Lopez, pressuring the knight that defends e5.',
        '3.Bc4 is the Italian, eyeing the vulnerable f7-square.',
      ],
    },
    'e4 e5 Nf3 Nc6 Bb5': {
      name: 'Ruy Lopez (Spanish)',
      moves: ['a6', 'Nf6', 'Bc5'],
      ideas: [
        'The Ruy Lopez pins pressure on the c6-knight. White wants a long, strategic squeeze.',
        '3...a6 (Morphy Defense) questions the bishop immediately.',
      ],
    },
    'e4 e5 Nf3 Nc6 Bc4': {
      name: 'Italian Game',
      moves: ['Bc5', 'Nf6', 'Be7'],
      ideas: [
        'Both bishops target f7/f2. Classical development and quick castling matter here.',
        '3...Bc5 is the Giuoco Piano; 3...Nf6 is the Two Knights Defense.',
      ],
    },
    'e4 e5 Nf3 Nc6 Bc4 Bc5': {
      name: 'Giuoco Piano',
      moves: ['c3', 'd3', 'O-O'],
      ideas: [
        '"The quiet game." White often plays c3 and d4 to build a big center, or d3 for a slow buildup.',
      ],
    },
    'e4 e5 Nf3 Nc6 Bc4 Nf6': {
      name: 'Two Knights Defense',
      moves: ['Ng5', 'd3', 'd4'],
      ideas: [
        'A sharp, aggressive choice by Black. 4.Ng5 attacks f7 and leads to wild play.',
      ],
    },
    'e4 c5': {
      name: 'Sicilian Defense',
      moves: ['Nf3', 'Nc3', 'c3'],
      ideas: [
        'The Sicilian is the most popular winning attempt for Black — it fights for the center asymmetrically.',
        'White typically plays for a kingside attack; Black counters on the queenside.',
      ],
    },
    'e4 c5 Nf3': {
      name: 'Sicilian Defense',
      moves: ['d6', 'Nc6', 'e6'],
      ideas: [
        'White prepares d4 to open the position. Black chooses a setup: Najdorf (...d6), Taimanov (...e6), etc.',
      ],
    },
    'e4 e6': {
      name: 'French Defense',
      moves: ['d4', 'Nf3', 'Nc3'],
      ideas: [
        'Black will strike the center with ...d5. The French gives Black a solid but slightly cramped position.',
        "Black's light-squared bishop can become a problem piece — plan to activate it.",
      ],
    },
    'e4 c6': {
      name: 'Caro-Kann Defense',
      moves: ['d4', 'Nc3', 'Nf3'],
      ideas: [
        'A rock-solid defense. Black plays ...d5 with a healthy pawn structure and few weaknesses.',
      ],
    },
    'd4': {
      name: "Queen's Pawn Opening",
      moves: ['d5', 'Nf6', 'f5'],
      ideas: [
        '1.d4 leads to more strategic, closed positions than 1.e4.',
        'Common replies: 1...d5 (closed games) or 1...Nf6 (Indian defenses).',
      ],
    },
    'd4 d5': {
      name: 'Closed Game',
      moves: ['c4', 'Nf3', 'Bf4'],
      ideas: [
        '2.c4 is the Queen\'s Gambit — the main way to challenge Black\'s center.',
      ],
    },
    'd4 d5 c4': {
      name: "Queen's Gambit",
      moves: ['e6', 'c6', 'dxc4'],
      ideas: [
        'White offers the c4-pawn to deflect Black\'s d5-pawn and dominate the center.',
        '2...e6 (Declined) is solid; 2...c6 (Slav) keeps the structure flexible; 2...dxc4 (Accepted) gives up the center temporarily.',
      ],
    },
    'd4 Nf6': {
      name: 'Indian Defense',
      moves: ['c4', 'Nf3', 'Bg5'],
      ideas: [
        'Black delays ...d5, planning to strike the center with pieces and pawns later.',
      ],
    },
    'd4 Nf6 c4 g6': {
      name: "King's Indian / Grünfeld complex",
      moves: ['Nc3', 'Nf3', 'g3'],
      ideas: [
        'Black fianchettoes the bishop and lets White build a big center, aiming to attack it later.',
      ],
    },
    'c4': {
      name: 'English Opening',
      moves: ['e5', 'c5', 'Nf6'],
      ideas: [
        'A flexible flank opening. White controls d5 and often fianchettoes the king\'s bishop.',
      ],
    },
    'Nf3': {
      name: 'Réti / King\'s Indian Attack',
      moves: ['d5', 'Nf6', 'c5'],
      ideas: [
        'A flexible move that keeps options open and avoids early commitments.',
      ],
    },
  };

  function Coach() {}

  // Look up the current opening by replaying the SAN history.
  Coach.prototype.identifyOpening = function (sanList) {
    var key = sanList.join(' ');
    // Walk backward to the deepest known key.
    while (key.length >= 0) {
      if (BOOK.hasOwnProperty(key)) {
        return {key: key, entry: BOOK[key], exact: key === sanList.join(' ')};
      }
      var idx = key.lastIndexOf(' ');
      if (idx === -1) {
        if (BOOK.hasOwnProperty('')) return {key: '', entry: BOOK[''], exact: sanList.length === 0};
        break;
      }
      key = key.substring(0, idx);
    }
    return null;
  };

  // Recommend a book move for the current position, if one exists and is legal.
  Coach.prototype.bookMove = function (chess, sanList) {
    var found = this.identifyOpening(sanList);
    if (!found || !found.exact) return null;
    var legalSan = chess.moves();
    for (var i = 0; i < found.entry.moves.length; i++) {
      if (legalSan.indexOf(found.entry.moves[i]) !== -1) {
        return {san: found.entry.moves[i], name: found.entry.name, ideas: found.entry.ideas};
      }
    }
    return null;
  };

  // Central squares (indices): d4=35, e4=36, d5=27, e5=28.
  var CENTER = [27, 28, 35, 36];

  var MATE = 100000;
  var PIECE_NAME = {p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'};
  function sq(i) { return Chess.indexToSquare(i); }
  function pieceName(ch) { return ch ? PIECE_NAME[typeOf(ch)] : 'piece'; }
  function see(chess, move) { return global.ChessAI ? global.ChessAI.see(chess, move) : 0; }
  function isMateScore(s) { return Math.abs(s) > MATE - 1000; }
  function mateIn(s) { return Math.ceil((MATE - Math.abs(s)) / 2); }

  // Find a legal move object matching {from,to,promotion} in a position.
  function findLegal(chess, mv) {
    if (!mv) return null;
    var legal = chess.generateLegalMoves();
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].from === mv.from && legal[i].to === mv.to && (legal[i].promotion || null) === (mv.promotion || null)) return legal[i];
    }
    return null;
  }

  // Describe what a move accomplishes tactically ("wins the rook on a8",
  // "delivers check", "forces mate in 3"). `pos` is the position BEFORE `mv`.
  function describeGain(pos, mv, scoreForSide) {
    if (isMateScore(scoreForSide) && scoreForSide > 0) {
      var n = mateIn(scoreForSide);
      return 'forces mate' + (n > 0 ? ' in ' + n : '');
    }
    var legal = findLegal(pos, mv);
    if (legal && legal.captured) {
      var gain = see(pos, legal);
      if (gain >= 200) return 'wins the ' + pieceName(legal.captured) + ' on ' + sq(mv.to);
      if (gain >= 90) return 'wins material on ' + sq(mv.to);
    }
    return null;
  }

  // ---- Move annotation --------------------------------------------------
  // Classify + explain a move. ctx = {
  //   beforeFen, afterFen, rec, analysisBefore, analysisAfter,
  //   moverColor, plyCount }.
  // analysisBefore/After use the app's wire shape:
  //   {whiteScore, turn, bestMove:{from,to,promotion,san}, ranked:[{from,to,promotion,score,san}]}
  // Returns {type, label, glyph, cp, headline, details:[...], better, evalWhite}.
  Coach.prototype.annotate = function (ctx) {
    var rec = ctx.rec;
    var mover = ctx.moverColor;
    var before = ctx.analysisBefore;
    var after = ctx.analysisAfter;

    // Locate the played move + best move within the pre-move analysis.
    var played = null, playedRank = -1, bestScore = null, best = before && before.bestMove;
    if (before && before.ranked) {
      for (var i = 0; i < before.ranked.length; i++) {
        var e = before.ranked[i];
        if (i === 0) bestScore = e.score;
        if (e.from === rec.move.from && e.to === rec.move.to && (e.promotion || null) === (rec.move.promotion || null)) {
          played = e; playedRank = i;
        }
      }
    }
    var cpLoss = played && bestScore != null ? Math.max(0, bestScore - played.score) : 0;
    var wasBest = playedRank === 0;

    // Detect sacrifice (the move itself gives up material by the exchange).
    var beforePos = new Chess(ctx.beforeFen);
    var legalPlayed = findLegal(beforePos, rec.move);
    var isSac = false;
    if (legalPlayed) {
      // A move is a "sacrifice" if it hangs material immediately (SEE < 0 for a
      // capture, or a quiet move that leaves the moved piece takeable for less).
      if (legalPlayed.captured) isSac = see(beforePos, legalPlayed) <= -120;
      else if (after && after.bestMove) {
        var afterPos = new Chess(ctx.afterFen);
        var refute = findLegal(afterPos, after.bestMove);
        if (refute && refute.captured && refute.to === rec.move.to) isSac = see(afterPos, refute) >= 200;
      }
    }

    // Was a decisive resource available and missed?
    var bestIsMate = bestScore != null && isMateScore(bestScore) && bestScore > 0;
    var playedIsMate = played && isMateScore(played.score) && played.score > 0;
    var bestWinsBig = bestScore != null && !bestIsMate && bestScore >= 250;
    var stillWinningBig = played && played.score >= 250;

    // ---- Label ----
    var type, label, glyph;
    if (ctx.inBook) {
      type = 'book'; label = 'Book'; glyph = '📖';
    } else if (bestIsMate && !playedIsMate) {
      type = 'miss'; label = 'Missed mate'; glyph = '✗';
    } else if (bestWinsBig && !stillWinningBig && cpLoss >= 200) {
      type = 'miss'; label = 'Missed win'; glyph = '✗';
    } else if (wasBest && isSac && (played && (played.score >= 60 || isMateScore(played.score)))) {
      type = 'brilliant'; label = 'Brilliant'; glyph = '‼';
    } else if (wasBest && before && before.ranked && before.ranked.length > 1 &&
               (before.ranked[1].score - (before.ranked[0].score)) <= -180 &&
               before.ranked[0].score > -250) {
      // Only move: the second-best is far worse.
      type = 'great'; label = 'Great move'; glyph = '!';
    } else if (wasBest || cpLoss <= 10) {
      type = 'best'; label = 'Best'; glyph = '★';
    } else if (cpLoss <= 35) {
      type = 'excellent'; label = 'Excellent'; glyph = '';
    } else if (cpLoss <= 75) {
      type = 'good'; label = 'Good'; glyph = '';
    } else if (cpLoss <= 130) {
      type = 'inaccuracy'; label = 'Inaccuracy'; glyph = '?!';
    } else if (cpLoss <= 280) {
      type = 'mistake'; label = 'Mistake'; glyph = '?';
    } else {
      type = 'blunder'; label = 'Blunder'; glyph = '??';
    }

    var result = {type: type, label: label, glyph: glyph, cp: cpLoss,
      evalWhite: after ? after.whiteScore : (ctx.over ? null : (before ? before.whiteScore : 0)),
      headline: '', details: [], better: null};

    // ---- Explanation ----
    var betterSan = best ? best.san : null;

    // What did a bad move allow? Look at the opponent's best reply (afterPos).
    var allowed = null;
    if (after && after.bestMove && (type === 'blunder' || type === 'mistake' || type === 'miss' || type === 'inaccuracy')) {
      var ap = new Chess(ctx.afterFen);
      var oppScoreForOpp = after.ranked && after.ranked.length ? after.ranked[0].score : null;
      if (oppScoreForOpp != null && isMateScore(oppScoreForOpp) && oppScoreForOpp > 0) {
        allowed = 'allows ' + after.bestMove.san + ', forcing mate';
      } else {
        var oppMove = findLegal(ap, after.bestMove);
        if (oppMove && oppMove.captured && see(ap, oppMove) >= 150) {
          allowed = 'lets ' + after.bestMove.san + ' win the ' + pieceName(oppMove.captured) + ' on ' + sq(oppMove.to);
        }
      }
    }

    if (type === 'brilliant') {
      result.headline = 'Brilliant! A daring sacrifice that works.';
    } else if (type === 'great') {
      result.headline = 'Great move — the only move that keeps your position.';
    } else if (type === 'best') {
      result.headline = 'Best move — the engine\'s top choice.';
    } else if (type === 'excellent') {
      result.headline = 'Excellent — very close to the best move.';
    } else if (type === 'good') {
      result.headline = 'A good, sound move.';
    } else if (type === 'miss') {
      if (bestIsMate) result.headline = 'You missed a forced mate.';
      else result.headline = 'You missed a chance to win material.';
      if (betterSan) {
        var gainDesc = describeGain(beforePos, best, bestScore);
        result.details.push(betterSan + (gainDesc ? ' ' + gainDesc + '.' : ' was much stronger.'));
      }
    } else if (type === 'inaccuracy' || type === 'mistake' || type === 'blunder') {
      var sev = type === 'blunder' ? 'A blunder' : type === 'mistake' ? 'A mistake' : 'A slight inaccuracy';
      result.headline = sev + ' — it costs about ' + (cpLoss / 100).toFixed(1) + ' pawns.';
      if (allowed) result.details.push('It ' + allowed + '.');
      if (betterSan) {
        var gd = describeGain(beforePos, best, bestScore);
        result.details.push('Stronger was ' + betterSan + (gd ? ', which ' + gd + '.' : '.'));
      }
    }
    result.better = betterSan;

    // ---- Positional / phase notes (only when the move wasn't a blunder) ----
    if (type !== 'blunder' && type !== 'mistake' && type !== 'miss') {
      var note = this.positionalNote(ctx);
      if (note) result.details.push(note);
    }

    return result;
  };

  // A single concise positional observation about the move (phase-aware).
  Coach.prototype.positionalNote = function (ctx) {
    var rec = ctx.rec;
    var move = rec.move;
    var piece = typeOf(move.piece);
    var color = ctx.moverColor;
    var plies = ctx.plyCount;
    var beforePos = new Chess(ctx.beforeFen);
    var afterPos = new Chess(ctx.afterFen);

    // Castling.
    if (move.flags.indexOf('k') !== -1 || move.flags.indexOf('q') !== -1) {
      return 'Castling tucks your king to safety and connects your rooks — a key opening goal.';
    }

    var phase = gamePhase(afterPos);

    if (phase === 'opening') {
      var backRank = color === 'w' ? 7 : 0;
      if (piece === 'p' && CENTER.indexOf(move.to) !== -1) return 'Grabbing the center stakes out space and frees your pieces.';
      if ((piece === 'n' || piece === 'b') && rankOf(move.from) === backRank) return 'Good development — bringing a ' + PIECE_NAME[piece] + ' into play toward the center.';
      if (piece === 'q' && plies <= 6) return 'Careful developing the queen so early — it can be chased around, losing you time.';
      if (piece === 'n' && (fileOf(move.to) === 0 || fileOf(move.to) === 7)) return 'A knight on the rim is dim — it controls fewer squares at the edge.';
      if (!isDeveloped(beforePos, color) && piece === 'p' && plies > 6) return 'You still have pieces at home — prioritize developing knights and bishops and castling.';
    }

    // Rook to an open/semi-open file (any phase).
    if (piece === 'r') {
      var f = fileOf(move.to);
      if (fileOpenness(afterPos, f) === 'open') return 'Placing a rook on the open ' + fileLetter(f) + '-file is strong — open files are highways for rooks.';
      if (fileOpenness(afterPos, f) === 'semi-' + color) return 'A rook on the half-open ' + fileLetter(f) + '-file pressures the enemy pawns.';
    }

    // Passed pawn push in the endgame.
    if (phase === 'endgame') {
      if (piece === 'p') return 'In the endgame, passed pawns are gold — push them and support them with your king.';
      if (piece === 'k') return 'Activate your king in the endgame — it becomes a fighting piece.';
    }

    return null;
  };

  // Detect an immediate threat the opponent has (used on the human's turn).
  // `nullAnalysis` is the analysis of the position after the human "passes".
  // Returns a warning string, or null.
  Coach.prototype.detectThreat = function (nullFen, nullAnalysis, currentWhite, humanColor) {
    if (!nullAnalysis || !nullAnalysis.bestMove) return null;
    var beforeHuman = humanColor === 'w' ? currentWhite : -currentWhite;
    var afterHuman = humanColor === 'w' ? nullAnalysis.whiteScore : -nullAnalysis.whiteScore;
    var drop = beforeHuman - afterHuman; // how much the human loses by doing nothing
    if (drop < 150) return null;

    var pos = new Chess(nullFen);
    var oppScore = nullAnalysis.ranked && nullAnalysis.ranked.length ? nullAnalysis.ranked[0].score : null;
    if (oppScore != null && isMateScore(oppScore) && oppScore > 0) {
      return 'Watch out — your opponent threatens ' + nullAnalysis.bestMove.san + ', with a mating attack. Deal with it.';
    }
    var m = findLegal(pos, nullAnalysis.bestMove);
    if (m && m.captured && see(pos, m) >= 150) {
      return 'Careful — your opponent threatens ' + nullAnalysis.bestMove.san + ', winning the ' + pieceName(m.captured) + ' on ' + sq(m.to) + '. Defend it, move it, or create a bigger threat.';
    }
    return 'Careful — your opponent has a strong threat (' + nullAnalysis.bestMove.san + '). Look for what it attacks before you move.';
  };

  // ---- End-of-game review ------------------------------------------------
  // records: array of {san, color, quality:{type,cp}, evalWhite}
  Coach.prototype.gameReview = function (records, humanColor) {
    function acc(list) {
      if (!list.length) return 100;
      var sum = 0;
      for (var i = 0; i < list.length; i++) sum += list[i];
      var acpl = sum / list.length;
      var a = 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669;
      return Math.max(0, Math.min(100, Math.round(a)));
    }
    var sides = {w: {losses: [], counts: {}}, b: {losses: [], counts: {}}};
    var worst = null, best = null;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r.quality) continue;
      var s = sides[r.color];
      var cp = r.quality.type === 'book' ? 0 : (r.quality.cp || 0);
      s.losses.push(cp);
      s.counts[r.quality.type] = (s.counts[r.quality.type] || 0) + 1;
      if (r.color === humanColor) {
        if (!worst || cp > worst.cp) worst = {cp: cp, ply: i, san: r.san, better: r.quality.better, type: r.quality.type};
        if (r.quality.type === 'brilliant' || r.quality.type === 'great') best = {ply: i, san: r.san, type: r.quality.type};
      }
    }
    var oppColor = humanColor === 'w' ? 'b' : 'w';
    return {
      humanAccuracy: acc(sides[humanColor].losses),
      oppAccuracy: acc(sides[oppColor].losses),
      counts: sides[humanColor].counts,
      worst: worst && worst.cp >= 90 ? worst : null,
      best: best,
      moves: sides[humanColor].losses.length,
    };
  };

  // ---- Helpers ----------------------------------------------------------
  function gamePhase(chess) {
    var b = chess.board, majors = 0, queens = 0, plies = chess.history ? chess.history.length : 0;
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (!p) continue;
      var t = typeOf(p);
      if (t === 'q') queens++;
      else if (t === 'r' || t === 'b' || t === 'n') majors++;
    }
    if (queens === 0 || (queens <= 2 && majors <= 3)) return 'endgame';
    if (plies <= 16) return 'opening';
    return 'middlegame';
  }
  function isDeveloped(chess, color) {
    // True once at least three minor pieces have left their home squares.
    var home = color === 'w' ? {N: [57, 62], B: [58, 61]} : {n: [1, 6], b: [2, 5]};
    var b = chess.board, athome = 0;
    Object.keys(home).forEach(function (pc) {
      home[pc].forEach(function (idx) { if (b[idx] === pc) athome++; });
    });
    return athome <= 1;
  }
  function fileLetter(f) { return String.fromCharCode(97 + f); }
  function fileOpenness(chess, f) {
    var b = chess.board, wp = 0, bp = 0;
    for (var r = 0; r < 8; r++) { var p = b[r * 8 + f]; if (p === 'P') wp++; else if (p === 'p') bp++; }
    if (wp === 0 && bp === 0) return 'open';
    if (wp === 0) return 'semi-w';
    if (bp === 0) return 'semi-b';
    return 'closed';
  }

  // Classify a move by its centipawn loss (kept for compatibility; the richer
  // annotate() above is preferred).
  Coach.prototype.classifyLoss = function (cpLoss, wasBest) {
    if (cpLoss < 0) cpLoss = 0;
    if (wasBest || cpLoss <= 15) return {label: 'Best', type: 'best', cp: cpLoss};
    if (cpLoss <= 45) return {label: 'Good', type: 'good', cp: cpLoss};
    if (cpLoss <= 90) return {label: 'Inaccuracy', type: 'inaccuracy', cp: cpLoss};
    if (cpLoss <= 200) return {label: 'Mistake', type: 'mistake', cp: cpLoss};
    return {label: 'Blunder', type: 'blunder', cp: cpLoss};
  };

  // A friendly running list of general principles for the tips panel.
  Coach.OPENING_PRINCIPLES = [
    'Control the center with pawns (e4/d4 or e5/d5).',
    'Develop knights before bishops, toward the center.',
    'Castle early — usually within the first 10 moves.',
    "Don't move the same piece twice in the opening without a reason.",
    "Don't bring your queen out too early.",
    'Connect your rooks by clearing the back rank.',
    'Every move should develop a piece, control the center, or improve your king safety.',
  ];

  Coach.BOOK = BOOK;
  global.ChessCoach = Coach;
})(typeof window !== 'undefined' ? window : this);
