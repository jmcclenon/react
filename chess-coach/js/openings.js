/*
 * openings.js — A comprehensive opening library.
 *
 * Two datasets:
 *   OPENINGS   — a broad map of named lines (with ECO codes) used to name the
 *                position live as a game follows known theory. Entries are
 *                layered (short defining prefixes plus deeper variations) so the
 *                displayed name refines as more book moves are played.
 *   SPECIALIST — a curated set of complete mainlines (10+ plies) that the
 *                "opening specialist" opponents can be told to play. Each is
 *                tagged for White or Black so the player can pick a repertoire.
 *
 * `lookup(sans)` returns the deepest named line matching the moves played so
 * far, plus whether the game is still within known theory.
 */
(function (global) {
  'use strict';

  // [ECO, Name, "SAN moves separated by spaces"]
  var RAW = [
    // ---- 1.e4 open games ----
    ['B00', 'King\'s Pawn Opening', 'e4'],
    ['C20', 'Open Game', 'e4 e5'],
    ['C40', 'King\'s Knight Opening', 'e4 e5 Nf3'],
    ['C44', 'King\'s Knight: Normal', 'e4 e5 Nf3 Nc6'],
    ['C60', 'Ruy López (Spanish)', 'e4 e5 Nf3 Nc6 Bb5'],
    ['C65', 'Ruy López: Berlin Defense', 'e4 e5 Nf3 Nc6 Bb5 Nf6'],
    ['C70', 'Ruy López: Morphy Defense', 'e4 e5 Nf3 Nc6 Bb5 a6'],
    ['C77', 'Ruy López: Morphy, Ba4', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4'],
    ['C84', 'Ruy López: Closed', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6'],
    ['C68', 'Ruy López: Exchange', 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6'],
    ['C50', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4'],
    ['C50', 'Italian: Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5'],
    ['C53', 'Giuoco Piano: c3', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3'],
    ['C51', 'Evans Gambit', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4'],
    ['C55', 'Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6'],
    ['C57', 'Two Knights: Knight Attack', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5'],
    ['C45', 'Scotch Game', 'e4 e5 Nf3 Nc6 d4'],
    ['C45', 'Scotch Game: Open', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4'],
    ['C46', 'Three Knights Game', 'e4 e5 Nf3 Nc6 Nc3'],
    ['C47', 'Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6'],
    ['C42', 'Petrov (Russian) Defense', 'e4 e5 Nf3 Nf6'],
    ['C41', 'Philidor Defense', 'e4 e5 Nf3 d6'],
    ['C23', 'Bishop\'s Opening', 'e4 e5 Bc4'],
    ['C25', 'Vienna Game', 'e4 e5 Nc3'],
    ['C30', 'King\'s Gambit', 'e4 e5 f4'],
    ['C33', 'King\'s Gambit Accepted', 'e4 e5 f4 exf4'],
    ['C30', 'King\'s Gambit Declined', 'e4 e5 f4 Bc5'],
    ['C21', 'Center Game', 'e4 e5 d4'],
    // ---- Sicilian ----
    ['B20', 'Sicilian Defense', 'e4 c5'],
    ['B27', 'Sicilian: Knight Variation', 'e4 c5 Nf3'],
    ['B50', 'Sicilian: ...d6', 'e4 c5 Nf3 d6'],
    ['B56', 'Sicilian: Open', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3'],
    ['B90', 'Sicilian: Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
    ['B70', 'Sicilian: Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'],
    ['B80', 'Sicilian: Scheveningen', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6'],
    ['B30', 'Sicilian: ...Nc6', 'e4 c5 Nf3 Nc6'],
    ['B33', 'Sicilian: Sveshnikov', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5'],
    ['B34', 'Sicilian: Accelerated Dragon', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6'],
    ['B40', 'Sicilian: ...e6', 'e4 c5 Nf3 e6'],
    ['B44', 'Sicilian: Taimanov', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6'],
    ['B23', 'Sicilian: Closed', 'e4 c5 Nc3'],
    ['B22', 'Sicilian: Alapin', 'e4 c5 c3'],
    ['B21', 'Sicilian: Smith-Morra Gambit', 'e4 c5 d4'],
    ['B21', 'Sicilian: Grand Prix Attack', 'e4 c5 f4'],
    // ---- French ----
    ['C00', 'French Defense', 'e4 e6'],
    ['C01', 'French Defense', 'e4 e6 d4 d5'],
    ['C02', 'French: Advance', 'e4 e6 d4 d5 e5'],
    ['C01', 'French: Exchange', 'e4 e6 d4 d5 exd5'],
    ['C10', 'French: Paulsen', 'e4 e6 d4 d5 Nc3'],
    ['C15', 'French: Winawer', 'e4 e6 d4 d5 Nc3 Bb4'],
    ['C11', 'French: Classical', 'e4 e6 d4 d5 Nc3 Nf6'],
    ['C03', 'French: Tarrasch', 'e4 e6 d4 d5 Nd2'],
    // ---- Caro-Kann ----
    ['B10', 'Caro-Kann Defense', 'e4 c6'],
    ['B12', 'Caro-Kann', 'e4 c6 d4 d5'],
    ['B12', 'Caro-Kann: Advance', 'e4 c6 d4 d5 e5'],
    ['B13', 'Caro-Kann: Exchange', 'e4 c6 d4 d5 exd5 cxd5'],
    ['B13', 'Caro-Kann: Panov-Botvinnik', 'e4 c6 d4 d5 exd5 cxd5 c4'],
    ['B15', 'Caro-Kann: Main Line', 'e4 c6 d4 d5 Nc3'],
    ['B18', 'Caro-Kann: Classical', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5'],
    // ---- Other 1.e4 ----
    ['B01', 'Scandinavian Defense', 'e4 d5'],
    ['B01', 'Scandinavian: Main Line', 'e4 d5 exd5 Qxd5'],
    ['B01', 'Scandinavian: Modern', 'e4 d5 exd5 Nf6'],
    ['B07', 'Pirc Defense', 'e4 d6'],
    ['B06', 'Modern Defense', 'e4 g6'],
    ['B02', 'Alekhine Defense', 'e4 Nf6'],
    ['B00', 'Nimzowitsch Defense', 'e4 Nc6'],
    ['B00', 'Owen Defense', 'e4 b6'],
    // ---- 1.d4 ----
    ['A40', 'Queen\'s Pawn Opening', 'd4'],
    ['D00', 'Closed Game', 'd4 d5'],
    ['D06', 'Queen\'s Gambit', 'd4 d5 c4'],
    ['D20', 'Queen\'s Gambit Accepted', 'd4 d5 c4 dxc4'],
    ['D30', 'Queen\'s Gambit Declined', 'd4 d5 c4 e6'],
    ['D35', 'QGD: Main Line', 'd4 d5 c4 e6 Nc3 Nf6'],
    ['D32', 'Tarrasch Defense', 'd4 d5 c4 e6 Nc3 c5'],
    ['D10', 'Slav Defense', 'd4 d5 c4 c6'],
    ['D43', 'Semi-Slav Defense', 'd4 d5 c4 e6 Nf3 Nf6 Nc3 c6'],
    ['D08', 'Albin Countergambit', 'd4 d5 c4 e5'],
    ['D07', 'Chigorin Defense', 'd4 d5 c4 Nc6'],
    ['D02', 'London System', 'd4 d5 Bf4'],
    ['D02', 'London System', 'd4 d5 Nf3 Nf6 Bf4'],
    ['A45', 'Indian Defense', 'd4 Nf6'],
    ['A45', 'Trompowsky Attack', 'd4 Nf6 Bg5'],
    ['E00', 'Indian Game', 'd4 Nf6 c4'],
    ['E00', 'Catalan Opening', 'd4 Nf6 c4 e6 g3'],
    ['E20', 'Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4'],
    ['E12', 'Queen\'s Indian Defense', 'd4 Nf6 c4 e6 Nf3 b6'],
    ['E60', 'King\'s Indian / Grünfeld', 'd4 Nf6 c4 g6'],
    ['E70', 'King\'s Indian Defense', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6'],
    ['D80', 'Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5'],
    ['A56', 'Benoni Defense', 'd4 Nf6 c4 c5'],
    ['A60', 'Modern Benoni', 'd4 Nf6 c4 c5 d5 e6'],
    ['A57', 'Benko Gambit', 'd4 Nf6 c4 c5 d5 b5'],
    ['A80', 'Dutch Defense', 'd4 f5'],
    ['A41', 'Old Indian / Rat', 'd4 d6'],
    // ---- 1.c4 English ----
    ['A10', 'English Opening', 'c4'],
    ['A20', 'English: Reversed Sicilian', 'c4 e5'],
    ['A25', 'English: King\'s English', 'c4 e5 Nc3'],
    ['A30', 'English: Symmetrical', 'c4 c5'],
    ['A15', 'English: Anglo-Indian', 'c4 Nf6'],
    // ---- 1.Nf3 ----
    ['A04', 'Réti Opening', 'Nf3'],
    ['A06', 'Réti: ...d5', 'Nf3 d5'],
    ['A09', 'Réti Opening', 'Nf3 d5 c4'],
    // ---- Flank / irregular ----
    ['A00', 'King\'s Fianchetto Opening', 'g3'],
    ['A01', 'Nimzo-Larsen Attack', 'b3'],
    ['A02', 'Bird\'s Opening', 'f4'],
    ['A00', 'Sokolsky (Polish) Opening', 'b4'],
    ['A00', 'Dunst Opening', 'Nc3'],
    ['A00', 'Mieses Opening', 'd3'],
  ];

  var OPENINGS = RAW.map(function (r) {
    return {eco: r[0], name: r[1], moves: r[2].split(' ')};
  });

  // Curated complete repertoire lines for the "opening specialist" opponents.
  // side: 'w' the specialist steers this as White, 'b' as Black.
  var SPEC_RAW = [
    // White repertoires
    ['w', 'Ruy López (Closed)', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O'],
    ['w', 'Italian Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O'],
    ['w', 'Scotch Game', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3 Bb4 Nxc6 bxc6 Bd3 d5'],
    ['w', 'King\'s Gambit', 'e4 e5 f4 exf4 Nf3 g5 Bc4 Bg7 O-O'],
    ['w', 'Vienna Game', 'e4 e5 Nc3 Nf6 Bc4 Nc6 d3 Bb4'],
    ['w', 'Queen\'s Gambit Declined', 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3'],
    ['w', 'London System', 'd4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Bd3'],
    ['w', 'English Symmetrical', 'c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 Nf6'],
    ['w', 'Catalan Opening', 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O'],
    ['w', 'Réti Opening', 'Nf3 d5 c4 e6 g3 Nf6 Bg2 Be7 O-O O-O'],
    // Black repertoires (steered when White cooperates with the first move)
    ['b', 'Sicilian Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
    ['b', 'Sicilian Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'],
    ['b', 'French Defense', 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7'],
    ['b', 'Caro-Kann Classical', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5'],
    ['b', 'Petrov Defense', 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4'],
    ['b', 'Scandinavian Defense', 'e4 d5 exd5 Qxd5 Nc3 Qa5'],
    ['b', 'King\'s Indian Defense', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O'],
    ['b', 'Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7'],
    ['b', 'Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O'],
    ['b', 'Queen\'s Gambit Declined', 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7'],
    ['b', 'Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4'],
    ['b', 'Dutch Defense', 'd4 f5 c4 Nf6 g3 e6 Bg2 Be7'],
  ];

  var SPECIALIST = SPEC_RAW.map(function (r, i) {
    return {id: i, side: r[0], name: r[1], moves: r[2].split(' ')};
  });

  function prefixEq(a, b, len) {
    for (var i = 0; i < len; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Find the deepest named opening whose move list is a prefix of `sans`, and
  // whether any known line still extends the current position (still in book).
  function lookup(sans) {
    var best = null;
    var inBook = false;
    for (var i = 0; i < OPENINGS.length; i++) {
      var o = OPENINGS[i];
      var m = o.moves;
      if (m.length <= sans.length && prefixEq(m, sans, m.length)) {
        if (!best || m.length > best.moves.length) best = o;
      }
      if (!inBook && m.length > sans.length && prefixEq(sans, m, sans.length)) {
        inBook = true;
      }
    }
    return {opening: best, inBook: inBook};
  }

  global.ChessOpenings = {
    OPENINGS: OPENINGS,
    SPECIALIST: SPECIALIST,
    lookup: lookup,
  };
})(typeof window !== 'undefined' ? window : this);
