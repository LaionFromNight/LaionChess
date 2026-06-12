/* LaionEngine — compact chess move engine for prototype pages.
   Pseudo-legal movement (no check detection) — full legality lives in the production app. */
(function () {
  var FILES = 'abcdefgh';
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  var VALUES = { P: 1, N: 3, B: 3.2, R: 5, Q: 9, K: 0 };

  function sq(f, r) { return (f >= 0 && f < 8 && r >= 1 && r <= 8) ? FILES[f] + r : null; }
  function fileOf(s) { return FILES.indexOf(s[0]); }
  function rankOf(s) { return parseInt(s[1], 10); }

  function Engine(fen) { this.load(fen || START); }

  Engine.prototype.load = function (fen) {
    var parts = fen.split(' ');
    this.pos = {};
    var rows = parts[0].split('/');
    for (var r = 0; r < 8; r++) {
      var file = 0;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (/[1-8]/.test(ch)) { file += +ch; continue; }
        this.pos[FILES[file] + (8 - r)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
        file++;
      }
    }
    this.turn = parts[1] || 'w';
    var c = parts[2] || 'KQkq';
    this.castling = { wK: c.indexOf('K') >= 0, wQ: c.indexOf('Q') >= 0, bK: c.indexOf('k') >= 0, bQ: c.indexOf('q') >= 0 };
    this.ep = (parts[3] && parts[3] !== '-') ? parts[3] : null;
    this.snapshots = [this._snap()];
    this.sans = [];
    this.ptr = 0; // index into snapshots; sans[i] moves snapshot i -> i+1
  };

  Engine.prototype._snap = function () {
    return JSON.stringify({ p: this.pos, t: this.turn, c: this.castling, e: this.ep });
  };
  Engine.prototype._restore = function (s) {
    var o = JSON.parse(s);
    this.pos = o.p; this.turn = o.t; this.castling = o.c; this.ep = o.e;
  };

  Engine.prototype.pieceAt = function (s) { return this.pos[s] || null; };

  Engine.prototype.movesFrom = function (from) {
    var p = this.pos[from];
    if (!p || p[0] !== this.turn) return [];
    var color = p[0], type = p[1], self = this;
    var f = fileOf(from), r = rankOf(from), out = [];

    function add(to, extra) {
      if (!to) return;
      var t = self.pos[to];
      if (t && t[0] === color) return;
      var mv = Object.assign({ from: from, to: to }, extra || {});
      if (t) mv.capture = true;
      out.push(mv);
    }
    function ray(df, dr) {
      for (var i = 1; i < 8; i++) {
        var s2 = sq(f + df * i, r + dr * i);
        if (!s2) break;
        var t = self.pos[s2];
        if (!t) { out.push({ from: from, to: s2 }); continue; }
        if (t[0] !== color) out.push({ from: from, to: s2, capture: true });
        break;
      }
    }

    if (type === 'P') {
      var dir = color === 'w' ? 1 : -1;
      var startRank = color === 'w' ? 2 : 7;
      var promoRank = color === 'w' ? 8 : 1;
      var one = sq(f, r + dir);
      if (one && !this.pos[one]) {
        out.push({ from: from, to: one, promo: rankOf(one) === promoRank ? 'Q' : undefined });
        var two = sq(f, r + 2 * dir);
        if (r === startRank && two && !this.pos[two]) out.push({ from: from, to: two, dbl: true });
      }
      [f - 1, f + 1].forEach(function (nf) {
        var d = sq(nf, r + dir);
        if (!d) return;
        var t = self.pos[d];
        if (t && t[0] !== color) out.push({ from: from, to: d, capture: true, promo: rankOf(d) === promoRank ? 'Q' : undefined });
        else if (!t && d === self.ep) out.push({ from: from, to: d, capture: true, ep: nf !== null ? FILES[nf] + r : null });
      });
    } else if (type === 'N') {
      [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]].forEach(function (d) { add(sq(f + d[0], r + d[1])); });
    } else if (type === 'B') { ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); }
    else if (type === 'R') { ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); }
    else if (type === 'Q') { ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); }
    else if (type === 'K') {
      for (var df = -1; df <= 1; df++) for (var dr = -1; dr <= 1; dr++) {
        if (df || dr) add(sq(f + df, r + dr));
      }
      var home = color === 'w' ? 1 : 8;
      if (from === 'e' + home) {
        if (this.castling[color + 'K'] && !this.pos['f' + home] && !this.pos['g' + home] && this.pos['h' + home] === color + 'R')
          out.push({ from: from, to: 'g' + home, rook: { from: 'h' + home, to: 'f' + home }, castle: 'O-O' });
        if (this.castling[color + 'Q'] && !this.pos['d' + home] && !this.pos['c' + home] && !this.pos['b' + home] && this.pos['a' + home] === color + 'R')
          out.push({ from: from, to: 'c' + home, rook: { from: 'a' + home, to: 'd' + home }, castle: 'O-O-O' });
      }
    }
    return out;
  };

  Engine.prototype.san = function (mv) {
    if (mv.castle) return mv.castle;
    var p = this.pos[mv.from];
    var type = p[1];
    var s = '';
    if (type === 'P') {
      if (mv.capture) s = mv.from[0] + 'x';
      s += mv.to;
      if (mv.promo) s += '=' + mv.promo;
    } else {
      s = type + (mv.capture ? 'x' : '') + mv.to;
    }
    return s;
  };

  Engine.prototype.make = function (mv) {
    var san = this.san(mv);
    var p = this.pos[mv.from];
    if (mv.ep) delete this.pos[mv.ep];
    this.pos[mv.to] = mv.promo ? p[0] + mv.promo : p;
    delete this.pos[mv.from];
    if (mv.rook) { this.pos[mv.rook.to] = this.pos[mv.rook.from]; delete this.pos[mv.rook.from]; }
    // castling rights
    var c = this.castling;
    if (p === 'wK') { c.wK = c.wQ = false; }
    if (p === 'bK') { c.bK = c.bQ = false; }
    [['a1','wQ'],['h1','wK'],['a8','bQ'],['h8','bK']].forEach(function (x) {
      if (mv.from === x[0] || mv.to === x[0]) c[x[1]] = false;
    });
    // en passant target
    this.ep = mv.dbl ? mv.from[0] + ((rankOf(mv.from) + rankOf(mv.to)) / 2) : null;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    // history: truncate forward branch
    this.snapshots = this.snapshots.slice(0, this.ptr + 1);
    this.sans = this.sans.slice(0, this.ptr);
    this.snapshots.push(this._snap());
    this.sans.push(san);
    this.ptr = this.snapshots.length - 1;
    return san;
  };

  Engine.prototype.findBySan = function (san) {
    for (var s in this.pos) {
      if (this.pos[s][0] !== this.turn) continue;
      var ms = this.movesFrom(s);
      for (var i = 0; i < ms.length; i++) {
        if (this.san(ms[i]) === san) return ms[i];
      }
    }
    return null;
  };

  Engine.prototype.jumpTo = function (i) {
    if (i < 0 || i >= this.snapshots.length) return;
    this.ptr = i;
    this._restore(this.snapshots[i]);
  };
  Engine.prototype.canBack = function () { return this.ptr > 0; };
  Engine.prototype.canFwd = function () { return this.ptr < this.snapshots.length - 1; };

  Engine.prototype.eval = function () {
    var e = 0;
    for (var s in this.pos) {
      var p = this.pos[s];
      e += (p[0] === 'w' ? 1 : -1) * VALUES[p[1]];
    }
    return e;
  };

  Engine.prototype.boardFen = function () {
    var rows = [];
    for (var r = 8; r >= 1; r--) {
      var row = '', empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = this.pos[FILES[f] + r];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  };
  Engine.prototype.fen = function () {
    var c = (this.castling.wK ? 'K' : '') + (this.castling.wQ ? 'Q' : '') +
            (this.castling.bK ? 'k' : '') + (this.castling.bQ ? 'q' : '');
    return this.boardFen() + ' ' + this.turn + ' ' + (c || '-') + ' ' + (this.ep || '-') +
      ' 0 ' + (Math.floor(this.ptr / 2) + 1);
  };
  Engine.prototype.key = function () { return this.boardFen() + ' ' + this.turn; };

  Engine.prototype.pgn = function () {
    var out = '';
    for (var i = 0; i < this.sans.length; i += 2) {
      out += (i / 2 + 1) + '. ' + this.sans[i] + (this.sans[i + 1] ? ' ' + this.sans[i + 1] : '') + ' ';
    }
    return out.trim();
  };

  window.LaionEngine = Engine;
})();
