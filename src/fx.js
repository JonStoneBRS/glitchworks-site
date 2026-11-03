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
