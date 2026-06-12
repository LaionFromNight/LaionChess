/* Shared settings popover: board theme, piece set, accent, toggles.
   Usage: LaionSettingsMenu.attach(buttonEl, { sections: ['board','pieces','accent','toggles'] }) */
(function () {
  var openMenu = null;

  function close() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
    document.removeEventListener('click', onDocClick, true);
  }
  function onDocClick(e) {
    if (openMenu && !openMenu.contains(e.target)) close();
  }

  function radioGroup(title, options, current, onPick) {
    var frag = document.createDocumentFragment();
    var h = document.createElement('div');
    h.className = 'menu-section'; h.textContent = title;
    frag.appendChild(h);
    options.forEach(function (opt) {
      var b = document.createElement('button');
      b.className = 'menu-item'; b.type = 'button';
      var label = document.createElement('span');
      label.textContent = opt.label;
      var check = document.createElement('span');
      check.className = 'check';
      check.textContent = current === opt.value ? '\u2713' : '';
      b.appendChild(label); b.appendChild(check);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        onPick(opt.value);
        close();
      });
      frag.appendChild(b);
    });
    return frag;
  }

  function toggleItem(label, key) {
    var b = document.createElement('button');
    b.className = 'menu-item'; b.type = 'button';
    var l = document.createElement('span'); l.textContent = label;
    var check = document.createElement('span'); check.className = 'check';
    check.textContent = LaionSettings.get(key) ? '\u2713' : '';
    b.appendChild(l); b.appendChild(check);
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      LaionSettings.set(key, !LaionSettings.get(key));
      check.textContent = LaionSettings.get(key) ? '\u2713' : '';
    });
    return b;
  }

  function build(opts) {
    var sections = (opts && opts.sections) || ['board', 'pieces', 'accent', 'toggles'];
    var menu = document.createElement('div');
    menu.className = 'menu';

    if (sections.indexOf('board') >= 0) {
      var themes = LaionSettings.boardThemes;
      menu.appendChild(radioGroup('Board Theme',
        Object.keys(themes).map(function (k) { return { value: k, label: themes[k].label }; }),
        LaionSettings.get('boardTheme'),
        function (v) { LaionSettings.set('boardTheme', v); }));
      menu.appendChild(document.createElement('hr')).className = 'menu-hr';
    }
    if (sections.indexOf('pieces') >= 0) {
      var sets = LaionSettings.pieceSets;
      menu.appendChild(radioGroup('Piece Set',
        Object.keys(sets).map(function (k) { return { value: k, label: sets[k].label }; }),
        LaionSettings.get('pieceSet'),
        function (v) { LaionSettings.set('pieceSet', v); }));
      menu.appendChild(document.createElement('hr')).className = 'menu-hr';
    }
    if (sections.indexOf('accent') >= 0) {
      var h = document.createElement('div');
      h.className = 'menu-section'; h.textContent = 'UI Accent';
      menu.appendChild(h);
      var row = document.createElement('div');
      row.className = 'swatch-row';
      [{ k: 'cyan', c: '#00ffff' }, { k: 'green', c: '#00ff88' },
       { k: 'magenta', c: '#ff00ff' }, { k: 'amber', c: '#ffd93d' }].forEach(function (s) {
        var sw = document.createElement('button');
        sw.className = 'swatch' + (LaionSettings.get('accent') === s.k ? ' sel' : '');
        sw.type = 'button';
        sw.style.background = s.c;
        sw.title = s.k;
        sw.addEventListener('click', function (e) {
          e.stopPropagation();
          LaionSettings.set('accent', s.k);
          row.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
          sw.classList.add('sel');
        });
        row.appendChild(sw);
      });
      menu.appendChild(row);
    }
    if (sections.indexOf('toggles') >= 0) {
      var hr = document.createElement('hr'); hr.className = 'menu-hr';
      menu.appendChild(hr);
      var h2 = document.createElement('div');
      h2.className = 'menu-section'; h2.textContent = 'Trainer';
      menu.appendChild(h2);
      menu.appendChild(toggleItem('Training arrows', 'arrows'));
      menu.appendChild(toggleItem('Coordinates', 'coords'));
    }
    return menu;
  }

  window.LaionSettingsMenu = {
    attach: function (btn, opts) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (openMenu) { close(); return; }
        var menu = build(opts);
        var host = btn.closest('.menu-host') || btn.parentElement;
        host.style.position = host.style.position || 'relative';
        host.appendChild(menu);
        // position below button, right-aligned if near right edge
        menu.style.top = (btn.offsetTop + btn.offsetHeight + 6) + 'px';
        var rightSpace = window.innerWidth - btn.getBoundingClientRect().right;
        if (rightSpace < 260) menu.style.right = '0px';
        else menu.style.left = btn.offsetLeft + 'px';
        openMenu = menu;
        setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
      });
    },
  };
})();
