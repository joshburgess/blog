// Theme system: palette + typography + mode (dark/light)
(function () {
  var KEYS = { palette: 'palette', typography: 'typography', mode: 'mode' };
  var DEFAULTS = { palette: 'copper', typography: 'technical', mode: 'light' };

  function get(key) {
    return localStorage.getItem(key) || DEFAULTS[key];
  }

  function getMode() {
    var stored = localStorage.getItem(KEYS.mode);
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply() {
    var el = document.documentElement;
    el.setAttribute('data-palette', get(KEYS.palette));
    el.setAttribute('data-typography', get(KEYS.typography));
    el.setAttribute('data-mode', getMode());
  }

  // Apply immediately to prevent flash
  apply();

  document.addEventListener('DOMContentLoaded', function () {
    var moonSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var sunSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var chevronSVG = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>';

    // --- Custom dropdown builder ---
    function buildDropdown(nativeSelect, storageKey) {
      if (!nativeSelect) return null;

      var wrapper = document.createElement('div');
      wrapper.className = 'custom-dropdown';

      var trigger = document.createElement('button');
      trigger.className = 'custom-dropdown-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      var label = document.createElement('span');
      label.className = 'custom-dropdown-label';

      var chevron = document.createElement('span');
      chevron.className = 'custom-dropdown-chevron';
      chevron.innerHTML = chevronSVG;

      trigger.appendChild(label);
      trigger.appendChild(chevron);

      var menu = document.createElement('div');
      menu.className = 'custom-dropdown-menu';
      menu.setAttribute('role', 'listbox');

      var options = Array.from(nativeSelect.options);
      options.forEach(function (opt) {
        var item = document.createElement('button');
        item.className = 'custom-dropdown-item';
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', opt.value);
        item.textContent = opt.textContent;
        menu.appendChild(item);
      });

      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);

      // Replace the native select
      nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);
      nativeSelect.style.display = 'none';

      // State
      var currentValue = get(storageKey);

      function setValue(val) {
        currentValue = val;
        localStorage.setItem(storageKey, val);
        apply();
        updateDisplay();
        close();
      }

      function updateDisplay() {
        var v = get(storageKey);
        var opt = options.find(function (o) { return o.value === v; });
        label.textContent = opt ? opt.textContent : v;
        menu.querySelectorAll('.custom-dropdown-item').forEach(function (item) {
          item.classList.toggle('active', item.getAttribute('data-value') === v);
        });
      }

      function open() {
        wrapper.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }

      function close() {
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }

      function toggle() {
        if (wrapper.classList.contains('open')) close(); else open();
      }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        // Close other open dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(function (d) {
          if (d !== wrapper) d.classList.remove('open');
        });
        toggle();
      });

      menu.addEventListener('click', function (e) {
        var item = e.target.closest('.custom-dropdown-item');
        if (!item) return;
        setValue(item.getAttribute('data-value'));
      });

      updateDisplay();
      return { wrapper: wrapper, close: close, updateDisplay: updateDisplay };
    }

    // --- Navigation dropdown builder ---
    function buildNavDropdown(nativeSelect) {
      if (!nativeSelect) return null;

      var wrapper = document.createElement('div');
      wrapper.className = 'custom-dropdown';

      var trigger = document.createElement('button');
      trigger.className = 'custom-dropdown-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      var label = document.createElement('span');
      label.className = 'custom-dropdown-label';

      var chevron = document.createElement('span');
      chevron.className = 'custom-dropdown-chevron';
      chevron.innerHTML = chevronSVG;

      trigger.appendChild(label);
      trigger.appendChild(chevron);

      var menu = document.createElement('div');
      menu.className = 'custom-dropdown-menu';
      menu.setAttribute('role', 'listbox');

      var options = Array.from(nativeSelect.options);
      options.forEach(function (opt) {
        var item = document.createElement('button');
        item.className = 'custom-dropdown-item';
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', opt.value);
        item.textContent = opt.textContent;
        if (window.location.pathname.indexOf(opt.value) === 0 && opt.value !== '/') {
          item.classList.add('active');
        } else if (opt.value === '/' && window.location.pathname === '/') {
          item.classList.add('active');
        }
        menu.appendChild(item);
      });

      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);

      nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);
      nativeSelect.style.display = 'none';

      var currentOpt = options.find(function (o) {
        return o.value !== '/' && window.location.pathname.indexOf(o.value) === 0;
      }) || (window.location.pathname === '/' ? options[0] : null) || options[0];
      label.textContent = currentOpt ? currentOpt.textContent : 'Sites';

      function open() { wrapper.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
      function close() { wrapper.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }
      function toggle() { if (wrapper.classList.contains('open')) close(); else open(); }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown.open').forEach(function (d) {
          if (d !== wrapper) d.classList.remove('open');
        });
        toggle();
      });

      menu.addEventListener('click', function (e) {
        var item = e.target.closest('.custom-dropdown-item');
        if (!item) return;
        var url = item.getAttribute('data-value');
        if (url) window.location.href = url;
      });

      return wrapper;
    }

    // Build site navigation dropdown
    var ss = document.querySelector('.site-select');
    buildNavDropdown(ss);

    // Build custom dropdowns
    var ps = document.querySelector('.palette-select');
    var ts = document.querySelector('.typography-select');
    var paletteDropdown = buildDropdown(ps, KEYS.palette);
    var typographyDropdown = buildDropdown(ts, KEYS.typography);

    // Close dropdowns on outside click
    document.addEventListener('click', function () {
      document.querySelectorAll('.custom-dropdown.open').forEach(function (d) {
        d.classList.remove('open');
      });
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.custom-dropdown.open').forEach(function (d) {
          d.classList.remove('open');
        });
      }
    });

    // Mode toggle
    var mb = document.querySelector('.mode-toggle');
    if (mb) mb.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-mode') || 'dark';
      var next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(KEYS.mode, next);
      apply();
      mb.innerHTML = next === 'dark' ? moonSVG : sunSVG;
    });

    if (mb) mb.innerHTML = getMode() === 'dark' ? moonSVG : sunSVG;
  });
})();

