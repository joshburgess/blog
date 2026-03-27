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

  function sync() {
    var ps = document.querySelector('.palette-select');
    var ts = document.querySelector('.typography-select');
    if (ps) ps.value = get(KEYS.palette);
    if (ts) ts.value = get(KEYS.typography);
  }

  // Apply immediately to prevent flash
  apply();

  document.addEventListener('DOMContentLoaded', function () {
    sync();

    var ps = document.querySelector('.palette-select');
    var ts = document.querySelector('.typography-select');
    var mb = document.querySelector('.mode-toggle');

    if (ps) ps.addEventListener('change', function () {
      localStorage.setItem(KEYS.palette, ps.value);
      apply();
    });

    if (ts) ts.addEventListener('change', function () {
      localStorage.setItem(KEYS.typography, ts.value);
      apply();
    });

    if (mb) mb.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-mode') || 'dark';
      var next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(KEYS.mode, next);
      apply();
      mb.textContent = next === 'dark' ? '\u263D' : '\u2600';
    });

    // Set initial icon
    if (mb) mb.textContent = getMode() === 'dark' ? '\u263D' : '\u2600';
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

    // Create "Show all" link upfront (hidden by default)
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

      // Update active state on filter tags
      document.querySelectorAll('.project-tag-filter').forEach(function(a) {
        var linkTag = new URLSearchParams(a.search).get('tag');
        a.classList.toggle('tag-active', linkTag === tag);
      });

      // Show/hide clear filter
      if (clearLink) clearLink.style.display = tag ? '' : 'none';
    }

    // Handle click on filter tags
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

    // Apply filter on page load
    filterProjects(getActiveTag());
  });
})();
