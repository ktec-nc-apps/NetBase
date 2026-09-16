/* NetBase — Nextcloud native SPA (buildless Vue 3).
 * A device list built from a privilege-free LAN sweep, with the everyday
 * lookup tools (DNS, whois, TLS, subnet maths) beside it.
 * No eval / no new Function — the template is precompiled at build time. */
(function () {
  'use strict';
  // vue-private.js moved the runtime off window.Vue (see the note there).
  const Vue = window.__NetBaseVue || window.__RegiBaseVue || window.__FormulaBaseVue || window.Vue;
  const { createApp } = Vue;

  const BASE = ((window.OC && OC.generateUrl) ? OC.generateUrl('/apps/netbase') : '/apps/netbase') + '/';
  let TOKEN = (window.OC && OC.requestToken) ? OC.requestToken : '';
  let rootProxy = null;

  function i18nSubst(s, vars) {
    return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
  }
  // Set when the user picks a language inside NetBase rather than following
  // Nextcloud's; it takes precedence over the bundle NC loaded for the page.
  let i18nOverride = null;
  function T(text, vars) {
    if (i18nOverride) {
      return i18nSubst(i18nOverride[text] != null ? i18nOverride[text] : text, vars);
    }
    try { if (typeof window.t === 'function') { return i18nSubst(window.t('netbase', text), vars); } } catch (e) { /* raw */ }
    return i18nSubst(text, vars);
  }

  function freshToken() {
    try { if (window.OC && OC.requestToken) return OC.requestToken; } catch (e) { /* */ }
    try { const h = document.getElementsByTagName('head')[0]; const t = h && h.getAttribute('data-requesttoken'); if (t) return t; } catch (e) { /* */ }
    try { if (window.oc_requesttoken) return window.oc_requesttoken; } catch (e) { /* */ }
    return TOKEN;
  }

  /**
   * Terminal emulators, kept out of Vue's reach.
   *
   * Making one reactive would wrap it in a proxy, and xterm.js reads its own
   * private fields — which a proxy is not allowed to do. The window keeps only
   * its id; everything with machinery inside lives here, by that id.
   */
  const SCREENS = new Map();

  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const doFetch = (tok) => fetch(BASE + 'api/' + path, {
      headers: { 'Content-Type': 'application/json', 'requesttoken': tok },
      credentials: 'same-origin',
      ...opts,
    });
    let res = await doFetch(TOKEN);
    if (method !== 'GET' && (res.status === 412 || res.status === 403)) {
      const fresh = freshToken();
      if (fresh) TOKEN = fresh;
      res = await doFetch(TOKEN);
    }
    if (res.status === 401) { if (rootProxy) rootProxy.authenticated = false; throw new Error('unauthorized'); }
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const failure = new Error((body && body.error) || res.statusText);
      // Carried on the error itself, so whoever catches it can tell a question
      // (the master key) from a fault.
      if (body && body.needsKey) failure.needsKey = true;
      throw failure;
    }
    return body;
  }
  const qs = (params) => Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => encodeURIComponent(k) + '[]=' + encodeURIComponent(x)) : [encodeURIComponent(k) + '=' + encodeURIComponent(v)]))
    .join('&');

  /* ---------- presentation helpers ---------- */
  const TYPE_ICON = {
    router: '📶', printer: '🖨️', camera: '📷', nas: '💾', pc: '💻', phone: '📱',
    iot: '💡', av: '📺', sbc: '🍓', server: '🖥️', container: '📦', host: '🌐', unknown: '❔',
  };
  // Every template but "container" is one a scan can guess; "container" is
  // only ever chosen by hand, so scans leave it alone (ScanService::AUTO_TYPES).
  const TYPE_LABEL = {
    router: 'Network gear', printer: 'Printer', camera: 'Camera', nas: 'NAS',
    pc: 'PC', phone: 'Phone', iot: 'IoT', av: 'AV device', sbc: 'Single-board',
    server: 'Server', container: 'Container', host: 'Host', unknown: 'Unknown',
  };
  /**
   * The bytes behind the terminal's key buttons.
   *
   * They live here, in plain JavaScript, and never in the template: the
   * template is compiled to a render function when the app is built, and a
   * backslash escape written there does not survive that step — it reaches
   * the shell as the literal text "\x1b" instead of an Escape.
   */
  const KEY_CODES = {
    esc: '\x1b', tab: '\t', intr: '\x03', eof: '\x04',
    susp: '\x1a', clear: '\x0c', search: '\x12',
  };

  /**
   * The faces a terminal can be set to.
   *
   * Each is a stack, not one font: the first that the machine actually has is
   * used, and every stack ends at a generic monospace so a terminal is never
   * drawn in a proportional face.
   */
  const TERM_FONTS = [
    { id: 'system', label: 'System default', css: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
    { id: 'menlo', label: 'Menlo / Consolas', css: 'Menlo, Consolas, "Liberation Mono", monospace' },
    { id: 'dejavu', label: 'DejaVu Sans Mono', css: '"DejaVu Sans Mono", monospace' },
    { id: 'noto', label: 'Noto Sans Mono', css: '"Noto Sans Mono", "Noto Sans Mono CJK JP", monospace' },
    { id: 'gothic', label: 'Japanese-friendly', css: '"MS Gothic", Osaka-Mono, "Noto Sans Mono CJK JP", monospace' },
    { id: 'plain', label: 'Browser default', css: 'monospace' },
  ];
  /**
   * A locale to suggest for each language NetBase speaks.
   *
   * Only a starting point for the instructions: the country half is a guess,
   * and the recipe puts it on a line of its own so it can be changed.
   */
  const LOCALE_HINTS = {
    ja: 'ja_JP', en: 'en_US', zh: 'zh_CN', ko: 'ko_KR', es: 'es_ES', de: 'de_DE',
    it: 'it_IT', fr: 'fr_FR', pt: 'pt_PT', ru: 'ru_RU', ar: 'ar_SA', tr: 'tr_TR',
    id: 'id_ID', vi: 'vi_VN', th: 'th_TH', fa: 'fa_IR', pl: 'pl_PL', uk: 'uk_UA',
    hi: 'hi_IN', cs: 'cs_CZ',
  };
  /** Fonts fetched from the server are given a name of their own here. */
  const SERVER_FONT_PREFIX = 'netbase-server-';
  const SERVER_FONTS_ADDED = new Set();
  const TERM_SIZE_MIN = 9;
  const TERM_SIZE_MAX = 24;
  const TERM_SIZE_DEFAULT = 13;

  // The picker's "Other" entry; the type saved is the text typed beside it.
  const CUSTOM_TYPE = '__custom__';
  const CUSTOM_TYPE_ICON = '🏷️';

  function ipSortKey(ip) {
    if (!ip) return 0;
    const parts = String(ip).split('.');
    if (parts.length !== 4) return 0;
    return ((+parts[0] * 256 + +parts[1]) * 256 + +parts[2]) * 256 + +parts[3];
  }
  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (s < 60) return T('just now');
    if (s < 3600) return T('{n} min ago', { n: Math.floor(s / 60) });
    if (s < 86400) return T('{n} h ago', { n: Math.floor(s / 3600) });
    return T('{n} d ago', { n: Math.floor(s / 86400) });
  }
  function stamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** The moment, in a shape a file name can carry. */
  function stampFile(when) {
    const d = when || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  /* NETBASE-STORE-REMOVED — the markup of the tools taken out for the app store.
   * Restore a block into the TEMPLATE literal (and its methods, data fields, route,
   * controller and service) to bring the tool back.
   *
   * ==== the device window's own buttons ====
            <button class="btn sm" v-if="allowed('ping')" @click="toolFor('ping')">📡 {{ t('Ping') }}</button>
            <button class="btn sm" v-if="allowed('ports')" @click="toolFor('ports')">🔌 {{ t('Ports') }}</button>
            <button class="btn sm" v-if="allowed('nmap') && status.nmap && status.nmap.available" @click="toolFor('nmap')">🗺️ nmap</button>
   *
   * ==== ping / traceroute / path quality ====
        <!-- ============ ping / traceroute ============ -->
        <section v-if="tab==='ping'">
          <div class="card tool-card">
            <div class="tool-row">
              <select class="pick" :title="t('Pick one NetBase already knows')" @change="pickInto('pingHost', $event)">
                <option value="">{{ t('Choose…') }}</option>
                <optgroup v-for="g in hostChoices" :key="g.label" :label="t(g.label)">
                  <option v-for="o in g.items" :key="o.value" :value="o.value">{{ o.text }}</option>
                </optgroup>
              </select>
              <input v-model="pingHost" :placeholder="t('Host name or IP address')" @keyup.enter="runPing">
              <button class="btn primary" :disabled="busy.ping" :class="{working: busy.ping}" @click="runPing">{{ t('Ping') }}</button>
              <button class="btn" :disabled="busy.trace" :class="{working: busy.trace}" @click="runTrace">{{ t('Traceroute') }}</button>
              <button class="btn" :disabled="busy.path" :class="{working: busy.path}" @click="runPath">{{ t('Path quality') }}</button>
            </div>
            <div class="tool-row">
              <input v-model.number="tcpPingPort" type="number" class="tiny" min="1" max="65535">
              <button class="btn" :disabled="busy.tcpping" :class="{working: busy.tcpping}" @click="runTcpPing">{{ t('TCP ping (works without ICMP)') }}</button>
              <button class="btn" :disabled="busy.mtu" :class="{working: busy.mtu}" @click="runMtu">{{ t('Find the path MTU') }}</button>
            </div>
          </div>
          <div class="card" v-if="tcpPingResult">
            <h3>{{ t('TCP ping') }}</h3>
            <div class="kv">
              <div><span>{{ t('Target') }}</span><code>{{ tcpPingResult.host }}:{{ tcpPingResult.port }} <span class="dim">{{ tcpPingResult.service }}</span></code></div>
              <div><span>{{ t('Answered') }}</span><code>{{ tcpPingResult.received }} / {{ tcpPingResult.sent }} ({{ tcpPingResult.loss }}% {{ t('lost') }})</code></div>
              <div v-if="tcpPingResult.stats.avg"><span>{{ t('Round trip') }}</span><code>{{ t('min') }} {{ tcpPingResult.stats.min }} · {{ t('avg') }} {{ tcpPingResult.stats.avg }} · {{ t('max') }} {{ tcpPingResult.stats.max }} ms</code></div>
            </div>
          </div>
          <div class="card" v-if="mtuResult">
            <h3>{{ t('Path MTU') }}</h3>
            <div v-for="(f,i) in (mtuResult.findings || [])" :key="i" class="finding" :class="f.level">
              <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
            </div>
            <div class="kv" v-if="mtuResult.mtu">
              <div><span>MTU</span><code>{{ mtuResult.mtu }} {{ t('bytes') }}</code></div>
              <div><span>{{ t('Largest payload') }}</span><code>{{ mtuResult.payload }} {{ t('bytes') }}</code></div>
            </div>
          </div>
          <div class="card" v-if="pingResult">
            <div v-for="(f,i) in (pingResult.findings || [])" :key="i" class="finding" :class="f.level">
              <span class="area">{{ f.area }}</span><span>{{ f.text }}</span>
            </div>
            <div class="kv" v-if="pingResult.stats && pingResult.stats.sent">
              <div><span>{{ t('Sent') }}</span><code>{{ pingResult.stats.sent }}</code></div>
              <div><span>{{ t('Received') }}</span><code>{{ pingResult.stats.received }}</code></div>
              <div><span>{{ t('Loss') }}</span><code>{{ pingResult.stats.loss }}%</code></div>
              <div v-if="pingResult.stats.avg"><span>{{ t('Average') }}</span><code>{{ pingResult.stats.avg }} ms</code></div>
            </div>
            <pre class="raw">{{ pingResult.output }}</pre>
          </div>
          <div class="card" v-if="traceResult">
            <p v-if="!traceResult.available" class="empty-hint">{{ t('traceroute is not installed on this server.') }}</p>
            <pre v-else class="raw">{{ traceResult.output }}</pre>
          </div>
          <div class="card" v-if="pathResult">
            <div v-if="!pathResult.available" class="missing">
              <p>{{ t('Per-hop loss and latency needs mtr.') }}</p>
              <pre class="raw">{{ installFor('mtr') }}</pre>
            </div>
            <table v-else class="grid compact">
              <thead><tr><th>#</th><th>{{ t('Host') }}</th><th>{{ t('Loss') }}</th><th>{{ t('Average') }}</th><th>{{ t('Best') }}</th><th>{{ t('Worst') }}</th><th>{{ t('Jitter') }}</th></tr></thead>
              <tbody>
                <tr v-for="h in pathResult.hops" :key="h.hop">
                  <td class="mono dim">{{ h.hop }}</td>
                  <td class="mono">{{ h.host }}</td>
                  <td><span class="pill" :class="h.loss > 0 ? 'no' : 'ok'">{{ h.loss }}%</span></td>
                  <td class="mono">{{ h.avg }} ms</td>
                  <td class="mono dim">{{ h.best }}</td>
                  <td class="mono dim">{{ h.worst }}</td>
                  <td class="mono dim">{{ h.jitter }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
   *
   * ==== ports ====
        <!-- ============ ports ============ -->
        <section v-if="tab==='ports'">
          <div class="card tool-card">
            <div class="tool-row">
              <select class="pick" :title="t('Pick one NetBase already knows')" @change="pickInto('portHost', $event)">
                <option value="">{{ t('Choose…') }}</option>
                <optgroup v-for="g in hostChoices" :key="g.label" :label="t(g.label)">
                  <option v-for="o in g.items" :key="o.value" :value="o.value">{{ o.text }}</option>
                </optgroup>
              </select>
              <input v-model="portHost" :placeholder="t('Host name or IP address')" @keyup.enter="runPorts">
              <input v-model="portList" class="narrow" :placeholder="t('22,80,443,8000-8100 (blank = common ports)')">
              <button class="btn primary" :disabled="busy.ports" :class="{working: busy.ports}" @click="runPorts">{{ t('Check') }}</button>
            </div>
            <div class="chips">
              <button class="btn xs" v-for="p in portPresets" :key="p.label" @click="portList = p.ports; runPorts()">{{ t(p.label) }}</button>
            </div>
          </div>
          <div class="card" v-if="portResult">
            <table class="grid compact">
              <thead><tr><th>{{ t('Port') }}</th><th>{{ t('State') }}</th><th>{{ t('Service') }}</th><th>{{ t('Response') }}</th><th>{{ t('Banner') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in portResult.results" :key="r.port">
                  <td class="mono">{{ r.port }}</td>
                  <td><span class="pill" :class="r.open ? 'ok' : 'no'">{{ r.open ? t('open') : t('closed') }}</span></td>
                  <td>{{ r.service }}</td>
                  <td class="dim mono">{{ r.ms }} ms</td>
                  <td class="mono wrap dim">{{ r.banner }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
   *
   * ==== nmap ====
        <!-- ============ nmap ============ -->
        <section v-if="tab==='nmap'">
          <div class="card" v-if="!status.nmap || !status.nmap.available">
            <p class="empty-hint">{{ t('nmap is not installed on this server. An administrator can install it, then reload this page.') }}</p>
            <pre class="raw">sudo apt install nmap        # Debian / Ubuntu
sudo dnf install nmap        # Fedora / RHEL</pre>
          </div>
          <template v-else>
            <div class="card tool-card">
              <div class="tool-row">
                <select class="pick" :title="t('Pick one NetBase already knows')" @change="pickInto('nmapTargets', $event)">
                <option value="">{{ t('Choose…') }}</option>
                <optgroup v-for="g in targetChoices" :key="g.label" :label="t(g.label)">
                  <option v-for="o in g.items" :key="o.value" :value="o.value">{{ o.text }}</option>
                </optgroup>
              </select>
              <input v-model="nmapTargets" :placeholder="t('Host, address or 192.168.1.0/24')" @keyup.enter="runNmap">
                <select v-model="nmapPreset">
                  <option v-for="(p,k) in status.nmap.presets" :key="k" :value="k">{{ t(p.label) }}</option>
                </select>
                <button class="btn primary" :disabled="busy.nmap" :class="{working: busy.nmap}" @click="runNmap">{{ busy.nmap ? t('Scanning…') : t('Run') }}</button>
              </div>
              <div class="tool-row">
                <input v-model="nmapExtra" :placeholder="t('Extra options (allow-listed), e.g. -Pn --top-ports 200')">
              </div>
              <p class="hint">
                {{ t('nmap {version} · running as {user}', { version: status.nmap.version, user: status.nmap.user }) }}
                <span v-if="!status.nmap.privileged">— {{ t('no raw-socket privileges, so SYN/OS/UDP presets are unavailable') }}</span>
              </p>
            </div>
            <div class="card" v-if="nmapResult">
              <p v-if="nmapResult.error" class="empty-hint">⚠ {{ nmapResult.error }}</p>
              <div class="kv"><div><span>{{ t('Command') }}</span><code class="wrap">{{ nmapResult.command }}</code></div><div><span>{{ t('Duration') }}</span><code>{{ nmapResult.seconds }} s</code></div></div>
              <div v-for="(h,i) in nmapResult.hosts" :key="i" class="nmap-host">
                <div class="nh-head"><strong class="mono">{{ h.addresses.join(', ') }}</strong>
                  <span v-if="h.hostnames.length" class="dim">{{ h.hostnames.join(', ') }}</span>
                  <span v-if="h.vendor" class="badge">{{ h.vendor }}</span>
                  <span class="pill" :class="h.state==='up' ? 'ok' : 'no'">{{ h.state }}</span>
                </div>
                <table v-if="h.ports.length" class="grid compact">
                  <thead><tr><th>{{ t('Port') }}</th><th>{{ t('State') }}</th><th>{{ t('Service') }}</th><th>{{ t('Product') }}</th></tr></thead>
                  <tbody><tr v-for="p in h.ports" :key="p.port"><td class="mono">{{ p.port }}/{{ p.protocol }}</td><td>{{ p.state }}</td><td>{{ p.service }}</td><td class="dim">{{ p.product }}</td></tr></tbody>
                </table>
                <div v-if="h.os.length" class="dim">OS: {{ h.os.map(o => o.name + ' (' + o.accuracy + '%)').join(', ') }}</div>
              </div>
              <details v-if="nmapResult.output"><summary>{{ t('Raw output') }}</summary><pre class="raw">{{ nmapResult.output }}</pre></details>
            </div>
          </template>
        </section>
   *
   */

  const TEMPLATE = `
  <div class="layout" :class="{'menu-open': menu}">
    <div class="nav-backdrop" v-if="menu" @click="menu=false"></div>
    <aside class="sidebar" :class="{open: menu}">
      <div class="brand"><span class="logo"><svg viewBox="333 400 1335 1030"><path d="M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z" fill="none" stroke="#fff" stroke-width="100" stroke-linejoin="round" stroke-linecap="round"/><path d="M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z" fill="#2e3192"/><path d="M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z" fill="none" stroke="#fff" stroke-width="100" stroke-linejoin="round" stroke-linecap="round"/><path d="M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z" fill="#2970e2"/></svg></span><span>NetBase</span><span class="tag" v-if="version">v{{ version }}</span></div>
      <nav class="nav-list" @dragover.prevent @drop.prevent="dropTab(null)">
        <!-- One element per item, keyed on the element itself.
             This was a <template v-for> holding the button *and* a conditional
             <hr>, with the key on the template. One turn of the loop then
             produced two nodes or one, and reordering left Vue unable to match
             them up: it threw "insertBefore: parameter 1 is not of type Node"
             inside its own patch, abandoned the update, and from then on
             nothing in the sidebar redrew — the buttons below the list stopped
             responding because the screen had stopped being updated at all.
             The error never reached window.onerror, so it passed my checks.
             The rule is unchanged for the reader: it is drawn by the item it
             belongs to, in its own border, not as a node of its own. -->
        <button v-for="item in visibleTabs" :key="item.id"
                class="nav-item"
                :class="{active: tab===item.id, dragged: dragTab===item.id, over: overTab===item.id, 'ends-group': item.id==='devices'}"
                draggable="true"
                :title="t('Drag to put the tools in the order you want')"
                @click="tab=item.id; menu=false"
                @keydown="moveTabByKey(item, $event)"
                @dragstart="startTabDrag(item, $event)"
                @dragend="endTabDrag"
                @dragover.prevent="overTab = item.id"
                @dragleave="overTab === item.id && (overTab = '')"
                @drop.prevent.stop="dropTab(item)">
          <span class="ic" v-html="tabIcon(item.id)"></span><span class="nm">{{ t(item.label) }}</span>
          <span class="ct" v-if="item.id==='devices' && devices.length">{{ onlineCount }}</span>
          <span class="grip" aria-hidden="true">⠿</span>
        </button>
      </nav>
      <div class="sidebar-foot">
        <!-- The device list carries its own Start button, so this one would only
             repeat it. It stays for the rare account that may sweep the network
             without being allowed to see the result, which would otherwise have
             no way to begin. -->
        <button class="btn primary block" v-if="status.canScan && !allowed('devices')" :disabled="scanning" @click="menu=false; startScan()">{{ scanning ? t('Scanning…') : t('🛰️ Scan the network') }}</button>
        <button class="btn sm block" v-if="status.isAdmin" :disabled="shellBusy || (status.localShell && !status.localShell.available)" :class="{working: shellBusy}" :title="status.localShell && !status.localShell.available ? t('A local shell needs proc_open and python3 on this server, and they are not both available here.') : t('A terminal on this server, running with the same privileges as Nextcloud (the {user} account) — no more. For administrators only.', { user: 'www-data' })" @click="menu=false; beginShell()">🖳 {{ t('Open a shell') }}</button>
        <button class="btn sm block" v-if="status.isAdmin" @click="menu=false; openSysInfo()">{{ t('🖥 System information') }}</button>
        <button class="btn sm block" @click="menu=false; settingTab = 'look'; themeBox = true">{{ t('⚙ Settings') }}</button>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <!-- On a phone the tool list is a drawer, and this is its handle. -->
        <button class="btn sm menu-btn" :title="t('The list of tools')" :aria-label="t('The list of tools')" @click="menu = !menu">☰</button>
        <div class="title"><span class="ic">{{ currentTab.icon }}</span><span class="nm">{{ t(currentTab.label) }}</span><span class="desc">{{ t(currentTab.hint) }}</span></div>
        <div class="spacer"></div>
        <div class="topbar-actions">
          <!-- What belongs to this tab alone. On a phone it takes a line of its
               own, so the buttons every tab has keep their place beside the title. -->
          <div class="tab-actions" v-if="tab==='devices'">
            <input class="filter" v-model="filter" :placeholder="t('Filter by name, IP, MAC or vendor')">
            <label class="switch" :title="t('On: only devices seen in the last scan. Off: every device on record.')">
              <input type="checkbox" v-model="onlyOnline">
              <span class="track"><span class="thumb"></span></span>
              <span class="switch-label">{{ t('Online only') }}</span>
            </label>
            <button class="btn sm keep" v-if="allowed('scan')" :title="t('Edit the devices you have named, all in one place')" @click="openRegEditor"><span class="ic"><svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M14.5 4.5l3 3L8 17l-3.5.5L5 14z"/></svg></span><span class="lb">{{ t('Edit named') }}</span></button>
            <button class="btn sm keep" :title="t('Download what this tool found')" @click="exportCsv" :disabled="!shownDevices.length"><span class="ic"><svg viewBox="0 0 24 24"><path d="M12 3.5v11.5"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/></svg></span><span class="lb">CSV</span></button>
          </div>
          <!-- Whatever this tool has found: onto the clipboard, into a file, or
               into the person's own Nextcloud folder. -->
          <button class="btn sm keep" :title="t('Copy what this tool found')" :disabled="!hasResult" @click="copyResult">
            <span class="ic"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></span><span class="lb">{{ t('Copy') }}</span>
          </button>
          <button class="btn sm keep" :title="t('Download what this tool found')" :disabled="!hasResult" @click="downloadResult">
            <span class="ic"><svg viewBox="0 0 24 24"><path d="M12 3.5v11.5"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/></svg></span><span class="lb">{{ t('Download as a file') }}</span>
          </button>
          <button class="btn sm keep" :title="t('Save it to your Nextcloud files')" :disabled="!hasResult" @click="saveResultToFiles">
            <!-- "Save" on its own sat in the same screen as the Save inside a
                 text window, and somebody pressed this one meaning that one and
                 got a report written into their files. It says what it saves. -->
            <span class="ic"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5"/><path d="M9.8 13.3l2.2 2.2 2.2-2.2"/></svg></span><span class="lb">{{ t('Save the result') }}</span>
          </button>
        </div>
      </div>

      <div class="content">
        <!-- One "working" bar for every tool: a stripe slides across the top of
             the panel whenever any request is in flight, so an operation with no
             count of its own (whois, TLS, DNS, mail, SSH…) still shows it is running. -->
        <div class="global-busy" :class="{on: anyBusy}" role="progressbar" :aria-label="t('Working…')"><span></span></div>
        <div v-if="banner" class="banner" :class="banner.kind">
          <span>{{ banner.text }}</span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="banner=null"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>

        <!-- ============ devices ============ -->
        <section v-if="tab==='devices'">
          <div class="card scan-card" v-if="allowed('scan')">
            <!-- What is being scanned, before anything about how. The two are
                 different jobs: one walks every address in the network, the
                 other starts from what this server has already met. -->
            <div class="scan-what">
              <span class="fl-label">{{ t('What to scan') }}</span>
              <label :title="t('Starts from the ARP table and what announces itself, instead of walking every address. Seconds rather than minutes, and everything found is still asked for its name and its open ports — but a device that has never spoken to this server and does not announce itself will not be found.')">
                <input type="radio" value="arp" v-model="scanWhat"> {{ t('The ARP table only') }}
              </label>
              <label :title="t('Walks every address in the networks below. Thorough, and the slow one.')">
                <input type="radio" value="network" v-model="scanWhat"> {{ t('The whole network') }}
              </label>
            </div>
            <div class="scan-row">
              <label class="fl" v-if="scanWhat === 'network'" :title="t('Which networks to look at. Left blank, it uses the ones this server is on. Several can be given, separated by commas.')">
                <span class="fl-label">{{ t('Networks to scan') }}</span>
                <input v-model="scanTargets" :placeholder="suggestedPlaceholder">
              </label>
              <!-- Two different things, named as the two different things they
                   are. This one walks the addresses; the wait beneath is what a
                   port that says nothing costs, and it is the wait, not this,
                   that decides how long a long scan takes. -->
              <label class="fl narrow pace" v-if="scanWhat === 'network'" :title="t('How quickly the addresses are walked through. A slower speed finds more Wi-Fi devices, because a wireless network carries broadcasts slowly: on a /16 with ten devices, 15,000 a second found six of them and 1,500 found all ten.')">
                <span class="fl-label">{{ t('Scan speed') }}</span>
                <select v-model="pace">
                  <option v-for="r in paceRates" :key="r" :value="String(r)">{{ paceLabel(r) }}</option>
                </select>
              </label>
              <!-- Two buttons for two jobs. The first re-checks which devices
                   are online and is fast because it skips the ports; the second
                   is the full sweep that also reads each device's open ports.
                   The per-device "every port" search lives in a device's own
                   properties, and stays there. -->
              <template v-if="!scanning">
                <button class="btn primary" @click="startScan({ ports: false })" :title="t('Finds devices and rechecks which are online. Does not scan ports, so it is fast.')">{{ t('Refresh devices') }}</button>
                <button class="btn" @click="startScan({ ports: true, names: false, multicast: false, rdns: false, arpOnly: true })" :title="t('Checks the open ports of the devices already found, without repeating the name and multicast discovery a refresh does.')">{{ t('Port scan') }}</button>
                <!-- Clearing the neighbour (ARP) table needs privileges NetBase does
                     not have; the button only works once an administrator installs a
                     small helper, and the ? explains how. -->
                <span class="arp-clear">
                  <button class="btn" :disabled="!(status.arpFlush && status.arpFlush.available) || busy.arpflush" :class="{working: busy.arpflush}" @click="clearArp" :title="t('Forget every remembered address so a refresh shows only what answers now. Stale entries (a device switched off) disappear. Needs a helper an administrator installs.')">{{ t('Clear the ARP table') }}</button>
                  <button v-if="!(status.arpFlush && status.arpFlush.available)" class="btn xs ib arp-help-btn" :title="t('How to switch this on')" :aria-label="t('How to switch this on')" @click="arpHelp = true">?</button>
                </span>
              </template>
              <button class="btn primary" v-else disabled>{{ t('Scanning…') }}</button>
              <button class="btn" v-if="scanning" @click="cancelScan">{{ t('Stop') }}</button>
            </div>
            <!-- The four steps of a scan, in the order they happen, so the row
                 reads as what the scan is about to do. -->
            <div class="scan-opts">
              <label :title="t('Asks each address for its own name, over NetBIOS and mDNS.')"><input type="checkbox" v-model="opts.names"> {{ t('Ask devices for their names') }}</label>
              <label :title="t('Listens for the devices that announce themselves — mDNS, WS-Discovery and SSDP. It finds devices the sweep missed.')"><input type="checkbox" v-model="opts.multicast"> {{ t('Multicast discovery') }}</label>
              <label :title="t('Asks the DNS server what name it has on record for each address.')"><input type="checkbox" v-model="opts.rdns"> {{ t('Reverse DNS') }}</label>
            </div>
            <!-- The settings for the "Port scan" button, kept under the row so
                 a depth can be chosen before it is pressed. They do nothing for
                 "Refresh devices", which never scans ports. -->
            <div class="scan-sub">
              <span class="scan-sub-head">{{ t('Port scan') }}</span>
              <label :title="t('How many ports to try on each device.')">
                <span class="opt-label">{{ t('Ports to try') }}</span>
                <select v-model="opts.portScan">
                  <option value="common">{{ t('Common ports') }} ({{ portCount('common') }})</option>
                  <option value="detailed">{{ t('Detailed search') }} ({{ portCount('detailed') }})</option>
                  <option value="wellKnown">{{ t('Well-known ports') }} ({{ portCount('wellKnown') }})</option>
                  <option value="high">{{ t('High ports') }} ({{ portCount('high') }})</option>
                  <option value="all">{{ t('Every port') }} ({{ portCount('all') }})</option>
                </select>
              </label>
              <!-- The number that actually decides how long this takes. -->
              <label :title="t('How long to wait for a port to answer. A port that refuses is instant whatever this is; the wait only applies to one that says nothing at all, which is what a firewall and a sleeping device both look like. Waiting less is quicker and misses more.')">
                <span class="opt-label">{{ t('Wait for an answer') }}</span>
                <select v-model.number="opts.portWait">
                  <option v-for="w in portWaits" :key="w" :value="w">{{ waitLabel(w) }}</option>
                </select>
              </label>
            </div>
            <div class="progress" v-if="scanning && scan">
              <div class="phase-line"><span class="phase-step">{{ phaseLabel(scan) }}</span></div>
              <div class="bar" :class="{ waiting: phaseWaiting(scan) }"><div class="fill" v-if="!phaseWaiting(scan)" :style="{width: scan.percent + '%'}"></div></div>
              <div class="progress-text"><span>{{ progressText(scan) }}</span><span class="spacer"></span><span v-if="!phaseWaiting(scan)">{{ scan.percent }}%</span></div>
            </div>
            <p class="hint" v-if="advice && !advice.ok">
              ⚠ {{ t('This target has {hosts} addresses but the kernel ARP table holds {gc3}. The sweep still works, but the kernel will log overflow warnings. To avoid that, an administrator can run:', { hosts: advice.hosts, gc3: advice.gc3 }) }}
              <code>{{ advice.advice }}</code>
            </p>
          </div>

          <div v-if="!shownDevices.length" class="empty-hint">{{ allowed('scan') ? t('No devices recorded yet. Start a scan to build the list.') : t('No devices have been recorded yet. An administrator has to run a scan first.') }}</div>
          <table v-else class="grid">
            <thead>
              <tr>
                <th class="c-dot"></th>
                <!-- The header mirrors a row: the name on top, then the address
                     line's fields (IPv4, MAC, vendor) beneath, each one its own
                     sort with an arrow showing the direction. -->
                <th class="c-name">
                  <span class="th-line head" @click="sortBy('name')" :class="sortClass('name')" :title="t('The name a device reports over NetBIOS, mDNS or reverse DNS. A name you type yourself is shown instead when set.')">{{ t('Name') }}</span>
                  <span class="th-sub">
                    <span class="th-line" @click="sortBy('ip')" :class="sortClass('ip')">{{ t('IPv4') }}</span>
                    <span class="th-sep">·</span>
                    <span class="th-line" @click="sortBy('mac')" :class="sortClass('mac')">{{ t('MAC address') }}</span>
                    <span class="th-sep">·</span>
                    <span class="th-line" @click="sortBy('vendor')" :class="sortClass('vendor')">{{ t('Vendor') }}</span>
                    <span class="th-sep">·</span>
                    <span class="th-line plain">{{ t('Open ports') }}</span>
                  </span>
                </th>
                <th class="c-pair">
                  <span class="th-line head" @click="sortBy('type')" :class="sortClass('type')">{{ t('Type') }}</span>
                </th>
                <th class="c-extra"><span class="th-line head" @click="sortBy('lastSeen')" :class="sortClass('lastSeen')">{{ t('Last seen') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in deviceGroups" :key="g.key" @click="openDevice(g.rep)" @contextmenu.prevent="openRowMenu(g.rep, $event)" :class="{offline: !g.online}">
                <td class="c-dot"><span class="dot" :class="{on: g.online}" :title="g.online ? t('Online') : t('Not seen in the last sweep')"></span></td>
                <td class="c-name">
                  <div class="pair-a"><span class="ic">{{ icon(g.rep) }}</span><span class="nm" :class="{unnamed: !listName(g.rep).named}">{{ listName(g.rep).text }}</span><span class="badge self" v-if="g.isSelf">{{ t('this server') }}</span><span class="badge" v-if="g.rep.label">{{ t('named') }}</span></div>
                  <!-- Ports belong to the address they are open on, so they sit
                       on each address line and open a window on THAT IP — a
                       device with several addresses shows each one's ports. -->
                  <template v-for="(m, mi) in g.members" :key="m.id">
                    <div class="addr-line mono" :class="{'addr-off': !m.online, 'addr-sep': mi > 0}">
                      <span class="addr-net"><span class="badge" v-if="netBadge(m)" :class="netRank(m) >= 1 ? 'secondary' : 'away'" :title="netTitle(m)">{{ netBadge(m) }}</span></span>
                      <span class="addr-ip">{{ m.ip }}<template v-if="cidrBitsFor(m)">/{{ cidrBitsFor(m) }}</template></span>
                      <span class="addr-mac dim">{{ m.mac || '—' }}</span>
                      <span class="addr-vendor dim" :title="macVendor(m)">{{ macVendor(m) ? '(' + macVendor(m) + ')' : '' }}</span>
                      <span class="addr-ports dim" v-if="m.ports && m.ports.length" @click.stop>
                        <span class="addr-ports-label">{{ t('ports') }}</span>
                        <template v-for="(p,i) in m.ports" :key="p">
                          <a v-if="portLink(m, p)" href="#" :title="portLink(m, p).title" @click.prevent="openDeviceWindow(m, p)">{{ p }}</a>
                          <a v-else-if="portTool(m, p)" href="#" :title="portTool(m, p).title" @click.prevent="openPortTool(m, p)">{{ p }}</a>
                          <span v-else>{{ p }}</span><span v-if="i < m.ports.length - 1">, </span>
                        </template>
                      </span>
                    </div>
                  </template>
                  <div class="pair-note" v-if="g.rep.notes" :title="g.rep.notes">📝 {{ g.rep.notes }}</div>
                </td>
                <td class="c-pair">
                  <div class="pair-a">{{ typeText(g.rep.type) }}</div>
                </td>
                <td class="dim c-extra">{{ ago(g.lastSeen) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- ============ dns ============ -->
        <section v-if="tab==='dns'">
          <div class="card tool-card">
            <div class="seg">
              <button v-for="v in dnsViews" :key="v.id" class="seg-btn" :class="{active: dnsView===v.id}" @click="dnsView=v.id">{{ t(v.label) }}</button>
            </div>
          </div>

          <template v-if="dnsView==='records'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="dnsHost" :placeholder="t('example.com')" @keyup.enter="runDns">
                <button class="btn primary" :disabled="busy.dns" :class="{working: busy.dns}" @click="runDns">{{ t('Look up') }}</button>
              </div>
              <div class="chips">
                <label v-for="ty in dnsTypes" :key="ty"><input type="checkbox" :value="ty" v-model="dnsWanted"> {{ ty }}</label>
              </div>
            </div>
            <div class="card" v-if="dnsResult">
              <table class="grid compact">
                <thead><tr><th>{{ t('Type') }}</th><th>{{ t('TTL') }}</th><th>{{ t('Value') }}</th></tr></thead>
                <tbody><tr v-for="(r,i) in dnsResult.records" :key="i"><td class="mono">{{ r.type }}</td><td class="dim mono">{{ r.ttl }}</td><td class="mono wrap">{{ r.value }}</td></tr></tbody>
              </table>
              <p v-if="!dnsResult.records.length" class="empty-hint">{{ t('No records returned.') }}</p>
              <div class="kv" v-if="dnsResult.analysis && (dnsResult.analysis.spf || dnsResult.analysis.dmarc)">
                <div v-if="dnsResult.analysis.spf"><span>SPF</span><code>{{ dnsResult.analysis.spf }}</code></div>
                <div v-if="dnsResult.analysis.dmarc"><span>DMARC</span><code>{{ dnsResult.analysis.dmarc }}</code></div>
              </div>
            </div>
          </template>

          <template v-if="dnsView==='advanced'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="dnsHost" :placeholder="t('example.com')" @keyup.enter="runDnsQuery">
                <select v-model="dnsType" class="tiny"><option v-for="ty in dnsAllTypes" :key="ty" :value="ty">{{ ty }}</option></select>
                <select v-model="dnsServer" class="short">
                  <option v-for="r in knownResolvers" :key="r.host || 'self'" :value="r.host">{{ r.host ? r.host + ' — ' + r.label : t('This server') }}</option>
                </select>
                <input v-model="dnsServer" class="short" :placeholder="t('Resolver (blank = this server)')">
                <button class="btn primary" :disabled="busy.dnsq" :class="{working: busy.dnsq}" @click="runDnsQuery">{{ t('Ask') }}</button>
              </div>
              <label class="opt"><input type="checkbox" v-model="dnsDnssec"> {{ t('Ask the resolver to validate DNSSEC') }}</label>
              <p class="dim">{{ t('Any record type, from any resolver — NetBase speaks DNS itself instead of going through PHP.') }}</p>
            </div>
            <div class="card" v-if="dnsQueryResult">
              <div class="kv">
                <div><span>{{ t('Status') }}</span><code :class="dnsQueryResult.status === 'NOERROR' ? 'good' : 'bad'">{{ dnsQueryResult.status }}</code></div>
                <div><span>{{ t('Answered by') }}</span><code>{{ dnsQueryResult.server }} · {{ dnsQueryResult.ms }} ms</code></div>
                <div><span>{{ t('Flags') }}</span><code>{{ dnsFlags(dnsQueryResult) }}</code></div>
                <div v-if="dnsQueryResult.error"><span>{{ t('Error') }}</span><code class="bad">{{ dnsQueryResult.error }}</code></div>
              </div>
              <table class="grid compact" v-if="dnsQueryResult.answers.length">
                <thead><tr><th>{{ t('Name') }}</th><th>{{ t('Type') }}</th><th>{{ t('TTL') }}</th><th>{{ t('Value') }}</th></tr></thead>
                <tbody><tr v-for="(r,i) in dnsQueryResult.answers" :key="i"><td class="mono tiny">{{ r.name }}</td><td class="mono">{{ r.type }}</td><td class="dim mono">{{ r.ttl }}</td><td class="mono wrap tiny">{{ r.value }}</td></tr></tbody>
              </table>
              <p v-else class="empty-hint">{{ t('No records returned.') }}</p>
              <details v-if="dnsQueryResult.authority.length"><summary>{{ t('Authority section') }}</summary>
                <table class="grid compact"><tbody><tr v-for="(r,i) in dnsQueryResult.authority" :key="i"><td class="mono tiny">{{ r.name }}</td><td class="mono">{{ r.type }}</td><td class="mono wrap tiny">{{ r.value }}</td></tr></tbody></table>
              </details>
            </div>
          </template>

          <template v-if="dnsView==='compare'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="dnsHost" :placeholder="t('example.com')" @keyup.enter="runDnsCompare">
                <select v-model="dnsType" class="tiny"><option v-for="ty in dnsAllTypes" :key="ty" :value="ty">{{ ty }}</option></select>
                <button class="btn primary" :disabled="busy.dnsc" :class="{working: busy.dnsc}" @click="runDnsCompare">{{ t('Compare resolvers') }}</button>
              </div>
              <p class="dim">{{ t('Asks this server and the large public resolvers the same question, so you can see whether a change has spread yet.') }}</p>
            </div>
            <div class="card" v-if="dnsCompareResult">
              <div v-for="(f,i) in dnsCompareResult.findings" :key="i" class="finding" :class="f.level">
                <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
              </div>
              <table class="grid compact">
                <thead><tr><th>{{ t('Resolver') }}</th><th>{{ t('Time') }}</th><th>{{ t('Status') }}</th><th>{{ t('Answer') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r,i) in dnsCompareResult.rows" :key="i">
                    <td>{{ r.label }} <span class="dim mono tiny">{{ r.server }}</span></td>
                    <td class="mono">{{ r.ms }} ms</td>
                    <td class="mono">{{ r.status }}</td>
                    <td class="mono wrap tiny">{{ r.values.join(', ') || '—' }} <span class="pill" :class="r.agrees ? 'ok' : 'warn'">{{ r.agrees ? t('same') : t('differs') }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-if="dnsView==='trace'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="dnsHost" :placeholder="t('example.com')" @keyup.enter="runDnsTrace">
                <select v-model="dnsType" class="tiny"><option v-for="ty in dnsAllTypes" :key="ty" :value="ty">{{ ty }}</option></select>
                <button class="btn primary" :disabled="busy.dnst" :class="{working: busy.dnst}" @click="runDnsTrace">{{ t('Trace from the root') }}</button>
              </div>
              <p class="dim">{{ t('Follows the delegation the way a resolver does, so a broken hand-off between zones is visible.') }}</p>
            </div>
            <div class="card" v-if="dnsTraceResult">
              <div v-for="(s,i) in dnsTraceResult.steps" :key="i" class="trace-step">
                <div class="ts-head"><span class="pill">{{ i + 1 }}</span> <strong class="mono">{{ s.serverName }}</strong> <span class="dim mono">{{ s.server }}</span> <span class="dim">{{ s.ms }} ms · {{ s.status }}</span></div>
                <div class="mono tiny wrap" v-if="s.answers.length">→ {{ s.answers.map(a => a.type + ' ' + a.value).join(', ') }}</div>
                <div class="dim mono tiny wrap" v-else>{{ t('delegates to') }} {{ s.authority.filter(a => a.type === 'NS').map(a => a.value).join(', ') || '—' }}</div>
              </div>
            </div>
          </template>

          <template v-if="dnsView==='axfr'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="axfrZone" :placeholder="t('example.com')" @keyup.enter="runAxfr">
                <input v-model="axfrServer" class="short" :placeholder="t('Name server (blank = all of them)')">
                <button class="btn primary" :disabled="busy.axfr" :class="{working: busy.axfr}" @click="runAxfr">{{ t('Test zone transfer') }}</button>
              </div>
              <p class="dim">{{ t('A name server that hands its whole zone to a stranger gives away every host name it knows. This checks whether yours refuses.') }}</p>
            </div>
            <div class="card" v-if="axfrResult">
              <div v-for="(f,i) in axfrResult.findings" :key="i" class="finding" :class="f.level">
                <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
              </div>
              <table class="grid compact">
                <thead><tr><th>{{ t('Name server') }}</th><th>{{ t('Result') }}</th><th>{{ t('Records') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r,i) in axfrResult.results" :key="i">
                    <td class="mono">{{ r.server }} <span class="dim tiny">{{ r.address }}</span></td>
                    <td><span class="pill" :class="r.allowed ? 'bad' : 'ok'">{{ r.allowed ? t('transfer allowed') : t('refused') }}</span> <span class="dim tiny">{{ r.error || '' }}</span></td>
                    <td class="mono">{{ r.records || '' }}</td>
                  </tr>
                </tbody>
              </table>
              <template v-for="(r,i) in axfrResult.results" :key="'s'+i">
                <details v-if="r.sample && r.sample.length"><summary>{{ r.server }}</summary><pre class="raw">{{ r.sample.join('\n') }}</pre></details>
              </template>
            </div>
          </template>
        </section>

        <!-- ============ whois ============ -->
        <section v-if="tab==='whois'">
          <!-- Whois lookup first: a single domain or IP, with its registration
               shown just below. -->
          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="whoisQuery" :placeholder="t('Domain name or IP address')" @keyup.enter="runWhois">
              <button class="btn primary" :disabled="busy.whois" :class="{working: busy.whois}" @click="runWhois">{{ t('Look up') }}</button>
            </div>
          </div>
          <div class="card" v-if="whoisResult">
            <div class="kv" v-if="Object.keys(whoisResult.fields).length">
              <div v-for="(v,k) in whoisResult.fields" :key="k"><span>{{ t(fieldLabel(k)) }}</span><code>{{ v }}</code></div>
            </div>
            <details v-for="(hop,i) in whoisResult.chain" :key="i" :open="i===whoisResult.chain.length-1">
              <summary>{{ hop.server }}</summary>
              <pre class="raw">{{ hop.response }}</pre>
            </details>
          </div>
          <!-- Free-domain search below: type the name before the dot and every
               common ending is checked at once. A free one gets an OK mark; a taken
               one gets a Whois button that opens its registration above. -->
          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="availDomains" :placeholder="t('A name, without the ending — e.g. example')" @keyup.enter="runAvailability">
              <button class="btn primary" :disabled="busy.avail || !availBase" :class="{working: busy.avail}" @click="runAvailability">{{ busy.avail ? t('Checking…') : t('Find a free domain') }}</button>
            </div>
            <div class="avail-scope">
              <span class="fl-label">{{ t('Range to check') }}</span>
              <label v-for="ti in availTierList" :key="ti.key" class="avail-scope-opt" :class="{on: availTier===ti.key}">
                <input type="radio" :value="ti.key" v-model="availTier"> {{ t(ti.label) }} <span class="dim">({{ ti.count }})</span>
              </label>
              <span class="dim tiny avail-warn" v-if="availTier!=='core'">{{ t('A large range can take 30–60 seconds.') }}</span>
            </div>
            <div v-if="busy.avail || (availProgress.total && availProgress.done < availProgress.total)" class="progress avail-progress">
              <div class="bar"><div class="fill" :style="{width: (availProgress.total ? Math.round(availProgress.done / availProgress.total * 100) : 0) + '%'}"></div></div>
              <div class="progress-text"><span>{{ t('Checking “{name}”…', {name: availBase}) }}</span><span class="spacer"></span><span>{{ availProgress.done }} / {{ availProgress.total }}</span></div>
            </div>
            <div v-if="availResults.length" class="avail-list">
              <div class="avail-filters">
                <label class="switch" :title="t('On: shown. Off: hidden.')">
                  <input type="checkbox" v-model="availShowTaken">
                  <span class="track"><span class="thumb"></span></span>
                  <span class="switch-label">{{ t('Show taken (×)') }}</span>
                </label>
                <label class="switch" :title="t('On: shown. Off: hidden.')">
                  <input type="checkbox" v-model="availShowUnknown">
                  <span class="track"><span class="thumb"></span></span>
                  <span class="switch-label">{{ t('Show undetermined (?)') }}</span>
                </label>
              </div>
              <div class="avail-legend dim tiny">○ {{ t('free') }} · × {{ t('taken') }} · △ {{ t('likely free (registry unreachable)') }} · ? {{ t('undetermined') }}</div>
              <div class="avail-rows">
                <div v-for="r in availShown" :key="r.domain" class="avail-row" :class="'avail-'+r.cls">
                  <span class="avail-mark" :class="'m-'+r.cls" :title="availTitle(r)">{{ r.mark }}</span>
                  <span class="avail-domain mono" :title="availTitle(r)">{{ r.domain }}</span>
                  <button v-if="r.mark==='×'" class="btn xs avail-taken" :title="t('Taken — show the Whois registration')" @click="showWhoisFor(r)"><span class="ic">📇</span> Whois</button>
                </div>
              </div>
              <div v-if="!availShown.length" class="avail-empty dim">
                {{ t('All {n} results are hidden by the switches above.', {n: availResults.length}) }}
                <a href="#" @click.prevent="availShowTaken=true; availShowUnknown=true">{{ t('Show all') }}</a>
              </div>
            </div>
          </div>
        </section>

        <!-- ============ tls / http ============ -->
        <section v-if="tab==='tls'">
          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="tlsHost" :placeholder="t('example.com')" @keyup.enter="runTls">
              <input v-model.number="tlsPort" class="tiny" type="number">
              <button class="btn primary" :disabled="busy.tls" :class="{working: busy.tls}" @click="runTls">{{ t('Inspect certificate') }}</button>
              <button class="btn" :disabled="busy.http" :class="{working: busy.http}" @click="runHttp">{{ t('HTTP headers') }}</button>
              <button class="btn" :disabled="busy.tlsver" :class="{working: busy.tlsver}" @click="runTlsVersions">{{ t('Which TLS versions?') }}</button>
            </div>
          </div>
          <div class="card" v-if="tlsVersionsResult">
            <div v-for="(f,i) in tlsVersionsResult.findings" :key="i" class="finding" :class="f.level">
              <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
            </div>
            <table class="grid compact">
              <thead><tr><th>{{ t('Version') }}</th><th>{{ t('Accepted') }}</th><th>{{ t('Cipher') }}</th></tr></thead>
              <tbody>
                <tr v-for="(v,name) in tlsVersionsResult.versions" :key="name">
                  <td class="mono">{{ name }}</td>
                  <td><span class="pill" :class="v.supported ? (name === 'TLSv1.0' || name === 'TLSv1.1' ? 'warn' : 'ok') : 'no'">{{ v.supported ? t('yes') : t('no') }}</span></td>
                  <td class="mono dim tiny">{{ v.cipher || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card" v-if="tlsResult">
            <p v-if="!tlsResult.ok" class="empty-hint">⚠ {{ tlsResult.error }}</p>
            <template v-else>
              <div class="kv">
                <div><span>{{ t('Subject') }}</span><code>{{ tlsResult.subject }}</code></div>
                <div><span>{{ t('Issuer') }}</span><code>{{ tlsResult.issuer }}</code></div>
                <div><span>{{ t('Valid until') }}</span><code :class="{danger: tlsResult.daysLeft < 14}">{{ stamp(tlsResult.validTo) }} ({{ t('{n} days left', {n: tlsResult.daysLeft}) }})</code></div>
                <div><span>{{ t('Protocol') }}</span><code>{{ tlsResult.protocol }} / {{ tlsResult.cipher }}</code></div>
                <div v-if="tlsResult.sans.length"><span>{{ t('Names') }}</span><code class="wrap">{{ tlsResult.sans.join(', ') }}</code></div>
              </div>
            </template>
          </div>
          <div class="card" v-if="httpResult">
            <table class="grid compact">
              <thead><tr><th>{{ t('URL') }}</th><th>{{ t('Status') }}</th><th>{{ t('Time') }}</th><th>{{ t('Server') }}</th></tr></thead>
              <tbody><tr v-for="(h,i) in httpResult.chain" :key="i"><td class="mono wrap">{{ h.url }}</td><td class="mono">{{ h.status }}</td><td class="dim mono">{{ h.ms }} ms</td><td class="dim">{{ h.server }}</td></tr></tbody>
            </table>
            <div v-for="(f,i) in (httpResult.findings || [])" :key="i" class="finding" :class="f.level">
              <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
            </div>
            <div class="kv">
              <div v-for="(v,k) in httpResult.security" :key="k"><span>{{ k }}</span><code :class="{dim: !v}">{{ v || t('not set') }}</code></div>
            </div>
          </div>
        </section>

        <!-- ============ benchmarks ============ -->
        <section v-if="tab==='bench'">
          <div class="card">
            <div class="bench-head">
              <h3>{{ t('Live throughput') }}</h3>
              <select v-model="liveIface" class="narrow">
                <option v-for="i in liveIfaces" :key="i" :value="i">{{ i }}</option>
              </select>
              <span class="spacer"></span>
              <button class="btn sm" :class="{active: liveOn}" @click="toggleLive">{{ liveOn ? t('Stop') : t('Start') }}</button>
            </div>
            <div class="bench-live" v-if="liveIface">
              <div class="rate rx"><span class="lbl">↓ {{ t('Receive') }}</span><span class="val">{{ fmtRate(liveNow.rx) }}</span></div>
              <div class="rate tx"><span class="lbl">↑ {{ t('Send') }}</span><span class="val">{{ fmtRate(liveNow.tx) }}</span></div>
              <svg class="spark" viewBox="0 0 300 60" preserveAspectRatio="none">
                <polyline class="sp-rx" :points="spark(liveRx)"></polyline>
                <polyline class="sp-tx" :points="spark(liveTx)"></polyline>
              </svg>
            </div>
            <p class="hint">{{ t('Read straight from the kernel counters, so it costs nothing and needs no extra software.') }}
              <span v-if="liveErrors"> ⚠ {{ t('{n} interface errors / drops recorded since boot', {n: liveErrors}) }}</span></p>
          </div>

          <div class="card">
            <div class="bench-head">
              <h3>{{ t('Internet speed test') }}</h3>
              <select v-model.number="speedSize" class="narrow">
                <option :value="5">5 MB</option><option :value="25">25 MB</option>
                <option :value="50">50 MB</option><option :value="100">100 MB</option>
              </select>
              <select v-model="speedVia" class="narrow" :title="t('Where to measure against')">
                <option value="auto">{{ t('Nearest (automatic)') }}</option>
                <option value="mlab">M-Lab</option>
                <option value="cloudflare">Cloudflare</option>
              </select>
              <label class="inline-check"><input type="checkbox" v-model="speedUpload"> {{ t('Also test upload') }}</label>
              <span class="spacer"></span>
              <button class="btn primary" :disabled="busy.speed" :class="{working: busy.speed}" @click="runSpeed">{{ busy.speed ? t('Measuring…') : t('Run') }}</button>
            </div>
            <p class="hint" v-if="speedEndpoint">
              {{ t('Measured against {host}{where}. Nothing but the test payload is sent.', {host: speedEndpoint, where: speedWhere ? ' (' + speedWhere + ')' : ''}) }}
              {{ t('Treat the figure as a guide: it moves with the server that was chosen and with the time of day.') }}
            </p>
            <p class="hint" v-else>
              {{ speedVia === 'cloudflare' ? t('Cloudflare will be measured against. Nothing but the test payload is sent.') : speedVia === 'mlab' ? t('The nearest M-Lab server will be measured against. Nothing but the test payload is sent.') : t('The nearest measurement server is chosen when the test runs. Nothing but the test payload is sent.') }}
              {{ t('Treat the figure as a guide: it moves with the server that was chosen and with the time of day.') }}
            </p>
            <div class="bench-results" v-if="speedResult">
              <div class="big"><span class="lbl">↓ {{ t('Download') }}</span><span class="num">{{ speedResult.download ? speedResult.download.mbps : '—' }}</span><span class="unit">Mbps</span></div>
              <div class="big"><span class="lbl">↑ {{ t('Upload') }}</span><span class="num">{{ speedResult.upload ? speedResult.upload.mbps : '—' }}</span><span class="unit">Mbps</span></div>
              <div class="big"><span class="lbl">{{ t('Latency') }}</span><span class="num">{{ speedResult.latency ? speedResult.latency.avg : '—' }}</span><span class="unit">ms</span></div>
              <div class="big"><span class="lbl">{{ t('Jitter') }}</span><span class="num">{{ speedResult.latency && speedResult.latency.jitter != null ? speedResult.latency.jitter : '—' }}</span><span class="unit">ms</span></div>
            </div>
            <!-- The line as it is drawn: an average at the end hides the
                 ramp-up, a stall, or a line that fades under load. -->
            <div class="speed-graph" v-if="speedLive.running || speedLive.down.length || speedLive.up.length">
              <div class="speed-graph-head">
                <strong>{{ t('Speed over time') }}</strong>
                <span class="dim tiny" v-if="speedLive.running && !speedLive.down.length && !speedLive.up.length">{{ t('Starting…') }}</span>
                <span class="spacer"></span>
                <span class="dim tiny mono" v-if="speedLive.down.length">↓ {{ speedLive.down[speedLive.down.length - 1].mbps }} Mbps</span>
                <span class="dim tiny mono" v-if="speedLive.up.length">↑ {{ speedLive.up[speedLive.up.length - 1].mbps }} Mbps</span>
              </div>
              <canvas ref="speedCanvas" class="speed-canvas"></canvas>
            </div>
            <p class="hint danger" v-if="speedResult && (speedResult.downloadError || speedResult.uploadError)">⚠ {{ speedResult.downloadError || speedResult.uploadError }}</p>
          </div>

          <div class="card">
            <div class="bench-head"><h3>{{ t('LAN throughput (iperf3)') }}</h3></div>
            <template v-if="hasTool('iperf3')">
              <div class="tool-row">
                <input v-model="iperfHost" :placeholder="t('Address of a machine running: iperf3 -s')" @keyup.enter="runIperf">
                <input v-model.number="iperfPort" class="tiny" type="number">
                <select v-model.number="iperfSeconds" class="tiny">
                  <option :value="5">5s</option><option :value="10">10s</option><option :value="30">30s</option>
                </select>
                <label class="inline-check"><input type="checkbox" v-model="iperfReverse"> {{ t('Reverse') }}</label>
                <button class="btn primary" :disabled="busy.iperf" :class="{working: busy.iperf}" @click="runIperf">{{ busy.iperf ? t('Measuring…') : t('Run') }}</button>
              </div>
              <div class="bench-results" v-if="iperfResult && !iperfResult.error">
                <div class="big"><span class="lbl">{{ t('Sent') }}</span><span class="num">{{ iperfResult.sentMbps }}</span><span class="unit">Mbps</span></div>
                <div class="big"><span class="lbl">{{ t('Received') }}</span><span class="num">{{ iperfResult.receivedMbps }}</span><span class="unit">Mbps</span></div>
                <div class="big" v-if="iperfResult.retransmits != null"><span class="lbl">{{ t('Retransmits') }}</span><span class="num">{{ iperfResult.retransmits }}</span><span class="unit"></span></div>
              </div>
              <svg class="spark tall" v-if="iperfResult && iperfResult.intervals && iperfResult.intervals.length" viewBox="0 0 300 60" preserveAspectRatio="none">
                <polyline class="sp-rx" :points="spark(iperfResult.intervals.map(i => i.mbps))"></polyline>
              </svg>
              <p class="hint danger" v-if="iperfResult && iperfResult.error">⚠ {{ iperfResult.error }}</p>
            </template>
            <div v-else class="missing">
              <p>{{ t('An internet speed test measures the internet. To measure the local link you need iperf3 on this server and on one other machine.') }}</p>
              <pre class="raw">{{ installFor('iperf3') }}</pre>
            </div>
          </div>

          <div class="card">
            <div class="bench-head">
              <h3>{{ t('DNS resolver comparison') }}</h3>
              <span class="spacer"></span>
              <button class="btn primary" :disabled="busy.dnsbench" :class="{working: busy.dnsbench}" @click="runDnsBench">{{ busy.dnsbench ? t('Measuring…') : t('Compare') }}</button>
            </div>
            <p class="hint">{{ t('Each resolver is asked for the same names, and the times are compared. The resolver this server uses is included.') }}</p>
            <table class="grid compact" v-if="dnsBench">
              <thead><tr><th>{{ t('Resolver') }}</th><th>{{ t('Median') }}</th><th>{{ t('Average') }}</th><th>{{ t('Jitter') }}</th><th>{{ t('Answered') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in dnsBench.resolvers" :key="r.resolver" :class="{winner: r.resolver===dnsBench.fastest}">
                  <td class="mono">{{ r.resolver }} <span class="dim">{{ t(r.name) }}</span> <span v-if="r.resolver===dnsBench.fastest" class="badge">{{ t('fastest') }}</span></td>
                  <td class="mono">{{ r.median != null ? r.median + ' ms' : '—' }}</td>
                  <td class="mono dim">{{ r.avg != null ? r.avg + ' ms' : '—' }}</td>
                  <td class="mono dim">{{ r.jitter != null ? r.jitter : '—' }}</td>
                  <td class="mono dim">{{ r.answered }} / {{ r.queries }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="bench-head"><h3>{{ t('Where the time goes') }}</h3></div>
            <div class="tool-row">
              <input v-model="timingUrl" placeholder="https://example.com" @keyup.enter="runTiming">
              <button class="btn primary" :disabled="busy.timing" :class="{working: busy.timing}" @click="runTiming">{{ t('Measure') }}</button>
            </div>
            <template v-if="timingResult">
              <div class="kv">
                <div><span>{{ t('Status') }}</span><code>{{ timingResult.status }}<span v-if="timingResult.location" class="dim"> → {{ timingResult.location }}</span></code></div>
                <div><span>{{ t('Server address') }}</span><code>{{ timingResult.ip }}:{{ timingResult.port }}</code></div>
                <div><span>{{ t('Total') }}</span><code>{{ timingResult.total }} ms</code></div>
              </div>
              <div class="waterfall">
                <div v-for="p in timingResult.phases" :key="p.name" class="wf-row">
                  <span class="wf-name">{{ t(p.name) }}</span>
                  <span class="wf-bar"><span :style="{width: barWidth(p.ms, timingResult.total)}"></span></span>
                  <span class="wf-ms mono">{{ p.ms }} ms</span>
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- ============ subnet ============ -->
        <section v-if="tab==='subnet'">
          <div class="card tool-card">
            <h3>{{ t('What does this network cover?') }}</h3>
            <p class="dim">{{ t('An address and a prefix in, and out come the network and broadcast addresses, the usable range, and how many hosts fit.') }}</p>
            <div class="tool-row">
              <select class="pick" :title="t('Pick one NetBase already knows')" @change="pickIntoAddress('calcAddress', $event)">
                <option value="">{{ t('Choose…') }}</option>
                <optgroup v-for="g in networkChoices" :key="g.label" :label="t(g.label)">
                  <option v-for="o in g.items" :key="o.value" :value="o.value">{{ o.text }}</option>
                </optgroup>
              </select>
              <span class="ip-boxes" v-if="!subnetFreeText">
                <template v-for="(part, i) in calcAddress.octets" :key="i">
                  <input class="ip-box" :value="part" maxlength="3" inputmode="numeric" spellcheck="false"
                         autocomplete="off" data-group="calc" :data-col="i" :aria-label="t('Address') + ' ' + (i + 1)"
                         @input="typeOctet(calcAddress, i, $event)" @keydown="octetKey(calcAddress, 'calc', i, $event, runSubnet)"
                         @paste="pasteAddress(calcAddress, $event)" @focus="$event.target.select()">
                  <span v-if="i < 3" class="ip-dot">.</span>
                </template>
                <span class="ip-slash">/</span>
                <select v-model.number="calcAddress.prefix" class="ip-prefix" :aria-label="t('Prefix')">
                  <option v-for="p in prefixes" :key="p" :value="p">{{ p }}</option>
                </select>
              </span>
              <input v-else v-model="subnetInput" placeholder="2001:db8::1/64" @keyup.enter="runSubnet">
              <button class="btn primary" @click="runSubnet">{{ t('Calculate') }}</button>
            </div>
            <label class="fl-check"><input type="checkbox" v-model="subnetFreeText">
              <span>{{ t('Type it myself (IPv6, or a mask like 255.255.255.0)') }}</span></label>
          </div>
          <div class="card" v-if="subnetResult">
            <div class="kv">
              <div v-for="(v,k) in subnetResult" :key="k"><span>{{ t(fieldLabel(k)) }}</span><code>{{ v }}</code></div>
            </div>
          </div>
          <div class="card tool-card">
            <h3>{{ t('Split into smaller networks') }}</h3>
            <p class="dim">{{ t('One network in, and the equal parts it divides into — with the range and host count of each.') }}</p>
            <div class="tool-row">
              <span class="ip-boxes">
                <template v-for="(part, i) in splitAddress.octets" :key="i">
                  <input class="ip-box" :value="part" maxlength="3" inputmode="numeric" spellcheck="false"
                         autocomplete="off" data-group="split" :data-col="i" :aria-label="t('Network') + ' ' + (i + 1)"
                         @input="typeOctet(splitAddress, i, $event)" @keydown="octetKey(splitAddress, 'split', i, $event, runSplit)"
                         @paste="pasteAddress(splitAddress, $event)" @focus="$event.target.select()">
                  <span v-if="i < 3" class="ip-dot">.</span>
                </template>
                <span class="ip-slash">/</span>
                <select v-model.number="splitAddress.prefix" class="ip-prefix" :aria-label="t('Prefix')">
                  <option v-for="p in prefixes" :key="p" :value="p">{{ p }}</option>
                </select>
              </span>
              <span class="dim">{{ t('into') }}</span>
              <span class="ip-slash">/</span>
              <select v-model.number="splitPrefix" class="ip-prefix" :aria-label="t('Into networks of')">
                <option v-for="p in splitPrefixes" :key="p" :value="p">{{ p }}</option>
              </select>
              <button class="btn" :disabled="busy.split" :class="{working: busy.split}" @click="runSplit">{{ t('Split') }}</button>
            </div>
            <table class="grid compact" v-if="splitResult">
              <thead><tr><th>{{ t('Network') }}</th><th>{{ t('First host') }}</th><th>{{ t('Last host') }}</th><th>{{ t('Broadcast') }}</th><th>{{ t('Hosts') }}</th></tr></thead>
              <tbody><tr v-for="(n,i) in splitResult.subnets" :key="i"><td class="mono">{{ n.cidr }}</td><td class="mono dim">{{ n.firstHost }}</td><td class="mono dim">{{ n.lastHost }}</td><td class="mono dim">{{ n.broadcast }}</td><td class="mono">{{ n.hosts }}</td></tr></tbody>
            </table>
          </div>

          <div class="card tool-card">
            <h3>{{ t('Combine addresses into the fewest networks') }}</h3>
            <p class="dim">{{ t('Add a row for each network you have. NetBase works out the smallest set of blocks that covers them all — the shortest firewall rule that still means the same thing.') }}</p>
            <template v-if="!aggregateFreeText">
              <div class="ip-row" v-for="(row, r) in ipRows" :key="r">
                <span class="ip-boxes">
                  <template v-for="(part, i) in row.octets" :key="i">
                    <input class="ip-box" :value="part" maxlength="3" inputmode="numeric" spellcheck="false"
                           autocomplete="off" :data-group="'agg' + r" :data-col="i"
                           :aria-label="t('Network') + ' ' + (r + 1) + ' — ' + (i + 1)"
                           @input="typeOctet(row, i, $event)" @keydown="octetKey(row, 'agg' + r, i, $event, runAggregate)"
                           @paste="pasteAddress(row, $event)" @focus="$event.target.select()">
                    <span v-if="i < 3" class="ip-dot">.</span>
                  </template>
                  <span class="ip-slash">/</span>
                  <select v-model.number="row.prefix" class="ip-prefix" :aria-label="t('Prefix')">
                    <option v-for="p in prefixes" :key="p" :value="p">{{ p }}</option>
                  </select>
                </span>
                <button class="btn xs" :title="t('Add a row below')" @click="addIpRow(r)">＋</button>
                <button class="btn xs" :disabled="ipRows.length < 2" :title="t('Remove this row')" @click="removeIpRow(r)">−</button>
              </div>
            </template>
            <textarea v-else v-model="aggregateInput" rows="3" class="mono tiny" :placeholder="t('192.168.1.0/24, 10.0.0.5, 10.0.0.8-10.0.0.20, 2001:db8::/48')"></textarea>
            <div class="tool-row">
              <button class="btn" :disabled="busy.aggregate" :class="{working: busy.aggregate}" @click="runAggregate">{{ t('Combine') }}</button>
              <label class="fl-check"><input type="checkbox" v-model="aggregateFreeText">
                <span>{{ t('Type them myself (ranges, IPv6)') }}</span></label>
            </div>
            <div class="kv" v-if="aggregateResult">
              <div><span>{{ t('Blocks') }}</span><code class="wrap">{{ aggregateResult.blocks.join(', ') }}</code></div>
              <div><span>{{ t('Ranges') }}</span><code class="wrap">{{ aggregateResult.ranges.join(', ') }}</code></div>
              <div><span>{{ t('Addresses covered') }}</span><code>{{ aggregateResult.addresses }}</code></div>
            </div>
          </div>

          <div class="card tool-card">
            <h3>{{ t('Whose equipment is this?') }}</h3>
            <p class="dim">{{ t('The first half of a MAC address says who made the device. NetBase looks it up in the bundled IEEE registry, so nothing leaves this server.') }}</p>
            <p class="dim">{{ t('Colons and hyphens are optional; six hex digits are enough.') }}</p>
            <div class="tool-row">
              <!-- One box, taken as it comes: written with colons, with hyphens,
                   in fours, or as bare hex. Six hex digits name the vendor, so
                   the lookup happens as soon as that many have been typed. -->
              <input v-model="macInput" class="mac-input" placeholder="84:af:ec:85:7a:e0"
                     inputmode="text" spellcheck="false" autocomplete="off"
                     :aria-label="t('MAC address')" @keyup.enter="runMac">
              <button class="btn" :disabled="!macReady" @click="runMac">{{ t('Identify vendor') }}</button>
            </div>
            <div class="kv" v-if="macResult">
              <div><span>{{ t('Vendor') }}</span><code>{{ macResult.vendor || (macResult.local ? t('Randomised (privacy) address') : t('Not registered')) }}</code></div>
              <div><span>{{ t('Prefix') }}</span><code>{{ macResult.prefix }}</code></div>
            </div>
          </div>
        </section>

        <!-- ============ server ============ -->

        <!-- ============ mail ============ -->
        <section v-if="tab==='mail'">
          <div class="card tool-card">
            <div class="seg">
              <button v-for="v in mailViews" :key="v.id" class="seg-btn" :class="{active: mailView===v.id}" @click="mailView=v.id">{{ t(v.label) }}</button>
            </div>
          </div>

          <template v-if="mailView==='domain'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="mailDomain" :placeholder="t('example.com')" @keyup.enter="runMailAudit">
                <input v-model="mailSelectors" class="short" :placeholder="t('DKIM selectors, comma separated')">
                <button class="btn primary" :disabled="busy.mailAudit" :class="{working: busy.mailAudit}" @click="runMailAudit">{{ busy.mailAudit ? t('Checking…') : t('Check this domain') }}</button>
              </div>
              <label class="opt"><input type="checkbox" v-model="mailBlocklists"> {{ t('Also ask the public blocklists about each MX address') }}</label>
              <p class="dim">{{ t('Reads only public DNS and, for MTA-STS, one HTTPS file. Nothing is sent to your servers.') }}</p>
            </div>

            <div class="card" v-if="mailAudit">
              <h3>{{ t('What this domain looks like to a receiving mail server') }}</h3>
              <div class="score">
                <span class="pill bad" v-if="mailAudit.score.bad">{{ mailAudit.score.bad }} {{ t('to fix') }}</span>
                <span class="pill warn" v-if="mailAudit.score.warn">{{ mailAudit.score.warn }} {{ t('to look at') }}</span>
                <span class="pill ok" v-if="mailAudit.score.ok">{{ mailAudit.score.ok }} {{ t('fine') }}</span>
              </div>
              <div v-for="(f,i) in mailAudit.findings" :key="i" class="finding" :class="f.level">
                <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span>
                <div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
              </div>
            </div>

            <div class="card" v-if="mailAudit && mailAudit.mx.length">
              <h3>{{ t('Mail exchangers') }}</h3>
              <table class="grid compact">
                <thead><tr><th>{{ t('Priority') }}</th><th>{{ t('Host') }}</th><th>{{ t('Address') }}</th><th>{{ t('Reverse name') }}</th><th>DANE</th></tr></thead>
                <tbody>
                  <template v-for="m in mailAudit.mx" :key="m.host">
                    <tr v-for="(a,j) in (m.addresses.length ? m.addresses : [{}])" :key="m.host + j">
                      <td class="mono">{{ j === 0 ? m.priority : '' }}</td>
                      <td class="mono">{{ j === 0 ? m.host : '' }}</td>
                      <td class="mono">{{ a.ip || '—' }}</td>
                      <td class="mono wrap">{{ a.ptr || '—' }} <span v-if="a.ptr" class="pill" :class="a.fcrdns ? 'ok' : 'no'">{{ a.fcrdns ? t('confirmed') : t('not confirmed') }}</span></td>
                      <td><span v-if="j === 0" class="pill" :class="(mailAudit.dane[m.host]||[]).length ? 'ok' : 'no'">{{ (mailAudit.dane[m.host]||[]).length ? t('TLSA published') : t('none') }}</span></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <div class="card" v-if="mailAudit">
              <h3>{{ t('Published policies') }}</h3>
              <div class="kv">
                <div><span>SPF</span><code class="wrap">{{ mailAudit.spf ? mailAudit.spf.record : t('not published') }}</code></div>
                <div v-if="mailAudit.spf"><span>{{ t('SPF lookups') }}</span><code>{{ mailAudit.spf.lookups }} / 10</code></div>
                <div><span>DMARC</span><code class="wrap">{{ mailAudit.dmarc ? mailAudit.dmarc.record : t('not published') }}</code></div>
                <div><span>MTA-STS</span><code class="wrap">{{ mailAudit.mtaSts ? mailAudit.mtaSts.record : t('not published') }}</code></div>
                <div><span>TLS-RPT</span><code class="wrap">{{ mailAudit.tlsRpt || t('not published') }}</code></div>
                <div><span>BIMI</span><code class="wrap">{{ mailAudit.bimi || t('not published') }}</code></div>
              </div>
              <details v-if="mailAudit.mtaSts && mailAudit.mtaSts.policy"><summary>{{ t('MTA-STS policy file') }}</summary><pre class="raw">{{ mailAudit.mtaSts.policy }}</pre></details>
              <h3 v-if="mailAudit.dkim.length">{{ t('DKIM keys') }}</h3>
              <table class="grid compact" v-if="mailAudit.dkim.length">
                <thead><tr><th>{{ t('Selector') }}</th><th>{{ t('Key size') }}</th><th>{{ t('Record') }}</th></tr></thead>
                <tbody><tr v-for="k in mailAudit.dkim" :key="k.selector"><td class="mono">{{ k.selector }}</td><td class="mono">{{ k.bits ? k.bits + ' bit' : '—' }}</td><td class="mono wrap tiny">{{ k.record }}</td></tr></tbody>
              </table>
              <h3 v-if="mailAudit.srv.length">{{ t('Client autoconfiguration records') }}</h3>
              <table class="grid compact" v-if="mailAudit.srv.length">
                <thead><tr><th>{{ t('Record') }}</th><th>{{ t('Target') }}</th><th>{{ t('Port') }}</th></tr></thead>
                <tbody><tr v-for="(s,i) in mailAudit.srv" :key="i"><td class="mono">{{ s.name }}</td><td class="mono">{{ s.target }}</td><td class="mono">{{ s.port }}</td></tr></tbody>
              </table>
            </div>

            <div class="card" v-if="mailAudit && Object.keys(mailAudit.blocklists).length">
              <h3>{{ t('Blocklists') }}</h3>
              <div v-for="(rows, ip) in mailAudit.blocklists" :key="ip" class="bl-group">
                <strong class="mono">{{ ip }}</strong>
                <div class="chips result">
                  <span v-for="r in rows" :key="r.zone" class="pill" :class="r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')" :title="r.reason || r.zone">{{ r.name }}</span>
                </div>
              </div>
              <p class="dim">{{ t('Grey means the list refused the query — that usually means this server asks a public resolver, not that the address is clean.') }}</p>
            </div>
          </template>

          <template v-if="mailView==='server'">
            <div class="card tool-card">
              <div class="tool-row">
                <input v-model="mailHost" :placeholder="t('mail.example.com')" @keyup.enter="runMailProbe">
                <select v-model="mailProtocol" class="short">
                  <option value="smtp">SMTP</option><option value="imap">IMAP</option><option value="pop3">POP3</option>
                </select>
                <select v-model="mailMode" class="short">
                  <option value="auto">{{ t('Pick automatically') }}</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="tls">SSL/TLS</option>
                  <option value="none">{{ t('No encryption') }}</option>
                </select>
                <input v-model.number="mailPort" type="number" min="0" max="65535" class="tiny" :placeholder="t('Port')">
                <button class="btn primary" :disabled="busy.mailProbe" :class="{working: busy.mailProbe}" @click="runMailProbe">{{ t('Test the server') }}</button>
              </div>
              <div class="chips">
                <button class="btn xs" v-for="p in mailPresets" :key="p.label" @click="applyMailPreset(p)">{{ p.label }}</button>
              </div>
            </div>

            <div class="card" v-if="mailProbeResult">
              <p v-if="mailProbeResult.error" class="empty-hint">⚠ {{ mailProbeResult.error }}</p>
              <div v-for="(f,i) in mailProbeResult.findings" :key="i" class="finding" :class="f.level">
                <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span>
                <div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
              </div>
              <div class="kv">
                <div><span>{{ t('Greeting') }}</span><code class="wrap">{{ mailProbeResult.greeting }}</code></div>
                <div v-if="mailProbeResult.tls"><span>{{ t('Encryption') }}</span><code>{{ mailProbeResult.tls.protocol }} · {{ mailProbeResult.tls.cipher }}</code></div>
                <div v-if="mailProbeResult.tls && mailProbeResult.tls.subject"><span>{{ t('Certificate') }}</span><code class="wrap">{{ mailProbeResult.tls.subject }} · {{ t('issued by') }} {{ mailProbeResult.tls.issuer }} · {{ t('{n} days left', {n: mailProbeResult.tls.expiresIn}) }}</code></div>
                <div v-if="(mailProbeResult.auth||[]).length"><span>{{ t('Sign-in methods') }}</span><code>{{ (mailProbeResult.auth||[]).join(', ') }}</code></div>
                <div><span>{{ t('Time taken') }}</span><code>{{ mailProbeResult.seconds }} s</code></div>
              </div>
              <details><summary>{{ t('Capabilities') }}</summary><pre class="raw">{{ capabilityText(mailProbeResult.capabilities) }}</pre></details>
              <details><summary>{{ t('Conversation') }}</summary><pre class="raw">{{ (mailProbeResult.transcript||[]).join('\n') }}</pre></details>
            </div>

            <div class="card tool-card">
              <h3>{{ t('Open relay test') }}</h3>
              <p class="dim">{{ t('Offers the server a foreign sender and a foreign recipient and stops before anything is sent. Run it against your own server.') }}</p>
              <div class="tool-row">
                <input v-model="relayHost" :placeholder="t('mail.example.com')">
                <input v-model.number="relayPort" type="number" class="tiny" min="1" max="65535">
                <button class="btn" :disabled="busy.relay" :class="{working: busy.relay}" @click="runRelay">{{ t('Test for open relay') }}</button>
              </div>
              <div v-if="relayResult">
                <div v-for="(f,i) in relayResult.findings" :key="i" class="finding" :class="f.level">
                  <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
                </div>
                <p v-if="relayResult.error" class="empty-hint">⚠ {{ relayResult.error }}</p>
                <details v-if="relayResult.transcript"><summary>{{ t('Conversation') }}</summary><pre class="raw">{{ relayResult.transcript.join('\n') }}</pre></details>
              </div>
            </div>

            <div class="card tool-card">
              <h3>{{ t('Blocklist lookup') }}</h3>
              <div class="tool-row">
                <input v-model="blIp" :placeholder="t('IPv4 address of a sending server')" @keyup.enter="runBlocklist">
                <button class="btn" :disabled="busy.bl" :class="{working: busy.bl}" @click="runBlocklist">{{ t('Check') }}</button>
              </div>
              <div class="chips result" v-if="blResult">
                <span v-for="r in blResult.results" :key="r.zone" class="pill" :class="r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')" :title="r.reason || r.zone">{{ r.name }}</span>
              </div>
            </div>
          </template>

          <template v-if="mailView==='send'">
            <!-- One address is one account: it is read with IMAP or POP3 and
                 sent through SMTP, but it is the same person with the same
                 password. So it is chosen once, on one card, and both halves
                 are tested from there. -->
            <div class="card tool-card">
              <h3>{{ t('Send and receive test') }}</h3>
              <p class="dim">{{ t('One mail account, both directions: sign in to the mailbox, and send a real message through the same account.') }}</p>
              <div class="tool-row">
                <div class="seg">
                  <button class="seg-btn" :class="{active: acctMode === 'type'}" @click="setAcctMode('type')">{{ t('Enter it by hand') }}</button>
                  <button class="seg-btn" :class="{active: acctMode === 'saved'}" @click="setAcctMode('saved')">{{ t('Pick from the list') }}</button>
                </div>
                <span class="spacer"></span>
                <button class="btn sm" @click="openConn(null, mailAdhoc.kind)">{{ t('+ Add connection') }}</button>
                <button class="btn sm" v-if="mailAccountSaved" @click="openConn(mailAccountSaved)">{{ t('Edit') }}</button>
              </div>
              <template v-if="acctMode === 'saved' && connLocked">
                <p class="note-line">{{ t('Please enter the RegiBase master key.') }}</p>
                <div class="fl-row">
                  <input v-model="connMaster" type="password" class="grow mono" autocomplete="new-password" :placeholder="t('RegiBase master key')" @keyup.enter="unlockConns()">
                  <button class="btn sm" :disabled="!connMaster || busy.connsetup" @click="unlockConns()">{{ t('Unlock') }}</button>
                </div>
                <p class="dim tiny">{{ t('This key lasts until you close the browser — this session only.') }}</p>
              </template>
              <div class="tool-row" v-else-if="acctMode === 'saved'">
                <select v-model.number="mailAccountId" class="grow">
                  <option :value="0">{{ t('Not chosen yet') }}</option>
                  <optgroup v-if="mailAccounts.length" :label="t('Saved connections')">
                    <option v-for="c in mailAccounts" :key="c.id" :value="c.id">{{ c.name }} — {{ c.kind.toUpperCase() }} {{ c.host }}</option>
                  </optgroup>
                </select>
              </div>
              <p class="dim tiny" v-if="acctMode === 'saved' && !connLocked && !mailAccounts.length">{{ t('No saved connections yet — enter the address by hand instead.') }}</p>

              <template v-if="acctMode === 'type'">
                <p class="dim tiny">{{ t('Where this address is read') }}</p>
                <div class="tool-row">
                  <select v-model="mailAdhoc.kind" class="tiny" @change="mailKindChanged">
                    <option value="imap">IMAP</option>
                    <option value="pop3">POP3</option>
                    <option value="smtp">{{ t('SMTP only (no mailbox)') }}</option>
                  </select>
                  <input v-model="mailAdhoc.host" class="grow" placeholder="imap.example.com">
                  <input v-model.number="mailAdhoc.port" type="number" class="tiny" min="1" max="65535">
                  <select v-model="mailAdhoc.mode" class="tiny">
                    <option value="tls">SSL/TLS</option>
                    <option value="starttls">STARTTLS</option>
                    <option value="none">{{ t('No encryption') }}</option>
                  </select>
                  <input v-model="mailAdhoc.username" class="short" :placeholder="t('User name')" autocomplete="off">
                  <input v-model="mailAdhoc.secret" type="password" class="short" :placeholder="t('Password')" autocomplete="new-password">
                </div>
                <p class="dim tiny" v-if="mailAdhoc.kind !== 'smtp'">{{ t('Where it sends from — the same user name and password') }}</p>
                <div class="tool-row" v-if="mailAdhoc.kind !== 'smtp'">
                  <input v-model="mailAdhoc.sendHost" class="grow" placeholder="smtp.example.com">
                  <input v-model.number="mailAdhoc.sendPort" type="number" class="tiny" min="1" max="65535">
                  <select v-model="mailAdhoc.sendMode" class="tiny">
                    <option value="starttls">STARTTLS</option>
                    <option value="tls">SSL/TLS</option>
                    <option value="none">{{ t('No encryption') }}</option>
                  </select>
                  <input v-model="mailAdhoc.from" class="short" :placeholder="t('Sender address')">
                  <button class="btn sm" @click="saveMailAdhoc()">{{ t('Save to the list') }}</button>
                </div>
                <div class="tool-row" v-else>
                  <input v-model="mailAdhoc.from" class="short" :placeholder="t('Sender address')">
                  <button class="btn sm" @click="saveMailAdhoc()">{{ t('Save to the list') }}</button>
                </div>
              </template>

              <h3>{{ t('Receive') }}</h3>
              <div class="tool-row">
                <button class="btn" :disabled="busy.mailbox || !mailCanReceive || (acctMode === 'saved' ? !mailAccountId : !mailAdhoc.host)" :class="{working: busy.mailbox}" @click="runMailbox">{{ t('Sign in to the mailbox') }}</button>
                <span class="dim tiny" v-if="!mailCanReceive">{{ t('An SMTP-only connection has no mailbox to read.') }}</span>
              </div>
              <div v-if="mailboxResult" class="kv">
                <div><span>{{ t('Result') }}</span><code :class="mailboxResult.ok ? 'good' : 'bad'">{{ mailboxResult.ok ? t('Signed in') : (mailboxResult.error || t('Failed')) }}</code></div>
                <div v-if="mailboxResult.details && mailboxResult.details.inbox"><span>{{ t('Inbox') }}</span><code>{{ t('{n} messages', {n: mailboxResult.details.inbox.messages}) }} · {{ t('{n} unread', {n: mailboxResult.details.inbox.unseen}) }}</code></div>
                <div v-if="mailboxResult.details && mailboxResult.details.mailbox"><span>{{ t('Mailbox') }}</span><code>{{ t('{n} messages', {n: mailboxResult.details.mailbox.messages}) }}</code></div>
                <div v-if="mailboxResult.details && mailboxResult.details.folders"><span>{{ t('Folders') }}</span><code class="wrap">{{ mailboxResult.details.folders.join(', ') }}</code></div>
              </div>

              <h3>{{ t('Send') }}</h3>
              <div class="tool-row">
                <input v-model="sendTo" :placeholder="t('Recipient address')">
                <input v-model="sendSubject" :placeholder="t('Subject (optional)')">
              </div>
              <textarea v-model="sendBody" rows="3" :placeholder="t('Message (optional)')"></textarea>
              <div class="tool-row">
                <button class="btn primary" :disabled="busy.send || !sendTo || (acctMode === 'saved' ? !mailAccountId : !mailAdhoc.host)" :class="{working: busy.send}" @click="runSend">{{ busy.send ? t('Sending…') : t('Send the test message') }}</button>
              </div>
              <div v-if="sendResult" class="kv">
                <div><span>{{ t('Result') }}</span><code :class="sendResult.ok ? 'good' : 'bad'">{{ sendResult.ok ? t('Accepted by the server') : (sendResult.error || t('Failed')) }}</code></div>
                <div v-if="sendResult.reply"><span>{{ t('Reply') }}</span><code class="wrap">{{ sendResult.reply }}</code></div>
              </div>
              <details v-if="sendResult && sendResult.transcript"><summary>{{ t('Conversation') }}</summary><pre class="raw">{{ sendResult.transcript.join('\n') }}</pre></details>
            </div>
          </template>
        </section>

        <!-- ============ clock check ============ -->
        <section v-if="tab==='ntp'">
          <div class="card tool-card">
            <h3>{{ t('Clock check (NTP)') }}</h3>
            <p class="dim">{{ t('A clock that has drifted is behind more certificate and sign-in failures than anything else.') }}</p>
            <div class="tool-row">
              <select v-model="ntpHost" class="short">
                <option v-for="s in ntpServers" :key="s.host" :value="s.host">{{ s.host }} — {{ s.label }}</option>
              </select>
              <input v-model="ntpHost" :placeholder="t('pool.ntp.org')" @keyup.enter="runNtp">
              <button class="btn" :disabled="busy.ntp" :class="{working: busy.ntp}" @click="runNtp">{{ t('Compare clocks') }}</button>
            </div>
            <p class="dim tiny">{{ t('Pick a well-known time server, or type any other.') }}</p>
            <div v-if="ntpResult">
              <div v-for="(f,i) in (ntpResult.findings||[])" :key="i" class="finding" :class="f.level">
                <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
              </div>
              <div class="kv" v-if="ntpResult.ok">
                <div><span>{{ t('Offset') }}</span><code>{{ ntpResult.offsetSeconds }} s</code></div>
                <div><span>{{ t('Round trip') }}</span><code>{{ ntpResult.roundTripMs }} ms</code></div>
                <div><span>{{ t('Stratum') }}</span><code>{{ ntpResult.stratum }}</code></div>
              </div>
              <p v-else class="empty-hint">⚠ {{ ntpResult.error }}</p>
            </div>
          </div>
        </section>

        <!-- ============ FTP / SFTP / SCP ============ -->
        <section v-if="tab==='files'">
          <!-- The same shape as the SSH screen, in the same order: the choice
               first, then the server, then what you do with it, all in one
               card. Two screens doing the same job asked for it two different
               ways, which is a thing to fix rather than to explain. -->
          <div class="card tool-card">
            <div class="tool-row">
              <div class="seg">
                <button class="seg-btn" :class="{active: filesMode === 'type'}" @click="setFilesMode('type')">{{ t('Enter it by hand') }}</button>
                <button class="seg-btn" :class="{active: filesMode === 'saved'}" @click="setFilesMode('saved')">{{ t('Pick from the list') }}</button>
              </div>
              <span class="spacer"></span>
              <button class="btn sm" @click="openConn(null, filesKind)">{{ t('+ Add connection') }}</button>
              <button class="btn sm" v-if="filesSaved" @click="openConn(filesSaved)">{{ t('Edit') }}</button>
              <button class="btn sm" v-if="filesSaved" :disabled="busy.conntest" :class="{working: busy.conntest}" @click="testConn(filesSaved)">{{ t('Test') }}</button>
            </div>

            <template v-if="filesMode === 'saved' && connLocked">
              <p class="note-line">{{ t('Please enter the RegiBase master key.') }}</p>
              <div class="fl-row">
                <input v-model="connMaster" type="password" class="grow mono" autocomplete="new-password" :placeholder="t('RegiBase master key')" @keyup.enter="unlockConns()">
                <button class="btn sm" :disabled="!connMaster || busy.connsetup" @click="unlockConns()">{{ t('Unlock') }}</button>
              </div>
              <p class="dim tiny">{{ t('This key lasts until you close the browser — this session only.') }}</p>
            </template>
            <div class="tool-row" v-else-if="filesMode === 'saved'">
              <select v-model="filesKind" class="tiny" @change="filesKindPicked">
                <option value="sftp">SFTP</option>
                <option value="scp" v-if="connCaps.scp">SCP</option>
                <option value="ftp">FTP</option>
              </select>
              <select v-model="filesPick" class="grow" @change="filesPicked">
                <option value="">{{ t('Not chosen yet') }}</option>
                <optgroup v-if="fileConnections.length" :label="t('Saved connections')">
                  <option v-for="c in fileConnections" :key="'c' + c.id" :value="'c' + c.id">{{ c.name }} — {{ c.kind.toUpperCase() }} {{ c.host }}</option>
                </optgroup>
                <optgroup v-for="g in hostChoices" :key="g.label" :label="t(g.label)">
                  <option v-for="o in g.items" :key="o.value" :value="o.value">{{ o.text }}</option>
                </optgroup>
              </select>
            </div>
            <p class="dim tiny" v-if="filesMode === 'saved' && !connLocked && !fileConnections.length && !hostChoices.length">{{ t('No saved connections yet — enter the address by hand instead.') }}</p>

            <div class="tool-row" v-if="filesMode === 'type'">
              <select v-model="filesKind" class="tiny" @change="filesKindPicked">
                <option value="sftp">SFTP</option>
                <option value="scp" v-if="connCaps.scp">SCP</option>
                <option value="ftp">FTP</option>
              </select>
              <input v-model="adhoc.host" class="grow" placeholder="server.example.com" @keyup.enter="quickConnect">
              <input v-model.number="adhoc.port" type="number" class="tiny" min="1" max="65535">
              <input v-model="adhoc.username" class="short" :placeholder="t('User name')" autocomplete="off">
            </div>
            <div class="tool-row" v-else-if="filesSaved">
              <strong class="mono">{{ filesSaved.kind.toUpperCase() }} {{ filesSaved.username || t('anonymous') }}@{{ filesSaved.host }}:{{ filesSaved.port }}</strong>
              <span class="dim tiny">{{ t('Signs in with the password or key kept for it.') }}</span>
            </div>

            <div class="tool-row" v-if="filesMode === 'type'">
              <select v-model="adhoc.authType" class="tiny" v-if="adhoc.kind!=='ftp'">
                <option value="password">{{ t('Password') }}</option>
                <option value="key">{{ t('Private key') }}</option>
              </select>
              <select v-model="adhoc.mode" class="tiny" v-if="adhoc.kind==='ftp'">
                <option value="none">{{ t('No encryption') }}</option>
                <option value="tls">SSL/TLS</option>
              </select>
              <template v-if="adhoc.authType==='key' && adhoc.kind!=='ftp'">
                <input v-model="adhoc.privateKeyPath" class="grow mono" :placeholder="t('Key file in your Nextcloud files')">
                <button class="btn sm" @click="pickFile(t('Choose a key file'), (p) => { adhoc.privateKeyPath = p; }, false, settings.keyFolder)">📂 {{ t('Browse…') }}</button>
              </template>
              <input v-else v-model="adhoc.secret" type="password" class="short" :placeholder="t('Password')" autocomplete="new-password">
              <input v-model="adhoc.path" class="short mono" :placeholder="t('Start folder (optional)')">
              <button class="btn sm" :disabled="!adhoc.host" @click="saveAdhoc">{{ t('Save to the list') }}</button>
            </div>
            <p class="dim tiny" v-if="filesMode === 'type' && adhoc.kind==='ftp' && !adhoc.username">{{ t('Leave the user name blank to sign in anonymously.') }}</p>

            <div class="tool-row">
              <button class="btn primary" :disabled="busy.browse || !filesHostNow" :class="{working: busy.browse}" @click="filesConnect">{{ t('Connect') }}</button>
            </div>
            <p class="dim" v-if="!connCaps.sftp && !connCaps.ftp && !connCaps.scp">{{ t('Neither FTP, SFTP nor SCP is available on this server.') }}</p>
          </div>

          <!-- Only once something was actually opened. Choosing a saved
               connection no longer connects on its own, so "a connection is
               chosen" and "a folder is open" are different things now. -->
          <!-- Two panes: what you have on the left, what the server has on the
               right, and the queue underneath. A file manager that shows only
               the far end leaves you guessing what you are sending; showing
               both is what every FTP client does, and it is what makes
               dragging from one side to the other mean anything. -->
          <div class="card panes" v-if="filesData">
            <div class="pane">
              <div class="pane-head">
                <strong>{{ t('Your Nextcloud files') }}</strong>
                <span class="spacer"></span>
                <button class="btn xs" :disabled="!localData || localData.parent === null" @click="browseLocal(localData ? localData.parent : '')">↑ {{ t('Up') }}</button>
                <button class="btn xs" @click="browseLocal(localPath)">⟳ {{ t('Refresh') }}</button>
              </div>
              <div class="path-bar">
                <input v-model="localPath" class="mono" :placeholder="t('Your Nextcloud files')" @keyup.enter="browseLocal(localPath)">
                <button class="btn xs" @click="browseLocal(localPath)">{{ t('Go') }}</button>
              </div>
              <div class="pane-body"
                   @dragover.prevent="$event.dataTransfer.dropEffect = 'copy'"
                   @drop.prevent="dropOnLocal">
                <table class="grid compact files-grid">
                  <thead>
                    <tr>
                      <th><span class="th-line head" @click="sortLocal('name')" :class="localSortClass('name')">{{ t('Name') }}</span></th>
                      <th><span class="th-line head" @click="sortLocal('size')" :class="localSortClass('size')">{{ t('Size') }}</span></th>
                      <th><span class="th-line head" @click="sortLocal('modified')" :class="localSortClass('modified')">{{ t('Changed') }}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="localData && localData.parent !== null" class="dir up-row" @click="browseLocal(localData.parent)">
                      <td colspan="3"><span class="nm">📁 ..</span></td>
                    </tr>
                    <tr v-for="e in sortedLocal" :key="e.name"
                        :class="{dir: e.directory, picked: !!localPicked[e.name]}"
                        draggable="true"
                        @dragstart="startFileDrag('local', e, $event)"
                        @click="pickRow('local', e, $event)"
                        @dblclick="e.directory ? browseLocal(e.path) : null">
                      <td><span class="nm">{{ e.directory ? '📁' : '📄' }} {{ e.name }}</span></td>
                      <td class="mono dim">{{ e.directory ? '' : fmtBytes(e.size) }}</td>
                      <td class="dim">{{ e.modified ? ago(e.modified) : '' }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="localData && !sortedLocal.length" class="empty-hint">{{ t('This folder is empty.') }}</p>
              </div>
              <div class="pane-foot">
                <button class="btn xs" @click="pickAll('local')">{{ t('Select all') }}</button>
                <span class="dim tiny" v-if="localCount">{{ t('{n} chosen', {n: localCount}) }}</span>
                <span class="spacer"></span>
                <button class="btn sm primary" :disabled="!localCount" @click="enqueue('local')">⤒ {{ t('Send') }}</button>
              </div>
            </div>

            <div class="pane">
              <div class="pane-head">
                <strong class="mono">{{ filesSaved ? filesSaved.host : adhoc.host }}</strong>
                <span class="dim tiny">{{ (filesSaved ? filesSaved.kind : adhoc.kind).toUpperCase() }}</span>
                <span class="spacer"></span>
                <label class="inline-check" v-if="canElevate" :title="t('Runs the listing and the file actions through sudo on the far end. The password is used for that one request and kept nowhere.')">
                  <input type="checkbox" v-model="asRoot" @change="rootToggled()"> {{ t('Act as root') }}
                </label>
                <button class="btn xs" :disabled="!filesData || !filesData.parent" @click="browse(filesData ? filesData.parent : '')">↑ {{ t('Up') }}</button>
                <button class="btn xs" @click="browse(filesData ? filesData.path : filesPath)">⟳ {{ t('Refresh') }}</button>
                <button class="btn xs" @click="fileAction('mkdir')">{{ t('New folder') }}</button>
                <button class="btn xs" v-if="adhocActive" @click="disconnect">{{ t('Disconnect') }}</button>
              </div>
              <div class="path-bar">
                <input v-model="filesPath" class="mono" @keyup.enter="browse(filesPath)">
                <button class="btn xs" @click="browse(filesPath)">{{ t('Go') }}</button>
              </div>
              <p class="note-line" v-if="asRoot && !sudoPassword">
                {{ t('Enter the sudo password for this server. It is used for this one request and is never stored — you will be asked again next time.') }}
              </p>
              <div class="fl-row" v-if="asRoot && !sudoPassword">
                <input v-model="sudoDraft" type="password" class="grow mono" autocomplete="new-password"
                       :placeholder="t('sudo password')" @keyup.enter="useSudo()">
                <button class="btn sm" :disabled="!sudoDraft" @click="useSudo()">{{ t('Use it') }}</button>
                <button class="btn sm" @click="asRoot = false; sudoDraft = ''">{{ t('Cancel') }}</button>
              </div>
              <p class="hint root-on" v-if="asRoot && sudoPassword">
                🔓 {{ t('Acting as root. The password is held only while this page stays open.') }}
                <span class="dim tiny" v-if="rootLeft">{{ t('Given up in {n} min with nothing touched.', {n: rootLeft}) }}</span>
                <button class="btn sm danger" @click="forgetSudo()">{{ t('Give up root now') }}</button>
              </p>
              <div class="pane-body"
                   @dragover.prevent="$event.dataTransfer.dropEffect = 'copy'"
                   @drop.prevent="dropOnRemote">
                <table class="grid compact files-grid">
                  <thead>
                    <tr>
                      <th><span class="th-line head" @click="sortFiles('name')" :class="fileSortClass('name')">{{ t('Name') }}</span></th>
                      <th><span class="th-line head" @click="sortFiles('size')" :class="fileSortClass('size')">{{ t('Size') }}</span></th>
                      <th><span class="th-line head" @click="sortFiles('modified')" :class="fileSortClass('modified')">{{ t('Changed') }}</span></th>
                      <th>{{ t('Rights') }}</th>
                      <th class="c-owner">{{ t('Owner') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="filesData.parent" class="dir up-row" @click="browse(filesData.parent)">
                      <td colspan="5"><span class="nm">📁 ..</span></td>
                    </tr>
                    <tr v-for="e in sortedFiles" :key="e.name"
                        :class="{dir: e.directory, picked: !!remotePicked[e.name]}"
                        draggable="true"
                        @dragstart="startFileDrag('remote', e, $event)"
                        @click="pickRow('remote', e, $event)"
                        @dblclick="openEntry(e)"
                        @contextmenu.prevent="openFileMenu(e, $event)">
                      <td><span class="nm">{{ e.directory ? '📁' : '📄' }} {{ e.name }}</span></td>
                      <td class="mono dim">{{ e.directory ? '' : fmtBytes(e.size) }}</td>
                      <td class="dim">{{ e.modified ? ago(e.modified) : '' }}</td>
                      <td class="mono dim tiny">{{ e.permissions }}</td>
                      <td class="dim tiny c-owner">{{ e.owner || '' }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="filesData && !sortedFiles.length" class="empty-hint">{{ t('This folder is empty.') }}</p>
              </div>
              <div class="pane-foot">
                <button class="btn xs" @click="pickAll('remote')">{{ t('Select all') }}</button>
                <span class="dim tiny" v-if="remoteCount">{{ t('{n} chosen', {n: remoteCount}) }}</span>
                <span class="spacer"></span>
                <button class="btn sm primary" :disabled="!remoteCount" @click="enqueue('remote')">⤓ {{ t('Receive') }}</button>
              </div>
            </div>
          </div>

          <div class="card" v-if="filesData">
            <div class="tool-row">
              <input v-model="filesTarget" class="short mono" :placeholder="t('Nextcloud folder for downloads')">
              <button class="btn sm" @click="pickFile('Choose a folder for downloads', (p) => { filesTarget = p; browseLocal(p); }, true)">📂 {{ t('Browse…') }}</button>
              <label class="inline-check"><input type="checkbox" v-model="showHidden"> {{ t('Show hidden files') }}</label>
              <span class="spacer"></span>
              <span class="dim tiny">{{ t('Double-click a folder to open it. Right-click a row for what can be done with it. Drag between the panes to transfer.') }}</span>
            </div>
          </div>

          <!-- What is being moved, and what has been. A transfer that says
               nothing for a minute is indistinguishable from one that has
               hung, so this says how far along it is, how fast, and how much
               longer — and can be stopped. -->
          <div class="card queue-card" v-if="queue.length || queueDone.length">
            <div class="tool-row">
              <strong>{{ t('Transfers') }}</strong>
              <span class="dim tiny" v-if="queueSummary && queueSummary.waiting">{{ t('{n} waiting', {n: queueSummary.waiting}) }}</span>
              <span class="spacer"></span>
              <button class="btn sm danger" v-if="queue.length" @click="stopQueue">{{ t('Stop') }}</button>
              <button class="btn sm" v-if="queueDone.length" @click="clearQueueDone">{{ t('Clear finished') }}</button>
            </div>
            <div class="job" v-for="j in queue" :key="j.id">
              <span class="ic">{{ j.direction === 'up' ? '⤒' : '⤓' }}</span>
              <span class="nm mono">{{ j.name }}</span>
              <span class="bar"><span class="fill" :style="{ width: jobPercent(j) + '%' }"></span></span>
              <span class="pc mono">{{ jobPercent(j) }}%</span>
              <span class="dim tiny">{{ j.state === 'running' ? jobRate(j) : t('Waiting') }}</span>
            </div>
            <div class="job done" v-for="j in queueDone" :key="'d' + j.id">
              <span class="ic">{{ j.state === 'failed' ? '⚠' : (j.state === 'stopped' ? '⊘' : (j.direction === 'up' ? '⤒' : '⤓')) }}</span>
              <span class="nm mono">{{ j.name }}</span>
              <span class="dim tiny" v-if="j.state === 'failed'">{{ j.error }}</span>
              <span class="dim tiny" v-else-if="j.state === 'stopped'">{{ t('Stopped') }}</span>
              <span class="dim tiny" v-else>{{ fmtBytes(j.done) }}</span>
            </div>
          </div>
        </section>

        <!-- ============ SSH / Telnet / NTP ============ -->
        <section v-if="tab==='ssh'">
          <!-- The page does two different jobs and used to run them together:
               looking at a server, which needs nothing, and working on it,
               which needs an account. Each is now under its own heading, and
               the host typed above is carried down so the two are visibly the
               same machine. -->
          <!-- ============ one server, and what you want to do with it ============
               This was three cards: a probe that needs no account, a box for
               details typed on the spot, and a list of saved connections. Each
               asked for the machine again. Now the machine is named once — from
               the saved list, from the devices NetBase has found, or typed — and
               everything that can be done to it sits underneath. What needs an
               account is still gated on the account: a reader who may probe but
               not sign in sees the top half and nothing more. -->
          <div class="card tool-card">

            <!-- Which way the server is named is a choice, and it is shown as
                 one. It used to be the first entry of the list of saved
                 connections: choosing a saved one made the typing fields
                 vanish, with nothing on screen to say they could come back, so
                 they read as deleted — and Telnet, which is only ever typed in,
                 looked unreachable. -->
            <div class="tool-row">
              <div class="seg">
                <button class="seg-btn" :class="{active: sshMode === 'type'}" @click="setSshMode('type')">{{ t('Enter it by hand') }}</button>
                <button class="seg-btn" :class="{active: sshMode === 'saved'}" @click="setSshMode('saved')">{{ t('Pick from the list') }}</button>
              </div>
              <span class="spacer"></span>
              <button class="btn sm" v-if="allowed('sshexec')" @click="openConn(null,'ssh')">{{ t('+ Add connection') }}</button>
              <button class="btn sm" v-if="allowed('sshexec') && sshSaved" @click="openConn(sshSaved)">{{ t('Edit') }}</button>
            </div>

            <!-- One list, everything in it: the connections saved in RegiBase,
                 the devices NetBase has found, and whatever was asked about
                 last. Splitting it in two — saved here, devices there — was a
                 step backwards; a reader looking for a machine should not have
                 to know which half NetBase filed it under. -->
            <!-- A list you can choose from but cannot connect with is worse
                 than no list: the names are not secret, but the passwords and
                 keys are, so the saved entries were selectable and then failed
                 at the moment of use. The key is asked for here instead. -->
            <template v-if="sshMode === 'saved' && connLocked">
              <p class="note-line">{{ t('Please enter the RegiBase master key.') }}</p>
              <div class="fl-row">
                <input v-model="connMaster" type="password" class="grow mono" autocomplete="new-password" :placeholder="t('RegiBase master key')" @keyup.enter="unlockConns()">
                <button class="btn sm" :disabled="!connMaster || busy.connsetup" @click="unlockConns()">{{ t('Unlock') }}</button>
              </div>
              <p class="dim tiny">{{ t('This key lasts until you close the browser — this session only.') }}</p>
            </template>
            <div class="tool-row" v-else-if="sshMode === 'saved'">
              <select v-model="sshPick" class="grow" @change="sshPicked">
                <option value="">{{ t('Not chosen yet') }}</option>
                <optgroup v-if="sshConnections.length" :label="t('Saved connections')">
                  <option v-for="c in sshConnections" :key="'c' + c.id" :value="'c' + c.id">{{ c.name }} — {{ c.username }}@{{ c.host }}</option>
                </optgroup>
                <optgroup v-for="g in hostChoices" :key="g.label" :label="t(g.label)">
                  <option v-for="o in g.items" :key="o.value" :value="o.value">{{ o.text }}</option>
                </optgroup>
              </select>
            </div>
            <p class="dim tiny" v-if="sshMode === 'saved' && !connLocked && !sshConnections.length && !hostChoices.length">{{ t('No saved connections yet — enter the address by hand instead.') }}</p>

            <div class="tool-row" v-if="sshMode === 'type'">
              <select v-model="sshAdhoc.kind" class="tiny" @change="sshKindChanged()">
                <option value="ssh">SSH</option>
                <option value="telnet">Telnet</option>
              </select>
              <input v-model="sshAdhoc.host" class="grow" :placeholder="t('Host name or IP address')" @keyup.enter="runSsh">
              <input v-model.number="sshAdhoc.port" type="number" class="tiny" min="1" max="65535">
              <template v-if="allowed('sshexec') && sshAdhoc.kind !== 'telnet'">
                <input v-model="sshAdhoc.username" class="short" :placeholder="t('User name')" autocomplete="off">
                <select v-model="sshAdhoc.authType" class="tiny">
                  <option value="password">{{ t('Password') }}</option>
                  <option value="key">{{ t('Private key') }}</option>
                </select>
              </template>
            </div>
            <div class="tool-row" v-else-if="sshSaved">
              <strong class="mono">{{ sshSaved.kind.toUpperCase() }} {{ sshSaved.username }}@{{ sshSaved.host }}:{{ sshSaved.port || 22 }}</strong>
              <span class="dim tiny">{{ t('Signs in with the password or key kept for it.') }}</span>
            </div>

            <div class="tool-row" v-if="sshMode === 'type' && allowed('sshexec') && sshAdhoc.kind !== 'telnet'">
              <template v-if="sshAdhoc.authType === 'key'">
                <input v-model="sshAdhoc.privateKeyPath" class="grow mono" :placeholder="t('Key file in your Nextcloud files')">
                <button class="btn sm" @click="pickFile(t('Choose a key file'), (path) => { sshAdhoc.privateKeyPath = path; }, false, settings.keyFolder)">📂 {{ t('Browse…') }}</button>
                <input v-model="sshAdhoc.passphrase" type="password" class="short" :placeholder="t('Key passphrase (if any)')" autocomplete="new-password">
              </template>
              <input v-else v-model="sshAdhoc.secret" type="password" class="short" :placeholder="t('Password')" autocomplete="new-password">
              <button class="btn sm" :disabled="!sshAdhoc.host" @click="saveSshAdhoc">{{ t('Save to the list') }}</button>
            </div>

            <p class="dim tiny" v-if="sshMode === 'type' && sshAdhoc.kind === 'telnet'">{{ t('Telnet asks who you are inside the window, and carries everything in the clear.') }}</p>

            <!-- Looking costs nothing and needs no account; signing in does. -->
            <div class="tool-row">
              <button class="btn primary" :disabled="busy.ssh || !sshHostNow" :class="{working: busy.ssh}" @click="runSsh">{{ t('Inspect SSH') }}</button>
              <button class="btn" :disabled="busy.telnet || !sshHostNow" :class="{working: busy.telnet}" @click="runTelnet">{{ t('Try Telnet') }}</button>
              <!-- SSH signs in before it shows anything, so it needs a user name.
                   Leaving that out sent the request anyway and the server
                   answered "could not sign in as " — a refusal with nobody
                   named in it, eighty-two bytes of red text that is easy to
                   miss in a terminal that has just opened. A saved connection
                   carries its own user, and Telnet asks inside the window. -->
              <button class="btn" v-if="allowed('sshexec')" :disabled="busy.term || !sshHostNow || !sshReadyToOpen" :class="{working: busy.term}" @click="openConsoleHere">🖳 {{ t('Open a console') }}</button>
            </div>
            <label class="opt"><input type="checkbox" v-model="sshAuthMethods"> {{ t('Also ask which sign-in methods are accepted (leaves one failed attempt in the server log)') }}</label>

            <template v-if="allowed('sshexec') && sshCanRun">
              <div class="tool-row">
                <select v-model="sshPreset" class="grow">
                  <option value="">{{ t('Or type a command below…') }}</option>
                  <option v-for="(preset,id) in sshPresets" :key="id" :value="id">{{ t(preset.label) }}</option>
                </select>
                <button class="btn" :disabled="busy.sshrun || !sshPreset" :class="{working: busy.sshrun}" @click="runSshPreset">{{ t('Run') }}</button>
              </div>
              <div class="tool-row">
                <input v-model="sshCommand" class="mono" :placeholder="t('uptime')" @keyup.enter="runSshCommand">
                <button class="btn" :disabled="busy.sshrun || !sshCommand" :class="{working: busy.sshrun}" @click="runSshCommand">{{ t('Run command') }}</button>
              </div>
            </template>
          </div>

          <div class="card" v-if="sshResult">
            <p v-if="sshResult.error" class="empty-hint">⚠ {{ sshResult.error }}</p>
            <div v-for="(f,i) in sshResult.findings" :key="i" class="finding" :class="f.level">
              <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
            </div>
            <div class="kv">
              <div><span>{{ t('Identification') }}</span><code class="wrap">{{ sshResult.banner }}</code></div>
              <div v-if="sshResult.authMethods"><span>{{ t('Sign-in methods') }}</span><code>{{ sshResult.authMethods.join(', ') }}</code></div>
            </div>
            <table class="grid compact" v-if="(sshResult.hostKeys||[]).length">
              <thead><tr><th>{{ t('Host key') }}</th><th>{{ t('Size') }}</th><th>{{ t('Fingerprint') }}</th></tr></thead>
              <tbody><tr v-for="(k,i) in sshResult.hostKeys" :key="i"><td class="mono">{{ k.type }}</td><td class="mono">{{ k.bits ? k.bits + ' bit' : '' }}</td><td class="mono wrap tiny">{{ k.sha256 }}</td></tr></tbody>
            </table>
            <details><summary>{{ t('Algorithms offered') }}</summary>
              <div class="kv">
                <div v-for="(list,name) in sshResult.algorithms" :key="name" v-show="list.length && algoLabel(name)"><span>{{ t(algoLabel(name) || name) }}</span><code class="wrap tiny">{{ list.join(', ') }}</code></div>
              </div>
            </details>
          </div>

          <div class="card" v-if="telnetResult">
            <h3>Telnet</h3>
            <div v-for="(f,i) in telnetResult.findings" :key="i" class="finding" :class="f.level">
              <span class="pill" :class="f.level">{{ t(levelLabel(f.level)) }}</span><div><strong>{{ f.area }}</strong> · {{ f.text }}</div>
            </div>
            <p v-if="telnetResult.error" class="empty-hint">⚠ {{ telnetResult.error }}</p>
            <pre class="raw" v-if="telnetResult.banner">{{ telnetResult.banner }}</pre>
          </div>

          <div class="card" v-if="sshRunResult">
            <div class="kv">
              <div><span>{{ t('Command') }}</span><code class="wrap">{{ sshRunResult.command }}</code></div>
              <div><span>{{ t('Exit status') }}</span><code :class="sshRunResult.exitStatus ? 'bad' : 'good'">{{ sshRunResult.exitStatus === null ? '—' : sshRunResult.exitStatus }}</code></div>
              <div><span>{{ t('Time taken') }}</span><code>{{ sshRunResult.seconds }} s</code></div>
            </div>
            <pre class="raw">{{ sshRunResult.output || t('(no output)') }}</pre>
          </div>


        </section>

      </div>
    </main>

    <!-- ============ system information ============ -->
    <!-- Opening a shell: shown only when a code has to be entered, or when
         something is in the way. On a closed network the shell opens with no
         dialog at all. -->
    <div v-if="shellModal" class="drawer-backdrop centred" @click.self="closeShellModal">
      <div class="drawer narrow-drawer shell-modal" @mousedown.stop>
        <div class="drawer-head">
          <div><strong>{{ t('Open a shell') }}</strong><div class="dim">{{ t('A terminal on this server, running with the same privileges as Nextcloud (the {user} account) — no more. For administrators only.', { user: 'www-data' }) }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="closeShellModal"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <div v-if="shellStage==='no-email'" class="shell-gate warn">
            <p class="empty-hint">⚠ {{ t('No administrator email address is set.') }}</p>
            <p class="dim tiny">{{ t('This server can reach the internet, so a verification code is required — but your account has no email address for it to be sent to. Set one in your personal settings, then try again.') }}</p>
          </div>
          <div v-else-if="shellStage==='mail-failed'" class="shell-gate warn">
            <p class="empty-hint">⚠ {{ t('The verification code could not be sent. Check this server’s email settings and try again.') }}</p>
          </div>
          <div v-else-if="shellStage==='verify'" class="shell-gate">
            <p>{{ t('A six-digit code was sent to {email}. Enter it to open the shell.', { email: shellEmail }) }}</p>
            <div class="shell-code-row">
              <input v-model="shellCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="shell-code mono" placeholder="––––––" ref="shellCode" @input="shellCode = onlyDigits(shellCode)" @keyup.enter="verifyShell">
              <button class="btn primary" :disabled="shellBusy || shellCode.length !== 6" :class="{working: shellBusy}" @click="verifyShell">{{ t('Open the shell') }}</button>
            </div>
            <p v-if="shellError" class="empty-hint">⚠ {{ shellError }}</p>
            <p class="dim tiny">{{ t('The code is valid for ten minutes.') }} · <a href="#" @click.prevent="beginShell">{{ t('Send a new code') }}</a></p>
          </div>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn" @click="closeShellModal">{{ shellStage==='verify' ? t('Cancel') : t('Close') }}</button>
        </div>
      </div>
    </div>

    <div v-if="sysInfo" class="drawer-backdrop centred" @click.self="sysInfo=false">
      <div class="modal">
        <div class="drawer-head">
          <span class="ic big">🖥</span>
          <div><strong>{{ t('System information') }}</strong><div class="dim">{{ t('What this server can do, and what it could do') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="sysInfo=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <h3>{{ t('Basics') }}</h3>
          <div class="kv">
            <div><span>NetBase</span><code>v{{ version }}</code></div>
            <div v-if="requirements && requirements.distro"><span>{{ t('System') }}</span><code>{{ requirements.distro }}</code></div>
            <div v-if="requirements && requirements.phpVersion"><span>PHP</span><code>{{ requirements.phpVersion }}<span v-if="requirements.phpUser" class="dim"> ({{ requirements.phpUser }})</span></code></div>
            <div><span>{{ t('Vendor database') }}</span><code>{{ t('{n} IEEE prefixes', {n: status.ouiEntries}) }}</code></div>
            <div v-if="status.neighbourLimits"><span>{{ t('ARP table') }}</span><code>{{ status.neighbourCount }} / {{ status.neighbourLimits.gc3 }}</code></div>
            <div v-if="status.defaultRoute && status.defaultRoute.gateway"><span>{{ t('Default gateway') }}</span><code>{{ status.defaultRoute.gateway }} ({{ status.defaultRoute.interface }})</code></div>
            <div v-for="tgt in (status.targets || [])" :key="tgt.cidr"><span>{{ t('Local network') }}</span><code>{{ tgt.cidr }} <span class="dim">{{ tgt.interface }}</span></code></div>
          </div>

          <template v-if="allowed('server')">
            <h3>{{ t('This server') }}</h3>
            <div class="card" v-if="serverResult">
              <div class="kv">
                <div><span>{{ t('Host name') }}</span><code>{{ serverResult.hostname }}</code></div>
                <div><span>{{ t('Default gateway') }}</span><code>{{ serverResult.defaultRoute.gateway }} ({{ serverResult.defaultRoute.interface }})</code></div>
                <div><span>{{ t('Resolvers') }}</span><code>{{ serverResult.resolvers.join(', ') }}</code></div>
                <div><span>{{ t('ARP entries') }}</span><code>{{ serverResult.neighbours }}</code></div>
              </div>
              <table class="grid compact">
                <thead><tr><th>{{ t('Interface') }}</th><th>{{ t('State') }}</th><th>{{ t('MAC address') }}</th><th>{{ t('Addresses') }}</th><th>MTU</th></tr></thead>
                <tbody>
                  <tr v-for="i in serverResult.interfaces" :key="i.name">
                    <td class="mono">{{ i.name }}</td>
                    <td><span class="pill" :class="i.up ? 'ok' : 'no'">{{ i.up ? 'UP' : 'DOWN' }}</span></td>
                    <td class="mono dim">{{ i.mac }}</td>
                    <td class="mono">{{ i.addresses.map(a => a.ip + (a.family==='inet' ? '/'+a.cidr : '')).join(' ') }}</td>
                    <td class="dim mono">{{ i.mtu }}</td>
                  </tr>
                </tbody>
              </table>
              <details v-if="serverResult.listeners.length"><summary>{{ t('Listening sockets') }}</summary><pre class="raw">{{ serverResult.listeners.join('\n') }}</pre></details>
            </div>
          </template>

          <h3>{{ t('Tools you can use now') }}</h3>
          <p v-if="!activeComponents.length" class="dim">{{ t('None of the optional components are installed yet.') }}</p>
          <div v-for="c in activeComponents" :key="c.id" class="sys-row on">
            <span class="pill ok">{{ t('installed') }}</span>
            <div><strong>{{ t(c.name) }}</strong><div class="dim">{{ t(c.enables) }}</div></div>
          </div>

          <h3>{{ t('Install these to unlock more') }}</h3>
          <p v-if="!dormantComponents.length" class="dim">{{ t('Everything NetBase can use is already installed.') }}</p>
          <div v-for="c in dormantComponents" :key="c.id" class="sys-row off">
            <span class="pill no">{{ t('missing') }}</span>
            <div>
              <strong>{{ t(c.name) }}</strong>
              <div>{{ t(c.enables) }}</div>
              <div class="dim">{{ t(c.without) }}</div>
              <pre class="raw" v-if="status.isAdmin && installFor(c.id)">{{ installFor(c.id) }}</pre>
              <div class="dim" v-else>{{ t('Ask an administrator to install it.') }}</div>
            </div>
          </div>

          <!-- Docker/AIO: the per-distro install commands above do not apply in a
               container, so show the recipe that does — verified on the official
               Nextcloud image. Only when running in a container and something is
               actually missing. -->
          <template v-if="requirements && requirements.container && requirements.docker && !requirements.docker.nothingMissing">
            <h3>{{ t('Running in Docker or Nextcloud-AIO') }}</h3>
            <p class="dim">{{ t('An app cannot bundle PHP extensions, but the official Nextcloud image runs any script placed in this folder on every start — so it adds what is missing once and survives image updates, with no rebuild.') }}</p>
            <div class="dim mono">{{ requirements.docker.hooksDir }}</div>
            <template v-if="status.isAdmin">
              <pre class="raw">{{ requirements.docker.script }}</pre>
              <button class="btn sm" @click="copyField(t('Docker recipe'), requirements.docker.script)">{{ t('Copy') }}</button>
            </template>
            <div class="dim" v-else>{{ t('Ask an administrator to set this up.') }}</div>
          </template>
        </div>
        <div class="drawer-foot">
          <a class="btn sm" v-if="status.isAdmin" :href="adminUrl">{{ t('Open administration settings') }}</a>
          <span class="spacer"></span>
          <button class="btn primary" @click="sysInfo=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ edit the named (registered) devices ============ -->
    <div v-if="editReg" class="drawer-backdrop centred" @click.self="editReg=false">
      <div class="modal wide">
        <div class="drawer-head">
          <span class="ic big">🛠</span>
          <div><strong>{{ t('Edit named devices') }}</strong><div class="dim">{{ t('The devices you have given a name. Rename them, change the type, edit the note, or remove one.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="editReg=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body reg-body">
          <p v-if="!editRegRows.length" class="dim">{{ t('No named devices yet. Open a device from the list and give it a name to add it here.') }}</p>
          <table v-else class="reg-table">
            <thead><tr><th>{{ t('Name') }}</th><th>{{ t('Type') }}</th><th>{{ t('Notes') }}</th><th class="reg-id">{{ t('IPv4') }} / {{ t('MAC address') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in editRegRows" :key="r.id" :class="{'reg-del': r.remove}">
                <td><input v-model="r.label" :placeholder="r.hostname || r.ip" :disabled="r.remove"></td>
                <td><div class="type-pick">
                  <select v-if="r.type !== customType" v-model="r.type" :disabled="r.remove" :aria-label="t('Type')" @change="focusOwnType($event)"><option v-for="(l,k) in typeLabels" :key="k" :value="k">{{ t(l) }}</option><option :value="customType">{{ t('Other (enter your own)') }}</option></select>
                  <span v-else class="type-own">
                    <input v-model="r.typeText" :disabled="r.remove" maxlength="32" :placeholder="t('Enter a type')" :aria-label="t('Enter a type')" @keydown.esc.stop="r.type = typeBack(r.oldType)">
                    <button type="button" class="btn xs ib type-back" :disabled="r.remove" :title="t('Choose from the list')" :aria-label="t('Choose from the list')" @click="r.type = typeBack(r.oldType)"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
                  </span>
                </div></td>
                <td><input v-model="r.notes" :disabled="r.remove"></td>
                <td class="reg-id mono dim">{{ r.ip }}<br>{{ r.mac || '—' }}</td>
                <td><button class="btn xs ib" :title="r.remove ? t('Keep') : t('Remove')" :aria-label="r.remove ? t('Keep') : t('Remove')" @click="r.remove = !r.remove"><svg v-if="!r.remove" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg><svg v-else viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.3 5.6"/><path d="M4 20v-5h5"/></svg></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="drawer-foot">
          <span class="dim" v-if="editRegRows.some((r) => r.remove)">{{ t('{n} to remove', {n: editRegRows.filter((r) => r.remove).length}) }}</span>
          <span class="spacer"></span>
          <button class="btn sm" @click="editReg=false">{{ t('Cancel') }}</button>
          <button class="btn primary" :disabled="busy.reg" :class="{working: busy.reg}" @click="saveRegEditor">{{ busy.reg ? t('Saving…') : t('Save') }}</button>
        </div>
      </div>
    </div>

    <!-- How to switch the "Clear the ARP table" button on. NetBase runs
         unprivileged and cannot flush the kernel table itself; an administrator
         installs a tiny helper and a one-line sudoers rule, and NetBase then
         detects it and enables the button on its own. -->
    <div v-if="arpHelp" class="drawer-backdrop centred" @click.self="arpHelp=false">
      <div class="modal wide">
        <div class="drawer-head">
          <span class="ic big">🧹</span>
          <div><strong>{{ t('Switch on “Clear the ARP table”') }}</strong><div class="dim">{{ t('NetBase runs without special privileges, so clearing the kernel neighbour (ARP) table needs a small helper an administrator installs once.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="arpHelp=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body arp-help-body">
          <p class="arp-warn">⚠ {{ t('This is optional. NetBase works fully without it — “Refresh devices” already re-checks what is online. It grants the web user one root command, so if you are not confident about the security trade-off, do not install it.') }}</p>
          <p class="dim">{{ t('When the helper is installed and the check passes, the button turns on by itself (reload this page).') }}</p>

          <h4>{{ t('On the server (bare metal or VM)') }}</h4>
          <p class="dim tiny">{{ t('Run as an administrator. This writes the helper and a sudoers rule that lets only the web user ({user}) run only this one command.', {user: arpUser()}) }}</p>
          <div class="arp-code"><button class="btn xs ib arp-copy" :title="t('Copy')" @click="copyText(arpBareSteps())"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button><pre>{{ arpBareSteps() }}</pre></div>

          <h4>{{ t('Docker / Podman') }}</h4>
          <p class="dim tiny">{{ t('The image is rebuilt as a whole, so install the helper from a start-up hook and give the container the NET_ADMIN capability (and the host network to reach the LAN).') }}</p>
          <div class="arp-code"><button class="btn xs ib arp-copy" :title="t('Copy')" @click="copyText(arpDockerHook())"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button><pre>{{ arpDockerHook() }}</pre></div>

          <p class="dim tiny">{{ t('The helper only ever runs “ip neigh flush all”. You can read it before installing; NetBase probes it with a harmless “--check”.') }}</p>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn sm" @click="arpHelp=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- How to give this server a language it does not yet have. The list of
         locales is read from the machine, so this is the only way to add to
         it — and it is done on the server, not from here. -->
    <div v-if="termLog.open" class="drawer-backdrop centred over-dialog" @click.self="termLog.open=false">
      <div class="modal">
        <div class="drawer-head">
          <span class="ic big">🗒️</span>
          <div>
            <strong>{{ termLog.session ? t('What was done') : t('Recorded sessions') }}</strong>
            <div class="dim" v-if="termLog.session">{{ termLog.session.target }}</div>
            <div class="dim" v-else>{{ t('Kept for your account only. Nobody else can read these.') }}</div>
          </div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="termLog.open=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <p class="dim" v-if="termLog.loading">{{ t('Reading…') }}</p>

          <template v-else-if="!termLog.session">
            <p class="dim" v-if="!termLog.sessions.length">{{ t('Nothing has been kept yet. Set a number of steps above, then open a terminal.') }}</p>
            <table class="grid" v-else>
              <thead><tr><th>{{ t('Where') }}</th><th>{{ t('Steps') }}</th><th>{{ t('Last used') }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="s in termLog.sessions" :key="s.session">
                  <td><span class="pill">{{ s.kind === 'shell' ? t('Shell') : 'SSH' }}</span> <span class="mono">{{ s.target }}</span></td>
                  <td>{{ s.steps }}</td>
                  <td class="dim">{{ ago(s.last) }}</td>
                  <td class="row-actions">
                    <button class="btn xs" @click="readTermLog(s)">{{ t('Open') }}</button>
                    <button class="btn xs danger" @click="forgetTermLog(s.session)">{{ t('Forget') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>

          <template v-else>
            <div class="log-step" v-for="st in termLog.steps" :key="st.id">
              <div class="log-typed mono">{{ st.typed.trim() }}</div>
              <pre class="log-said" v-if="st.said.trim()">{{ st.said.trim() }}</pre>
              <div class="dim tiny">{{ stamp(st.created) }}</div>
            </div>
            <p class="dim" v-if="!termLog.steps.length">{{ t('This session has no steps left.') }}</p>
          </template>
        </div>
        <div class="drawer-foot">
          <button class="btn sm" v-if="termLog.session" @click="termLog.session = null; termLog.steps = []">{{ t('Back to the list') }}</button>
          <button class="btn sm danger" v-else-if="termLog.sessions.length" @click="forgetTermLog('')">{{ t('Forget all of them') }}</button>
          <span class="spacer"></span>
          <button class="btn sm" @click="termLog.open=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <div v-if="localeHelp" class="drawer-backdrop centred over-dialog" @click.self="localeHelp=false">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">🌐</span>
          <div><strong>{{ t('Adding a language to this server') }}</strong><div class="dim">{{ t('The shell speaks the language of a locale the machine has installed.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="localeHelp=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <p class="dim">{{ t('NetBase offers only the locales this server already has, so a shell is never started in a language the machine cannot produce. Adding one is done on the server itself.') }}</p>

          <h4>{{ t('On the server (bare metal or VM)') }}</h4>
          <p class="dim tiny">{{ t('Run as an administrator. Change LOCALE on the first line to the language you want.') }}</p>
          <div class="arp-code"><button class="btn xs ib arp-copy" :title="t('Copy')" @click="copyText(localeSteps())"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button><pre>{{ localeSteps() }}</pre></div>

          <h4>{{ t('Docker / Podman') }}</h4>
          <p class="dim tiny">{{ t('The image is rebuilt as a whole, so make the locale from a start-up hook; it then survives every image update.') }}</p>
          <div class="arp-code"><button class="btn xs ib arp-copy" :title="t('Copy')" @click="copyText(localeDockerHook())"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button><pre>{{ localeDockerHook() }}</pre></div>

          <p class="dim tiny">{{ t('Then open these settings again: the new locale is in the list. A shell that is already open keeps the language it started with.') }}</p>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn sm" @click="localeHelp=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ settings (per user, NetBase only) ============
         Four subjects, not eleven. The dialog had grown by addition: the
         terminal's font, the shell's language and the shell's log ended up in
         three separate places with the connection list wedged between them,
         and the word "language" appeared twice at the same size meaning two
         different things. Grouping them costs nothing and the reader stops
         having to hold the whole column in their head. -->
    <div v-if="themeBox" class="drawer-backdrop centred">
      <div class="modal">
        <div class="drawer-head">
          <span class="ic big">⚙</span>
          <div><strong>{{ t('Settings') }}</strong><div class="dim">{{ t('Applies to NetBase only, for your account.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="themeBox=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">

          <!-- The same tabs as the connection list. Four groups stacked made a
               dialog longer than the screen, and the one being changed was
               never wholly in view. -->
          <div class="set-tabs" role="tablist">
            <button v-for="s in settingTabs" :key="s.id"
                    class="set-tab" :class="{active: settingTab === s.id}"
                    role="tab" :aria-selected="settingTab === s.id" :title="t(s.label)"
                    @click="settingTab = s.id">
              <span class="ic">{{ s.icon }}</span>{{ t(s.label) }}
            </button>
          </div>

          <section class="set-group" v-show="settingTab === 'look'">
            <h3><span class="ic">🎨</span>{{ t('Appearance and language') }}</h3>
            <div class="theme-picks">
              <button v-for="opt in themeOptions" :key="opt.id" class="theme-pick" :class="{active: settings.theme===opt.id}" @click="setTheme(opt.id)">
                <span class="swatch" :class="opt.id"><i class="bar"></i><i class="line"></i><i class="line short"></i></span>
                <strong>{{ t(opt.label) }}</strong>
                <span class="dim">{{ t(opt.hint) }}</span>
                <span class="tick" v-if="settings.theme===opt.id">✓</span>
              </button>
            </div>
            <p class="dim tiny">{{ t('Saved to your account, so it follows you to every browser you sign in from.') }}</p>

            <h4>{{ t('Language') }}</h4>
            <label class="fl">
              <select :value="settings.language || 'auto'" @change="setLanguage($event.target.value)">
                <option value="auto">{{ t('Follow Nextcloud') }}</option>
                <option v-for="l in (settings.languages || [])" :key="l.code" :value="l.code">{{ l.name }}</option>
              </select>
            </label>
            <p class="dim tiny">{{ t('NetBase can speak a different language from the rest of Nextcloud.') }}</p>
          </section>

          <section class="set-group" v-show="settingTab === 'term'">
            <h3><span class="ic">🖳</span>{{ t('Terminal (shell and SSH)') }}</h3>

            <h4>{{ t('Terminal font') }}</h4>
            <label class="fl">
              <select v-model="settings.termFont" @change="applyTermFont()">
                <option v-for="f in termFonts" :key="f.id" :value="f.id">{{ t(f.label) }}</option>
                <optgroup v-if="(settings.serverFonts || []).length" :label="t('Fonts on this server')">
                  <option v-for="f in settings.serverFonts" :key="f.id" :value="'server:' + f.id">{{ f.family }} ({{ fontSize(f.bytes) }})</option>
                </optgroup>
              </select>
            </label>
            <p class="dim tiny">{{ t('The face the shell and SSH terminals are drawn in. The size is set in the terminal window itself.') }}</p>
            <p class="dim tiny" v-if="String(settings.termFont || '').startsWith('server:')">{{ t('A font from this server is sent to your browser the first time it is used, and kept afterwards.') }}</p>
            <template v-if="status.isAdmin && settings.admin">
              <label class="fl">
                <span class="fl-label">{{ t('Extra font folder') }}<span class="admin-note">{{ t('For everyone on this server') }}</span></span>
                <input v-model="settings.admin.fontDir" spellcheck="false" autocomplete="off" placeholder="/usr/local/share/fonts" @change="saveFontDir()">
              </label>
              <p class="dim tiny">{{ t('Another folder on this server to look in for fonts. What is found there is offered alongside the rest.') }}</p>
            </template>

            <template v-if="status.isAdmin">
              <h4>{{ t('Shell') }}</h4>
              <div class="fl">
                <span class="fl-label">{{ t('Language') }}<span class="admin-note">{{ t('For everyone on this server') }}</span></span>
                <span class="shell-lang-row">
                  <select v-model="settings.shellLang" @change="saveShell()">
                    <option value="">{{ t('Follow the server') }}</option>
                    <option v-for="l in (settings.shellLocales || [])" :key="l" :value="l">{{ l }}</option>
                  </select>
                  <button class="btn xs ib shell-help-btn" :title="t('How to add a language to this server')" :aria-label="t('How to add a language to this server')" @click="localeHelp = true">?</button>
                </span>
              </div>
              <p class="dim tiny" v-if="(settings.shellLocales || []).length < 2">{{ t('This server has only one locale installed, so the shell speaks that language. An administrator can install more on the server itself.') }}</p>
              <label class="fl">
                <span class="fl-label">{{ t('Environment variables') }}<span class="admin-note">{{ t('For everyone on this server') }}</span></span>
                <textarea v-model="settings.shellEnv" rows="4" spellcheck="false" autocomplete="off" placeholder="EDITOR=vi" @change="saveShell()"></textarea>
              </label>
              <p class="dim tiny">{{ t('One NAME=value to a line. Both apply to shells opened from now on, not to a window that is already open.') }}</p>
              <p class="dim tiny">{{ t('These two are for the shell on this server only. An SSH window takes its language and environment from the machine it reaches.') }}</p>
            </template>

            <h4>{{ t('Shell log') }}</h4>
            <label class="opt">
              <input type="checkbox" v-model="settings.termLogOn" @change="saveTermLog()">
              {{ t('Keep a log of shell and SSH sessions') }}
            </label>
            <p class="dim tiny">{{ t('One step is a line you typed together with what came back.') }}</p>
            <template v-if="settings.termLogOn">
              <div class="fl-row">
                <label class="fl short">
                  <span class="fl-label">{{ t('Steps to keep') }}</span>
                  <input v-model.number="settings.termLogSteps" type="number" min="1" max="10000" step="100" @change="saveTermLog()">
                </label>
                <label class="fl short">
                  <span class="fl-label">{{ t('Days to keep') }}</span>
                  <input v-model.number="settings.termLogDays" type="number" min="1" max="3650" @change="saveTermLog()">
                </label>
              </div>
              <p class="dim tiny">{{ t('Per window, counting from the most recent.') }}</p>
              <p class="dim tiny">{{ t('Counted from the last step of a window, so one still being used is never cut short. When the days run out, that whole session goes.') }}</p>
            </template>
            <div class="fl-row">
              <button class="btn sm" @click="openTermLog()">{{ t('Show what was kept') }}</button>
            </div>
          </section>

          <section class="set-group" v-show="settingTab === 'conn'">
            <h3><span class="ic">🔑</span>{{ t('Connections and keys') }}</h3>

            <h4>{{ t('Connection list for SSH, Telnet, FTP, SFTP and SCP') }}</h4>
            <p class="dim tiny">{{ t('The servers you connect to are kept in RegiBase, so a password is sealed with your own master key and not with a secret held on this server.') }}</p>
            <div class="fl-row">
              <button class="btn sm" @click="openConnSetup()">{{ t('Set up the connection list') }}</button>
            </div>

            <h4>{{ t('Acting as root') }}</h4>
            <p class="dim tiny">{{ t('Over SCP a command can be put through sudo. The password is asked for each time and kept nowhere, but it stays usable while the page is open — so it is let go after this long with nothing touched.') }}</p>
            <label class="fl">
              <span class="fl-label">{{ t('Give up root after') }}</span>
              <select v-model.number="settings.rootIdleMinutes" @change="saveRootIdle">
                <option :value="1">{{ t('1 minute') }}</option>
                <option :value="3">{{ t('{n} minutes', {n: 3}) }}</option>
                <option :value="5">{{ t('{n} minutes', {n: 5}) }}</option>
                <option :value="10">{{ t('{n} minutes', {n: 10}) }}</option>
                <option :value="30">{{ t('{n} minutes', {n: 30}) }}</option>
                <option :value="0">{{ t('Do not give it up on its own') }}</option>
              </select>
            </label>

            <h4>{{ t('Where your SSH keys are kept') }}</h4>
            <p class="dim tiny">{{ t('Name the folder your keys live in, and the file chooser starts there every time.') }}</p>
            <div class="fl-row">
              <input v-model="settings.keyFolder" class="grow mono" :placeholder="t('Anywhere in your Nextcloud files')" @change="saveKeyFolder">
              <button class="btn sm" @click="pickFile(t('Choose a folder'), (p) => { settings.keyFolder = p; saveKeyFolder(); }, true, settings.keyFolder)">📂 {{ t('Browse…') }}</button>
              <button class="btn sm" :disabled="!settings.keyFolder" @click="settings.keyFolder = ''; saveKeyFolder()">{{ t('Clear the folder') }}</button>
            </div>
          </section>

          <section class="set-group" v-show="settingTab === 'tools'">
            <h3><span class="ic">☰</span>{{ t('The list of tools') }}</h3>
            <p class="dim tiny">{{ t('Drag the tools in the sidebar into the order you work in, or hold Alt and press the up and down arrows.') }}</p>
            <button class="btn sm" :disabled="!(settings.tabOrder || []).length" @click="resetTabOrder">{{ t('Put them back in the original order') }}</button>
          </section>

        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn primary" @click="themeBox=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ sign in to a server, asked for on the spot ============ -->
    <div v-if="sshAsk.open" class="drawer-backdrop centred">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">🖳</span>
          <div><strong>{{ t('Sign in with details typed here') }}</strong><div class="dim">{{ t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="sshAsk.open=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <div class="fl-row">
            <label class="fl grow"><span class="fl-label">{{ t('Host') }}</span><input v-model="sshAsk.host" class="mono"></label>
            <label class="fl short"><span class="fl-label">{{ t('Port') }}</span><input v-model.number="sshAsk.port" type="number" min="1" max="65535"></label>
          </div>
          <div class="fl-row">
            <label class="fl grow"><span class="fl-label">{{ t('User name') }}</span><input v-model="sshAsk.username" autocomplete="off" @keyup.enter="connectAsk"></label>
            <label class="fl short"><span class="fl-label">{{ t('Sign in with') }}</span>
              <select v-model="sshAsk.authType">
                <option value="password">{{ t('Password') }}</option>
                <option value="key">{{ t('Private key') }}</option>
              </select>
            </label>
          </div>
          <template v-if="sshAsk.authType === 'key'">
            <div class="fl-row">
              <label class="fl grow"><span class="fl-label">{{ t('Private key') }}</span><input v-model="sshAsk.privateKeyPath" class="mono" :placeholder="t('Key file in your Nextcloud files')"></label>
              <button class="btn sm" @click="pickFile(t('Choose a key file'), (p) => { sshAsk.privateKeyPath = p; }, false, settings.keyFolder)">📂 {{ t('Browse…') }}</button>
            </div>
            <label class="fl"><span class="fl-label">{{ t('Key passphrase (if any)') }}</span><input v-model="sshAsk.passphrase" type="password" autocomplete="new-password" @keyup.enter="connectAsk"></label>
          </template>
          <label class="fl" v-else><span class="fl-label">{{ t('Password') }}</span><input v-model="sshAsk.secret" type="password" autocomplete="new-password" @keyup.enter="connectAsk"></label>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn" @click="sshAsk.open=false">{{ t('Cancel') }}</button>
          <button class="btn primary" :disabled="!sshAsk.host || !sshAsk.username" @click="connectAsk">🖳 {{ t('Connect') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ device windows (served through this server) ============ -->
    <div v-for="w in windows" :key="w.id" class="devwin" :class="{ dragging: !!drag }" :style="{ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }" @mousedown="focusWindow(w)">
      <div class="devwin-head" @mousedown.prevent="startDrag(w, $event)">
        <span class="ic">🖥</span>
        <strong class="nm">{{ w.title }}</strong>
        <span class="dim mono tiny addr">{{ w.base }}{{ w.path ? '/' + w.path : '' }}</span>
        <span class="spacer"></span>
        <!-- Drawn, not typed: the arrows and crosses a font happens to carry are
             hairline thin at this size, and no two systems draw them alike. -->
        <button class="btn xs ib" :title="t('Back')" :aria-label="t('Back')" :disabled="w.trailAt < 1" @click.stop="backWindow(w)">
          <svg viewBox="0 0 24 24"><path d="M20 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        </button>
        <button class="btn xs ib" :title="t('Front page')" :aria-label="t('Front page')" @click.stop="homeWindow(w)">
          <svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z"/><path d="M9.5 21.5v-8h5v8"/></svg>
        </button>
        <button class="btn xs ib" :title="t('Reload')" :aria-label="t('Reload')" @click.stop="reloadWindow(w)">
          <svg viewBox="0 0 24 24"><path d="M20.5 13.5A8.5 8.5 0 1 1 18 6.4L21.5 9.5"/><path d="M21.5 4v5.5H16"/></svg>
        </button>
        <button class="btn xs ib" v-if="!narrow" :title="t('Fill the screen')" :aria-label="t('Fill the screen')" @click.stop="toggleFull(w)">
          <svg viewBox="0 0 24 24"><path d="M14.5 3.5H20.5V9.5"/><path d="M9.5 20.5H3.5V14.5"/><path d="M20.5 3.5L13.5 10.5"/><path d="M3.5 20.5L10.5 13.5"/></svg>
        </button>
        <button class="btn xs ib" :title="t('What this window can and cannot do')" :aria-label="t('What this window can and cannot do')" @click.stop="w.help = !w.help">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.7.8c0 1.9-2.9 2.4-2.9 4"/><path d="M12 17.4h.01"/></svg>
        </button>
        <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click.stop="closeWindow(w)">
          <svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
      <div v-if="w.help" class="devwin-help" @mousedown.stop>
        <strong>{{ t('What works here') }}</strong>
        <ul>
          <li>{{ t('Sign in and change settings, exactly as you would in front of the device') }}</li>
          <li>{{ t('Send files to it — new firmware, a saved configuration') }}</li>
          <li>{{ t('Take files from it — a backup, a log — whatever their size') }}</li>
          <li>{{ t('Older interfaces built out of frames') }}</li>
          <li>{{ t('Its password, remembered for you after the first time') }}</li>
        </ul>
        <strong>{{ t('What does not') }}</strong>
        <ul>
          <li>{{ t('A console that stays connected, which some switches offer') }}</li>
          <li>{{ t('Anything needing Java or ActiveX in the browser') }}</li>
        </ul>
        <button class="btn xs" @click.stop="w.help = false">{{ t('Close') }}</button>
      </div>
      <!-- What used to be here was a sentence explaining the window to someone
           who had already opened it. This is the row of things a person
           actually reaches for while signing into a device: its address, what
           is on the page, and the clipboard going the other way, because a
           device password is nearly always pasted. -->
      <div class="devwin-bar" v-if="!w.busy && !w.error" @mousedown.stop>
        <button class="btn xs" :title="t('Copy this device\'s own address')" @click.stop="copyText(w.base + (w.path ? '/' + w.path : ''), t('Address copied'))">
          <span class="ic"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></span><span class="lb">{{ t('Address') }}</span>
        </button>
        <button class="btn xs" :title="t('Copy whatever is selected on the page, or the whole page if nothing is')" @click.stop="copyFromWindow(w)">
          <span class="ic"><svg viewBox="0 0 24 24"><path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h10"/></svg></span><span class="lb">{{ t('Page text') }}</span>
        </button>
        <button class="btn xs" :title="t('Paste the clipboard into the field the cursor is in')" @mousedown.prevent @click.stop="pasteIntoWindow(w)">
          <span class="ic"><svg viewBox="0 0 24 24"><path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M8.5 12h7"/><path d="M8.5 15.5h4.5"/></svg></span><span class="lb">{{ t('Paste') }}</span>
        </button>
        <span class="spacer"></span>
        <!-- Device interfaces are drawn for a screen of their own era. Some
             are unreadably small in a window; some waste half of it. -->
        <button class="btn xs" :title="t('Take a picture of this page')" @mousedown.prevent @click.stop="shootWindow(w)">
          <span class="ic"><svg viewBox="0 0 24 24"><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="12.7" r="3.4"/></svg></span><span class="lb">{{ t('Screenshot') }}</span>
        </button>
        <span class="devwin-zoom">
          <button class="btn xs ib" :class="{active: w.fit}" :title="t('Fit the page to the window')" :aria-label="t('Fit the page to the window')" @mousedown.prevent @click.stop="toggleFit(w)"><svg viewBox="0 0 24 24"><path d="M3.5 8.5V4.5H7.5"/><path d="M20.5 8.5V4.5H16.5"/><path d="M3.5 15.5V19.5H7.5"/><path d="M20.5 15.5V19.5H16.5"/></svg></button>
          <button class="btn xs ib" :title="t('Smaller')" :aria-label="t('Smaller')" :disabled="!canZoom(w, -1)" @mousedown.prevent @click.stop="zoomWindow(w, -1)"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
          <button class="btn xs zoom-now" :title="t('Back to 100%')" @mousedown.prevent @click.stop="resetZoom(w)">{{ Math.round(w.zoom * 100) }}%</button>
          <button class="btn xs ib" :title="t('Larger')" :aria-label="t('Larger')" :disabled="!canZoom(w, 1)" @mousedown.prevent @click.stop="zoomWindow(w, 1)"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
        </span>
        <span class="dim mono tiny">{{ w.base.replace(/^https?:\/\//, '') }}</span>
      </div>
      <div v-if="w.busy" class="devwin-note dim">{{ t('Connecting…') }}</div>
      <div v-else-if="w.error" class="devwin-note error">⚠ {{ w.error }}</div>
      <!-- The page is sandboxed against navigating anything but itself, so a device
           that tries to break out of frames cannot take the browser with it, and a
           policy pins everything it loads or sends to the proxy path, so it cannot
           reach a Nextcloud endpoint. The name is how its own "replace everything"
           links find this window. -->
      <div v-else class="devwin-body">
        <iframe :src="w.src" class="devwin-frame" :title="w.title" :data-window="w.id" name="_netbase_window" @load="onWindowLoad(w, $event)"
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"></iframe>
        <!-- A slow line or a sleepy device leaves the frame blank; this sits over
             it until the page loads, so it is clear it is still working. -->
        <div v-if="w.loading" class="devwin-loading">
          <span class="devwin-spinner"></span>
          <span class="devwin-loading-text">{{ t('Loading…') }}<template v-if="w.loadSecs >= 3"> {{ t('({s}s)', {s: w.loadSecs}) }}</template></span>
        </div>
      </div>
      <!-- A message about this window, shown inside it: a device window sits above
           the app's own banner (its z-index is raised on every focus), so a note
           put there would be hidden behind the window it is about. -->
      <div v-if="w.toast" class="devwin-toast" :class="w.toast.kind" @click="w.toast = null">{{ w.toast.text }}</div>
      <div class="devwin-grip" @mousedown.prevent.stop="startResize(w, $event)"></div>
    </div>

    <!-- ============ what can be done to the device under the pointer ============ -->
    <!-- A right-click asks the obvious question — how do I get into this thing —
         and the answer is already known: whichever of its ports are open. -->
    <!-- One line of text, or a yes, asked in the page rather than by the
         browser: a native prompt() freezes an embedded window. -->
    <div v-if="ask.open" class="drawer-backdrop centred topmost">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">{{ ask.icon }}</span>
          <div><strong>{{ ask.title }}</strong><div class="dim">{{ ask.subject }}</div></div>
        </div>
        <div class="drawer-body">
          <p v-if="ask.body" class="dim">{{ ask.body }}</p>
          <template v-if="ask.input">
            <p v-if="ask.label" class="dim">{{ ask.label }}</p>
            <input ref="askBox" v-model="ask.value" type="text" class="grow mono" autocomplete="off" @keyup.enter="askOk()">
          </template>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn sm" @click="askClose(null)">{{ t('Cancel') }}</button>
          <button class="btn" :class="ask.danger ? 'danger' : 'primary'" :disabled="ask.input && !String(ask.value || '').trim()" @click="askOk()">{{ ask.confirm }}</button>
        </div>
      </div>
    </div>

    <!-- What can be done with the file under the pointer. -->
    <div v-if="fileMenu.open" class="row-menu-veil" @click="fileMenu.open = false" @contextmenu.prevent="fileMenu.open = false"></div>
    <div v-if="fileMenu.open" class="row-menu" :style="{ left: fileMenu.x + 'px', top: fileMenu.y + 'px' }" @click.stop>
      <div class="row-menu-head">{{ fileMenu.entry.directory ? '📁' : '📄' }} {{ fileMenu.entry.name }}</div>
      <button class="row-menu-item" v-if="fileMenu.entry.directory" @click="runFileMenu('open')">{{ t('Open') }}</button>
      <!-- A text file opens in a window of its own, beside the listing rather
           than instead of it, so it can be read against what is on the other
           side. Anything larger than a megabyte is refused by the server with
           a reason rather than filling the window with rubbish. -->
      <button class="row-menu-item" v-if="!fileMenu.entry.directory" @click="runFileMenu('view')">📄 {{ t('Open in a window') }}</button>
      <button class="row-menu-item" @click="runFileMenu('download')">⤓ {{ fileMenu.entry.directory ? t('Download as ZIP') : t('Download file') }}</button>
      <button class="row-menu-item" @click="runFileMenu('copyPath')">{{ t('Copy the path') }}</button>
      <div class="row-menu-rule"></div>
      <button class="row-menu-item" @click="runFileMenu('rename')">{{ t('Rename') }}</button>
      <button class="row-menu-item" @click="runFileMenu('chmod')">{{ t('Change permissions') }}</button>
      <!-- The timestamp is yours to set on your own files, so it is always
           offered. The owner and the group are not: every server refuses those
           to an ordinary account, and showing them would be offering something
           that cannot work. -->
      <button class="row-menu-item" @click="runFileMenu('touch')">{{ t('Set the time to now') }}</button>
      <template v-if="asRoot && sudoPassword">
        <button class="row-menu-item" @click="runFileMenu('chown')">{{ t('Change owner') }}</button>
        <button class="row-menu-item" @click="runFileMenu('chgrp')">{{ t('Change group') }}</button>
      </template>
      <div class="row-menu-rule"></div>
      <button class="row-menu-item" @click="runFileMenu('delete')">{{ t('Delete') }}</button>
    </div>

    <div v-if="rowMenu.open" class="row-menu-veil" @click="rowMenu.open = false" @contextmenu.prevent="rowMenu.open = false">
      <ul class="row-menu" :style="{ left: rowMenu.x + 'px', top: rowMenu.y + 'px' }" @click.stop>
        <li class="row-menu-head">{{ rowMenu.device ? (rowMenu.device.name || rowMenu.device.ip) : '' }}</li>
        <li v-for="(a,i) in rowActions(rowMenu.device)" :key="i">
          <button class="row-menu-item" @click="rowMenu.open = false; a.run()">
            <span class="ic">{{ a.icon }}</span>{{ a.label }}
          </button>
        </li>
        <li v-if="!rowActions(rowMenu.device).length" class="row-menu-none">{{ t('No way in on the ports it has open') }}</li>
        <li class="row-menu-rule"></li>
        <li>
          <button class="row-menu-item" @click="rowMenu.open = false; openDevice(rowMenu.device)">
            <span class="ic">📋</span>{{ t('Properties') }}
          </button>
        </li>
      </ul>
    </div>

    <!-- ============ text windows (a file, open beside the list) ============ -->
    <!-- The same frame as a device or terminal window: moved, resized, several
         at once. A file you are checking against another file has to be
         readable at the same time as the listing, not instead of it. -->
    <div v-for="w in textWins" :key="w.id" class="devwin text-win" :class="{ dragging: !!drag }"
         :style="{ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }"
         @mousedown="focusWindow(w)">
      <div class="devwin-head" @mousedown.prevent="startDrag(w, $event)">
        <span class="ic">📄</span>
        <strong class="nm">{{ w.name }}<template v-if="textChanged(w)"> ●</template></strong>
        <span class="dim mono tiny addr">{{ w.path }}</span>
        <span class="spacer"></span>
        <span class="dim tiny">{{ w.encoding }} · {{ w.newline === 'crlf' ? 'CRLF' : 'LF' }} · {{ fmtBytes(w.bytes) }}</span>
        <button class="btn xs ib" :title="t('Reload')" :aria-label="t('Reload')" @click.stop="reloadText(w)">
          <svg viewBox="0 0 24 24"><path d="M20.5 13.5A8.5 8.5 0 1 1 18 6.4L21.5 9.5"/><path d="M21.5 4v5.5H16"/></svg>
        </button>
        <button class="btn xs ib" v-if="!narrow" :title="t('Fill the screen')" :aria-label="t('Fill the screen')" @click.stop="toggleFull(w)">
          <svg viewBox="0 0 24 24"><path d="M14.5 3.5H20.5V9.5"/><path d="M9.5 20.5H3.5V14.5"/><path d="M20.5 3.5L13.5 10.5"/><path d="M3.5 20.5L10.5 13.5"/></svg>
        </button>
        <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click.stop="closeText(w)">
          <svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
      <textarea v-model="w.text" class="text-body mono" spellcheck="false"></textarea>
      <div class="devwin-foot">
        <span class="dim tiny" v-if="w.note">{{ w.note }}</span>
        <span class="dim tiny" v-else-if="textChanged(w)">{{ t('Changed — not saved yet') }}</span>
        <span class="spacer"></span>
        <button class="btn sm primary" :disabled="w.saving || !textChanged(w)" :class="{working: w.saving}" @click="saveText(w)">{{ t('Save') }}</button>
      </div>
      <div class="devwin-grip" @mousedown.prevent.stop="startResize(w, $event)"></div>
    </div>

    <!-- ============ terminal windows (SSH and Telnet) ============ -->
    <!-- The same frame as a device window: moved, resized, several at once, and
         open beside the list rather than instead of it. -->
    <div v-for="w in terms" :key="w.id" class="devwin term-win" :class="{ dragging: !!drag }"
         :style="{ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }"
         @mousedown="focusWindow(w)">
      <div class="devwin-head" @mousedown.prevent="startDrag(w, $event)">
        <span class="ic">🖳</span>
        <strong class="nm">{{ w.kind === 'shell' ? t('Shell') : (w.kind === 'telnet' ? 'Telnet' : 'SSH') }}<template v-if="w.kind !== 'shell'"> · {{ w.host }}</template></strong>
        <span class="dim mono tiny addr">{{ w.kind === 'shell' ? t('This server') : (w.prompt || (w.user ? w.user + '@' + w.host : w.host + ':' + w.port)) }}</span>
        <span class="spacer"></span>
        <button class="btn xs ib" :title="t('Clear')" :aria-label="t('Clear')" @click.stop="clearTerm(w)">
          <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/></svg>
        </button>
        <button class="btn xs ib" v-if="!narrow" :title="t('Fill the screen')" :aria-label="t('Fill the screen')" @click.stop="toggleFull(w)">
          <svg viewBox="0 0 24 24"><path d="M14.5 3.5H20.5V9.5"/><path d="M9.5 20.5H3.5V14.5"/><path d="M20.5 3.5L13.5 10.5"/><path d="M3.5 20.5L10.5 13.5"/></svg>
        </button>
        <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click.stop="closeTerm(w)">
          <svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
      <!-- A word about what just happened, inside this window. The app's own
           banner sits across the top of everything, which is the wrong place
           for something only this terminal did. -->
      <div v-if="w.toast" class="devwin-toast" :class="w.toast.kind" @click="w.toast = null">{{ w.toast.text }}</div>
      <!-- The same copy-and-paste row a device window has, for the screen
           terminals (SSH and the local shell). The line-at-a-time Telnet
           console has its own input, so it keeps out of this. -->
      <div class="devwin-bar term-bar" v-if="w.kind === 'ssh' || w.kind === 'shell'" @mousedown.stop>
        <button class="btn xs" :title="t('Copy whatever is selected, or the whole screen if nothing is')" @mousedown.prevent @click.stop="copyTerm(w)">
          <span class="ic"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></span><span class="lb">{{ t('Copy') }}</span>
        </button>
        <button class="btn xs" :title="t('Paste the clipboard into the terminal')" @mousedown.prevent @click.stop="pasteTerm(w)">
          <span class="ic"><svg viewBox="0 0 24 24"><path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M8.5 12h7"/><path d="M8.5 15.5h4.5"/></svg></span><span class="lb">{{ t('Paste') }}</span>
        </button>
        <!-- Meta onward lives in this menu, so the row stays a single line.
             An armed Meta or Ctrl still shows on the button itself, which is
             the one thing that must be visible while the menu is shut. -->
        <span class="term-menu-wrap">
          <button class="btn xs" :class="{active: w.meta || w.ctrl || w.keyMenu}" :title="t('Keys, and the terminal font')" @mousedown.prevent @click.stop="toggleKeyMenu(w, $event)">
            <span class="ic"><svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="11" rx="2"/><path d="M7.5 10.5h2"/><path d="M11.5 10.5h5"/><path d="M7.5 14h9"/></svg></span><span class="lb">{{ t('Keys') }}</span>
          </button>
          <div v-if="w.keyMenu" class="term-menu-veil" @click.stop="w.keyMenu = false" @contextmenu.prevent="w.keyMenu = false"></div>
          <div v-if="w.keyMenu" class="term-menu" :style="{ left: w.menuX + 'px', top: w.menuY + 'px' }" @mousedown.stop @click.stop>
            <div class="term-menu-head">{{ t('Send a key') }}</div>
            <div class="term-menu-keys">
              <button class="btn xs key wide" :class="{active: w.meta}" :title="t('Send the next key with Meta (Alt) held down')" @mousedown.prevent @click="toggleMeta(w)">{{ t('Meta') }}</button>
              <button class="btn xs key wide" :class="{active: w.ctrl}" :title="t('Send the next key with Ctrl held down')" @mousedown.prevent @click="toggleCtrl(w)">{{ t('Ctrl') }}</button>
              <button class="btn xs key" :title="t('Send Escape')" @mousedown.prevent @click="sendKey(w, 'esc')">Esc</button>
              <button class="btn xs key" :title="t('Send a Tab, to complete a name')" @mousedown.prevent @click="sendKey(w, 'tab')">Tab</button>
              <button class="btn xs key" :title="t('Interrupt what is running (Ctrl+C)')" @mousedown.prevent @click="sendKey(w, 'intr')">^C</button>
              <button class="btn xs key" :title="t('End of input (Ctrl+D)')" @mousedown.prevent @click="sendKey(w, 'eof')">^D</button>
              <button class="btn xs key" :title="t('Suspend what is running (Ctrl+Z)')" @mousedown.prevent @click="sendKey(w, 'susp')">^Z</button>
              <button class="btn xs key" :title="t('Clear the screen (Ctrl+L)')" @mousedown.prevent @click="sendKey(w, 'clear')">^L</button>
              <button class="btn xs key" :title="t('Search the command history (Ctrl+R)')" @mousedown.prevent @click="sendKey(w, 'search')">^R</button>
            </div>
          </div>
        </span>
        <!-- The size is set here, while looking at the screen it changes. The
             face itself is chosen once, and lives in Settings. -->
        <span class="term-sizer">
          <button class="btn xs ib" :title="t('Smaller')" :aria-label="t('Smaller')" :disabled="settings.termFontSize <= 9" @mousedown.prevent @click.stop="stepTermSize(-1)"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
          <span class="term-size mono">{{ settings.termFontSize }}px</span>
          <button class="btn xs ib" :title="t('Larger')" :aria-label="t('Larger')" :disabled="settings.termFontSize >= 24" @mousedown.prevent @click.stop="stepTermSize(1)"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
        </span>
        <span class="spacer"></span>
        <button class="btn xs" :title="t('Save the screen as a picture')" @mousedown.prevent @click.stop="shootTerm(w)">
          <span class="ic"><svg viewBox="0 0 24 24"><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="12" cy="12.7" r="3.4"/></svg></span><span class="lb">{{ t('Save screen') }}</span>
        </button>
        <button class="btn xs" :title="t('Copy the whole screen, including what has scrolled off')" @mousedown.prevent @click.stop="copyTerm(w, true)">
          <span class="ic"><svg viewBox="0 0 24 24"><path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h10"/></svg></span><span class="lb">{{ t('Copy all') }}</span>
        </button>
      </div>
      <!-- Telnet asks who you are before it will say anything useful, and PHP
           cannot hold the answer between requests, so it is kept here and sent
           with every line. -->
      <div class="term-signin" v-if="w.kind === 'telnet' && !w.signedIn">
        <input v-model="w.user" :placeholder="t('User name')" autocomplete="off" spellcheck="false" @keyup.enter="signInTerm(w)">
        <input v-model="w.password" type="password" :placeholder="t('Password')" autocomplete="off" @keyup.enter="signInTerm(w)">
        <button class="btn sm primary" :disabled="w.busy" @click="signInTerm(w)">{{ w.busy ? t('Connecting…') : t('Connect') }}</button>
        <span class="dim tiny">{{ t('Leave both empty if the device does not ask.') }}</span>
      </div>
      <!-- SSH gets a screen, not a transcript: one connection stays open and
           the far end draws on it, so vi, top and a password prompt all work
           exactly as they do at the machine itself. -->
      <div class="term-screen" v-if="w.kind === 'ssh' || w.kind === 'shell'" :ref="'screen' + w.id"></div>
      <div class="term-body" v-else :ref="'term' + w.id">
        <p class="dim tiny">{{ t('Each line is its own connection: it signs in, sends the line, reads the answer and hangs up. Telnet carries everything in the clear, this window included.') }}</p>
        <div v-for="(l,i) in w.lines" :key="i" :class="'term-line ' + l.kind"><span v-if="l.kind==='cmd'" class="term-prompt">{{ l.prompt }}</span>{{ l.text }}</div>
        <div v-if="w.busy" class="term-line dim">…</div>
      </div>
      <div class="term-input" v-if="w.kind === 'telnet' && w.signedIn">
        <span class="term-prompt mono">{{ termPrompt(w) }}</span>
        <input v-model="w.command" class="mono" autocomplete="off" spellcheck="false" :disabled="w.busy"
               @keydown.enter.prevent="sendTerm(w)" @keydown.up.prevent="termHistory(w, -1)" @keydown.down.prevent="termHistory(w, 1)">
      </div>
      <div class="devwin-grip" @mousedown.prevent.stop="startResize(w, $event)"></div>
    </div>

    <!-- ============ Nextcloud file picker ============ -->
    <div v-if="picker.open" class="drawer-backdrop centred" @click.self="picker.open=false">
      <div class="modal">
        <div class="drawer-head">
          <span class="ic big">📂</span>
          <div><strong>{{ t(picker.title) }}</strong><div class="dim tiny">{{ t('Your Nextcloud files') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="picker.open=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <div class="path-bar">
            <button class="btn xs" :disabled="picker.path===''" @click="pickerOpen(picker.parent || '')">↑ {{ t('Up') }}</button>
            <span class="mono dim">/{{ picker.path }}</span>
          </div>
          <table class="grid compact">
            <tbody>
              <tr v-for="e in picker.entries" :key="e.path" :class="{dir: e.directory}">
                <td>
                  <a v-if="e.directory" href="#" @click.prevent="pickerOpen(e.path)">📁 {{ e.name }}</a>
                  <a v-else href="#" @click.prevent="pickerChoose(e.path)">📄 {{ e.name }}</a>
                </td>
                <td class="mono dim">{{ e.directory ? '' : fmtBytes(e.size) }}</td>
                <td class="dim">{{ e.modified ? ago(e.modified) : '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!picker.entries.length" class="empty-hint">{{ t('This folder is empty.') }}</p>
        </div>
        <div class="drawer-foot">
          <span class="dim tiny">{{ picker.foldersOnly ? t('Choose the folder you are in, or open another.') : t('Click a file to choose it.') }}</span>
          <span class="spacer"></span>
          <button class="btn sm" @click="picker.open=false">{{ t('Cancel') }}</button>
          <button class="btn primary" v-if="picker.foldersOnly" @click="pickerChoose(picker.path)">{{ t('Use this folder') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ page preview ============ -->
    <div v-if="preview.open" class="drawer-backdrop centred" @click.self="closePreview">
      <div class="modal wide">
        <div class="drawer-head">
          <span class="ic big">🖼</span>
          <div>
            <strong>{{ t('Page preview') }}</strong>
            <div class="dim mono tiny">{{ preview.url }}</div>
          </div>
          <span class="spacer"></span>
          <a class="btn sm ib" :href="preview.url" target="_blank" rel="noopener noreferrer" :title="t('Only works from inside that network')" :aria-label="t('Only works from inside that network')"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/></svg></a>
          <button class="btn sm" :disabled="preview.loading" @click="reloadPreview">{{ t('Reload') }}</button>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="closePreview"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body preview-body">
          <p v-if="preview.loading" class="dim centred-text">{{ t('Rendering the page on the server…') }}</p>
          <p v-if="preview.error" class="empty-hint">⚠ {{ preview.error }}</p>
          <img v-show="!preview.loading && !preview.error" :src="preview.src" class="preview-shot" @load="preview.loading=false" @error="previewFailed" :alt="t('Page preview')">
        </div>
        <div class="drawer-foot">
          <label class="opt"><input type="checkbox" v-model="preview.full" @change="reloadPreview"> {{ t('Whole page, not just the first screen') }}</label>
          <span class="spacer"></span>
          <button class="btn primary" @click="closePreview">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ saved connection editor ============ -->
    <div v-if="keyAsk" class="drawer-backdrop centred topmost">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">🔑</span>
          <div><strong>{{ t('RegiBase master key') }}</strong><div class="dim">{{ t('Held for this browser session only.') }}</div></div>
        </div>
        <div class="drawer-body">
          <p class="dim">{{ t('Enter the RegiBase master key to use this connection. It is never stored: close the browser and it is gone.') }}</p>
          <input v-model="keyAskValue" type="password" class="grow mono" autocomplete="off" :placeholder="t('RegiBase master key')" @keyup.enter="unlockFromAsk()">
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn sm" @click="keyAsk=false; keyAskValue=''">{{ t('Cancel') }}</button>
          <button class="btn primary" :disabled="!keyAskValue || busy.connsetup" @click="unlockFromAsk()">{{ t('Unlock') }}</button>
        </div>
      </div>
    </div>

    <div v-if="connSetupModal" class="drawer-backdrop centred over-dialog" @click.self="connSetupModal=false">
      <div class="modal">
        <div class="drawer-head">
          <span class="ic big">🗄️</span>
          <div><strong>{{ t('Connection list for SSH, Telnet, FTP, SFTP and SCP') }}</strong><div class="dim">{{ t('Kept in RegiBase, in a collection of your own.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="connSetupModal=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <p class="note-line" v-if="connSetup && !connSetup.ready">
            {{ t('Connections used to be kept by NetBase itself. They are kept in RegiBase now, and any that were saved before this version are gone — please enter them again. A password there is sealed with your own master key, which this server never holds.') }}
          </p>
          <p class="dim" v-if="!connSetup">{{ t('Reading…') }}</p>
          <template v-else-if="!connSetup.available">
            <p class="note-line">{{ t('RegiBase is not installed on this server, so there is nowhere to keep a connection. You can still reach a server by typing its details each time.') }}</p>
          </template>
          <template v-else-if="!connSetup.encrypted">
            <p class="note-line">{{ t('Set a master key in RegiBase first. Without one, a password would be stored as plain text.') }}</p>
          </template>
          <template v-else>
            <h3>{{ t('RegiBase master key') }}</h3>
            <p class="dim">{{ t('Held for this browser session only and never stored — not in these settings, not anywhere on this server.') }}</p>
            <template v-if="!connSetup.unlocked">
              <p class="dim tiny">{{ t('Enter the master key to change these settings') }}</p>
              <div class="fl-row">
                <input v-model="connMaster" type="password" class="grow mono" autocomplete="new-password" :placeholder="t('RegiBase master key')" @keyup.enter="unlockConns()">
                <button class="btn sm" :disabled="!connMaster || busy.connsetup" @click="unlockConns()">{{ t('Unlock') }}</button>
              </div>
            </template>
            <button class="btn sm" v-else @click="lockConns()">{{ t('Forget it now') }}</button>

            <p class="dim tiny">{{ t('Each kind is kept in its own collection. Choosing the same collection for several kinds is perfectly fine — SSH and SCP are usually the same list.') }}</p>
            <p class="note-line" v-if="!connSetup.unlocked">{{ t('Changing where connections are kept needs the master key. You will be asked for it when you save.') }}</p>

            <!-- Four kinds, four tabs, two to a row. Stacked one under another
                 the dialog ran far past the bottom of the screen and the one
                 being worked on was never wholly in view; behind a single
                 selector, three of the four were invisible and there was no
                 telling what was set up. The tabs say both at once: which one
                 is open, and which of the others still need doing. -->
            <div class="set-tabs" role="tablist">
              <button v-for="(g, key) in (connSetup.groups || {})" :key="key"
                      class="set-tab" :class="{active: connGroup === key}"
                      role="tab" :aria-selected="connGroup === key" :title="t(g.label)"
                      @click="connGroup = key">
                {{ t(g.label) }}<span class="dot-todo" :class="{gone: g.gone}" v-if="!g.ready" :title="g.gone ? t('its collection is gone') : t('not set up yet')"></span>
              </button>
            </div>

            <section class="set-group" v-for="(g, key) in (connSetup.groups || {})" :key="key" v-show="connGroup === key">
              <h3>{{ t(g.label) }} <span class="dim tiny" v-if="!g.ready">— {{ g.gone ? t('its collection is gone') : t('not set up yet') }}</span></h3>
              <p class="note-line" v-if="g.gone">{{ t('The RegiBase collection this was kept in has been deleted. Choose another one below, or make a new one — the connections that were in it are gone with it.') }}</p>
              <label class="fl">
                <span class="fl-label">{{ t('RegiBase collection') }}</span>
                <select :value="g.collection || 0" @change="setConnCollection(key, $event.target.value)">
                  <option :value="0">{{ t('Not chosen yet') }}</option>
                  <option v-for="c in (connSetup.collections || [])" :key="c.id" :value="c.id">{{ c.name }} — {{ c.records }}</option>
                </select>
              </label>
              <div class="fl-row">
                <input v-model="connNewName[key]" class="grow" :placeholder="t('Name for a new collection')">
                <button class="btn sm" @click="makeConnCollection(key)">{{ t('Create new') }}</button>
              </div>
              <template v-if="g.collection">
                <h4>{{ t('Field assignment') }}</h4>
                <p class="dim tiny">{{ t('Tell NetBase which field to use for each part of a connection. Only the host is required; anything left unset is not stored.') }}</p>
                <div class="map-grid">
                  <label class="fl" v-for="(meta, slot) in connSetup.slots" :key="slot">
                    <span class="fl-label">{{ t(meta.label) }}<span v-if="meta.secret"> 🔒</span></span>
                    <select :value="connMapValue(key, slot)" @change="setConnMap(key, slot, $event.target.value)">
                      <option value="">{{ t('Not stored') }}</option>
                      <option v-for="f in connFieldsFor(key, meta.secret)" :key="f.key" :value="f.key">{{ f.label || f.key }}</option>
                    </select>
                  </label>
                </div>
                <div class="fl-row">
                  <span class="spacer"></span>
                  <button class="btn primary" :disabled="busy.connsetup" @click="saveConnMapping(key)">{{ t('Save') }}</button>
                </div>
              </template>
            </section>
            <p class="dim tiny">{{ t('The marked ones can only be matched to a field RegiBase treats as secret, so a password is never written in the clear.') }}</p>
          </template>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn sm" @click="connSetupModal=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <div v-if="connModal" class="drawer-backdrop centred">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">🔗</span>
          <div><strong>{{ connForm.id ? t('Edit connection') : t('New connection') }}</strong><div class="dim">{{ t('Saved for your account only. The password is encrypted on the server and never sent back to the browser.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="connModal=false"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <p class="note-line" v-if="connSetup && !connSetup.ready">
            {{ t('There is nowhere to keep this yet.') }}
            <button class="btn xs" @click="openConnSetup()">{{ t('Choose where') }}</button>
          </p>
          <p class="note-line" v-else-if="connSetup && !connSetup.unlocked">
            {{ t('The RegiBase master key is needed before a password can be saved.') }}
            <button class="btn xs" @click="keyAsk = true">{{ t('Enter it') }}</button>
          </p>
          <label class="fl"><span class="fl-label">{{ t('Type') }}</span>
            <select v-model="connForm.kind" @change="connKindChanged">
              <option v-for="(k,id) in offeredKinds" :key="id" :value="id">{{ t(k.label) }}</option>
            </select>
          </label>
          <label class="fl"><span class="fl-label">{{ t('Name') }}</span><input v-model="connForm.name" :placeholder="t('Office file server')"></label>
          <div class="fl-row">
            <label class="fl grow"><span class="fl-label">{{ t('Host') }}</span><input v-model="connForm.host" placeholder="server.example.com"></label>
            <label class="fl short"><span class="fl-label">{{ t('Port') }}</span><input v-model.number="connForm.port" type="number" min="1" max="65535"></label>
          </div>
          <!-- A mail account has two of these, one for each direction. Naming
               them both "Encryption" left the reader to guess which was which. -->
          <label class="fl" v-if="connModes.length > 1"><span class="fl-label">{{ connForm.kind==='imap' || connForm.kind==='pop3' ? t('Incoming encryption') : t('Encryption') }}</span>
            <select v-model="connForm.mode">
              <option v-for="m in connModes" :key="m" :value="m">{{ t(modeLabel(m)) }}</option>
            </select>
          </label>
          <label class="fl" v-if="connForm.kind==='sftp' || connForm.kind==='ssh'"><span class="fl-label">{{ t('Sign in with') }}</span>
            <select v-model="connForm.authType">
              <option value="password">{{ t('Password') }}</option>
              <option value="key">{{ t('Private key') }}</option>
            </select>
          </label>
          <div class="fl-row">
            <label class="fl grow"><span class="fl-label">{{ t('User name') }}</span><input v-model="connForm.username" autocomplete="off"></label>
            <label class="fl grow" v-if="connForm.authType !== 'key'"><span class="fl-label">{{ connForm.id && connForm.hasSecret ? t('Password (leave blank to keep)') : t('Password') }}</span><input v-model="connForm.secret" type="password" autocomplete="new-password"></label>
            <label class="fl grow" v-else><span class="fl-label">{{ t('Key passphrase (if any)') }}</span><input v-model="connForm.passphrase" type="password" autocomplete="new-password"></label>
          </div>
          <template v-if="connForm.authType === 'key'">
            <label class="fl"><span class="fl-label">{{ t('Key file in your Nextcloud files') }}</span>
              <span class="with-button">
                <input v-model="connForm.privateKeyPath" class="mono" placeholder="Keys/id_ed25519">
                <button class="btn sm" @click="pickFile(t('Choose a key file'), (p) => { connForm.privateKeyPath = p; }, false, settings.keyFolder)">📂 {{ t('Browse…') }}</button>
              </span>
            </label>
            <p class="dim">{{ t('Give the path of the private key inside your own Nextcloud files — the one without .pub. The server reads it when you save; the key itself never passes through the browser. Or paste it below instead.') }}</p>
            <label class="fl"><span class="fl-label">{{ connForm.id && connForm.hasSecret ? t('Private key (leave blank to keep)') : t('Private key (paste)') }}</span>
              <textarea v-model="connForm.privateKey" rows="4" class="mono tiny" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
            </label>
          </template>
          <!-- The sending half of a mail account. One address is one record, so
               the fields above are where it is read and these are where it is
               sent from; the user name and password above serve both. -->
          <template v-if="connForm.kind==='imap' || connForm.kind==='pop3'">
            <p class="dim">{{ t('The fields above are where this address is read. Below is where it sends from — the same user name and password.') }}</p>
            <div class="fl-row">
              <label class="fl grow"><span class="fl-label">{{ t('Outgoing server (blank if the same)') }}</span><input v-model="connForm.sendHost" placeholder="smtp.example.com"></label>
              <label class="fl short"><span class="fl-label">{{ t('Outgoing port') }}</span><input v-model.number="connForm.sendPort" type="number" min="1" max="65535"></label>
            </div>
            <label class="fl"><span class="fl-label">{{ t('Outgoing encryption') }}</span>
              <select v-model="connForm.sendMode">
                <option value="starttls">STARTTLS</option>
                <option value="tls">SSL/TLS</option>
                <option value="none">{{ t('No encryption') }}</option>
              </select>
            </label>
          </template>
          <label class="fl" v-if="connForm.kind==='smtp' || connForm.kind==='imap' || connForm.kind==='pop3'"><span class="fl-label">{{ t('Sender address') }}</span><input v-model="connForm.from" placeholder="notify@example.com"></label>
          <label class="fl" v-if="connForm.kind==='ftp' || connForm.kind==='sftp'"><span class="fl-label">{{ t('Start folder') }}</span><input v-model="connForm.path" class="mono" placeholder="/"></label>
          <label class="opt" v-if="connForm.kind==='ftp'"><input type="checkbox" v-model="connForm.passive"> {{ t('Passive mode (usually right)') }}</label>
          <label class="fl"><span class="fl-label">{{ t('Notes') }}</span><textarea v-model="connForm.notes" rows="2"></textarea></label>
          <p v-if="connNote" class="note-line">{{ connNote }}</p>
        </div>
        <div class="drawer-foot">
          <button class="btn danger sm" v-if="connForm.id" @click="deleteConn(connForm)">{{ t('Delete') }}</button>
          <span class="spacer"></span>
          <button class="btn sm" @click="connModal=false">{{ t('Cancel') }}</button>
          <button class="btn primary" :disabled="busy.conn" :class="{working: busy.conn}" @click="saveConn">{{ t('Save') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ device drawer ============ -->
    <div v-if="selected" class="drawer-backdrop" @click.self="selected=null">
      <div class="drawer">
        <div class="drawer-head">
          <span class="ic big">{{ icon(selected) }}</span>
          <div>
            <div class="dev-title" :class="{unnamed: !(selected.label || selected.hostname)}">{{ selected.label || selected.hostname || selected.ip }}</div>
          </div>
          <span class="spacer"></span>
          <!-- The whole record, and below, each row on its own: a device is
               quoted into a ticket or a stock list far more often than it is
               read on the screen. -->
          <button class="btn xs ib" :title="t('Copy everything about this device')" :aria-label="t('Copy all')" @click="copyDevice(selected)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button>
          <button class="btn xs ib" :title="t('Close')" :aria-label="t('Close')" @click="selected=null"><svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="drawer-body">
          <div class="kv">
            <!-- Name first, and as a bordered field so it is clearly the one
                 thing here you fill in yourself; then the address, MAC and
                 vendor, top to bottom. -->
            <div class="kv-edit"><span>{{ t('Name') }}</span>
              <input v-if="allowed('scan')" class="kv-input" v-model="editLabel" :placeholder="selected.hostname || selected.ip" :title="t('A name you give this device. It is kept against the device (its MAC) and shown in place of the obtained name, so you can tell a device apart even when it reports no name of its own.')">
              <code v-else>{{ selected.label || '—' }}</code>
            </div>
            <div><span>{{ t('IPv4') }} / {{ t('Netmask') }}</span><code>{{ selected.ip }}<span class="dim" v-if="netmaskFor(selected)"> / {{ netmaskFor(selected) }}</span></code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('IPv4'), selected.ip)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('MAC address') }}</span><code>{{ selected.mac || t('no MAC') }}</code><button v-if="selected.mac" class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('MAC address'), selected.mac)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('Vendor') }}</span><code>{{ vendorText(selected) }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Vendor'), vendorText(selected))"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('Reported name') }}</span><code>{{ selected.hostname || '—' }}<span class="dim src-tag" v-if="selected.hostname && nameSource(selected)"> · {{ nameSource(selected) }}</span></code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Reported name'), selected.hostname)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div v-if="selected.workgroup"><span>{{ t('Workgroup') }}</span><code>{{ selected.workgroup }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Workgroup'), selected.workgroup)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('Open ports') }}</span><code>
              <template v-for="(p,i) in selected.ports" :key="p">
                <a v-if="portLink(selected, p)" href="#" :title="portLink(selected, p).title" @click.prevent="openDeviceWindow(selected, p)">{{ p }}</a>
                <a v-else-if="portTool(selected, p)" href="#" :title="portTool(selected, p).title" @click.prevent="openPortTool(selected, p)">{{ p }}</a>
                <span v-else>{{ p }}</span><span v-if="i < selected.ports.length - 1">, </span>
              </template>
              <span v-if="!selected.ports.length">—</span>
            </code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Open ports'), selected.ports.join(', '))"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('Found by') }}</span><code>{{ selected.sources.join(', ') }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Found by'), selected.sources.join(', '))"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('First seen') }}</span><code>{{ stamp(selected.firstSeen) }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('First seen'), stamp(selected.firstSeen))"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div><span>{{ t('Last seen') }}</span><code>{{ stamp(selected.lastSeen) }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Last seen'), stamp(selected.lastSeen))"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div v-if="selected.extra && selected.extra.mdns"><span>mDNS</span><code>{{ selected.extra.mdns }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField('mDNS', selected.extra.mdns)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div v-if="selected.extra && selected.extra.rdns"><span>{{ t('Reverse DNS') }}</span><code>{{ selected.extra.rdns }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Reverse DNS'), selected.extra.rdns)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
            <div v-if="selected.extra && selected.extra.ssdp"><span>SSDP</span><code class="wrap">{{ selected.extra.ssdp }}</code><button class="btn xs ib copy-one" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField('SSDP', selected.extra.ssdp)"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button></div>
          </div>
          <template v-if="allowed('scan')">
            <div class="fl"><span class="fl-label">{{ t('Type') }}</span>
              <div class="type-pick">
                <select v-if="editType !== customType" v-model="editType" :aria-label="t('Type')" @change="focusOwnType($event)"><option v-for="(l,k) in typeLabels" :key="k" :value="k">{{ t(l) }}</option><option :value="customType">{{ t('Other (enter your own)') }}</option></select>
                <span v-else class="type-own">
                  <input v-model="editTypeText" maxlength="32" :placeholder="t('Enter a type')" :aria-label="t('Enter a type')" @keydown.esc.stop="editType = typeBack(selected.type)">
                  <button type="button" class="btn xs ib type-back" :title="t('Choose from the list')" :aria-label="t('Choose from the list')" @click="editType = typeBack(selected.type)"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
                </span>
              </div>
            </div>
            <label class="fl"><span class="fl-label">{{ t('Notes') }}</span><textarea v-model="editNotes" rows="2"></textarea></label>
          </template>
          <div class="kv" v-else-if="selected.notes">
            <div v-if="selected.notes"><span>{{ t('Notes') }}</span><code class="wrap">{{ selected.notes }}</code></div>
          </div>
          <div class="drawer-tools">
            <div class="tool-line" v-for="l in webLinks(selected)" :key="l.href">
              <button class="btn sm" v-if="allowed('preview')" @click="openDeviceWindow(selected, l.port)">🖥 {{ l.label }}</button>
              <button class="btn sm ib" v-if="allowed('preview') && status.preview" :title="t('Show the page')" :aria-label="t('Show the page')" @click="showPage(l.href)">🖼</button>
              <a class="btn sm ib" :href="l.href" target="_blank" rel="noopener noreferrer" :title="t('Only works from inside that network')" :aria-label="t('Only works from inside that network')"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/></svg></a>
            </div>
          </div>
          <!-- A device on another network answers nothing, so the two
               searches below would report "nothing found" when the truth is
               "never asked". Say which it is, and say what would fix it. -->
          <div class="away-note" v-if="offNetwork(selected)">
            <p><strong>{{ t('This device is not on the same network as the Nextcloud server.') }}</strong>
              {{ t('To connect to its address or scan its ports, the Nextcloud server needs an address on the same network as this device.') }}</p>
            <p>{{ t('Open a console over SSH or similar and run the following command with administrator privileges.') }}</p>
            <div class="away-cmd">
              <code class="mono">{{ joinCommand(selected) }}</code>
              <button class="btn xs ib" :title="t('Copy this')" :aria-label="t('Copy this')" @click="copyField(t('Command'), joinCommand(selected))"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6"/></svg></button>
            </div>
            <p class="away-act" v-if="serverAddress && allowed('sshexec')">
              <button class="btn sm" @click="askSsh(serverAddress, 22)">🖳 {{ t('Open an SSH window') }}</button>
            </p>
            <p class="hint">{{ t('Note that the setting is erased when the server restarts.') }}</p>
          </div>
          <div class="drawer-tools device">
            <!-- Asking this one device what a sweep has no time to ask: every
                 port it has, and which of those are really web pages. -->
            <button class="btn sm" v-if="allowed('scan')" :disabled="!!deep.busy || offNetwork(selected)" @click="scanAllPorts(selected)">
              🔎 {{ deep.busy === 'ports' ? t('Scanning… {done}%', { done: deep.percent }) : t('Scan every port') }}
            </button>
            <button class="btn sm" v-if="allowed('scan')" :disabled="!!deep.busy || !selected.ports.length || offNetwork(selected)" @click="findWebPages(selected)">
              🌐 {{ deep.busy === 'web' ? t('Looking…') : t('Find web pages') }}
            </button>
            <!-- A device's page is not always on a port the scan noticed, and
                 a maker is free to put it anywhere, so the number can simply
                 be typed. -->
            <span class="port-open" v-if="allowed('preview')" :title="t('Opens a page on this device at a port of your choosing, through this server.')">
              <input v-model="openPort" class="tiny" inputmode="numeric" :placeholder="t('Port')" :aria-label="t('Port')" @keyup.enter="openTypedPort">
              <select v-model="openScheme" :aria-label="t('Protocol')">
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
              <button class="btn sm" :disabled="!openPortReady" @click="openTypedPort">🖥 {{ t('Open this port') }}</button>
            </span>
            <button class="btn sm" v-if="selected.mac && allowed('wol')" @click="wake(selected)">⏻ {{ t('Wake on LAN') }}</button>
          </div>
          <!-- What the two searches came back with, for this device. -->
          <div class="deep-result" ref="deepResult" v-if="deep.note || deep.pages.length">
            <p class="hint" v-if="deep.note">{{ deep.note }}</p>
            <div class="kv" v-if="deep.pages.length">
              <div v-for="page in deep.pages" :key="page.port">
                <span class="mono">{{ page.scheme }} · {{ page.port }}</span>
                <code>{{ page.title || page.server || t('a page') }}<button class="btn xs" v-if="allowed('preview')" @click="openDeviceWindow(selected, page.port, page.scheme)">{{ t('Open') }}</button></code>
              </div>
            </div>
          </div>
        </div>
        <div class="drawer-foot">
          <button class="btn danger sm" v-if="allowed('scan')" @click="removeDevice(selected)">{{ t('Forget this device') }}</button>
          <span class="spacer"></span>
          <button class="btn sm" @click="selected=null">{{ allowed('scan') ? t('Cancel') : t('Close') }}</button>
          <button class="btn primary" v-if="allowed('scan')" @click="saveDevice">{{ t('Save') }}</button>
        </div>
      </div>
    </div>
  </div>`;

  const TABS = [
    { id: 'devices', icon: '🛰️', label: 'Devices', hint: 'Everything answering on the local network' },
    { id: 'dns', icon: '🌐', label: 'DNS', hint: 'Records of any type, resolver comparison, delegation and zone transfer' },
    { id: 'whois', icon: '📇', label: 'Whois', hint: 'Domain and address registration' },
    // NETBASE-STORE-REMOVED: the ping and ports tabs
    // { id: 'ping', icon: '📡', label: 'Ping & traceroute', hint: 'Reachability and the path there' },
    // { id: 'ports', icon: '🔌', label: 'Ports', hint: 'TCP connect check with banners' },
    { id: 'tls', icon: '🔒', label: 'TLS & HTTP', hint: 'Certificates, redirects and headers' },
    { id: 'subnet', icon: '🧮', label: 'Subnet & MAC', hint: 'Address maths and vendor lookup' },
    { id: 'bench', icon: '⏱️', label: 'Benchmarks', hint: 'Throughput, latency and where the time goes' },
    { id: 'mail', icon: '📧', label: 'Mail', hint: 'Domain policy, server tests and a real test message' },
    { id: 'files', icon: '📁', label: 'File transfer', hint: 'Browse a remote server and move files' },
    { id: 'ssh', icon: '🔐', label: 'SSH & Telnet', hint: 'What a service offers, and commands on the servers you keep' },
    { id: 'ntp', icon: '🕒', label: 'Clock check', hint: 'How far the clock has drifted from a time server' },
    // NETBASE-STORE-REMOVED: the nmap tab
    // { id: 'nmap', icon: '🗺️', label: 'nmap', hint: 'Presets over the nmap scanner' },
  ];

  const DNS_VIEWS = [
    { id: 'records', label: 'Records' },
    { id: 'advanced', label: 'Any type, any resolver' },
    { id: 'compare', label: 'Resolver comparison' },
    { id: 'trace', label: 'Delegation trace' },
    { id: 'axfr', label: 'Zone transfer' },
  ];
  const DNS_ALL_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR', 'TLSA', 'DS', 'DNSKEY', 'SSHFP', 'NAPTR', 'HTTPS', 'SVCB', 'ANY'];
  /**
   * Every prefix a network can be cut into, not just the handful around a /24.
   * The server refuses a split that would make more than a thousand networks,
   * and says so plainly, so there is nothing to be gained by hiding the rest.
   */
  const SPLIT_PREFIXES = Array.from({ length: 25 }, (unused, i) => i + 8);
  // NETBASE-STORE-REMOVED: the port-check presets
//   const PORT_PRESETS = [
//     { label: 'Common', ports: '21,22,23,25,53,80,110,139,143,443,445,587,993,995,3389,8080' },
//     { label: 'Web', ports: '80,443,8000,8008,8080,8443,8888' },
//     { label: 'Mail', ports: '25,110,143,465,587,993,995' },
//     { label: 'Databases', ports: '1433,1521,3306,5432,6379,9200,27017' },
//     { label: 'Remote access', ports: '22,23,3389,5900,5901' },
//     { label: 'Printers and NAS', ports: '139,445,515,631,5000,5001,9100' },
//   ];
//
  // Ports a browser can open directly, and what scheme to use.
  // Ports that answer something other than a web page: opening a window on one
  // would only ever show an error, so the number stays a number.
  const NOT_WEB_PORTS = new Set([
    21, 22, 23, 25, 53, 67, 68, 69, 110, 111, 119, 123, 135, 137, 138, 139, 143, 161, 162,
    179, 389, 427, 445, 465, 514, 515, 543, 544, 548, 554, 587, 593, 623, 636, 873, 993,
    995, 1080, 1194, 1433, 1521, 1723, 1812, 1813, 1900, 2049, 3260, 3306, 3389, 5060,
    5061, 5432, 5900, 5901, 5902, 6379, 9100, 11211, 27017,
  ]);

  // Time servers worth offering: the pools, the big anycast ones, and the
  // national services people in each region actually use.
  const NTP_SERVERS = [
    { host: 'pool.ntp.org', label: 'NTP Pool (worldwide)' },
    { host: 'time.cloudflare.com', label: 'Cloudflare' },
    { host: 'time.google.com', label: 'Google' },
    { host: 'time.windows.com', label: 'Microsoft' },
    { host: 'time.apple.com', label: 'Apple' },
    { host: 'time.nist.gov', label: 'NIST (United States)' },
    { host: 'ntp.nict.jp', label: 'NICT (Japan)' },
    { host: 'ntp.jst.mfeed.ad.jp', label: 'INTERNET MULTIFEED (Japan)' },
    { host: 'ptbtime1.ptb.de', label: 'PTB (Germany)' },
    { host: 'ntp1.npl.co.uk', label: 'NPL (United Kingdom)' },
    { host: 'europe.pool.ntp.org', label: 'NTP Pool (Europe)' },
    { host: 'asia.pool.ntp.org', label: 'NTP Pool (Asia)' },
    { host: 'north-america.pool.ntp.org', label: 'NTP Pool (North America)' },
    { host: 'oceania.pool.ntp.org', label: 'NTP Pool (Oceania)' },
    { host: 'south-america.pool.ntp.org', label: 'NTP Pool (South America)' },
    { host: 'africa.pool.ntp.org', label: 'NTP Pool (Africa)' },
  ];

  // Resolvers to ask by name rather than by remembering an address.
  const KNOWN_RESOLVERS = [
    { host: '', label: 'This server' },
    { host: '1.1.1.1', label: 'Cloudflare' },
    { host: '1.0.0.1', label: 'Cloudflare (secondary)' },
    { host: '8.8.8.8', label: 'Google' },
    { host: '8.8.4.4', label: 'Google (secondary)' },
    { host: '9.9.9.9', label: 'Quad9' },
    { host: '149.112.112.112', label: 'Quad9 (secondary)' },
    { host: '208.67.222.222', label: 'OpenDNS' },
    { host: '208.67.220.220', label: 'OpenDNS (secondary)' },
    { host: '94.140.14.14', label: 'AdGuard' },
    { host: '76.76.2.0', label: 'Control D' },
    { host: '185.228.168.9', label: 'CleanBrowsing' },
  ];

  // The steps a device window zooms through, either side of its own size.
  const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  const WEB_PORTS = {
    80: 'http', 81: 'http', 591: 'http', 631: 'http', 2082: 'http', 3000: 'http', 5000: 'http',
    7080: 'http', 8000: 'http', 8008: 'http', 8080: 'http', 8081: 'http', 8888: 'http', 9000: 'http', 9090: 'http',
    443: 'https', 2083: 'https', 2087: 'https', 4443: 'https', 5001: 'https', 8006: 'https', 8443: 'https',
    9443: 'https', 10000: 'https',
  };
  // Ports NetBase itself can act on, so the number opens the right tool.
  const TOOL_PORTS = {
    21: { tab: 'files', kind: 'ftp', label: 'Open in FTP' },
    22: { tab: 'ssh', kind: 'sftp', label: 'Inspect SSH' },
    23: { tab: 'ssh', kind: null, label: 'Try Telnet' },
    25: { tab: 'mail', protocol: 'smtp', label: 'Test this mail server' },
    143: { tab: 'mail', protocol: 'imap', label: 'Test this mail server' },
    465: { tab: 'mail', protocol: 'smtp', label: 'Test this mail server' },
    587: { tab: 'mail', protocol: 'smtp', label: 'Test this mail server' },
    993: { tab: 'mail', protocol: 'imap', label: 'Test this mail server' },
    995: { tab: 'mail', protocol: 'pop3', label: 'Test this mail server' },
  };

  const MAIL_VIEWS = [
    { id: 'domain', label: 'Domain policy' },
    { id: 'server', label: 'Server test' },
    { id: 'send', label: 'Send and receive' },
  ];
  // One click for the ports people actually mean.
  const MAIL_PRESETS = [
    { label: 'SMTP 25', protocol: 'smtp', port: 25, mode: 'starttls' },
    { label: 'Submission 587', protocol: 'smtp', port: 587, mode: 'starttls' },
    { label: 'SMTPS 465', protocol: 'smtp', port: 465, mode: 'tls' },
    { label: 'IMAPS 993', protocol: 'imap', port: 993, mode: 'tls' },
    { label: 'IMAP 143', protocol: 'imap', port: 143, mode: 'starttls' },
    { label: 'POP3S 995', protocol: 'pop3', port: 995, mode: 'tls' },
  ];
  // The two language lists are always empty in practice, so they have no label
  // and the table skips them.
  const ALGO_LABELS = {
    kex: 'Key exchange', hostKey: 'Host key', encryptionClientToServer: 'Ciphers (to server)',
    encryptionServerToClient: 'Ciphers (from server)', macClientToServer: 'Integrity (to server)',
    macServerToClient: 'Integrity (from server)', compressionClientToServer: 'Compression (to server)',
    compressionServerToClient: 'Compression (from server)',
  };

  // Appearance is a personal preference: it themes NetBase for one account and
  // never touches Nextcloud itself. 'auto' reads the colour Nextcloud is using.
  const THEME_OPTIONS = [
    { id: 'auto', label: 'Default (match Nextcloud)', hint: 'Follows whatever theme Nextcloud is using' },
    { id: 'light', label: 'Light', hint: 'Always light, whatever Nextcloud does' },
    { id: 'dark', label: 'Dark', hint: 'Always dark, whatever Nextcloud does' },
  ];

  const app = createApp({
    template: TEMPLATE,
    data() {
      return {
        version: '', tab: 'devices', banner: null, noteTimer: null, authenticated: true,
        // On a narrow screen the tool list is a drawer rather than a column,
        // and a device's page fills the screen instead of floating over it.
        menu: false, narrow: window.innerWidth <= 900,
        status: { canScan: false, canLookup: false, isAdmin: false, binaries: {}, nmap: { available: false }, ouiEntries: 0, targets: [] },
        settings: { language: 'auto', theme: 'auto', languages: [], tabOrder: [], keyFolder: '', rootIdleMinutes: 10, termFont: 'system', termFontSize: TERM_SIZE_DEFAULT, shellLang: '', shellEnv: '', shellLocales: [], termLogOn: false, termLogSteps: 5000, termLogDays: 30 },
        termFonts: TERM_FONTS,
        dragTab: '', overTab: '',
        devices: [], scan: null, scanning: false, advice: null,
        scanTargets: '', pace: '1500',
        // The ARP table to begin with: it answers in seconds, and walking a
        // whole network is a deliberate thing to ask for.
        scanWhat: 'arp',
        // Reading the neighbour table is on to begin with: it answers at once,
        // out of what this server has already spoken to, and a sweep is a
        // deliberate thing to ask for rather than the first thing that happens.
        opts: { names: true, multicast: true, ports: true, portScan: 'common', portWait: 0.9, rdns: true },
        openPort: '', openScheme: 'http',
        // One device asked about itself: which search is running, how far it
        // has got, and what it came back with.
        deep: { busy: '', percent: 0, note: '', pages: [] },
        filter: '', onlyOnline: true, sortKey: 'ip', sortDir: 1,
        selected: null, editLabel: '', editNotes: '', editType: 'unknown', editTypeText: '', customType: CUSTOM_TYPE,
        shellModal: false, shellStage: 'idle', shellCode: '', shellEmail: '', shellError: '', shellBusy: false,
        busy: {},
        dnsHost: '', dnsWanted: ['A', 'AAAA', 'MX', 'NS', 'TXT'], dnsResult: null,
        dnsView: 'records', dnsViews: DNS_VIEWS, dnsAllTypes: DNS_ALL_TYPES,
        dnsType: 'A', dnsServer: '', dnsDnssec: false, dnsQueryResult: null,
        dnsCompareResult: null, dnsTraceResult: null,
        axfrZone: '', axfrServer: '', axfrResult: null,
        tlsVersionsResult: null,
        // NETBASE-STORE-REMOVED: tcpPingPort: 443, tcpPingResult: null, mtuResult: null,
        splitCidr: '', splitPrefix: 26, splitPrefixes: SPLIT_PREFIXES, splitResult: null,
        aggregateInput: '', aggregateResult: null,
        // NETBASE-STORE-REMOVED: portPresets: PORT_PRESETS,
        sshPreset: '', sshCommand: '', sshRunResult: null,
        sshAdhoc: { kind: 'ssh', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh' },
        // A sign-in asked for on the spot, from wherever a console is needed —
        // the notice about a device on another network, for one, where the
        // command has to be run on this server and nowhere else.
        sshAsk: { open: false, host: '', port: 22, username: '', authType: 'password', secret: '', privateKeyPath: '', passphrase: '' },
        dnsTypes: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA'],
        whoisQuery: '', whoisResult: null,
        availDomains: '', availResults: [],
        availTier: 'core', availTiers: {}, availProgress: { done: 0, total: 0 },
        // Two slide switches over the results: taken (×) shown by default,
        // undetermined (?) hidden by default so the list leads with what is free
        // or clearly taken, not the ones that could not be checked.
        availShowTaken: true, availShowUnknown: false,
        editReg: false, editRegRows: [],
        arpHelp: false,
        // NETBASE-STORE-REMOVED: pingHost: '', pingResult: null, traceResult: null,
        // NETBASE-STORE-REMOVED: portHost: '', portList: '', portResult: null,
        tlsHost: '', tlsPort: 443, tlsResult: null, httpResult: null,
        subnetInput: '', subnetResult: null, macInput: '', macResult: null, macTimer: null,
        // An address is four numbers and a prefix; typing it that way beats
        // typing punctuation. The free-text boxes stay for IPv6 and ranges.
        calcAddress: { octets: ['', '', '', ''], prefix: 24 },
        subnetFreeText: false, aggregateFreeText: false,
        ipRows: [{ octets: ['', '', '', ''], prefix: 24 }],
        splitAddress: { octets: ['', '', '', ''], prefix: 16 },
        prefixes: Array.from({ length: 33 }, (unused, i) => i),
        recentHosts: (() => { try { return JSON.parse(localStorage.getItem('netbase-recent-hosts') || '[]'); } catch (e) { return []; } })(),
        // saved connections (FTP / SFTP / mail accounts)
        connections: [], connKinds: {}, connGroups: {}, connCaps: {}, connModal: false, connNote: '',
        // Which type the file transfer screen is set to. It picks the list as
        // well as the protocol, because the two are stored apart.
        filesKind: 'sftp',
        // Where connections are kept: the RegiBase collection, the mapping of
        // its fields, and the master key — held for this session, never stored.
        // Which of the four kinds the dialog is showing. The tabs make the
        // other three reachable in one press, so nothing is hidden by it.
        connGroup: 'ssh',
        connSetup: null, connSetupModal: false, connMaster: '', connMapDraft: {}, connNewName: {},
        // Asked for at the moment a connection needs it, never kept.
        keyAsk: false, keyAskValue: '',
        // What to do once the key has been given. Asking for it and then doing
        // nothing looked, from the outside, exactly like the key being refused.
        keyAskRetry: null,
        // sendHost / sendPort / sendMode are the outgoing half of a mail
        // account. They are here rather than only on mail forms because a
        // v-model with nothing behind it writes to an object nobody reads.
        connForm: { id: 0, kind: 'ftp', name: '', host: '', port: 22, mode: 'ssh', username: '', secret: '', authType: 'password', privateKey: '', privateKeyPath: '', passphrase: '', from: '', path: '', passive: true, sendHost: '', sendPort: 0, sendMode: 'starttls', notes: '', hasSecret: false },
        // mail
        mailView: 'domain', mailViews: MAIL_VIEWS, mailPresets: MAIL_PRESETS,
        mailDomain: '', mailSelectors: '', mailBlocklists: true, mailAudit: null,
        mailHost: '', mailPort: 0, mailProtocol: 'smtp', mailMode: 'auto', mailProbeResult: null,
        relayHost: '', relayPort: 25, relayResult: null, blIp: '', blResult: null,
        // One address, one choice. Sending and receiving are two halves of the
        // same account, so they are chosen once — typed in or picked from the
        // list, the same way the SSH and file transfer screens ask it.
        acctMode: 'type',
        mailAccountId: 0,
        // The receiving side first, because that is the account; the sending
        // side after it, sharing the user name and the password.
        mailAdhoc: {
          kind: 'imap', host: '', port: 993, mode: 'tls',
          username: '', secret: '',
          sendHost: '', sendPort: 587, sendMode: 'starttls', from: '',
        },
        sendTo: '', sendSubject: '', sendBody: '', sendResult: null,
        mailboxResult: null,
        // file transfer
        // Typed in, or chosen from the list — the same choice the SSH screen
        // offers, in the same order and with the same default.
        filesMode: 'type', filesPick: '',
        // The row under the pointer, and what the list is sorted by.
        filePicked: '', fileSort: { by: 'name', desc: false },
        fileMenu: { open: false, x: 0, y: 0, entry: {} },
        // Asking for a name, a number or a plain yes. The browser's own
        // prompt() and confirm() stop the page dead in an embedded window and
        // cannot be driven by a test, so the question is asked in the page.
        ask: { open: false, icon: '', title: '', subject: '', body: '', label: '', value: '', confirm: '', danger: false, input: true },
        askSettle: null,
        filesConn: 0, filesPath: '', filesData: null, filesTarget: 'NetBase', transferNote: '',
        // ---- the two panes ----
        // The left one is the reader's own Nextcloud files, the right one the
        // server. A file manager that shows only the far end makes you guess
        // what you have; showing both is what every FTP client does, and what
        // makes dragging from one to the other mean anything.
        localPath: '', localData: null, localSort: { by: 'name', desc: false },
        // What is selected on each side. A Set would be tidier, but Vue 3 tracks
        // a plain object's keys without a deep watcher, and this is read on
        // every row of every redraw.
        localPicked: {}, remotePicked: {},
        // The row a Shift-click measures from, per pane.
        localAnchor: '', remoteAnchor: '',
        // Files whose names begin with a dot. Off by default, as in every file
        // manager; on, because sometimes those are exactly the ones you want.
        showHidden: false,
        // Which pane a drag started from. Dropping on the side it came from
        // does nothing, so this is what tells the two apart.
        dragFrom: '',
        // What is waiting to be transferred, what is going now, and what has
        // been. One at a time: several at once over one SSH connection is
        // slower than one after another, and far harder to report honestly.
        queue: [], queueBusy: false, queueStop: null, queueDone: [],
        // Text files open in their own windows — the same frame as the device
        // and terminal windows, so several can stand open beside the list.
        textWins: [],
        // Acting as root on the far end. The password lives in this object for
        // as long as the page is open and goes nowhere else: not to
        // localStorage, not to the settings, not to RegiBase. Reloading the
        // page asks again, which is the whole point of it.
        asRoot: false, sudoDraft: '', sudoPassword: '',
        // When the page was last touched while acting as root, and how many
        // minutes are left before it is given up.
        rootTouched: 0, rootLeft: 0, rootTimer: null,
        adhocActive: false,
        adhoc: { kind: 'sftp', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh', passive: true, path: '' },
        // service probes
        // Typed in, or chosen from the saved list. Shown on screen as a
        // choice rather than hidden in the list itself.
        sshMode: 'type',
        sshPick: '', sshAuthMethods: false, sshResult: null, telnetResult: null,
        ntpHost: 'pool.ntp.org', ntpResult: null, ntpServers: NTP_SERVERS, knownResolvers: KNOWN_RESOLVERS,
        locale: 0,
        picker: { open: false, title: '', path: '', parent: null, entries: [], foldersOnly: false, onPick: null },
        windows: [], terms: [], windowSeq: 0, windowTop: 3000, drag: null,
        rowMenu: { open: false, x: 0, y: 0, device: null },
        preview: { open: false, url: '', src: '', loading: false, error: null, full: false },
        serverResult: null, requirements: null, sysInfo: false, themeBox: false, localeHelp: false,
        // Which part of the settings is on screen. Named rather than numbered,
        // so adding a group later cannot silently shift the others.
        settingTab: 'look',
        settingTabs: [
          { id: 'look', icon: '🎨', label: 'Appearance and language' },
          { id: 'term', icon: '🖳', label: 'Terminal (shell and SSH)' },
          { id: 'conn', icon: '🔑', label: 'Connections and keys' },
          { id: 'tools', icon: '☰', label: 'The list of tools' },
        ],
        // What was kept of past terminals: the list of them, and the one being read.
        termLog: { open: false, loading: false, sessions: [], session: null, steps: [] },
        themeOptions: THEME_OPTIONS,
        adminUrl: (window.OC && OC.generateUrl) ? OC.generateUrl('/settings/admin/netbase') : '/settings/admin/netbase',
        liveOn: false, liveIface: '', liveIfaces: [], liveNow: { rx: 0, tx: 0 }, liveRx: [], liveTx: [],
        liveErrors: 0, lastCounters: null, liveTimer: null,
        speedSize: 25, speedUpload: true, speedVia: 'auto', speedResult: null,
        // What the measurement has said so far, as it says it.
        speedLive: { running: false, phase: '', down: [], up: [] },
        iperfHost: '', iperfPort: 5201, iperfSeconds: 10, iperfReverse: false, iperfResult: null,
        dnsBench: null, timingUrl: '', timingResult: null,
        // NETBASE-STORE-REMOVED: pathResult: null,
        // NETBASE-STORE-REMOVED: nmapTargets: '', nmapPreset: 'quick', nmapExtra: '', nmapResult: null,
        typeLabels: TYPE_LABEL,
      };
    },
    computed: {
      /**
       * This server's own address, as somewhere to open a console.
       *
       * The command that puts the server on another network has to be run on
       * the server itself, so the SSH window offered beside it goes here and
       * nowhere else. A container bridge is skipped: it is this machine too,
       * but not the address anyone logs in on.
       */
      serverAddress() {
        const mine = (this.devices || []).filter((d) => this.isSelf(d) && d.ip);
        const real = mine.find((d) => !/^10\.88\./.test(d.ip));
        return (real || mine[0] || {}).ip || '';
      },
      visibleTabs() {
        // 'ping' covers traceroute too. Anyone allowed nothing at all never
        // reaches this page — the server answers 403 before it loads.
        const can = this.status.can || {};
        const allowed = TABS.filter((x) => can[x.id]);
        const order = this.settings.tabOrder || [];
        if (!order.length) return allowed;
        // Anything the saved order does not mention — a tool added since, or
        // one just granted — keeps its place at the end rather than vanishing.
        const placed = order.map((id) => allowed.find((x) => x.id === id)).filter(Boolean);
        return placed.concat(allowed.filter((x) => !order.includes(x.id)));
      },
      currentTab() { return TABS.find((x) => x.id === this.tab) || TABS[0]; },
      macQuery() {
        // However it was written — colons, hyphens, dots, spaces or nothing at
        // all — what matters is the hex underneath.
        return String(this.macInput || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase().slice(0, 12);
      },
      /** Six hex digits are the vendor prefix, and enough to answer with. */
      macReady() { return this.macQuery.length >= 6; },

      /**
       * Addresses NetBase already knows, so they need not be typed again:
       * the devices it found, this server's own networks, and whatever was
       * last asked about in this browser.
       */
      hostChoices() {
        const groups = [];
        const devices = (this.devices || []).filter((d) => d.ip);
        if (devices.length) {
          groups.push({
            label: 'Devices',
            items: devices.slice(0, 60).map((d) => ({
              value: d.ip,
              text: d.name && d.name !== d.ip ? d.name + ' — ' + d.ip : d.ip,
            })),
          });
        }
        const recent = this.recentHosts;
        if (recent.length) {
          groups.push({ label: 'Recent', items: recent.map((h) => ({ value: h, text: h })) });
        }
        return groups;
      },
      networkChoices() {
        const targets = (this.status.targets || []).map((t2) => ({
          value: t2.cidr,
          text: t2.interface ? t2.cidr + ' — ' + t2.interface : t2.cidr,
        }));
        const groups = targets.length ? [{ label: 'This server', items: targets }] : [];
        const recent = this.recentHosts.filter((h) => h.includes('/'));
        if (recent.length) groups.push({ label: 'Recent', items: recent.map((h) => ({ value: h, text: h })) });
        return groups;
      },
      targetChoices() { return this.networkChoices.concat(this.hostChoices); },
      hasResult() {
        // Reading the results makes the buttons wake up the moment one arrives.
        void [this.dnsResult, this.dnsQueryResult, this.dnsCompareResult, this.dnsTraceResult, this.axfrResult,
          this.whoisResult, this.tlsResult, this.tlsVersionsResult, this.httpResult, this.subnetResult,
          this.splitResult, this.aggregateResult, this.macResult, this.speedResult, this.iperfResult,
          this.dnsBench, this.timingResult, this.mailAudit, this.mailProbeResult,
          this.relayResult, this.blResult, this.sendResult, this.mailboxResult, this.filesData,
          this.sshResult, this.telnetResult, this.sshRunResult, this.ntpResult,
          this.devices.length, this.terms.reduce((n, w) => n + w.lines.length, 0)];
        return !!this.resultBundle();
      },
      onlineCount() { return this.devices.filter((d) => d.online).length; },
      // True while any tool is waiting on the server, so a single "working" bar can
      // show across the top for every operation — most are one request of unknown
      // length (whois, TLS, DNS, mail, SSH…) with no count to fill.
      anyBusy() { return Object.values(this.busy).some(Boolean); },
      // The name before the dot, cleaned to what a domain label may contain.
      availBase() { return (String(this.availDomains).split('.')[0] || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, ''); },
      // Results after the two show/hide switches: taken (×) and undetermined (?)
      // can each be dropped from view; free (○) and likely-free (△) always show.
      availShown() {
        return this.availResults.filter((r) => {
          if (r.cls === 'taken') { return this.availShowTaken; }
          if (r.cls === 'unknown') { return this.availShowUnknown; }
          return true;
        });
      },
      // The tier radios, with their sizes from the server (labels localised).
      availTierList() {
        const labels = { core: 'Major', gtld: 'gTLD', cctld: 'ccTLD', all: 'All' };
        const order = ['core', 'gtld', 'cctld', 'all'];
        return order.filter((k) => this.availTiers[k]).map((k) => ({ key: k, label: labels[k] || k, count: this.availTiers[k] }));
      },
      // Which server the figure came from. It is not known until a test has
      // run: the nearest one is chosen at the time, so naming a fixed host
      // before that would be a guess dressed up as a fact.
      speedEndpoint() { return (this.speedResult && this.speedResult.endpoint) || ''; },
      speedWhere() { return (this.speedResult && this.speedResult.where) || ''; },
      /**
       * A saved SSH connection is the same machine, account and key an SFTP one
       * would use, so it belongs in this list too: somebody with sixteen
       * servers saved should not have to type all sixteen again to look at a
       * file. The server opens it over SFTP, or SCP where there is no SFTP.
       */
      /**
       * Which types belong together.
       *
       * The same grouping the server keeps them under: SCP reuses the SSH
       * credentials, FTP is a different account on a different machine, and
       * SFTP travels with FTP. Mixing them in one list was wrong twice over —
       * it offered a server that cannot answer the protocol being asked for,
       * and it hid the fact that the two are stored in different places.
       */
      connGroupKinds() {
        const groups = this.connGroups || {};
        const out = {};
        for (const [key, g] of Object.entries(groups)) out[key] = g.kinds || [];
        return out;
      },
      /** The group a type belongs to, as the server defines it. */
      groupOfKind() {
        const map = {};
        for (const [key, kinds] of Object.entries(this.connGroupKinds)) {
          for (const k of kinds) map[k] = key;
        }
        return map;
      },
      /**
       * The saved connections of the type file transfer is set to right now.
       *
       * SCP is the one that reaches past its own group: it signs in over SSH
       * with the same account and the same key, so a connection saved as SSH
       * is a connection SCP can open. Where it is *stored* is not widened by
       * this — that stays one collection per type — only what is offered.
       */
      fileConnections() {
        const group = this.groupOfKind[this.filesKind] || this.filesKind;
        const kinds = (this.connGroupKinds[group] || [this.filesKind]).slice();
        if (this.filesKind === 'scp' && !kinds.includes('ssh')) kinds.push('ssh');
        return this.connections.filter((c) => kinds.includes(c.kind));
      },
      /** SSH's own list. SFTP belongs with FTP, not here. */
      sshConnections() { return this.connections.filter((c) => c.kind === 'ssh'); },
      /**
       * Whether the saved list is there but unusable.
       *
       * The names and addresses in RegiBase are not secret and read back
       * without the key; the passwords and the private keys are, and do not.
       * So a locked list looks complete and fails on use — which is why the
       * screens ask for the key instead of offering it.
       */
      connLocked() {
        const s = this.connSetup;
        return !!(s && s.available && s.encrypted && !s.unlocked);
      },
      /**
       * The listing in the order the reader asked for.
       *
       * Folders stay above files whichever column is sorted: a file manager
       * that scatters the folders through the names is harder to walk, and
       * every one of them keeps this rule.
       */
      /** The reader's own files, sorted and filtered the same way as the server's. */
      sortedLocal() {
        const rows = ((this.localData && this.localData.entries) || [])
          .filter((e) => this.showHidden || !String(e.name).startsWith('.'));
        return this.sortRows(rows.slice(), this.localSort);
      },
      /** How many rows are picked on each side, for the buttons to read. */
      localCount() { return Object.keys(this.localPicked).length; },
      remoteCount() { return Object.keys(this.remotePicked).length; },
      /** What the queue is doing, in one line. */
      queueSummary() {
        const now = this.queue.find((j) => j.state === 'running');
        const waiting = this.queue.filter((j) => j.state === 'waiting').length;
        if (!now && !waiting) return null;
        return { now, waiting, done: this.queueDone.length };
      },
      sortedFiles() {
        const rows = ((this.filesData && this.filesData.entries) || [])
          .filter((e) => this.showHidden || !String(e.name).startsWith('.'));
        const by = this.fileSort.by;
        const dir = this.fileSort.desc ? -1 : 1;
        rows.sort((a, b) => {
          if (!!a.directory !== !!b.directory) return a.directory ? -1 : 1;
          let v = 0;
          if (by === 'size') v = (a.size || 0) - (b.size || 0);
          else if (by === 'modified') v = (a.modified || 0) - (b.modified || 0);
          else v = String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
          return v * dir;
        });
        return rows;
      },
      /** The saved connection chosen for file transfer, if the choice was one. */
      filesSaved() { return this.filesConn ? this.connById(this.filesConn) : null; },
      /** The server file transfer is pointed at, saved or typed. */
      filesHostNow() { return this.filesSaved ? this.filesSaved.host : this.adhoc.host; },
      /** The saved connection chosen, if the choice was a saved one. */
      sshSaved() {
        if (this.sshMode !== 'saved') return null;
        if (!String(this.sshPick).startsWith('c')) return null;
        return this.connById(Number(String(this.sshPick).slice(1)));
      },
      /** The machine, whichever way it was named. */
      sshHostNow() { return this.sshSaved ? this.sshSaved.host : this.sshAdhoc.host; },
      sshPortNow() {
        if (this.sshSaved) return this.sshSaved.port || 22;
        return this.sshAdhoc.port || (this.sshAdhoc.kind === 'telnet' ? 23 : 22);
      },
      /** Telnet has no command channel of its own, so there is nothing to run. */
      /**
       * Whether the console can be opened at all.
       *
       * A saved connection carries its own user name; Telnet asks for one
       * inside the window. Only SSH typed in here has to be told who to be,
       * and without that the server refuses with nobody named in the message.
       */
      sshReadyToOpen() {
        if (this.sshSaved) return true;
        if (this.sshAdhoc.kind === 'telnet') return !!this.sshAdhoc.host;
        return !!this.sshAdhoc.host && !!this.sshAdhoc.username;
      },
      sshCanRun() { return !!this.sshSaved || (!!this.sshAdhoc.host && this.sshAdhoc.kind !== 'telnet'); },
      sshPresets() { return this.status.sshPresets || {}; },
      /**
       * One address, one entry. A mailbox account carries the server it sends
       * through, so the same choice serves both halves of the test; an
       * SMTP-only relay has no mailbox and can only be sent through.
       */
      mailAccounts() { return this.connections.filter((c) => ['imap', 'pop3', 'smtp'].includes(c.kind)); },
      smtpConnections() { return this.connections.filter((c) => c.kind === 'smtp'); },
      mailboxConnections() { return this.connections.filter((c) => c.kind === 'imap' || c.kind === 'pop3'); },
      /** The saved mail account chosen, if the choice was one. */
      mailAccountSaved() { return this.acctMode === 'saved' && this.mailAccountId ? this.connById(this.mailAccountId) : null; },
      /**
       * Whether the account on screen can be read as well as sent through.
       *
       * mailAccountSaved is a computed, not a method: calling it threw, and the
       * whole mail screen stopped drawing.
       */
      mailCanReceive() {
        const chosen = this.mailAccountSaved;
        return this.acctMode === 'saved' ? !!chosen && chosen.kind !== 'smtp' : this.mailAdhoc.kind !== 'smtp';
      },
      connModes() { return (this.connKinds[this.connForm.kind] || {}).modes || []; },
      /**
       * Whether "act as root" can be offered at all.
       *
       * Only over SCP: it works by putting the command through sudo, and FTP
       * has no commands while SFTP is a subsystem with no shell behind it.
       */
      canElevate() {
        if (!this.connCaps.elevate) return false;
        const kind = this.filesConn ? (this.connById(this.filesConn) || {}).kind : this.adhoc.kind;
        return kind === 'scp' || kind === 'ssh';
      },
      /**
       * The types offered when making a connection.
       *
       * SFTP is not among them. It is not a kind of FTP but a subsystem of
       * SSH, and since an SSH connection is opened for files over SFTP
       * already, offering it separately only asked people to decide something
       * that makes no difference. FTP keeps its encryption choice, which is
       * the question they were really being asked. A connection saved as SFTP
       * before this still works, and still shows its own type here.
       */
      offeredKinds() {
        const out = {};
        for (const [id, meta] of Object.entries(this.connKinds || {})) {
          if (id === 'sftp' && this.connForm.kind !== 'sftp') continue;
          out[id] = meta;
        }
        return out;
      },
      activeComponents() { return this.requirements ? this.requirements.components.filter((c) => c.present) : []; },
      dormantComponents() { return this.requirements ? this.requirements.components.filter((c) => !c.present) : []; },
      suggestedPlaceholder() { return (this.status.targets || []).map((t2) => t2.cidr).join(', ') || '192.168.1.0/24'; },
      portWaits() { return this.status.portWaits || [0.3, 0.9, 2.0]; },
      paceRates() { return this.status.pacing ? Object.keys(this.status.pacing).map(Number).sort((a, b) => a - b) : [1500]; },
      openPortReady() {
        const n = Number(this.openPort);
        return Number.isInteger(n) && n > 0 && n < 65536;
      },
      shownDevices() {
        const needle = this.filter.trim().toLowerCase();
        let list = this.devices.filter((d) => (!this.onlyOnline || d.online));
        if (needle) {
          list = list.filter((d) => [d.name, d.ip, d.mac, d.vendor, d.hostname, d.notes]
            .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)));
        }
        const key = this.sortKey;
        return list.slice().sort((a, b) => {
          let x = a[key]; let y = b[key];
          if (key === 'ip') { x = ipSortKey(a.ip); y = ipSortKey(b.ip); }
          if (key === 'lastSeen') { x = a.lastSeen || 0; y = b.lastSeen || 0; }
          if (typeof x === 'string' || typeof y === 'string') { x = String(x || ''); y = String(y || ''); return this.sortDir * x.localeCompare(y); }
          return this.sortDir * ((x || 0) - (y || 0));
        });
      },
      // One entry per physical device: rows that share a MAC (the server's two
      // addresses, say) are folded together and their addresses listed under
      // the one name. Devices without a MAC stand alone.
      deviceGroups() {
        const groups = [];
        const byKey = {};
        const rank = (z) => (z.label ? 2 : (z.hostname ? 1 : 0));
        for (const d of this.shownDevices) {
          // This server's own addresses are one machine even across its several
          // interfaces (eth0 and the container bridge have different MACs), so
          // they group as "this server". Everything else groups by MAC.
          const self = this.isSelf(d) || this.onHostBridge(d.ip);
          const key = self ? 'self' : (d.mac ? ('mac:' + d.mac) : ('id:' + d.id));
          let g = byKey[key];
          if (!g) { g = byKey[key] = { key, members: [], rep: d, online: false, lastSeen: 0, isSelf: self }; groups.push(g); }
          g.members.push(d);
          if (d.online) g.online = true;
          if ((d.lastSeen || 0) > g.lastSeen) g.lastSeen = d.lastSeen || 0;
          if (rank(d) > rank(g.rep)) g.rep = d;
        }
        const ipn = (ip) => String(ip || '').split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        for (const g of groups) g.members.sort((a, b) => ipn(a.ip) - ipn(b.ip));
        return groups;
      },
    },
    methods: {
      // Reading this.locale makes every t() call re-evaluate when the language
      // changes, so switching redraws the whole interface.
      t(text, vars) { return this.locale, T(text, vars); },
      ago, stamp,
      progressText(scan) {
        const p = scan && scan.progress;
        if (!p) return scan ? (scan.message || scan.phase) : '';
        const v = { done: p.done, total: p.total };
        switch (p.key) {
          case 'arp': return T('{done} devices in the ARP table', v);
          case 'sweep': return T('{done} / {total} addresses swept', v);
          case 'names': return T('Asking devices for their names ({done} / {total})', v);
          case 'names2': return T('Asking again, more slowly ({done} / {total})', v);
          case 'mcastListen': return T('Waiting for devices to announce themselves — this takes a few seconds');
          case 'mcast': return T('Multicast discovery complete');
          case 'ports': return T('Checking services ({done} / {total})', v);
          case 'portsAll': return T('Checking ports ({done} / {total})', v);
          case 'rdns': return T('Reverse DNS ({done} / {total})', v);
          default: return scan.message || scan.phase;
        }
      },
      // A short word for the step under way, so the bar resetting between steps
      // reads as "now doing the next thing" rather than "going backwards".
      phaseLabel(scan) {
        const key = (scan && scan.progress && scan.progress.key) || (scan && scan.phase) || '';
        switch (key) {
          case 'arp': return T('Reading the ARP table');
          case 'sweep': return T('Searching for devices');
          case 'names': case 'names2': return T('Asking for names');
          case 'mcastListen': case 'mcast': return T('Listening for announcements');
          case 'ports': case 'portsAll': return T('Checking ports');
          case 'rdns': return T('Reverse DNS');
          default: return T('Working…');
        }
      },
      // The listening step has no count to show a fraction of, so the bar runs
      // as an indeterminate stripe instead of sitting at a misleading 0%.
      phaseWaiting(scan) {
        return !!(scan && scan.progress && scan.progress.key === 'mcastListen');
      },
      icon(d) { return TYPE_ICON[d.type] || (d.type ? CUSTOM_TYPE_ICON : TYPE_ICON.unknown); },
      // A template's translated label, or the user's own words as they typed them.
      typeText(type) {
        if (!type) return this.t(TYPE_LABEL.unknown);
        return TYPE_LABEL[type] ? this.t(TYPE_LABEL[type]) : String(type);
      },
      // What the picker holds, for a stored type: a template key, or "Other"
      // with the text beside it.
      typePick(type) {
        if (!type || TYPE_LABEL[type]) return { type: type || 'unknown', text: '' };
        return { type: CUSTOM_TYPE, text: String(type) };
      },
      // Choosing "Other" turns the list into a text field in the same place;
      // put the cursor straight into it.
      focusOwnType(ev) {
        const box = ev.target.parentElement;
        this.$nextTick(() => { const input = box && box.querySelector('.type-own input'); if (input) input.focus(); });
      },
      // Back from the text field to the list: the device's own template if it
      // had one, otherwise "Unknown". The typed text is kept for a return trip.
      typeBack(previous) { return TYPE_LABEL[previous] ? previous : 'unknown'; },
      // The type to save. "Other" left blank keeps whatever the device had.
      typeToSave(type, text, previous) {
        if (type !== CUSTOM_TYPE) return type;
        return String(text || '').trim() || previous || 'unknown';
      },
      vendorText(d) {
        if (!d.vendor) return d.mac ? T('Not registered') : '—';
        return d.vendor === '__randomized__' ? T('Randomised (privacy) address') : d.vendor;
      },
      fieldLabel(key) {
        const map = {
          registrar: 'Registrar', created: 'Created', updated: 'Updated', expires: 'Expires',
          status: 'Status', registrant: 'Registrant', abuse: 'Abuse contact', nameservers: 'Name servers',
          range: 'Range', cidr: 'CIDR', name: 'Network name', org: 'Organisation', country: 'Country', asn: 'AS number',
          family: 'Family', address: 'Address', netmask: 'Netmask', wildcard: 'Wildcard', network: 'Network',
          broadcast: 'Broadcast', firstHost: 'First host', lastHost: 'Last host', hosts: 'Usable hosts',
          total: 'Total addresses', private: 'Private range',
        };
        return map[key] || key;
      },
      sortBy(key) {
        if (this.sortKey === key) { this.sortDir *= -1; } else { this.sortKey = key; this.sortDir = 1; }
        try { localStorage.setItem('netbase.sort', JSON.stringify({ key: this.sortKey, dir: this.sortDir })); } catch (e) { /* private window */ }
      },
      sortClass(key) { return this.sortKey === key ? (this.sortDir > 0 ? 'sorted asc' : 'sorted desc') : ''; },
      fail(e) {
        clearTimeout(this.noteTimer);
        // A refusal that only wants the master key is not an error to read and
        // dismiss — it is a question. So it is asked instead of announced.
        if (e && e.needsKey) { this.keyAsk = true; return; }
        this.banner = { kind: 'error', text: String((e && e.message) || e) };
      },
      note(text) {
        this.banner = { kind: 'info', text };
        // An informational notice (a finished scan, a saved file) fades on its
        // own; an error stays until it is read and closed.
        clearTimeout(this.noteTimer);
        this.noteTimer = setTimeout(() => {
          if (this.banner && this.banner.kind === 'info') this.banner = null;
        }, 6000);
      },

      /** The machine NetBase is running on, which is in the list like any other. */
      /**
       * What to call a device on the list.
       *
       * The address now sits on its own line underneath, so a row that repeats
       * it as the name says nothing twice. Say instead that there is no name.
       */
      listName(device) {
        const real = (device && (device.label || device.hostname)) || '';
        return real ? { text: real, named: true } : { text: T('- no name -'), named: false };
      },
      isSelf(device) { return !!device && (device.sources || []).indexOf('self') >= 0; },
      // How the reported name was obtained, so an obtained name is never taken
      // for a NetBIOS name when it came from mDNS or a reverse lookup.
      nameSource(device) {
        const from = device && device.extra && device.extra.nameFrom;
        switch (from) {
          case 'netbios': return T('NetBIOS name');
          case 'mdns': return T('mDNS name');
          case 'rdns': return T('reverse DNS');
          case 'self': return T('this server');
          default: return '';
        }
      },
      /**
       * A device heard on this wire whose address belongs to somewhere else.
       *
       * It announced itself, so it is certainly here; but nothing on this
       * server can route to it and it cannot answer, so its ports cannot be
       * checked and its pages cannot be opened. Saying so is kinder than
       * letting somebody click and wait.
       */
      // The netmask for a device's address, when it sits on one of this
      // server's own subnets; blank for an address off this server's networks.
      netmaskFor(device) {
        if (!device || !device.ip) return '';
        const value = (ip) => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        const here = value(device.ip);
        if (!Number.isFinite(here)) return '';
        for (const t2 of (this.status.targets || [])) {
          const [net, bitsText] = String(t2.cidr || '').split('/');
          const bits = Number(bitsText);
          if (!net || !Number.isFinite(bits)) continue;
          const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
          if ((value(net) & mask) === (here & mask)) {
            const dotted = [24, 16, 8, 0].map((s) => (mask >>> s) & 255).join('.');
            return dotted + ' (/' + bits + ')';
          }
        }
        return '';
      },
      // The prefix length (e.g. 16) for a device's address when it is on one of
      // this server's own subnets, for the "IP/NN" form; null when off-network.
      cidrBitsFor(device) {
        if (!device || !device.ip) return null;
        const value = (ip) => String(ip).split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        const here = value(device.ip);
        if (!Number.isFinite(here)) return null;
        for (const [net, bits] of this.localSubnets()) {
          const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
          if ((value(net) & mask) === (here & mask)) return bits;
        }
        return null;
      },
      // Every IPv4 subnet this server has an interface on — its own networks,
      // including the container bridges (podman0, docker0). Used both for the
      // "IP/NN" prefix and to tell which addresses live on this machine.
      localSubnets() {
        const out = [];
        for (const ifc of (this.status.interfaces || [])) {
          if (ifc.loopback) continue;
          for (const a of (ifc.addresses || [])) {
            if ((a.family === 'inet') && a.network && Number.isFinite(Number(a.cidr))) {
              out.push([a.network, Number(a.cidr), String(ifc.name || '')]);
            }
          }
        }
        // Fall back to the scan targets if the interface list is not available.
        if (out.length === 0) {
          for (const t2 of (this.status.targets || [])) {
            const [net, bitsText] = String(t2.cidr || '').split('/');
            if (net && Number.isFinite(Number(bitsText))) out.push([net, Number(bitsText), String(t2.interface || '')]);
          }
        }
        return out;
      },
      // Is this address on one of the host's own container bridges (podman0,
      // docker0, virbr…)? Such addresses are containers on this very machine, so
      // they belong under "this server", not as separate devices.
      onHostBridge(ip) {
        if (!ip) return false;
        const value = (x) => String(x).split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        const here = value(ip);
        if (!Number.isFinite(here)) return false;
        const bridge = /^(docker|podman|virbr|lxc|cni|br[-0-9])/i;
        for (const [net, bits, name] of this.localSubnets()) {
          if (!bridge.test(name)) continue;
          const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
          if ((value(net) & mask) === (here & mask)) return true;
        }
        return false;
      },
      // The networks this server routes through a router, in order: [0] is the
      // primary (lowest-metric default route), [1..] are secondaries of a
      // redundant / multi-homed setup. From the server; the container bridges
      // and unrouted subnets are deliberately not here.
      routedNets() { return this.status.routedNetworks || []; },
      systemCidr() { const n = this.routedNets(); return n.length ? n[0].cidr : ''; },
      // Which routed network an address sits on: 0 = primary, 1.. = secondary,
      // -1 = none (a container bridge, an unused range, or a foreign device) —
      // "another network".
      netRank(device) {
        if (!device || !device.ip) return -1;
        const value = (ip) => String(ip).split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        const here = value(device.ip);
        if (!Number.isFinite(here)) return -1;
        const nets = this.routedNets();
        for (let i = 0; i < nets.length; i++) {
          const [net, bitsText] = String(nets[i].cidr || '').split('/');
          const bits = Number(bitsText);
          if (!net || !Number.isFinite(bits)) continue;
          const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
          if ((value(net) & mask) === (here & mask)) return i;
        }
        return -1;
      },
      // The label for an address's network: primary shows nothing (it is the
      // norm), a secondary shows which one, anything else is "another network".
      netBadge(device) {
        const r = this.netRank(device);
        if (r === 0) return '';
        if (r >= 1) return T('Secondary network {n}', { n: r });
        return T('another network');
      },
      netTitle(device) {
        const r = this.netRank(device);
        const nets = this.routedNets();
        if (r >= 1 && nets[r]) return T('A secondary routed network of this system, via {gw}.', { gw: nets[r].gateway });
        if (r < 0) return T('This address is on a network other than the system network ({net}).', { net: this.systemCidr() });
        return '';
      },
      // Vendor text for the address line's "(…)"; blank when there is nothing
      // useful to show (no MAC, or a MAC not in the registry).
      macVendor(device) {
        if (!device || !device.vendor) return '';
        return device.vendor === '__randomized__' ? T('Randomised (privacy) address') : device.vendor;
      },
      offNetwork(device) {
        if (!device || !device.ip || this.isSelf(device)) return false;
        // "Off network" means the server has no interface on this address's
        // subnet, so it cannot reach it — judged against every local subnet,
        // container bridges (podman0/docker0) included. Judging it against only
        // the scan targets (the physical NICs) wrongly flagged a container on
        // 10.88.x, which the server does reach through its bridge.
        const nets = this.localSubnets();
        if (!nets.length) return false;
        const value = (ip) => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        const here = value(device.ip);
        if (!Number.isFinite(here)) return false;
        return !nets.some(([net, bits]) => {
          if (!net || !Number.isFinite(bits)) return false;
          const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
          return (value(net) & mask) === (here & mask);
        });
      },
      /**
       * The one line that puts this server on a device's network.
       *
       * The last address on the network is picked because it is the one least
       * likely to be handed out by a router's DHCP pool, and the interface is
       * the one the announcement arrived on.
       */
      joinCommand(device) {
        if (!device || !device.ip) return '';
        const parts = device.ip.split('.');
        const wire = device.interface || (this.status.targets || []).map((t2) => t2.interface).find(Boolean) || 'eth0';
        return 'ip addr add ' + parts[0] + '.' + parts[1] + '.' + parts[2] + '.250/24 dev ' + wire;
      },
      allowed(tool) { return !!(this.status.can || {})[tool]; },
      /** The speed, as the number of probes a second it actually sends. */
      paceLabel(mode) {
        const p = (this.status.pacing || {})[String(mode)];
        const rate = p ? p.rate : Number(mode);
        let name = T('{n}/s', { n: rate.toLocaleString() });
        // The ends of the list are worth a word, because neither is free: the
        // slowest is the one that misses nothing, the fastest misses devices.
        const rates = this.paceRates;
        if (rate === rates[0]) name = T('{pace} — most thorough', { pace: name });
        if (rate === rates[rates.length - 1]) name = T('{pace} — misses some devices', { pace: name });
        return name;
      },
      /**
       * A wait, with what it costs on the worst device the scan can meet.
       *
       * 512 sockets go out at once and a device that answers nothing holds
       * every one of them for the whole wait, so this is the honest ceiling
       * per device — and with the whole range selected, it is minutes.
       */
      waitLabel(wait) {
        // The number on its own says nothing to anyone who has not thought
        // about what a silent port costs. What it buys and what it costs does.
        const seconds = T('{n} s', { n: wait });
        const waits = this.portWaits;
        if (wait === waits[0]) return T('{wait} — quick, misses slow devices', { wait: seconds });
        if (wait === waits[waits.length - 1]) return T('{wait} — finds the slowest, takes longest', { wait: seconds });
        return T('{wait} — the usual', { wait: seconds });
      },
      /** Seconds, said the way a person would say them. */
      duration(seconds) {
        if (seconds < 90) return T('about {n} s', { n: Math.max(1, Math.round(seconds)) });
        return T('about {n} min', { n: Math.round(seconds / 60) });
      },
      /**
       * Every port on this one device.
       *
       * A sweep gives each device a moment; a device asked on its own can be
       * asked about all 65,535. It is walked in slices so no single request
       * runs long, and what is found is written back to the device, so the
       * list shows it afterwards.
       */
      async scanAllPorts(device) {
        if (this.deep.busy || !device) return;
        this.deep = { busy: 'ports', percent: 0, note: '', pages: [] };
        const open = [];
        try {
          let from = 1;
          for (;;) {
            const slice = await api('device/ports', {
              method: 'POST',
              body: JSON.stringify({ ip: device.ip, from, wait: 0.3, save: false }),
            });
            open.push(...(slice.open || []));
            this.deep.percent = Math.min(100, Math.round((slice.to / 65535) * 100));
            if (slice.done) break;
            from = slice.next;
          }
          // The last call writes the whole answer against the device, and adds
          // its own patient look at the ports worth being sure about.
          const settled = await api('device/ports', {
            method: 'POST',
            body: JSON.stringify({ ip: device.ip, from: 65535, wait: 0.1, save: true, open }),
          });
          const found = (settled.open || [...new Set(open)]).slice().sort((a, b) => a - b);
          device.ports = found;
          this.deep.note = found.length
            ? T('{n} ports are open: {list}', { n: found.length, list: found.join(', ') })
            : T('Nothing answered on any port.');
          await this.loadDevices();
          this.showResult();
        } catch (e) { this.fail(e); this.deep.note = ''; } finally { this.deep.busy = ''; }
      },
      /**
       * Which of this device's open ports are really web pages.
       *
       * Asking is the only honest way to know. The number is a poor guess: a
       * router here answers on 22401, and plenty of devices have nothing at
       * all on 8080. Each port is asked for its front page, and one that
       * replies with a status line is a web page whatever its number.
       */
      async findWebPages(device) {
        if (this.deep.busy || !device || !device.ports.length) return;
        this.deep = { busy: 'web', percent: 0, note: '', pages: [] };
        try {
          const answer = await api('device/web', {
            method: 'POST',
            body: JSON.stringify({ ip: device.ip, ports: device.ports, save: true }),
          });
          this.deep.pages = answer.pages || [];
          this.deep.note = this.deep.pages.length
            ? T('{n} of {total} ports serve a web page.', { n: this.deep.pages.length, total: device.ports.length })
            : T('None of these ports serve a web page.');
          await this.loadDevices();
          this.showResult();
        } catch (e) { this.fail(e); this.deep.note = ''; } finally { this.deep.busy = ''; }
      },
      /** An answer that lands below the fold is an answer nobody sees. */
      showResult() {
        this.$nextTick(() => {
          const el = this.$refs.deepResult;
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      },
      /** The device list again, with the drawer still on the same device. */
      async loadDevices() {
        try {
          const r = await api('devices');
          this.devices = r.devices || this.devices;
          if (this.selected) {
            const same = this.devices.find((d) => d.id === this.selected.id);
            if (same) this.selected = same;
          }
        } catch (e) { /* the panel still holds what it just found */ }
      },
      openTypedPort() {
        if (!this.openPortReady) return;
        this.openDeviceWindow(this.selected, Number(this.openPort), this.openScheme);
      },
      /** How many ports each depth actually probes, straight from the server. */
      portCount(depth) {
        if (depth === 'all') return 65535;
        if (depth === 'wellKnown') return 1024;
        if (depth === 'high') return 64511;
        const list = depth === 'detailed' ? this.status.detailedPorts : this.status.fingerprintPorts;
        return (list || []).length;
      },

      // ---- putting the tools in the order someone actually works in --------
      startTabDrag(item, event) {
        this.dragTab = item.id;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          // Firefox refuses to start a drag with nothing on the clipboard.
          event.dataTransfer.setData('text/plain', item.id);
        }
      },
      endTabDrag() { this.dragTab = ''; this.overTab = ''; },
      dropTab(target) {
        const from = this.dragTab;
        this.endTabDrag();
        if (!from || (target && target.id === from)) return;
        const ids = this.visibleTabs.map((x) => x.id);
        const at = ids.indexOf(from);
        if (at < 0) return;
        ids.splice(at, 1);
        // Dropped on the list itself rather than on an item: put it last.
        const to = target ? ids.indexOf(target.id) : ids.length;
        ids.splice(to < 0 ? ids.length : to, 0, from);
        this.saveTabOrder(ids);
      },
      moveTabByKey(item, event) {
        // The same rearranging without a mouse: hold Alt and use the arrows.
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        const ids = this.visibleTabs.map((x) => x.id);
        const at = ids.indexOf(item.id);
        const to = at + (event.key === 'ArrowUp' ? -1 : 1);
        if (at < 0 || to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(at, 1)[0]);
        this.saveTabOrder(ids);
        this.$nextTick(() => {
          const el = document.querySelectorAll('.nav-list .nav-item')[to];
          if (el) el.focus();
        });
      },
      async saveTabOrder(ids) {
        // Tools this account cannot see keep their remembered places, so a
        // permission granted later does not land the tool in a strange spot.
        const hidden = (this.settings.tabOrder || []).filter((id) => !ids.includes(id));
        const order = ids.concat(hidden);
        this.settings = { ...this.settings, tabOrder: order };
        try {
          await api('settings', { method: 'POST', body: JSON.stringify({ settings: { tabOrder: order } }) });
        } catch (e) { this.fail(e); }
      },
      /** Remember where the keys are kept, for this account. */
      async saveKeyFolder() {
        const folder = String(this.settings.keyFolder || '').replace(/^\/+|\/+$/g, '');
        this.settings = { ...this.settings, keyFolder: folder };
        try {
          await api('settings', { method: 'POST', body: JSON.stringify({ settings: { keyFolder: folder } }) });
        } catch (e) { this.fail(e); }
      },
      async resetTabOrder() {
        this.settings = { ...this.settings, tabOrder: [] };
        try {
          await api('settings', { method: 'POST', body: JSON.stringify({ settings: { tabOrder: [] } }) });
        } catch (e) { this.fail(e); }
      },

      // ---- appearance (follow Nextcloud, or force light/dark) ----
      parseColor(v) {
        if (!v) return null;
        let m = String(v).trim().match(/^#([0-9a-f]{3})$/i);
        if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]; }
        m = String(v).trim().match(/^#([0-9a-f]{6})$/i);
        if (m) { const h = m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
        m = String(v).match(/rgba?\(([^)]+)\)/i);
        if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2]]; }
        return null;
      },
      // Nextcloud's own dark mode is an app, not a media query, so read the
      // colour it actually painted and fall back to the OS preference.
      ncIsDark() {
        try {
          const rgb = this.parseColor(getComputedStyle(document.body).getPropertyValue('--color-main-background'));
          if (rgb) return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5;
        } catch (e) { /* fall through */ }
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      },
      applyTheme() {
        const want = this.settings.theme || 'auto';
        const dark = want === 'dark' ? true : want === 'light' ? false : this.ncIsDark();
        const el = document.getElementById('netbase-root');
        if (el) el.setAttribute('data-nbtheme', dark ? 'dark' : 'light');
      },
      async setTheme(id) {
        if (!THEME_OPTIONS.some((o) => o.id === id)) return;
        this.settings.theme = id;
        this.applyTheme();
        try { await api('settings', { method: 'POST', body: JSON.stringify({ settings: { theme: id } }) }); } catch (e) { this.fail(e); }
      },
      watchNcTheme() {
        // Only 'auto' cares: repaint when the OS flips, and when Nextcloud's own
        // dark-mode app swaps its stylesheet under us.
        const repaint = () => { if ((this.settings.theme || 'auto') === 'auto') this.applyTheme(); };
        try {
          if (window.matchMedia) {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            mq.addEventListener ? mq.addEventListener('change', repaint) : mq.addListener(repaint);
          }
        } catch (e) { /* ignore */ }
        try {
          const mo = new MutationObserver(repaint);
          mo.observe(document.head, { childList: true });
          mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-themes'] });
        } catch (e) { /* ignore */ }
      },
      async load() {
        try {
          this.status = await api('status');
          const allowed = this.visibleTabs.map((x) => x.id);
          if (!allowed.includes(this.tab) && allowed.length) this.tab = allowed[0];
          this.version = document.getElementById('netbase-root')?.dataset.version || '';
          if (this.status.can && this.status.can.devices) {
            const r = await api('devices');
            this.devices = r.devices || [];
          }
          if (this.status.can && this.status.can.scan) {
            this.advice = await api('scan/advice');
          }
          try { this.requirements = await api('requirements'); } catch (e) { /* optional */ }
          const s = await api('settings');
          this.settings = { ...this.settings, ...s };
          this.applyTheme();
          if (s.language && s.language !== 'auto') await this.applyLanguage(s.language);
          if (s.lastTargets) this.scanTargets = s.lastTargets;
        } catch (e) { this.fail(e); }
      },

      async startScan(override = {}) {
        if (this.scanning) return;
        // A new scan clears whatever the last one, or another tool, left in the
        // notice bar, so "scan finished" from before is never shown over a scan
        // that is only just under way.
        clearTimeout(this.noteTimer);
        this.banner = null;
        this.tab = 'devices';
        const targets = this.scanTargets.split(',').map((x) => x.trim()).filter(Boolean);
        // The override wins over everything, including arpOnly, so "Port scan"
        // can turn the discovery phases off and not repeat what a refresh did.
        const options = { ...this.opts, pace: this.pace, arpOnly: this.scanWhat === 'arp', ...override };
        try {
          this.advice = await api('scan/advice?' + qs({ targets }));
          const r = await api('scan', { method: 'POST', body: JSON.stringify({ targets, options }) });
          this.scan = r.scan;
          this.scanning = true;
          api('settings', { method: 'POST', body: JSON.stringify({ settings: { lastTargets: this.scanTargets } }) }).catch(() => {});
          this.pump();
        } catch (e) { this.fail(e); this.scanning = false; }
      },
      async pump() {
        while (this.scanning && this.scan && this.scan.state === 'running') {
          try {
            const r = await api('scan/' + this.scan.id + '/step', { method: 'POST', body: '{}' });
            this.scan = r.scan;
            this.devices = r.devices || this.devices;
          } catch (e) { this.fail(e); break; }
        }
        this.scanning = false;
        if (this.scan && this.scan.state === 'done') {
          this.note(T('Scan finished: {n} devices online', { n: this.onlineCount }));
        }
      },
      async cancelScan() {
        if (!this.scan) return;
        this.scanning = false;
        try { await api('scan/' + this.scan.id, { method: 'DELETE' }); } catch (e) { /* already gone */ }
      },
      // Clear the kernel neighbour (ARP) table through the admin-installed helper,
      // then refresh so the list shows only what answers now.
      async clearArp() {
        const r = await this.guarded('arpflush', () => api('arp-flush', { method: 'POST', body: '{}' }));
        if (!r) return;
        this.note(r.cleared ? T('Cleared {n} entries from the ARP table', { n: r.cleared }) : T('The ARP table was cleared'));
        this.startScan({ ports: false });
      },
      // The exact files an administrator installs to switch the button on.
      arpHelperPath() { return (this.status.arpFlush && this.status.arpFlush.helper) || '/usr/local/sbin/netbase-arp-flush'; },
      arpUser() { return (this.status.arpFlush && this.status.arpFlush.user) || 'www-data'; },
      arpSudoersPath() { return (this.status.arpFlush && this.status.arpFlush.sudoers) || '/etc/sudoers.d/netbase-arp'; },
      arpScript() {
        return [
          '#!/bin/sh',
          '# netbase-arp-flush — let NetBase clear the neighbour (ARP) table.',
          '# Installed by an administrator; run only by the sudoers rule below.',
          'case "$1" in',
          '  --check) exit 0 ;;   # NetBase probes with this; it does nothing',
          '  *) exec ip neigh flush all ;;',
          'esac',
        ].join('\n');
      },
      arpSudoers() { return this.arpUser() + ' ALL=(root) NOPASSWD: ' + this.arpHelperPath() + '\n'; },
      arpBareSteps() {
        const h = this.arpHelperPath();
        return [
          'sudo tee ' + h + ' >/dev/null <<\'EOF\'\n' + this.arpScript() + '\nEOF',
          'sudo chown root:root ' + h,
          'sudo chmod 755 ' + h,
          'sudo tee ' + this.arpSudoersPath() + ' >/dev/null <<\'EOF\'\n' + this.arpSudoers().trimEnd() + '\nEOF',
          'sudo chmod 440 ' + this.arpSudoersPath(),
        ].join('\n');
      },
      arpDockerHook() {
        const h = this.arpHelperPath();
        return [
          '# In the official image, drop this at',
          '# /docker-entrypoint-hooks.d/before-starting/netbase-arp.sh so it is',
          '# reinstalled on every start, and run the container with',
          '#   --cap-add=NET_ADMIN   (Podman: --cap-add=NET_ADMIN)',
          '# The container also needs the host network (--network=host) to reach',
          '# the LAN it is clearing.',
          '#!/bin/sh',
          'cat > ' + h + " <<'EOF'",
          this.arpScript(),
          'EOF',
          'chmod 755 ' + h,
          'printf \'%s\\n\' "' + this.arpSudoers().trimEnd() + '" > ' + this.arpSudoersPath(),
          'chmod 440 ' + this.arpSudoersPath(),
        ].join('\n');
      },

      openDevice(d) {
        this.selected = d;
        this.editLabel = d.label || '';
        this.editNotes = d.notes || '';
        const pick = this.typePick(d.type);
        this.editType = pick.type;
        this.editTypeText = pick.text;
      },
      async saveDevice() {
        try {
          const dtype = this.typeToSave(this.editType, this.editTypeText, this.selected.type);
          const r = await api('devices/' + this.selected.id, {
            method: 'PATCH',
            body: JSON.stringify({ label: this.editLabel, notes: this.editNotes, dtype, known: true }),
          });
          const i = this.devices.findIndex((d) => d.id === r.device.id);
          if (i >= 0) this.devices.splice(i, 1, r.device);
          this.selected = null;
        } catch (e) { this.fail(e); }
      },
      // The named devices, gathered for editing in one place rather than one
      // drawer at a time. "Named" is anything you have saved — given a name, or
      // otherwise marked as known.
      openRegEditor() {
        this.editRegRows = this.devices
          .filter((d) => d.known || d.label)
          .slice()
          .sort((a, b) => String(a.label || a.hostname || a.ip).localeCompare(String(b.label || b.hostname || b.ip)))
          .map((d) => {
            const pick = this.typePick(d.type);
            return { id: d.id, ip: d.ip, mac: d.mac, hostname: d.hostname, label: d.label || '', type: pick.type, typeText: pick.text, oldType: d.type, notes: d.notes || '', remove: false };
          });
        this.editReg = true;
      },
      async saveRegEditor() {
        this.busy.reg = true;
        try {
          for (const r of this.editRegRows) {
            if (r.remove) {
              await api('devices/' + r.id, { method: 'DELETE' }).catch(() => {});
              continue;
            }
            await api('devices/' + r.id, {
              method: 'PATCH',
              body: JSON.stringify({ label: r.label, notes: r.notes, dtype: this.typeToSave(r.type, r.typeText, r.oldType), known: true }),
            }).catch(() => {});
          }
          await this.loadDevices();
          this.editReg = false;
        } finally { this.busy.reg = false; }
      },
      async removeDevice(d) {
        try {
          await api('devices/' + d.id, { method: 'DELETE' });
          this.devices = this.devices.filter((x) => x.id !== d.id);
          this.selected = null;
        } catch (e) { this.fail(e); }
      },
      async wake(d) {
        try { await api('tools/wol', { method: 'POST', body: JSON.stringify({ mac: d.mac }) }); this.note(T('Magic packet sent to {mac}', { mac: d.mac })); } catch (e) { this.fail(e); }
      },
      toolFor(tool) {
        const target = this.selected.ip;
        this.selected = null;
        // NETBASE-STORE-REMOVED: per-device ping, ports and nmap
//         if (tool === 'ping') { this.pingHost = target; this.tab = 'ping'; this.runPing(); }
//         if (tool === 'ports') { this.portHost = target; this.tab = 'ports'; this.runPorts(); }
//         if (tool === 'nmap') { this.nmapTargets = target; this.tab = 'nmap'; }
      },

      async guarded(key, fn) {
        this.busy[key] = true;
        try { return await fn(); } catch (e) { this.fail(e); return null; } finally { this.busy[key] = false; }
      },
      // ---- device windows: the page comes through this server, so it works
      // from outside the LAN and several can be open at once ----
      async openDeviceWindow(device, port, scheme) {
        // A typed port carries its own protocol; a port the scan found is
        // looked up in the table.
        scheme = scheme || WEB_PORTS[port];
        if (!scheme || !device || !device.ip) return;
        const host = device.ip.includes(':') ? '[' + device.ip + ']' : device.ip;
        const base = scheme + '://' + host + (port === 80 || port === 443 ? '' : ':' + port);
        const offset = this.narrow ? 0 : (this.windows.length % 6) * 28;
        const w = {
          id: ++this.windowSeq, base, url: '', src: '', error: '', busy: true, full: false, escapes: 0, field: null, zoom: 1, fit: false, shooting: false, toast: null,
          loading: false, loadSecs: 0, loadTimer: null,
          here: '', trail: [], trailAt: -1, rewinding: false, help: false, z: ++this.windowTop,
          title: (device.name || device.ip) + ' · ' + port,
          x: this.narrow ? 0 : Math.max(20, Math.round(window.innerWidth / 2 - 520) + offset),
          y: this.narrow ? 0 : 90 + offset,
          w: this.narrow ? window.innerWidth : Math.min(1040, window.innerWidth - 60),
          h: this.narrow ? window.innerHeight : Math.min(700, window.innerHeight - 140),
        };
        this.windows.push(w);
        // Vue watches the copy it stored, not the object that was handed in.
        const live = this.windows[this.windows.length - 1];
        this.selected = null;
        try {
          // The address is issued by the server, signed: the window itself is
          // kept away from Nextcloud, so it cannot ask on its own behalf.
          const res = await api('proxy/ticket', { method: 'POST', body: JSON.stringify({ base }) });
          live.url = res.url;
          live.src = res.url + '?_nb=' + Date.now();
          this.startWindowLoad(live);
        } catch (e) {
          live.error = e.message || String(e);
        }
        live.busy = false;
      },
      // A slow line or a sleepy device can leave the frame blank for a while;
      // this shows that it is working, and how long it has been, until the page
      // loads (onWindowLoad) or an error replaces it.
      startWindowLoad(w) {
        if (!w) return;
        w.loading = true;
        w.loadSecs = 0;
        clearInterval(w.loadTimer);
        const t0 = Date.now();
        w.loadTimer = setInterval(() => { w.loadSecs = Math.floor((Date.now() - t0) / 1000); }, 1000);
      },
      endWindowLoad(w) {
        if (!w) return;
        w.loading = false;
        clearInterval(w.loadTimer);
        w.loadTimer = null;
      },
      /**
       * The net under the window.
       *
       * The proxy corrects the addresses it can see — in the markup, in the
       * scripts, and in what a script asks for while it runs. What it cannot
       * see is a page that hands the address to somebody else first: an ASUS
       * router's login page sets its own location through jQuery, and the
       * plain path it uses lands on Nextcloud's root instead of the device.
       *
       * The window can see it happen, though. The frame is on this origin, so
       * a page that has slipped out of the proxy's path is visible from here
       * and can simply be sent back to where it meant to go.
       */
      onWindowLoad(w, event) {
        const frame = event && event.target;
        let here = '';
        try { here = frame.contentWindow.location.pathname + frame.contentWindow.location.search; } catch (e) { this.endWindowLoad(w); return; }
        if (!here || !w.url) { this.endWindowLoad(w); return; }
        const prefix = w.url.replace(/\/$/, '');
        if (here.indexOf(prefix) === 0) {
          this.endWindowLoad(w);                        // the page is here — stop the loading indicator
          // Clicking a button up here takes the focus off whatever was being
          // typed into down there, so the field has to be remembered while it
          // still has it.
          try {
            const doc = frame.contentWindow.document;
            doc.addEventListener('focusin', (e) => { w.field = e.target; }, true);
          } catch (e) { /* not ours to listen to */ }
          if (w.fit) { this.applyFit(w, frame.contentWindow); } else { this.applyZoom(w, frame.contentWindow); }
          return;                                       // still inside the proxy
        }
        if (here === 'about:blank') return;
        // Twice is a mistake worth correcting; a third time is a page that
        // will not be helped, and would only bounce here for ever.
        w.escapes = (w.escapes || 0) + 1;
        if (w.escapes > 2) { w.error = T('This page keeps leaving the device window.'); this.endWindowLoad(w); return; }
        this.startWindowLoad(w);                         // a correction reload is coming; keep showing progress
        frame.contentWindow.location.replace(prefix + here);
      },
      canZoom(w, direction) {
        const at = ZOOM_STEPS.indexOf(w.zoom);
        const next = (at < 0 ? ZOOM_STEPS.indexOf(1) : at) + direction;
        return next >= 0 && next < ZOOM_STEPS.length;
      },
      /**
       * Fit the page to the window, and keep it fitted.
       *
       * A device interface is drawn for whatever screen its maker had in mind
       * — often 1024 wide, sometimes far more — and a window is whatever size
       * the person dragged it to. This measures what the page actually needs
       * and picks the factor, rather than making them hunt for it a step at a
       * time. It stays on: every page the window goes to is measured again,
       * and so is every drag of the window's corner.
       */
      toggleFit(w) {
        w.fit = !w.fit;
        if (w.fit) { this.applyFit(w); return; }
        w.zoom = 1;
        this.applyZoom(w);
      },
      applyFit(w, win) {
        try {
          const target = win || this.windowFrame(w);
          const frame = document.querySelector('.devwin-frame[data-window="' + w.id + '"]');
          if (!target || !target.document || !frame) return;
          const root = target.document.documentElement;
          const body = target.document.body;
          // Measured at its own size, or the last factor is measured with it.
          root.style.zoom = '';
          const needs = Math.max(root.scrollWidth || 0, body ? body.scrollWidth : 0);
          const room = frame.clientWidth;
          if (!needs || !room) { this.applyZoom(w, target); return; }
          const factor = Math.min(3, Math.max(0.25, room / needs));
          w.zoom = Math.round(factor * 100) / 100;
          root.style.zoom = w.zoom === 1 ? '' : String(w.zoom);
        } catch (e) { /* a document we may not touch */ }
      },
      zoomWindow(w, direction) {
        if (!this.canZoom(w, direction)) return;
        // Reaching for the step buttons means taking over from the fitting.
        w.fit = false;
        const at = ZOOM_STEPS.indexOf(w.zoom);
        w.zoom = ZOOM_STEPS[(at < 0 ? ZOOM_STEPS.indexOf(1) : at) + direction];
        this.applyZoom(w);
      },
      resetZoom(w) { w.fit = false; w.zoom = 1; this.applyZoom(w); },
      /**
       * A picture of the page as it stands.
       *
       * Taken by the server's own headless browser, through the same proxy
       * ticket this window is using — so it carries the same signed-in session
       * and shows what is on the screen, not a login page.
       */
      async shootWindow(w) {
        if (w.shooting || !w.url) return;
        w.shooting = true;
        try {
          const frame = document.querySelector('.devwin-frame[data-window="' + w.id + '"]');
          const token = w.url.replace(/\/$/, '').split('/').pop();
          const url = BASE + 'api/window/shot?' + qs({
            token,
            path: w.path || '',
            width: Math.round((frame && frame.clientWidth) || 1280),
            height: Math.round((frame && frame.clientHeight) || 900),
          });
          const response = await fetch(url);
          if (!response.ok) {
            let said = '';
            try { said = (await response.json()).error || ''; } catch (e) { said = ''; }
            throw new Error(said || ('HTTP ' + response.status));
          }
          const blob = await response.blob();
          const name = (w.title || 'device').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
            + '-' + stampFile() + '.png';
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 4000);
          this.windowToast(w, T('Saved as {name}', { name }), 'ok');
        } catch (e) {
          let msg = String((e && e.message) || e);
          if (/headless browser/i.test(msg)) { msg = T('This server has no headless browser installed, so it cannot take a picture of the page.'); }
          this.windowToast(w, msg, 'error');
        } finally { w.shooting = false; }
      },
      /**
       * A short message shown inside a device window. A window's z-index is
       * raised above the app's own banner on every focus, so a note put in the
       * banner would be hidden behind the very window it is about; this puts it
       * in the window instead.
       */
      windowToast(w, text, kind = 'ok', ms = 0) {
        w.toast = { text, kind };
        const shown = text;
        const wait = ms || (kind === 'error' ? 8000 : 4000);
        setTimeout(() => { if (w.toast && w.toast.text === shown) { w.toast = null; } }, wait);
      },
      /**
       * The zoom, put on the device's own document.
       *
       * Not on the frame: scaling the frame would scale the window with it.
       * The page is on this origin, so its root element can simply be told to
       * draw itself larger, and it reflows into the same window the way a
       * browser's own zoom does. Every page the window goes on to show is a
       * new document, so this is applied again on each load.
       */
      applyZoom(w, win) {
        try {
          const target = win || this.windowFrame(w);
          if (!target || !target.document || !target.document.documentElement) return;
          target.document.documentElement.style.zoom = w.zoom === 1 ? '' : String(w.zoom);
        } catch (e) { /* a document we may not touch */ }
      },
      /** The frame of a window, while it is still showing what we put there. */
      windowFrame(w) {
        const el = document.querySelector('.devwin-frame[data-window="' + w.id + '"]');
        try { return el && el.contentWindow && el.contentWindow.document ? el.contentWindow : null; } catch (e) { return null; }
      },
      /**
       * What is on the device's page, onto the clipboard.
       *
       * The frame is served from this origin, so the selection inside it can
       * be read — which is the whole point: a serial number or an error line
       * on a device page is otherwise retyped by hand.
       */
      copyFromWindow(w) {
        const win = this.windowFrame(w);
        if (!win) { this.note(T('The page cannot be read yet')); return; }
        let text = '';
        try {
          const picked = String(win.getSelection ? win.getSelection() : '');
          text = picked.trim() || (win.document.body ? win.document.body.innerText : '');
        } catch (e) { text = ''; }
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        if (!text) { this.note(T('There is no text on this page')); return; }
        this.copyText(text, T('Page text copied'));
      },
      /**
       * The clipboard into whatever the cursor is in.
       *
       * A device password is nearly always pasted rather than typed, and a
       * password box inside a frame does not always take the browser's own
       * paste — so this puts it in and tells the page it changed, which is
       * what a script watching the field is waiting for.
       */
      async pasteIntoWindow(w) {
        const win = this.windowFrame(w);
        if (!win) { this.note(T('The page cannot be read yet')); return; }
        let text = '';
        try { text = await navigator.clipboard.readText(); } catch (e) {
          this.note(T('The browser did not allow the clipboard to be read'));
          return;
        }
        if (!text) { this.note(T('The clipboard is empty')); return; }
        // Whatever had the focus last, falling back to whatever has it now.
        let field = w.field;
        try {
          if (!field || !field.isConnected) field = win.document.activeElement;
        } catch (e) { field = null; }
        const kind = field && field.tagName ? field.tagName.toLowerCase() : '';
        if (kind !== 'input' && kind !== 'textarea' && !(field && field.isContentEditable)) {
          this.note(T('Put the cursor in a field on the page first'));
          return;
        }
        if (field.isContentEditable) {
          field.textContent = text;
        } else {
          field.value = text;
        }
        // Whatever the page has watching this field has to hear about it.
        ['input', 'change'].forEach((name) => {
          field.dispatchEvent(new win.Event(name, { bubbles: true }));
        });
        try { field.focus(); } catch (e) { /* it may not want to be focused */ }
        this.note(T('Pasted'));
      },
      focusWindow(w) { w.z = ++this.windowTop; },
      onViewportResize() {
        this.narrow = window.innerWidth <= 900;
        if (this.narrow) return;
        // Turning a phone back to a desktop width would otherwise leave the
        // windows off the edge of the screen, with no title bar to drag.
        for (const w of this.windows) {
          w.w = Math.min(w.w, window.innerWidth - 40);
          w.h = Math.min(w.h, window.innerHeight - 100);
          w.x = Math.max(0, Math.min(w.x, window.innerWidth - 120));
          w.y = Math.max(0, Math.min(w.y, window.innerHeight - 60));
        }
      },
      onWindowMessage(event) {
        const data = event && event.data;
        if (!data || (data.netbase !== 'frames' && data.netbase !== 'here')) return;
        const frame = [...document.querySelectorAll('.devwin-frame')].find((f) => f.contentWindow === event.source);
        if (!frame) return;
        const w = this.windows.find((x) => x.src === frame.getAttribute('src'));
        if (!w) return;
        // The window says where it has got to, so the address line follows the
        // page the way a browser's would, and a reload comes back to it.
        // The cache-buster is ours, not the page's; it has no place in a trail.
        const href = data.href ? data.href.replace(/([?&])_nb=\d+&?/, '$1').replace(/[?&]$/, '') : '';
        if (href && w.url && href.startsWith(w.url.replace(/\/$/, ''))) {
          w.here = href;
          w.path = href.slice(w.url.length).replace(/\?.*$/, '');
          // The window keeps its own trail, because a page held at arm's
          // length cannot be asked to go back by the app around it.
          if (w.rewinding) {
            w.rewinding = false;
          } else if (w.trail[w.trailAt] !== href) {
            w.trail = w.trail.slice(0, w.trailAt + 1);
            w.trail.push(href);
            w.trailAt = w.trail.length - 1;
          }
        }
      },
      openRowMenu(device, event) {
        // Near the pointer, but never off the edge.
        const width = 260;
        const height = 40 + (this.rowActions(device).length + 2) * 34;
        this.rowMenu = {
          open: true, device,
          x: Math.min(event.clientX, window.innerWidth - width - 8),
          y: Math.min(event.clientY, Math.max(8, window.innerHeight - height - 8)),
        };
      },
      /**
       * The ways into this device, from the ports it actually has open.
       *
       * Nothing speculative: a port that is not open is not offered, and a web
       * page is offered only for a port NetBase knows serves one or has been
       * shown to.
       */
      rowActions(device) {
        if (!device) return [];
        const ports = (device.ports || []).map(Number);
        const web = this.knownWeb(device);
        const out = [];
        const canOpen = this.allowed('preview');
        const has = (p) => ports.indexOf(p) >= 0;
        if (canOpen && has(80)) out.push({ icon: '🖥', label: T('Open over HTTP'), run: () => this.openDeviceWindow(device, 80, 'http') });
        if (canOpen && has(443)) out.push({ icon: '🔒', label: T('Open over HTTPS'), run: () => this.openDeviceWindow(device, 443, 'https') });
        // Any other port that has been shown to serve a page.
        web.filter((p) => p !== 80 && p !== 443).forEach((p) => {
          if (canOpen) out.push({ icon: '🖥', label: T('Open port {port}', { port: p }), run: () => this.openDeviceWindow(device, p, p === 443 ? 'https' : 'http') });
        });
        if (has(21) && this.allowed('files')) out.push({ icon: '📁', label: T('Open over FTP'), run: () => this.openPortTool(device, 21) });
        if (has(22) && this.allowed('sshexec')) out.push({ icon: '🖳', label: T('Open an SSH window'), run: () => this.openTerminal('ssh', device.ip, 22) });
        if (has(23) && this.allowed('sshexec')) out.push({ icon: '🖳', label: T('Open a Telnet window'), run: () => this.openTerminal('telnet', device.ip, 23) });
        return out;
      },
      closeWindow(w) { clearInterval(w.loadTimer); this.windows = this.windows.filter((x) => x.id !== w.id); },

      // ---- terminal windows: the same frame as a device window, holding a
      // line of text rather than a page ----
      /**
       * A terminal for one device, opened beside the list rather than instead
       * of it. Ports 22 and 23 used to change tab, which closed the device and
       * left no way back to where the person was.
       */
      // ---- the local shell: a terminal on this very server ----
      /**
       * Ask the server to open a shell, and do whatever it says has to happen
       * first. A closed network opens straight away; an online one sends a
       * code to the administrator's mailbox and waits for it to be typed back.
       */
      async beginShell() {
        if (this.shellBusy) return;
        this.shellBusy = true;
        this.shellError = '';
        try {
          const r = await api('shell/begin', { method: 'POST', body: '{}' });
          if (r.mode === 'open') {
            // A closed network: no dialog, straight to the terminal.
            this.shellStage = 'idle';
            this.shellModal = false;
            this.openShellWindow();
          } else if (r.mode === 'verify') {
            this.shellEmail = r.email || '';
            this.shellCode = '';
            this.shellError = '';
            this.shellStage = 'verify';
            this.shellModal = true;
            this.$nextTick(() => { const b = this.$refs.shellCode; const el = Array.isArray(b) ? b[0] : b; if (el) el.focus(); });
          } else if (r.mode === 'no-email') {
            this.shellStage = 'no-email';
            this.shellModal = true;
          } else {
            this.shellStage = 'mail-failed';
            this.shellModal = true;
          }
        } catch (e) {
          this.note(String((e && e.message) || e));
        } finally {
          this.shellBusy = false;
        }
      },
      async verifyShell() {
        if (this.shellBusy || this.shellCode.length !== 6) return;
        this.shellBusy = true;
        this.shellError = '';
        try {
          const r = await api('shell/verify', { method: 'POST', body: JSON.stringify({ code: this.shellCode }) });
          if (r.ok) {
            this.shellStage = 'idle';
            this.shellCode = '';
            this.shellModal = false;
            this.openShellWindow();
          } else if (r.error === 'too-many') {
            this.shellError = T('Too many wrong codes. Send a new one.');
            this.shellCode = '';
          } else if (r.error === 'expired') {
            this.shellError = T('That code has expired. Send a new one.');
            this.shellCode = '';
          } else {
            this.shellError = r.remaining != null
              ? T('That code is not right. {n} tries left.', { n: r.remaining })
              : T('That code is not right.');
            this.shellCode = '';
          }
        } catch (e) {
          this.shellError = String((e && e.message) || e);
        } finally {
          this.shellBusy = false;
        }
      },
      openShellWindow() {
        const w = this.openTerminal('shell');
        return w;
      },
      /**
       * Keep a typed code to six digits.
       *
       * The regex belongs here rather than in the template: a backslash
       * written there does not survive the build, and "\D" quietly became a
       * plain "D" — which stripped the letter D and let anything else stay.
       */
      onlyDigits(value) {
        return String(value == null ? '' : value).replace(/\D/g, '').slice(0, 6);
      },
      closeShellModal() {
        this.shellModal = false;
        this.shellStage = 'idle';
        this.shellCode = '';
        this.shellError = '';
      },

      openTerminal(kind, host, port, auth = null) {
        const offset = this.narrow ? 0 : (this.terms.length % 6) * 26;
        const w = {
          id: ++this.windowSeq, kind, host, port: port || (kind === 'telnet' ? 23 : 22),
          user: '', password: '', signedIn: kind !== 'telnet', prompt: '',
          lines: [], command: '', history: [], at: -1, busy: false, cwd: '', full: false,
          // What this window has to say for itself, and whether the next key
          // carries Meta or Ctrl.
          toast: null, meta: false, ctrl: false, keyMenu: false, menuX: 0, menuY: 0,
          // How this window signs in, kept with the window: two consoles open
          // on two servers must not share one set of credentials.
          auth: auth ? { ...auth } : null,
          z: ++this.windowTop,
          x: this.narrow ? 0 : Math.max(20, Math.round(window.innerWidth / 2 - 430) + offset),
          y: this.narrow ? 0 : 96 + offset,
          w: this.narrow ? window.innerWidth : Math.min(860, window.innerWidth - 60),
          h: this.narrow ? window.innerHeight : Math.min(520, window.innerHeight - 150),
        };
        this.terms.push(w);
        const live = this.terms[this.terms.length - 1];
        this.selected = null;
        // Both the SSH terminal and the local shell are real screens driven by
        // a held-open stream; Telnet alone is the line-at-a-time console.
        if (kind === 'ssh' || kind === 'shell') {
          live.sid = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
          this.$nextTick(() => this.startPty(live));
        }
        return live;
      },
      /**
       * Open the screen and the connection behind it.
       *
       * The stream is one request that never returns until the session ends,
       * so what arrives is written to the screen as it arrives. Keystrokes go
       * back the other way, one small request at a time — a terminal types far
       * more slowly than a network carries.
       */
      startPty(w) {
        const box = this.$refs['screen' + w.id];
        const el = Array.isArray(box) ? box[0] : box;
        if (!el || !window.Terminal) {
          this.termNote(w, T('This browser could not start a terminal.'));
          return;
        }
        const dark = document.documentElement.dataset.themeDark !== undefined
          || document.body.classList.contains('theme--dark')
          || window.matchMedia('(prefers-color-scheme: dark)').matches;
        const term = new window.Terminal({
          fontSize: this.termSize(),
          fontFamily: this.termFontCss(this.settings.termFont),
          cursorBlink: true,
          scrollback: 5000,
          theme: dark
            ? { background: '#14161a', foreground: '#e6e6e6', cursor: '#e6e6e6' }
            : { background: '#1b1d21', foreground: '#e6e6e6', cursor: '#e6e6e6' },
        });
        const fit = window.FitAddon ? new window.FitAddon.FitAddon() : null;
        if (fit) term.loadAddon(fit);
        term.open(el);
        if (fit) { try { fit.fit(); } catch (e) { /* the window may not be laid out yet */ } }
        SCREENS.set(w.id, { term, fit, abort: null });
        term.onData((data) => {
          // Ctrl and Meta were armed by their buttons, and each holds for one
          // keystroke: Ctrl folds the key down to its control code, Meta puts
          // an ESC in front of whatever comes out.
          if (w.ctrl) {
            w.ctrl = false;
            if (data.length === 1) {
              const code = data.toUpperCase().charCodeAt(0);
              if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
            }
          }
          if (w.meta) { w.meta = false; data = '\x1b' + data; }
          this.ptyType(w, data);
        });
        term.onResize(({ cols, rows }) => this.ptySize(w, cols, rows));
        term.focus();
        this.streamPty(w);
      },
      async streamPty(w) {
        const live = SCREENS.get(w.id);
        if (!live) return;
        const controller = new AbortController();
        live.abort = controller;
        const body = {
          session: w.sid,
          cols: live.term.cols || 80,
          rows: live.term.rows || 24,
        };
        if (w.kind === 'shell') {
          // A shell on this server needs no connection details: it opens only
          // for an administrator who has already passed the gate.
          try {
            const r = await fetch(BASE + 'api/shell/pty', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', requesttoken: TOKEN },
              credentials: 'same-origin',
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            if (!r.ok || !r.body) { this.termNote(w, T('Could not open a shell.')); return; }
            const reader = r.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value || !value.length) continue;
              const said = value.some((b) => b === 0) ? value.filter((b) => b !== 0) : value;
              if (said.length) live.term.write(said);
            }
          } catch (e) {
            if (!controller.signal.aborted) this.termNote(w, String((e && e.message) || e));
          }
          this.termNote(w, T('The shell has closed.'));
          return;
        }
        if (w.conn) {
          body.id = w.conn;
        } else {
          const a = w.auth || {};
          body.connection = {
            kind: 'ssh', mode: 'ssh', host: w.host, port: w.port || 22,
            username: w.user || a.username || '',
            authType: a.authType === 'key' ? 'key' : 'password',
            secret: a.secret || '', privateKeyPath: a.privateKeyPath || '', passphrase: a.passphrase || '',
          };
        }
        try {
          const r = await fetch(BASE + 'api/ssh/pty', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', requesttoken: TOKEN },
            credentials: 'same-origin',
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!r.ok || !r.body) { this.termNote(w, T('Could not connect')); return; }
          const reader = r.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || !value.length) continue;
            // A zero byte is the server asking whether anyone is still here;
            // it is not part of what the shell said.
            const said = value.some((b) => b === 0) ? value.filter((b) => b !== 0) : value;
            if (said.length) live.term.write(said);
          }
        } catch (e) {
          if (!controller.signal.aborted) this.termNote(w, String((e && e.message) || e));
        }
        this.termNote(w, T('The connection has closed.'));
      },
      termNote(w, text) {
        const live = SCREENS.get(w.id);
        if (live) live.term.write('\r\n\x1b[33m' + text + '\x1b[0m\r\n');
      },
      /**
       * Keystrokes, in the order they were typed.
       *
       * One request per key would race: two of them in flight at once arrive
       * in whichever order the server happens to take them, and "whoami"
       * lands as "whaomi". So a window sends one request at a time and
       * everything typed meanwhile rides along in the next one.
       */
      ptyType(w, data) {
        const live = SCREENS.get(w.id);
        if (!live || !w.sid) return;
        live.outbox = (live.outbox || '') + data;
        if (live.sending) return;
        live.sending = true;
        (async () => {
          const path = w.kind === 'shell' ? 'shell/pty/type' : 'ssh/pty/type';
          while (live.outbox) {
            const chunk = live.outbox;
            live.outbox = '';
            try {
              await api(path, { method: 'POST', body: JSON.stringify({ session: w.sid, data: chunk }) });
            } catch (e) { /* the stream reports a lost session; a lost key need not */ }
          }
          live.sending = false;
        })();
      },
      async ptySize(w, cols, rows) {
        if (!w.sid) return;
        try {
          await api(w.kind === 'shell' ? 'shell/pty/size' : 'ssh/pty/size', { method: 'POST', body: JSON.stringify({ session: w.sid, cols, rows }) });
        } catch (e) { /* the next redraw will sort itself out */ }
      },
      clearTerm(w) {
        const live = SCREENS.get(w.id);
        if (live) { live.term.clear(); return; }
        w.lines = [];
      },
      /**
       * Copy from the screen: whatever is selected, or — with `all`, or when
       * nothing is selected — the entire buffer, scrollback included.
       *
       * What it says, it says inside this window. A banner across the whole
       * app for something one terminal did is too loud, and it covers the app
       * rather than the screen the text came from.
       */
      async copyTerm(w, all = false) {
        const live = SCREENS.get(w.id);
        if (!live || !live.term) return;
        let text = all ? '' : live.term.getSelection();
        if (!text) {
          const buf = live.term.buffer.active;
          const lines = [];
          for (let i = 0; i < buf.length; i++) {
            const line = buf.getLine(i);
            lines.push(line ? line.translateToString(true) : '');
          }
          text = lines.join('\n').replace(/\s+$/, '') + '\n';
        }
        if (!text.trim()) { this.windowToast(w, T('There is nothing on the screen yet.'), 'error', 2500); return; }
        await this.toClipboard(text);
        this.windowToast(w, all ? T('The whole screen is on the clipboard') : T('Copied'), 'ok', 1200);
        live.term.focus();
      },
      /** Paste the clipboard into the terminal, as if it had been typed. */
      async pasteTerm(w) {
        const live = SCREENS.get(w.id);
        if (!live) return;
        let text = '';
        try {
          text = await navigator.clipboard.readText();
        } catch (e) {
          this.windowToast(w, T('The browser did not allow the clipboard to be read'), 'error');
          return;
        }
        if (!text) { this.windowToast(w, T('The clipboard is empty'), 'error', 2500); return; }
        this.ptyType(w, text);
        live.term.focus();
      },
      /**
       * Meta for the next keystroke only.
       *
       * A terminal receives Meta as an ESC in front of the key. Not every
       * keyboard sends Alt that way — and a browser keeps some Alt
       * combinations for itself — so it can be armed here instead, and the
       * next key carries it.
       */
      toggleMeta(w) {
        w.meta = !w.meta;
        // Armed for the next keystroke, which is typed at the screen — so the
        // menu gets out of the way.
        w.keyMenu = false;
        const live = SCREENS.get(w.id);
        if (live) live.term.focus();
      },
      /**
       * Open the key-and-font menu under its button.
       *
       * Its place is worked out in viewport coordinates, because the toolbar
       * scrolls sideways on a narrow window and anything drawn inside it
       * would be cut off at the bar's edge.
       */
      toggleKeyMenu(w, ev) {
        if (w.keyMenu) { w.keyMenu = false; return; }
        const box = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
        const width = 260;
        w.menuX = box ? Math.max(8, Math.min(box.left, window.innerWidth - width - 8)) : 8;
        w.menuY = box ? box.bottom + 4 : 8;
        w.keyMenu = true;
      },
      /** A locale worth suggesting, from the language NetBase is being used in. */
      suggestedLocale() {
        const chosen = this.settings.language && this.settings.language !== 'auto'
          ? this.settings.language
          : (document.documentElement.lang || 'en');
        const lang = String(chosen).slice(0, 2).toLowerCase();
        return (LOCALE_HINTS[lang] || (lang + '_' + lang.toUpperCase())) + '.UTF-8';
      },
      /**
       * Reloading PHP is what makes a new locale visible to the shell.
       *
       * Only Debian and Ubuntu name the unit after the PHP version; elsewhere
       * it is plain php-fpm, and a server running PHP inside Apache has no
       * such unit at all — so the line says to use whatever runs PHP here.
       */
      phpFpmReload() {
        const version = String((this.requirements && this.requirements.phpVersion) || '').split('.').slice(0, 2).join('.');
        const manager = (this.requirements && this.requirements.packageManager) || '';
        const unit = (manager === 'apt-get' && version) ? ('php' + version + '-fpm') : 'php-fpm';
        return 'sudo systemctl reload ' + unit + '   # whatever runs PHP here, or restart the web server';
      },
      /**
       * How to give this server another language.
       *
       * Written for the package manager the machine actually uses, with the
       * locale itself on the first line so any language can be had without
       * rewriting the rest.
       */
      localeSteps() {
        const want = this.suggestedLocale();
        const manager = (this.requirements && this.requirements.packageManager) || '';
        if (manager === 'dnf' || manager === 'yum') {
          return [
            'LOCALE=' + want,
            '',
            '# Fedora / RHEL: the language pack carries the locale',
            'sudo ' + manager + ' install -y glibc-langpack-' + want.split('_')[0],
            '',
            '# let PHP see it',
            this.phpFpmReload(),
          ].join('\n');
        }
        return [
          'LOCALE=' + want,
          '',
          '# Debian / Ubuntu',
          'sudo apt-get update',
          'sudo apt-get install -y locales',
          'sudo sed -i "s/^# *${LOCALE}/${LOCALE}/" /etc/locale.gen',
          'sudo locale-gen',
          '',
          '# let PHP see it',
          this.phpFpmReload(),
        ].join('\n');
      },
      localeDockerHook() {
        return [
          '#!/bin/sh',
          '# /docker-entrypoint-hooks.d/before-starting/locale.sh',
          '# Runs on every start, so it outlives an image update.',
          'LOCALE=' + this.suggestedLocale(),
          'apt-get update >/dev/null 2>&1 || true',
          'apt-get install -y locales >/dev/null 2>&1 || true',
          'sed -i "s/^# *${LOCALE}/${LOCALE}/" /etc/locale.gen 2>/dev/null || true',
          'locale-gen >/dev/null 2>&1 || true',
        ].join('\n');
      },
      /** The extra folder to look in for fonts, and the list it changes. */
      async saveFontDir() {
        try {
          await api('settings', { method: 'POST', body: JSON.stringify({ settings: { admin: { fontDir: this.settings.admin.fontDir || '' } } }) });
          const fresh = await api('settings');
          this.settings = { ...this.settings, ...fresh };
        } catch (e) { this.fail(e); }
      },
      /** The shell's language and environment, kept for the next one opened. */
      saveShell() {
        api('settings', {
          method: 'POST',
          body: JSON.stringify({ settings: { shellLang: this.settings.shellLang || '', shellEnv: this.settings.shellEnv || '' } }),
        }).catch((e) => this.fail(e));
      },
      /** How much of a terminal to keep, and for how long. */
      saveTermLog() {
        const steps = Math.max(1, Math.min(10000, Number(this.settings.termLogSteps) || 5000));
        const days = Math.max(1, Math.min(3650, Number(this.settings.termLogDays) || 30));
        this.settings.termLogSteps = steps;
        this.settings.termLogDays = days;
        api('settings', {
          method: 'POST',
          body: JSON.stringify({ settings: { termLogOn: this.settings.termLogOn ? '1' : '0', termLogSteps: String(steps), termLogDays: String(days) } }),
        }).catch((e) => this.fail(e));
      },
      async openTermLog() {
        this.termLog.open = true;
        this.termLog.session = null;
        this.termLog.steps = [];
        this.termLog.loading = true;
        try {
          const r = await api('termlog');
          this.termLog.sessions = r.sessions || [];
        } catch (e) { this.fail(e); } finally { this.termLog.loading = false; }
      },
      async readTermLog(session) {
        this.termLog.loading = true;
        try {
          const r = await api('termlog/read?' + qs({ session: session.session }));
          this.termLog.session = session;
          this.termLog.steps = r.steps || [];
        } catch (e) { this.fail(e); } finally { this.termLog.loading = false; }
      },
      /** Drop one recorded session, or every one of them. */
      async forgetTermLog(session) {
        try {
          await api('termlog/forget', { method: 'POST', body: JSON.stringify({ session: session || '' }) });
          this.termLog.session = null;
          this.termLog.steps = [];
          this.termLog.sessions = session
            ? this.termLog.sessions.filter((s) => s.session !== session)
            : [];
        } catch (e) { this.fail(e); }
      },
      /** The stack behind a chosen face, falling back to the default one. */
      termFontCss(id) {
        if (String(id || '').startsWith('server:')) {
          this.ensureServerFont(id);
          return '"' + SERVER_FONT_PREFIX + String(id).slice(7) + '", monospace';
        }
        return (TERM_FONTS.find((f) => f.id === id) || TERM_FONTS[0]).css;
      },
      /**
       * Make one of the server's own fonts available to the browser.
       *
       * The file lives on the server, so it has to be fetched before anything
       * can be drawn in it. The rule is added once per font and the browser
       * keeps the file, so this is paid the first time only.
       */
      ensureServerFont(id) {
        const hash = String(id || '').slice(7);
        if (!hash || SERVER_FONTS_ADDED.has(hash)) return;
        SERVER_FONTS_ADDED.add(hash);
        const style = document.createElement('style');
        style.textContent = '@font-face{font-family:"' + SERVER_FONT_PREFIX + hash + '";'
          + 'src:url("' + BASE + 'api/font/' + encodeURIComponent(hash) + '");font-display:swap;}';
        document.head.appendChild(style);
      },
      /** A file size a person can judge at a glance. */
      fontSize(bytes) {
        const mb = (Number(bytes) || 0) / 1048576;
        return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round((Number(bytes) || 0) / 1024)) + ' KB';
      },
      termSize() {
        const n = Number(this.settings.termFontSize) || TERM_SIZE_DEFAULT;
        return Math.max(TERM_SIZE_MIN, Math.min(TERM_SIZE_MAX, Math.round(n)));
      },
      /**
       * Put the chosen face and size on every terminal that is open, and keep
       * the choice for next time.
       *
       * Changing the size changes how many rows and columns fit, so each
       * screen is measured again and the far end is told the new shape —
       * otherwise the shell would keep wrapping to the old width.
       */
      applyTermFont() {
        const family = this.termFontCss(this.settings.termFont);
        const size = this.termSize();
        this.settings.termFontSize = size;
        for (const w of this.terms) {
          const live = SCREENS.get(w.id);
          if (!live || !live.term) continue;
          live.term.options.fontFamily = family;
          live.term.options.fontSize = size;
          if (live.fit) { try { live.fit.fit(); } catch (e) { /* mid-drag */ } }
          this.ptySize(w, live.term.cols, live.term.rows);
        }
        api('settings', {
          method: 'POST',
          body: JSON.stringify({ settings: { termFont: this.settings.termFont, termFontSize: String(size) } }),
        }).catch(() => { /* the look is applied either way */ });
      },
      stepTermSize(by) {
        this.settings.termFontSize = Math.max(TERM_SIZE_MIN, Math.min(TERM_SIZE_MAX, this.termSize() + by));
        this.applyTermFont();
      },
      /** Ctrl for the next keystroke only, the same way Meta works. */
      toggleCtrl(w) {
        w.ctrl = !w.ctrl;
        w.keyMenu = false;
        const live = SCREENS.get(w.id);
        if (live) live.term.focus();
      },
      /**
       * One key, straight to the shell.
       *
       * These are the keys a browser is most likely to keep for itself —
       * Ctrl+C while something is selected is its copy, Ctrl+R its reload — so
       * a button sends the code the terminal expects and the browser never
       * sees it.
       */
      sendKey(w, name) {
        const live = SCREENS.get(w.id);
        const code = KEY_CODES[name];
        if (!live || !code) return;
        this.ptyType(w, code);
        // The menu has had its use: shut it, or it stands over the screen the
        // key was just sent to.
        w.keyMenu = false;
        live.term.focus();
      },
      /**
       * A picture of the screen, saved as a PNG.
       *
       * The rows are drawn from the elements xterm has already laid out, so
       * the colours in the file are the colours on the screen. A wide
       * character takes two cells, as it does in the terminal itself.
       */
      shootTerm(w) {
        const live = SCREENS.get(w.id);
        if (!live || !live.term) return;
        const rowBox = live.term.element && live.term.element.querySelector('.xterm-rows');
        const rows = rowBox ? [...rowBox.children] : [];
        if (!rows.length) { this.windowToast(w, T('The screen could not be read.'), 'error'); return; }

        const wide = (ch) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/.test(ch);
        const face = getComputedStyle(rowBox);
        const size = parseFloat(face.fontSize) || 13;
        const cols = live.term.cols || 80;
        const cell = rowBox.getBoundingClientRect().width / cols;
        const rowH = rows[0].getBoundingClientRect().height || Math.round(size * 1.2);
        const pad = 8;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil((cols * cell + pad * 2) * ratio);
        canvas.height = Math.ceil((rows.length * rowH + pad * 2) * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.fillStyle = (live.term.options && live.term.options.theme && live.term.options.theme.background) || '#1b1d21';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = size + 'px ' + face.fontFamily;
        ctx.textBaseline = 'top';
        const lift = Math.max(0, (rowH - size) / 2);

        rows.forEach((row, r) => {
          const y = pad + r * rowH;
          let col = 0;
          for (const node of row.childNodes) {
            const text = node.textContent || '';
            if (!text) continue;
            const style = getComputedStyle(node.nodeType === 1 ? node : row);
            const paint = style.backgroundColor;
            const inked = paint && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(paint);
            for (const ch of text) {
              const span = wide(ch) ? 2 : 1;
              const x = pad + col * cell;
              if (inked) { ctx.fillStyle = paint; ctx.fillRect(x, y, cell * span, rowH); }
              if (ch.trim()) { ctx.fillStyle = style.color; ctx.fillText(ch, x, y + lift); }
              col += span;
            }
          }
        });

        const name = 'netbase-' + (w.kind === 'shell' ? 'shell' : 'ssh') + '-' + stampFile() + '.png';
        canvas.toBlob((blob) => {
          if (!blob) { this.windowToast(w, T('The screen could not be read.'), 'error'); return; }
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 4000);
          this.windowToast(w, T('Saved as {name}', { name }), 'ok', 2500);
        }, 'image/png');
      },
      /** Make the screen match the window it sits in. */
      refitTerm(w) {
        const live = SCREENS.get(w.id);
        if (!live || !live.fit) return;
        this.$nextTick(() => { try { live.fit.fit(); } catch (e) { /* mid-drag */ } });
      },
      closeTerm(w) {
        const live = SCREENS.get(w.id);
        if (live) {
          if (live.abort) { try { live.abort.abort(); } catch (e) { /* already gone */ } }
          try { live.term.dispose(); } catch (e) { /* already gone */ }
          SCREENS.delete(w.id);
        }
        if (w.sid) api(w.kind === 'shell' ? 'shell/pty/close' : 'ssh/pty/close', { method: 'POST', body: JSON.stringify({ session: w.sid }) }).catch(() => {});
        this.terms = this.terms.filter((x) => x.id !== w.id);
      },
      termPrompt(w) {
        if (w.kind === 'telnet') return w.prompt || (w.host + '>');
        return (w.user ? w.user + '@' : '') + w.host + ':' + (w.cwd || '~') + '$';
      },
      say(w, kind, text, prompt) {
        String(text == null ? '' : text).split('\n').forEach((line, i) => {
          w.lines.push({ kind, text: line, prompt: i === 0 ? (prompt || '') : '' });
        });
        if (w.lines.length > 2000) w.lines.splice(0, w.lines.length - 2000);
        this.$nextTick(() => {
          const box = this.$refs['term' + w.id];
          const el = Array.isArray(box) ? box[0] : box;
          if (el) el.scrollTop = el.scrollHeight;
        });
      },
      /** Telnet asks who you are before it will say anything useful. */
      async signInTerm(w) {
        if (w.busy) return;
        w.busy = true;
        try {
          const r = await api('telnet/run', { method: 'POST', body: JSON.stringify({
            host: w.host, port: w.port, user: w.user, password: w.password, command: '',
          }) });
          if (!r.ok) { this.say(w, 'err', '⚠ ' + (r.error || T('Could not connect'))); return; }
          w.signedIn = true;
          w.prompt = r.prompt || '';
          if (r.output) this.say(w, 'out', r.output);
        } catch (e) { this.fail(e); } finally { w.busy = false; }
      },
      /**
       * The connection a window signs in with, as the API wants it.
       *
       * A window opened from a saved connection sends its id; one opened by
       * typing the details sends the details themselves, and they never go to
       * the browser's storage — they live in the window and die with it.
       */
      sshTarget(w, extra) {
        const a = w.auth || {};
        return {
          ...extra,
          connection: {
            kind: 'ssh', mode: 'ssh',
            host: w.host, port: w.port || 22,
            username: w.user || a.username || '',
            authType: a.authType === 'key' ? 'key' : 'password',
            secret: a.secret || '',
            privateKeyPath: a.privateKeyPath || '',
            passphrase: a.passphrase || '',
          },
        };
      },
      /** Telnet, in a window of its own; it asks who you are once it is open. */
      /** The port follows the kind, unless somebody has set one deliberately. */
      /**
       * SSH or Telnet: move the port to the usual one for the kind chosen.
       *
       * This was called adhocKindChanged — the same name the file transfer
       * panel uses for its own version. Two methods of one name in one
       * object is not an error in JavaScript: the second simply replaces
       * the first. So choosing Telnet ran the file-transfer version, which
       * set a port on a different form, and the port here never left 22.
       */
      /**
       * A device or a recent address is not a connection — it is a name for the
       * box below. Only a saved one stays in the picker.
       */
      /**
       * Switching between typing and picking.
       *
       * Leaving the list means the saved connection is no longer the target,
       * so it is let go; the typed details are left exactly as they were, so
       * going back and forth does not cost the reader their work.
       */
      setSshMode(mode) {
        if (this.sshMode === mode) return;
        this.sshMode = mode;
        this.sshPick = '';
        this.sshRunResult = null;
      },
      /**
       * One list, three kinds of entry — and the same rule on both screens.
       *
       * A saved connection is chosen, and nothing more: connecting is a button
       * of its own, so choosing one cannot start a session nobody asked for.
       * A device or a recent address only names a machine, with no account
       * behind it, so it fills the typed form and the choice moves there — if
       * it did not, the toggle would say "pick from the list" while the reader
       * was plainly typing.
       */
      sshPicked() {
        const value = String(this.sshPick || '');
        if (value && !value.startsWith('c')) {
          this.sshMode = 'type';
          this.sshPick = '';
          this.sshAdhoc.host = value;
          this.rememberHost(value);
        }
        this.sshRunResult = null;
      },
      sshKindChanged() {
        const usual = { ssh: 22, telnet: 23 };
        const other = this.sshAdhoc.kind === 'telnet' ? usual.ssh : usual.telnet;
        if (!this.sshAdhoc.port || this.sshAdhoc.port === other) {
          this.sshAdhoc.port = usual[this.sshAdhoc.kind] || 22;
        }
      },
      /** Ask who to sign in as, before opening a console. */
      askSsh(host, port = 22) {
        this.sshAsk = {
          open: true, host: host || '', port: port || 22,
          username: '', authType: 'password', secret: '', privateKeyPath: '', passphrase: '',
        };
      },
      connectAsk() {
        const ask = this.sshAsk;
        if (!ask.host || !ask.username) return;
        this.sshAsk = { ...ask, open: false };
        this.sshPick = '';
        const w = this.openTerminal('ssh', ask.host, ask.port || 22, {
          username: ask.username, authType: ask.authType,
          secret: ask.secret, privateKeyPath: ask.privateKeyPath, passphrase: ask.passphrase,
        });
        w.user = ask.username;
      },
      async sendTerm(w) {
        const command = (w.command || '').trim();
        if (!command || w.busy) return;
        w.history.push(command);
        w.at = w.history.length;
        w.command = '';
        this.say(w, 'cmd', command, this.termPrompt(w));
        w.busy = true;
        try {
          if (w.kind === 'telnet') {
            const r = await api('telnet/run', { method: 'POST', body: JSON.stringify({
              host: w.host, port: w.port, user: w.user, password: w.password, command,
            }) });
            if (!r.ok) { this.say(w, 'err', '⚠ ' + (r.error || T('Could not connect'))); return; }
            if (r.prompt) w.prompt = r.prompt;
            this.say(w, 'out', r.output || '');
            return;
          }
          const target = w.conn
            ? { id: w.conn, command, cwd: w.cwd }
            : this.sshTarget(w, { command, cwd: w.cwd });
          const r = await api('ssh/shell', { method: 'POST', body: JSON.stringify(target) });
          if (r.cwd) w.cwd = r.cwd;
          if (r.output) this.say(w, 'out', r.output);
          if (r.error) this.say(w, 'err', r.error);
        } catch (e) { this.say(w, 'err', String(e.message || e)); } finally { w.busy = false; }
      },
      termHistory(w, step) {
        if (!w.history.length) return;
        w.at = Math.max(0, Math.min(w.history.length, w.at + step));
        w.command = w.at < w.history.length ? w.history[w.at] : '';
      },
      backWindow(w) {
        if (w.trailAt < 1) return;
        w.trailAt -= 1;
        w.rewinding = true;
        const at = w.trail[w.trailAt];
        w.src = at + (at.includes('?') ? '&' : '?') + '_nb=' + Date.now();
      },
      homeWindow(w) {
        if (!w.url) return;
        w.src = w.url + '?_nb=' + Date.now();
      },
      reloadWindow(w) {
        const at = w.here || w.url;
        if (at) { w.src = at + (at.includes('?') ? '&' : '?') + '_nb=' + Date.now(); this.startWindowLoad(w); }
      },
      toggleFull(w) {
        if (w.full) {
          Object.assign(w, w.full);
          w.full = false;
          this.refitTerm(w);
          return;
        }
        w.full = { x: w.x, y: w.y, w: w.w, h: w.h };
        Object.assign(w, { x: 12, y: 60, w: window.innerWidth - 24, h: window.innerHeight - 76 });
        this.focusWindow(w);
        this.refitTerm(w);
      },
      startDrag(w, event) {
        this.focusWindow(w);
        this.drag = { w, mode: 'move', x: event.clientX, y: event.clientY, ox: w.x, oy: w.y };
        this.bindDrag();
      },
      startResize(w, event) {
        this.focusWindow(w);
        this.drag = { w, mode: 'size', x: event.clientX, y: event.clientY, ow: w.w, oh: w.h };
        this.bindDrag();
      },
      bindDrag() {
        const move = (e) => {
          const d = this.drag;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (d.mode === 'move') {
            d.w.x = Math.max(0, Math.min(window.innerWidth - 120, d.ox + dx));
            d.w.y = Math.max(48, Math.min(window.innerHeight - 60, d.oy + dy));
          } else {
            d.w.w = Math.max(360, d.ow + dx);
            d.w.h = Math.max(240, d.oh + dy);
          }
        };
        const up = () => {
          const dragged = this.drag;
          this.drag = null;
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          // A terminal is measured in characters, so a resized window has to
          // be told its new size before the next thing is drawn on it.
          if (dragged && dragged.mode === 'size') this.refitTerm(dragged.w);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      },

      /** A device's own web interface, when the port says it has one. */
      /** The device's own address for a web port, whoever is asking. */
      webUrl(device, port) {
        // A device interface can sit on any port its maker felt like. Anything
        // that is not a known service of another kind is worth trying, rather
        // than hiding a working page behind an unfamiliar number.
        const scheme = WEB_PORTS[port] || (NOT_WEB_PORTS.has(Number(port)) ? null : 'http');
        if (!scheme || !device || !device.ip) return null;
        const host = device.ip.includes(':') ? '[' + device.ip + ']' : device.ip;
        return scheme + '://' + host + (port === 80 || port === 443 ? '' : ':' + port);
      },
      /**
       * Whether a port number is one NetBase will offer to act on.
       *
       * The common ports and no others. A deeper scan turns up numbers whose
       * purpose nobody knows — 22401 on a router here — and guessing that they
       * are web pages made every one of them a link that mostly led nowhere.
       * A number NetBase cannot vouch for is printed as a number.
       */
      mainPort(port) {
        return (this.status.fingerprintPorts || []).indexOf(Number(port)) >= 0;
      },
      /** Ports this device has been asked about and answered with a page. */
      knownWeb(device) {
        return (device && device.extra && Array.isArray(device.extra.web)) ? device.extra.web : [];
      },
      portLink(device, port) {
        // Without the right to open a device page, the number is just a number:
        // better plain text than a link that can only fail.
        const worth = this.mainPort(port) || this.knownWeb(device).indexOf(Number(port)) >= 0;
        const href = this.allowed('preview') && worth ? this.webUrl(device, port) : null;
        if (!href) return null;
        return { href, title: T('Open {url} in a window, through this server', { url: href }) };
      },
      /** Ports NetBase can act on itself, rather than hand to the browser. */
      portTool(device, port) {
        const tool = TOOL_PORTS[port];
        if (!tool || !device.ip || !this.mainPort(port)) return null;
        if (!this.allowed(tool.tab === 'files' ? 'files' : tool.tab)) return null;
        return { ...tool, title: T(tool.label) };
      },
      openPortTool(device, port) {
        const tool = this.portTool(device, port);
        if (!tool) return;
        this.selected = null;
        this.tab = tool.tab;
        if (tool.tab === 'files') {
          // The type drives the saved list as well as the protocol, so both
          // move together; setting only one of them would leave the list
          // showing a different kind of server than the form is set to.
          this.filesKind = tool.kind;
          this.adhoc = { ...this.adhoc, kind: tool.kind, host: device.ip, port: port === 22 ? 22 : 21, mode: tool.kind === 'ftp' ? 'none' : 'ssh' };
          this.filesMode = 'type';
          this.filesPick = '';
          this.filesConn = 0;
        } else if (tool.tab === 'ssh') {
          this.sshMode = 'type'; this.sshPick = ''; this.sshAdhoc.host = device.ip;
          if (port === 23) { this.runTelnet(); } else { this.runSsh(); }
        } else if (tool.tab === 'mail') {
          this.mailView = 'server';
          this.mailHost = device.ip;
          this.mailProtocol = tool.protocol;
          this.mailPort = port;
          this.mailMode = 'auto';
          this.runMailProbe();
        }
      },
      showPage(url) {
        this.preview = { open: true, url, src: '', loading: true, error: null, full: false };
        this.reloadPreview();
      },
      reloadPreview() {
        if (!this.preview.url) return;
        this.preview.loading = true;
        this.preview.error = null;
        // The cache buster makes "reload" mean a fresh render, not a fresh copy
        // of the same picture.
        this.preview.src = BASE + 'api/preview?' + qs({
          url: this.preview.url,
          width: 1280,
          height: 900,
          full: this.preview.full ? 1 : 0,
          t: Date.now(),
        });
      },
      async previewFailed() {
        this.preview.loading = false;
        // The endpoint answers with JSON when it cannot render, so read it.
        try {
          const res = await fetch(this.preview.src, { credentials: 'same-origin' });
          const body = await res.json();
          this.preview.error = (body && body.error) || T('The page could not be rendered.');
        } catch (e) {
          this.preview.error = T('The page could not be rendered.');
        }
      },
      closePreview() { this.preview = { open: false, url: '', src: '', loading: false, error: null, full: false }; },

      /** Every web interface a device offers, for the buttons in its panel. */
      webLinks(device) {
        if (!device) return [];
        return (device.ports || []).filter((p) => WEB_PORTS[p]).map((p) => ({
          port: p,
          href: this.webUrl(device, p),
          label: WEB_PORTS[p] === 'https' ? T('Open (HTTPS {port})', { port: p }) : T('Open (HTTP {port})', { port: p }),
        }));
      },
      // reading this.locale makes every t() re-evaluate when the language changes
      async applyLanguage(lang) {
        if (!lang || lang === 'auto') {
          i18nOverride = null;
        } else {
          try {
            const r = await api('i18n/' + encodeURIComponent(lang));
            i18nOverride = (r && r.translations) ? r.translations : {};
          } catch (e) { i18nOverride = null; }
        }
        this.locale++;
      },
      async setLanguage(lang) {
        this.settings.language = lang;
        await this.applyLanguage(lang);
        try {
          await api('settings', { method: 'POST', body: JSON.stringify({ settings: { language: lang } }) });
        } catch (e) { this.fail(e); }
        // Findings and presets are written on the server in the chosen
        // language, so anything already on screen is now stale.
        this.requirements = await api('requirements').catch(() => this.requirements);
        this.status = await api('status').catch(() => this.status);
      },
      levelLabel(level) { return { bad: 'fix', warn: 'check', info: 'note', ok: 'ok' }[level] || level; },
      algoLabel(name) { return ALGO_LABELS[name] || ''; },
      modeLabel(mode) {
        // SSL/TLS and STARTTLS are what every mail client calls these, and what
        // the people setting them up have read in their provider's instructions.
        // Translating them into something more explanatory only made them
        // unrecognisable.
        return { none: 'None (plain text)', starttls: 'STARTTLS', tls: 'SSL/TLS', ssh: 'SSH (always encrypted)' }[mode] || mode;
      },
      capabilityText(caps) {
        if (!caps) return '';
        if (Array.isArray(caps)) return caps.join('\n');
        return Object.entries(caps).map(([k, v]) => (v === true ? k : k + ' ' + v)).join('\n');
      },
      fmtBytes(n) {
        if (n === null || n === undefined || n === '') return '';
        const units = ['B', 'kB', 'MB', 'GB', 'TB'];
        let value = Number(n); let i = 0;
        while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
        return (i === 0 ? value : value.toFixed(1)) + ' ' + units[i];
      },
      joinPath(base, name) { return (base === '/' ? '' : (base || '')) + '/' + name; },
      connById(id) { return this.connections.find((c) => c.id === id) || null; },

      // ---- saved connections ----
      async loadConnections() {
        const r = await this.guarded('connections', () => api('connections'));
        if (!r) return;
        this.connections = r.connections || [];
        this.connKinds = r.kinds || {};
        this.connGroups = r.groups || {};
        this.connCaps = r.capabilities || {};
        // An empty list means "none saved" or "nowhere to save them", and the
        // two need telling apart before anything is said to the reader.
        this.connSetup = r.setup || this.connSetup;
      },
      openConn(existing, kind) {
        this.connNote = '';
        if (existing) {
          const o = existing.options || {};
          this.connForm = {
            id: existing.id, kind: existing.kind, name: existing.name || '', host: existing.host || '',
            port: existing.port, mode: o.mode || 'none', username: existing.username || '', secret: '',
            authType: o.authType || 'password', privateKey: '', passphrase: '',
            from: o.from || '', path: o.path || '', passive: o.passive !== false,
            sendHost: o.sendHost || '', sendPort: o.sendPort || 0, sendMode: o.sendMode || 'starttls',
            notes: existing.notes || '', hasSecret: !!existing.hasSecret,
          };
        } else {
          const use = kind || 'ftp';
          const def = this.connKinds[use] || { port: 22, modes: ['none'] };
          this.connForm = { id: 0, kind: use, name: '', host: '', port: def.port, mode: def.modes[0], username: '', secret: '', authType: 'password', privateKey: '', privateKeyPath: '', passphrase: '', from: '', path: '', passive: true, sendHost: '', sendPort: 0, sendMode: 'starttls', notes: '', hasSecret: false };
        }
        this.connModal = true;
      },
      /**
       * The picture for one tool, drawn rather than spelled with an emoji.
       *
       * An emoji is whatever the reader's system decides it is, and several of
       * the ones this used said nothing about the tool: a satellite dish for
       * the machines on the LAN, a card index for domain registration, an
       * abacus for address maths. These are one set at one weight, and they
       * take the colour of the row they sit in.
       */
      tabIcon(id) {
        const icons = {
          // A rack of machines, because that is what answers on the network.
          devices: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle class="solid" cx="6.6" cy="7" r="1"/><circle class="solid" cx="6.6" cy="17" r="1"/><path d="M10 7h7M10 17h7"/>',
          // A signpost: a name pointing at an address, which is what DNS does.
          dns: '<path d="M4 4v16"/><path d="M4 5.5h11l3 3-3 3H4"/><path d="M4 14h8l3 3-3 3H4"/>',
          // A magnifier over a document: looking up who a name is registered to.
          whois: '<path d="M6 3h8l4 4v6"/><path d="M14 3v4h4"/><path d="M6 3v18h5"/><circle cx="16.5" cy="17.5" r="3.5"/><path d="M19.2 20.2 22 23"/>',
          // A padlock on a page: the certificate and the headers behind a site.
          tls: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9.5 16.5v-2a2.5 2.5 0 0 1 5 0v2"/><rect x="8.5" y="16.5" width="7" height="4" rx="1"/>',
          // One network cut into parts: what a subnet calculation produces.
          subnet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M12 12H3"/><path d="M21 7.5h-9"/><path d="M21 16.5h-9"/>',
          // A stopwatch: how fast, and how long it took.
          bench: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9"/><path d="M9.5 2.5h5"/><path d="M12 2.5v3"/><path d="M18.5 7 20 5.5"/>',
          // An envelope. The owner asked for a mail icon, and a mail icon it is.
          mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 8.3 6a1.2 1.2 0 0 0 1.4 0L21 7"/>',
          // A folder with an arrow leaving it, pointing right: files on the move.
          files: '<path d="M3 8.5V6a1.5 1.5 0 0 1 1.5-1.5h4L11 7h8.5A1.5 1.5 0 0 1 21 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/><path d="M9.5 13.5h7"/><path d="m13.8 10.8 2.7 2.7-2.7 2.7"/>',
          // A dark screen with a key on it: a shell you have to unlock.
          ssh: '<rect x="2.5" y="4" width="19" height="16" rx="2" class="solid"/><rect x="2.5" y="4" width="19" height="16" rx="2"/><circle cx="9.5" cy="12" r="2.4" fill="none" stroke="var(--surface, #fff)"/><path d="M11.9 12h5.6M15.4 12v2.2M17.5 12v1.6" stroke="var(--surface, #fff)"/>',
          // A clock with its hands off true: drift from a time server.
          ntp: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.4 2"/>',
        };
        const path = icons[id] || '<circle cx="12" cy="12" r="8"/>';
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
      },
      connKindChanged() {
        const def = this.connKinds[this.connForm.kind] || { port: 0, modes: ['none'] };
        this.connForm.port = def.port;
        this.connForm.mode = def.modes[0];
      },
      async saveConn() {
        const body = { connection: { ...this.connForm } };
        // An untouched credential field means "keep the stored one".
        if (this.connForm.id && this.connForm.secret === '') delete body.connection.secret;
        if (this.connForm.id && this.connForm.privateKey === '') delete body.connection.privateKey;
        if (this.connForm.privateKeyPath === '') delete body.connection.privateKeyPath;
        if (this.connForm.id && this.connForm.passphrase === '') delete body.connection.passphrase;
        const saved = await this.guarded('conn', () => api(
          this.connForm.id ? 'connections/' + this.connForm.id : 'connections',
          { method: this.connForm.id ? 'PUT' : 'POST', body: JSON.stringify(body) },
        ));
        if (!saved) return;
        await this.loadConnections();
        this.connModal = false;
        this.note(T('Connection saved'));
        // The details were typed into the quick form: carry on with the saved
        // connection instead, so the list and the browser agree.
        if (this.adhocActive && (saved.connection.kind === 'ftp' || saved.connection.kind === 'sftp')) {
          this.adhocActive = false;
          this.filesConn = saved.connection.id;
          this.browse(this.filesPath || '');
        }
        if (!this.filesConn && ['ftp', 'sftp', 'scp'].includes(saved.connection.kind)) {
          // Saved into the list its own type is kept in, and the screen moves
          // there — otherwise it would be filed somewhere the reader is not
          // looking and appear to have vanished.
          this.filesKind = saved.connection.kind;
          this.adhoc.kind = saved.connection.kind;
          this.filesMode = 'saved';
          this.filesConn = saved.connection.id;
        }
        // The same rule as file transfer above: what was just saved is filed in
        // its own list and the screen moves there, so it cannot appear to have
        // vanished. Moving the screen matters twice over here — leaving the
        // toggle on "enter it by hand" while an id was set would test the saved
        // account while the typed one was on screen.
        if (!this.mailAccountId && ['imap', 'pop3', 'smtp'].includes(saved.connection.kind)) {
          this.acctMode = 'saved';
          this.mailAccountId = saved.connection.id;
        }
      },
      async deleteConn(conn) {
        if (!conn || !conn.id) return;
        const r = await this.guarded('conn', () => api('connections/' + conn.id, { method: 'DELETE' }));
        if (!r) return;
        if (this.filesConn === conn.id) { this.filesConn = 0; this.filesData = null; }
        if (this.mailAccountId === conn.id) this.mailAccountId = 0;
        this.connModal = false;
        await this.loadConnections();
      },
      async testConn(conn) {
        if (!conn) return;
        const r = await this.guarded('conntest', () => api('connections/' + conn.id + '/test', { method: 'POST', body: '{}' }));
        if (!r) return;
        this.note(r.ok ? T('{name}: connected', { name: conn.name }) : T('{name}: {error}', { name: conn.name, error: r.error || 'failed' }));
        await this.loadConnections();
      },

      // ---- where connections are kept ----
      /** The settings of one kind, as the server last reported them. */
      connGroupOf(group) {
        const groups = (this.connSetup && this.connSetup.groups) || {};
        return groups[group] || {};
      },
      /** The field chosen for one part of a connection: the draft, else what is stored. */
      connMapValue(group, slot) {
        const draft = this.connMapDraft[group] || {};
        if (draft[slot] !== undefined) return draft[slot];
        const stored = this.connGroupOf(group).mapping || {};
        return stored[slot] || '';
      },
      setConnMap(group, slot, key) {
        this.connMapDraft = { ...this.connMapDraft, [group]: { ...(this.connMapDraft[group] || {}), [slot]: key } };
      },
      /** A password may only be offered a field RegiBase itself marks secret. */
      connFieldsFor(group, secretOnly) {
        // The fields of the collection chosen right now, not of the one that
        // happens to be stored: picking a different collection used to leave
        // the assignment offering the previous collection's fields.
        const chosen = Number(this.connGroupOf(group).collection) || 0;
        const all = (this.connSetup && this.connSetup.collections) || [];
        const found = all.find((c) => c.id === chosen);
        const fields = (found && found.fields) || [];
        return secretOnly ? fields.filter((f) => f.secret) : fields;
      },
      /** Point one kind at a different collection. */
      setConnCollection(group, value) {
        const g = this.connGroupOf(group);
        if (g) g.collection = Number(value) || 0;
        // Only this kind's draft is cleared; the others are untouched, because
        // every kind is on screen at once now.
        this.connMapDraft = { ...this.connMapDraft, [group]: {} };
      },
      async loadConnSetup() {
        const r = await this.guarded('connsetup', () => api('connections/setup'));
        if (r) this.connSetup = r.setup;
      },
      openConnSetup() {
        this.connSetupModal = true;
        this.connMapDraft = {};
        this.connNewName = {};
        this.connMaster = '';
        this.connGroup = 'ssh';
        this.loadConnSetup();
      },
      /** The key, given at the moment it is needed. */
      async unlockFromAsk() {
        const password = this.keyAskValue;
        const r = await this.guarded('connsetup', () => api('connections/unlock', { method: 'POST', body: JSON.stringify({ password }) }));
        this.keyAskValue = '';
        if (!r) return;
        if (!r.ok) { this.note(T('That master key was not right')); return; }
        this.keyAsk = false;
        this.connSetup = r.setup;
        await this.loadConnections();
        // The key was wanted for something. Do that thing, rather than leaving
        // the reader to work out that they must now press Save again.
        const again = this.keyAskRetry;
        this.keyAskRetry = null;
        if (again) await again();
      },
      async unlockConns() {
        const password = this.connMaster;
        const r = await this.guarded('connsetup', () => api('connections/unlock', { method: 'POST', body: JSON.stringify({ password }) }));
        this.connMaster = '';
        if (!r) return;
        if (!r.ok) { this.note(T('That master key was not right')); return; }
        this.connSetup = r.setup;
        await this.loadConnections();
        const again = this.keyAskRetry;
        this.keyAskRetry = null;
        if (again) await again();
      },
      async lockConns() {
        const r = await this.guarded('connsetup', () => api('connections/lock', { method: 'POST', body: '{}' }));
        if (!r) return;
        this.connSetup = r.setup;
        await this.loadConnections();
      },
      async makeConnCollection(group) {
        this.keyAskRetry = () => this.makeConnCollection(group);
        const name = (this.connNewName[group] || '').trim();
        const r = await this.guarded('connsetup', () => api('connections/collection', {
          method: 'POST', body: JSON.stringify({ group, name }),
        }));
        if (!r) return;
        this.connSetup = r.setup;
        this.keyAskRetry = null;
        this.connMapDraft = { ...this.connMapDraft, [group]: {} };
        this.connNewName = { ...this.connNewName, [group]: '' };
        this.note(T('Collection created'));
        await this.loadConnections();
      },
      async saveConnMapping(group) {
        this.keyAskRetry = () => this.saveConnMapping(group);
        const mapping = {};
        for (const slot of Object.keys((this.connSetup && this.connSetup.slots) || {})) {
          const chosen = this.connMapValue(group, slot);
          if (chosen) mapping[slot] = chosen;
        }
        const collection = Number(this.connGroupOf(group).collection) || 0;
        const r = await this.guarded('connsetup', () => api('connections/mapping', {
          method: 'POST', body: JSON.stringify({ group, collection, mapping }),
        }));
        if (!r) return;
        this.keyAskRetry = null;
        this.connSetup = r.setup;
        this.connMapDraft = { ...this.connMapDraft, [group]: {} };
        this.note(T('Saved'));
        await this.loadConnections();
      },

      // ---- mail ----
      async runMailAudit() {
        const selectors = this.mailSelectors.split(',').map((x) => x.trim()).filter(Boolean);
        this.mailAudit = await this.guarded('mailAudit', () => api('mail/audit?' + qs({ domain: this.mailDomain, selectors, blocklists: this.mailBlocklists ? 1 : 0 })));
      },
      applyMailPreset(p) { this.mailProtocol = p.protocol; this.mailPort = p.port; this.mailMode = p.mode; if (this.mailHost) this.runMailProbe(); },
      async runMailProbe() {
        this.mailProbeResult = await this.guarded('mailProbe', () => api('mail/probe?' + qs({ host: this.mailHost, port: this.mailPort || 0, protocol: this.mailProtocol, mode: this.mailMode })));
        if (this.mailProbeResult && !this.relayHost) this.relayHost = this.mailHost;
      },
      async runRelay() {
        this.relayResult = await this.guarded('relay', () => api('mail/relay', { method: 'POST', body: JSON.stringify({ host: this.relayHost, port: this.relayPort, mode: 'starttls' }) }));
      },
      async runBlocklist() {
        this.blResult = await this.guarded('bl', () => api('mail/blocklist?' + qs({ ip: this.blIp })));
      },
      /**
       * What to test against: one account, whichever way it was named.
       *
       * The id comes from the toggle rather than from whatever was chosen
       * before it, so an account picked earlier cannot quietly take over a
       * test whose details are plainly being typed.
       */
      mailTarget(extra) {
        const id = this.acctMode === 'saved' ? this.mailAccountId : 0;
        return { id, connection: id ? {} : { ...this.mailAdhoc }, ...extra };
      },
      async runSend() {
        const body = this.mailTarget({ to: this.sendTo, subject: this.sendSubject, body: this.sendBody });
        this.sendResult = await this.guarded('send', () => api('mail/send', { method: 'POST', body: JSON.stringify(body) }));
        if (this.sendResult) this.note(this.sendResult.ok ? T('The server accepted the message') : T('Sending failed: {error}', { error: this.sendResult.error }));
      },
      async runMailbox() {
        const body = this.mailTarget({});
        this.mailboxResult = await this.guarded('mailbox', () => api('mail/login', { method: 'POST', body: JSON.stringify(body) }));
      },
      /**
       * Typing or the list — the same rule the SSH and file transfer screens
       * follow. Leaving the list also drops what was chosen there, so nothing
       * is tested against a server the screen is no longer showing.
       */
      setAcctMode(mode) {
        if (this.acctMode === mode) return;
        this.acctMode = mode;
        this.mailAccountId = 0;
        this.sendResult = null;
        this.mailboxResult = null;
      },
      /** The default ports follow the protocol, both halves at once. */
      mailKindChanged() {
        this.mailAdhoc.port = this.mailAdhoc.kind === 'pop3' ? 995 : 993;
        if (this.mailAdhoc.kind === 'smtp') {
          this.mailAdhoc.port = 587;
        }
      },
      /** Hand the typed account to the editor so it can be kept as one record. */
      saveMailAdhoc() {
        this.openConn(null, this.mailAdhoc.kind);
        this.connForm = { ...this.connForm, ...this.mailAdhoc, id: 0, name: this.mailAdhoc.host };
      },

      // ---- FTP / SFTP ----
      // Every call carries either the id of a saved connection or the details
      // of the one-off one, so both work through the same endpoints.
      /**
       * Hand the far end what it needs for one file action.
       *
       * The sudo password rides along only when the reader asked to act as
       * root, and only on this request; nothing here keeps a copy.
       */
      fileTarget(extra) {
        this.touchRoot();
        const out = { id: this.filesConn, connection: this.filesConn ? {} : { ...this.adhoc }, ...extra };
        if (this.asRoot && this.sudoPassword) out.sudoPassword = this.sudoPassword;
        // Which protocol the screen is set to. A connection saved as SSH can be
        // opened over SFTP or over SCP, and only SCP can act as root — without
        // this the server chose SFTP and "act as root" did nothing at all.
        out.prefer = this.filesKind;
        return out;
      },
      /** Open what was double-clicked: a folder walks into it. */
      openEntry(entry) {
        if (entry && entry.directory) this.browse(this.joinPath(this.filesData.path, entry.name));
      },
      sortFiles(by) {
        if (this.fileSort.by === by) { this.fileSort = { by, desc: !this.fileSort.desc }; return; }
        this.fileSort = { by, desc: false };
      },
      fileSortClass(by) {
        return this.fileSort.by === by ? (this.fileSort.desc ? 'sorted desc' : 'sorted asc') : '';
      },
      /** The menu for one row, placed where the pointer is. */
      openFileMenu(entry, event) {
        this.filePicked = entry.name;
        const width = 230, height = 260;
        this.fileMenu = {
          open: true, entry,
          x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
        };
      },
      async runFileMenu(what) {
        const e = this.fileMenu.entry;
        this.fileMenu = { open: false, x: 0, y: 0, entry: {} };
        if (!e || !e.name) return;
        const full = this.joinPath(this.filesData.path, e.name);
        if (what === 'open') return this.browse(full);
        if (what === 'view') return this.openText(e);
        if (what === 'download') return this.downloadFile(e);
        if (what === 'rename') return this.fileAction('rename', e);
        if (what === 'delete') return this.fileAction(e.directory ? 'rmdir' : 'delete', e);
        if (what === 'chmod') return this.fileAction('chmod', e);
        if (what === 'chown' || what === 'chgrp' || what === 'touch') return this.fileAction(what, e);
        if (what === 'copyPath') {
          try { await navigator.clipboard.writeText(full); this.note(T('Copied')); }
          catch (err) { this.note(full); }
        }
      },
      /** Take the password for this page, then show the folder again as root. */
      useSudo() {
        this.sudoPassword = this.sudoDraft;
        this.sudoDraft = '';
        this.startRootWatch();
        this.browse(this.filesPath || '');
      },
      async saveRootIdle() {
        const n = Math.max(0, Math.min(120, Number(this.settings.rootIdleMinutes) || 0));
        this.settings = { ...this.settings, rootIdleMinutes: n };
        this.startRootWatch();
        try {
          await api('settings', { method: 'POST', body: JSON.stringify({ settings: { rootIdleMinutes: n } }) });
        } catch (e) { this.fail(e); }
      },
      /**
       * Let root lapse when nobody is there.
       *
       * The password is never on disk, but it stays usable for as long as the
       * page is open — and a page left open on an unlocked screen is somebody
       * else's root. The clock is reset by working in NetBase, not by the
       * browser merely being in front: a tab left on this screen while its
       * owner is elsewhere is exactly the case this is for.
       */
      startRootWatch() {
        this.stopRootWatch();
        const mins = Number(this.settings.rootIdleMinutes) || 0;
        if (!this.sudoPassword || mins <= 0) { this.rootLeft = 0; return; }
        this.rootTouched = Date.now();
        this.rootLeft = mins;
        this.rootTimer = setInterval(() => {
          const left = mins - (Date.now() - this.rootTouched) / 60000;
          this.rootLeft = Math.max(0, Math.ceil(left));
          if (left <= 0) {
            this.stopRootWatch();
            this.sudoPassword = '';
            this.asRoot = false;
            this.note(T('Root was given up after {n} minutes with nothing touched. Enter the password again to act as root.', { n: mins }));
            this.browse(this.filesPath || '');
          }
        }, 5000);
      },
      stopRootWatch() {
        if (this.rootTimer) { clearInterval(this.rootTimer); this.rootTimer = null; }
        this.rootLeft = 0;
      },
      /** Anything done in NetBase counts as being there. */
      touchRoot() {
        if (this.sudoPassword) this.rootTouched = Date.now();
      },
      /** Give it up now rather than when the page closes. */
      forgetSudo() {
        this.stopRootWatch();
        this.sudoPassword = '';
        this.asRoot = false;
        this.browse(this.filesPath || '');
      },
      /** Turning it off drops the password with it. */
      rootToggled() {
        if (!this.asRoot) { this.stopRootWatch(); this.sudoPassword = ''; this.sudoDraft = ''; this.browse(this.filesPath || ''); }
      },
      /**
       * A new protocol, without throwing away what was typed.
       *
       * Filling in the usual port and sign-in for the protocol is a kindness to
       * somebody who has not touched those fields — FTP answers on 21 with its
       * own encryption, SSH and its two file protocols on 22. It is the
       * opposite for somebody who has: a server reached over SCP on 10022 with
       * a key is the same machine over SFTP, and putting the port back to 22
       * and the sign-in back to a password sent them to the start again for no
       * reason. So a field is moved only while it still holds the default that
       * was put there for the protocol being left; anything typed in is left
       * where it is.
       *
       * Two things are not preferences and have to follow the protocol. FTP's
       * encryption choices and SSH's are different things under one name, so
       * crossing that line resets it. And FTP has no notion of a key at all —
       * the connection is made from the host and the port alone — so moving to
       * it returns the sign-in to a password rather than sending a key path to
       * a protocol with nowhere to put it.
       *
       * Called with nothing (the screen setting itself up) it fills all three
       * in, which is what it always did.
       */
      adhocKindChanged(previous = '') {
        const ftp = this.adhoc.kind === 'ftp';
        const wasFtp = previous === 'ftp';
        const fresh = previous === '';
        if (fresh || Number(this.adhoc.port) === (wasFtp ? 21 : 22)) {
          this.adhoc.port = ftp ? 21 : 22;
        }
        if (fresh || wasFtp !== ftp) {
          this.adhoc.mode = ftp ? 'none' : 'ssh';
        }
        if (fresh || ftp) {
          this.adhoc.authType = 'password';
        }
      },
      /**
       * Switch between typing the server in and choosing a saved one.
       *
       * Whichever is left behind stops being the target, so the open folder
       * goes with it; what was typed is kept, so coming back costs nothing.
       */
      setFilesMode(mode) {
        if (this.filesMode === mode) return;
        this.filesMode = mode;
        this.filesPick = '';
        this.adhocActive = false;
        this.filesConn = 0;
        this.filesData = null;
        this.transferNote = '';
      },
      /**
       * One list, three kinds of entry.
       *
       * A saved connection is the target outright. A device or a recent
       * address only names the machine — there are no credentials behind it —
       * so it fills the typed form and the screen moves there, which is where
       * the rest of the details have to be given anyway.
       */
      /**
       * The type decides the protocol and the list at once.
       *
       * Changing it lets go of whatever was chosen: a connection saved for FTP
       * is not a thing SCP can open, so carrying the choice across would offer
       * a server that cannot answer.
       */
      filesKindPicked() {
        // Which protocol is being left, so the defaults it put in can be told
        // apart from anything typed over them.
        const previous = this.adhoc.kind;
        this.adhoc.kind = this.filesKind;
        this.filesPick = '';
        this.filesConn = 0;
        this.adhocActive = false;
        this.filesData = null;
        this.adhocKindChanged(previous);
      },
      filesPicked() {
        const value = String(this.filesPick || '');
        if (value.startsWith('c')) {
          // Chosen, not opened. The SSH screen does not sign in the moment a
          // name is picked either, and a listing is a connection: it should
          // wait for the button that says so.
          this.filesConn = Number(value.slice(1)) || 0;
          this.adhocActive = false;
          this.filesData = null;
          return;
        }
        if (value) {
          this.filesMode = 'type';
          this.filesPick = '';
          this.filesConn = 0;
          this.adhoc.host = value;
          this.rememberHost(value);
        }
      },
      /** Connect to whichever of the two the reader chose. */
      /**
       * Open whichever of the two was chosen.
       *
       * The one entry point for connecting, so the screen cannot end up
       * showing a folder for a server nobody asked it to open.
       */
      /**
       * Open both sides at once.
       *
       * The left pane is the reader's own files and needs no connection, but
       * it was starting empty and staying that way until somebody thought to
       * press Refresh — which made the two-pane layout look broken on arrival.
       * It opens at the folder downloads land in, so what has just been
       * received is on screen where it went.
       */
      filesConnect() {
        this.browseLocal(this.filesTarget || '', true);
        if (this.filesSaved) {
          this.adhocActive = false;
          return this.browse(this.adhoc.path || '');
        }
        return this.quickConnect();
      },
      async quickConnect() {
        this.filesConn = 0;
        this.adhocActive = true;
        await this.browse(this.adhoc.path || '');
        if (!this.filesData) this.adhocActive = false;
      },
      disconnect() { this.adhocActive = false; this.filesConn = 0; this.filesPick = ''; this.filesData = null; this.transferNote = ''; },
      /** Hand the one-off details to the editor so they can be named and kept. */
      saveAdhoc() {
        this.openConn(null, this.adhoc.kind);
        this.connForm = { ...this.connForm, ...this.adhoc, id: 0, name: this.adhoc.host, privateKey: '' };
      },

      // ---------------------------------------------------------------- panes
      /**
       * One ordering, used by both panes.
       *
       * They are the same kind of list and have to feel the same: folders
       * above files whichever column is sorted, and names compared the way a
       * person reads them rather than by character code.
       */
      sortRows(rows, how) {
        const dir = how.desc ? -1 : 1;
        rows.sort((a, b) => {
          if (!!a.directory !== !!b.directory) return a.directory ? -1 : 1;
          let v = 0;
          if (how.by === 'size') v = (a.size || 0) - (b.size || 0);
          else if (how.by === 'modified') v = (a.modified || 0) - (b.modified || 0);
          else v = String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
          return v * dir;
        });
        return rows;
      },
      sortLocal(by) {
        if (this.localSort.by === by) { this.localSort = { by, desc: !this.localSort.desc }; return; }
        this.localSort = { by, desc: false };
      },
      localSortClass(by) {
        return this.localSort.by === by ? (this.localSort.desc ? 'sorted desc' : 'sorted asc') : '';
      },
      /**
       * The reader's own files, one folder of them.
       *
       * $create is set only when the screen opens at the folder downloads land
       * in. That folder is made by the first download in any case, so refusing
       * to show it beforehand put a red banner on every connection until
       * something had been received. Walking the tree never creates anything.
       */
      async browseLocal(path, create = false) {
        const r = await this.guarded('local', () => api('nc-files?' + qs({ path: path || '', create: create ? 1 : 0 })));
        if (!r) return;
        this.localData = r;
        this.localPath = r.path;
        this.localPicked = {};
        this.localAnchor = '';
      },
      /**
       * Clicking a row, the way a file manager means it.
       *
       * Plain click picks one. Ctrl adds or removes. Shift takes everything
       * between here and the last row touched — which is how a run of files is
       * chosen without clicking every one of them.
       */
      pickRow(side, entry, event) {
        const picked = side === 'local' ? this.localPicked : this.remotePicked;
        const rows = side === 'local' ? this.sortedLocal : this.sortedFiles;
        const anchor = side === 'local' ? this.localAnchor : this.remoteAnchor;
        const next = {};
        if (event && event.shiftKey && anchor) {
          const names = rows.map((r) => r.name);
          const from = names.indexOf(anchor);
          const to = names.indexOf(entry.name);
          if (from >= 0 && to >= 0) {
            const [a, b] = from < to ? [from, to] : [to, from];
            for (let i = a; i <= b; i++) next[names[i]] = true;
          } else {
            next[entry.name] = true;
          }
        } else if (event && (event.ctrlKey || event.metaKey)) {
          Object.assign(next, picked);
          if (next[entry.name]) delete next[entry.name]; else next[entry.name] = true;
        } else {
          next[entry.name] = true;
        }
        if (side === 'local') {
          this.localPicked = next;
          if (!event || !event.shiftKey) this.localAnchor = entry.name;
        } else {
          this.remotePicked = next;
          this.filePicked = entry.name;
          if (!event || !event.shiftKey) this.remoteAnchor = entry.name;
        }
      },
      /** Everything, or nothing, on one side. */
      pickAll(side) {
        const rows = side === 'local' ? this.sortedLocal : this.sortedFiles;
        const picked = side === 'local' ? this.localPicked : this.remotePicked;
        const all = {};
        if (Object.keys(picked).length !== rows.length) {
          rows.forEach((r) => { all[r.name] = true; });
        }
        if (side === 'local') this.localPicked = all; else this.remotePicked = all;
      },
      pickedRows(side) {
        const rows = side === 'local' ? this.sortedLocal : this.sortedFiles;
        const picked = side === 'local' ? this.localPicked : this.remotePicked;
        return rows.filter((r) => picked[r.name]);
      },

      /**
       * Dragging a row, and dropping it on the other side.
       *
       * The row being dragged joins whatever is already picked on that side —
       * dragging one of five chosen files sends all five, which is what every
       * file manager does and what anyone dragging expects. Dropping on the
       * side a thing came from does nothing, quietly: a file cannot be sent to
       * where it already is, and saying so would be noise.
       */
      startFileDrag(side, entry, event) {
        const picked = side === 'local' ? this.localPicked : this.remotePicked;
        if (!picked[entry.name]) {
          this.pickRow(side, entry, null);
        }
        if (event && event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'copy';
          // The payload is only for other applications; inside this page the
          // side is what matters, and that is remembered here.
          event.dataTransfer.setData('text/plain', entry.name);
        }
        this.dragFrom = side;
      },
      dropOnLocal() {
        if (this.dragFrom !== 'remote') { this.dragFrom = ''; return; }
        this.dragFrom = '';
        this.enqueue('remote');
      },
      dropOnRemote() {
        if (this.dragFrom !== 'local') { this.dragFrom = ''; return; }
        this.dragFrom = '';
        this.enqueue('local');
      },

      // ------------------------------------------------------------ the queue
      /**
       * Put the chosen rows in the queue, and start it if it is not running.
       *
       * A folder going up is one job that walks; a folder coming down is one
       * job that arrives as a ZIP, which is what the far end can actually be
       * asked for. Files are one job each, so one failure does not take the
       * rest of them with it.
       */
      enqueue(side) {
        if (!this.filesData) return;
        const rows = this.pickedRows(side);
        if (!rows.length) return;
        for (const row of rows) {
          this.queue.push({
            id: ++this.windowSeq,
            direction: side === 'local' ? 'up' : 'down',
            folder: !!row.directory,
            name: row.name,
            local: side === 'local' ? row.path : this.filesTarget,
            remote: side === 'local' ? (this.filesData.path || '/') : this.joinPath(this.filesData.path, row.name),
            state: 'waiting', done: 0, total: row.size || 0, rate: 0, left: null, error: '',
          });
        }
        if (side === 'local') this.localPicked = {}; else this.remotePicked = {};
        this.runQueue();
      },
      /** One job after another, until there are none left. */
      async runQueue() {
        if (this.queueBusy) return;
        this.queueBusy = true;
        try {
          for (;;) {
            const job = this.queue.find((j) => j.state === 'waiting');
            if (!job) break;
            job.state = 'running';
            try {
              await this.runJob(job);
              job.state = 'done';
            } catch (e) {
              // Pressing Stop is not a failure, and the browser's own wording
              // for an aborted stream ("BodyStreamBuffer was aborted") is not
              // something to show anybody. A transfer the reader stopped says
              // so, plainly, and without a warning sign.
              const aborted = (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || ''))));
              job.state = aborted ? 'stopped' : 'failed';
              job.error = aborted ? '' : String((e && e.message) || e);
            }
            this.queueDone.unshift(job);
            this.queue = this.queue.filter((j) => j !== job);
            if (this.queueDone.length > 40) this.queueDone.length = 40;
          }
        } finally {
          this.queueBusy = false;
          this.queueStop = null;
          if (this.filesData) this.browse(this.filesData.path);
          if (this.localData) this.browseLocal(this.localData.path);
        }
      },
      /**
       * One transfer, drawn while it runs.
       *
       * The server reports in NDJSON — one JSON object to a line — for the same
       * reason the speed test does: it is the simplest thing that survives a
       * proxy, and a half-written last line is simply not parsed.
       */
      async runJob(job) {
        // A folder coming down is the ZIP path, which is not a stream.
        if (job.direction === 'down' && job.folder) {
          const r = await api('files/download', {
            method: 'POST',
            body: JSON.stringify(this.fileTarget({ path: job.remote, target: this.filesTarget, folder: true })),
          });
          job.done = r.bytes || 0;
          job.total = r.bytes || 0;
          return;
        }
        const controller = new AbortController();
        this.queueStop = () => controller.abort();
        const body = this.fileTarget({
          direction: job.direction,
          remote: job.remote,
          local: job.local,
          target: this.filesTarget,
          folder: job.folder,
        });
        const res = await fetch(BASE + 'api/files/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', requesttoken: TOKEN },
          credentials: 'same-origin',
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(T('The transfer could not be started'));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let rest = '';
        let failure = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          rest += decoder.decode(value, { stream: true });
          const lines = rest.split('\n');
          rest = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let said = null;
            try { said = JSON.parse(line); } catch (err) { continue; }
            if (said.stage === 'error') { failure = said.message || T('Failed'); continue; }
            if (said.stage === 'start') { job.total = said.total || 0; job.name = said.name || job.name; }
            if (said.stage === 'progress') {
              job.done = said.done || 0;
              if (said.total) job.total = said.total;
              job.rate = said.bytesPerSecond || 0;
              job.left = said.secondsLeft;
            }
            if (said.stage === 'done') { job.done = said.bytes || job.done; job.total = job.total || job.done; }
          }
        }
        if (failure) throw new Error(failure);
      },
      stopQueue() {
        if (this.queueStop) this.queueStop();
        this.queue = this.queue.filter((j) => j.state === 'running');
      },
      clearQueueDone() { this.queueDone = []; },
      /** How far along, as a percentage, for the bar. */
      jobPercent(job) {
        if (!job.total) return job.state === 'done' ? 100 : 0;
        return Math.max(0, Math.min(100, Math.round((job.done / job.total) * 100)));
      },
      /** "3.4 MB/s · 8 s left", or as much of it as is known. */
      jobRate(job) {
        const parts = [];
        if (job.rate) parts.push(this.fmtBytes(job.rate) + '/s');
        if (job.left !== null && job.left !== undefined) parts.push(T('{n} s left', { n: job.left }));
        return parts.join(' · ');
      },

      // ------------------------------------------------------- text in a window
      /**
       * Open a file for reading, and for editing if that is what is wanted.
       *
       * It arrives as text in whatever encoding it was written in — Shift_JIS
       * and EUC-JP are still everywhere on Japanese servers — and is handed
       * back the same way, so saving does not quietly rewrite the file into
       * something the far end can no longer read.
       */
      async openText(entry) {
        const path = this.joinPath(this.filesData.path, entry.name);
        const r = await this.guarded('text', () => api('files/text?' + qs(this.textQuery(path))));
        if (!r) return;
        const offset = (this.textWins.length % 6) * 26;
        this.textWins.push({
          id: ++this.windowSeq, path: r.path, name: r.name, text: r.text, original: r.text,
          encoding: r.encoding, newline: r.newline, bytes: r.bytes, saving: false, note: '',
          z: ++this.windowTop,
          x: this.narrow ? 0 : Math.max(20, Math.round(window.innerWidth / 2 - 420) + offset),
          y: this.narrow ? 0 : 80 + offset,
          w: this.narrow ? window.innerWidth : Math.min(840, window.innerWidth - 60),
          h: this.narrow ? window.innerHeight : Math.min(620, window.innerHeight - 140),
        });
      },
      /** The connection details a text request needs, without the file target. */
      textQuery(path) {
        const out = { path, id: this.filesConn, prefer: this.filesKind };
        if (!this.filesConn) {
          Object.entries(this.adhoc).forEach(([k, v]) => {
            out['connection[' + k + ']'] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
          });
        }
        if (this.asRoot && this.sudoPassword) out.sudoPassword = this.sudoPassword;
        return out;
      },
      textChanged(w) { return w.text !== w.original; },
      async saveText(w) {
        w.saving = true;
        w.note = '';
        try {
          const body = this.fileTarget({ path: w.path, text: w.text, encoding: w.encoding, newline: w.newline });
          delete body.folder;
          const r = await api('files/text', { method: 'POST', body: JSON.stringify(body) });
          w.original = w.text;
          w.bytes = r.bytes;
          w.note = T('Saved · {size}', { size: this.fmtBytes(r.bytes) });
          if (this.filesData) this.browse(this.filesData.path);
        } catch (e) {
          w.note = String((e && e.message) || e);
        } finally {
          w.saving = false;
        }
      },
      async reloadText(w) {
        const r = await this.guarded('text', () => api('files/text?' + qs(this.textQuery(w.path))));
        if (!r) return;
        w.text = r.text;
        w.original = r.text;
        w.encoding = r.encoding;
        w.newline = r.newline;
        w.bytes = r.bytes;
        w.note = '';
      },
      closeText(w) { this.textWins = this.textWins.filter((x) => x !== w); },
      /**
       * What to ask the far end for one folder, whichever way it was reached.
       *
       * Kept apart from browse() because the delete question needs the same
       * listing to count what is inside, and must not disturb the view while
       * it asks.
       */
      listQuery(path) {
        const sudo = this.asRoot && this.sudoPassword ? { sudoPassword: this.sudoPassword } : {};
        const prefer = { prefer: this.filesKind };
        return this.filesConn
          ? qs({ id: this.filesConn, path: path || '', ...sudo, ...prefer })
          // Booleans have to travel as 1/0: PHP reads the string "false" as true.
          : qs({ id: 0, path: path || '', ...sudo, ...prefer, ...Object.fromEntries(Object.entries(this.adhoc).map(([k, v]) => ['connection[' + k + ']', typeof v === 'boolean' ? (v ? 1 : 0) : v])) });
      },
      async browse(path) {
        if (!this.filesConn && !this.adhocActive) { this.filesData = null; return; }
        this.touchRoot();
        const query = this.listQuery(path);
        const r = await this.guarded('browse', () => api('files/list?' + query));
        if (!r) return;
        this.filesData = r;
        this.filesPath = r.path;
      },
      /**
       * Bring one row back into the reader's own Nextcloud files.
       *
       * A folder comes back as a single ZIP, built on this server: see the note
       * on downloadFolder. The far end is not asked to have zip or tar.
       */
      async downloadFile(entry) {
        if (entry && entry.directory) return this.downloadFolder(entry);
        const r = await this.guarded('dl', () => api('files/download', { method: 'POST', body: JSON.stringify(this.fileTarget({ path: this.joinPath(this.filesData.path, entry.name), target: this.filesTarget })) }));
        if (r) this.transferNote = T('{name} saved to {folder} ({size})', { name: r.name, folder: this.filesTarget || '/', size: this.fmtBytes(r.bytes) });
      },
      async downloadFolder(entry) {
        const path = this.joinPath(this.filesData.path, entry.name);
        const r = await this.guarded('dl', () => api('files/download', {
          method: 'POST',
          body: JSON.stringify(this.fileTarget({ path, target: this.filesTarget, folder: true })),
        }));
        if (!r) return;
        this.transferNote = T('{name} saved to {folder} ({size}, {n} files)', {
          name: r.name, folder: this.filesTarget || '/', size: this.fmtBytes(r.bytes), n: r.files,
        });
        if (r.truncated) {
          this.note(T('The folder was larger than one download allows, so only part of it was taken.'));
        }
      },
      /**
       * Ask for one line of text, or for a plain yes, and wait for the answer.
       * The browser's own prompt() and confirm() are not used anywhere: they
       * stop the page dead in an embedded window, and no test can answer them.
       * Hands back what was typed, true for a bare yes, or null if cancelled.
       */
      askFor(options) {
        this.ask = {
          open: true, icon: '', title: '', subject: '', body: '', label: '',
          value: '', confirm: T('Save'), danger: false, input: true, ...options,
        };
        this.$nextTick(() => {
          const box = this.$refs.askBox;
          if (box) { box.focus(); box.select(); }
        });
        return new Promise((settle) => { this.askSettle = settle; });
      },
      /** Close the box and hand the answer to whoever is waiting for it. */
      askClose(answer) {
        const settle = this.askSettle;
        this.askSettle = null;
        this.ask.open = false;
        if (settle) settle(answer);
      },
      askOk() {
        if (!this.ask.input) { this.askClose(true); return; }
        const value = String(this.ask.value || '').trim();
        if (value) this.askClose(value);
      },
      async fileAction(action, entry) {
        let path = entry ? this.joinPath(this.filesData.path, entry.name) : '';
        let extra = '';
        if (action === 'mkdir') {
          const name = await this.askFor({
            icon: '📁', title: T('New folder'),
            label: T('Name for the new folder'), confirm: T('Create'),
          });
          if (!name) return;
          path = this.joinPath(this.filesData.path, name);
        } else if (action === 'rename') {
          const name = await this.askFor({
            icon: entry.directory ? '📁' : '📄', title: T('Rename'), subject: entry.name,
            label: T('New name'), value: entry.name,
          });
          if (!name || name === entry.name) return;
          extra = this.joinPath(this.filesData.path, name);
        } else if (action === 'chmod') {
          // The far end reads this as octal, so it is asked for as octal, and
          // the box starts at what the file has now rather than at a guess.
          const now = String(entry.permissions || '').replace(/^0+/, '') || '644';
          const mode = await this.askFor({
            icon: '🔒', title: T('Change permissions'), subject: entry.name,
            label: T('New permissions, in the usual numbers (for example 0755)'), value: now,
          });
          if (!mode) return;
          if (!/^[0-7]{3,4}$/.test(mode.trim())) { this.note(T('That is not a permission number.')); return; }
          extra = mode.trim();
        } else if (action === 'chown' || action === 'chgrp') {
          // A name, not a number: chown takes either, and a name is what the
          // person doing this actually knows. The far end refuses anything it
          // does not recognise, which is the right place for that judgement.
          const owner = action === 'chown';
          const who = await this.askFor({
            icon: '👤', title: owner ? T('Change owner') : T('Change group'), subject: entry.name,
            label: owner ? T('New owner') : T('New group'),
            value: owner ? (entry.owner || '') : '',
          });
          if (!who) return;
          extra = who.trim();
        } else if (action === 'touch') {
          // Nothing to ask: setting the time to now is the whole of it.
          extra = '';
        } else {
          // A folder takes everything under it. The question says so, and says
          // how much, so that pressing Delete on a name is never a surprise.
          // The count is read first: if the folder cannot be read, nothing is
          // deleted rather than deleted blind.
          let inside = 0;
          if (action === 'rmdir') {
            const held = await this.guarded('fileact', () => api('files/list?' + this.listQuery(path)));
            if (!held) return;
            inside = (held.entries || []).length;
          }
          const says = [T('Delete {name} from the server?', { name: entry.name })];
          if (inside > 0) says.push(T('Everything inside it goes too: {n} items.', { n: inside }));
          says.push(T('This cannot be undone.'));
          if (!await this.askFor({
            icon: '🗑️', title: T('Delete'), subject: entry.name, input: false, danger: true,
            body: says.join(' '), confirm: T('Delete'),
          })) {
            return;
          }
        }
        const r = await this.guarded('fileact', () => api('files/manage', { method: 'POST', body: JSON.stringify(this.fileTarget({ action, path, extra })) }));
        if (r) this.browse(this.filesData.path);
      },

      // ---- SSH / Telnet / NTP ----
      async runSsh() {
        this.rememberHost(this.sshHostNow);
        this.sshResult = await this.guarded('ssh', () => api('probe/ssh?' + qs({ host: this.sshHostNow, port: this.sshPortNow || 22, authMethods: this.sshAuthMethods ? 1 : 0 }))); },
      // Telnet answers on 23 unless the reader has named a Telnet port here.
      async runTelnet() { this.telnetResult = await this.guarded('telnet', () => api('probe/telnet?' + qs({ host: this.sshHostNow, port: this.sshAdhoc.kind === 'telnet' ? (this.sshPortNow || 23) : 23 }))); },
      async runNtp() { this.ntpResult = await this.guarded('ntp', () => api('probe/ntp?' + qs({ host: this.ntpHost }))); },

      dnsFlags(answer) {
        const flags = [];
        if (answer.authoritative) flags.push('AA');
        if (answer.truncated) flags.push('TC');
        if (answer.recursionAvailable) flags.push('RA');
        if (answer.authenticated) flags.push('AD');
        return flags.join(' ') || '—';
      },
      async runDnsQuery() { this.dnsQueryResult = await this.guarded('dnsq', () => api('dns/query?' + qs({ host: this.dnsHost, type: this.dnsType, server: this.dnsServer, dnssec: this.dnsDnssec ? 1 : 0 }))); },
      async runDnsCompare() { this.dnsCompareResult = await this.guarded('dnsc', () => api('dns/compare?' + qs({ host: this.dnsHost, type: this.dnsType }))); },
      async runDnsTrace() { this.dnsTraceResult = await this.guarded('dnst', () => api('dns/trace?' + qs({ host: this.dnsHost, type: this.dnsType }))); },
      async runAxfr() { this.axfrResult = await this.guarded('axfr', () => api('dns/axfr?' + qs({ zone: this.axfrZone, nameserver: this.axfrServer }))); },
      async runTlsVersions() { this.tlsVersionsResult = await this.guarded('tlsver', () => api('tools/tls-versions?' + qs({ host: this.tlsHost, port: this.tlsPort }))); },
      // NETBASE-STORE-REMOVED: runTcpPing and runMtu
//       async runTcpPing() { this.tcpPingResult = await this.guarded('tcpping', () => api('tools/tcp-ping?' + qs({ host: this.pingHost, port: this.tcpPingPort || 443 }))); },
//       async runMtu() { this.mtuResult = await this.guarded('mtu', () => api('tools/mtu?' + qs({ host: this.pingHost }))); },
      async runSplit() {
        const cidr = this.addressOf(this.splitAddress) || this.splitCidr || this.subnetInput;
        if (!cidr) { this.note(T('Fill in an address first.')); return; }
        this.splitResult = await this.guarded('split', () => api('tools/subnet-split?' + qs({ cidr, prefix: this.splitPrefix })));
      },
      async runAggregate() {
        // Either the rows, or whatever was typed instead of them.
        const input = this.aggregateFreeText
          ? this.aggregateInput
          : this.ipRows.map((row) => this.addressOf(row)).filter(Boolean).join(', ');
        if (!input) { this.note(T('Fill in at least one network first.')); return; }
        this.aggregateResult = await this.guarded('aggregate', () => api('tools/subnet-aggregate?' + qs({ input })));
      },
      // ---- choosing a file or folder from the user's own Nextcloud files ----
      pickFile(title, onPick, foldersOnly = false, start = '') {
        this.picker = { open: true, title, path: '', parent: null, entries: [], foldersOnly, onPick };
        this.pickerOpen(start);
      },
      async pickerOpen(path) {
        const r = await this.guarded('picker', () => api('nc-files?' + qs({ path: path || '', foldersOnly: this.picker.foldersOnly ? 1 : 0 })));
        if (!r) return;
        this.picker.path = r.path;
        this.picker.parent = r.parent;
        this.picker.entries = r.entries;
      },
      pickerChoose(path) {
        const pick = this.picker.onPick;
        this.picker.open = false;
        if (pick) pick(path);
      },

      /**
       * A console for the saved connection, in a window.
       *
       * It used to fill the screen as a modal, which meant closing it to look
       * at anything else. A window can be pushed aside, and several can stand
       * open at once — one per device, which is how this work actually goes.
       */
      /**
       * Run one line on a saved connection and show what came back.
       *
       * This and runSshPreset were bound to the buttons beside the command box
       * but never existed. Vue does nothing at all for a click bound to a method
       * it has not got — no error, no warning — so the button looked dead while
       * the console beside it worked perfectly.
       *
       * The two have separate endpoints: a typed line goes to ssh/run, a chosen
       * question to ssh/preset. They are not interchangeable — ssh/run takes no
       * preset, and sending one there would have been a second dead button.
       */
      /**
       * Whichever machine is named above, in the shape the server wants.
       *
       * A saved connection travels as its id and nothing else — its password
       * stays on the server. One typed in here travels as its details, which is
       * the same road the file transfer panel has always used.
       */
      sshWhere(extra) {
        return this.sshSaved
          ? { id: this.sshSaved.id, connection: {}, ...extra }
          : { id: 0, connection: { ...this.sshAdhoc }, ...extra };
      },
      async runSshCommand() {
        if (!this.sshCanRun || !this.sshCommand) return;
        this.sshRunResult = await this.guarded('sshrun', () => api('ssh/run', {
          method: 'POST',
          body: JSON.stringify(this.sshWhere({ command: this.sshCommand })),
        }));
      },
      /** The same, for one of the ready-made questions in the list above. */
      async runSshPreset() {
        if (!this.sshCanRun || !this.sshPreset) return;
        this.sshRunResult = await this.guarded('sshrun', () => api('ssh/preset', {
          method: 'POST',
          body: JSON.stringify(this.sshWhere({ preset: this.sshPreset })),
        }));
      },
      /**
       * A console on the machine named above.
       *
       * Telnet asks who you are inside the window, so it needs nothing from
       * here; SSH signs in first, with what was saved or what was typed. The
       * three cards became one, so there is one way to open a console now.
       */
      openConsoleHere() {
        if (!this.sshHostNow) return;
        if (this.sshSaved) {
          const conn = this.sshSaved;
          const w = this.openTerminal('ssh', conn.host, conn.port || 22);
          w.user = conn.username || '';
          w.cwd = (conn.options && conn.options.path) || '';
          w.conn = conn.id;
          return;
        }
        const a = this.sshAdhoc;
        if (a.kind === 'telnet') {
          this.openTerminal('telnet', a.host, a.port || 23);
          return;
        }
        const w = this.openTerminal('ssh', a.host, a.port || 22, {
          username: a.username, authType: a.authType,
          secret: a.secret, privateKeyPath: a.privateKeyPath, passphrase: a.passphrase,
        });
        w.user = a.username || '';
      },
      saveSshAdhoc() {
        this.openConn(null, 'ssh');
        this.connForm = { ...this.connForm, ...this.sshAdhoc, id: 0, name: this.sshAdhoc.host, privateKey: '' };
      },

      async runDns() { this.dnsResult = await this.guarded('dns', () => api('tools/dns?' + qs({ host: this.dnsHost, types: this.dnsWanted }))); },
      async runWhois() { this.whoisResult = await this.guarded('whois', () => api('tools/whois?' + qs({ query: this.whoisQuery }))); },
      // Check one or more names for availability. A whois lookup per name says
      // whether the registry has a record; no record (with a clear "no match")
      // is a free domain. Done one at a time so a registry is not hammered.
      // Fetch the tier sizes once, so the radios can show how many endings each
      // covers.
      async loadAvailTiers() {
        if (Object.keys(this.availTiers).length) return;
        try { this.availTiers = await api('tools/avail-tiers'); } catch (e) { /* optional */ }
      },
      // Check the label across the chosen tier. The server does the whole tier
      // (DNS/RDAP/WHOIS with the registries' rate limits) and returns a mark per
      // ending: ○ free, × taken, △ likely free, ? undetermined.
      async runAvailability() {
        const base = this.availBase;
        if (!base) return;
        const tier = this.availTier;
        const cls = (m) => (m === '○' ? 'free' : (m === '×' ? 'taken' : (m === '△' ? 'maybe' : 'unknown')));
        this.busy.avail = true;
        this.availResults = [];
        this.availProgress = { done: 0, total: this.availTiers[tier] || 0 };
        const LIMIT = 24;
        let offset = 0;
        const ask = () => api('tools/avail-check?' + qs({ label: base, tier, offset, limit: LIMIT }));
        try {
          for (;;) {
            // One window at a time, so results appear and the bar moves instead
            // of the whole tier arriving at once after a long wait.
            let r;
            try {
              r = await ask();
            } catch (e) {
              // A transient hiccup (or a brief rate-limit on a long "all" sweep)
              // should not throw away the whole run: wait, try the same window
              // once more, and if it still fails, stop with what we have.
              await new Promise((res) => setTimeout(res, 1500));
              try { r = await ask(); }
              catch (e2) { this.note(T('Stopped early — {done} of {total} checked', { done: this.availProgress.done, total: this.availProgress.total })); break; }
            }
            if (r.total) this.availProgress.total = r.total;
            const rows = (r.results || []).map((x) => ({ domain: x.fqdn, tld: x.tld, mark: x.mark, cls: cls(x.mark), note: x.note || '', why: x.why || '', via: x.via || '', whois: null }));
            this.availResults = this.availResults.concat(rows);
            // Advance by the server's authoritative next index when it gives one,
            // so paging stays aligned even if a window returns fewer rows than its
            // raw size (deduped); fall back to the row count otherwise.
            offset = (typeof r.next === 'number' && r.next > offset) ? r.next : offset + rows.length;
            this.availProgress.done = this.availProgress.total ? Math.min(offset, this.availProgress.total) : offset;
            if (r.done || rows.length === 0) break;
          }
        } catch (e) { this.fail(e); } finally { this.busy.avail = false; }
      },
      /**
       * What the mark beside a domain actually means, in words.
       *
       * The check itself answers in the vocabulary of the protocol it used —
       * "HTTP 404", "WHOIS undecided" — which says nothing to somebody looking
       * for a domain to buy. This turns the answer into what it means for them,
       * and says where it came from, with the technical reason kept on a second
       * line for anyone who wants it.
       */
      availTitle(r) {
        if (!r) return '';
        const via = r.via || '';
        const by = via === 'DNS'
          ? T('the name servers published for it')
          : (via ? T('the registry at {host}', { host: via }) : '');
        const where = by ? T(' Checked against {by}.', { by }) : '';
        let head;
        switch (r.why) {
          case 'free-rdap':
          case 'free-whois':
            head = T('Free to register: the registry has no record of this name.') + where;
            break;
          case 'taken-rdap':
          case 'taken-whois':
            head = T('Already registered.') + where + ' ' + T('Use the Whois button to see who holds it.');
            break;
          case 'taken-dns':
            head = T('Already registered: the name has name servers, which only a registered domain has.');
            break;
          case 'maybe-free':
            head = T('Probably free: the registry could not be reached, but the name has no name servers — a registered domain almost always has them.');
            break;
          case 'limited':
            head = T('Not determined: the registry limited or refused the query. That says nothing about whether the name is free — try again in a few minutes.');
            break;
          case 'timeout':
          case 'unreachable':
            head = T('Not determined: the registry did not answer in time.') + where;
            break;
          case 'no-service':
            head = T('Not determined: this ending publishes no lookup service, so it cannot be checked from here. Ask a registrar that sells it.');
            break;
          case 'not-checked':
            head = T('Not checked: the search ran out of time before it reached this ending. Narrow the endings and run it again.');
            break;
          default:
            head = T('Not determined.') + where;
        }
        return r.note ? head + '\n(' + r.note + ')' : head;
      },
      // Show a taken domain's registration in the Whois panel below (fetched on
      // demand — the availability pass does not carry the full record).
      async showWhoisFor(row) {
        if (!row) return;
        this.whoisQuery = row.domain;
        if (!row.whois) { try { row.whois = await this.guarded('whois', () => api('tools/whois?' + qs({ query: row.domain }))); } catch (e) { return; } }
        this.whoisResult = row.whois;
      },
      // NETBASE-STORE-REMOVED: runPing, runTrace and runPorts
//       async runPing() {
//         this.rememberHost(this.pingHost); this.pingResult = await this.guarded('ping', () => api('tools/ping?' + qs({ host: this.pingHost }))); },
//       async runTrace() { this.traceResult = await this.guarded('trace', () => api('tools/traceroute?' + qs({ host: this.pingHost }))); },
//       async runPorts() {
//         this.rememberHost(this.portHost);
//         // The server understands "22,80,8000-8100"; sending the text as typed
//         // keeps ranges intact.
//         this.portResult = await this.guarded('ports', () => api('tools/ports?' + qs({ host: this.portHost, spec: this.portList })));
//       },
      async runTls() { this.tlsResult = await this.guarded('tls', () => api('tools/tls?' + qs({ host: this.tlsHost, port: this.tlsPort }))); },
      async runHttp() { this.httpResult = await this.guarded('http', () => api('tools/http?' + qs({ url: this.tlsHost }))); },
      async runSubnet() {
        const cidr = this.subnetFreeText ? this.subnetInput : this.addressOf(this.calcAddress);
        if (!cidr) { this.note(T('Fill in an address first.')); return; }
        this.rememberHost(cidr);
        this.subnetResult = await this.guarded('subnet', () => api('tools/subnet?' + qs({ cidr })));
      },
      // ---- an address, in the four numbers it is made of -------------------
      octetBox(group, col) {
        return document.querySelector('.ip-box[data-group="' + group + '"][data-col="' + col + '"]');
      },
      focusOctet(group, col, atEnd) {
        const box = this.octetBox(group, col);
        if (!box) return;
        box.focus();
        this.$nextTick(() => {
          if (atEnd) box.setSelectionRange(box.value.length, box.value.length);
          else box.select();
        });
      },
      typeOctet(row, index, event) {
        let value = String(event.target.value || '').replace(/[^0-9]/g, '').slice(0, 3);
        if (value !== '' && Number(value) > 255) value = '255';
        row.octets[index] = value;
        this.$nextTick(() => { event.target.value = value; });
        // Three digits can only be one number, so move along.
        const group = event.target.getAttribute('data-group');
        if (value.length === 3 && index < 3) this.focusOctet(group, index + 1, false);
      },
      octetKey(row, group, index, event, run) {
        if (event.key === '.' || event.key === ' ') {
          event.preventDefault();
          // Three digits already moved the caret on by themselves; the dot that
          // follows would otherwise skip a box and leave a hole.
          if (event.target.value !== '' && index < 3) this.focusOctet(group, index + 1, false);
          return;
        }
        if (event.key === 'Backspace' && event.target.value === '' && index > 0) {
          event.preventDefault();
          row.octets[index - 1] = '';
          this.focusOctet(group, index - 1, true);
          return;
        }
        if (event.key === 'ArrowLeft' && event.target.selectionStart === 0 && index > 0) {
          event.preventDefault();
          this.focusOctet(group, index - 1, true);
        }
        if (event.key === 'ArrowRight' && event.target.selectionStart === event.target.value.length && index < 3) {
          event.preventDefault();
          this.focusOctet(group, index + 1, false);
        }
        if (event.key === 'Enter' && typeof run === 'function') run();
      },
      /** A whole address pasted into any box fills the row. */
      pasteAddress(row, event) {
        const text = ((event.clipboardData || window.clipboardData).getData('text') || '').trim();
        const match = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\s*\/\s*(\d{1,2}))?/);
        if (!match) return;
        event.preventDefault();
        row.octets = [1, 2, 3, 4].map((n) => String(Math.min(255, Number(match[n]))));
        if (match[5] !== undefined) row.prefix = Math.min(32, Number(match[5]));
      },
      addressOf(row) {
        return row.octets.every((o) => o !== '') ? row.octets.join('.') + '/' + row.prefix : '';
      },
      addIpRow(index) {
        const rows = [...this.ipRows];
        rows.splice(index + 1, 0, { octets: ['', '', '', ''], prefix: 24 });
        this.ipRows = rows;
        this.$nextTick(() => this.focusOctet('agg' + (index + 1), 0, false));
      },
      removeIpRow(index) {
        if (this.ipRows.length < 2) return;
        const rows = [...this.ipRows];
        rows.splice(index, 1);
        this.ipRows = rows;
      },
      /** The chooser fills the boxes, not just a text field. */
      pickIntoAddress(target, event) {
        const value = event.target.value;
        event.target.value = '';
        if (!value) return;
        const match = value.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\s*\/\s*(\d{1,2}))?/);
        if (!match) { this.subnetFreeText = true; this.subnetInput = value; return; }
        this[target].octets = [1, 2, 3, 4].map((n) => String(Math.min(255, Number(match[n]))));
        if (match[5] !== undefined) this[target].prefix = Math.min(32, Number(match[5]));
        this.rememberHost(value);
      },

      /** Choosing from the list fills the field beside it and runs nothing. */
      pickInto(field, event) {
        const value = event.target.value;
        if (!value) return;
        this[field] = value;
        event.target.value = '';
        this.rememberHost(value);
      },
      rememberHost(value) {
        const host = String(value || '').trim();
        if (!host) return;
        const list = [host, ...this.recentHosts.filter((h) => h !== host)].slice(0, 12);
        this.recentHosts = list;
        // Per browser, not per account: it is a convenience, not a setting.
        try { localStorage.setItem('netbase-recent-hosts', JSON.stringify(list)); } catch (e) { /* private window */ }
      },

      // ---- the six boxes of a MAC address ---------------------------------
      async runMac() {
        if (!this.macReady) { this.macResult = null; return; }
        this.macResult = await this.guarded('mac', () => api('tools/mac?' + qs({ mac: this.macQuery })));
      },
      hasTool(id) {
        if (!this.requirements) return false;
        const c = this.requirements.components.find((x) => x.id === id);
        return !!(c && c.present);
      },
      installFor(id) {
        if (!this.requirements) return '';
        const c = this.requirements.components.find((x) => x.id === id);
        if (!c) return '';
        const lines = [];
        if (c.install) lines.push(c.install + '   # ' + this.requirements.packageManagerLabel);
        else c.allInstall.forEach((a) => lines.push(a.command + '   # ' + a.label));
        if (c.after) lines.push('', T(c.after));
        return lines.join('\n');
      },
      fmtRate(bps) {
        if (!bps || bps < 1) return '0 bps';
        if (bps < 1000) return Math.round(bps) + ' bps';
        if (bps < 1000000) return (bps / 1000).toFixed(1) + ' kbps';
        if (bps < 1000000000) return (bps / 1000000).toFixed(2) + ' Mbps';
        return (bps / 1000000000).toFixed(2) + ' Gbps';
      },
      spark(values) {
        if (!values || !values.length) return '';
        const max = Math.max(1, ...values);
        const step = 300 / Math.max(1, values.length - 1);
        return values.map((v, i) => (i * step).toFixed(1) + ',' + (58 - (v / max) * 56).toFixed(1)).join(' ');
      },
      barWidth(ms, total) {
        const pct = total > 0 ? Math.max(1, (ms / total) * 100) : 0;
        return pct.toFixed(1) + '%';
      },
      toggleLive() {
        if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; this.liveOn = false; return; }
        this.liveOn = true;
        this.lastCounters = null;
        this.liveTimer = setInterval(() => this.tickCounters(), 1000);
        this.tickCounters();
      },
      async tickCounters() {
        let now;
        try { now = await api('bench/counters'); } catch (e) { this.toggleLive(); this.fail(e); return; }
        const names = Object.keys(now.interfaces).filter((n) => n !== 'lo');
        this.liveIfaces = names;
        if (!this.liveIface || !names.includes(this.liveIface)) {
          // Default to whichever interface has moved the most traffic.
          this.liveIface = names.sort((a, b) => now.interfaces[b].rx - now.interfaces[a].rx)[0] || '';
        }
        const prev = this.lastCounters;
        this.lastCounters = now;
        const cur = now.interfaces[this.liveIface];
        if (!cur) return;
        this.liveErrors = cur.rxErrors + cur.txErrors + cur.rxDropped + cur.txDropped;
        if (!prev || !prev.interfaces[this.liveIface]) return;
        const dt = Math.max(0.2, now.at - prev.at);
        const rx = Math.max(0, (cur.rx - prev.interfaces[this.liveIface].rx)) * 8 / dt;
        const tx = Math.max(0, (cur.tx - prev.interfaces[this.liveIface].tx)) * 8 / dt;
        this.liveNow = { rx, tx };
        this.liveRx.push(rx); this.liveTx.push(tx);
        if (this.liveRx.length > 60) { this.liveRx.shift(); this.liveTx.shift(); }
      },
      /**
       * Measure the line, and show it happening.
       *
       * The server reports a sample many times a second while it transfers,
       * one JSON object to a line, so the reading is drawn as it is taken
       * rather than appearing all at once at the end.
       */
      async runSpeed() {
        if (this.busy.speed) return;
        this.busy.speed = true;
        this.speedResult = null;
        this.speedLive = { running: true, phase: 'start', down: [], up: [] };
        this.$nextTick(() => this.drawSpeed());
        try {
          const response = await fetch(BASE + 'api/bench/speedtest-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', requesttoken: TOKEN },
            credentials: 'same-origin',
            body: JSON.stringify({ megabytes: this.speedSize, upload: this.speedUpload, via: this.speedVia }),
          });
          if (!response.ok || !response.body) throw new Error(T('Could not connect'));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let rest = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            rest += decoder.decode(value, { stream: true });
            const lines = rest.split('\n');
            rest = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              let sample = null;
              try { sample = JSON.parse(line); } catch (e) { continue; }
              this.takeSpeedSample(sample);
            }
          }
        } catch (e) {
          this.fail(e);
        } finally {
          this.speedLive.running = false;
          this.busy.speed = false;
        }
      },
      /** One reading from the measurement, as it arrives. */
      takeSpeedSample(sample) {
        const phase = sample && sample.phase;
        if (phase === 'start') {
          this.speedLive.down = [];
          this.speedLive.up = [];
        } else if (phase === 'down' || phase === 'up') {
          this.speedLive[phase].push({ seconds: sample.seconds, mbps: sample.mbps });
          this.drawSpeed();
        } else if (phase === 'done') {
          this.speedResult = sample;
          this.drawSpeed();
        } else if (phase === 'error') {
          this.note(sample.error || T('Could not connect'));
        }
        // Anything else is a phase this version does not know about; ignoring
        // it keeps an older browser working against a newer server.
        this.speedLive.phase = phase || '';
      },
      /**
       * Draw what has been measured so far.
       *
       * Down and up happen one after the other, so they share a single run of
       * time with a dividing line between them: that way a slow start, a
       * stall, or a line that fades under load is visible, which an average
       * at the end can never show.
       */
      drawSpeed() {
        const box = this.$refs.speedCanvas;
        const canvas = Array.isArray(box) ? box[0] : box;
        if (!canvas) return;
        const down = this.speedLive.down;
        const up = this.speedLive.up;
        const width = canvas.clientWidth || 600;
        const height = 160;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.ceil(width * ratio);
        canvas.height = Math.ceil(height * ratio);
        canvas.style.height = height + 'px';
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const shift = down.length ? down[down.length - 1].seconds : 0;
        const every = [...down.map((s) => ({ x: s.seconds, y: s.mbps })), ...up.map((s) => ({ x: shift + s.seconds, y: s.mbps }))];
        if (!every.length) return;
        const maxX = Math.max(1, ...every.map((p) => p.x));
        const maxY = Math.max(1, ...every.map((p) => p.y));
        const left = 46;
        const foot = 16;
        const px = (x) => left + (width - left - 8) * (x / maxX);
        const py = (y) => (height - foot) - (height - foot - 12) * (y / maxY);

        ctx.strokeStyle = 'rgba(127,127,127,.3)';
        ctx.lineWidth = 1;
        for (const y of [0, maxY]) {
          ctx.beginPath();
          ctx.moveTo(left, py(y));
          ctx.lineTo(width - 8, py(y));
          ctx.stroke();
        }
        if (down.length && up.length) {
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(px(shift), 8);
          ctx.lineTo(px(shift), height - foot);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const trace = (list, colour, offset) => {
          if (!list.length) return;
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.beginPath();
          list.forEach((s, i) => {
            const x = px(offset + s.seconds);
            const y = py(s.mbps);
            if (i) { ctx.lineTo(x, y); } else { ctx.moveTo(x, y); }
          });
          ctx.stroke();
        };
        trace(down, '#2970e2', 0);
        trace(up, '#2e9e4f', shift);

        ctx.fillStyle = 'rgba(127,127,127,.95)';
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(Math.round(maxY) + ' Mbps', 2, py(maxY) + 4);
        ctx.fillText('0', 2, py(0) + 4);
        ctx.fillText(maxX.toFixed(1) + ' s', width - 42, height - 3);
      },
      async runIperf() {
        this.iperfResult = await this.guarded('iperf', () => api('bench/iperf', {
          method: 'POST',
          body: JSON.stringify({ host: this.iperfHost, port: this.iperfPort, seconds: this.iperfSeconds, reverse: this.iperfReverse }),
        }));
      },
      async runDnsBench() { this.dnsBench = await this.guarded('dnsbench', () => api('bench/dns?' + qs({ rounds: 2 }))); },
      async runTiming() { this.timingResult = await this.guarded('timing', () => api('bench/http?' + qs({ url: this.timingUrl }))); },
      // NETBASE-STORE-REMOVED: runPath (mtr)
//       async runPath() { this.pathResult = await this.guarded('path', () => api('tools/path?' + qs({ host: this.pingHost }))); },
      openSysInfo() {
        this.sysInfo = true;
        if (this.allowed('server') && !this.serverResult) this.runServer();
      },
      async runServer() { this.serverResult = await this.guarded('server', () => api('tools/server')); },
      // NETBASE-STORE-REMOVED: runNmap
//       async runNmap() {
//         const targets = this.nmapTargets.split(/[\s,]+/).filter(Boolean);
//         this.nmapResult = await this.guarded('nmap', () => api('nmap', {
//           method: 'POST',
//           body: JSON.stringify({ targets, preset: this.nmapPreset, extra: this.nmapExtra ? [this.nmapExtra] : [] }),
//         }));
//       },
      /** Everything the tab in front of you has found, gathered as plain text. */
      resultBundle() {
        const named = (label, value) => (value ? { label, value } : null);
        const parts = {
          devices: () => [named(T('Devices'), this.shownDevices.length ? this.devicesAsText() : null)],
          dns: () => [
            named(T('Records'), this.dnsResult), named(T('Any type, any resolver'), this.dnsQueryResult),
            named(T('Resolver comparison'), this.dnsCompareResult), named(T('Delegation trace'), this.dnsTraceResult),
            named(T('Zone transfer'), this.axfrResult),
          ],
          whois: () => [named(T('Whois'), this.whoisResult), named(T('Free-domain search'), this.availResults.length ? this.availAsText() : null)],
          // NETBASE-STORE-REMOVED: ping and ports results
//           ping: () => [
//             named(T('Ping'), this.pingResult), named(T('Traceroute'), this.traceResult),
//             named(T('TCP ping'), this.tcpPingResult), named('MTU', this.mtuResult),
//           ],
//           ports: () => [named(T('Ports'), this.portResult)],
          tls: () => [
            named(T('Certificate'), this.tlsResult), named(T('TLS versions'), this.tlsVersionsResult),
            named('HTTP', this.httpResult),
          ],
          subnet: () => [
            named(T('Subnet'), this.subnetResult), named(T('Split'), this.splitResult),
            named(T('Aggregate'), this.aggregateResult), named(T('MAC address'), this.macResult),
          ],
          bench: () => [
            named(T('Internet speed'), this.speedResult), named(T('LAN throughput'), this.iperfResult),
            named(T('DNS resolvers'), this.dnsBench), named(T('Where the time goes'), this.timingResult),
            // NETBASE-STORE-REMOVED: path quality result
//             named(T('Path quality'), this.pathResult),
          ],
          mail: () => [
            named(T('Domain policy'), this.mailAudit), named(T('Server test'), this.mailProbeResult),
            named(T('Open relay'), this.relayResult), named(T('Blocklists'), this.blResult),
            named(T('Test message'), this.sendResult), named(T('Mailbox'), this.mailboxResult),
          ],
          files: () => [named(T('Listing'), this.filesData)],
          ssh: () => [
            named(T('SSH'), this.sshResult), named('Telnet', this.telnetResult),
            named(T('Command'), this.sshRunResult),
            named(T('Console'), this.terms.length ? this.terms.map((w) => w.lines.map((l) => l.text).join('\n')).join('\n\n') : null),
          ],
          ntp: () => [named(T('Clock check'), this.ntpResult)],
          // NETBASE-STORE-REMOVED: nmap results
//           nmap: () => [named('nmap', this.nmapResult)],
        };
        const found = (parts[this.tab] ? parts[this.tab]() : []).filter(Boolean);
        if (!found.length) return null;

        const asText = (value) => {
          if (typeof value === 'string') return value;
          // Whois is a conversation with several servers; its own words are
          // worth more than the shape NetBase parsed them into.
          if (value && Array.isArray(value.chain) && value.chain.length) {
            return value.chain.map((step) => '— ' + step.server + ' —\n' + (step.response || '')).join('\n\n');
          }
          if (value && typeof value.output === 'string' && value.output.trim()) {
            const rest = { ...value };
            delete rest.output;
            return value.output.trimEnd() + '\n\n' + JSON.stringify(rest, null, 2);
          }
          return JSON.stringify(value, null, 2);
        };
        const when = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stampText = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate())
          + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
        const head = 'NetBase — ' + T(this.currentTab.label) + '  (' + stampText + ')';
        const body = found.map((p) => '## ' + p.label + '\n' + asText(p.value)).join('\n\n');
        const file = 'netbase-' + this.tab + '-' + when.getFullYear() + pad(when.getMonth() + 1) + pad(when.getDate())
          + '-' + pad(when.getHours()) + pad(when.getMinutes()) + '.txt';
        return { name: file, text: head + '\n\n' + body + '\n' };
      },
      devicesAsText() {
        const rows = this.shownDevices.map((d) => [
          d.online ? '●' : '○', d.ip, d.name || '', d.mac || '', this.vendorText(d) || '',
          d.type ? this.typeText(d.type) : '', (d.ports || []).join(' '),
        ].join('\t'));
        return ['status\tip\tname\tmac\tvendor\ttype\tports', ...rows].join('\n');
      },
      /** The free-domain results as text — the rows on screen (after the two
       *  show/hide switches), each as "<mark> <domain>", with a header noting how
       *  many of the total are shown. */
      availAsText() {
        const rows = this.availShown;
        const lines = rows.map((r) => r.mark + '\t' + r.domain + ((r.cls === 'maybe' || r.cls === 'unknown') && r.note ? '\t' + r.note : ''));
        const head = T('{shown} of {total} shown', { shown: rows.length, total: this.availResults.length });
        return head + '\n' + lines.join('\n');
      },
      /** Text onto the clipboard, whichever way this browser allows. */
      async copyText(text, said) {
        if (!text) return;
        await this.toClipboard(text);
        this.note(said || T('Copied'));
      },
      /** The clipboard alone, with nothing said about it anywhere. */
      async toClipboard(text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {
          // Clipboard permission is not always given; a selection always is.
          const box = document.createElement('textarea');
          box.value = text;
          document.body.appendChild(box);
          box.select();
          document.execCommand('copy');
          box.remove();
        }
      },
      async copyResult() {
        const bundle = this.resultBundle();
        if (bundle) await this.copyText(bundle.text);
      },
      /**
       * Everything known about one device, as lines a person can paste into a
       * ticket or a stock list. The same rows the drawer shows, in the same
       * order, so what is copied is what was on the screen.
       */
      deviceLines(device) {
        if (!device) return [];
        const extra = device.extra || {};
        const rows = [
          [T('Name'), device.label || device.hostname || device.ip],
          [T('IPv4'), device.ip],
          [T('MAC address'), device.mac || ''],
          [T('Vendor'), this.vendorText(device)],
          [T('Reported name'), device.hostname || ''],
          [T('Workgroup'), device.workgroup || ''],
          [T('Type'), device.type ? this.typeText(device.type) : ''],
          [T('Open ports'), (device.ports || []).join(', ')],
          [T('Found by'), (device.sources || []).join(', ')],
          [T('First seen'), stamp(device.firstSeen)],
          [T('Last seen'), stamp(device.lastSeen)],
          ['mDNS', extra.mdns || ''],
          [T('Reverse DNS'), extra.rdns || ''],
          ['SSDP', extra.ssdp || ''],
          [T('Notes'), device.notes || ''],
        ];
        return rows.filter((r) => String(r[1]).trim() !== '');
      },
      copyDevice(device) {
        const lines = this.deviceLines(device);
        if (!lines.length) return;
        const width = Math.max(...lines.map((r) => r[0].length));
        const text = lines.map((r) => r[0].padEnd(width) + '  ' + r[1]).join('\n');
        this.copyText(text, T('The whole record is on the clipboard'));
      },
      /** One row on its own: the value, not the label, because that is what gets pasted. */
      copyField(label, value) {
        this.copyText(String(value == null ? '' : value).trim(), T('{field} copied', { field: label }));
      },
      downloadResult() {
        const bundle = this.resultBundle();
        if (!bundle) return;
        const blob = new Blob([bundle.text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = bundle.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
      async saveResultToFiles() {
        const bundle = this.resultBundle();
        if (!bundle) return;
        try {
          const saved = await api('save', {
            method: 'POST',
            body: JSON.stringify({ name: bundle.name, content: bundle.text, folder: 'NetBase' }),
          });
          this.note(T('Saved to {path}', { path: saved.path }));
        } catch (e) { this.fail(e); }
      },
      exportCsv() {
        const head = ['name', 'ip', 'mac', 'vendor', 'type', 'ports', 'workgroup', 'firstSeen', 'lastSeen', 'online'];
        const rows = this.shownDevices.map((d) => [
          d.name, d.ip, d.mac, this.vendorText(d), d.type, d.ports.join(' '), d.workgroup,
          stamp(d.firstSeen), stamp(d.lastSeen), d.online ? 'yes' : 'no',
        ]);
        const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'netbase-devices.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
    },
    watch: {
      // A well-known port already says which protocol it speaks, so the
      // choice is made for the person typing — and left editable.
      openPort(value) {
        const scheme = WEB_PORTS[Number(value)];
        if (scheme) this.openScheme = scheme;
      },
      // Each device gets an empty box rather than the last one's number.
      // Only when it is a different device. Re-reading the list hands back a
      // fresh object for the same row, and clearing the panel on that would
      // wipe the answer the moment it arrived.
      selected(now, before) {
        if (now && before && now.id === before.id) return;
        this.openPort = ''; this.openScheme = 'http';
        this.deep = { busy: '', percent: 0, note: '', pages: [] };
      },
      // The registry is bundled and the answer is local, so there is no reason
      // to make anyone press a button once the prefix is there.
      macQuery(value) {
        clearTimeout(this.macTimer);
        if (value.length < 6) { this.macResult = null; return; }
        this.macTimer = setTimeout(() => this.runMac(), 250);
      },
      tab(value) {
        // A notice belongs to the tool that raised it. Leaving a tab clears it,
        // so a result or an error from one tool is never left sitting over
        // another — and "scan finished" does not follow the eye onto Whois.
        clearTimeout(this.noteTimer);
        this.banner = null;
        // Saved connections are shared by the mail and file tabs; fetch them the
        // first time either one is opened.
        if (value === 'whois') this.loadAvailTiers();
        if ((value === 'files' || value === 'mail' || value === 'ssh') && !this.connections.length) this.loadConnections();
        if (value === 'files' && this.filesConn && !this.filesData) this.browse('');
        // Polling counters from a tab nobody is looking at is just noise.
        if (value !== 'bench' && this.liveTimer) this.toggleLive();
      },
    },
    unmounted() {
      if (this.liveTimer) clearInterval(this.liveTimer);
      window.removeEventListener('message', this.onWindowMessage);
      window.removeEventListener('resize', this.onViewportResize);
    },
    mounted() {
      rootProxy = this;
      // The sort column and direction the person last chose for the device list.
      try {
        const s = JSON.parse(localStorage.getItem('netbase.sort') || 'null');
        if (s && s.key) { this.sortKey = String(s.key); this.sortDir = s.dir === -1 ? -1 : 1; }
      } catch (e) { /* private window or nothing saved */ }
      window.addEventListener('message', this.onWindowMessage);
      window.addEventListener('resize', this.onViewportResize);
      const root = document.getElementById('netbase-root');
      if (root && root.dataset.theme) this.settings.theme = root.dataset.theme;
      this.applyTheme();
      this.watchNcTheme();
      this.load();
    },
  });

  const mount = () => {
    const el = document.getElementById('netbase-root');
    if (el) app.mount(el);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', mount); } else { mount(); }
}());
