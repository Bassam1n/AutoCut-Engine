/* AutoCut Engine marketing site.
   1. Product tour: a looped, cursor-driven simulation of the Studio.
   2. Access form: POSTs to the app's /api/access-request (stored in the
      platform admin dashboard) — no mailto, no downloads.
   3. Scroll reveals. Everything respects prefers-reduced-motion. */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var API = "https://studio.autocutengine.app/api/access-request";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------ scroll reveals */
  if (!REDUCED && "IntersectionObserver" in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); }
      });
    }, { threshold: 0.18 });
    $$("[data-reveal]").forEach(function (el) { ro.observe(el); });
  } else {
    $$("[data-reveal]").forEach(function (el) { el.classList.add("in"); });
  }

  /* ------------------------------------------------------- product tour */
  var demo = $("#demo");
  if (demo) setupDemo(demo);

  function setupDemo(demo) {
    var cursor = $("#d-cursor");
    var panels = $$(".demo__panel", demo);
    var steps = $$("#demo-steps li");
    var chips = $$("#tour-chips span");
    var running = false, token = 0;

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function stage(i) {
      panels.forEach(function (p, j) { p.hidden = j !== i; });
      steps.forEach(function (s, j) {
        s.classList.toggle("is-on", j === i);
        s.classList.toggle("is-done", j < i);
      });
      chips.forEach(function (c, j) { c.classList.toggle("is-on", j === i); });
    }

    function moveTo(el) {
      if (!el || !cursor) return;
      var d = demo.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      var scale = d.width / demo.offsetWidth || 1;
      var x = (r.left + r.width * 0.6 - d.left) / scale;
      var y = (r.top + r.height * 0.55 - d.top) / scale;
      cursor.style.transform = "translate(" + x + "px," + y + "px)";
    }

    function press(el) {
      el.classList.add("is-pressed");
      setTimeout(function () { el.classList.remove("is-pressed"); }, 260);
    }

    function resetState() {
      $$(".demo__scripts article", demo).forEach(function (a) { a.classList.remove("is-in", "is-picked"); });
      $$("#d-rows li").forEach(function (l) { l.classList.remove("is-in"); });
      $$("#d-thumbs i").forEach(function (t) { t.classList.remove("is-in"); });
      [0, 1, 2].forEach(function (i) {
        $("#d-bar-" + i).style.width = "0";
        $("#d-n-" + i).textContent = "0/6";
      });
      var tag = $("#d-gate-tag");
      tag.textContent = "Waiting on you";
      tag.style.color = "";
      $("#d-stamp").hidden = true;
      if (cursor) cursor.style.transform = "translate(40px,80px)";
    }

    async function play(myToken) {
      while (running && myToken === token) {
        resetState();

        /* Stage 0 — scripts */
        stage(0);
        await sleep(700); if (myToken !== token) return;
        moveTo($("#d-generate"));
        await sleep(1100); press($("#d-generate"));
        await sleep(350);
        var cards = $$(".demo__scripts article", demo);
        for (var i = 0; i < cards.length; i++) { cards[i].classList.add("is-in"); await sleep(320); }
        if (myToken !== token) return;
        await sleep(400);
        moveTo(cards[1]);
        await sleep(1100); press(cards[1]); cards[1].classList.add("is-picked");
        await sleep(1100); if (myToken !== token) return;

        /* Stage 1 — storyboard */
        stage(1);
        var rows = $$("#d-rows li");
        for (var j = 0; j < rows.length; j++) { rows[j].classList.add("is-in"); await sleep(190); }
        await sleep(1500); if (myToken !== token) return;

        /* Stage 2 — media */
        stage(2);
        var thumbs = $$("#d-thumbs i");
        for (var n = 1; n <= 6; n++) {
          [0, 1, 2].forEach(function (lane) {
            $("#d-bar-" + lane).style.width = (n / 6) * 100 + "%";
            $("#d-n-" + lane).textContent = n + "/6";
          });
          thumbs[n - 1].classList.add("is-in");
          await sleep(420);
        }
        await sleep(1100); if (myToken !== token) return;

        /* Stage 3 — review */
        stage(3);
        await sleep(700);
        moveTo($("#d-approve"));
        await sleep(1100); press($("#d-approve"));
        await sleep(300);
        var tag = $("#d-gate-tag");
        tag.textContent = "Approved";
        tag.style.color = "var(--ok)";
        $("#d-stamp").hidden = false;
        await sleep(2600);
      }
    }

    if (REDUCED) {
      /* No animation: show the storyboard stage as a still. */
      stage(1);
      $$("#d-rows li").forEach(function (l) { l.classList.add("is-in"); });
      return;
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !running) { running = true; token++; play(token); }
          else if (!e.isIntersecting && running) { running = false; token++; }
        });
      }, { threshold: 0.35 }).observe(demo);
    } else {
      running = true; token++; play(token);
    }
  }

  /* -------------------------------------------------------- access form */
  var form = $("#access-form");
  if (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var errEl = $("#access-error");
      var btn = $("#access-submit");
      errEl.hidden = true;

      var data = {
        agency: form.agency.value.trim(),
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        editors: form.editors.value,
        note: form.note.value.trim(),
        website: form.website.value
      };
      if (!data.agency || !data.name || data.email.indexOf("@") < 0) {
        errEl.textContent = "Fill in your agency, name and a valid work email.";
        errEl.hidden = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = "Sending…";
      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (body) {
          if (body && body.ok) {
            form.hidden = true;
            $("#access-done").hidden = false;
          } else {
            throw new Error((body && body.error) || "failed");
          }
        })
        .catch(function (e) {
          errEl.textContent =
            e && e.message && e.message !== "failed"
              ? e.message
              : "Couldn’t send the request. Check your connection and try again, or email bassam.aziz01@gmail.com.";
          errEl.hidden = false;
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = "Request access";
        });
    });
  }
})();
