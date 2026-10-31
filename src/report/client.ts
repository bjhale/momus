// src/report/client.ts

/** The report's one inline script (RFC-0007, ADR-0037). It only reads the data
 * attributes and toolbars renderReport wrote; it never builds images, so each
 * image is in the file once, whatever the mode. ES5 on purpose: it runs from a
 * file:// URL in whatever browser a reviewer has, with no build step. */
export const CLIENT_SCRIPT = `
(function () {
  var main = document.querySelector('main');
  var header = document.querySelector('header');
  var items = Array.prototype.slice.call(main.querySelectorAll('.item'));
  var flat = items.slice();
  var MODES = ['side', 'slider', 'onion', 'highlight'];
  var chips = Array.prototype.slice.call(document.querySelectorAll('nav.filters [data-status]'));
  var search = document.querySelector('nav.filters [data-filter="path"]');
  var source = document.querySelector('nav.filters [data-filter="source"]');
  var viewport = document.querySelector('nav.filters [data-filter="viewport"]');
  var groupBtn = document.querySelector('nav.filters [data-action="group"]');
  var shown = document.querySelector('nav.filters .shown');
  var heads = [];
  var current = null;

  function setMode(m) {
    main.dataset.mode = m;
    main.querySelectorAll('.modes [data-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === m));
    });
  }

  function toggleZoom(item) {
    var v = item.querySelector('.viewer');
    if (!v) return;
    var on = v.classList.toggle('zoom');
    v.querySelector('[data-action="zoom"]').setAttribute('aria-pressed', String(on));
    // Thumbnails mode: the original only loads when someone asks for 1:1.
    if (on) v.querySelectorAll('img[data-full]').forEach(function (img) {
      img.src = img.dataset.full;
      img.removeAttribute('data-full');
    });
  }

  function setMix(v, pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    v.style.setProperty('--mix', pct);
    v.querySelector('.mix').value = pct;
  }

  function apply() {
    var on = {};
    chips.forEach(function (c) { on[c.dataset.status] = c.getAttribute('aria-pressed') === 'true'; });
    var src = source ? source.value : '';
    var vp = viewport ? viewport.value : '';
    var q = search.value.trim().toLowerCase();
    var n = 0;
    items.forEach(function (it) {
      var ok = on[it.dataset.status] !== false &&
        (!src || it.dataset.source === src) &&
        (!vp || it.dataset.viewport === vp) &&
        (!q || it.dataset.label.toLowerCase().indexOf(q) >= 0);
      it.hidden = !ok;
      if (ok) n++;
    });
    heads.forEach(function (h) {
      h.el.hidden = h.members.every(function (it) { return it.hidden; });
    });
    shown.textContent = n + ' of ' + items.length + ' shown';
  }

  // Moves the existing nodes, never clones them: an item's images stay
  // decoded, and its open state and zoom survive the regroup.
  function group(on) {
    groupBtn.setAttribute('aria-pressed', String(on));
    heads.forEach(function (h) { h.el.remove(); });
    heads = [];
    if (!on) {
      flat.forEach(function (it) { main.appendChild(it); });
      return apply();
    }
    var by = {}, order = [];
    flat.forEach(function (it) {
      var k = it.dataset.target;
      if (!by[k]) { by[k] = []; order.push(k); }
      by[k].push(it);
    });
    function top(k) {
      return Math.max.apply(null, by[k].map(function (it) { return parseFloat(it.dataset.rank); }));
    }
    // Compared, not subtracted: two error targets are both Infinity.
    order.sort(function (a, b) { var ta = top(a), tb = top(b); return tb > ta ? 1 : tb < ta ? -1 : 0; });
    order.forEach(function (k) {
      var members = by[k].slice().sort(function (a, b) { return a.dataset.viewport - b.dataset.viewport; });
      var h = document.createElement('h2');
      h.className = 'group-head';
      h.textContent = members[0].dataset.label;
      main.appendChild(h);
      members.forEach(function (it) { main.appendChild(it); });
      heads.push({ el: h, members: members });
    });
    apply();
  }

  function currentItem() {
    var a = document.activeElement;
    return (a && a.closest && a.closest('.item')) || current;
  }

  // Walks the DOM order (which grouping changes), skipping hidden items, from
  // wherever the current item is, even if a filter just hid it.
  function move(d) {
    var all = Array.prototype.slice.call(main.querySelectorAll('.item'));
    var cur = currentItem();
    var i = cur ? all.indexOf(cur) : (d > 0 ? -1 : all.length);
    var next = null;
    for (var j = i + d; j >= 0 && j < all.length; j += d) {
      if (!all[j].hidden) { next = all[j]; break; }
    }
    if (!next) return;
    if (cur && cur !== next) cur.open = false;
    next.open = true;
    current = next;
    next.querySelector('summary').focus({ preventScroll: true });
    next.scrollIntoView({ block: 'start' });
  }

  main.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.action === 'zoom') toggleZoom(b.closest('.item'));
  });
  main.addEventListener('input', function (e) {
    if (e.target.classList.contains('mix')) setMix(e.target.closest('.viewer'), Number(e.target.value));
  });
  // toggle doesn't bubble; capture it so the last item opened by mouse is
  // where j/k carry on from.
  main.addEventListener('toggle', function (e) {
    if (e.target.open) current = e.target;
  }, true);

  var drag = null;
  main.addEventListener('pointerdown', function (e) {
    var stage = e.target.closest('.stage');
    if (!stage || e.button !== 0) return;
    var v = stage.closest('.viewer');
    if (main.dataset.mode === 'slider') drag = { kind: 'mix', v: v, frame: stage.querySelector('[data-side="dev"] .frame') };
    else if (v.classList.contains('zoom')) drag = { kind: 'pan', stage: stage, x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
    else return;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    onDrag(e);
  });
  function onDrag(e) {
    if (!drag) return;
    if (drag.kind === 'mix') {
      var r = drag.frame.getBoundingClientRect();
      if (r.width) setMix(drag.v, ((e.clientX - r.left) / r.width) * 100);
    } else {
      drag.stage.scrollLeft = drag.l - (e.clientX - drag.x);
      drag.stage.scrollTop = drag.t - (e.clientY - drag.y);
    }
  }
  main.addEventListener('pointermove', onDrag);
  main.addEventListener('pointerup', function () { drag = null; });
  main.addEventListener('pointercancel', function () { drag = null; });

  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'));
      apply();
    });
  });
  search.addEventListener('input', apply);
  if (source) source.addEventListener('change', apply);
  if (viewport) viewport.addEventListener('change', apply);
  groupBtn.addEventListener('click', function () { group(groupBtn.getAttribute('aria-pressed') !== 'true'); });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t.matches && t.matches('input[type="search"], input[type="text"], select, textarea')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    var k = e.key, cur;
    if (k === 'j') move(1);
    else if (k === 'k') move(-1);
    else if (k.length === 1 && k >= '1' && k <= '4') setMode(MODES[k - 1]);
    else if (k === 'm') setMode(MODES[(MODES.indexOf(main.dataset.mode) + 1) % MODES.length]);
    else if (k === 'z') { cur = currentItem(); if (cur) toggleZoom(cur); }
    else if (k === 'g') group(groupBtn.getAttribute('aria-pressed') !== 'true');
    else if (k === '/') search.focus();
    else return;
    // Without this, the '/' that focused the search box would be typed into it.
    e.preventDefault();
  });

  // The header is sticky and its height depends on the filters; an item
  // scrolled to by j/k must land below it.
  function headerHeight() {
    document.documentElement.style.setProperty('--hh', header.offsetHeight + 'px');
  }
  window.addEventListener('resize', headerHeight);
  headerHeight();
  apply();
  main.dataset.ready = '1';
})();
`;
