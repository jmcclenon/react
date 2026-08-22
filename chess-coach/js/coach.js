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
  var EXTENDED_CENTER = [18, 19, 20, 21, 26, 29, 34, 37, 42, 43, 44, 45];

  // Evaluate a human move against opening/positional principles.
  // `beforeChess` is the position before the move; `record` is the move record.
  // `moveNumber` is the full-move count. Returns an array of tip strings.
  Coach.prototype.principleTips = function (beforeChess, record, plyCount) {
    var tips = [];
    var move = record.move;
    var piece = typeOf(move.piece);
    var color = record.color;
    var toRank = rankOf(move.to);
    var fromRank = rankOf(move.from);
    var isOpening = plyCount <= 20;

    // Castling is praised.
    if (move.flags.indexOf('k') !== -1 || move.flags.indexOf('q') !== -1) {
      tips.push({type: 'good', text: 'Castling early tucks your king into safety and connects your rooks. Well done.'});
      return tips;
    }

    if (isOpening) {
      // Center pawn moves.
      if (piece === 'p' && CENTER.indexOf(move.to) !== -1) {
        tips.push({type: 'good', text: 'Occupying the center with a pawn grabs space and opens lines for your pieces.'});
      }

      // Developing a minor piece off the back rank.
      var backRank = color === 'w' ? 7 : 0;
      if ((piece === 'n' || piece === 'b') && fromRank === backRank) {
        tips.push({type: 'good', text: 'Developing a ' + (piece === 'n' ? 'knight' : 'bishop') + ' toward the center is exactly what the opening calls for.'});
      }

      // Early queen sortie.
      if (piece === 'q' && plyCount <= 6) {
        tips.push({type: 'warn', text: 'Bringing the queen out this early can expose it — opponents develop with tempo by attacking it. Develop knights and bishops first.'});
      }

      // Moving the same piece twice in the opening (rook-pawn/edge moves).
      if (piece === 'p' && (fileOf(move.to) === 0 || fileOf(move.to) === 7) && plyCount <= 8) {
        tips.push({type: 'warn', text: 'Edge-pawn moves rarely help development in the opening. Prioritize center pawns and minor pieces.'});
      }

      // Knight to the rim.
      if (piece === 'n' && (fileOf(move.to) === 0 || fileOf(move.to) === 7)) {
        tips.push({type: 'warn', text: '"A knight on the rim is dim." Knights are far stronger near the center where they control more squares.'});
      }
    }

    return tips;
  };

  // Classify a move by its centipawn loss: how much worse the played move's
  // evaluation is than the best available move, both scored from the mover's
  // perspective at the same depth (so there is no side-to-move parity bias).
  // `cpLoss` is >= 0; `wasBest` is true when the top engine move was played.
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
