/* Trainer logic for the Scotch Game course. */
(function () {
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var PROGRESS_KEY = 'laionchess-scotch-progress';
  var course = window.SCOTCH_COURSE;
  var lines = course.lines;

  function loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { learn: {}, practice: {} };
  }
  var progress = loadProgress();
  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) {}
  }

  var board = new LaionBoard(document.getElementById('board'), {
    interactive: true,
    onSquare: onSquare,
  });
  var spot = window.LaionSpotting ? LaionSpotting.create(board) : null;
  if (spot) LaionSpotting.buildPanel(document.getElementById('spot-panel'), spot);

  var state = {
    mode: 'learn',
    lineIdx: 0,
    ply: 0,
    selected: null,
    done: false,
    mistakes: 0,
    hintUsed: false,
  };

  var el = {
    coach: document.getElementById('coach-text'),
    coachSub: document.getElementById('coach-sub'),
    modeName: document.getElementById('mode-name'),
    lineNo: document.getElementById('line-no'),
    movesStrip: document.getElementById('moves-strip'),
    book: document.getElementById('book'),
    progress: document.getElementById('ply-progress'),
    progressLabel: document.getElementById('ply-progress-label'),
    linesList: document.getElementById('lines-list'),
    learnStat: document.getElementById('learn-stat'),
    practiceStat: document.getElementById('practice-stat'),
    tabLearn: document.getElementById('tab-learn'),
    tabPractice: document.getElementById('tab-practice'),
    completeSlot: document.getElementById('complete-slot'),
    hint: document.getElementById('btn-hint'),
    restart: document.getElementById('btn-restart'),
  };

  function line() { return lines[state.lineIdx]; }
  function userMoves(l) {
    var n = 0;
    for (var i = 0; i < l.plies.length; i++) if (i % 2 === 0) n++;
    return n;
  }
  function countDone(mode) {
    var n = 0;
    lines.forEach(function (l) { if (progress[mode][l.id]) n++; });
    return n;
  }

  /* ---------- rendering ---------- */
  function renderStats() {
    el.learnStat.textContent = countDone('learn') + '/' + lines.length + ' lines';
    el.practiceStat.textContent = countDone('practice') + '/' + lines.length + ' lines';
  }

  function renderLines() {
    el.linesList.innerHTML = '';
    lines.forEach(function (l, i) {
      var b = document.createElement('button');
      b.className = 'line-row' + (i === state.lineIdx ? ' current' : '');
      b.type = 'button';
      var doneMark = progress[state.mode][l.id];
      b.innerHTML =
        '<span class="st ' + (doneMark ? 'done' : 'todo') + '">' + (doneMark ? '\u2713' : '\u25CB') + '</span>' +
        '<span class="nm">' + l.name + '</span>' +
        '<span class="tg">' + l.tag + '</span>';
      b.addEventListener('click', function () { startLine(i); });
      el.linesList.appendChild(b);
    });
  }

  function renderMoves() {
    var plies = line().plies.slice(0, state.ply);
    renderBook();
    if (!plies.length) {
      el.movesStrip.innerHTML = '<span class="empty">No moves yet \u2014 your move as White.</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < plies.length; i += 2) {
      html += '<span class="num">' + (i / 2 + 1) + '.</span>';
      html += '<span class="w">' + plies[i].san + '</span>';
      if (plies[i + 1]) html += '<span class="b">' + plies[i + 1].san + '</span>';
    }
    el.movesStrip.innerHTML = html;
  }

  function renderBook() {
    if (!el.book || !window.LaionBook) return;
    var turn = state.ply % 2 === 0 ? 'w' : 'b';
    LaionBook.render(el.book, board.boardFen() + ' ' + turn, null);
  }

  function renderProgress() {
    var total = userMoves(line());
    var doneMoves = Math.min(Math.ceil(state.ply / 2), total);
    el.progress.style.width = (total ? (doneMoves / total) * 100 : 0) + '%';
    el.progressLabel.textContent = doneMoves + ' / ' + total + ' moves';
  }

  function coach(text, sub) {
    el.coach.textContent = text;
    el.coachSub.textContent = sub || '';
  }

  /* ---------- flow ---------- */
  function startLine(idx) {
    state.lineIdx = idx;
    state.ply = 0;
    state.selected = null;
    state.done = false;
    state.mistakes = 0;
    state.hintUsed = false;
    el.completeSlot.innerHTML = '';
    el.lineNo.textContent = '#' + (idx + 1);
    board.setFen(START_FEN);
    renderLines();
    renderMoves();
    renderProgress();
    promptUser();
  }

  function expected() { return line().plies[state.ply]; }

  function promptUser() {
    var mv = expected();
    if (!mv) { finishLine(); return; }
    var hl = {};
    if (state.mode === 'learn') {
      coach(mv.note || ('Find the move: it\u2019s your turn.'), 'Play ' + mv.san);
      if (LaionSettings.get('arrows')) board.setArrow(mv.from, mv.to);
      hl[mv.from] = 'hint';
    } else {
      coach('Your move \u2014 recall the line.', state.mistakes ? state.mistakes + ' mistake' + (state.mistakes > 1 ? 's' : '') + ' so far' : '');
      board.clearArrow();
    }
    board.setHighlights(hl);
  }

  function playUserMove() {
    var mv = expected();
    board.clearArrow();
    board.applyMove(mv);
    state.ply++;
    state.selected = null;
    renderMoves();
    renderProgress();
    var hl = {}; hl[mv.from] = 'last'; hl[mv.to] = 'ok';
    board.setHighlights(hl);
    var reply = line().plies[state.ply];
    if (!reply) { setTimeout(finishLine, 350); return; }
    coach('Good. ' + (reply ? 'Black replies\u2026' : ''));
    setTimeout(function () {
      board.applyMove(reply);
      state.ply++;
      renderMoves();
      renderProgress();
      var h2 = {}; h2[reply.from] = 'last'; h2[reply.to] = 'last';
      board.setHighlights(h2);
      setTimeout(promptUser, 350);
    }, 650);
  }

  function wrongMove(sq) {
    state.mistakes++;
    var hl = {}; hl[sq] = 'wrong';
    board.setHighlights(hl);
    if (state.mode === 'learn') {
      coach('Not quite \u2014 try again.', 'Hint: ' + expected().san);
      if (LaionSettings.get('arrows')) board.setArrow(expected().from, expected().to);
    } else {
      coach('Not the repertoire move \u2014 try again.', state.mistakes + ' mistake' + (state.mistakes > 1 ? 's' : ''));
    }
    setTimeout(function () {
      var h = {};
      if (state.mode === 'learn') h[expected().from] = 'hint';
      board.setHighlights(h);
    }, 500);
  }

  function finishLine() {
    state.done = true;
    var perfect = state.mistakes === 0 && !state.hintUsed;
    progress[state.mode][line().id] = true;
    saveProgress();
    renderStats();
    renderLines();
    board.clearArrow();
    coach(perfect ? 'Flawless. The line is yours.' : 'Line complete \u2014 review it again to make it stick.',
      state.mistakes ? state.mistakes + ' mistake' + (state.mistakes > 1 ? 's' : '') : 'No mistakes');

    var div = document.createElement('div');
    div.className = 'complete-banner fade-in-up';
    div.innerHTML =
      '<div class="big">\u2713 Line Complete</div>' +
      '<div class="small">' + line().name + ' \u2014 ' + userMoves(line()) + ' moves' +
      (perfect ? ' \u00b7 perfect run' : '') + '</div>';
    var row = document.createElement('div');
    row.className = 'row';
    var next = document.createElement('button');
    next.className = 'btn btn-green'; next.textContent = '\u25B8 Next line';
    next.addEventListener('click', function () {
      var ni = nextUndoneIdx();
      startLine(ni);
    });
    var replay = document.createElement('button');
    replay.className = 'btn btn-ghost'; replay.textContent = '\u21BB Replay';
    replay.addEventListener('click', function () { startLine(state.lineIdx); });
    row.appendChild(next); row.appendChild(replay);
    div.appendChild(row);
    el.completeSlot.innerHTML = '';
    el.completeSlot.appendChild(div);
  }

  function nextUndoneIdx() {
    for (var i = 1; i <= lines.length; i++) {
      var idx = (state.lineIdx + i) % lines.length;
      if (!progress[state.mode][lines[idx].id]) return idx;
    }
    return (state.lineIdx + 1) % lines.length;
  }

  /* ---------- input ---------- */
  function onSquare(sq) {
    if (state.done) return;
    var mv = expected();
    if (!mv) return;
    var piece = board.pieceAt(sq);

    if (state.selected) {
      if (sq === state.selected) { // deselect
        state.selected = null;
        promptUser();
        return;
      }
      if (state.selected === mv.from && sq === mv.to) { playUserMove(); return; }
      if (piece && piece[0] === 'w') { // reselect
        state.selected = sq;
        selectSquare(sq);
        return;
      }
      wrongMove(sq);
      state.selected = null;
      return;
    }

    if (piece && piece[0] === 'w') {
      state.selected = sq;
      selectSquare(sq);
    }
  }

  function selectSquare(sq) {
    var hl = {};
    hl[sq] = 'select';
    var mv = expected();
    if (state.mode === 'learn' && sq === mv.from) hl[mv.to] = 'dot';
    board.setHighlights(hl);
  }

  /* ---------- controls ---------- */
  el.hint.addEventListener('click', function () {
    if (state.done) return;
    state.hintUsed = true;
    var mv = expected();
    if (!mv) return;
    board.setArrow(mv.from, mv.to);
    var hl = {}; hl[mv.from] = 'hint';
    board.setHighlights(hl);
    coach('Hint: ' + mv.san, 'From ' + mv.from + ' to ' + mv.to);
  });

  el.restart.addEventListener('click', function () { startLine(state.lineIdx); });

  var analysisBtn = document.getElementById('btn-analysis');
  if (analysisBtn) {
    analysisBtn.addEventListener('click', function () {
      var turn = state.ply % 2 === 0 ? 'w' : 'b';
      this.href = 'Analysis.html?fen=' + encodeURIComponent(board.boardFen() + ' ' + turn + ' KQkq - 0 1');
    });
  }

  function setMode(mode) {
    state.mode = mode;
    el.modeName.textContent = mode === 'learn' ? 'Learn' : 'Practice';
    el.tabLearn.classList.toggle('active', mode === 'learn');
    el.tabPractice.classList.toggle('active', mode === 'practice');
    startLine(state.lineIdx);
  }
  el.tabLearn.addEventListener('click', function () { setMode('learn'); });
  el.tabPractice.addEventListener('click', function () { setMode('practice'); });

  LaionSettingsMenu.attach(document.getElementById('nav-settings'));
  LaionSettingsMenu.attach(document.getElementById('panel-settings'));

  LaionSettings.onChange(function (k) {
    if (k === 'arrows' && !state.done) promptUser();
  });

  renderStats();
  startLine(0);
})();
