/* Glitchworks status page: checks the bot status feed every 60 seconds and keeps the
   "Up for" and "Last checked" figures ticking every second in between. */
(function () {
  "use strict";
  var root = document.querySelector("[data-status-page]");
  if (!root) return;

  var POLL_MS = 60000, TIMEOUT_MS = 10000, STALE_MS = 10 * 60000;
  var url = root.getAttribute("data-status-url") || "";
  var banner = root.querySelector("[data-banner]");
  var bTitle = root.querySelector("[data-banner-title]");
  var bSub = root.querySelector("[data-banner-sub]");
  var grid = root.querySelector("[data-bots]");
  var checkedEl = root.querySelector("[data-checked]");
  var trackingEl = root.querySelector("[data-tracking]");
  var refreshBtn = root.querySelector("[data-refresh]");
  var WINDOWS = ["day", "week", "month"];

  var data = null;        // last good response
  var failed = false;     // last check failed
  var checkedAt = 0;      // when the feed says it last checked (ms)
  var lastTry = 0;        // when we last asked
  var busy = false, pollTimer = null;

  /* ---------- helpers ---------- */
  // ISO time to milliseconds. Trims extra fractional digits (the feed can send nanoseconds),
  // which some browsers refuse to parse.
  function time(s) {
    if (typeof s !== "string" || !s) return null;
    var t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
    return isNaN(t) ? null : t;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function setText(el, txt) { if (el && el.textContent !== txt) el.textContent = txt; }
  function field(card, name) { return card.querySelector('[data-f="' + name + '"]'); }
  function duration(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return d + "d " + h + "h " + m + "m " + pad(sec) + "s";
    if (h) return h + "h " + m + "m " + pad(sec) + "s";
    return m + "m " + pad(sec) + "s";
  }
  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60);
    if (h < 48) return h + "h ago";
    return Math.floor(h / 24) + " days ago";
  }
  function percent(v) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    return Math.max(0, Math.min(100, v));
  }
  function fmtPct(v) {
    if (v >= 100) return "100%";
    return (Math.floor(v * 100) / 100).toFixed(2) + "%";   // round down, never up to 100%
  }
  function fmtDate(t) {
    try { return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
    catch (_) { return new Date(t).toDateString(); }
  }
  function listNames(names) {
    if (names.length < 2) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  /* ---------- cards ---------- */
  function findCard(name) {
    var cards = grid.querySelectorAll("[data-bot]");
    var key = String(name).toLowerCase();
    for (var i = 0; i < cards.length; i++) {
      if ((cards[i].getAttribute("data-bot") || "").toLowerCase() === key) return cards[i];
    }
    // A bot we don't have a card for yet: copy the first card and blank its description.
    if (!cards[0]) return null;
    var c = cards[0].cloneNode(true);
    c.classList.remove("rv", "rv-in");
    c.removeAttribute("style");
    c.setAttribute("data-bot", name);
    setText(c.querySelector(".bot-name"), String(name));
    var role = c.querySelector(".bot-role");
    if (role) role.textContent = "";
    grid.appendChild(c);
    return c;
  }

  function paintUptime(card, uptime, collecting) {
    WINDOWS.forEach(function (w) {
      var li = card.querySelector('[data-w="' + w + '"]');
      if (!li) return;
      var v = percent(uptime && uptime[w]);
      var val = li.querySelector(".ut-val"), bar = li.querySelector(".ut-bar i"), note = li.querySelector(".ut-note");
      if (v === null) {
        li.setAttribute("data-empty", "");
        li.removeAttribute("data-level");
        setText(val, "—");
        setText(note, collecting ? "Collecting data" : "");
        if (bar) bar.style.transform = "scaleX(0)";
      } else {
        li.removeAttribute("data-empty");
        li.setAttribute("data-level", v >= 99.5 ? "good" : v >= 95 ? "fair" : "poor");
        setText(val, fmtPct(v));
        setText(note, "");
        if (bar) bar.style.transform = "scaleX(" + (v / 100).toFixed(4) + ")";
      }
    });
  }

  function paintCard(card, bot, now) {
    var state, label, fig, note, upLabel = "Up for";
    if (!bot || failed) {
      state = "unknown"; label = "Unknown"; fig = "—"; note = "Status unavailable right now"; upLabel = "Status";
    } else if (bot.online === true) {
      var since = time(bot.since);
      state = "online"; label = "Online";
      if (since !== null) { fig = duration(now - since); note = "Running since " + new Date(since).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
      else { fig = "Online"; note = "Run time not available yet"; upLabel = "Status"; }
    } else {
      state = "offline"; label = "Offline"; fig = "Offline"; note = "Checking again shortly"; upLabel = "Status";
    }
    if (card.getAttribute("data-state") !== state) card.setAttribute("data-state", state);
    setText(field(card, "state"), label);
    setText(field(card, "label"), upLabel);
    setText(field(card, "fig"), fig);
    setText(field(card, "note"), note);
  }

  /* ---------- whole page ---------- */
  function paintBanner() {
    var state, title, sub;
    if (failed || !data) {
      state = "unknown";
      title = "Status unavailable right now";
      sub = "We couldn't reach the status feed. That doesn't necessarily mean the bots are down. We'll try again shortly.";
    } else {
      var bots = data.bots;
      var down = bots.filter(function (b) { return b.online !== true; }).map(function (b) { return String(b.name); });
      if (!down.length) { state = "ok"; title = "All systems operational"; sub = "All Glitchworks bots are online and responding."; }
      else if (down.length === bots.length) { state = "major"; title = "Major outage"; sub = "Our bots are offline right now. Self-healing usually brings a bot back within about a minute. Checking again shortly."; }
      else { state = "partial"; title = "Partial outage"; sub = listNames(down) + (down.length > 1 ? " are" : " is") + " offline. Self-healing usually brings a bot back within about a minute."; }
      if (checkedAt && Date.now() - checkedAt > STALE_MS) sub += " The latest check was " + ago(Date.now() - checkedAt) + ", so these figures may be out of date.";
    }
    if (banner.getAttribute("data-state") !== state) banner.setAttribute("data-state", state);
    setText(bTitle, title);
    setText(bSub, sub);
  }

  function paintAll() {
    var now = Date.now();
    var bots = data && !failed ? data.bots : [];
    var seen = [];
    bots.forEach(function (b) {
      var card = findCard(b.name);
      if (!card) return;
      seen.push(card);
      paintCard(card, b, now);
      paintUptime(card, b.uptime, true);
    });
    // Cards the feed didn't mention (or every card, if the check failed).
    [].forEach.call(grid.querySelectorAll("[data-bot]"), function (card) {
      if (seen.indexOf(card) > -1) return;
      paintCard(card, null, now);
      paintUptime(card, null, false);
    });
    paintBanner();
    tick();
  }

  // Runs every second: only the ticking text changes, nothing is announced.
  function tick() {
    var now = Date.now();
    if (checkedAt) setText(checkedEl, "Last checked " + ago(now - checkedAt));
    else if (failed) setText(checkedEl, "Couldn't check just now");
    if (!data || failed) return;
    data.bots.forEach(function (b) {
      if (b.online !== true) return;
      var since = time(b.since);
      if (since === null) return;
      var card = findCard(b.name);
      if (card) setText(field(card, "fig"), duration(now - since));
    });
  }

  function valid(d) {
    return d && typeof d === "object" && Array.isArray(d.bots) &&
      d.bots.every(function (b) { return b && typeof b === "object" && typeof b.name === "string" && b.name; });
  }

  function check() {
    if (busy) return;
    busy = true;
    lastTry = Date.now();
    if (refreshBtn) refreshBtn.disabled = true;
    clearTimeout(pollTimer);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var req = url && window.fetch
      ? fetch(url, { headers: { "ngrok-skip-browser-warning": "1" }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      : Promise.reject(new Error("No status feed"));
    req.then(function (d) {
      if (!valid(d)) throw new Error("Unexpected response");
      data = d;
      failed = false;
      var up = time(d.updated);
      // Use the feed's own time unless it's clearly wrong (more than 5 minutes in the future).
      checkedAt = up !== null && up - Date.now() < 300000 ? Math.min(up, Date.now()) : Date.now();
      var since = time(d.trackingSince);
      setText(trackingEl, since !== null ? "Uptime tracked since " + fmtDate(since) : "");
      try { document.dispatchEvent(new CustomEvent("gw:status", { detail: d })); } catch (_) {}
      try { sessionStorage.setItem("gw-status", JSON.stringify({ t: Date.now(), d: d })); } catch (_) {}
    }).catch(function () {
      failed = true;
      checkedAt = 0;
      setText(trackingEl, "");
    }).then(function () {
      clearTimeout(timer);
      busy = false;
      if (refreshBtn) refreshBtn.disabled = false;
      paintAll();
      pollTimer = setTimeout(check, POLL_MS);
    });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", check);
  // Coming back to the tab after a while: check straight away rather than waiting.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && Date.now() - lastTry > POLL_MS) check();
  });
  setInterval(tick, 1000);
  check();
})();