// Project tag filtering
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var cards = document.querySelectorAll('.project-card');
    if (!cards.length) return;

    function getActiveTag() {
      var params = new URLSearchParams(window.location.search);
      return params.get('tag');
    }

    var heading = document.querySelector('.taxonomy-term-heading');
    var clearLink = null;
    if (heading) {
      clearLink = document.createElement('a');
      clearLink.href = window.location.pathname;
      clearLink.className = 'tag-filter-clear';
      clearLink.textContent = 'Show all projects';
      clearLink.style.display = 'none';
      heading.parentNode.insertBefore(clearLink, heading.nextSibling);

      clearLink.addEventListener('click', function(e) {
        e.preventDefault();
        history.pushState(null, '', window.location.pathname);
        filterProjects(null);
      });
    }

    function filterProjects(tag) {
      cards.forEach(function(card) {
        if (!tag) {
          card.style.display = '';
          return;
        }
        var tags = card.querySelectorAll('.tag');
        var match = Array.from(tags).some(function(t) {
          return t.textContent.trim() === tag;
        });
        card.style.display = match ? '' : 'none';
      });

      document.querySelectorAll('.project-tag-filter').forEach(function(a) {
        var linkTag = new URLSearchParams(a.search).get('tag');
        a.classList.toggle('tag-active', linkTag === tag);
      });

      if (clearLink) clearLink.style.display = tag ? '' : 'none';
    }

    document.addEventListener('click', function(e) {
      var link = e.target.closest('.project-tag-filter');
      if (!link) return;
      e.preventDefault();
      var tag = new URLSearchParams(link.search).get('tag');
      var current = getActiveTag();
      if (tag === current) {
        history.pushState(null, '', window.location.pathname);
        filterProjects(null);
      } else {
        history.pushState(null, '', '?tag=' + encodeURIComponent(tag));
        filterProjects(tag);
      }
    });

    filterProjects(getActiveTag());
  });
})();
