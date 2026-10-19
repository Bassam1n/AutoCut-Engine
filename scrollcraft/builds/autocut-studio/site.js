/* autocutengine.app
   One clock (gsap.ticker drives Lenis, ScrollTrigger and the idle state).
   1. Scroll + reveals (engine port: data-split, data-reveal, data-intro)
   2. The tab driver: hero scroll progress closes one tool tab per step
   3. Micro-interactions: button fill, product rows with a following screen
   4. Header steps aside on scroll down
   5. Access form: POSTs to the app's /api/access-request */
(function () {
  'use strict';
  var API = 'https://studio.autocutengine.app/api/access-request';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = matchMedia('(hover: none), (pointer: coarse)').matches;
  var hasGsap = typeof window.gsap !== 'undefined';
  var motion = hasGsap && !reduced && typeof window.ScrollTrigger !== 'undefined' && typeof window.SplitText !== 'undefined';
  var hoverFx = hasGsap && !reduced;
  if (!motion) document.documentElement.classList.remove('motion');

  var EASE = { out: 'expo.out', soft: 'power3.out', inOut: 'expo.inOut' };
  var lenis = null;

  /* 1. Scroll and reveals ------------------------------------------------ */
  if (motion) {
    gsap.registerPlugin(ScrollTrigger, SplitText);
    if (window.Lenis) {
      lenis = new Lenis({ lerp: 0.1, anchors: { offset: 0 }, touchMultiplier: 1.2 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    }
  }

  function initReveals() {
    var intro = motion ? gsap.timeline({ paused: true }) : null;
    if (!motion) return intro;
    $$('[data-split]').forEach(function (el) {
      var isIntro = el.hasAttribute('data-intro');
      var st = { done: false, tween: null, requested: false };
      SplitText.create(el, {
        type: 'lines', mask: 'lines', autoSplit: true, linesClass: 'split-line',
        onSplit: function (self) {
          gsap.set(el, { visibility: 'visible' });
          if (st.done) return;
          st.tween = gsap.from(self.lines, {
            yPercent: 112, duration: 1.15, stagger: 0.08, ease: EASE.out,
            delay: parseFloat(el.dataset.delay || '0'),
            paused: isIntro && !st.requested,
            onComplete: function () { st.done = true; },
            scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 88%', once: true }
          });
          return st.tween;
        }
      });
      if (isIntro) intro.add(function () { st.requested = true; if (st.tween) st.tween.play(); }, 0);
    });
    $$('[data-reveal]').forEach(function (el) {
      var kind = el.dataset.reveal || 'up';
      var isIntro = el.hasAttribute('data-intro');
      var from = kind === 'fade' ? { autoAlpha: 0 } : kind === 'clip' ? { clipPath: 'inset(100% 0% 0% 0%)', autoAlpha: 1 } : { y: 56, autoAlpha: 0 };
      gsap.set(el, { visibility: 'visible' });
      var t = gsap.fromTo(el, from, {
        y: 0, autoAlpha: 1, clipPath: 'inset(0% 0% 0% 0%)',
        duration: kind === 'fade' ? 0.9 : 1.2, ease: EASE.out,
        delay: parseFloat(el.dataset.delay || '0'), paused: isIntro,
        scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 90%', once: true },
        clearProps: kind === 'clip' ? 'clipPath' : ''
      });
      if (isIntro) intro.add(function () { t.play(); }, 0);
    });
    return intro;
  }

  /* 2. The tab driver ---------------------------------------------------- */
  var URLS = ['chatgpt.com', 'higgsfield.ai', 'capcut.com', 'drive.google.com', 'web.whatsapp.com', 'trello.com', 'studio.autocutengine.app'];
  var hero = $('[data-hero]');
  var tabs = $$('[data-tab]');
  var panes = $$('[data-pane]');
  var jobs = $$('[data-job]');
  var urlEl = $('[data-url]');
  var countEl = $('[data-count]');
  var countWord = $('[data-count-word]');
  var spin = $('[data-spin]');
  var unread = $('[data-unread]');
  var load = $('[data-load]');
  var STEPS = 6;
  var closed = 0;
  var unreadN = 3;

  function setClosed(n, instant) {
    if (n === closed && !instant) return;
    closed = n;
    tabs.forEach(function (tab, i) {
      var isClosed = i < n && i < STEPS;
      var wasClosed = tab.classList.contains('is-closed');
      tab.classList.toggle('is-active', i === n);
      if (isClosed === wasClosed || !hasGsap) return;
      tab.classList.toggle('is-closed', isClosed);
      if (isClosed) {
        // Snap shut: the tab collapses and its neighbours slide in.
        gsap.to(tab, { flexBasis: 0, flexGrow: 0, paddingLeft: 0, paddingRight: 0, autoAlpha: 0, duration: instant ? 0 : 0.42, ease: EASE.soft, overwrite: true });
      } else {
        // Reopen from zero to the stylesheet's own size, then hand control back to CSS.
        gsap.set(tab, { clearProps: 'flexBasis,flexGrow,paddingLeft,paddingRight' });
        var cs = getComputedStyle(tab);
        var to = { flexBasis: cs.flexBasis, flexGrow: cs.flexGrow, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
        gsap.fromTo(tab, { flexBasis: 0, flexGrow: 0, paddingLeft: 0, paddingRight: 0, autoAlpha: 0 }, {
          flexBasis: to.flexBasis, flexGrow: to.flexGrow, paddingLeft: to.paddingLeft, paddingRight: to.paddingRight, autoAlpha: 1,
          duration: instant ? 0 : 0.42, ease: EASE.soft, overwrite: true,
          onComplete: function () { gsap.set(tab, { clearProps: 'flexBasis,flexGrow,paddingLeft,paddingRight' }); }
        });
      }
    });
    panes.forEach(function (p, i) {
      var on = i === n;
      var was = p.classList.contains('is-on');
      p.classList.toggle('is-on', on);
      if (!hasGsap) return;
      if (on && !was && motion && !instant) {
        gsap.fromTo(p, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.soft, overwrite: true });
      } else if (!on && was) {
        // Only one pane may ever show: drop any half-finished entrance.
        gsap.killTweensOf(p);
        gsap.set(p, { clearProps: 'opacity,visibility,transform' });
      }
    });
    jobs.forEach(function (j, i) {
      j.classList.toggle('is-done', i < n);
      j.classList.toggle('is-latest', i === Math.max(0, n - 1));
    });
    var open = STEPS + 1 - n;
    if (countEl) countEl.textContent = String(open);
    if (countWord) countWord.textContent = open === 1 ? 'tab' : 'tabs';
    if (urlEl) urlEl.textContent = URLS[n];
    if (spin) spin.classList.toggle('is-idle', n === STEPS);
    if (load) load.classList.toggle('is-idle', n === STEPS);
  }

  if (hero && tabs.length) {
    jobs.forEach(function (j, i) { j.classList.toggle('is-latest', i === 0); });
    if (motion) {
      ScrollTrigger.create({
        trigger: hero, start: 'top top', end: 'bottom bottom',
        onUpdate: function (self) { setClosed(Math.min(STEPS, Math.floor(self.progress * (STEPS + 0.999)))); }
      });
      // Idle: the open tab keeps loading, and the client group piles up unread messages while it is open.
      var heroOn = true;
      ScrollTrigger.create({ trigger: hero, start: 'top bottom', end: 'bottom top', onToggle: function (s) { heroOn = s.isActive; } });
      var last = 0;
      gsap.ticker.add(function (t) {
        if (!heroOn) return;
        if (spin && closed < STEPS) gsap.set(spin, { rotate: (t * 300) % 360 });
        // The page never finishes loading in a tool tab: the bar keeps sweeping until AutoCut is the only tab.
        if (load && closed < STEPS) { var ph = (t * 0.45) % 1; gsap.set(load, { xPercent: -100 + ph * 365, scaleX: 0.6 + 0.4 * Math.sin(ph * Math.PI) }); }
        if (unread && closed <= 4 && t - last > 2.6) {
          last = t; unreadN = Math.min(99, unreadN + 1); unread.textContent = String(unreadN);
          gsap.fromTo(unread, { scale: 1.35 }, { scale: 1, duration: 0.4, ease: 'back.out(2)' });
        }
      });
    } else {
      // Static path: show where it ends, with every job checked off.
      jobs.forEach(function (j) { j.classList.add('is-done'); });
    }
  }

  /* 3. Micro-interactions ------------------------------------------------ */
  if (hoverFx && !touch) {
    $$('[data-fill]').forEach(function (btn) {
      var fill = $('.btn__fill', btn);
      if (!fill) return;
      var closedFill = true;
      var at = function (e) { var r = btn.getBoundingClientRect(); return (e.clientX - r.left) + 'px ' + (e.clientY - r.top) + 'px'; };
      var open = function (p) {
        if (closedFill) gsap.set(fill, { clipPath: 'circle(0% at ' + p + ')' });
        closedFill = false; btn.classList.add('is-filled');
        gsap.to(fill, { clipPath: 'circle(150% at ' + p + ')', duration: 0.6, ease: EASE.soft, overwrite: true });
      };
      var shut = function (p) {
        btn.classList.remove('is-filled');
        gsap.to(fill, { clipPath: 'circle(0% at ' + p + ')', duration: 0.5, ease: EASE.soft, overwrite: true, onComplete: function () { closedFill = true; } });
      };
      btn.addEventListener('pointerenter', function (e) { open(at(e)); });
      btn.addEventListener('pointerleave', function (e) { shut(at(e)); });
      btn.addEventListener('focus', function () { if (btn.matches(':focus-visible')) open('50% 50%'); });
      btn.addEventListener('blur', function () { shut('50% 50%'); });
    });

    var peek = $('[data-peek]');
    var peekImg = peek && $('img', peek);
    var rows = $$('[data-shot]');
    if (peek && rows.length) {
      var px = gsap.quickTo(peek, 'x', { duration: 0.6, ease: EASE.soft });
      var py = gsap.quickTo(peek, 'y', { duration: 0.6, ease: EASE.soft });
      var shown = false, mx = 0, my = 0;
      var place = function () { px(mx + 28); py(my - peek.offsetHeight * 0.5); };
      var show = function (row) {
        var src = '/assets/shots/' + row.dataset.shot + '-800.webp';
        if (peekImg.getAttribute('src') !== src) peekImg.setAttribute('src', src);
        if (!shown) { gsap.set(peek, { x: mx + 28, y: my - peek.offsetHeight * 0.5 }); }
        shown = true;
        gsap.to(peek, { autoAlpha: 1, clipPath: 'inset(0% 0% 0% 0% round 10px)', duration: 0.55, ease: EASE.soft, overwrite: 'auto' });
      };
      var hide = function () {
        shown = false;
        gsap.to(peek, { clipPath: 'inset(50% 50% 50% 50% round 10px)', autoAlpha: 0, duration: 0.4, ease: EASE.soft, overwrite: 'auto' });
      };
      rows.forEach(function (row) {
        row.addEventListener('pointerenter', function () { show(row); });
        row.addEventListener('pointerleave', hide);
      });
      addEventListener('pointermove', function (e) { mx = e.clientX; my = e.clientY; if (shown) place(); }, { passive: true });
      // A still pointer over a row that scrolls away must not leave the screen behind.
      var check = function () { if (!shown) return; var el = document.elementFromPoint(mx, my); if (!el || !el.closest('[data-shot]')) hide(); };
      if (lenis) lenis.on('scroll', check); else addEventListener('scroll', check, { passive: true });
    }
  }

  /* 4. Header steps aside ------------------------------------------------ */
  var bar = $('#top-bar');
  if (bar) {
    var lastY = 0;
    var onY = function (y) {
      bar.classList.toggle('is-lined', y > 8);
      if (Math.abs(y - lastY) > 6) { bar.classList.toggle('is-away', y > lastY && y > innerHeight * 0.6); lastY = y; }
    };
    if (lenis) lenis.on('scroll', function (l) { onY(l.scroll); }); else addEventListener('scroll', function () { onY(scrollY); }, { passive: true });
    bar.addEventListener('focusin', function () { bar.classList.remove('is-away'); });
  }

  /* Boot: wait for the display font so split lines are measured once. */
  var boot = function () {
    var intro = initReveals();
    if (intro) intro.play();
    if (motion) ScrollTrigger.refresh();
  };
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1200); })]).then(boot);
  } else boot();

  /* 5. Access form ------------------------------------------------------- */
  var form = $('#access-form');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = $('#access-error');
      var btn = $('#access-submit');
      var label = $('.btn__label', btn);
      errEl.hidden = true;
      var data = {
        agency: form.agency.value.trim(), name: form.name.value.trim(), email: form.email.value.trim(),
        editors: form.editors.value, note: form.note.value.trim(), website: form.website.value
      };
      if (!data.agency || !data.name || data.email.indexOf('@') < 0) {
        errEl.textContent = 'Fill in your agency, your name and a valid work email.';
        errEl.hidden = false;
        return;
      }
      btn.disabled = true; label.textContent = 'Sending…';
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (body) {
          if (body && body.ok) { form.hidden = true; $('#access-done').hidden = false; }
          else throw new Error((body && body.error) || 'failed');
        })
        .catch(function (e) {
          errEl.textContent = e && e.message && e.message !== 'failed'
            ? e.message
            : 'The request did not go through. Check your connection and try again, or email bassam.aziz01@gmail.com.';
          errEl.hidden = false;
        })
        .finally(function () { btn.disabled = false; label.textContent = 'Request access'; });
    });
  }
})();
