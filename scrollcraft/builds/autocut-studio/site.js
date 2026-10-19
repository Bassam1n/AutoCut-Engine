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
      var from = kind === 'fade' ? { opacity: 0 } : kind === 'clip' ? { clipPath: 'inset(100% 0% 0% 0%)', opacity: 1 } : { y: 56, opacity: 0 };
      gsap.set(el, { visibility: 'visible' });
      var t = gsap.fromTo(el, from, {
        y: 0, opacity: 1, clipPath: 'inset(0% 0% 0% 0%)',
        duration: kind === 'fade' ? 0.9 : 1.2, ease: EASE.out,
        delay: parseFloat(el.dataset.delay || '0'), paused: isIntro,
        scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 90%', once: true },
        clearProps: kind === 'clip' ? 'clipPath' : ''
      });
      if (isIntro) intro.add(function () { t.play(); }, 0);
      // Keyboard users can reach a block before it scrolls in: show it at once.
      el.addEventListener('focusin', function () { t.progress(1); }, { once: true });
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
  var title2 = $('.hero__l2');
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
    // The payoff: when the last tool tab shuts, the headline snaps shut too and reopens as one tab.
    var word = n === STEPS ? 'One tab.' : 'Six tabs.';
    if (title2 && motion && !instant && title2.textContent !== word) {
      gsap.killTweensOf(title2);
      gsap.timeline()
        .to(title2, { scaleX: 0, opacity: 0, duration: 0.22, ease: 'power2.in' })
        .add(function () { title2.textContent = word; })
        .to(title2, { scaleX: 1, opacity: 1, duration: 0.5, ease: EASE.out });
    }
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
      // Static path (reduced motion): show the real end state, one tab open and every job checked off.
      setClosed(STEPS, true);
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

  }

  /* The one tab: the sidebar switches the real screen (click, keyboard, or a fine pointer resting on it). */
  var appImg = $('[data-app-img]');
  var appBtns = $$('[data-shot]');
  var appTab = $('[data-app-tab]');
  var appUrl = $('[data-app-url]');
  if (appImg && appBtns.length) {
    var current = appBtns[0];
    var select = function (btn) {
      if (btn === current) return;
      current = btn;
      appBtns.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      var k = btn.dataset.shot;
      var swap = function () {
        appImg.setAttribute('src', '/assets/shots/' + k + '-950.webp');
        appImg.setAttribute('alt', btn.dataset.alt || '');
        // The tab title and address follow the screen, like moving around inside the one tab.
        if (appTab) appTab.textContent = btn.dataset.tabName || '';
        if (appUrl) appUrl.textContent = btn.dataset.path || '';
      };
      if (hoverFx) {
        // Snap: the new screen wipes in from the left, like a page loading into the tab.
        gsap.killTweensOf(appImg);
        swap();
        gsap.fromTo(appImg, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.55, ease: EASE.soft, clearProps: 'clipPath' });
      } else swap();
    };
    appBtns.forEach(function (btn) {
      btn.addEventListener('click', function () { select(btn); });
      btn.addEventListener('focus', function () { select(btn); });
      if (!touch) {
        var timer;
        btn.addEventListener('pointerenter', function () { clearTimeout(timer); timer = setTimeout(function () { select(btn); }, 90); });
        btn.addEventListener('pointerleave', function () { clearTimeout(timer); });
      }
    });
    // Warm the cache so the swap never shows an empty frame.
    var warm = function () { appBtns.forEach(function (b) { var i = new Image(); i.src = '/assets/shots/' + b.dataset.shot + '-950.webp'; }); };
    if ('requestIdleCallback' in window) requestIdleCallback(warm); else setTimeout(warm, 1500);
  }

  /* Phone menu: one obvious tap away; Escape and any link close it. */
  var menuBtn = $('[data-menu-btn]');
  var menu = $('[data-menu]');
  if (menuBtn && menu) {
    var setMenu = function (open) {
      menu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.textContent = open ? 'Close' : 'Menu';
      if (open) { var f = $('a', menu); if (f) f.focus(); if (hoverFx) gsap.fromTo($$('a', menu), { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.5, stagger: 0.04, ease: EASE.soft }); }
    };
    menuBtn.addEventListener('click', function () { setMenu(menu.hidden); });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
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
