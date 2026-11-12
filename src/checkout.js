// On-site checkout: Buy now opens Tebex's checkout over this page, in Glitchworks colours.
// Flow: make a basket -> FiveM (Cfx.re) login, which Tebex needs to deliver escrowed assets
// -> back here -> add the package -> open checkout. Tebex stays merchant of record.
(() => {
  const btn = document.querySelector("[data-tebex-package]");
  if (!btn) return;
  const TOKEN = btn.dataset.tebexToken;
  const API = `https://headless.tebex.io/api/accounts/${TOKEN}`;
  const here = location.href.split("?")[0];
  const say = (t) => { const s = document.getElementById("checkout-msg"); if (s) s.textContent = t; };
  const json = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, headers: { "Content-Type": "application/json", Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || j.title || `Tebex said ${r.status}`);
    return j;
  };
  const loadTebexJs = () => new Promise((ok, no) => {
    if (window.Tebex) return ok();
    const s = document.createElement("script"); s.src = "https://js.tebex.io/v/1.js"; s.onload = ok; s.onerror = () => no(new Error("Couldn't load the checkout"));
    document.head.appendChild(s);
  });
  async function openCheckout(ident) {
    say("Opening checkout…");
    await json(`https://headless.tebex.io/api/baskets/${ident}/packages`, { method: "POST", body: JSON.stringify({ package_id: btn.dataset.tebexPackage, quantity: 1 }) })
      .catch((e) => { if (!/already/i.test(e.message)) throw e; });
    await loadTebexJs();
    Tebex.checkout.init({ ident, theme: "dark", colors: [{ name: "primary", color: "#ff40f0" }, { name: "secondary", color: "#2ee6ff" }] });
    Tebex.checkout.on("payment:complete", () => { say("Thanks! Your asset is on its way to your Cfx Keymaster."); try { sessionStorage.removeItem("gw-basket"); } catch {} });
    Tebex.checkout.launch();
    say("");
  }
  async function start() {
    btn.disabled = true;
    try {
      let ident = null;
      try { ident = sessionStorage.getItem("gw-basket"); } catch {}
      if (!ident) {
        say("Setting up your basket…");
        const b = await json(`${API}/baskets`, { method: "POST", body: JSON.stringify({ complete_url: here + "?bought=1", cancel_url: here, complete_auto_redirect: true }) });
        ident = b.data.ident;
        try { sessionStorage.setItem("gw-basket", ident); } catch {}
      }
      const basket = (await json(`${API}/baskets/${ident}`)).data;
      if (!basket.username_id && !basket.username) {
        // FiveM login first, so the asset lands on the right account.
        const links = (await json(`${API}/baskets/${ident}/auth?returnUrl=${encodeURIComponent(here + "?checkout=1")}`)).data || [];
        const link = links[0]?.url;
        if (!link) throw new Error("Couldn't start the FiveM login");
        say("Taking you to log in with your FiveM account…");
        location.href = link;
        return;
      }
      await openCheckout(ident);
    } catch (e) {
      say(`Sorry, checkout hit a problem (${e.message}). Try again, or open a ticket in our Discord.`);
      try { sessionStorage.removeItem("gw-basket"); } catch {}
    } finally { btn.disabled = false; }
  }
  btn.addEventListener("click", (e) => { e.preventDefault(); start(); });
  const q = new URLSearchParams(location.search);
  if (q.has("checkout")) start();
  if (q.has("bought")) say("Thanks for your order! Your asset is on its way to your Cfx Keymaster.");
})();
