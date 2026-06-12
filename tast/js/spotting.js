/* LaionSpotting — piece-relation overlay (ported from the LaionChess analysis app).
   Multi-select modes, matching src/chess/analysis.ts SpottingMode:
   dalmacja | lufycfer | king-path | king-shot | eye-black | eye-white | eye-1 | eye-2 | eye-full
   Empty set = Standard. Persisted via LaionSettings 'spotModes'. */
(function () {
  var FILES = 'abcdefgh';
  var NS = 'http://www.w3.org/2000/svg';

  function sq(f, r) { return (f >= 0 && f < 8 && r >= 1 && r <= 8) ? FILES[f] + r : null; }
  function center(s) {
    return { x: FILES.indexOf(s[0]) * 12.5 + 6.25, y: (8 - parseInt(s[1], 10)) * 12.5 + 6.25 };
  }

  /* squares attacked/defended by the piece on `from` (occupancy-aware, turn-agnostic) */
  function attacksFrom(pos, from) {
    var p = pos[from];
    if (!p) return [];
    var color = p[0], type = p[1];
    var f = FILES.indexOf(from[0]), r = parseInt(from[1], 10), out = [];
    function push(s) { if (s) out.push(s); }
    function ray(df, dr) {
      for (var i = 1; i < 8; i++) {
        var s2 = sq(f + df * i, r + dr * i);
        if (!s2) break;
        out.push(s2);
        if (pos[s2]) break;
      }
    }
    if (type === 'P') {
      var dir = color === 'w' ? 1 : -1;
      push(sq(f - 1, r + dir)); push(sq(f + 1, r + dir));
    } else if (type === 'N') {
      [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]].forEach(function (d) { push(sq(f + d[0], r + d[1])); });
    } else if (type === 'B') { ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); }
    else if (type === 'R') { ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); }
    else if (type === 'Q') { ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); }
    else if (type === 'K') {
      for (var df = -1; df <= 1; df++) for (var dr = -1; dr <= 1; dr++) if (df || dr) push(sq(f + df, r + dr));
    }
    return out;
  }

  /* all piece relations: {from, to, srcColor, kind: 'def'|'atk'} */
  function relations(pos) {
    var out = [];
    for (var from in pos) {
      var p = pos[from];
      attacksFrom(pos, from).forEach(function (t) {
        var q = pos[t];
        if (!q) return;
        out.push({ from: from, to: t, srcColor: p[0], kind: q[0] === p[0] ? 'def' : 'atk' });
      });
    }
    return out;
  }

  function attackedSet(pos, byColor) {
    var set = {};
    for (var from in pos) {
      if (pos[from][0] !== byColor) continue;
      attacksFrom(pos, from).forEach(function (t) { set[t] = true; });
    }
    return set;
  }

  var COLORS = {
    wdef: 'rgba(255, 220, 90, 0.8)',
    bdef: 'rgba(0, 200, 255, 0.8)',
    watk: 'rgba(255, 159, 67, 0.85)',
    batk: 'rgba(255, 0, 128, 0.85)',
    safe: 'rgba(60, 255, 90, 0.9)',
    unsafe: 'rgba(255, 60, 60, 0.85)',
    shot: 'rgba(255, 0, 64, 0.9)',
  };

  function loadModes() {
    var arr = (window.LaionSettings && LaionSettings.get('spotModes')) || [];
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function Controller(board) {
    this.board = board;
    this.modes = loadModes();
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;width:100%;height:100%;';
    board.el.appendChild(this.svg);
    // auto-refresh whenever the board position changes
    var self = this;
    ['setFen', 'applyMove'].forEach(function (fn) {
      var orig = board[fn].bind(board);
      board[fn] = function () {
        var r = orig.apply(null, arguments);
        self.refresh();
        return r;
      };
    });
    this.refresh();
  }

  Controller.prototype.toggle = function (m) {
    if (m === 'none') this.modes.clear();
    else if (this.modes.has(m)) this.modes.delete(m);
    else this.modes.add(m);
    if (window.LaionSettings) LaionSettings.set('spotModes', Array.from(this.modes));
    this.refresh();
  };

  Controller.prototype._line = function (a, b, color, width, dash) {
    var l = document.createElementNS(NS, 'line');
    var p1 = center(a), p2 = center(b);
    l.setAttribute('x1', p1.x); l.setAttribute('y1', p1.y);
    l.setAttribute('x2', p2.x); l.setAttribute('y2', p2.y);
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', width || 0.7);
    l.setAttribute('stroke-dasharray', dash || '1.8 1.8');
    l.setAttribute('stroke-linecap', 'round');
    this.svg.appendChild(l);
  };
  Controller.prototype._circle = function (s, color, r, alpha) {
    var c = document.createElementNS(NS, 'circle');
    var p = center(s);
    c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
    c.setAttribute('r', r || 5.2);
    c.setAttribute('fill', color);
    c.setAttribute('opacity', alpha != null ? alpha : 0.3);
    this.svg.appendChild(c);
  };
  Controller.prototype._dot = function (s, color) {
    var c = document.createElementNS(NS, 'circle');
    var p = center(s);
    c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
    c.setAttribute('r', 1.8);
    c.setAttribute('fill', color);
    this.svg.appendChild(c);
  };

  Controller.prototype.refresh = function () {
    this.svg.innerHTML = '';
    if (!this.modes.size) return;
    var pos = this.board.pos;
    var self = this;
    var has = function (m) { return self.modes.has(m); };

    if (has('king-path')) {
      ['w', 'b'].forEach(function (color) {
        var king = null;
        for (var s in pos) if (pos[s] === color + 'K') king = s;
        if (!king) return;
        var enemy = attackedSet(pos, color === 'w' ? 'b' : 'w');
        attacksFrom(pos, king).forEach(function (t) {
          if (pos[t] && pos[t][0] === color) return;
          self._dot(t, enemy[t] ? COLORS.unsafe : COLORS.safe);
        });
        self._circle(king, color === 'w' ? COLORS.wdef : COLORS.bdef, 6, 0.22);
      });
    }

    var rels = relations(pos);

    if (has('king-shot')) {
      rels.forEach(function (r) {
        if (r.kind !== 'atk' || pos[r.to][1] !== 'K') return;
        self._circle(r.to, COLORS.shot, 6.2, 0.35);
        self._line(r.from, r.to, COLORS.shot, 1.1, '2.4 1.6');
      });
    }

    var defBoth = has('dalmacja') || has('eye-2') || has('eye-full');
    var atkBoth = has('lufycfer') || has('eye-1') || has('eye-full');
    var withCircles = has('dalmacja') || has('eye-full') || has('eye-white') || has('eye-black');

    var marked = {};
    rels.forEach(function (r) {
      var colorMode = has(r.srcColor === 'w' ? 'eye-white' : 'eye-black');
      var show = r.kind === 'def' ? (defBoth || colorMode) : (atkBoth || colorMode);
      if (!show) return;
      var c = COLORS[r.srcColor + r.kind];
      if (withCircles) {
        [r.from, r.to].forEach(function (s) {
          var k = s + r.srcColor + r.kind;
          if (marked[k]) return;
          marked[k] = true;
          self._circle(s, c, 5.0, 0.16);
        });
      }
      self._line(r.from, r.to, c, r.kind === 'atk' ? 0.9 : 0.7, r.kind === 'atk' ? '2.2 1.4' : '1.8 1.8');
    });
  };

  var TOP_MODES = [
    { id: 'dalmacja', icon: '\u2B21', label: 'Dalmacja' },
    { id: 'lufycfer', icon: '\u26A1', label: 'Lucyfer' },
    { id: 'king-path', icon: '\u2654', label: 'King Path' },
    { id: 'king-shot', icon: '\u2694', label: 'King Shot' },
  ];
  var LAION_MODES = [
    { id: 'eye-black', label: 'Black' },
    { id: 'eye-white', label: 'White' },
    { id: 'eye-1', label: 'Attack' },
    { id: 'eye-2', label: 'Passive' },
    { id: 'eye-full', label: 'Full' },
  ];

  function buildPanel(container, ctrl) {
    container.classList.add('spot-panel');
    container.innerHTML = '';
    function refreshActive() {
      container.querySelectorAll('.spot-btn').forEach(function (x) {
        var m = x.dataset.mode;
        x.classList.toggle('active', m === 'none' ? ctrl.modes.size === 0 : ctrl.modes.has(m));
      });
    }
    function addHeader(text, cls) {
      var h = document.createElement('div');
      h.className = 'spot-head ' + cls;
      h.textContent = text;
      container.appendChild(h);
    }
    function addBtn(m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'spot-btn';
      b.dataset.mode = m.id;
      b.innerHTML = (m.icon ? '<span class="ic">' + m.icon + '</span>' : '') + '<span>' + m.label + '</span>';
      b.addEventListener('click', function () {
        ctrl.toggle(m.id);
        refreshActive();
      });
      container.appendChild(b);
    }
    addHeader('Mode', 'cyan');
    addBtn({ id: 'none', icon: '\u25C9', label: 'Standard' });
    TOP_MODES.forEach(addBtn);
    addHeader('Laion', 'magenta');
    LAION_MODES.forEach(addBtn);
    refreshActive();
  }

  window.LaionSpotting = {
    create: function (board) { return new Controller(board); },
    buildPanel: buildPanel,
  };
})();
