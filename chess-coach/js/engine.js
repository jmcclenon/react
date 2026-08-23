/*
 * engine.js — A self-contained chess rules engine.
 *
 * Board representation: a 64-length array indexed 0..63, where index 0 is a8
 * (top-left from White's view) and index 63 is h1. index = rank * 8 + file,
 * with rank 0 = the 8th rank and file 0 = the a-file.
 *
 * Pieces are single characters: uppercase = White (PNBRQK), lowercase = Black
 * (pnbrqk), and null = empty square.
 *
 * The engine exposes a `Chess` class with a small, familiar API (move, moves,
 * undo, fen, turn, isCheck, isCheckmate, isStalemate, ...). It is intentionally
 * dependency-free so the whole app can run from a static file:// URL.
 */
(function (global) {
  'use strict';

  var WHITE = 'w';
  var BLACK = 'b';

  var START_FEN =
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Offsets are in "index" units on the 8x8 board.
  var KNIGHT_OFFSETS = [-17, -15, -10, -6, 6, 10, 15, 17];
  var KING_OFFSETS = [-9, -8, -7, -1, 1, 7, 8, 9];
  var BISHOP_DIRS = [-9, -7, 7, 9];
  var ROOK_DIRS = [-8, -1, 1, 8];
  var QUEEN_DIRS = [-9, -8, -7, -1, 1, 7, 8, 9];

  function fileOf(sq) {
    return sq & 7;
  }
  function rankOf(sq) {
    return sq >> 3;
  }
  function isWhitePiece(p) {
    return p !== null && p >= 'A' && p <= 'Z';
  }
  function isBlackPiece(p) {
    return p !== null && p >= 'a' && p <= 'z';
  }
  function colorOf(p) {
    if (p === null) return null;
    return isWhitePiece(p) ? WHITE : BLACK;
  }
  function typeOf(p) {
    return p === null ? null : p.toLowerCase();
  }

  // Convert between algebraic square names and indices.
  function squareToIndex(name) {
    var file = name.charCodeAt(0) - 97; // 'a'
    var rank = 8 - parseInt(name[1], 10);
    return rank * 8 + file;
  }
  function indexToSquare(sq) {
    var file = fileOf(sq);
    var rank = rankOf(sq);
    return String.fromCharCode(97 + file) + (8 - rank);
  }

  // True if moving from `from` by `offset` stays a legal king/knight step
  // (i.e. does not wrap around the board edges). We validate by checking the
  // file distance is within the piece's reach.
  function withinBoard(from, to, maxFileDelta) {
    if (to < 0 || to > 63) return false;
    var df = Math.abs(fileOf(to) - fileOf(from));
    return df <= maxFileDelta;
  }

  // ---- Zobrist hashing --------------------------------------------------
  // A 32-bit position hash maintained incrementally on make/undo, used by the
  // AI's transposition table. Kept as an unsigned 32-bit int throughout.
  function rand32() {
    return (Math.random() * 0x100000000) >>> 0;
  }
  var ZOB = {pieces: {}, side: rand32(), castling: {}, ep: []};
  'PNBRQKpnbrqk'.split('').forEach(function (pc) {
    ZOB.pieces[pc] = [];
    for (var i = 0; i < 64; i++) ZOB.pieces[pc][i] = rand32();
  });
  ['K', 'Q', 'k', 'q'].forEach(function (r) {
    ZOB.castling[r] = rand32();
  });
  for (var _f = 0; _f < 8; _f++) ZOB.ep[_f] = rand32();

  function Chess(fen) {
    this.board = new Array(64).fill(null);
    this.turn = WHITE;
    this.castling = {K: false, Q: false, k: false, q: false};
    this.epSquare = null; // index of en-passant target square, or null
    this.halfmoves = 0;
    this.fullmoves = 1;
    this.history = [];
    this.hash = 0;
    this.load(fen || START_FEN);
  }

  // Recompute the full Zobrist hash from the current position.
  Chess.prototype.computeHash = function () {
    var h = 0;
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      if (p !== null) h = (h ^ ZOB.pieces[p][i]) >>> 0;
    }
    if (this.turn === BLACK) h = (h ^ ZOB.side) >>> 0;
    if (this.castling.K) h = (h ^ ZOB.castling.K) >>> 0;
    if (this.castling.Q) h = (h ^ ZOB.castling.Q) >>> 0;
    if (this.castling.k) h = (h ^ ZOB.castling.k) >>> 0;
    if (this.castling.q) h = (h ^ ZOB.castling.q) >>> 0;
    if (this.epSquare !== null) h = (h ^ ZOB.ep[fileOf(this.epSquare)]) >>> 0;
    return h >>> 0;
  };

  Chess.WHITE = WHITE;
  Chess.BLACK = BLACK;
  Chess.START_FEN = START_FEN;

  Chess.prototype.load = function (fen) {
    var parts = fen.trim().split(/\s+/);
    var placement = parts[0];
    this.board = new Array(64).fill(null);
    var rows = placement.split('/');
    for (var r = 0; r < 8; r++) {
      var row = rows[r];
      var file = 0;
      for (var i = 0; i < row.length; i++) {
        var c = row[i];
        if (c >= '1' && c <= '8') {
          file += parseInt(c, 10);
        } else {
          this.board[r * 8 + file] = c;
          file++;
        }
      }
    }
    this.turn = parts[1] === BLACK ? BLACK : WHITE;
    var cast = parts[2] || '-';
    this.castling = {
      K: cast.indexOf('K') !== -1,
      Q: cast.indexOf('Q') !== -1,
      k: cast.indexOf('k') !== -1,
      q: cast.indexOf('q') !== -1,
    };
    this.epSquare = parts[3] && parts[3] !== '-' ? squareToIndex(parts[3]) : null;
    this.halfmoves = parts[4] ? parseInt(parts[4], 10) : 0;
    this.fullmoves = parts[5] ? parseInt(parts[5], 10) : 1;
    this.history = [];
    this.hash = this.computeHash();
  };

  Chess.prototype.fen = function () {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var row = '';
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = this.board[r * 8 + f];
        if (p === null) {
          empty++;
        } else {
          if (empty > 0) {
            row += empty;
            empty = 0;
          }
          row += p;
        }
      }
      if (empty > 0) row += empty;
      rows.push(row);
    }
    var cast =
      (this.castling.K ? 'K' : '') +
      (this.castling.Q ? 'Q' : '') +
      (this.castling.k ? 'k' : '') +
      (this.castling.q ? 'q' : '');
    if (cast === '') cast = '-';
    var ep = this.epSquare === null ? '-' : indexToSquare(this.epSquare);
    return (
      rows.join('/') +
      ' ' +
      this.turn +
      ' ' +
      cast +
      ' ' +
      ep +
      ' ' +
      this.halfmoves +
      ' ' +
      this.fullmoves
    );
  };

  Chess.prototype.get = function (square) {
    return this.board[typeof square === 'string' ? squareToIndex(square) : square];
  };

  Chess.prototype.kingIndex = function (color) {
    var target = color === WHITE ? 'K' : 'k';
    for (var i = 0; i < 64; i++) {
      if (this.board[i] === target) return i;
    }
    return -1;
  };

  // Is `square` attacked by any piece of `byColor`?
  // Hot path — kept allocation-free with inlined file/rank math (x & 7, x >> 3).
  Chess.prototype.isSquareAttacked = function (square, byColor) {
    var board = this.board;
    var sf = square & 7;
    var white = byColor === WHITE;
    var p, next, nf, prevf;

    // Pawn attacks.
    if (white) {
      if (sf > 0 && square + 7 < 64 && board[square + 7] === 'P') return true;
      if (sf < 7 && square + 9 < 64 && board[square + 9] === 'P') return true;
    } else {
      if (sf < 7 && square - 7 >= 0 && board[square - 7] === 'p') return true;
      if (sf > 0 && square - 9 >= 0 && board[square - 9] === 'p') return true;
    }

    // Knight attacks.
    var knight = white ? 'N' : 'n';
    for (var i = 0; i < 8; i++) {
      next = square + KNIGHT_OFFSETS[i];
      if (next < 0 || next > 63) continue;
      nf = next & 7;
      if (nf - sf > 2 || sf - nf > 2) continue; // wrapped
      if (board[next] === knight) return true;
    }

    // King attacks.
    var king = white ? 'K' : 'k';
    for (i = 0; i < 8; i++) {
      next = square + KING_OFFSETS[i];
      if (next < 0 || next > 63) continue;
      nf = next & 7;
      if (nf - sf > 1 || sf - nf > 1) continue; // wrapped
      if (board[next] === king) return true;
    }

    // Sliding: bishop/queen on diagonals.
    var bishop = white ? 'B' : 'b';
    var queen = white ? 'Q' : 'q';
    for (i = 0; i < 4; i++) {
      var dir = BISHOP_DIRS[i];
      var sq = square;
      while (true) {
        next = sq + dir;
        if (next < 0 || next > 63) break;
        nf = next & 7;
        prevf = sq & 7;
        if (nf - prevf > 1 || prevf - nf > 1) break; // wrapped
        p = board[next];
        if (p !== null) {
          if (p === bishop || p === queen) return true;
          break;
        }
        sq = next;
      }
    }
    // Sliding: rook/queen on ranks & files.
    var rook = white ? 'R' : 'r';
    for (i = 0; i < 4; i++) {
      var rdir = ROOK_DIRS[i];
      var rsq = square;
      var horiz = rdir === 1 || rdir === -1;
      while (true) {
        next = rsq + rdir;
        if (next < 0 || next > 63) break;
        if (horiz && (next >> 3) !== (rsq >> 3)) break; // stay on rank
        p = board[next];
        if (p !== null) {
          if (p === rook || p === queen) return true;
          break;
        }
        rsq = next;
      }
    }

    return false;
  };

  Chess.prototype.isCheck = function (color) {
    color = color || this.turn;
    var k = this.kingIndex(color);
    if (k === -1) return false;
    return this.isSquareAttacked(k, color === WHITE ? BLACK : WHITE);
  };

  // Null move: pass the turn to the opponent (used by null-move pruning in the
  // search). Clears the en-passant square and updates the hash accordingly.
  Chess.prototype.makeNullMove = function () {
    var undo = {epSquare: this.epSquare, hash: this.hash, turn: this.turn, halfmoves: this.halfmoves};
    if (this.epSquare !== null) this.hash = (this.hash ^ ZOB.ep[fileOf(this.epSquare)]) >>> 0;
    this.hash = (this.hash ^ ZOB.side) >>> 0;
    this.epSquare = null;
    this.halfmoves++;
    this.turn = this.turn === WHITE ? BLACK : WHITE;
    return undo;
  };
  Chess.prototype.undoNullMove = function (undo) {
    this.epSquare = undo.epSquare;
    this.hash = undo.hash;
    this.turn = undo.turn;
    this.halfmoves = undo.halfmoves;
  };

  // Generate pseudo-legal moves for the side to move (or given color).
  // Each move: {from, to, piece, captured, promotion, flags}
  // flags: 'n' normal, 'c' capture, 'b' big pawn (2 sq), 'e' en passant,
  //        'p' promotion, 'k' kingside castle, 'q' queenside castle
  Chess.prototype.generatePseudoMoves = function (color) {
    color = color || this.turn;
    var board = this.board;
    var moves = [];
    var i, j, to, from, p;

    for (from = 0; from < 64; from++) {
      p = board[from];
      if (p === null || colorOf(p) !== color) continue;
      var t = typeOf(p);

      if (t === 'p') {
        this._pawnMoves(from, color, moves);
      } else if (t === 'n') {
        for (i = 0; i < KNIGHT_OFFSETS.length; i++) {
          to = from + KNIGHT_OFFSETS[i];
          if (!withinBoard(from, to, 2)) continue;
          this._addStep(from, to, p, color, moves);
        }
      } else if (t === 'k') {
        for (i = 0; i < KING_OFFSETS.length; i++) {
          to = from + KING_OFFSETS[i];
          if (!withinBoard(from, to, 1)) continue;
          this._addStep(from, to, p, color, moves);
        }
        this._castlingMoves(from, color, moves);
      } else {
        var dirs =
          t === 'b' ? BISHOP_DIRS : t === 'r' ? ROOK_DIRS : QUEEN_DIRS;
        for (i = 0; i < dirs.length; i++) {
          var dir = dirs[i];
          var sq = from;
          while (true) {
            var next = sq + dir;
            if (next < 0 || next > 63) break;
            // prevent horizontal/diagonal wrap
            var fd = Math.abs(fileOf(next) - fileOf(sq));
            if (dir === 1 || dir === -1) {
              if (rankOf(next) !== rankOf(sq)) break;
            } else if (dir === 8 || dir === -8) {
              if (fd !== 0) break;
            } else {
              if (fd !== 1) break;
            }
            var tp = board[next];
            if (tp === null) {
              moves.push({from: from, to: next, piece: p, captured: null, promotion: null, flags: 'n'});
            } else {
              if (colorOf(tp) !== color) {
                moves.push({from: from, to: next, piece: p, captured: tp, promotion: null, flags: 'c'});
              }
              break;
            }
            sq = next;
          }
        }
      }
    }
    return moves;
  };

  Chess.prototype._addStep = function (from, to, p, color, moves) {
    var tp = this.board[to];
    if (tp === null) {
      moves.push({from: from, to: to, piece: p, captured: null, promotion: null, flags: 'n'});
    } else if (colorOf(tp) !== color) {
      moves.push({from: from, to: to, piece: p, captured: tp, promotion: null, flags: 'c'});
    }
  };

  Chess.prototype._pawnMoves = function (from, color, moves) {
    var board = this.board;
    var forward = color === WHITE ? -8 : 8;
    var startRank = color === WHITE ? 6 : 1;
    var promoRank = color === WHITE ? 0 : 7;
    var one = from + forward;

    if (one >= 0 && one < 64 && board[one] === null) {
      if (rankOf(one) === promoRank) {
        this._addPromotions(from, one, color, null, moves);
      } else {
        moves.push({from: from, to: one, piece: board[from], captured: null, promotion: null, flags: 'n'});
        // double push
        if (rankOf(from) === startRank) {
          var two = from + forward * 2;
          if (board[two] === null) {
            moves.push({from: from, to: two, piece: board[from], captured: null, promotion: null, flags: 'b'});
          }
        }
      }
    }

    // captures
    var caps = color === WHITE ? [-9, -7] : [7, 9];
    for (var i = 0; i < caps.length; i++) {
      var to = from + caps[i];
      if (to < 0 || to > 63) continue;
      if (Math.abs(fileOf(to) - fileOf(from)) !== 1) continue;
      var tp = board[to];
      if (tp !== null && colorOf(tp) !== color) {
        if (rankOf(to) === promoRank) {
          this._addPromotions(from, to, color, tp, moves);
        } else {
          moves.push({from: from, to: to, piece: board[from], captured: tp, promotion: null, flags: 'c'});
        }
      } else if (tp === null && to === this.epSquare) {
        // en passant
        moves.push({from: from, to: to, piece: board[from], captured: color === WHITE ? 'p' : 'P', promotion: null, flags: 'e'});
      }
    }
  };

  Chess.prototype._addPromotions = function (from, to, color, captured, moves) {
    var pieces = color === WHITE ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
    for (var i = 0; i < pieces.length; i++) {
      moves.push({
        from: from,
        to: to,
        piece: this.board[from],
        captured: captured,
        promotion: pieces[i],
        flags: captured ? 'pc' : 'p',
      });
    }
  };

  Chess.prototype._castlingMoves = function (from, color, moves) {
    var enemy = color === WHITE ? BLACK : WHITE;
    if (color === WHITE && from === 60) {
      // e1
      if (this.castling.K && this.board[61] === null && this.board[62] === null && this.board[63] === 'R') {
        if (!this.isSquareAttacked(60, enemy) && !this.isSquareAttacked(61, enemy) && !this.isSquareAttacked(62, enemy)) {
          moves.push({from: 60, to: 62, piece: 'K', captured: null, promotion: null, flags: 'k'});
        }
      }
      if (this.castling.Q && this.board[59] === null && this.board[58] === null && this.board[57] === null && this.board[56] === 'R') {
        if (!this.isSquareAttacked(60, enemy) && !this.isSquareAttacked(59, enemy) && !this.isSquareAttacked(58, enemy)) {
          moves.push({from: 60, to: 58, piece: 'K', captured: null, promotion: null, flags: 'q'});
        }
      }
    } else if (color === BLACK && from === 4) {
      // e8
      if (this.castling.k && this.board[5] === null && this.board[6] === null && this.board[7] === 'r') {
        if (!this.isSquareAttacked(4, enemy) && !this.isSquareAttacked(5, enemy) && !this.isSquareAttacked(6, enemy)) {
          moves.push({from: 4, to: 6, piece: 'k', captured: null, promotion: null, flags: 'k'});
        }
      }
      if (this.castling.q && this.board[3] === null && this.board[2] === null && this.board[1] === null && this.board[0] === 'r') {
        if (!this.isSquareAttacked(4, enemy) && !this.isSquareAttacked(3, enemy) && !this.isSquareAttacked(2, enemy)) {
          moves.push({from: 4, to: 2, piece: 'k', captured: null, promotion: null, flags: 'q'});
        }
      }
    }
  };

  // Apply a move object to the board (mutates). Returns an undo record.
  Chess.prototype._makeMove = function (move) {
    var board = this.board;
    var undo = {
      move: move,
      castling: {K: this.castling.K, Q: this.castling.Q, k: this.castling.k, q: this.castling.q},
      epSquare: this.epSquare,
      halfmoves: this.halfmoves,
      fullmoves: this.fullmoves,
      turn: this.turn,
      hash: this.hash,
    };

    var color = this.turn;
    var piece = board[move.from];

    // halfmove clock
    if (typeOf(piece) === 'p' || move.captured) {
      this.halfmoves = 0;
    } else {
      this.halfmoves++;
    }

    board[move.to] = move.promotion ? move.promotion : piece;
    board[move.from] = null;

    // en passant capture removes the pawn behind
    if (move.flags.indexOf('e') !== -1) {
      var capSq = color === WHITE ? move.to + 8 : move.to - 8;
      board[capSq] = null;
    }

    // castling: move the rook
    if (move.flags.indexOf('k') !== -1) {
      if (color === WHITE) {
        board[61] = 'R';
        board[63] = null;
      } else {
        board[5] = 'r';
        board[7] = null;
      }
    } else if (move.flags.indexOf('q') !== -1) {
      if (color === WHITE) {
        board[59] = 'R';
        board[56] = null;
      } else {
        board[3] = 'r';
        board[0] = null;
      }
    }

    // update castling rights
    if (piece === 'K') {
      this.castling.K = false;
      this.castling.Q = false;
    } else if (piece === 'k') {
      this.castling.k = false;
      this.castling.q = false;
    }
    if (move.from === 63 || move.to === 63) this.castling.K = false;
    if (move.from === 56 || move.to === 56) this.castling.Q = false;
    if (move.from === 7 || move.to === 7) this.castling.k = false;
    if (move.from === 0 || move.to === 0) this.castling.q = false;

    // en passant target
    if (move.flags.indexOf('b') !== -1) {
      this.epSquare = color === WHITE ? move.from - 8 : move.from + 8;
    } else {
      this.epSquare = null;
    }

    if (color === BLACK) this.fullmoves++;
    this.turn = color === WHITE ? BLACK : WHITE;

    // ---- Incremental Zobrist hash update ----
    var h = undo.hash;
    var arriving = move.promotion ? move.promotion : piece;
    h ^= ZOB.pieces[piece][move.from]; // moving piece leaves origin
    h ^= ZOB.pieces[arriving][move.to]; // (possibly promoted) piece arrives
    if (move.captured) {
      if (move.flags.indexOf('e') !== -1) {
        var epCap = color === WHITE ? move.to + 8 : move.to - 8;
        h ^= ZOB.pieces[move.captured][epCap];
      } else {
        h ^= ZOB.pieces[move.captured][move.to];
      }
    }
    if (move.flags.indexOf('k') !== -1) {
      if (color === WHITE) { h ^= ZOB.pieces.R[63]; h ^= ZOB.pieces.R[61]; }
      else { h ^= ZOB.pieces.r[7]; h ^= ZOB.pieces.r[5]; }
    } else if (move.flags.indexOf('q') !== -1) {
      if (color === WHITE) { h ^= ZOB.pieces.R[56]; h ^= ZOB.pieces.R[59]; }
      else { h ^= ZOB.pieces.r[0]; h ^= ZOB.pieces.r[3]; }
    }
    // Castling-right changes (rights only ever go true -> false).
    if (undo.castling.K && !this.castling.K) h ^= ZOB.castling.K;
    if (undo.castling.Q && !this.castling.Q) h ^= ZOB.castling.Q;
    if (undo.castling.k && !this.castling.k) h ^= ZOB.castling.k;
    if (undo.castling.q && !this.castling.q) h ^= ZOB.castling.q;
    // En-passant file changes.
    if (undo.epSquare !== null) h ^= ZOB.ep[fileOf(undo.epSquare)];
    if (this.epSquare !== null) h ^= ZOB.ep[fileOf(this.epSquare)];
    // Side to move toggles every move.
    h ^= ZOB.side;
    this.hash = h >>> 0;

    return undo;
  };

  Chess.prototype._undoMove = function (undo) {
    var board = this.board;
    var move = undo.move;
    var color = undo.turn;

    this.castling = undo.castling;
    this.epSquare = undo.epSquare;
    this.halfmoves = undo.halfmoves;
    this.fullmoves = undo.fullmoves;
    this.turn = undo.turn;
    this.hash = undo.hash;

    // restore moved piece
    board[move.from] = move.promotion ? (color === WHITE ? 'P' : 'p') : board[move.to];
    board[move.to] = move.flags.indexOf('e') !== -1 ? null : move.captured;

    if (move.flags.indexOf('e') !== -1) {
      var capSq = color === WHITE ? move.to + 8 : move.to - 8;
      board[capSq] = move.captured;
      board[move.to] = null;
    }

    // undo castling rook
    if (move.flags.indexOf('k') !== -1) {
      if (color === WHITE) {
        board[63] = 'R';
        board[61] = null;
      } else {
        board[7] = 'r';
        board[5] = null;
      }
    } else if (move.flags.indexOf('q') !== -1) {
      if (color === WHITE) {
        board[56] = 'R';
        board[59] = null;
      } else {
        board[0] = 'r';
        board[3] = null;
      }
    }
  };

  // Legal moves: pseudo moves filtered so the mover's king is not in check.
  // The king square is found once up front; after a move it only differs when
  // the king itself moved (then it is the move's destination). This avoids a
  // full-board king scan for every pseudo move — a major search speedup.
  Chess.prototype.generateLegalMoves = function (color) {
    color = color || this.turn;
    var pseudo = this.generatePseudoMoves(color);
    var legal = [];
    var enemy = color === WHITE ? BLACK : WHITE;
    var kingSq = this.kingIndex(color);
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      var undo = this._makeMove(m);
      var ks = typeOf(m.piece) === 'k' ? m.to : kingSq;
      if (!this.isSquareAttacked(ks, enemy)) {
        legal.push(m);
      }
      this._undoMove(undo);
    }
    return legal;
  };

  // Public: list of legal moves, optionally as SAN strings or for a square.
  Chess.prototype.moves = function (opts) {
    opts = opts || {};
    var legal = this.generateLegalMoves();
    if (opts.square != null) {
      var sq = typeof opts.square === 'string' ? squareToIndex(opts.square) : opts.square;
      legal = legal.filter(function (m) {
        return m.from === sq;
      });
    }
    if (opts.verbose) return legal;
    var self = this;
    return legal.map(function (m) {
      return self.toSan(m);
    });
  };

  // Make a move given {from, to, promotion} (indices or square names) or SAN.
  Chess.prototype.move = function (input) {
    var legal = this.generateLegalMoves();
    var chosen = null;
    var i;

    if (typeof input === 'string') {
      // try SAN
      for (i = 0; i < legal.length; i++) {
        if (this.toSan(legal[i]) === input || this.toSan(legal[i]) === input.replace(/[+#]/, '')) {
          chosen = legal[i];
          break;
        }
      }
    } else {
      var from = typeof input.from === 'string' ? squareToIndex(input.from) : input.from;
      var to = typeof input.to === 'string' ? squareToIndex(input.to) : input.to;
      var promo = input.promotion || null;
      for (i = 0; i < legal.length; i++) {
        var m = legal[i];
        if (m.from === from && m.to === to) {
          if (m.promotion) {
            var want = promo ? (this.turn === WHITE ? promo.toUpperCase() : promo.toLowerCase()) : (this.turn === WHITE ? 'Q' : 'q');
            if (m.promotion === want) {
              chosen = m;
              break;
            }
          } else {
            chosen = m;
            break;
          }
        }
      }
    }

    if (!chosen) return null;
    var san = this.toSan(chosen);
    var undo = this._makeMove(chosen);
    var record = {
      move: chosen,
      san: san,
      undo: undo,
      color: undo.turn,
      from: indexToSquare(chosen.from),
      to: indexToSquare(chosen.to),
    };
    this.history.push(record);
    return record;
  };

  Chess.prototype.undo = function () {
    if (this.history.length === 0) return null;
    var record = this.history.pop();
    this._undoMove(record.undo);
    return record;
  };

  // Standard Algebraic Notation for a legal move (must be called before the
  // move is applied — it inspects the current position for disambiguation).
  Chess.prototype.toSan = function (move) {
    if (move.flags.indexOf('k') !== -1) return this._checkSuffix(move, 'O-O');
    if (move.flags.indexOf('q') !== -1) return this._checkSuffix(move, 'O-O-O');

    var piece = typeOf(move.piece);
    var san = '';
    if (piece === 'p') {
      if (move.captured) {
        san += String.fromCharCode(97 + fileOf(move.from)) + 'x';
      }
      san += indexToSquare(move.to);
      if (move.promotion) san += '=' + move.promotion.toUpperCase();
    } else {
      san += piece.toUpperCase();
      san += this._disambiguation(move);
      if (move.captured) san += 'x';
      san += indexToSquare(move.to);
    }
    return this._checkSuffix(move, san);
  };

  Chess.prototype._disambiguation = function (move) {
    var legal = this.generateLegalMoves();
    var piece = move.piece;
    var sameTargets = legal.filter(function (m) {
      return m.piece === piece && m.to === move.to && m.from !== move.from;
    });
    if (sameTargets.length === 0) return '';
    var sameFile = sameTargets.some(function (m) {
      return fileOf(m.from) === fileOf(move.from);
    });
    var sameRank = sameTargets.some(function (m) {
      return rankOf(m.from) === rankOf(move.from);
    });
    if (!sameFile) return String.fromCharCode(97 + fileOf(move.from));
    if (!sameRank) return String(8 - rankOf(move.from));
    return indexToSquare(move.from);
  };

  Chess.prototype._checkSuffix = function (move, san) {
    var undo = this._makeMove(move);
    var suffix = '';
    if (this.isCheck(this.turn)) {
      suffix = this.generateLegalMoves().length === 0 ? '#' : '+';
    }
    this._undoMove(undo);
    return san + suffix;
  };

  Chess.prototype.isCheckmate = function () {
    return this.isCheck() && this.generateLegalMoves().length === 0;
  };
  Chess.prototype.isStalemate = function () {
    return !this.isCheck() && this.generateLegalMoves().length === 0;
  };
  Chess.prototype.isInsufficientMaterial = function () {
    var pieces = [];
    for (var i = 0; i < 64; i++) {
      var p = this.board[i];
      if (p !== null && typeOf(p) !== 'k') pieces.push(typeOf(p));
    }
    if (pieces.length === 0) return true; // K vs K
    if (pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n')) return true; // K+minor
    if (pieces.length === 2 && pieces[0] === 'b' && pieces[1] === 'b') return true; // K+B vs K+B (approx)
    return false;
  };
  Chess.prototype.isDraw = function () {
    return (
      this.isStalemate() ||
      this.isInsufficientMaterial() ||
      this.halfmoves >= 100
    );
  };
  Chess.prototype.isGameOver = function () {
    return this.generateLegalMoves().length === 0 || this.isDraw();
  };

  Chess.prototype.clone = function () {
    var c = new Chess(this.fen());
    return c;
  };

  Chess.prototype.turnColor = function () {
    return this.turn;
  };

  // Expose helpers used by other modules.
  Chess.fileOf = fileOf;
  Chess.rankOf = rankOf;
  Chess.colorOf = colorOf;
  Chess.typeOf = typeOf;
  Chess.isWhitePiece = isWhitePiece;
  Chess.isBlackPiece = isBlackPiece;
  Chess.squareToIndex = squareToIndex;
  Chess.indexToSquare = indexToSquare;

  global.Chess = Chess;
})(typeof window !== 'undefined' ? window : this);
