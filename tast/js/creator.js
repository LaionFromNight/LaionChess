/* Course Creator logic — build lines by playing moves on the board.
   Course persists in localStorage 'laionchess-custom-course'. */
(function () {
  var KEY = 'laionchess-custom-course';
  var engine = new LaionEngine();
  var board = new LaionBoard(document.getElementById('board'), { interactive: true, onSquare: onSquare });
  var spot = window.LaionSpotting ? LaionSpotting.create(board) : null;
  if (spot) LaionSpotting.buildPanel(document.getElementById('spot-panel'), spot);
  var selected = null, legal = [];
  var showEval = true, showBook = true, showTop = false;

  function loadCourse() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { name: '', playAs: 'w', lines: [] };
  }
  var course = loadCourse();
  function saveCourse() {
    try { localStorage.setItem(KEY, JSON.stringify(course)); } catch (e) {}
    flashSaved();
  }

  var el = {
    name: document.getElementById('c-name'),
    saveState: document.getElementById('save-state'),
    line: document.getElementById('line'),
    book: document.getElementById('book'),
    bookSec: document.getElementById('book-sec'),
    evalBar: document.getElementById('eval-bar'),
    evalFill: document.getElementById('eval-fill'),
    evalVal: document.getElementById('eval-val'),
    evalTop: document.getElementById('eval-top'),
    savedWrap: document.getElementById('saved-wrap'),
    savedList: document.getElementById('saved-list'),
    lineCount: document.getElementById('line-count'),
  };

  var savedTimer = null;
  function flashSaved() {
    el.saveState.textContent = 'saved \u2713';
    el.saveState.style.color = 'var(--green)';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { el.saveState.style.color = ''; }, 900);
  }

  function sync(lastMv) {
    board.setFen(engine.boardFen());
    if (lastMv) {
      var hl = {}; hl[lastMv.from] = 'last'; hl[lastMv.to] = 'last';
      board.setHighlights(hl);
    }
    renderLine();
    renderEval();
    renderBook();
    renderTopArrows();
    document.getElementById('btn-undo').disabled = !engine.canBack();
    document.getElementById('btn-save').disabled = engine.sans.length === 0;
  }

  function renderLine() {
    if (!engine.sans.length) {
      el.line.innerHTML = '<span class="empty">No moves yet. Make a move on the board to start building your line.</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < engine.sans.length; i++) {
      if (i % 2 === 0) html += '<span class="num">' + (i / 2 + 1) + '.</span>';
      var cls = 'mv ' + (i % 2 === 0 ? 'w' : 'b') + (engine.ptr === i + 1 ? ' active' : '');
      html += '<span class="' + cls + '" data-i="' + (i + 1) + '">' + engine.sans[i] + '</span>';
    }
    el.line.innerHTML = html;
    el.line.querySelectorAll('.mv').forEach(function (m) {
      m.addEventListener('click', function () { engine.jumpTo(+m.dataset.i); sync(); });
    });
  }

  function renderEval() {
    el.evalBar.style.display = showEval ? '' : 'none';
    if (!showEval) return;
    var e = engine.eval();
    var pct = 50 + Math.max(-45, Math.min(45, e * 6));
    el.evalFill.style.height = pct + '%';
    var label = (e > 0 ? '+' : '') + e.toFixed(1);
    if (e >= 0) { el.evalVal.textContent = label; el.evalTop.textContent = ''; }
    else { el.evalTop.textContent = label; el.evalVal.textContent = ''; }
  }

  function renderBook() {
    el.bookSec.style.display = showBook ? '' : 'none';
    if (!showBook) return;
    LaionBook.render(el.book, engine.key(), function (san) {
      var mv = engine.findBySan(san);
      if (mv) { engine.make(mv); sync(mv); }
    });
  }

  function renderTopArrows() {
    board.clearArrow();
    if (!showTop) return;
    var rows = LaionBook.data[engine.key()];
    if (!rows) return;
    var colors = ['rgba(0, 255, 136, 0.9)', 'rgba(255, 217, 61, 0.8)', 'rgba(255, 0, 255, 0.7)'];
    var widths = [2.8, 2.2, 1.7];
    rows.slice(0, 3).forEach(function (r, i) {
      var mv = engine.findBySan(r[0]);
      if (mv) board.addArrow(mv.from, mv.to, colors[i], widths[i]);
    });
  }

  function renderSaved() {
    el.savedWrap.style.display = course.lines.length ? '' : 'none';
    el.lineCount.textContent = course.lines.length;
    el.savedList.innerHTML = '';
    course.lines.forEach(function (l, i) {
      var d = document.createElement('div');
      d.className = 'saved-line';
      var pgn = document.createElement('span');
      pgn.className = 'pgn'; pgn.textContent = l.pgn;
      var del = document.createElement('button');
      del.className = 'del'; del.title = 'Delete line'; del.textContent = '\u2715';
      del.addEventListener('click', function () {
        course.lines.splice(i, 1);
        saveCourse(); renderSaved();
      });
      d.appendChild(pgn); d.appendChild(del);
      el.savedList.appendChild(d);
    });
  }

  function onSquare(sq) {
    var piece = engine.pieceAt(sq);
    if (selected) {
      var mv = null;
      for (var i = 0; i < legal.length; i++) if (legal[i].to === sq) { mv = legal[i]; break; }
      if (mv) { engine.make(mv); selected = null; legal = []; sync(mv); return; }
      selected = null; legal = [];
      board.clearHighlights();
      if (piece && piece[0] === engine.turn) select(sq);
      return;
    }
    if (piece && piece[0] === engine.turn) select(sq);
  }
  function select(sq) {
    selected = sq;
    legal = engine.movesFrom(sq);
    var hl = {}; hl[sq] = 'select';
    legal.forEach(function (m) { hl[m.to] = 'dot'; });
    board.setHighlights(hl);
  }

  /* controls */
  function wireToggle(id, fn) {
    var t = document.getElementById(id);
    t.addEventListener('click', function () {
      t.classList.toggle('on');
      fn(t.classList.contains('on'));
    });
  }
  wireToggle('tg-eval', function (on) { showEval = on; renderEval(); });
  wireToggle('tg-book', function (on) { showBook = on; renderBook(); });
  wireToggle('tg-top', function (on) { showTop = on; renderTopArrows(); });

  var analysisBtn = document.getElementById('btn-analysis');
  if (analysisBtn) {
    analysisBtn.addEventListener('click', function () {
      this.href = 'Analysis.html?fen=' + encodeURIComponent(engine.fen());
    });
  }

  document.querySelectorAll('#side-seg button').forEach(function (b) {
    if (course.playAs === b.dataset.side) {
      document.querySelectorAll('#side-seg button').forEach(function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
    }
    b.addEventListener('click', function () {
      document.querySelectorAll('#side-seg button').forEach(function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      course.playAs = b.dataset.side;
      saveCourse();
    });
  });

  el.name.value = course.name || '';
  el.name.addEventListener('input', function () {
    course.name = el.name.value;
    saveCourse();
  });

  document.getElementById('btn-undo').addEventListener('click', function () {
    if (engine.canBack()) { engine.jumpTo(engine.ptr - 1); sync(); }
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    engine.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    sync();
  });
  document.getElementById('btn-save').addEventListener('click', function () {
    if (!engine.sans.length) return;
    course.lines.push({ pgn: engine.pgn(), sans: engine.sans.slice(0, engine.ptr) });
    saveCourse();
    renderSaved();
    engine.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    sync();
  });

  document.getElementById('drop').addEventListener('click', function () {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.pgn';
    inp.click();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' && engine.canBack()) { engine.jumpTo(engine.ptr - 1); sync(); }
    if (e.key === 'ArrowRight' && engine.canFwd()) { engine.jumpTo(engine.ptr + 1); sync(); }
  });

  LaionSettingsMenu.attach(document.getElementById('nav-settings'));
  LaionSettingsMenu.attach(document.getElementById('panel-settings'));
  renderSaved();
  sync();
})();
