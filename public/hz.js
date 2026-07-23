/*! hz.js — the ONE Hanzo tag. Auto + autocapture → analytics.hanzo.ai/v1/event
 * (NEVER /api/). Segment-class: one tag, one way, on every surface (web UI + apps).
 *
 *   <script async src="https://analytics.hanzo.ai/hz.js"
 *           data-site="hanzo.ai"           // required: site/property key
 *           data-ga="G-XXXX"  data-fb="123" // optional: also fan out to GA4 / Meta
 *           data-capture="1"></script>      // optional: autocapture off with "0"
 *
 * Streams sendBeacon batches of a structured envelope:
 *   { site, ts, type, path, ref, props, anon, sid, w, h }
 * Types: pageview · click (AUTOCAPTURE: full element locator so movements/usage are
 * tracked logically) · outbound · scroll · form · event · identify · vitals.
 * The `el` locator on click/form preserves the AST/element detail the old
 * /api/ast + /api/element + /api/section paths carried. Respects DNT. No PII.
 * Manual: window.hanzo.track(name, props) · identify(id, traits) · page().
 */
(function () {
  var s = document.currentScript
  if (!s) return
  var host = new URL(s.src).origin
  var site = s.getAttribute('data-site') || location.hostname
  var capture = s.getAttribute('data-capture') !== '0'
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || window.hzDNT) return

  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '.' + Math.random().toString(36).slice(2) }
  var anon, sid
  try { anon = localStorage.getItem('hz_id') || (localStorage.setItem('hz_id', anon = uuid()), anon) } catch (e) { anon = 'anon' }
  try { sid = sessionStorage.getItem('hz_sid') || (sessionStorage.setItem('hz_sid', sid = uuid()), sid) } catch (e) { sid = anon }

  var queue = [], timer
  function flush() {
    clearTimeout(timer); if (!queue.length) return
    var body = JSON.stringify(queue.splice(0, queue.length)), url = host + '/v1/event'
    try { if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return } catch (e) {}
    fetch(url, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(function () {})
  }
  function send(type, props) {
    queue.push({ site: site, ts: Date.now(), type: type, path: location.pathname + location.search, ref: document.referrer || null, props: props || null, anon: anon, sid: sid, w: innerWidth, h: innerHeight })
    clearTimeout(timer); timer = setTimeout(flush, 400)
  }

  // ── element locator (the "AST"/autocapture detail) ────────────────────────
  // A compact, stable, PII-light descriptor of the element interacted with, so
  // movements read logically: tag, text (short), id, data-*, and a nsel path.
  function locator(el) {
    if (!el || el === document) return null
    var o = { tag: el.tagName ? el.tagName.toLowerCase() : '', id: el.id || undefined, name: el.getAttribute && (el.getAttribute('name') || el.getAttribute('aria-label')) || undefined }
    var txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80); if (txt) o.text = txt
    if (el.getAttribute && el.getAttribute('href')) o.href = el.getAttribute('href')
    if (el.dataset) for (var k in el.dataset) if (k !== 'hz') (o.data = o.data || {})[k] = el.dataset[k]
    // nsel: a short ancestor path (>= up to 4) for a stable-ish selector
    var p = [], n = el, i = 0
    while (n && n.tagName && i++ < 4) { var seg = n.tagName.toLowerCase(); if (n.id) { seg += '#' + n.id; p.unshift(seg); break } if (n.className && typeof n.className === 'string') seg += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.'); p.unshift(seg); n = n.parentElement }
    o.sel = p.join('>')
    return o
  }
  function interactive(el) { return el && el.closest && el.closest('a,button,[role=button],input,select,textarea,[data-hz],[onclick]') }

  // ── auto pageviews (initial + SPA) ────────────────────────────────────────
  var last = ''
  function page() { var k = location.pathname + location.search; if (k === last) return; last = k; send('pageview') }
  page()
  ;['pushState', 'replaceState'].forEach(function (m) { var o = history[m]; history[m] = function () { var r = o.apply(this, arguments); page(); return r } })
  addEventListener('popstate', page)

  // ── autocapture: clicks on interactive els (with locator), + outbound ─────
  if (capture) {
    addEventListener('click', function (e) {
      var el = interactive(e.target); if (!el) return
      var loc = locator(el)
      send('click', loc)
      if (el.tagName === 'A' && el.host && el.host !== location.host) send('outbound', { url: el.href, el: loc })
    }, true)
    // form submits (the "section"/conversion detail)
    addEventListener('submit', function (e) { send('form', locator(e.target)) }, true)
    // scroll depth — 25/50/75/100, once each per page
    var seen = {}
    addEventListener('scroll', function () {
      var d = document.documentElement, pct = Math.round(((scrollY + innerHeight) / (d.scrollHeight || 1)) * 100)
      ;[25, 50, 75, 100].forEach(function (m) { if (pct >= m && !seen[m]) { seen[m] = 1; send('scroll', { depth: m }) } })
    }, { passive: true })
  }

  // ── core web vitals (best-effort, no dep) ─────────────────────────────────
  var vitals = {}
  try {
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (x) { vitals.lcp = Math.round(x.startTime) }) }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (x) { if (!x.hadRecentInput) vitals.cls = +((vitals.cls || 0) + x.value).toFixed(3) }) }).observe({ type: 'layout-shift', buffered: true })
  } catch (e) {}
  addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { if (vitals.lcp != null || vitals.cls != null) send('vitals', vitals); flush() } })

  // ── public API (manual funnel/identify) + GA/FB fan-out ───────────────────
  function assign(a, b) { if (b) for (var k in b) a[k] = b[k]; return a }
  window.hanzo = {
    track: function (name, props) { send('event', assign({ name: name }, props)) },
    identify: function (id, traits) { try { localStorage.setItem('hz_uid', id) } catch (e) {} send('identify', assign({ id: id }, traits)) },
    page: function (props) { last = ''; page(); if (props) send('event', assign({ name: 'page_props' }, props)) },
  }
  var ga = s.getAttribute('data-ga'), fb = s.getAttribute('data-fb')
  function load(src) { var el = document.createElement('script'); el.async = true; el.src = src; document.head.appendChild(el) }
  if (ga) { load('https://www.googletagmanager.com/gtag/js?id=' + ga); window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments) }; gtag('js', new Date()); gtag('config', ga); var _t = window.hanzo.track; window.hanzo.track = function (n, p) { _t(n, p); try { gtag('event', n, p || {}) } catch (e) {} } }
  if (fb) { !function (f, b, e, v, n, t, x) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [] }(window); load('https://connect.facebook.net/en_US/fbevents.js'); fbq('init', fb); fbq('track', 'PageView'); var _u = window.hanzo.track; window.hanzo.track = function (n, p) { _u(n, p); try { fbq('trackCustom', n, p || {}) } catch (e) {} } }
})()
