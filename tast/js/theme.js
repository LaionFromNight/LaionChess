/* LaionChess shared settings: accent, board theme, piece set, toggles.
   Persisted in localStorage under 'laionchess-ui-settings'. */
(function () {
  var KEY = 'laionchess-ui-settings';

  var DEFAULTS = {
    accent: 'cyan',        // cyan | green | magenta | amber
    boardTheme: 'classic', // classic | neon | forest | ice
    pieceSet: 'classic',   // classic | merida | alpha | glyph
    arrows: true,
    coords: true,
  };

  var BOARD_THEMES = {
    classic: { label: 'Classic Wood', light: '#f0d9b5', dark: '#b58863', coordL: '#b58863', coordD: '#f0d9b5' },
    neon:    { label: 'Neon Night',   light: '#1e2a44', dark: '#121a30', coordL: '#5fd9d9', coordD: '#5fd9d9' },
    forest:  { label: 'Forest',       light: '#e6e8c9', dark: '#6a8f4f', coordL: '#6a8f4f', coordD: '#e6e8c9' },
    ice:     { label: 'Ice',          light: '#dee3e6', dark: '#8ca2ad', coordL: '#8ca2ad', coordD: '#dee3e6' },
  };

  // SVG piece sets served from open-source lichess assets (jsDelivr CDN) / cburnett.
  var CDN = 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/';
  var PIECE_SETS = {
    classic: { label: 'Classic (Cburnett)', kind: 'img', dir: CDN + 'cburnett/' },
    merida:  { label: 'Merida',             kind: 'img', dir: CDN + 'merida/' },
    alpha:   { label: 'Alpha',              kind: 'img', dir: CDN + 'alpha/' },
    glyph:   { label: 'Glyph (Unicode)',    kind: 'glyph' },
  };

  var GLYPHS = {
    wK: '\u2654', wQ: '\u2655', wR: '\u2656', wB: '\u2657', wN: '\u2658', wP: '\u2659',
    bK: '\u265A', bQ: '\u265B', bR: '\u265C', bB: '\u265D', bN: '\u265E', bP: '\u265F',
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }

  var state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function applyAccent() {
    document.documentElement.setAttribute('data-accent', state.accent);
  }

  var listeners = [];

  window.LaionSettings = {
    get: function (k) { return state[k]; },
    all: function () { return Object.assign({}, state); },
    set: function (k, v) {
      state[k] = v; save();
      if (k === 'accent') applyAccent();
      listeners.forEach(function (fn) { fn(k, v); });
    },
    onChange: function (fn) { listeners.push(fn); },
    boardThemes: BOARD_THEMES,
    pieceSets: PIECE_SETS,
    glyphs: GLYPHS,
    pieceSrc: function (code) { // code like 'wK'
      var set = PIECE_SETS[state.pieceSet] || PIECE_SETS.classic;
      if (set.kind === 'glyph') return null;
      return set.dir + code + '.svg';
    },
  };

  applyAccent();
})();
