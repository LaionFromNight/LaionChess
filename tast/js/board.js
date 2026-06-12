/* LaionBoard — lightweight chessboard renderer.
   Depends on js/theme.js (LaionSettings). */
(function () {
  var FILES = 'abcdefgh';

  function sqToXY(sq) { // 'e4' -> {x:4, y:4} where y=0 is rank 8 (white orientation)
    return { x: FILES.indexOf(sq[0]), y: 8 - parseInt(sq[1], 10) };
  }

  function parseFen(fen) {
    var pos = {};
    var rows = fen.split(' ')[0].split('/');
    for (var r = 0; r < 8; r++) {
      var file = 0;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (/[1-8]/.test(ch)) { file += parseInt(ch, 10); continue; }
        var color = ch === ch.toUpperCase() ? 'w' : 'b';
        var code = color + ch.toUpperCase();
        pos[FILES[file] + (8 - r)] = code;
        file++;
      }
    }
    return pos;
  }

  function LaionBoard(container, opts) {
    opts = opts || {};
    this.el = container;
    this.interactive = !!opts.interactive;
    this.showCoords = opts.coords !== false;
    this.onSquare = opts.onSquare || null;
    this.pos = {};       // square -> 'wK'
    this.pieceEls = {};  // square -> element
    this.highlights = {}; // square -> class
    this._pieceId = 0;
    this._build();
    var self = this;
    if (window.LaionSettings) {
      LaionSettings.onChange(function (k) {
        if (k === 'boardTheme') self.applyTheme();
        if (k === 'pieceSet') self.refreshPieces();
        if (k === 'coords') { self.showCoords = LaionSettings.get('coords'); self._buildSquares(); }
      });
    }
  }

  LaionBoard.prototype._build = function () {
    this.el.classList.add('lc-board');
    if (this.interactive) this.el.classList.add('interactive');
    this.el.innerHTML = '';
    this.sqLayer = document.createElement('div');
    this.sqLayer.className = 'lc-squares';
    this.pcLayer = document.createElement('div');
    this.pcLayer.className = 'lc-pieces';
    this.arrowLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowLayer.setAttribute('class', 'lc-arrows');
    this.arrowLayer.setAttribute('viewBox', '0 0 100 100');
    this.arrowLayer.setAttribute('preserveAspectRatio', 'none');
    this.el.appendChild(this.sqLayer);
    this.el.appendChild(this.pcLayer);
    this.el.appendChild(this.arrowLayer);
    this._buildSquares();
    this.applyTheme();
  };

  LaionBoard.prototype._buildSquares = function () {
    this.sqLayer.innerHTML = '';
    this.sqEls = {};
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        var sq = FILES[x] + (8 - y);
        var d = document.createElement('div');
        d.className = 'lc-sq ' + (((x + y) % 2 === 0) ? 'light' : 'dark');
        d.dataset.square = sq;
        if (this.showCoords) {
          if (y === 7) {
            var f = document.createElement('span');
            f.className = 'coord file'; f.textContent = FILES[x];
            d.appendChild(f);
          }
          if (x === 0) {
            var rk = document.createElement('span');
            rk.className = 'coord rank'; rk.textContent = String(8 - y);
            d.appendChild(rk);
          }
        }
        if (this.interactive) {
          var self = this;
          d.addEventListener('click', (function (square) {
            return function () { if (self.onSquare) self.onSquare(square); };
          })(sq));
        }
        this.sqLayer.appendChild(d);
        this.sqEls[sq] = d;
      }
    }
    this._applyHighlights();
  };

  LaionBoard.prototype.applyTheme = function () {
    var key = window.LaionSettings ? LaionSettings.get('boardTheme') : 'classic';
    var t = (window.LaionSettings && LaionSettings.boardThemes[key]) ||
      { light: '#f0d9b5', dark: '#b58863', coordL: '#b58863', coordD: '#f0d9b5' };
    this.el.style.setProperty('--sq-light', t.light);
    this.el.style.setProperty('--sq-dark', t.dark);
    this.el.style.setProperty('--coord-on-light', t.coordL);
    this.el.style.setProperty('--coord-on-dark', t.coordD);
  };

  LaionBoard.prototype._makePieceEl = function (code) {
    var wrap = document.createElement('div');
    wrap.className = 'lc-piece';
    this._fillPiece(wrap, code);
    return wrap;
  };

  LaionBoard.prototype._fillPiece = function (wrap, code) {
    wrap.innerHTML = '';
    wrap.dataset.code = code;
    var src = window.LaionSettings ? LaionSettings.pieceSrc(code) : null;
    if (src) {
      var img = document.createElement('img');
      img.src = src; img.alt = code; img.draggable = false;
      wrap.appendChild(img);
    } else {
      var span = document.createElement('span');
      span.className = 'glyph ' + code[0];
      span.textContent = LaionSettings.glyphs[code];
      wrap.appendChild(span);
    }
  };

  LaionBoard.prototype._place = function (el, sq) {
    var p = sqToXY(sq);
    el.style.transform = 'translate(' + (p.x * 100) + '%, ' + (p.y * 100) + '%)';
  };

  LaionBoard.prototype.setFen = function (fen) {
    this.pos = parseFen(fen);
    this.pcLayer.innerHTML = '';
    this.pieceEls = {};
    for (var sq in this.pos) {
      var el = this._makePieceEl(this.pos[sq]);
      this._place(el, sq);
      this.pcLayer.appendChild(el);
      this.pieceEls[sq] = el;
    }
    this.clearArrow();
    this.clearHighlights();
  };

  LaionBoard.prototype.refreshPieces = function () {
    for (var sq in this.pieceEls) {
      this._fillPiece(this.pieceEls[sq], this.pos[sq]);
    }
  };

  LaionBoard.prototype.pieceAt = function (sq) { return this.pos[sq] || null; };

  LaionBoard.prototype.boardFen = function () {
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

  /* mv: {from, to, promo?, rook?: {from,to}, ep?: 'square-to-clear'} */
  LaionBoard.prototype.applyMove = function (mv) {
    var el = this.pieceEls[mv.from];
    if (!el) return;
    // capture
    if (this.pieceEls[mv.to]) {
      this.pcLayer.removeChild(this.pieceEls[mv.to]);
      delete this.pieceEls[mv.to];
    }
    if (mv.ep && this.pieceEls[mv.ep]) {
      this.pcLayer.removeChild(this.pieceEls[mv.ep]);
      delete this.pieceEls[mv.ep];
      delete this.pos[mv.ep];
    }
    this._place(el, mv.to);
    this.pieceEls[mv.to] = el;
    delete this.pieceEls[mv.from];
    this.pos[mv.to] = this.pos[mv.from];
    delete this.pos[mv.from];
    if (mv.promo) {
      this.pos[mv.to] = this.pos[mv.to][0] + mv.promo.toUpperCase();
      this._fillPiece(el, this.pos[mv.to]);
    }
    if (mv.rook) this.applyMove({ from: mv.rook.from, to: mv.rook.to });
  };

  /* highlights: {square: 'select'|'hint'|'last'|'wrong'|'ok'|'dot'} */
  LaionBoard.prototype.setHighlights = function (map) {
    this.highlights = map || {};
    this._applyHighlights();
  };
  LaionBoard.prototype.clearHighlights = function () { this.setHighlights({}); };
  LaionBoard.prototype._applyHighlights = function () {
    for (var sq in this.sqEls) {
      var el = this.sqEls[sq];
      el.className = el.className.replace(/\s*hl-\w+/g, '');
      if (this.highlights[sq]) el.classList.add('hl-' + this.highlights[sq]);
    }
  };

  LaionBoard.prototype.setArrow = function (from, to, color) {
    this.clearArrow();
    this.addArrow(from, to, color);
  };

  LaionBoard.prototype.addArrow = function (from, to, color, width) {
    var a = sqToXY(from), b = sqToXY(to);
    var x1 = a.x * 12.5 + 6.25, y1 = a.y * 12.5 + 6.25;
    var x2 = b.x * 12.5 + 6.25, y2 = b.y * 12.5 + 6.25;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    var ux = dx / len, uy = dy / len;
    // shorten so the head doesn't cover the piece center
    var x2s = x2 - ux * 4.4, y2s = y2 - uy * 4.4;
    var c = color || 'rgba(255, 159, 67, 0.85)';
    var w = width || 2.6;
    var ns = 'http://www.w3.org/2000/svg';
    var line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2s); line.setAttribute('y2', y2s);
    line.setAttribute('stroke', c); line.setAttribute('stroke-width', w);
    line.setAttribute('stroke-linecap', 'round');
    this.arrowLayer.appendChild(line);
    // arrow head: simple triangle
    var px = -uy, py = ux; // perpendicular
    var tipX = x2 - ux * 1.2, tipY = y2 - uy * 1.2;
    var baseX = x2s, baseY = y2s;
    var head = document.createElementNS(ns, 'polygon');
    head.setAttribute('points',
      (baseX + px * 2.4) + ',' + (baseY + py * 2.4) + ' ' +
      (baseX - px * 2.4) + ',' + (baseY - py * 2.4) + ' ' +
      tipX + ',' + tipY);
    head.setAttribute('fill', c);
    this.arrowLayer.appendChild(head);
  };
  LaionBoard.prototype.clearArrow = function () { this.arrowLayer.innerHTML = ''; };

  window.LaionBoard = LaionBoard;
  window.LaionBoard.parseFen = parseFen;
})();
