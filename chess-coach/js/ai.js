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

  // Reusable scratch buffers for evaluate() so it allocates nothing per call
  // (evaluate is the single hottest function in the search). Not reentrant,
  // which is fine — the search is single-threaded and never nests eval calls.
  var _wpf = new Int8Array(8), _bpf = new Int8Array(8);
  var _wpMin = new Int8Array(8), _wpMax = new Int8Array(8);
  var _bpMin = new Int8Array(8), _bpMax = new Int8Array(8);

  // Move offsets (mirror of the engine's) for static exchange evaluation.
  var LVA_KNIGHT = [-17, -15, -10, -6, 6, 10, 15, 17];
  var LVA_KING = [-9, -8, -7, -1, 1, 7, 8, 9];
  var LVA_BISHOP = [-9, -7, 7, 9];
  var LVA_ROOK = [-8, -1, 1, 8];

  // Square of the least-valuable `side` piece attacking `to` on board `b`
  // (re-scanned each call, so x-ray attackers behind a removed piece appear
  // naturally). Returns -1 if none.
  function leastValuableAttacker(b, to, side) {
    var tf = to & 7, i, s, sf, dir, sq, next, nf, prevf, p;
    var bestSq = -1, bestVal = Infinity;
    function consider(square, val) { if (val < bestVal) { bestVal = val; bestSq = square; } }

    if (side === 'w') {
      if (tf > 0 && to + 7 < 64 && b[to + 7] === 'P') consider(to + 7, 100);
      if (tf < 7 && to + 9 < 64 && b[to + 9] === 'P') consider(to + 9, 100);
    } else {
      if (tf < 7 && to - 7 >= 0 && b[to - 7] === 'p') consider(to - 7, 100);
      if (tf > 0 && to - 9 >= 0 && b[to - 9] === 'p') consider(to - 9, 100);
    }
    var kn = side === 'w' ? 'N' : 'n';
    for (i = 0; i < 8; i++) { s = to + LVA_KNIGHT[i]; if (s < 0 || s > 63) continue; sf = s & 7; if (sf - tf > 2 || tf - sf > 2) continue; if (b[s] === kn) consider(s, 320); }
    var bishop = side === 'w' ? 'B' : 'b', queen = side === 'w' ? 'Q' : 'q', rook = side === 'w' ? 'R' : 'r';
    for (i = 0; i < 4; i++) {
      dir = LVA_BISHOP[i]; sq = to;
      while (true) { next = sq + dir; if (next < 0 || next > 63) break; nf = next & 7; prevf = sq & 7; if (nf - prevf > 1 || prevf - nf > 1) break; p = b[next]; if (p !== null) { if (p === bishop) consider(next, 330); else if (p === queen) consider(next, 900); break; } sq = next; }
    }
    for (i = 0; i < 4; i++) {
      dir = LVA_ROOK[i]; sq = to; var horiz = dir === 1 || dir === -1;
      while (true) { next = sq + dir; if (next < 0 || next > 63) break; if (horiz && (next >> 3) !== (sq >> 3)) break; p = b[next]; if (p !== null) { if (p === rook) consider(next, 500); else if (p === queen) consider(next, 900); break; } sq = next; }
    }
    var kg = side === 'w' ? 'K' : 'k';
    for (i = 0; i < 8; i++) { s = to + LVA_KING[i]; if (s < 0 || s > 63) continue; sf = s & 7; if (sf - tf > 1 || tf - sf > 1) continue; if (b[s] === kg) consider(s, 20000); }
    return bestSq;
  }

  // Static Exchange Evaluation: the net material (mover's perspective) of the
  // capture `move`, assuming both sides recapture with least-valuable pieces.
  // Negative means the capture loses material.
  function see(chess, move) {
    var to = move.to;
    var b = chess.board.slice();
    var sideInit = colorOf(b[move.from]);
    var firstCapturedVal;
    if (move.flags.indexOf('e') !== -1) {
      firstCapturedVal = 100;
      b[sideInit === 'w' ? to + 8 : to - 8] = null;
    } else {
      firstCapturedVal = b[to] ? PIECE_VALUE[typeOf(b[to])] : 0;
    }
    var attackerValOnSquare = PIECE_VALUE[typeOf(b[move.from])];
    b[to] = b[move.from];
    b[move.from] = null;

    var gain = [firstCapturedVal];
    var d = 0;
    var side = sideInit === 'w' ? 'b' : 'w';
    while (true) {
      var f = leastValuableAttacker(b, to, side);
      if (f === -1) break;
      d++;
      gain[d] = attackerValOnSquare - gain[d - 1];
      attackerValOnSquare = PIECE_VALUE[typeOf(b[f])];
      b[to] = b[f];
      b[f] = null;
      side = side === 'w' ? 'b' : 'w';
      if (Math.max(-gain[d - 1], gain[d]) < 0) break;
    }
    while (d > 0) { gain[d - 1] = -Math.max(-gain[d - 1], gain[d]); d--; }
    return gain[0];
  }

  // Static evaluation from White's perspective (positive = White better).
  // Combines material + piece-square tables with pawn structure (doubled,
  // isolated, passed), rook files, king safety, a small mobility/tempo term and
  // the bishop pair. An optional `style` reshapes it into a personality:
  //   material — multiplier on the raw material+PST balance
  //   position — multiplier on the positional terms
  //   attack   — weight on piece pressure toward the enemy king (both sides),
  //              so an aggressive engine will sacrifice material for an attack.
  function evaluate(chess, style) {
    var board = chess.board;
    var base = 0; // material + piece-square tables (kings added after phase known)
    var positional = 0; // structure, king safety, rook files, bishop pair
    var i, p, t, f, r;
    var wb = 0, bb = 0, wk = -1, bk = -1;
    var queens = 0, majorMinor = 0;

    _wpf.fill(0); _bpf.fill(0);
    _wpMin.fill(8); _wpMax.fill(-1); _bpMin.fill(8); _bpMax.fill(-1);

    for (i = 0; i < 64; i++) {
      p = board[i];
      if (p === null) continue;
      f = i & 7; r = i >> 3;
      if (p < 'a') { // white piece (uppercase)
        switch (p) {
          case 'P': base += 100 + PST.p[i]; _wpf[f]++; if (r < _wpMin[f]) _wpMin[f] = r; if (r > _wpMax[f]) _wpMax[f] = r; break;
          case 'N': base += 320 + PST.n[i]; majorMinor++; break;
          case 'B': base += 330 + PST.b[i]; wb++; majorMinor++; break;
          case 'R': base += 500 + PST.r[i]; majorMinor++; break;
          case 'Q': base += 900 + PST.q[i]; queens++; break;
          case 'K': wk = i; break;
        }
      } else { // black piece (lowercase)
        var mi = ((7 - r) << 3) + f; // mirror index
        switch (p) {
          case 'p': base -= 100 + PST.p[mi]; _bpf[f]++; if (r < _bpMin[f]) _bpMin[f] = r; if (r > _bpMax[f]) _bpMax[f] = r; break;
          case 'n': base -= 320 + PST.n[mi]; majorMinor++; break;
          case 'b': base -= 330 + PST.b[mi]; bb++; majorMinor++; break;
          case 'r': base -= 500 + PST.r[mi]; majorMinor++; break;
          case 'q': base -= 900 + PST.q[mi]; queens++; break;
          case 'k': bk = i; break;
        }
      }
    }

    var endgame = queens === 0 || (queens <= 2 && majorMinor <= 2);
    if (wk >= 0) base += (endgame ? PST.kEnd : PST.k)[wk];
    if (bk >= 0) base -= (endgame ? PST.kEnd : PST.k)[((7 - (bk >> 3)) << 3) + (bk & 7)];

    if (wb >= 2) positional += 30;
    if (bb >= 2) positional -= 30;

    // Pawn structure: doubled, isolated, passed (all from the file tables).
    for (f = 0; f < 8; f++) {
      if (_wpf[f] > 1) positional -= 12 * (_wpf[f] - 1);
      if (_bpf[f] > 1) positional += 12 * (_bpf[f] - 1);
      if (_wpf[f] > 0 && (f === 0 || _wpf[f - 1] === 0) && (f === 7 || _wpf[f + 1] === 0)) positional -= 14 * _wpf[f];
      if (_bpf[f] > 0 && (f === 0 || _bpf[f - 1] === 0) && (f === 7 || _bpf[f + 1] === 0)) positional += 14 * _bpf[f];
      // White passed pawn (its most advanced pawn on this file).
      if (_wpf[f] > 0) {
        var wr = _wpMin[f]; // smaller rank = more advanced for White
        var lf = f === 0 ? 8 : _bpMin[f - 1], mf = _bpMin[f], rf2 = f === 7 ? 8 : _bpMin[f + 1];
        if (lf >= wr && mf >= wr && rf2 >= wr) positional += 12 + (6 - wr) * 8;
      }
      // Black passed pawn.
      if (_bpf[f] > 0) {
        var br = _bpMax[f]; // larger rank = more advanced for Black
        var lfb = f === 0 ? -1 : _wpMax[f - 1], mfb = _wpMax[f], rfb = f === 7 ? -1 : _wpMax[f + 1];
        if (lfb <= br && mfb <= br && rfb <= br) positional -= 12 + (br - 1) * 8;
      }
    }

    // Rooks on open / semi-open files.
    for (i = 0; i < 64; i++) {
      p = board[i];
      if (p === 'R') { f = i & 7; if (_wpf[f] === 0) positional += _bpf[f] === 0 ? 20 : 10; }
      else if (p === 'r') { f = i & 7; if (_bpf[f] === 0) positional -= _wpf[f] === 0 ? 20 : 10; }
    }

    // King safety: pawn shield on the king's file and neighbours (middlegame).
    if (!endgame) {
      if (wk >= 0) {
        var wkf = wk & 7, wsh = 0;
        if (wkf > 0) wsh += _wpf[wkf - 1] > 0 ? 1 : -1;
        wsh += _wpf[wkf] > 0 ? 1 : -1;
        if (wkf < 7) wsh += _wpf[wkf + 1] > 0 ? 1 : -1;
        positional += wsh * 10;
      }
      if (bk >= 0) {
        var bkf = bk & 7, bsh = 0;
        if (bkf > 0) bsh += _bpf[bkf - 1] > 0 ? 1 : -1;
        bsh += _bpf[bkf] > 0 ? 1 : -1;
        if (bkf < 7) bsh += _bpf[bkf + 1] > 0 ? 1 : -1;
        positional -= bsh * 10;
      }
    }

    // Small tempo bonus for the side to move.
    var tempo = chess.turn === 'w' ? 10 : -10;

    if (!style) return base + positional + tempo;

    var matMul = style.material == null ? 1 : style.material;
    var posMul = style.position == null ? 1 : style.position;
    var attackW = style.attack || 0;
    var score = base * matMul + positional * posMul + tempo;

    if (attackW !== 0 && wk >= 0 && bk >= 0) {
      var whiteAttack = 0, blackAttack = 0;
      for (i = 0; i < 64; i++) {
        p = board[i];
        if (p === null) continue;
        t = typeOf(p);
        if (t === 'k' || t === 'p') continue;
        if (colorOf(p) === 'w') whiteAttack += (7 - chebyshev(i, bk)) * TROPISM[t];
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
    {name: 'Beginner', elo: 600, maxDepth: 2, timeMs: 200, blunderChance: 0.33, noise: 90, quiescence: false},
    {name: 'Casual', elo: 1000, maxDepth: 3, timeMs: 400, blunderChance: 0.15, noise: 55, quiescence: false},
    {name: 'Intermediate', elo: 1400, maxDepth: 4, timeMs: 700, blunderChance: 0.06, noise: 28, quiescence: true},
    {name: 'Advanced', elo: 1800, maxDepth: 6, timeMs: 1300, blunderChance: 0.015, noise: 12, quiescence: true},
    {name: 'Expert', elo: 2100, maxDepth: 8, timeMs: 2200, blunderChance: 0.0, noise: 4, quiescence: true},
    {name: 'Grandmaster', elo: 2500, maxDepth: 12, timeMs: 3000, blunderChance: 0.0, noise: 0, quiescence: true},
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

  function other(c) {
    return c === 'w' ? 'b' : 'w';
  }
  function sameMove(m, k) {
    return !!k && m.from === k.from && m.to === k.to && (m.promotion || null) === (k.promotion || null);
  }

  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  AI.prototype.checkTime = function () {
    if ((this.nodes & 1023) === 0 && Date.now() >= this.deadline) {
      this.timedOut = true;
    }
    return this.timedOut;
  };

  // Order moves in place: transposition-table move, then captures (MVV-LVA),
  // promotions, killer moves, and finally by the history heuristic.
  AI.prototype.orderMoves = function (moves, ttMove, ply) {
    var hist = this.hist;
    var killers = this.killers[ply];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], s = 0;
      if (ttMove && sameMove(m, ttMove)) s = 2e9;
      else if (m.captured) s = 1e6 + 10 * PIECE_VALUE[typeOf(m.captured)] - PIECE_VALUE[typeOf(m.piece)];
      else if (m.promotion) s = 9e5 + PIECE_VALUE[typeOf(m.promotion)];
      else if (killers && sameMove(m, killers[0])) s = 8e5;
      else if (killers && sameMove(m, killers[1])) s = 7.9e5;
      else s = hist[m.from * 64 + m.to] || 0;
      m._o = s;
    }
    moves.sort(function (a, b) { return b._o - a._o; });
  };

  AI.prototype.addKiller = function (ply, m) {
    var k = this.killers[ply] || (this.killers[ply] = [null, null]);
    if (sameMove(m, k[0])) return;
    k[1] = k[0];
    k[0] = {from: m.from, to: m.to, promotion: m.promotion};
  };

  // Does `color` have any non-pawn, non-king material? Used to disable null-move
  // pruning in likely-zugzwang endgames (where passing is not truly harmless).
  AI.prototype.hasNonPawn = function (chess, color) {
    var b = chess.board;
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (p === null) continue;
      if (colorOf(p) === color) {
        var t = typeOf(p);
        if (t === 'n' || t === 'b' || t === 'r' || t === 'q') return true;
      }
    }
    return false;
  };

  // Quiescence search: only extend captures/promotions to reach a "quiet"
  // position, so the evaluation isn't taken in the middle of a trade.
  AI.prototype.quiescence = function (chess, alpha, beta, color) {
    this.nodes++;
    if (this.checkTime()) return color === 'w' ? evaluate(chess, this.style) : -evaluate(chess, this.style);
    var standPat = color === 'w' ? evaluate(chess, this.style) : -evaluate(chess, this.style);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;

    // Pseudo-legal captures/promotions only, with lazy legality checking.
    var moves = chess.generatePseudoMoves(color);
    var caps = [];
    for (var k = 0; k < moves.length; k++) {
      if (moves[k].captured || moves[k].promotion) caps.push(moves[k]);
    }
    this.orderMoves(caps, null, 0);
    var enemy = other(color);
    var kingBefore = chess.kingIndex(color);
    for (var i = 0; i < caps.length; i++) {
      var m = caps[i];
      // SEE pruning: skip captures that lose material by the exchange (a
      // promotion capture is always tried — its value isn't captured material).
      if (m.captured && !m.promotion && see(chess, m) < 0) continue;
      var undo = chess._makeMove(m);
      var ks = typeOf(m.piece) === 'k' ? m.to : kingBefore;
      if (chess.isSquareAttacked(ks, enemy)) { chess._undoMove(undo); continue; }
      var score = -this.quiescence(chess, -beta, -alpha, enemy);
      chess._undoMove(undo);
      if (this.timedOut) return alpha;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  // Negamax with alpha-beta, a transposition table, principal-variation search,
  // and killer/history move ordering. `ply` is the distance from the root (used
  // for mate-distance scoring and killer indexing).
  AI.prototype.negamax = function (chess, depth, alpha, beta, color, ply) {
    this.nodes++;
    if (this.checkTime()) return alpha;

    var alphaOrig = alpha;
    var key = chess.hash;
    var tt = this.tt.get(key);
    var ttMove = null;
    if (tt) {
      ttMove = tt.move;
      if (tt.depth >= depth) {
        var s = tt.score;
        if (s > MATE - 1000) s -= ply; else if (s < -(MATE - 1000)) s += ply;
        if (tt.flag === TT_EXACT) return s;
        if (tt.flag === TT_LOWER && s >= beta) return s;
        if (tt.flag === TT_UPPER && s <= alpha) return s;
      }
    }

    if (depth <= 0) {
      if (this.level.quiescence) return this.quiescence(chess, alpha, beta, color);
      return color === 'w' ? evaluate(chess, this.style) : -evaluate(chess, this.style);
    }

    var enemy = other(color);
    var kingBefore = chess.kingIndex(color);
    var inCheck = chess.isSquareAttacked(kingBefore, enemy);

    // Check extension: search one ply deeper when in check (tactics/mates).
    if (inCheck) depth++;

    // Null-move pruning: if we can "pass" and still be >= beta at reduced depth,
    // this node is so good it can be pruned. Skipped in check, in likely-
    // zugzwang endgames (no non-pawn material), and near mate bounds.
    if (!inCheck && depth >= 3 && beta < MATE - 1000 && beta > -(MATE - 1000) && this.hasNonPawn(chess, color)) {
      var un = chess.makeNullMove();
      var R = depth > 6 ? 3 : 2;
      var nullScore = -this.negamax(chess, depth - 1 - R, -beta, -beta + 1, enemy, ply + 1);
      chess.undoNullMove(un);
      if (this.timedOut) return alpha;
      if (nullScore >= beta) return beta;
    }

    // Pseudo-legal moves, ordered; legality is verified lazily below so a beta
    // cutoff avoids checking the legality of moves we never search.
    var moves = chess.generatePseudoMoves(color);
    this.orderMoves(moves, ttMove, ply);

    var best = -Infinity, bestMove = null, legal = 0;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var undo = chess._makeMove(m);
      var ks = typeOf(m.piece) === 'k' ? m.to : kingBefore;
      if (chess.isSquareAttacked(ks, enemy)) { // move leaves own king in check
        chess._undoMove(undo);
        continue;
      }
      legal++;
      var quiet = !m.captured && !m.promotion;
      var score;
      if (legal === 1) {
        score = -this.negamax(chess, depth - 1, -beta, -alpha, enemy, ply + 1);
      } else {
        // Late-move reduction: search quiet, late moves shallower first.
        var red = 0;
        if (quiet && !inCheck && depth >= 3 && legal > 3) red = legal > 6 ? 2 : 1;
        score = -this.negamax(chess, depth - 1 - red, -alpha - 1, -alpha, enemy, ply + 1);
        if (red > 0 && score > alpha && !this.timedOut) {
          score = -this.negamax(chess, depth - 1, -alpha - 1, -alpha, enemy, ply + 1);
        }
        if (score > alpha && score < beta && !this.timedOut) {
          score = -this.negamax(chess, depth - 1, -beta, -alpha, enemy, ply + 1);
        }
      }
      chess._undoMove(undo);
      if (this.timedOut) return best > -Infinity ? best : alpha;
      if (score > best) { best = score; bestMove = m; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        if (quiet) {
          this.addKiller(ply, m);
          this.hist[m.from * 64 + m.to] += depth * depth;
        }
        break;
      }
    }

    if (legal === 0) { // no legal moves: checkmate or stalemate
      return inCheck ? -(MATE - ply) : 0;
    }

    // Store in the transposition table (with mate-distance-relative score).
    var flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    var storeScore = best;
    if (storeScore > MATE - 1000) storeScore += ply; else if (storeScore < -(MATE - 1000)) storeScore -= ply;
    if (this.tt.size > 700000) this.tt.clear();
    this.tt.set(key, {
      depth: depth, flag: flag, score: storeScore,
      move: bestMove ? {from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion} : null,
    });
    return best;
  };

  // Search the root position with iterative deepening under a time budget.
  // Options: {maxDepth, timeMs, noise}. Returns the best move, its score, a
  // ranked list of root moves, and node stats. The TT and previous-iteration
  // ordering make each deeper pass fast and the move returned on timeout the
  // best from the last fully-searched depth.
  AI.prototype.search = function (chess, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth != null ? opts.maxDepth : this.level.maxDepth;
    var timeMs = opts.timeMs != null ? opts.timeMs : this.level.timeMs;
    var noise = opts.noise != null ? opts.noise : 0;

    this.nodes = 0;
    this.timedOut = false;
    this.deadline = timeMs > 0 ? Date.now() + timeMs : Infinity;
    // The transposition table persists across moves (depth-preferred entries
    // stay useful); killers/history are per-search. Cap TT memory periodically.
    if (!this.tt || this.tt.size > 600000) this.tt = new Map();
    this.hist = new Int32Array(64 * 64);
    this.killers = [];

    var color = chess.turn;
    var enemy = other(color);
    var aspiration = !!opts.aspiration;
    var rootMoves = chess.generateLegalMoves();
    if (rootMoves.length === 0) return null;

    var self = this;
    var completed = rootMoves.map(function (m) { return {move: m, score: 0}; });

    // Search all root moves once at `depth` within the (alpha0, beta0) window.
    function runRoot(depth, alpha0, beta0) {
      var iter = [];
      var alpha = alpha0, beta = beta0, aborted = false;
      for (var i = 0; i < rootMoves.length; i++) {
        var undo = chess._makeMove(rootMoves[i]);
        var score;
        if (i === 0) {
          score = -self.negamax(chess, depth - 1, -beta, -alpha, enemy, 1);
        } else {
          score = -self.negamax(chess, depth - 1, -alpha - 1, -alpha, enemy, 1);
          if (score > alpha && score < beta && !self.timedOut) {
            score = -self.negamax(chess, depth - 1, -beta, -alpha, enemy, 1);
          }
        }
        chess._undoMove(undo);
        if (self.timedOut) { aborted = true; break; }
        iter.push({move: rootMoves[i], score: score});
        if (score > alpha) alpha = score;
      }
      if (!aborted) iter.sort(function (a, b) { return b.score - a.score; });
      return {iter: iter, aborted: aborted};
    }

    var lastScore = 0;
    for (var depth = 1; depth <= maxDepth; depth++) {
      var res;
      if (aspiration && depth >= 4) {
        // Search a narrow window around the previous score; on a fail, re-search
        // with the full window. Narrow windows prune far more.
        var a = lastScore - 50, b = lastScore + 50;
        res = runRoot(depth, a, b);
        if (!res.aborted) {
          var bs = res.iter[0].score;
          if (bs <= a || bs >= b) res = runRoot(depth, -Infinity, Infinity);
        }
      } else {
        res = runRoot(depth, -Infinity, Infinity);
      }

      if (res.aborted) break; // keep the previous depth's complete result

      completed = res.iter;
      rootMoves = completed.map(function (x) { return x.move; });
      lastScore = completed[0].score;
      this.lastDepth = depth;

      if (Math.abs(completed[0].score) > MATE - 1000) break; // forced mate found
      if (this.timedOut) break;
    }

    // Apply evaluation noise for weaker levels (kept out of the search itself).
    var ranked = completed.slice();
    if (noise > 0) {
      ranked = ranked.map(function (r) {
        return {move: r.move, score: r.score + Math.floor((Math.random() * 2 - 1) * noise)};
      });
      ranked.sort(function (a, b) { return b.score - a.score; });
    }

    return {best: ranked[0].move, score: ranked[0].score, ranked: ranked, nodes: this.nodes};
  };

  // ---- Opening book (shared, built from the opening library) ------------
  var BOOK = null;
  function getBook() {
    if (BOOK) return BOOK;
    BOOK = {};
    var CO = global.ChessOpenings;
    if (!CO) return BOOK;
    function add(moves) {
      for (var i = 0; i < moves.length; i++) {
        var key = moves.slice(0, i).join(' ');
        (BOOK[key] || (BOOK[key] = [])).push(moves[i]);
      }
    }
    CO.OPENINGS.forEach(function (o) { add(o.moves); });
    CO.SPECIALIST.forEach(function (o) { add(o.moves); });
    // Collapse duplicates into weighted candidates.
    Object.keys(BOOK).forEach(function (key) {
      var counts = {};
      BOOK[key].forEach(function (san) { counts[san] = (counts[san] || 0) + 1; });
      BOOK[key] = Object.keys(counts).map(function (san) { return {san: san, w: counts[san]}; });
    });
    return BOOK;
  }

  // Bias which opening families a style prefers (mainly the first move or two).
  function styleBookWeight(style, san) {
    if (!style) return 1;
    var k = style.key;
    if (k === 'aggressive' || k === 'tactical') {
      if (san === 'e4') return 3;
      if (san === 'f4') return k === 'tactical' ? 3 : 1.4;
      if (san === 'd4' || san === 'c4' || san === 'Nf3') return 0.6;
    } else if (k === 'positional' || k === 'defensive') {
      if (san === 'd4' || san === 'c4') return 3;
      if (san === 'Nf3') return 1.6;
      if (san === 'e4') return 0.6;
    }
    return 1;
  }

  // Choose a book move (weighted by frequency and style) for the current
  // position, or null if out of book.
  AI.prototype.bookMove = function (chess, sanHistory) {
    if (!sanHistory || sanHistory.length > 14) return null;
    var book = getBook();
    var cands = book[sanHistory.join(' ')];
    if (!cands || !cands.length) return null;

    var legal = chess.generateLegalMoves();
    var options = [], total = 0;
    for (var ci = 0; ci < cands.length; ci++) {
      for (var j = 0; j < legal.length; j++) {
        if (chess.toSan(legal[j]).replace(/[+#]$/, '') === cands[ci].san) {
          var w = cands[ci].w * styleBookWeight(this.style, cands[ci].san);
          options.push({move: legal[j], w: w});
          total += w;
          break;
        }
      }
    }
    if (!options.length) return null;
    var r = Math.random() * total;
    for (var oi = 0; oi < options.length; oi++) {
      r -= options[oi].w;
      if (r <= 0) return options[oi].move;
    }
    return options[0].move;
  };

  AI.prototype.chooseMove = function (chess, sanHistory, opts) {
    var legal = chess.generateLegalMoves();
    if (legal.length === 0) return null;

    // A specialist follows its chosen opening line while the game matches it.
    var chosen = this.followChosenOpening(chess, sanHistory);
    if (chosen) return chosen;

    // Otherwise consult the shared opening book (varied, principled theory).
    var book = this.bookMove(chess, sanHistory);
    if (book) return book;

    // Deliberate blunder: pick a random legal move (weak levels only).
    if (this.level.blunderChance > 0 && Math.random() < this.level.blunderChance) {
      return legal[Math.floor(Math.random() * legal.length)];
    }

    var sopts = {noise: this.level.noise || 0, aspiration: true};
    if (opts && opts.timeMs) sopts.timeMs = opts.timeMs;
    var result = this.search(chess, sopts);
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
