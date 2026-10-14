/* AutoCut Engine landing page: the page-local logic.
   Every panel computes its state from the sample data below. Nothing is
   painted to look like it runs: split, merge, the product toggle, the gate,
   the export manifest and the download all operate on these arrays. */
(function () {
  'use strict';

  // Where "Request access" emails go. Replace before you publish.
  var CONTACT_EMAIL = 'hello@example.com';

  var reduce = window.ScrollCraft ? window.ScrollCraft.reduce : matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)');
  var AD_LENGTH = 30;
  var MAX_SCENES = 10;

  var SCRIPTS = [
    { hook: 'Your 6am alarm just met its match.', body: 'Slow-steeped overnight. Smooth enough to skip the sugar.', cta: 'Grab a can' },
    { hook: 'Cold brew that tastes like you made it.', body: 'Small batch, never bitter, ready when you are.', cta: 'Try Northbeam today' },
    { hook: 'Coffee, minus the queue.', body: 'Pour, sip, and get on with your morning.', cta: 'Find it in store' }
  ];

  var GROUP_LABEL = { hook_1: 'Hook 1', body: 'Body', cta: 'CTA' };

  var scenes = [
    { group: 'hook_1', copy: 'Cold brew that tastes like you made it.', visual: 'Close-up: a hand lifts a matte Northbeam can off a sunlit kitchen counter.', pif: true },
    { group: 'body', copy: 'Small batch, steeped slow overnight.', visual: 'Wide: steel steeping tanks at dawn, steam on the windows.', pif: false },
    { group: 'body', copy: 'Never bitter, so there is nothing to cover up.', visual: 'Medium: cold brew poured over ice, no milk or sugar in shot.', pif: true },
    { group: 'body', copy: 'Ready when you are, straight from the fridge.', visual: 'A commuter takes a can from the fridge door on the way out.', pif: true },
    { group: 'body', copy: 'Good for the walk, the train and the first meeting.', visual: 'Quick cuts: the can in a coat pocket, on a train table, on a desk.', pif: true },
    { group: 'cta', copy: 'Try Northbeam today.', visual: 'Packshot: three cans on the counter, logo facing camera.', pif: true }
  ];

  var gate = { state: 'waiting', at: null, scenes: 0 };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function progressOf(act) { var v = parseFloat(act.style.getPropertyValue('--sc-p')); return isNaN(v) ? 0 : v; }

  /* ------------------------------------------------------------ 1 · hero -- */
  var heroAct = $('#scripts');
  var heroStage = $('[data-hero]');
  var slots = $$('.slot');
  var cardsPlane = $('#cards');
  var desk = $('.plane--desk');
  var light = $('.plane--light');
  var work = $('.plane--work');

  var cards = SCRIPTS.map(function (s, i) {
    var a = el('article', 'script');
    a.setAttribute('aria-label', 'Script variant ' + (i + 1));
    a.appendChild(el('p', 'script__v', 'Variant ' + (i + 1)));
    a.appendChild(el('p', 'script__hook', s.hook));
    a.appendChild(el('p', 'script__body', s.body));
    a.appendChild(el('p', 'script__cta', s.cta));
    var use = el('span', 'script__use', 'Use this script');
    a.appendChild(use);
    cardsPlane.appendChild(a);
    return { el: a, use: use, w: 0, h: 0 };
  });

  var FAN = [{ x: -0.16, r: -7 }, { x: 0.02, r: 2.5 }, { x: 0.14, r: 8 }];
  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduce) {
    window.addEventListener('pointermove', function (e) {
      if (!fine.matches) return;
      pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  var lastSelected = null;
  function drawHero() {
    var p = reduce ? 1 : progressOf(heroAct);
    pointer.x += (pointer.tx - pointer.x) * 0.08;
    pointer.y += (pointer.ty - pointer.y) * 0.08;
    var mx = reduce ? 0 : pointer.x, my = reduce ? 0 : pointer.y;

    if (!reduce) {
      desk.style.transform = 'translate3d(' + (mx * -8).toFixed(1) + 'px,' + (-p * 90 + my * -6).toFixed(1) + 'px,0)';
      light.style.transform = 'translate3d(' + (-p * 80 + mx * 18).toFixed(1) + 'px,' + (-p * 50 + my * 12).toFixed(1) + 'px,0)';
      work.style.transform = innerWidth > 860 ? 'translate3d(' + (mx * 3).toFixed(1) + 'px,' + (-p * 26).toFixed(1) + 'px,0)' : 'none';
    }

    var sr = heroStage.getBoundingClientRect();
    var sig = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var r = slots[i].getBoundingClientRect();
      if (Math.abs(c.w - r.width) > 0.5 || Math.abs(c.h - r.height) > 0.5) {
        c.w = r.width; c.h = r.height;
        c.el.style.width = r.width + 'px';
        c.el.style.height = r.height + 'px';
      }
      var tx = r.left - sr.left, ty = r.top - sr.top;
      var e = reduce ? 1 : easeOut(clamp01((p - 0.04 - i * 0.07) / 0.55));
      var sx = tx + FAN[i].x * sr.width * 0.5;
      var sy = ty + sr.height * 0.42;
      var x = sx + (tx - sx) * e, y = sy + (ty - sy) * e;
      var rot = FAN[i].r * (1 - e), sc = 1 + 0.1 * (1 - e);
      c.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')';
      c.el.style.setProperty('--lift', (1 - e).toFixed(3));
      slots[i].firstElementChild.style.opacity = e > 0.6 ? '0' : '1';
      sig.push(Math.round(e * 20));
    }
    var selected = p > 0.8 ? 1 : -1;
    if (selected !== lastSelected) {
      lastSelected = selected;
      cards.forEach(function (c, k) {
        c.el.classList.toggle('is-selected', k === selected);
        c.el.classList.toggle('is-dim', selected !== -1 && k !== selected);
        c.use.textContent = k === selected ? 'Selected ✓' : 'Use this script';
      });
    }
    heroStage.setAttribute('data-sc-verify-state', sig.join('.') + ':' + selected);
  }

  /* ------------------------------------------------------- 2 · storyboard -- */
  var rowsEl = $('#rows');
  var boardNote = $('#board-note');

  function splitCopy(text) {
    var words = text.split(' ');
    if (words.length < 4) return null;
    var mid = Math.ceil(words.length / 2);
    for (var k = 0; k < words.length - 1; k++) {
      // Prefer a cut after a comma nearest the middle.
      var a = mid - k, b = mid + k;
      if (a > 1 && /[,.]$/.test(words[a - 1])) { mid = a; break; }
      if (b < words.length && /[,.]$/.test(words[b - 1])) { mid = b; break; }
    }
    var first = words.slice(0, mid).join(' ').replace(/,$/, '.');
    var second = words.slice(mid).join(' ');
    return [first, second.charAt(0).toUpperCase() + second.slice(1)];
  }

  function onStoryboardChanged() {
    if (gate.state === 'approved') {
      setGate('waiting', 'Storyboard changed. Approve again.');
    }
    renderAll();
  }

  function renderRows() {
    rowsEl.textContent = '';
    scenes.forEach(function (s, i) {
      var li = el('li', 'row');
      var top = el('div', 'row__top');
      top.appendChild(el('span', 'row__n', 'Scene ' + (i + 1)));
      top.appendChild(el('span', 'pill pill--hook', GROUP_LABEL[s.group]));
      var pif = el('button', 'mini toggle-pif', s.pif ? 'Product in frame ✓' : 'Product not in frame');
      pif.type = 'button';
      pif.setAttribute('aria-pressed', String(s.pif));
      pif.setAttribute('aria-label', 'Scene ' + (i + 1) + ': product in frame');
      pif.addEventListener('click', function () { s.pif = !s.pif; onStoryboardChanged(); focusRow(i, '.toggle-pif'); });
      top.appendChild(pif);
      li.appendChild(top);
      li.appendChild(el('p', 'row__copy', s.copy));
      var vis = el('p', 'row__visual');
      vis.appendChild(el('b', null, 'Visual '));
      vis.appendChild(document.createTextNode(s.visual));
      li.appendChild(vis);

      var actions = el('div', 'row__actions');
      var parts = splitCopy(s.copy);
      var split = el('button', 'mini mini--split', 'Split');
      split.type = 'button';
      split.setAttribute('aria-label', 'Split scene ' + (i + 1));
      split.disabled = !parts || scenes.length >= MAX_SCENES;
      split.addEventListener('click', function () {
        var pr = splitCopy(s.copy);
        if (!pr) return;
        scenes.splice(i, 1, { group: s.group, copy: pr[0], visual: s.visual, pif: s.pif },
                            { group: s.group === 'cta' ? 'cta' : 'body', copy: pr[1], visual: s.visual, pif: s.pif });
        onStoryboardChanged();
        focusRow(i, '.mini--split');
      });
      actions.appendChild(split);
      if (i > 0) {
        var merge = el('button', 'mini mini--merge', 'Merge into previous');
        merge.type = 'button';
        merge.setAttribute('aria-label', 'Merge scene ' + (i + 1) + ' into scene ' + i);
        merge.addEventListener('click', function () {
          var prev = scenes[i - 1];
          prev.copy = prev.copy + ' ' + s.copy;
          if (prev.visual !== s.visual) prev.visual = prev.visual + ' Then: ' + s.visual.charAt(0).toLowerCase() + s.visual.slice(1);
          prev.pif = prev.pif || s.pif;
          scenes.splice(i, 1);
          onStoryboardChanged();
          focusRow(i - 1, '.mini--split');
        });
        actions.appendChild(merge);
      }
      li.appendChild(actions);
      rowsEl.appendChild(li);
    });
  }

  function focusRow(i, sel) {
    var row = rowsEl.children[Math.min(i, rowsEl.children.length - 1)];
    var t = row && $(sel, row);
    if (t && !t.disabled) t.focus({ preventScroll: true });
    else if (row) { var b = $('button:not(:disabled)', row); if (b) b.focus({ preventScroll: true }); }
  }

  /* --------------------------------------------------------- 3 · the peak -- */
  var mediaAct = $('#media');
  var mediaStage = $('#media-stage');
  var tilesEl = $('#tiles');
  var statusEl = $('#media-status');
  var laneTotals = $$('[data-lane-total]');
  var LANES = ['Image', 'Voiceover', 'Video'];
  var BASE = [0.04, 0.34, 0.62], SPREAD = 0.18, DUR = 0.1;
  var tiles = [];
  var media = { done: [0, 0, 0], all: false };

  function renderTiles() {
    tilesEl.textContent = '';
    tiles = scenes.map(function (s, i) {
      var li = el('li', 'tile');
      var top = el('div', 'tile__top');
      top.appendChild(el('span', 'tile__n', 'Scene ' + (i + 1)));
      top.appendChild(el('span', 'pill pill--hook', GROUP_LABEL[s.group]));
      li.appendChild(top);
      li.appendChild(el('p', 'tile__copy', s.copy));
      li.appendChild(el('p', 'tile__visual', s.visual));
      var lanes = LANES.map(function (name) {
        var row = el('div', 'lane');
        row.appendChild(el('span', 'lane__name', name));
        var bar = el('span', 'lane__bar');
        var fill = el('i');
        bar.appendChild(fill);
        row.appendChild(bar);
        var st = el('span', 'lane__state', 'Queued');
        row.appendChild(st);
        li.appendChild(row);
        return { row: row, fill: fill, st: st, key: '' };
      });
      tilesEl.appendChild(li);
      return { li: li, lanes: lanes };
    });
    var n = scenes.length;
    tilesEl.style.setProperty('--cols', n <= 6 ? 3 : n <= 8 ? 4 : 5);
  }

  function drawMedia() {
    var p = progressOf(mediaAct);
    var n = tiles.length;
    var done = [0, 0, 0];
    var sigFrac = 0;
    var small = innerWidth <= 860;
    for (var i = 0; i < n; i++) {
      var t = tiles[i];
      var glow = 0;
      for (var L = 0; L < 3; L++) {
        var start = BASE[L] + (n > 1 ? (i / (n - 1)) * SPREAD : 0);
        var f = clamp01((p - start) / DUR);
        var s = f >= 1 ? 'done' : f > 0 ? 'run' : 'queued';
        if (s === 'done') done[L]++;
        if (s === 'run') glow = 1;
        sigFrac += f;
        var key = s + Math.round(f * 50);
        var lane = t.lanes[L];
        if (lane.key !== key) {
          lane.key = key;
          lane.row.setAttribute('data-s', s);
          lane.fill.style.setProperty('--f', f.toFixed(3));
          lane.st.textContent = s === 'done' ? (small ? '✓' : 'Done ✓') : s === 'run' ? (small ? '…' : Math.round(f * 100) + '%') : (small ? '' : 'Queued');
        }
      }
      t.li.style.setProperty('--glow', glow);
    }
    for (var k = 0; k < 3; k++) laneTotals[k].textContent = done[k] + '/' + n;
    var all = done[2] === n;
    if (all !== media.all || done.join() !== media.done.join()) {
      media.done = done; media.all = all;
      statusEl.setAttribute('data-done', String(all));
      if (all) statusEl.textContent = 'All ' + n + ' scenes have an image, voiceover and video. Next: review.';
      else if (done[0] + done[1] + done[2] === 0 && p <= BASE[0]) statusEl.textContent = 'Queued: ' + n + ' scenes.';
      else statusEl.textContent = 'Generating scene media: ' + (done[0] + done[1] + done[2]) + ' of ' + n * 3 + ' done.';
    }
    mediaStage.setAttribute('data-sc-verify-state', done.join('-') + ':' + Math.round(sigFrac * 4));
    if (all) mediaStage.setAttribute('data-sc-verify-hold', 'true');
    else mediaStage.removeAttribute('data-sc-verify-hold');
  }

  /* ------------------------------------------------------ stepper as nav -- */
  var chipEls = $$('#stepper .chip');
  var stepperScroller = $('.stepper');
  var ORDER = chipEls.map(function (c) { return c.getAttribute('data-step'); });
  var chipCounts = { img: $('[data-count="img"]'), vo: $('[data-count="vo"]'), vid: $('[data-count="vid"]') };
  var sections = ['scripts', 'storyboard', 'media', 'approve', 'access'].map(function (id) { return document.getElementById(id); });
  var currentStep = null;

  function activeSection() {
    var line = innerHeight * 0.45;
    for (var i = sections.length - 1; i >= 0; i--) {
      if (sections[i].getBoundingClientRect().top <= line) return sections[i].id;
    }
    return 'scripts';
  }

  function drawStepper() {
    var sec = activeSection();
    var step;
    if (sec === 'scripts') step = 'scripts';
    else if (sec === 'storyboard') step = 'storyboard';
    else if (sec === 'media') step = media.done[0] < tiles.length ? 'scene_images' : media.done[1] < tiles.length ? 'voiceover' : 'scene_videos';
    else step = 'export';
    var reachedMedia = sec === 'media' || sec === 'approve' || sec === 'access';
    var n = tiles.length;
    var shown = reachedMedia ? media.done : [0, 0, 0];
    if (sec === 'approve' || sec === 'access') shown = [n, n, n];
    chipCounts.img.textContent = reachedMedia ? shown[0] + '/' + n : '';
    chipCounts.vo.textContent = reachedMedia ? shown[1] + '/' + n : '';
    chipCounts.vid.textContent = reachedMedia ? shown[2] + '/' + n : '';
    if (step === currentStep) return;
    currentStep = step;
    var idx = ORDER.indexOf(step);
    chipEls.forEach(function (c, k) {
      if (k === idx) { c.setAttribute('aria-current', 'step'); c.removeAttribute('data-state'); }
      else { c.removeAttribute('aria-current'); if (k < idx) c.setAttribute('data-state', 'done'); else c.removeAttribute('data-state'); }
    });
    var chip = chipEls[idx];
    var target = Math.max(0, chip.parentNode.offsetLeft - 24);
    if (stepperScroller.scrollWidth > stepperScroller.clientWidth) {
      stepperScroller.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  /* -------------------------------------------------- 4 + 5 · gate, export -- */
  var gateEl = $('#gate');
  var gateTag = $('#gate-tag');
  var gateTitle = $('#gate-title');
  var gateMeta = $('#gate-meta');
  var gateStamp = $('#gate-stamp');
  var gateActions = $('#gate-actions');
  var btnApprove = $('#btn-approve');
  var btnChanges = $('#btn-changes');
  var changesForm = $('#changes');
  var changesNote = $('#changes-note');
  var changesError = $('#changes-error');
  var statusGate = $('#status-gate');
  var exportEl = $('#export');
  var exportMeta = $('#export-meta');
  var scopeSet = $('#scope');
  var filesEl = $('#files');
  var btnDownload = $('#btn-download');
  var carry = $('#carry');

  function setGate(state, tagText) {
    gate.state = state;
    gateEl.setAttribute('data-state', state);
    var approved = state === 'approved';
    if (approved) { gate.at = new Date(); gate.scenes = scenes.length; }
    gateTag.textContent = tagText || (approved ? 'Approved' : state === 'changes' ? 'Changes requested' : 'Waiting on you');
    gateTitle.textContent = approved ? 'Approved by you' : 'Ready for review';
    gateActions.hidden = approved;
    if (approved) { changesForm.hidden = true; btnChanges.setAttribute('aria-expanded', 'false'); }
    gateStamp.hidden = !approved;
    if (approved) {
      gateStamp.textContent = 'Approved by you at ' + gate.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        ' · ' + gate.scenes + ' scenes · Variant 2. The export is open.';
    }
    exportEl.setAttribute('data-locked', String(!approved));
    exportMeta.textContent = approved ? 'Open' : 'Locked';
    scopeSet.disabled = !approved;
    btnDownload.disabled = !approved;
    var sg = statusGate.lastElementChild;
    statusGate.setAttribute('data-state', approved ? 'approved' : 'waiting');
    sg.textContent = approved ? 'Gate: approved by you' : state === 'changes' ? 'Gate: changes requested' : 'Gate: waiting on you';
    carry.hidden = !approved;
    if (approved) carry.textContent = 'You approved the sample: Northbeam Cold Brew, Variant 2, ' + gate.scenes + ' scenes. We will mention it in your request.';
  }

  btnApprove.addEventListener('click', function () {
    setGate('approved');
    gateStamp.setAttribute('tabindex', '-1');
    gateStamp.focus({ preventScroll: true });
  });

  btnChanges.addEventListener('click', function () {
    var open = changesForm.hidden;
    changesForm.hidden = !open;
    btnChanges.setAttribute('aria-expanded', String(open));
    if (open) changesNote.focus();
  });

  changesForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var note = changesNote.value.trim();
    if (!note) { changesError.hidden = false; changesNote.setAttribute('aria-invalid', 'true'); changesNote.focus(); return; }
    changesError.hidden = true;
    changesNote.removeAttribute('aria-invalid');
    setGate('changes');
    boardNote.hidden = false;
    boardNote.textContent = 'Changes requested: "' + note + '". Edit the scenes, then approve again below.';
    boardNote.setAttribute('tabindex', '-1');
    changesForm.hidden = true;
    btnChanges.setAttribute('aria-expanded', 'false');
    changesNote.value = '';
    document.getElementById('storyboard').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    boardNote.focus({ preventScroll: true });
  });

  function scopeValue() { var c = $('input[name="scope"]:checked'); return c ? c.value : 'all'; }

  // Port of apps/web/src/lib/download/zip-naming.ts (zipEntryName + isIncludedInScope).
  function manifest(scope) {
    var out = [];
    scenes.forEach(function (s, i) {
      var nn = pad2(i + 1);
      if (scope === 'all' || scope === 'videos') out.push(nn + '.mp4');
      if (scope === 'all' || scope === 'images') out.push(nn + '-image-1.png');
      if (scope === 'all' || scope === 'voiceover') { out.push(nn + '-voiceover.mp3'); out.push(nn + '-captions.srt'); }
    });
    return out;
  }

  function renderFiles() {
    filesEl.textContent = '';
    manifest(scopeValue()).forEach(function (name) { filesEl.appendChild(el('li', null, name)); });
  }
  $$('input[name="scope"]').forEach(function (r) { r.addEventListener('change', renderFiles); });

  function srtTime(sec) {
    var ms = Math.round(sec * 1000);
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + String(r).padStart(3, '0');
  }

  btnDownload.addEventListener('click', function () {
    if (gate.state !== 'approved') return;
    var scope = scopeValue();
    var labels = { all: 'Everything', videos: 'Videos only', images: 'Images only', voiceover: 'Voiceover + captions only' };
    var per = AD_LENGTH / scenes.length;
    var lines = [
      'AutoCut Engine: sample export',
      'Northbeam Cold Brew (fictional brand) · Variant 2 · ' + scenes.length + ' scenes · ' + AD_LENGTH + 's',
      'Approved by you: ' + gate.at.toLocaleString(),
      'Scope: ' + labels[scope],
      '',
      'Files in the zip, named by scene:'
    ].concat(manifest(scope).map(function (f) { return '  ' + f; }), ['', 'Storyboard:']);
    scenes.forEach(function (s, i) {
      lines.push('  ' + pad2(i + 1) + '  ' + GROUP_LABEL[s.group] + (s.pif ? '  (product in frame)' : ''));
      lines.push('      ' + s.copy);
      lines.push('      Visual: ' + s.visual);
    });
    lines.push('', 'Captions (SRT, even timing for this sample):');
    scenes.forEach(function (s, i) {
      lines.push(String(i + 1), srtTime(i * per) + ' --> ' + srtTime((i + 1) * per), s.copy, '');
    });
    lines.push('In the app the zip holds the generated media itself. This sample holds the plan.');
    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'northbeam-cold-brew-sample-export.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  /* -------------------------------------------------------- 6 · the close -- */
  var form = $('#access-form');
  var formError = $('#access-error');
  var formStatus = $('#access-status');
  form.setAttribute('action', 'mailto:' + CONTACT_EMAIL);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fields = $$('input', form);
    var bad = [];
    fields.forEach(function (f) {
      var ok = f.checkValidity() && f.value.trim() !== '';
      f.setAttribute('aria-invalid', String(!ok));
      if (!ok) bad.push(f);
    });
    if (bad.length) {
      formError.hidden = false;
      formError.textContent = bad.length === 1
        ? 'Check ' + $('label[for="' + bad[0].id + '"]').textContent.toLowerCase() + '.'
        : 'Fill in every field with a valid value.';
      formStatus.hidden = true;
      bad[0].focus();
      return;
    }
    formError.hidden = true;
    var v = function (id) { return document.getElementById(id).value.trim(); };
    var body = [
      'Agency: ' + v('f-agency'),
      'Name: ' + v('f-name'),
      'Email: ' + v('f-email'),
      'Editors: ' + v('f-editors'),
      gate.state === 'approved' ? 'Approved the sample storyboard on the site (' + gate.scenes + ' scenes).' : ''
    ].join('\n');
    var href = 'mailto:' + CONTACT_EMAIL +
      '?subject=' + encodeURIComponent('AutoCut Engine access request: ' + v('f-agency')) +
      '&body=' + encodeURIComponent(body);
    formStatus.hidden = false;
    formStatus.textContent = 'Your email app should now open with this request to ' + CONTACT_EMAIL + '. Nothing is sent until you press send there.';
    window.location.href = href;
  });

  /* ---------------------------------------------------------------- loop -- */
  function renderAll() {
    renderRows();
    renderTiles();
    renderFiles();
    $('#board-count').textContent = scenes.length + ' scenes';
    gateMeta.textContent = 'Northbeam Cold Brew (sample) · Variant 2 · ' + scenes.length + ' scenes · ' + AD_LENGTH + 's';
    media.done = [-1, -1, -1];
    currentStep = null;
  }

  renderAll();
  setGate('waiting');

  function frame() {
    drawHero();
    drawMedia();
    drawStepper();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
