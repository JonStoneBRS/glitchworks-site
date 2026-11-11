/* Glitchworks site effects: search (Ctrl+K or /) and the glitch cursor. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- search ---------------- */
  var idx = window.GW_INDEX || [];
  var root = document.documentElement.getAttribute("data-root") || "";
  var dlg = document.getElementById("search");
  var input = document.getElementById("search-input");
  var list = document.getElementById("search-results");
  var openers = document.querySelectorAll("[data-search-open]");
  var active = 0, shown = [];

  function norm(s) { return String(s || "").toLowerCase(); }
  function score(item, terms) {
    var t = norm(item.t), body = norm(item.t + " " + item.d + " " + item.c + " " + item.k);
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var q = terms[i];
      if (!q) continue;
      if (t.indexOf(q) === 0) s += 6;
      else if (t.indexOf(q) > -1) s += 4;
      else if (body.indexOf(q) > -1) s += 1;
      else return 0;
    }
    return s;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function render() {
    var q = norm(input.value).trim();
    var terms = q.split(/\s+/);
    shown = q ? idx.map(function (it) { return [score(it, terms), it]; }).filter(function (x) { return x[0] > 0; })
      .sort(function (a, b) { return b[0] - a[0]; }).map(function (x) { return x[1]; }) : idx.slice(0, 6);
    active = 0;
    if (!shown.length) { list.innerHTML = '<li class="sr-empty">No matches for "' + esc(input.value) + '". Try "MLO", "police" or "hospital".</li>'; return; }
    list.innerHTML = shown.map(function (it, i) {
      var thumb = it.i ? '<img src="' + root + it.i + '" alt="" loading="lazy">' : '<span class="sr-ph"></span>';
      return '<li role="option" id="sr-' + i + '"' + (i === 0 ? ' aria-selected="true"' : "") + '><a href="' + root + it.u + '">' + thumb +
        '<span class="sr-text"><strong>' + esc(it.t) + '</strong><span>' + esc(it.d) + '</span></span><span class="sr-tag">' + esc(it.s) + "</span></a></li>";
    }).join("");
  }
  function move(d) {
    var items = list.querySelectorAll("li[role=option]");
    if (!items.length) return;
    items[active].removeAttribute("aria-selected");
    active = (active + d + items.length) % items.length;
    items[active].setAttribute("aria-selected", "true");
    items[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", "sr-" + active);
  }
  function open() {
    if (!dlg) return;
    dlg.hidden = false;
    document.body.classList.add("search-open");
    input.value = "";
    render();
    setTimeout(function () { input.focus(); }, 10);
  }
  function close() {
    if (!dlg || dlg.hidden) return;
    dlg.hidden = true;
    document.body.classList.remove("search-open");
  }
  if (dlg) {
    openers.forEach(function (b) { b.addEventListener("click", open); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { var a = list.querySelector("li[aria-selected] a"); if (a) location.href = a.href; }
    });
    document.addEventListener("keydown", function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); open(); }
      else if (e.key === "Escape") close();
    });
  }

  // Each extra feature runs on its own, so a problem in one never stops the others.
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn(e); } }
  var hasIO = "IntersectionObserver" in window;

  /* ---------------- open a FAQ answer linked by #id ---------------- */
  safe(function () {
    function openHash() {
      var id = "";
      try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
      var t = id && document.getElementById(id);
      if (t && t.tagName === "DETAILS") t.open = true;
    }
    openHash();
    window.addEventListener("hashchange", openHash);
  });

  /* ---------------- scroll progress line and hero parallax ---------------- */
  safe(function () {
    var head = document.querySelector(".site-head");
    var prog = null;
    if (head) {
      prog = document.createElement("div");
      prog.className = "scroll-prog";
      prog.setAttribute("aria-hidden", "true");
      head.appendChild(prog);
    }
    var layers = reduce ? [] : [].slice.call(document.querySelectorAll("[data-parallax]"));
    var queued = false;
    function update() {
      queued = false;
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var vh = window.innerHeight;
      var max = document.documentElement.scrollHeight - vh;
      if (prog) prog.style.transform = "scaleX(" + (max > 40 ? Math.min(1, y / max) : 0).toFixed(4) + ")";
      for (var i = 0; i < layers.length; i++) {
        var box = (layers[i].parentNode || layers[i]).getBoundingClientRect();
        if (box.bottom < 0 || box.top > vh) continue;          // off screen: leave it
        var p = Math.max(0, -box.top);                          // how far the hero has scrolled up
        layers[i].style.transform = "translate3d(0," + (p * 0.22).toFixed(1) + "px,0) scale(" + (1 + Math.min(p, 900) * 0.00011).toFixed(4) + ")";
      }
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    update();
  });

  /* ---------------- fade-and-rise reveals ---------------- */
  // Content is visible by default. Only things below the fold are hidden, and only when
  // JavaScript is running and the visitor hasn't asked for reduced motion.
  safe(function () {
    if (reduce || !hasIO) return;
    var sel = "[data-reveal], main .section-head, main .grid > .card, main .cats > *, main .svcs > *, main .steps > *, main .band," +
      " .feat-grid > *, .opt-grid > *, .hub-grid > *, .bots > *, .trust-grid > *, .trust-quote, .sg-points > *, .sg-checks > *, .limits, .gstep";
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        el.classList.add("rv-in");
        var d = parseInt(el.style.getPropertyValue("--rv-d"), 10) || 0;
        // Tidy up afterwards so hover effects work as normal.
        setTimeout(function () { el.classList.remove("rv", "rv-in"); el.style.removeProperty("--rv-d"); }, 1100 + d);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    var vh = window.innerHeight;
    var target = null;   // the #section someone linked to: leave it where the browser expects it
    try { target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null; } catch (_) {}
    document.querySelectorAll(sel).forEach(function (el) {
      if (el.closest(".story-stage")) return;
      if (target && (el === target || el.contains(target))) return;
      var r = el.getBoundingClientRect();
      if (r.height && r.top < vh && r.bottom > 0) return;       // already on screen: never hide it
      var i = el.parentNode ? [].indexOf.call(el.parentNode.children, el) : 0;
      el.style.setProperty("--rv-d", (Math.min(i % 6, 5) * 70) + "ms");   // gentle stagger
      el.classList.add("rv");
      io.observe(el);
    });
  });

  /* ---------------- "On this page" highlight ---------------- */
  safe(function () {
    var toc = document.querySelector("[data-toc]");
    if (!toc) return;
    var pairs = [];
    [].forEach.call(toc.querySelectorAll('a[href^="#"]'), function (a) {
      var t = document.getElementById(a.getAttribute("href").slice(1));
      if (t) pairs.push([t, a]);
    });
    if (!pairs.length) return;
    var active = null, queued = false;
    // The active section is the last heading that has scrolled past the top third.
    function spy() {
      queued = false;
      var line = window.innerHeight * 0.33, pick = null;
      for (var i = 0; i < pairs.length; i++) if (pairs[i][0].getBoundingClientRect().top <= line) pick = pairs[i][1];
      if (pick === active) return;
      if (active) active.removeAttribute("aria-current");
      if (pick) pick.setAttribute("aria-current", "location");
      active = pick;
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(spy); } }
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    spy();
  });

  /* ---------------- sticky feature story (Glitch Guard page) ---------------- */
  safe(function () {
    var story = document.querySelector("[data-story]");
    if (!story) return;
    var steps = [].slice.call(story.querySelectorAll("[data-step]"));
    var vis = [].slice.call(story.querySelectorAll(".story-stage [data-vis]"));
    var rail = story.querySelector(".story-rail i");
    if (!steps.length) return;
    story.classList.add("js");
    var current = -1, queued = false;
    function setStep(idx) {
      if (idx === current) return;
      current = idx;
      var id = steps[idx].getAttribute("data-step");
      steps.forEach(function (s, i) { s.classList.toggle("on", i === idx); });
      vis.forEach(function (v) { v.classList.toggle("on", v.getAttribute("data-vis") === id); });
      if (rail) rail.style.transform = "scaleY(" + ((idx + 1) / steps.length).toFixed(3) + ")";
    }
    // The chapter nearest the middle of the screen is the active one. Measured on each
    // animation frame while scrolling, so fast scrolls and jumps never skip a chapter.
    function pick() {
      queued = false;
      var mid = window.innerHeight / 2, best = 0, bestD = Infinity;
      for (var i = 0; i < steps.length; i++) {
        var r = steps[i].getBoundingClientRect();
        var d = r.top > mid ? r.top - mid : r.bottom < mid ? mid - r.bottom : 0;
        if (d < bestD) { bestD = d; best = i; }
      }
      setStep(best);
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(pick); } }
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    pick();
  });

  /* ---------------- live status pill (footer) ---------------- */
  safe(function () {
    var pill = document.querySelector("[data-status-pill]");
    if (!pill) return;
    var text = pill.querySelector(".sp-text");
    function paint(d) {
      if (!d || !Array.isArray(d.bots)) return;
      var bots = d.bots.filter(function (b) { return b && b.name; });
      if (!bots.length) return;
      var up = bots.filter(function (b) { return b.online === true; }).length;
      var st = up === bots.length ? "ok" : up === 0 ? "down" : "warn";
      pill.setAttribute("data-state", st);
      text.textContent = st === "ok" ? "All systems online" : st === "down" ? "Bots offline" : "Partial outage";
    }
    // The status page fetches the feed itself and shares the result.
    document.addEventListener("gw:status", function (e) { paint(e.detail); });
    if (document.querySelector("[data-status-page]") || !window.fetch || !window.JSON) return;
    var url = pill.getAttribute("data-status-url");
    if (!url) return;
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem("gw-status") || "null"); } catch (_) {}
    if (cached && cached.d && Date.now() - cached.t < 60000) { paint(cached.d); return; }
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    fetch(url, { headers: { "ngrok-skip-browser-warning": "1" }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        paint(d);
        try { sessionStorage.setItem("gw-status", JSON.stringify({ t: Date.now(), d: d })); } catch (_) {}
      })
      .catch(function () { /* stay quiet: the pill just keeps saying "System status" */ })
      .then(function () { clearTimeout(timer); });
  });

  /* ---------------- glitch cursor ---------------- */
  if (reduce || !window.matchMedia("(pointer: fine)").matches) return;
  var dot = document.createElement("div"), ringC = document.createElement("div"), ringM = document.createElement("div");
  dot.className = "gc-dot"; ringC.className = "gc-ring gc-c"; ringM.className = "gc-ring gc-m";
  [ringC, ringM, dot].forEach(function (el) { document.body.appendChild(el); });
  document.documentElement.classList.add("gc-on");

  var mx = -100, my = -100, cx = mx, cy = my, mxx = mx, myy = my, hover = false, down = false, vis = false;
  window.addEventListener("mousemove", function (e) {
    mx = e.clientX; my = e.clientY;
    if (!vis) { vis = true; cx = mxx = mx; cy = myy = my; document.documentElement.classList.add("gc-vis"); }
    var t = e.target.closest && e.target.closest("a,button,summary,[role=option],label,input,.card");
    hover = !!t;
  }, { passive: true });
  document.addEventListener("mouseleave", function () { vis = false; document.documentElement.classList.remove("gc-vis"); });
  window.addEventListener("mousedown", function () { down = true; burst(mx, my); });
  window.addEventListener("mouseup", function () { down = false; });

  function burst(x, y) {
    var b = document.createElement("div");
    b.className = "gc-burst";
    b.style.left = x + "px"; b.style.top = y + "px";
    document.body.appendChild(b);
    setTimeout(function () { b.remove(); }, 450);
  }

  var glitchT = 0;
  function tick(time) {
    cx += (mx - cx) * 0.22; cy += (my - cy) * 0.22;      // cyan ring follows quickly
    mxx += (mx - mxx) * 0.12; myy += (my - myy) * 0.12;  // magenta ring lags behind
    var scale = (hover ? 1.7 : 1) * (down ? 0.75 : 1);
    var jx = 0, jy = 0;
    if (hover && time > glitchT) {                         // little RGB-split jitter while over links
      jx = (Math.random() - 0.5) * 6; jy = (Math.random() - 0.5) * 3;
      if (Math.random() < 0.08) glitchT = time + 140;
    }
    dot.style.transform = "translate3d(" + mx + "px," + my + "px,0) translate(-50%,-50%)";
    ringC.style.transform = "translate3d(" + (cx + jx) + "px," + (cy + jy) + "px,0) translate(-50%,-50%) scale(" + scale + ")";
    ringM.style.transform = "translate3d(" + (mxx - jx) + "px," + (myy - jy) + "px,0) translate(-50%,-50%) scale(" + scale + ")";
    document.documentElement.classList.toggle("gc-hover", hover);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
