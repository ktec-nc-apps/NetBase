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

  // Precompiled render function (eval-free). Source template lives in netbase.js;
  // regenerate with regibase-build/netbase-build.mjs after editing the template.
  const render = (function () {
const { openBlock: _openBlock, createElementBlock: _createElementBlock, createCommentVNode: _createCommentVNode, createElementVNode: _createElementVNode, toDisplayString: _toDisplayString, renderList: _renderList, Fragment: _Fragment, withModifiers: _withModifiers, normalizeClass: _normalizeClass, vModelText: _vModelText, withDirectives: _withDirectives, vModelCheckbox: _vModelCheckbox, vModelRadio: _vModelRadio, createTextVNode: _createTextVNode, vModelSelect: _vModelSelect, normalizeStyle: _normalizeStyle, withKeys: _withKeys, vShow: _vShow, createStaticVNode: _createStaticVNode } = Vue

const _hoisted_1 = { class: "brand" }
const _hoisted_2 = /*#__PURE__*/_createStaticVNode("<span class=\"logo\"><svg viewBox=\"333 400 1335 1030\"><path d=\"M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></path><path d=\"M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\" fill=\"#2e3192\"></path><path d=\"M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></path><path d=\"M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z\" fill=\"#2970e2\"></path></svg></span><span>NetBase</span>", 2)
const _hoisted_4 = {
  key: 0,
  class: "tag"
}
const _hoisted_5 = ["title", "onClick", "onKeydown", "onDragstart", "onDragover", "onDragleave", "onDrop"]
const _hoisted_6 = ["innerHTML"]
const _hoisted_7 = { class: "nm" }
const _hoisted_8 = {
  key: 0,
  class: "ct"
}
const _hoisted_9 = /*#__PURE__*/_createElementVNode("span", {
  class: "grip",
  "aria-hidden": "true"
}, "⠿", -1 /* HOISTED */)
const _hoisted_10 = { class: "sidebar-foot" }
const _hoisted_11 = ["disabled"]
const _hoisted_12 = ["disabled", "title"]
const _hoisted_13 = { class: "main" }
const _hoisted_14 = { class: "topbar" }
const _hoisted_15 = ["title", "aria-label"]
const _hoisted_16 = { class: "title" }
const _hoisted_17 = { class: "ic" }
const _hoisted_18 = { class: "nm" }
const _hoisted_19 = { class: "desc" }
const _hoisted_20 = /*#__PURE__*/_createElementVNode("div", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_21 = { class: "topbar-actions" }
const _hoisted_22 = {
  key: 0,
  class: "tab-actions"
}
const _hoisted_23 = ["placeholder"]
const _hoisted_24 = ["title"]
const _hoisted_25 = /*#__PURE__*/_createElementVNode("span", { class: "track" }, [
  /*#__PURE__*/_createElementVNode("span", { class: "thumb" })
], -1 /* HOISTED */)
const _hoisted_26 = { class: "switch-label" }
const _hoisted_27 = ["title"]
const _hoisted_28 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("path", { d: "M4 20h16" }),
    /*#__PURE__*/_createElementVNode("path", { d: "M14.5 4.5l3 3L8 17l-3.5.5L5 14z" })
  ])
], -1 /* HOISTED */)
const _hoisted_29 = { class: "lb" }
const _hoisted_30 = ["title", "disabled"]
const _hoisted_31 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3.5v11.5\"></path><path d=\"M7.5 10.5L12 15l4.5-4.5\"></path><path d=\"M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5\"></path></svg></span><span class=\"lb\">CSV</span>", 2)
const _hoisted_33 = [
  _hoisted_31
]
const _hoisted_34 = ["title", "disabled"]
const _hoisted_35 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("rect", {
      x: "9",
      y: "9",
      width: "12",
      height: "12",
      rx: "2.2"
    }),
    /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
  ])
], -1 /* HOISTED */)
const _hoisted_36 = { class: "lb" }
const _hoisted_37 = ["title", "disabled"]
const _hoisted_38 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3.5v11.5\"></path><path d=\"M7.5 10.5L12 15l4.5-4.5\"></path><path d=\"M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5\"></path></svg></span>", 1)
const _hoisted_39 = { class: "lb" }
const _hoisted_40 = ["title", "disabled"]
const _hoisted_41 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"></path><path d=\"M12 10.5v5\"></path><path d=\"M9.8 13.3l2.2 2.2 2.2-2.2\"></path></svg></span>", 1)
const _hoisted_42 = { class: "lb" }
const _hoisted_43 = { class: "content" }
const _hoisted_44 = ["aria-label"]
const _hoisted_45 = /*#__PURE__*/_createElementVNode("span", null, null, -1 /* HOISTED */)
const _hoisted_46 = [
  _hoisted_45
]
const _hoisted_47 = ["title", "aria-label"]
const _hoisted_48 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_49 = [
  _hoisted_48
]
const _hoisted_50 = { key: 1 }
const _hoisted_51 = {
  key: 0,
  class: "card scan-card"
}
const _hoisted_52 = { class: "scan-what" }
const _hoisted_53 = { class: "fl-label" }
const _hoisted_54 = ["title"]
const _hoisted_55 = ["title"]
const _hoisted_56 = { class: "scan-row" }
const _hoisted_57 = ["title"]
const _hoisted_58 = { class: "fl-label" }
const _hoisted_59 = ["placeholder"]
const _hoisted_60 = ["title"]
const _hoisted_61 = { class: "fl-label" }
const _hoisted_62 = ["value"]
const _hoisted_63 = ["title"]
const _hoisted_64 = ["title"]
const _hoisted_65 = { class: "arp-clear" }
const _hoisted_66 = ["disabled", "title"]
const _hoisted_67 = ["title", "aria-label"]
const _hoisted_68 = {
  key: 3,
  class: "btn primary",
  disabled: ""
}
const _hoisted_69 = { class: "scan-opts" }
const _hoisted_70 = ["title"]
const _hoisted_71 = ["title"]
const _hoisted_72 = ["title"]
const _hoisted_73 = { class: "scan-sub" }
const _hoisted_74 = { class: "scan-sub-head" }
const _hoisted_75 = ["title"]
const _hoisted_76 = { class: "opt-label" }
const _hoisted_77 = { value: "common" }
const _hoisted_78 = { value: "detailed" }
const _hoisted_79 = { value: "wellKnown" }
const _hoisted_80 = { value: "high" }
const _hoisted_81 = { value: "all" }
const _hoisted_82 = ["title"]
const _hoisted_83 = { class: "opt-label" }
const _hoisted_84 = ["value"]
const _hoisted_85 = {
  key: 0,
  class: "progress"
}
const _hoisted_86 = { class: "phase-line" }
const _hoisted_87 = { class: "phase-step" }
const _hoisted_88 = { class: "progress-text" }
const _hoisted_89 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_90 = { key: 0 }
const _hoisted_91 = {
  key: 1,
  class: "hint"
}
const _hoisted_92 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_93 = {
  key: 2,
  class: "grid"
}
const _hoisted_94 = /*#__PURE__*/_createElementVNode("th", { class: "c-dot" }, null, -1 /* HOISTED */)
const _hoisted_95 = { class: "c-name" }
const _hoisted_96 = ["title"]
const _hoisted_97 = { class: "th-sub" }
const _hoisted_98 = /*#__PURE__*/_createElementVNode("span", { class: "th-sep" }, "·", -1 /* HOISTED */)
const _hoisted_99 = /*#__PURE__*/_createElementVNode("span", { class: "th-sep" }, "·", -1 /* HOISTED */)
const _hoisted_100 = /*#__PURE__*/_createElementVNode("span", { class: "th-sep" }, "·", -1 /* HOISTED */)
const _hoisted_101 = { class: "th-line plain" }
const _hoisted_102 = { class: "c-pair" }
const _hoisted_103 = { class: "c-extra" }
const _hoisted_104 = ["onClick", "onContextmenu"]
const _hoisted_105 = { class: "c-dot" }
const _hoisted_106 = ["title"]
const _hoisted_107 = { class: "c-name" }
const _hoisted_108 = { class: "pair-a" }
const _hoisted_109 = { class: "ic" }
const _hoisted_110 = {
  key: 0,
  class: "badge self"
}
const _hoisted_111 = {
  key: 1,
  class: "badge"
}
const _hoisted_112 = { class: "addr-net" }
const _hoisted_113 = ["title"]
const _hoisted_114 = { class: "addr-ip" }
const _hoisted_115 = { class: "addr-mac dim" }
const _hoisted_116 = ["title"]
const _hoisted_117 = { class: "addr-ports-label" }
const _hoisted_118 = ["title", "onClick"]
const _hoisted_119 = ["title", "onClick"]
const _hoisted_120 = { key: 2 }
const _hoisted_121 = { key: 3 }
const _hoisted_122 = ["title"]
const _hoisted_123 = { class: "c-pair" }
const _hoisted_124 = { class: "pair-a" }
const _hoisted_125 = { class: "dim c-extra" }
const _hoisted_126 = { key: 2 }
const _hoisted_127 = { class: "card tool-card" }
const _hoisted_128 = { class: "seg" }
const _hoisted_129 = ["onClick"]
const _hoisted_130 = { class: "card tool-card" }
const _hoisted_131 = { class: "tool-row" }
const _hoisted_132 = ["placeholder"]
const _hoisted_133 = ["disabled"]
const _hoisted_134 = { class: "chips" }
const _hoisted_135 = ["value"]
const _hoisted_136 = {
  key: 0,
  class: "card"
}
const _hoisted_137 = { class: "grid compact" }
const _hoisted_138 = { class: "mono" }
const _hoisted_139 = { class: "dim mono" }
const _hoisted_140 = { class: "mono wrap" }
const _hoisted_141 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_142 = {
  key: 1,
  class: "kv"
}
const _hoisted_143 = { key: 0 }
const _hoisted_144 = /*#__PURE__*/_createElementVNode("span", null, "SPF", -1 /* HOISTED */)
const _hoisted_145 = { key: 1 }
const _hoisted_146 = /*#__PURE__*/_createElementVNode("span", null, "DMARC", -1 /* HOISTED */)
const _hoisted_147 = { class: "card tool-card" }
const _hoisted_148 = { class: "tool-row" }
const _hoisted_149 = ["placeholder"]
const _hoisted_150 = ["value"]
const _hoisted_151 = ["value"]
const _hoisted_152 = ["placeholder"]
const _hoisted_153 = ["disabled"]
const _hoisted_154 = { class: "opt" }
const _hoisted_155 = { class: "dim" }
const _hoisted_156 = {
  key: 0,
  class: "card"
}
const _hoisted_157 = { class: "kv" }
const _hoisted_158 = { key: 0 }
const _hoisted_159 = { class: "bad" }
const _hoisted_160 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_161 = { class: "mono tiny" }
const _hoisted_162 = { class: "mono" }
const _hoisted_163 = { class: "dim mono" }
const _hoisted_164 = { class: "mono wrap tiny" }
const _hoisted_165 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_166 = { key: 2 }
const _hoisted_167 = { class: "grid compact" }
const _hoisted_168 = { class: "mono tiny" }
const _hoisted_169 = { class: "mono" }
const _hoisted_170 = { class: "mono wrap tiny" }
const _hoisted_171 = { class: "card tool-card" }
const _hoisted_172 = { class: "tool-row" }
const _hoisted_173 = ["placeholder"]
const _hoisted_174 = ["value"]
const _hoisted_175 = ["disabled"]
const _hoisted_176 = { class: "dim" }
const _hoisted_177 = {
  key: 0,
  class: "card"
}
const _hoisted_178 = { class: "grid compact" }
const _hoisted_179 = { class: "dim mono tiny" }
const _hoisted_180 = { class: "mono" }
const _hoisted_181 = { class: "mono" }
const _hoisted_182 = { class: "mono wrap tiny" }
const _hoisted_183 = { class: "card tool-card" }
const _hoisted_184 = { class: "tool-row" }
const _hoisted_185 = ["placeholder"]
const _hoisted_186 = ["value"]
const _hoisted_187 = ["disabled"]
const _hoisted_188 = { class: "dim" }
const _hoisted_189 = {
  key: 0,
  class: "card"
}
const _hoisted_190 = { class: "ts-head" }
const _hoisted_191 = { class: "pill" }
const _hoisted_192 = { class: "mono" }
const _hoisted_193 = { class: "dim mono" }
const _hoisted_194 = { class: "dim" }
const _hoisted_195 = {
  key: 0,
  class: "mono tiny wrap"
}
const _hoisted_196 = {
  key: 1,
  class: "dim mono tiny wrap"
}
const _hoisted_197 = { class: "card tool-card" }
const _hoisted_198 = { class: "tool-row" }
const _hoisted_199 = ["placeholder"]
const _hoisted_200 = ["placeholder"]
const _hoisted_201 = ["disabled"]
const _hoisted_202 = { class: "dim" }
const _hoisted_203 = {
  key: 0,
  class: "card"
}
const _hoisted_204 = { class: "grid compact" }
const _hoisted_205 = { class: "mono" }
const _hoisted_206 = { class: "dim tiny" }
const _hoisted_207 = { class: "dim tiny" }
const _hoisted_208 = { class: "mono" }
const _hoisted_209 = { key: 0 }
const _hoisted_210 = { class: "raw" }
const _hoisted_211 = { key: 3 }
const _hoisted_212 = { class: "card tool-card" }
const _hoisted_213 = { class: "tool-row" }
const _hoisted_214 = ["placeholder"]
const _hoisted_215 = ["disabled"]
const _hoisted_216 = {
  key: 0,
  class: "card"
}
const _hoisted_217 = {
  key: 0,
  class: "kv"
}
const _hoisted_218 = ["open"]
const _hoisted_219 = { class: "raw" }
const _hoisted_220 = { class: "card tool-card" }
const _hoisted_221 = { class: "tool-row" }
const _hoisted_222 = ["placeholder"]
const _hoisted_223 = ["disabled"]
const _hoisted_224 = { class: "avail-scope" }
const _hoisted_225 = { class: "fl-label" }
const _hoisted_226 = ["value"]
const _hoisted_227 = { class: "dim" }
const _hoisted_228 = {
  key: 0,
  class: "dim tiny avail-warn"
}
const _hoisted_229 = {
  key: 0,
  class: "progress avail-progress"
}
const _hoisted_230 = { class: "bar" }
const _hoisted_231 = { class: "progress-text" }
const _hoisted_232 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_233 = {
  key: 1,
  class: "avail-list"
}
const _hoisted_234 = { class: "avail-filters" }
const _hoisted_235 = ["title"]
const _hoisted_236 = /*#__PURE__*/_createElementVNode("span", { class: "track" }, [
  /*#__PURE__*/_createElementVNode("span", { class: "thumb" })
], -1 /* HOISTED */)
const _hoisted_237 = { class: "switch-label" }
const _hoisted_238 = ["title"]
const _hoisted_239 = /*#__PURE__*/_createElementVNode("span", { class: "track" }, [
  /*#__PURE__*/_createElementVNode("span", { class: "thumb" })
], -1 /* HOISTED */)
const _hoisted_240 = { class: "switch-label" }
const _hoisted_241 = { class: "avail-legend dim tiny" }
const _hoisted_242 = { class: "avail-rows" }
const _hoisted_243 = ["title"]
const _hoisted_244 = ["title"]
const _hoisted_245 = ["title", "onClick"]
const _hoisted_246 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "📇", -1 /* HOISTED */)
const _hoisted_247 = {
  key: 0,
  class: "avail-empty dim"
}
const _hoisted_248 = { key: 4 }
const _hoisted_249 = { class: "card tool-card" }
const _hoisted_250 = { class: "tool-row" }
const _hoisted_251 = ["placeholder"]
const _hoisted_252 = ["disabled"]
const _hoisted_253 = ["disabled"]
const _hoisted_254 = ["disabled"]
const _hoisted_255 = {
  key: 0,
  class: "card"
}
const _hoisted_256 = { class: "grid compact" }
const _hoisted_257 = { class: "mono" }
const _hoisted_258 = { class: "mono dim tiny" }
const _hoisted_259 = {
  key: 1,
  class: "card"
}
const _hoisted_260 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_261 = {
  key: 1,
  class: "kv"
}
const _hoisted_262 = { key: 0 }
const _hoisted_263 = { class: "wrap" }
const _hoisted_264 = {
  key: 2,
  class: "card"
}
const _hoisted_265 = { class: "grid compact" }
const _hoisted_266 = { class: "mono wrap" }
const _hoisted_267 = { class: "mono" }
const _hoisted_268 = { class: "dim mono" }
const _hoisted_269 = { class: "dim" }
const _hoisted_270 = { class: "kv" }
const _hoisted_271 = { key: 5 }
const _hoisted_272 = { class: "card" }
const _hoisted_273 = { class: "bench-head" }
const _hoisted_274 = ["value"]
const _hoisted_275 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_276 = {
  key: 0,
  class: "bench-live"
}
const _hoisted_277 = { class: "rate rx" }
const _hoisted_278 = { class: "lbl" }
const _hoisted_279 = { class: "val" }
const _hoisted_280 = { class: "rate tx" }
const _hoisted_281 = { class: "lbl" }
const _hoisted_282 = { class: "val" }
const _hoisted_283 = {
  class: "spark",
  viewBox: "0 0 300 60",
  preserveAspectRatio: "none"
}
const _hoisted_284 = ["points"]
const _hoisted_285 = ["points"]
const _hoisted_286 = { class: "hint" }
const _hoisted_287 = { key: 0 }
const _hoisted_288 = { class: "card" }
const _hoisted_289 = { class: "bench-head" }
const _hoisted_290 = /*#__PURE__*/_createElementVNode("option", { value: 5 }, "5 MB", -1 /* HOISTED */)
const _hoisted_291 = /*#__PURE__*/_createElementVNode("option", { value: 25 }, "25 MB", -1 /* HOISTED */)
const _hoisted_292 = /*#__PURE__*/_createElementVNode("option", { value: 50 }, "50 MB", -1 /* HOISTED */)
const _hoisted_293 = /*#__PURE__*/_createElementVNode("option", { value: 100 }, "100 MB", -1 /* HOISTED */)
const _hoisted_294 = [
  _hoisted_290,
  _hoisted_291,
  _hoisted_292,
  _hoisted_293
]
const _hoisted_295 = ["title"]
const _hoisted_296 = { value: "auto" }
const _hoisted_297 = /*#__PURE__*/_createElementVNode("option", { value: "mlab" }, "M-Lab", -1 /* HOISTED */)
const _hoisted_298 = /*#__PURE__*/_createElementVNode("option", { value: "cloudflare" }, "Cloudflare", -1 /* HOISTED */)
const _hoisted_299 = { class: "inline-check" }
const _hoisted_300 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_301 = ["disabled"]
const _hoisted_302 = {
  key: 0,
  class: "hint"
}
const _hoisted_303 = {
  key: 1,
  class: "hint"
}
const _hoisted_304 = {
  key: 2,
  class: "bench-results"
}
const _hoisted_305 = { class: "big" }
const _hoisted_306 = { class: "lbl" }
const _hoisted_307 = { class: "num" }
const _hoisted_308 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_309 = { class: "big" }
const _hoisted_310 = { class: "lbl" }
const _hoisted_311 = { class: "num" }
const _hoisted_312 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_313 = { class: "big" }
const _hoisted_314 = { class: "lbl" }
const _hoisted_315 = { class: "num" }
const _hoisted_316 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "ms", -1 /* HOISTED */)
const _hoisted_317 = { class: "big" }
const _hoisted_318 = { class: "lbl" }
const _hoisted_319 = { class: "num" }
const _hoisted_320 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "ms", -1 /* HOISTED */)
const _hoisted_321 = {
  key: 3,
  class: "speed-graph"
}
const _hoisted_322 = { class: "speed-graph-head" }
const _hoisted_323 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_324 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_325 = {
  key: 1,
  class: "dim tiny mono"
}
const _hoisted_326 = {
  key: 2,
  class: "dim tiny mono"
}
const _hoisted_327 = {
  ref: "speedCanvas",
  class: "speed-canvas"
}
const _hoisted_328 = {
  key: 4,
  class: "hint danger"
}
const _hoisted_329 = { class: "card" }
const _hoisted_330 = { class: "bench-head" }
const _hoisted_331 = { class: "tool-row" }
const _hoisted_332 = ["placeholder"]
const _hoisted_333 = /*#__PURE__*/_createElementVNode("option", { value: 5 }, "5s", -1 /* HOISTED */)
const _hoisted_334 = /*#__PURE__*/_createElementVNode("option", { value: 10 }, "10s", -1 /* HOISTED */)
const _hoisted_335 = /*#__PURE__*/_createElementVNode("option", { value: 30 }, "30s", -1 /* HOISTED */)
const _hoisted_336 = [
  _hoisted_333,
  _hoisted_334,
  _hoisted_335
]
const _hoisted_337 = { class: "inline-check" }
const _hoisted_338 = ["disabled"]
const _hoisted_339 = {
  key: 0,
  class: "bench-results"
}
const _hoisted_340 = { class: "big" }
const _hoisted_341 = { class: "lbl" }
const _hoisted_342 = { class: "num" }
const _hoisted_343 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_344 = { class: "big" }
const _hoisted_345 = { class: "lbl" }
const _hoisted_346 = { class: "num" }
const _hoisted_347 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_348 = {
  key: 0,
  class: "big"
}
const _hoisted_349 = { class: "lbl" }
const _hoisted_350 = { class: "num" }
const _hoisted_351 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, null, -1 /* HOISTED */)
const _hoisted_352 = {
  key: 1,
  class: "spark tall",
  viewBox: "0 0 300 60",
  preserveAspectRatio: "none"
}
const _hoisted_353 = ["points"]
const _hoisted_354 = {
  key: 2,
  class: "hint danger"
}
const _hoisted_355 = {
  key: 1,
  class: "missing"
}
const _hoisted_356 = { class: "raw" }
const _hoisted_357 = { class: "card" }
const _hoisted_358 = { class: "bench-head" }
const _hoisted_359 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_360 = ["disabled"]
const _hoisted_361 = { class: "hint" }
const _hoisted_362 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_363 = { class: "mono" }
const _hoisted_364 = { class: "dim" }
const _hoisted_365 = {
  key: 0,
  class: "badge"
}
const _hoisted_366 = { class: "mono" }
const _hoisted_367 = { class: "mono dim" }
const _hoisted_368 = { class: "mono dim" }
const _hoisted_369 = { class: "mono dim" }
const _hoisted_370 = { class: "card" }
const _hoisted_371 = { class: "bench-head" }
const _hoisted_372 = { class: "tool-row" }
const _hoisted_373 = ["disabled"]
const _hoisted_374 = { class: "kv" }
const _hoisted_375 = {
  key: 0,
  class: "dim"
}
const _hoisted_376 = { class: "waterfall" }
const _hoisted_377 = { class: "wf-name" }
const _hoisted_378 = { class: "wf-bar" }
const _hoisted_379 = { class: "wf-ms mono" }
const _hoisted_380 = { key: 6 }
const _hoisted_381 = { class: "card tool-card" }
const _hoisted_382 = { class: "dim" }
const _hoisted_383 = { class: "tool-row" }
const _hoisted_384 = ["title"]
const _hoisted_385 = { value: "" }
const _hoisted_386 = ["label"]
const _hoisted_387 = ["value"]
const _hoisted_388 = {
  key: 0,
  class: "ip-boxes"
}
const _hoisted_389 = ["value", "data-col", "aria-label", "onInput", "onKeydown"]
const _hoisted_390 = {
  key: 0,
  class: "ip-dot"
}
const _hoisted_391 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_392 = ["aria-label"]
const _hoisted_393 = ["value"]
const _hoisted_394 = { class: "fl-check" }
const _hoisted_395 = {
  key: 0,
  class: "card"
}
const _hoisted_396 = { class: "kv" }
const _hoisted_397 = { class: "card tool-card" }
const _hoisted_398 = { class: "dim" }
const _hoisted_399 = { class: "tool-row" }
const _hoisted_400 = { class: "ip-boxes" }
const _hoisted_401 = ["value", "data-col", "aria-label", "onInput", "onKeydown"]
const _hoisted_402 = {
  key: 0,
  class: "ip-dot"
}
const _hoisted_403 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_404 = ["aria-label"]
const _hoisted_405 = ["value"]
const _hoisted_406 = { class: "dim" }
const _hoisted_407 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_408 = ["aria-label"]
const _hoisted_409 = ["value"]
const _hoisted_410 = ["disabled"]
const _hoisted_411 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_412 = { class: "mono" }
const _hoisted_413 = { class: "mono dim" }
const _hoisted_414 = { class: "mono dim" }
const _hoisted_415 = { class: "mono dim" }
const _hoisted_416 = { class: "mono" }
const _hoisted_417 = { class: "card tool-card" }
const _hoisted_418 = { class: "dim" }
const _hoisted_419 = { class: "ip-boxes" }
const _hoisted_420 = ["value", "data-group", "data-col", "aria-label", "onInput", "onKeydown", "onPaste"]
const _hoisted_421 = {
  key: 0,
  class: "ip-dot"
}
const _hoisted_422 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_423 = ["onUpdate:modelValue", "aria-label"]
const _hoisted_424 = ["value"]
const _hoisted_425 = ["title", "onClick"]
const _hoisted_426 = ["disabled", "title", "onClick"]
const _hoisted_427 = ["placeholder"]
const _hoisted_428 = { class: "tool-row" }
const _hoisted_429 = ["disabled"]
const _hoisted_430 = { class: "fl-check" }
const _hoisted_431 = {
  key: 2,
  class: "kv"
}
const _hoisted_432 = { class: "wrap" }
const _hoisted_433 = { class: "wrap" }
const _hoisted_434 = { class: "card tool-card" }
const _hoisted_435 = { class: "dim" }
const _hoisted_436 = { class: "dim" }
const _hoisted_437 = { class: "tool-row" }
const _hoisted_438 = ["aria-label"]
const _hoisted_439 = ["disabled"]
const _hoisted_440 = {
  key: 0,
  class: "kv"
}
const _hoisted_441 = { key: 7 }
const _hoisted_442 = { class: "card tool-card" }
const _hoisted_443 = { class: "seg" }
const _hoisted_444 = ["onClick"]
const _hoisted_445 = { class: "card tool-card" }
const _hoisted_446 = { class: "tool-row" }
const _hoisted_447 = ["placeholder"]
const _hoisted_448 = ["placeholder"]
const _hoisted_449 = ["disabled"]
const _hoisted_450 = { class: "opt" }
const _hoisted_451 = { class: "dim" }
const _hoisted_452 = {
  key: 0,
  class: "card"
}
const _hoisted_453 = { class: "score" }
const _hoisted_454 = {
  key: 0,
  class: "pill bad"
}
const _hoisted_455 = {
  key: 1,
  class: "pill warn"
}
const _hoisted_456 = {
  key: 2,
  class: "pill ok"
}
const _hoisted_457 = {
  key: 1,
  class: "card"
}
const _hoisted_458 = { class: "grid compact" }
const _hoisted_459 = /*#__PURE__*/_createElementVNode("th", null, "DANE", -1 /* HOISTED */)
const _hoisted_460 = { class: "mono" }
const _hoisted_461 = { class: "mono" }
const _hoisted_462 = { class: "mono" }
const _hoisted_463 = { class: "mono wrap" }
const _hoisted_464 = {
  key: 2,
  class: "card"
}
const _hoisted_465 = { class: "kv" }
const _hoisted_466 = /*#__PURE__*/_createElementVNode("span", null, "SPF", -1 /* HOISTED */)
const _hoisted_467 = { class: "wrap" }
const _hoisted_468 = { key: 0 }
const _hoisted_469 = /*#__PURE__*/_createElementVNode("span", null, "DMARC", -1 /* HOISTED */)
const _hoisted_470 = { class: "wrap" }
const _hoisted_471 = /*#__PURE__*/_createElementVNode("span", null, "MTA-STS", -1 /* HOISTED */)
const _hoisted_472 = { class: "wrap" }
const _hoisted_473 = /*#__PURE__*/_createElementVNode("span", null, "TLS-RPT", -1 /* HOISTED */)
const _hoisted_474 = { class: "wrap" }
const _hoisted_475 = /*#__PURE__*/_createElementVNode("span", null, "BIMI", -1 /* HOISTED */)
const _hoisted_476 = { class: "wrap" }
const _hoisted_477 = { key: 0 }
const _hoisted_478 = { class: "raw" }
const _hoisted_479 = { key: 1 }
const _hoisted_480 = {
  key: 2,
  class: "grid compact"
}
const _hoisted_481 = { class: "mono" }
const _hoisted_482 = { class: "mono" }
const _hoisted_483 = { class: "mono wrap tiny" }
const _hoisted_484 = { key: 3 }
const _hoisted_485 = {
  key: 4,
  class: "grid compact"
}
const _hoisted_486 = { class: "mono" }
const _hoisted_487 = { class: "mono" }
const _hoisted_488 = { class: "mono" }
const _hoisted_489 = {
  key: 3,
  class: "card"
}
const _hoisted_490 = { class: "mono" }
const _hoisted_491 = { class: "chips result" }
const _hoisted_492 = ["title"]
const _hoisted_493 = { class: "dim" }
const _hoisted_494 = { class: "card tool-card" }
const _hoisted_495 = { class: "tool-row" }
const _hoisted_496 = ["placeholder"]
const _hoisted_497 = /*#__PURE__*/_createElementVNode("option", { value: "smtp" }, "SMTP", -1 /* HOISTED */)
const _hoisted_498 = /*#__PURE__*/_createElementVNode("option", { value: "imap" }, "IMAP", -1 /* HOISTED */)
const _hoisted_499 = /*#__PURE__*/_createElementVNode("option", { value: "pop3" }, "POP3", -1 /* HOISTED */)
const _hoisted_500 = [
  _hoisted_497,
  _hoisted_498,
  _hoisted_499
]
const _hoisted_501 = { value: "auto" }
const _hoisted_502 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_503 = /*#__PURE__*/_createElementVNode("option", { value: "tls" }, "SSL/TLS", -1 /* HOISTED */)
const _hoisted_504 = { value: "none" }
const _hoisted_505 = ["placeholder"]
const _hoisted_506 = ["disabled"]
const _hoisted_507 = { class: "chips" }
const _hoisted_508 = ["onClick"]
const _hoisted_509 = {
  key: 0,
  class: "card"
}
const _hoisted_510 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_511 = { class: "kv" }
const _hoisted_512 = { class: "wrap" }
const _hoisted_513 = { key: 0 }
const _hoisted_514 = { key: 1 }
const _hoisted_515 = { class: "wrap" }
const _hoisted_516 = { key: 2 }
const _hoisted_517 = { class: "raw" }
const _hoisted_518 = { class: "raw" }
const _hoisted_519 = { class: "card tool-card" }
const _hoisted_520 = { class: "dim" }
const _hoisted_521 = { class: "tool-row" }
const _hoisted_522 = ["placeholder"]
const _hoisted_523 = ["disabled"]
const _hoisted_524 = { key: 0 }
const _hoisted_525 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_526 = { key: 1 }
const _hoisted_527 = { class: "raw" }
const _hoisted_528 = { class: "card tool-card" }
const _hoisted_529 = { class: "tool-row" }
const _hoisted_530 = ["placeholder"]
const _hoisted_531 = ["disabled"]
const _hoisted_532 = {
  key: 0,
  class: "chips result"
}
const _hoisted_533 = ["title"]
const _hoisted_534 = { class: "card tool-card" }
const _hoisted_535 = { class: "dim" }
const _hoisted_536 = { class: "tool-row" }
const _hoisted_537 = { class: "seg" }
const _hoisted_538 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_539 = { class: "note-line" }
const _hoisted_540 = { class: "fl-row" }
const _hoisted_541 = ["placeholder"]
const _hoisted_542 = ["disabled"]
const _hoisted_543 = { class: "dim tiny" }
const _hoisted_544 = {
  key: 1,
  class: "tool-row"
}
const _hoisted_545 = { value: 0 }
const _hoisted_546 = ["label"]
const _hoisted_547 = ["value"]
const _hoisted_548 = {
  key: 2,
  class: "dim tiny"
}
const _hoisted_549 = { class: "dim tiny" }
const _hoisted_550 = { class: "tool-row" }
const _hoisted_551 = /*#__PURE__*/_createElementVNode("option", { value: "imap" }, "IMAP", -1 /* HOISTED */)
const _hoisted_552 = /*#__PURE__*/_createElementVNode("option", { value: "pop3" }, "POP3", -1 /* HOISTED */)
const _hoisted_553 = { value: "smtp" }
const _hoisted_554 = /*#__PURE__*/_createElementVNode("option", { value: "tls" }, "SSL/TLS", -1 /* HOISTED */)
const _hoisted_555 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_556 = { value: "none" }
const _hoisted_557 = ["placeholder"]
const _hoisted_558 = ["placeholder"]
const _hoisted_559 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_560 = {
  key: 1,
  class: "tool-row"
}
const _hoisted_561 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_562 = /*#__PURE__*/_createElementVNode("option", { value: "tls" }, "SSL/TLS", -1 /* HOISTED */)
const _hoisted_563 = { value: "none" }
const _hoisted_564 = ["placeholder"]
const _hoisted_565 = {
  key: 2,
  class: "tool-row"
}
const _hoisted_566 = ["placeholder"]
const _hoisted_567 = { class: "tool-row" }
const _hoisted_568 = ["disabled"]
const _hoisted_569 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_570 = {
  key: 4,
  class: "kv"
}
const _hoisted_571 = { key: 0 }
const _hoisted_572 = { key: 1 }
const _hoisted_573 = { key: 2 }
const _hoisted_574 = { class: "wrap" }
const _hoisted_575 = { class: "tool-row" }
const _hoisted_576 = ["placeholder"]
const _hoisted_577 = ["placeholder"]
const _hoisted_578 = ["placeholder"]
const _hoisted_579 = { class: "tool-row" }
const _hoisted_580 = ["disabled"]
const _hoisted_581 = {
  key: 5,
  class: "kv"
}
const _hoisted_582 = { key: 0 }
const _hoisted_583 = { class: "wrap" }
const _hoisted_584 = { key: 6 }
const _hoisted_585 = { class: "raw" }
const _hoisted_586 = { key: 8 }
const _hoisted_587 = { class: "card tool-card" }
const _hoisted_588 = { class: "dim" }
const _hoisted_589 = { class: "tool-row" }
const _hoisted_590 = ["value"]
const _hoisted_591 = ["placeholder"]
const _hoisted_592 = ["disabled"]
const _hoisted_593 = { class: "dim tiny" }
const _hoisted_594 = { key: 0 }
const _hoisted_595 = {
  key: 0,
  class: "kv"
}
const _hoisted_596 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_597 = { key: 9 }
const _hoisted_598 = { class: "card tool-card" }
const _hoisted_599 = { class: "tool-row" }
const _hoisted_600 = { class: "seg" }
const _hoisted_601 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_602 = ["disabled"]
const _hoisted_603 = { class: "note-line" }
const _hoisted_604 = { class: "fl-row" }
const _hoisted_605 = ["placeholder"]
const _hoisted_606 = ["disabled"]
const _hoisted_607 = { class: "dim tiny" }
const _hoisted_608 = {
  key: 1,
  class: "tool-row"
}
const _hoisted_609 = /*#__PURE__*/_createElementVNode("option", { value: "sftp" }, "SFTP", -1 /* HOISTED */)
const _hoisted_610 = {
  key: 0,
  value: "scp"
}
const _hoisted_611 = /*#__PURE__*/_createElementVNode("option", { value: "ftp" }, "FTP", -1 /* HOISTED */)
const _hoisted_612 = { value: "" }
const _hoisted_613 = ["label"]
const _hoisted_614 = ["value"]
const _hoisted_615 = ["label"]
const _hoisted_616 = ["value"]
const _hoisted_617 = {
  key: 2,
  class: "dim tiny"
}
const _hoisted_618 = {
  key: 3,
  class: "tool-row"
}
const _hoisted_619 = /*#__PURE__*/_createElementVNode("option", { value: "sftp" }, "SFTP", -1 /* HOISTED */)
const _hoisted_620 = {
  key: 0,
  value: "scp"
}
const _hoisted_621 = /*#__PURE__*/_createElementVNode("option", { value: "ftp" }, "FTP", -1 /* HOISTED */)
const _hoisted_622 = ["placeholder"]
const _hoisted_623 = {
  key: 4,
  class: "tool-row"
}
const _hoisted_624 = { class: "mono" }
const _hoisted_625 = { class: "dim tiny" }
const _hoisted_626 = {
  key: 5,
  class: "tool-row"
}
const _hoisted_627 = { value: "password" }
const _hoisted_628 = { value: "key" }
const _hoisted_629 = { value: "none" }
const _hoisted_630 = /*#__PURE__*/_createElementVNode("option", { value: "tls" }, "SSL/TLS", -1 /* HOISTED */)
const _hoisted_631 = ["placeholder"]
const _hoisted_632 = ["placeholder"]
const _hoisted_633 = ["placeholder"]
const _hoisted_634 = ["disabled"]
const _hoisted_635 = {
  key: 6,
  class: "dim tiny"
}
const _hoisted_636 = { class: "tool-row" }
const _hoisted_637 = ["disabled"]
const _hoisted_638 = {
  key: 7,
  class: "dim"
}
const _hoisted_639 = {
  key: 0,
  class: "card panes"
}
const _hoisted_640 = { class: "pane" }
const _hoisted_641 = { class: "pane-head" }
const _hoisted_642 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_643 = ["disabled"]
const _hoisted_644 = { class: "path-bar" }
const _hoisted_645 = ["placeholder"]
const _hoisted_646 = { class: "grid compact files-grid" }
const _hoisted_647 = /*#__PURE__*/_createElementVNode("td", { colspan: "3" }, [
  /*#__PURE__*/_createElementVNode("span", { class: "nm" }, "📁 ..")
], -1 /* HOISTED */)
const _hoisted_648 = [
  _hoisted_647
]
const _hoisted_649 = ["onDragstart", "onClick", "onDblclick"]
const _hoisted_650 = { class: "nm" }
const _hoisted_651 = { class: "mono dim" }
const _hoisted_652 = { class: "dim" }
const _hoisted_653 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_654 = { class: "pane-foot" }
const _hoisted_655 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_656 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_657 = ["disabled"]
const _hoisted_658 = { class: "pane" }
const _hoisted_659 = { class: "pane-head" }
const _hoisted_660 = { class: "mono" }
const _hoisted_661 = { class: "dim tiny" }
const _hoisted_662 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_663 = ["title"]
const _hoisted_664 = ["disabled"]
const _hoisted_665 = { class: "path-bar" }
const _hoisted_666 = {
  key: 0,
  class: "note-line"
}
const _hoisted_667 = {
  key: 1,
  class: "fl-row"
}
const _hoisted_668 = ["placeholder"]
const _hoisted_669 = ["disabled"]
const _hoisted_670 = {
  key: 2,
  class: "hint root-on"
}
const _hoisted_671 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_672 = { class: "grid compact files-grid" }
const _hoisted_673 = { class: "c-owner" }
const _hoisted_674 = /*#__PURE__*/_createElementVNode("td", { colspan: "5" }, [
  /*#__PURE__*/_createElementVNode("span", { class: "nm" }, "📁 ..")
], -1 /* HOISTED */)
const _hoisted_675 = [
  _hoisted_674
]
const _hoisted_676 = ["onDragstart", "onClick", "onDblclick", "onContextmenu"]
const _hoisted_677 = { class: "nm" }
const _hoisted_678 = { class: "mono dim" }
const _hoisted_679 = { class: "dim" }
const _hoisted_680 = { class: "mono dim tiny" }
const _hoisted_681 = { class: "dim tiny c-owner" }
const _hoisted_682 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_683 = { class: "pane-foot" }
const _hoisted_684 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_685 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_686 = ["disabled"]
const _hoisted_687 = {
  key: 1,
  class: "card"
}
const _hoisted_688 = { class: "tool-row" }
const _hoisted_689 = ["placeholder"]
const _hoisted_690 = { class: "inline-check" }
const _hoisted_691 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_692 = { class: "dim tiny" }
const _hoisted_693 = {
  key: 2,
  class: "card queue-card"
}
const _hoisted_694 = { class: "tool-row" }
const _hoisted_695 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_696 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_697 = { class: "ic" }
const _hoisted_698 = { class: "nm mono" }
const _hoisted_699 = { class: "bar" }
const _hoisted_700 = { class: "pc mono" }
const _hoisted_701 = { class: "dim tiny" }
const _hoisted_702 = { class: "ic" }
const _hoisted_703 = { class: "nm mono" }
const _hoisted_704 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_705 = {
  key: 1,
  class: "dim tiny"
}
const _hoisted_706 = {
  key: 2,
  class: "dim tiny"
}
const _hoisted_707 = { key: 10 }
const _hoisted_708 = { class: "card tool-card" }
const _hoisted_709 = { class: "tool-row" }
const _hoisted_710 = { class: "seg" }
const _hoisted_711 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_712 = { class: "note-line" }
const _hoisted_713 = { class: "fl-row" }
const _hoisted_714 = ["placeholder"]
const _hoisted_715 = ["disabled"]
const _hoisted_716 = { class: "dim tiny" }
const _hoisted_717 = {
  key: 1,
  class: "tool-row"
}
const _hoisted_718 = { value: "" }
const _hoisted_719 = ["label"]
const _hoisted_720 = ["value"]
const _hoisted_721 = ["label"]
const _hoisted_722 = ["value"]
const _hoisted_723 = {
  key: 2,
  class: "dim tiny"
}
const _hoisted_724 = {
  key: 3,
  class: "tool-row"
}
const _hoisted_725 = /*#__PURE__*/_createElementVNode("option", { value: "ssh" }, "SSH", -1 /* HOISTED */)
const _hoisted_726 = /*#__PURE__*/_createElementVNode("option", { value: "telnet" }, "Telnet", -1 /* HOISTED */)
const _hoisted_727 = [
  _hoisted_725,
  _hoisted_726
]
const _hoisted_728 = ["placeholder"]
const _hoisted_729 = ["placeholder"]
const _hoisted_730 = { value: "password" }
const _hoisted_731 = { value: "key" }
const _hoisted_732 = {
  key: 4,
  class: "tool-row"
}
const _hoisted_733 = { class: "mono" }
const _hoisted_734 = { class: "dim tiny" }
const _hoisted_735 = {
  key: 5,
  class: "tool-row"
}
const _hoisted_736 = ["placeholder"]
const _hoisted_737 = ["placeholder"]
const _hoisted_738 = ["placeholder"]
const _hoisted_739 = ["disabled"]
const _hoisted_740 = {
  key: 6,
  class: "dim tiny"
}
const _hoisted_741 = { class: "tool-row" }
const _hoisted_742 = ["disabled"]
const _hoisted_743 = ["disabled"]
const _hoisted_744 = ["disabled"]
const _hoisted_745 = { class: "opt" }
const _hoisted_746 = { class: "tool-row" }
const _hoisted_747 = { value: "" }
const _hoisted_748 = ["value"]
const _hoisted_749 = ["disabled"]
const _hoisted_750 = { class: "tool-row" }
const _hoisted_751 = ["placeholder"]
const _hoisted_752 = ["disabled"]
const _hoisted_753 = {
  key: 0,
  class: "card"
}
const _hoisted_754 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_755 = { class: "kv" }
const _hoisted_756 = { class: "wrap" }
const _hoisted_757 = { key: 0 }
const _hoisted_758 = {
  key: 1,
  class: "grid compact"
}
const _hoisted_759 = { class: "mono" }
const _hoisted_760 = { class: "mono" }
const _hoisted_761 = { class: "mono wrap tiny" }
const _hoisted_762 = { class: "kv" }
const _hoisted_763 = { class: "wrap tiny" }
const _hoisted_764 = {
  key: 1,
  class: "card"
}
const _hoisted_765 = /*#__PURE__*/_createElementVNode("h3", null, "Telnet", -1 /* HOISTED */)
const _hoisted_766 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_767 = {
  key: 1,
  class: "raw"
}
const _hoisted_768 = {
  key: 2,
  class: "card"
}
const _hoisted_769 = { class: "kv" }
const _hoisted_770 = { class: "wrap" }
const _hoisted_771 = { class: "raw" }
const _hoisted_772 = { class: "drawer-head" }
const _hoisted_773 = { class: "dim" }
const _hoisted_774 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_775 = ["title", "aria-label"]
const _hoisted_776 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_777 = [
  _hoisted_776
]
const _hoisted_778 = { class: "drawer-body" }
const _hoisted_779 = {
  key: 0,
  class: "shell-gate warn"
}
const _hoisted_780 = { class: "empty-hint" }
const _hoisted_781 = { class: "dim tiny" }
const _hoisted_782 = {
  key: 1,
  class: "shell-gate warn"
}
const _hoisted_783 = { class: "empty-hint" }
const _hoisted_784 = {
  key: 2,
  class: "shell-gate"
}
const _hoisted_785 = { class: "shell-code-row" }
const _hoisted_786 = ["disabled"]
const _hoisted_787 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_788 = { class: "dim tiny" }
const _hoisted_789 = { class: "drawer-foot" }
const _hoisted_790 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_791 = { class: "modal" }
const _hoisted_792 = { class: "drawer-head" }
const _hoisted_793 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖥", -1 /* HOISTED */)
const _hoisted_794 = { class: "dim" }
const _hoisted_795 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_796 = ["title", "aria-label"]
const _hoisted_797 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_798 = [
  _hoisted_797
]
const _hoisted_799 = { class: "drawer-body" }
const _hoisted_800 = { class: "kv" }
const _hoisted_801 = /*#__PURE__*/_createElementVNode("span", null, "NetBase", -1 /* HOISTED */)
const _hoisted_802 = { key: 0 }
const _hoisted_803 = { key: 1 }
const _hoisted_804 = /*#__PURE__*/_createElementVNode("span", null, "PHP", -1 /* HOISTED */)
const _hoisted_805 = {
  key: 0,
  class: "dim"
}
const _hoisted_806 = { key: 2 }
const _hoisted_807 = { key: 3 }
const _hoisted_808 = { class: "dim" }
const _hoisted_809 = {
  key: 0,
  class: "card"
}
const _hoisted_810 = { class: "kv" }
const _hoisted_811 = { class: "grid compact" }
const _hoisted_812 = /*#__PURE__*/_createElementVNode("th", null, "MTU", -1 /* HOISTED */)
const _hoisted_813 = { class: "mono" }
const _hoisted_814 = { class: "mono dim" }
const _hoisted_815 = { class: "mono" }
const _hoisted_816 = { class: "dim mono" }
const _hoisted_817 = { key: 0 }
const _hoisted_818 = { class: "raw" }
const _hoisted_819 = {
  key: 1,
  class: "dim"
}
const _hoisted_820 = { class: "pill ok" }
const _hoisted_821 = { class: "dim" }
const _hoisted_822 = {
  key: 2,
  class: "dim"
}
const _hoisted_823 = { class: "pill no" }
const _hoisted_824 = { class: "dim" }
const _hoisted_825 = {
  key: 0,
  class: "raw"
}
const _hoisted_826 = {
  key: 1,
  class: "dim"
}
const _hoisted_827 = { class: "dim" }
const _hoisted_828 = { class: "dim mono" }
const _hoisted_829 = { class: "raw" }
const _hoisted_830 = {
  key: 1,
  class: "dim"
}
const _hoisted_831 = { class: "drawer-foot" }
const _hoisted_832 = ["href"]
const _hoisted_833 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_834 = { class: "modal wide" }
const _hoisted_835 = { class: "drawer-head" }
const _hoisted_836 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🛠", -1 /* HOISTED */)
const _hoisted_837 = { class: "dim" }
const _hoisted_838 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_839 = ["title", "aria-label"]
const _hoisted_840 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_841 = [
  _hoisted_840
]
const _hoisted_842 = { class: "drawer-body reg-body" }
const _hoisted_843 = {
  key: 0,
  class: "dim"
}
const _hoisted_844 = {
  key: 1,
  class: "reg-table"
}
const _hoisted_845 = { class: "reg-id" }
const _hoisted_846 = /*#__PURE__*/_createElementVNode("th", null, null, -1 /* HOISTED */)
const _hoisted_847 = ["onUpdate:modelValue", "placeholder", "disabled"]
const _hoisted_848 = { class: "type-pick" }
const _hoisted_849 = ["onUpdate:modelValue", "disabled", "aria-label"]
const _hoisted_850 = ["value"]
const _hoisted_851 = ["value"]
const _hoisted_852 = {
  key: 1,
  class: "type-own"
}
const _hoisted_853 = ["onUpdate:modelValue", "disabled", "placeholder", "aria-label", "onKeydown"]
const _hoisted_854 = ["disabled", "title", "aria-label", "onClick"]
const _hoisted_855 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M6 9l6 6 6-6" })
], -1 /* HOISTED */)
const _hoisted_856 = [
  _hoisted_855
]
const _hoisted_857 = ["onUpdate:modelValue", "disabled"]
const _hoisted_858 = { class: "reg-id mono dim" }
const _hoisted_859 = /*#__PURE__*/_createElementVNode("br", null, null, -1 /* HOISTED */)
const _hoisted_860 = ["title", "aria-label", "onClick"]
const _hoisted_861 = {
  key: 0,
  viewBox: "0 0 24 24"
}
const _hoisted_862 = /*#__PURE__*/_createElementVNode("path", { d: "M4 7h16" }, null, -1 /* HOISTED */)
const _hoisted_863 = /*#__PURE__*/_createElementVNode("path", { d: "M9 7V5h6v2" }, null, -1 /* HOISTED */)
const _hoisted_864 = /*#__PURE__*/_createElementVNode("path", { d: "M6 7l1 13h10l1-13" }, null, -1 /* HOISTED */)
const _hoisted_865 = [
  _hoisted_862,
  _hoisted_863,
  _hoisted_864
]
const _hoisted_866 = {
  key: 1,
  viewBox: "0 0 24 24"
}
const _hoisted_867 = /*#__PURE__*/_createElementVNode("path", { d: "M4 12a8 8 0 1 1 2.3 5.6" }, null, -1 /* HOISTED */)
const _hoisted_868 = /*#__PURE__*/_createElementVNode("path", { d: "M4 20v-5h5" }, null, -1 /* HOISTED */)
const _hoisted_869 = [
  _hoisted_867,
  _hoisted_868
]
const _hoisted_870 = { class: "drawer-foot" }
const _hoisted_871 = {
  key: 0,
  class: "dim"
}
const _hoisted_872 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_873 = ["disabled"]
const _hoisted_874 = { class: "modal wide" }
const _hoisted_875 = { class: "drawer-head" }
const _hoisted_876 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🧹", -1 /* HOISTED */)
const _hoisted_877 = { class: "dim" }
const _hoisted_878 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_879 = ["title", "aria-label"]
const _hoisted_880 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_881 = [
  _hoisted_880
]
const _hoisted_882 = { class: "drawer-body arp-help-body" }
const _hoisted_883 = { class: "arp-warn" }
const _hoisted_884 = { class: "dim" }
const _hoisted_885 = { class: "dim tiny" }
const _hoisted_886 = { class: "arp-code" }
const _hoisted_887 = ["title"]
const _hoisted_888 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_889 = [
  _hoisted_888
]
const _hoisted_890 = { class: "dim tiny" }
const _hoisted_891 = { class: "arp-code" }
const _hoisted_892 = ["title"]
const _hoisted_893 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_894 = [
  _hoisted_893
]
const _hoisted_895 = { class: "dim tiny" }
const _hoisted_896 = { class: "drawer-foot" }
const _hoisted_897 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_898 = { class: "modal" }
const _hoisted_899 = { class: "drawer-head" }
const _hoisted_900 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🗒️", -1 /* HOISTED */)
const _hoisted_901 = {
  key: 0,
  class: "dim"
}
const _hoisted_902 = {
  key: 1,
  class: "dim"
}
const _hoisted_903 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_904 = ["title", "aria-label"]
const _hoisted_905 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_906 = [
  _hoisted_905
]
const _hoisted_907 = { class: "drawer-body" }
const _hoisted_908 = {
  key: 0,
  class: "dim"
}
const _hoisted_909 = {
  key: 0,
  class: "dim"
}
const _hoisted_910 = {
  key: 1,
  class: "grid"
}
const _hoisted_911 = /*#__PURE__*/_createElementVNode("th", null, null, -1 /* HOISTED */)
const _hoisted_912 = { class: "pill" }
const _hoisted_913 = { class: "mono" }
const _hoisted_914 = { class: "dim" }
const _hoisted_915 = { class: "row-actions" }
const _hoisted_916 = ["onClick"]
const _hoisted_917 = ["onClick"]
const _hoisted_918 = { class: "log-typed mono" }
const _hoisted_919 = {
  key: 0,
  class: "log-said"
}
const _hoisted_920 = { class: "dim tiny" }
const _hoisted_921 = {
  key: 0,
  class: "dim"
}
const _hoisted_922 = { class: "drawer-foot" }
const _hoisted_923 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_924 = { class: "modal narrow" }
const _hoisted_925 = { class: "drawer-head" }
const _hoisted_926 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🌐", -1 /* HOISTED */)
const _hoisted_927 = { class: "dim" }
const _hoisted_928 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_929 = ["title", "aria-label"]
const _hoisted_930 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_931 = [
  _hoisted_930
]
const _hoisted_932 = { class: "drawer-body" }
const _hoisted_933 = { class: "dim" }
const _hoisted_934 = { class: "dim tiny" }
const _hoisted_935 = { class: "arp-code" }
const _hoisted_936 = ["title"]
const _hoisted_937 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_938 = [
  _hoisted_937
]
const _hoisted_939 = { class: "dim tiny" }
const _hoisted_940 = { class: "arp-code" }
const _hoisted_941 = ["title"]
const _hoisted_942 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_943 = [
  _hoisted_942
]
const _hoisted_944 = { class: "dim tiny" }
const _hoisted_945 = { class: "drawer-foot" }
const _hoisted_946 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_947 = {
  key: 7,
  class: "drawer-backdrop centred"
}
const _hoisted_948 = { class: "modal" }
const _hoisted_949 = { class: "drawer-head" }
const _hoisted_950 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "⚙", -1 /* HOISTED */)
const _hoisted_951 = { class: "dim" }
const _hoisted_952 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_953 = ["title", "aria-label"]
const _hoisted_954 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_955 = [
  _hoisted_954
]
const _hoisted_956 = { class: "drawer-body" }
const _hoisted_957 = {
  class: "set-tabs",
  role: "tablist"
}
const _hoisted_958 = ["aria-selected", "title", "onClick"]
const _hoisted_959 = { class: "ic" }
const _hoisted_960 = { class: "set-group" }
const _hoisted_961 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🎨", -1 /* HOISTED */)
const _hoisted_962 = { class: "theme-picks" }
const _hoisted_963 = ["onClick"]
const _hoisted_964 = /*#__PURE__*/_createElementVNode("i", { class: "bar" }, null, -1 /* HOISTED */)
const _hoisted_965 = /*#__PURE__*/_createElementVNode("i", { class: "line" }, null, -1 /* HOISTED */)
const _hoisted_966 = /*#__PURE__*/_createElementVNode("i", { class: "line short" }, null, -1 /* HOISTED */)
const _hoisted_967 = [
  _hoisted_964,
  _hoisted_965,
  _hoisted_966
]
const _hoisted_968 = { class: "dim" }
const _hoisted_969 = {
  key: 0,
  class: "tick"
}
const _hoisted_970 = { class: "dim tiny" }
const _hoisted_971 = { class: "fl" }
const _hoisted_972 = ["value"]
const _hoisted_973 = { value: "auto" }
const _hoisted_974 = ["value"]
const _hoisted_975 = { class: "dim tiny" }
const _hoisted_976 = { class: "set-group" }
const _hoisted_977 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🖳", -1 /* HOISTED */)
const _hoisted_978 = { class: "fl" }
const _hoisted_979 = ["value"]
const _hoisted_980 = ["label"]
const _hoisted_981 = ["value"]
const _hoisted_982 = { class: "dim tiny" }
const _hoisted_983 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_984 = { class: "fl" }
const _hoisted_985 = { class: "fl-label" }
const _hoisted_986 = { class: "admin-note" }
const _hoisted_987 = { class: "dim tiny" }
const _hoisted_988 = { class: "fl" }
const _hoisted_989 = { class: "fl-label" }
const _hoisted_990 = { class: "admin-note" }
const _hoisted_991 = { class: "shell-lang-row" }
const _hoisted_992 = { value: "" }
const _hoisted_993 = ["value"]
const _hoisted_994 = ["title", "aria-label"]
const _hoisted_995 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_996 = { class: "fl" }
const _hoisted_997 = { class: "fl-label" }
const _hoisted_998 = { class: "admin-note" }
const _hoisted_999 = { class: "dim tiny" }
const _hoisted_1000 = { class: "dim tiny" }
const _hoisted_1001 = { class: "opt" }
const _hoisted_1002 = { class: "dim tiny" }
const _hoisted_1003 = { class: "fl-row" }
const _hoisted_1004 = { class: "fl short" }
const _hoisted_1005 = { class: "fl-label" }
const _hoisted_1006 = { class: "fl short" }
const _hoisted_1007 = { class: "fl-label" }
const _hoisted_1008 = { class: "dim tiny" }
const _hoisted_1009 = { class: "dim tiny" }
const _hoisted_1010 = { class: "fl-row" }
const _hoisted_1011 = { class: "set-group" }
const _hoisted_1012 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🔑", -1 /* HOISTED */)
const _hoisted_1013 = { class: "dim tiny" }
const _hoisted_1014 = { class: "fl-row" }
const _hoisted_1015 = { class: "dim tiny" }
const _hoisted_1016 = { class: "fl" }
const _hoisted_1017 = { class: "fl-label" }
const _hoisted_1018 = { value: 1 }
const _hoisted_1019 = { value: 3 }
const _hoisted_1020 = { value: 5 }
const _hoisted_1021 = { value: 10 }
const _hoisted_1022 = { value: 30 }
const _hoisted_1023 = { value: 0 }
const _hoisted_1024 = { class: "dim tiny" }
const _hoisted_1025 = { class: "fl-row" }
const _hoisted_1026 = ["placeholder"]
const _hoisted_1027 = ["disabled"]
const _hoisted_1028 = { class: "set-group" }
const _hoisted_1029 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "☰", -1 /* HOISTED */)
const _hoisted_1030 = { class: "dim tiny" }
const _hoisted_1031 = ["disabled"]
const _hoisted_1032 = { class: "drawer-foot" }
const _hoisted_1033 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1034 = {
  key: 8,
  class: "drawer-backdrop centred"
}
const _hoisted_1035 = { class: "modal narrow" }
const _hoisted_1036 = { class: "drawer-head" }
const _hoisted_1037 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖳", -1 /* HOISTED */)
const _hoisted_1038 = { class: "dim" }
const _hoisted_1039 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1040 = ["title", "aria-label"]
const _hoisted_1041 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1042 = [
  _hoisted_1041
]
const _hoisted_1043 = { class: "drawer-body" }
const _hoisted_1044 = { class: "fl-row" }
const _hoisted_1045 = { class: "fl grow" }
const _hoisted_1046 = { class: "fl-label" }
const _hoisted_1047 = { class: "fl short" }
const _hoisted_1048 = { class: "fl-label" }
const _hoisted_1049 = { class: "fl-row" }
const _hoisted_1050 = { class: "fl grow" }
const _hoisted_1051 = { class: "fl-label" }
const _hoisted_1052 = { class: "fl short" }
const _hoisted_1053 = { class: "fl-label" }
const _hoisted_1054 = { value: "password" }
const _hoisted_1055 = { value: "key" }
const _hoisted_1056 = { class: "fl-row" }
const _hoisted_1057 = { class: "fl grow" }
const _hoisted_1058 = { class: "fl-label" }
const _hoisted_1059 = ["placeholder"]
const _hoisted_1060 = { class: "fl" }
const _hoisted_1061 = { class: "fl-label" }
const _hoisted_1062 = {
  key: 1,
  class: "fl"
}
const _hoisted_1063 = { class: "fl-label" }
const _hoisted_1064 = { class: "drawer-foot" }
const _hoisted_1065 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1066 = ["disabled"]
const _hoisted_1067 = ["onMousedown"]
const _hoisted_1068 = ["onMousedown"]
const _hoisted_1069 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🖥", -1 /* HOISTED */)
const _hoisted_1070 = { class: "nm" }
const _hoisted_1071 = { class: "dim mono tiny addr" }
const _hoisted_1072 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1073 = ["title", "aria-label", "disabled", "onClick"]
const _hoisted_1074 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M20 12H5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M12 19l-7-7 7-7" })
], -1 /* HOISTED */)
const _hoisted_1075 = [
  _hoisted_1074
]
const _hoisted_1076 = ["title", "aria-label", "onClick"]
const _hoisted_1077 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M3 10.5L12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M9.5 21.5v-8h5v8" })
], -1 /* HOISTED */)
const _hoisted_1078 = [
  _hoisted_1077
]
const _hoisted_1079 = ["title", "aria-label", "onClick"]
const _hoisted_1080 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M20.5 13.5A8.5 8.5 0 1 1 18 6.4L21.5 9.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M21.5 4v5.5H16" })
], -1 /* HOISTED */)
const _hoisted_1081 = [
  _hoisted_1080
]
const _hoisted_1082 = ["title", "aria-label", "onClick"]
const _hoisted_1083 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M14.5 3.5H20.5V9.5\"></path><path d=\"M9.5 20.5H3.5V14.5\"></path><path d=\"M20.5 3.5L13.5 10.5\"></path><path d=\"M3.5 20.5L10.5 13.5\"></path></svg>", 1)
const _hoisted_1084 = [
  _hoisted_1083
]
const _hoisted_1085 = ["title", "aria-label", "onClick"]
const _hoisted_1086 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("circle", {
    cx: "12",
    cy: "12",
    r: "9.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M9.2 9.3a2.9 2.9 0 0 1 5.7.8c0 1.9-2.9 2.4-2.9 4" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M12 17.4h.01" })
], -1 /* HOISTED */)
const _hoisted_1087 = [
  _hoisted_1086
]
const _hoisted_1088 = ["title", "aria-label", "onClick"]
const _hoisted_1089 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1090 = [
  _hoisted_1089
]
const _hoisted_1091 = ["onClick"]
const _hoisted_1092 = ["title", "onClick"]
const _hoisted_1093 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("rect", {
      x: "9",
      y: "9",
      width: "12",
      height: "12",
      rx: "2.2"
    }),
    /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
  ])
], -1 /* HOISTED */)
const _hoisted_1094 = { class: "lb" }
const _hoisted_1095 = ["title", "onClick"]
const _hoisted_1096 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M4 6.5h16\"></path><path d=\"M4 12h16\"></path><path d=\"M4 17.5h10\"></path></svg></span>", 1)
const _hoisted_1097 = { class: "lb" }
const _hoisted_1098 = ["title", "onClick"]
const _hoisted_1099 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2\"></path><rect x=\"9\" y=\"2.5\" width=\"6\" height=\"3.5\" rx=\"1\"></rect><path d=\"M8.5 12h7\"></path><path d=\"M8.5 15.5h4.5\"></path></svg></span>", 1)
const _hoisted_1100 = { class: "lb" }
const _hoisted_1101 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1102 = ["title", "onClick"]
const _hoisted_1103 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("path", { d: "M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" }),
    /*#__PURE__*/_createElementVNode("circle", {
      cx: "12",
      cy: "12.7",
      r: "3.4"
    })
  ])
], -1 /* HOISTED */)
const _hoisted_1104 = { class: "lb" }
const _hoisted_1105 = { class: "devwin-zoom" }
const _hoisted_1106 = ["title", "aria-label", "onClick"]
const _hoisted_1107 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M3.5 8.5V4.5H7.5\"></path><path d=\"M20.5 8.5V4.5H16.5\"></path><path d=\"M3.5 15.5V19.5H7.5\"></path><path d=\"M20.5 15.5V19.5H16.5\"></path></svg>", 1)
const _hoisted_1108 = [
  _hoisted_1107
]
const _hoisted_1109 = ["title", "aria-label", "disabled", "onClick"]
const _hoisted_1110 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M5 12h14" })
], -1 /* HOISTED */)
const _hoisted_1111 = [
  _hoisted_1110
]
const _hoisted_1112 = ["title", "onClick"]
const _hoisted_1113 = ["title", "aria-label", "disabled", "onClick"]
const _hoisted_1114 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M12 5v14" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M5 12h14" })
], -1 /* HOISTED */)
const _hoisted_1115 = [
  _hoisted_1114
]
const _hoisted_1116 = { class: "dim mono tiny" }
const _hoisted_1117 = {
  key: 2,
  class: "devwin-note dim"
}
const _hoisted_1118 = {
  key: 3,
  class: "devwin-note error"
}
const _hoisted_1119 = { class: "devwin-body" }
const _hoisted_1120 = ["src", "title", "data-window", "onLoad"]
const _hoisted_1121 = {
  key: 0,
  class: "devwin-loading"
}
const _hoisted_1122 = /*#__PURE__*/_createElementVNode("span", { class: "devwin-spinner" }, null, -1 /* HOISTED */)
const _hoisted_1123 = { class: "devwin-loading-text" }
const _hoisted_1124 = ["onClick"]
const _hoisted_1125 = ["onMousedown"]
const _hoisted_1126 = {
  key: 9,
  class: "drawer-backdrop centred topmost"
}
const _hoisted_1127 = { class: "modal narrow" }
const _hoisted_1128 = { class: "drawer-head" }
const _hoisted_1129 = { class: "ic big" }
const _hoisted_1130 = { class: "dim" }
const _hoisted_1131 = { class: "drawer-body" }
const _hoisted_1132 = {
  key: 0,
  class: "dim"
}
const _hoisted_1133 = {
  key: 0,
  class: "dim"
}
const _hoisted_1134 = { class: "drawer-foot" }
const _hoisted_1135 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1136 = ["disabled"]
const _hoisted_1137 = { class: "row-menu-head" }
const _hoisted_1138 = /*#__PURE__*/_createElementVNode("div", { class: "row-menu-rule" }, null, -1 /* HOISTED */)
const _hoisted_1139 = /*#__PURE__*/_createElementVNode("div", { class: "row-menu-rule" }, null, -1 /* HOISTED */)
const _hoisted_1140 = { class: "row-menu-head" }
const _hoisted_1141 = ["onClick"]
const _hoisted_1142 = { class: "ic" }
const _hoisted_1143 = {
  key: 0,
  class: "row-menu-none"
}
const _hoisted_1144 = /*#__PURE__*/_createElementVNode("li", { class: "row-menu-rule" }, null, -1 /* HOISTED */)
const _hoisted_1145 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "📋", -1 /* HOISTED */)
const _hoisted_1146 = ["onMousedown"]
const _hoisted_1147 = ["onMousedown"]
const _hoisted_1148 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "📄", -1 /* HOISTED */)
const _hoisted_1149 = { class: "nm" }
const _hoisted_1150 = { class: "dim mono tiny addr" }
const _hoisted_1151 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1152 = { class: "dim tiny" }
const _hoisted_1153 = ["title", "aria-label", "onClick"]
const _hoisted_1154 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M20.5 13.5A8.5 8.5 0 1 1 18 6.4L21.5 9.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M21.5 4v5.5H16" })
], -1 /* HOISTED */)
const _hoisted_1155 = [
  _hoisted_1154
]
const _hoisted_1156 = ["title", "aria-label", "onClick"]
const _hoisted_1157 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M14.5 3.5H20.5V9.5\"></path><path d=\"M9.5 20.5H3.5V14.5\"></path><path d=\"M20.5 3.5L13.5 10.5\"></path><path d=\"M3.5 20.5L10.5 13.5\"></path></svg>", 1)
const _hoisted_1158 = [
  _hoisted_1157
]
const _hoisted_1159 = ["title", "aria-label", "onClick"]
const _hoisted_1160 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1161 = [
  _hoisted_1160
]
const _hoisted_1162 = ["onUpdate:modelValue"]
const _hoisted_1163 = { class: "devwin-foot" }
const _hoisted_1164 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_1165 = {
  key: 1,
  class: "dim tiny"
}
const _hoisted_1166 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1167 = ["disabled", "onClick"]
const _hoisted_1168 = ["onMousedown"]
const _hoisted_1169 = ["onMousedown"]
const _hoisted_1170 = ["onMousedown"]
const _hoisted_1171 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🖳", -1 /* HOISTED */)
const _hoisted_1172 = { class: "nm" }
const _hoisted_1173 = { class: "dim mono tiny addr" }
const _hoisted_1174 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1175 = ["title", "aria-label", "onClick"]
const _hoisted_1176 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M4 7h16" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M9.5 7V4.5h5V7" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6.5 7l1 13h9l1-13" })
], -1 /* HOISTED */)
const _hoisted_1177 = [
  _hoisted_1176
]
const _hoisted_1178 = ["title", "aria-label", "onClick"]
const _hoisted_1179 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M14.5 3.5H20.5V9.5\"></path><path d=\"M9.5 20.5H3.5V14.5\"></path><path d=\"M20.5 3.5L13.5 10.5\"></path><path d=\"M3.5 20.5L10.5 13.5\"></path></svg>", 1)
const _hoisted_1180 = [
  _hoisted_1179
]
const _hoisted_1181 = ["title", "aria-label", "onClick"]
const _hoisted_1182 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1183 = [
  _hoisted_1182
]
const _hoisted_1184 = ["onClick"]
const _hoisted_1185 = ["title", "onClick"]
const _hoisted_1186 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("rect", {
      x: "9",
      y: "9",
      width: "12",
      height: "12",
      rx: "2.2"
    }),
    /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
  ])
], -1 /* HOISTED */)
const _hoisted_1187 = { class: "lb" }
const _hoisted_1188 = ["title", "onClick"]
const _hoisted_1189 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2\"></path><rect x=\"9\" y=\"2.5\" width=\"6\" height=\"3.5\" rx=\"1\"></rect><path d=\"M8.5 12h7\"></path><path d=\"M8.5 15.5h4.5\"></path></svg></span>", 1)
const _hoisted_1190 = { class: "lb" }
const _hoisted_1191 = { class: "term-menu-wrap" }
const _hoisted_1192 = ["title", "onClick"]
const _hoisted_1193 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><rect x=\"3.5\" y=\"6.5\" width=\"17\" height=\"11\" rx=\"2\"></rect><path d=\"M7.5 10.5h2\"></path><path d=\"M11.5 10.5h5\"></path><path d=\"M7.5 14h9\"></path></svg></span>", 1)
const _hoisted_1194 = { class: "lb" }
const _hoisted_1195 = ["onClick", "onContextmenu"]
const _hoisted_1196 = { class: "term-menu-head" }
const _hoisted_1197 = { class: "term-menu-keys" }
const _hoisted_1198 = ["title", "onClick"]
const _hoisted_1199 = ["title", "onClick"]
const _hoisted_1200 = ["title", "onClick"]
const _hoisted_1201 = ["title", "onClick"]
const _hoisted_1202 = ["title", "onClick"]
const _hoisted_1203 = ["title", "onClick"]
const _hoisted_1204 = ["title", "onClick"]
const _hoisted_1205 = ["title", "onClick"]
const _hoisted_1206 = ["title", "onClick"]
const _hoisted_1207 = { class: "term-sizer" }
const _hoisted_1208 = ["title", "aria-label", "disabled"]
const _hoisted_1209 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M5 12h14" })
], -1 /* HOISTED */)
const _hoisted_1210 = [
  _hoisted_1209
]
const _hoisted_1211 = { class: "term-size mono" }
const _hoisted_1212 = ["title", "aria-label", "disabled"]
const _hoisted_1213 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M12 5v14" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M5 12h14" })
], -1 /* HOISTED */)
const _hoisted_1214 = [
  _hoisted_1213
]
const _hoisted_1215 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1216 = ["title", "onClick"]
const _hoisted_1217 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("path", { d: "M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" }),
    /*#__PURE__*/_createElementVNode("circle", {
      cx: "12",
      cy: "12.7",
      r: "3.4"
    })
  ])
], -1 /* HOISTED */)
const _hoisted_1218 = { class: "lb" }
const _hoisted_1219 = ["title", "onClick"]
const _hoisted_1220 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M4 6.5h16\"></path><path d=\"M4 12h16\"></path><path d=\"M4 17.5h10\"></path></svg></span>", 1)
const _hoisted_1221 = { class: "lb" }
const _hoisted_1222 = {
  key: 2,
  class: "term-signin"
}
const _hoisted_1223 = ["onUpdate:modelValue", "placeholder", "onKeyup"]
const _hoisted_1224 = ["onUpdate:modelValue", "placeholder", "onKeyup"]
const _hoisted_1225 = ["disabled", "onClick"]
const _hoisted_1226 = { class: "dim tiny" }
const _hoisted_1227 = { class: "dim tiny" }
const _hoisted_1228 = {
  key: 0,
  class: "term-prompt"
}
const _hoisted_1229 = {
  key: 0,
  class: "term-line dim"
}
const _hoisted_1230 = {
  key: 5,
  class: "term-input"
}
const _hoisted_1231 = { class: "term-prompt mono" }
const _hoisted_1232 = ["onUpdate:modelValue", "disabled", "onKeydown"]
const _hoisted_1233 = ["onMousedown"]
const _hoisted_1234 = { class: "modal" }
const _hoisted_1235 = { class: "drawer-head" }
const _hoisted_1236 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "📂", -1 /* HOISTED */)
const _hoisted_1237 = { class: "dim tiny" }
const _hoisted_1238 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1239 = ["title", "aria-label"]
const _hoisted_1240 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1241 = [
  _hoisted_1240
]
const _hoisted_1242 = { class: "drawer-body" }
const _hoisted_1243 = { class: "path-bar" }
const _hoisted_1244 = ["disabled"]
const _hoisted_1245 = { class: "mono dim" }
const _hoisted_1246 = { class: "grid compact" }
const _hoisted_1247 = ["onClick"]
const _hoisted_1248 = ["onClick"]
const _hoisted_1249 = { class: "mono dim" }
const _hoisted_1250 = { class: "dim" }
const _hoisted_1251 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_1252 = { class: "drawer-foot" }
const _hoisted_1253 = { class: "dim tiny" }
const _hoisted_1254 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1255 = { class: "modal wide" }
const _hoisted_1256 = { class: "drawer-head" }
const _hoisted_1257 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖼", -1 /* HOISTED */)
const _hoisted_1258 = { class: "dim mono tiny" }
const _hoisted_1259 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1260 = ["href", "title", "aria-label"]
const _hoisted_1261 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M14 4h6v6" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M20 4l-8.5 8.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" })
], -1 /* HOISTED */)
const _hoisted_1262 = [
  _hoisted_1261
]
const _hoisted_1263 = ["disabled"]
const _hoisted_1264 = ["title", "aria-label"]
const _hoisted_1265 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1266 = [
  _hoisted_1265
]
const _hoisted_1267 = { class: "drawer-body preview-body" }
const _hoisted_1268 = {
  key: 0,
  class: "dim centred-text"
}
const _hoisted_1269 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_1270 = ["src", "alt"]
const _hoisted_1271 = { class: "drawer-foot" }
const _hoisted_1272 = { class: "opt" }
const _hoisted_1273 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1274 = {
  key: 15,
  class: "drawer-backdrop centred topmost"
}
const _hoisted_1275 = { class: "modal narrow" }
const _hoisted_1276 = { class: "drawer-head" }
const _hoisted_1277 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🔑", -1 /* HOISTED */)
const _hoisted_1278 = { class: "dim" }
const _hoisted_1279 = { class: "drawer-body" }
const _hoisted_1280 = { class: "dim" }
const _hoisted_1281 = ["placeholder"]
const _hoisted_1282 = { class: "drawer-foot" }
const _hoisted_1283 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1284 = ["disabled"]
const _hoisted_1285 = { class: "modal" }
const _hoisted_1286 = { class: "drawer-head" }
const _hoisted_1287 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🗄️", -1 /* HOISTED */)
const _hoisted_1288 = { class: "dim" }
const _hoisted_1289 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1290 = ["title", "aria-label"]
const _hoisted_1291 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1292 = [
  _hoisted_1291
]
const _hoisted_1293 = { class: "drawer-body" }
const _hoisted_1294 = {
  key: 0,
  class: "note-line"
}
const _hoisted_1295 = {
  key: 1,
  class: "dim"
}
const _hoisted_1296 = {
  key: 2,
  class: "note-line"
}
const _hoisted_1297 = {
  key: 3,
  class: "note-line"
}
const _hoisted_1298 = { class: "dim" }
const _hoisted_1299 = { class: "dim tiny" }
const _hoisted_1300 = { class: "fl-row" }
const _hoisted_1301 = ["placeholder"]
const _hoisted_1302 = ["disabled"]
const _hoisted_1303 = { class: "dim tiny" }
const _hoisted_1304 = {
  key: 2,
  class: "note-line"
}
const _hoisted_1305 = {
  class: "set-tabs",
  role: "tablist"
}
const _hoisted_1306 = ["aria-selected", "title", "onClick"]
const _hoisted_1307 = ["title"]
const _hoisted_1308 = {
  key: 0,
  class: "dim tiny"
}
const _hoisted_1309 = {
  key: 0,
  class: "note-line"
}
const _hoisted_1310 = { class: "fl" }
const _hoisted_1311 = { class: "fl-label" }
const _hoisted_1312 = ["value", "onChange"]
const _hoisted_1313 = { value: 0 }
const _hoisted_1314 = ["value"]
const _hoisted_1315 = { class: "fl-row" }
const _hoisted_1316 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_1317 = ["onClick"]
const _hoisted_1318 = { class: "dim tiny" }
const _hoisted_1319 = { class: "map-grid" }
const _hoisted_1320 = { class: "fl-label" }
const _hoisted_1321 = { key: 0 }
const _hoisted_1322 = ["value", "onChange"]
const _hoisted_1323 = { value: "" }
const _hoisted_1324 = ["value"]
const _hoisted_1325 = { class: "fl-row" }
const _hoisted_1326 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1327 = ["disabled", "onClick"]
const _hoisted_1328 = { class: "dim tiny" }
const _hoisted_1329 = { class: "drawer-foot" }
const _hoisted_1330 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1331 = {
  key: 17,
  class: "drawer-backdrop centred"
}
const _hoisted_1332 = { class: "modal narrow" }
const _hoisted_1333 = { class: "drawer-head" }
const _hoisted_1334 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🔗", -1 /* HOISTED */)
const _hoisted_1335 = { class: "dim" }
const _hoisted_1336 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1337 = ["title", "aria-label"]
const _hoisted_1338 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1339 = [
  _hoisted_1338
]
const _hoisted_1340 = { class: "drawer-body" }
const _hoisted_1341 = {
  key: 0,
  class: "note-line"
}
const _hoisted_1342 = {
  key: 1,
  class: "note-line"
}
const _hoisted_1343 = { class: "fl" }
const _hoisted_1344 = { class: "fl-label" }
const _hoisted_1345 = ["value"]
const _hoisted_1346 = { class: "fl" }
const _hoisted_1347 = { class: "fl-label" }
const _hoisted_1348 = ["placeholder"]
const _hoisted_1349 = { class: "fl-row" }
const _hoisted_1350 = { class: "fl grow" }
const _hoisted_1351 = { class: "fl-label" }
const _hoisted_1352 = { class: "fl short" }
const _hoisted_1353 = { class: "fl-label" }
const _hoisted_1354 = {
  key: 2,
  class: "fl"
}
const _hoisted_1355 = { class: "fl-label" }
const _hoisted_1356 = ["value"]
const _hoisted_1357 = {
  key: 3,
  class: "fl"
}
const _hoisted_1358 = { class: "fl-label" }
const _hoisted_1359 = { value: "password" }
const _hoisted_1360 = { value: "key" }
const _hoisted_1361 = { class: "fl-row" }
const _hoisted_1362 = { class: "fl grow" }
const _hoisted_1363 = { class: "fl-label" }
const _hoisted_1364 = {
  key: 0,
  class: "fl grow"
}
const _hoisted_1365 = { class: "fl-label" }
const _hoisted_1366 = {
  key: 1,
  class: "fl grow"
}
const _hoisted_1367 = { class: "fl-label" }
const _hoisted_1368 = { class: "fl" }
const _hoisted_1369 = { class: "fl-label" }
const _hoisted_1370 = { class: "with-button" }
const _hoisted_1371 = { class: "dim" }
const _hoisted_1372 = { class: "fl" }
const _hoisted_1373 = { class: "fl-label" }
const _hoisted_1374 = { class: "dim" }
const _hoisted_1375 = { class: "fl-row" }
const _hoisted_1376 = { class: "fl grow" }
const _hoisted_1377 = { class: "fl-label" }
const _hoisted_1378 = { class: "fl short" }
const _hoisted_1379 = { class: "fl-label" }
const _hoisted_1380 = { class: "fl" }
const _hoisted_1381 = { class: "fl-label" }
const _hoisted_1382 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_1383 = /*#__PURE__*/_createElementVNode("option", { value: "tls" }, "SSL/TLS", -1 /* HOISTED */)
const _hoisted_1384 = { value: "none" }
const _hoisted_1385 = {
  key: 6,
  class: "fl"
}
const _hoisted_1386 = { class: "fl-label" }
const _hoisted_1387 = {
  key: 7,
  class: "fl"
}
const _hoisted_1388 = { class: "fl-label" }
const _hoisted_1389 = {
  key: 8,
  class: "opt"
}
const _hoisted_1390 = { class: "fl" }
const _hoisted_1391 = { class: "fl-label" }
const _hoisted_1392 = {
  key: 9,
  class: "note-line"
}
const _hoisted_1393 = { class: "drawer-foot" }
const _hoisted_1394 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1395 = ["disabled"]
const _hoisted_1396 = { class: "drawer" }
const _hoisted_1397 = { class: "drawer-head" }
const _hoisted_1398 = { class: "ic big" }
const _hoisted_1399 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_1400 = ["title", "aria-label"]
const _hoisted_1401 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1402 = [
  _hoisted_1401
]
const _hoisted_1403 = ["title", "aria-label"]
const _hoisted_1404 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_1405 = [
  _hoisted_1404
]
const _hoisted_1406 = { class: "drawer-body" }
const _hoisted_1407 = { class: "kv" }
const _hoisted_1408 = { class: "kv-edit" }
const _hoisted_1409 = ["placeholder", "title"]
const _hoisted_1410 = { key: 1 }
const _hoisted_1411 = {
  key: 0,
  class: "dim"
}
const _hoisted_1412 = ["title", "aria-label"]
const _hoisted_1413 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1414 = [
  _hoisted_1413
]
const _hoisted_1415 = ["title", "aria-label"]
const _hoisted_1416 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1417 = [
  _hoisted_1416
]
const _hoisted_1418 = ["title", "aria-label"]
const _hoisted_1419 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1420 = [
  _hoisted_1419
]
const _hoisted_1421 = {
  key: 0,
  class: "dim src-tag"
}
const _hoisted_1422 = ["title", "aria-label"]
const _hoisted_1423 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1424 = [
  _hoisted_1423
]
const _hoisted_1425 = { key: 0 }
const _hoisted_1426 = ["title", "aria-label"]
const _hoisted_1427 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1428 = [
  _hoisted_1427
]
const _hoisted_1429 = ["title", "onClick"]
const _hoisted_1430 = ["title", "onClick"]
const _hoisted_1431 = { key: 2 }
const _hoisted_1432 = { key: 3 }
const _hoisted_1433 = { key: 0 }
const _hoisted_1434 = ["title", "aria-label"]
const _hoisted_1435 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1436 = [
  _hoisted_1435
]
const _hoisted_1437 = ["title", "aria-label"]
const _hoisted_1438 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1439 = [
  _hoisted_1438
]
const _hoisted_1440 = ["title", "aria-label"]
const _hoisted_1441 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1442 = [
  _hoisted_1441
]
const _hoisted_1443 = ["title", "aria-label"]
const _hoisted_1444 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1445 = [
  _hoisted_1444
]
const _hoisted_1446 = { key: 1 }
const _hoisted_1447 = /*#__PURE__*/_createElementVNode("span", null, "mDNS", -1 /* HOISTED */)
const _hoisted_1448 = ["title", "aria-label"]
const _hoisted_1449 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1450 = [
  _hoisted_1449
]
const _hoisted_1451 = { key: 2 }
const _hoisted_1452 = ["title", "aria-label"]
const _hoisted_1453 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1454 = [
  _hoisted_1453
]
const _hoisted_1455 = { key: 3 }
const _hoisted_1456 = /*#__PURE__*/_createElementVNode("span", null, "SSDP", -1 /* HOISTED */)
const _hoisted_1457 = { class: "wrap" }
const _hoisted_1458 = ["title", "aria-label"]
const _hoisted_1459 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1460 = [
  _hoisted_1459
]
const _hoisted_1461 = { class: "fl" }
const _hoisted_1462 = { class: "fl-label" }
const _hoisted_1463 = { class: "type-pick" }
const _hoisted_1464 = ["aria-label"]
const _hoisted_1465 = ["value"]
const _hoisted_1466 = ["value"]
const _hoisted_1467 = {
  key: 1,
  class: "type-own"
}
const _hoisted_1468 = ["placeholder", "aria-label"]
const _hoisted_1469 = ["title", "aria-label"]
const _hoisted_1470 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M6 9l6 6 6-6" })
], -1 /* HOISTED */)
const _hoisted_1471 = [
  _hoisted_1470
]
const _hoisted_1472 = { class: "fl" }
const _hoisted_1473 = { class: "fl-label" }
const _hoisted_1474 = {
  key: 1,
  class: "kv"
}
const _hoisted_1475 = { key: 0 }
const _hoisted_1476 = { class: "wrap" }
const _hoisted_1477 = { class: "drawer-tools" }
const _hoisted_1478 = ["onClick"]
const _hoisted_1479 = ["title", "aria-label", "onClick"]
const _hoisted_1480 = ["href", "title", "aria-label"]
const _hoisted_1481 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M14 4h6v6" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M20 4l-8.5 8.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" })
], -1 /* HOISTED */)
const _hoisted_1482 = [
  _hoisted_1481
]
const _hoisted_1483 = {
  key: 2,
  class: "away-note"
}
const _hoisted_1484 = { class: "away-cmd" }
const _hoisted_1485 = { class: "mono" }
const _hoisted_1486 = ["title", "aria-label"]
const _hoisted_1487 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1488 = [
  _hoisted_1487
]
const _hoisted_1489 = {
  key: 0,
  class: "away-act"
}
const _hoisted_1490 = { class: "hint" }
const _hoisted_1491 = { class: "drawer-tools device" }
const _hoisted_1492 = ["disabled"]
const _hoisted_1493 = ["disabled"]
const _hoisted_1494 = ["title"]
const _hoisted_1495 = ["placeholder", "aria-label"]
const _hoisted_1496 = ["aria-label"]
const _hoisted_1497 = /*#__PURE__*/_createElementVNode("option", { value: "http" }, "HTTP", -1 /* HOISTED */)
const _hoisted_1498 = /*#__PURE__*/_createElementVNode("option", { value: "https" }, "HTTPS", -1 /* HOISTED */)
const _hoisted_1499 = [
  _hoisted_1497,
  _hoisted_1498
]
const _hoisted_1500 = ["disabled"]
const _hoisted_1501 = {
  key: 3,
  class: "deep-result",
  ref: "deepResult"
}
const _hoisted_1502 = {
  key: 0,
  class: "hint"
}
const _hoisted_1503 = {
  key: 1,
  class: "kv"
}
const _hoisted_1504 = { class: "mono" }
const _hoisted_1505 = ["onClick"]
const _hoisted_1506 = { class: "drawer-foot" }
const _hoisted_1507 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)

return function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", {
    class: _normalizeClass(["layout", {'menu-open': _ctx.menu}])
  }, [
    (_ctx.menu)
      ? (_openBlock(), _createElementBlock("div", {
          key: 0,
          class: "nav-backdrop",
          onClick: _cache[0] || (_cache[0] = $event => (_ctx.menu=false))
        }))
      : _createCommentVNode("v-if", true),
    _createElementVNode("aside", {
      class: _normalizeClass(["sidebar", {open: _ctx.menu}])
    }, [
      _createElementVNode("div", _hoisted_1, [
        _hoisted_2,
        (_ctx.version)
          ? (_openBlock(), _createElementBlock("span", _hoisted_4, "v" + _toDisplayString(_ctx.version), 1 /* TEXT */))
          : _createCommentVNode("v-if", true)
      ]),
      _createElementVNode("nav", {
        class: "nav-list",
        onDragover: _cache[2] || (_cache[2] = _withModifiers(() => {}, ["prevent"])),
        onDrop: _cache[3] || (_cache[3] = _withModifiers($event => (_ctx.dropTab(null)), ["prevent"]))
      }, [
        _createCommentVNode(" One element per item, keyed on the element itself.\n             This was a <template v-for> holding the button *and* a conditional\n             <hr>, with the key on the template. One turn of the loop then\n             produced two nodes or one, and reordering left Vue unable to match\n             them up: it threw \"insertBefore: parameter 1 is not of type Node\"\n             inside its own patch, abandoned the update, and from then on\n             nothing in the sidebar redrew — the buttons below the list stopped\n             responding because the screen had stopped being updated at all.\n             The error never reached window.onerror, so it passed my checks.\n             The rule is unchanged for the reader: it is drawn by the item it\n             belongs to, in its own border, not as a node of its own. "),
        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.visibleTabs, (item) => {
          return (_openBlock(), _createElementBlock("button", {
            key: item.id,
            class: _normalizeClass(["nav-item", {active: _ctx.tab===item.id, dragged: _ctx.dragTab===item.id, over: _ctx.overTab===item.id, 'ends-group': item.id==='devices'}]),
            draggable: "true",
            title: _ctx.t('Drag to put the tools in the order you want'),
            onClick: $event => {_ctx.tab=item.id; _ctx.menu=false},
            onKeydown: $event => (_ctx.moveTabByKey(item, $event)),
            onDragstart: $event => (_ctx.startTabDrag(item, $event)),
            onDragend: _cache[1] || (_cache[1] = (...args) => (_ctx.endTabDrag && _ctx.endTabDrag(...args))),
            onDragover: _withModifiers($event => (_ctx.overTab = item.id), ["prevent"]),
            onDragleave: $event => (_ctx.overTab === item.id && (_ctx.overTab = '')),
            onDrop: _withModifiers($event => (_ctx.dropTab(item)), ["prevent","stop"])
          }, [
            _createElementVNode("span", {
              class: "ic",
              innerHTML: _ctx.tabIcon(item.id)
            }, null, 8 /* PROPS */, _hoisted_6),
            _createElementVNode("span", _hoisted_7, _toDisplayString(_ctx.t(item.label)), 1 /* TEXT */),
            (item.id==='devices' && _ctx.devices.length)
              ? (_openBlock(), _createElementBlock("span", _hoisted_8, _toDisplayString(_ctx.onlineCount), 1 /* TEXT */))
              : _createCommentVNode("v-if", true),
            _hoisted_9
          ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_5))
        }), 128 /* KEYED_FRAGMENT */))
      ], 32 /* NEED_HYDRATION */),
      _createElementVNode("div", _hoisted_10, [
        _createCommentVNode(" The device list carries its own Start button, so this one would only\n             repeat it. It stays for the rare account that may sweep the network\n             without being allowed to see the result, which would otherwise have\n             no way to begin. "),
        (_ctx.status.canScan && !_ctx.allowed('devices'))
          ? (_openBlock(), _createElementBlock("button", {
              key: 0,
              class: "btn primary block",
              disabled: _ctx.scanning,
              onClick: _cache[4] || (_cache[4] = $event => {_ctx.menu=false; _ctx.startScan()})
            }, _toDisplayString(_ctx.scanning ? _ctx.t('Scanning…') : _ctx.t('🛰️ Scan the network')), 9 /* TEXT, PROPS */, _hoisted_11))
          : _createCommentVNode("v-if", true),
        (_ctx.status.isAdmin)
          ? (_openBlock(), _createElementBlock("button", {
              key: 1,
              class: _normalizeClass(["btn sm block", {working: _ctx.shellBusy}]),
              disabled: _ctx.shellBusy || (_ctx.status.localShell && !_ctx.status.localShell.available),
              title: _ctx.status.localShell && !_ctx.status.localShell.available ? _ctx.t('A local shell needs proc_open and python3 on this server, and they are not both available here.') : _ctx.t('A terminal on this server, running with the same privileges as Nextcloud (the {user} account) — no more. For administrators only.', { user: 'www-data' }),
              onClick: _cache[5] || (_cache[5] = $event => {_ctx.menu=false; _ctx.beginShell()})
            }, "🖳 " + _toDisplayString(_ctx.t('Open a shell')), 11 /* TEXT, CLASS, PROPS */, _hoisted_12))
          : _createCommentVNode("v-if", true),
        (_ctx.status.isAdmin)
          ? (_openBlock(), _createElementBlock("button", {
              key: 2,
              class: "btn sm block",
              onClick: _cache[6] || (_cache[6] = $event => {_ctx.menu=false; _ctx.openSysInfo()})
            }, _toDisplayString(_ctx.t('🖥 System information')), 1 /* TEXT */))
          : _createCommentVNode("v-if", true),
        _createElementVNode("button", {
          class: "btn sm block",
          onClick: _cache[7] || (_cache[7] = $event => {_ctx.menu=false; _ctx.settingTab = 'look'; _ctx.themeBox = true})
        }, _toDisplayString(_ctx.t('⚙ Settings')), 1 /* TEXT */)
      ])
    ], 2 /* CLASS */),
    _createElementVNode("main", _hoisted_13, [
      _createElementVNode("div", _hoisted_14, [
        _createCommentVNode(" On a phone the tool list is a drawer, and this is its handle. "),
        _createElementVNode("button", {
          class: "btn sm menu-btn",
          title: _ctx.t('The list of tools'),
          "aria-label": _ctx.t('The list of tools'),
          onClick: _cache[8] || (_cache[8] = $event => (_ctx.menu = !_ctx.menu))
        }, "☰", 8 /* PROPS */, _hoisted_15),
        _createElementVNode("div", _hoisted_16, [
          _createElementVNode("span", _hoisted_17, _toDisplayString(_ctx.currentTab.icon), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_18, _toDisplayString(_ctx.t(_ctx.currentTab.label)), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_19, _toDisplayString(_ctx.t(_ctx.currentTab.hint)), 1 /* TEXT */)
        ]),
        _hoisted_20,
        _createElementVNode("div", _hoisted_21, [
          _createCommentVNode(" What belongs to this tab alone. On a phone it takes a line of its\n               own, so the buttons every tab has keep their place beside the title. "),
          (_ctx.tab==='devices')
            ? (_openBlock(), _createElementBlock("div", _hoisted_22, [
                _withDirectives(_createElementVNode("input", {
                  class: "filter",
                  "onUpdate:modelValue": _cache[9] || (_cache[9] = $event => ((_ctx.filter) = $event)),
                  placeholder: _ctx.t('Filter by name, IP, MAC or vendor')
                }, null, 8 /* PROPS */, _hoisted_23), [
                  [_vModelText, _ctx.filter]
                ]),
                _createElementVNode("label", {
                  class: "switch",
                  title: _ctx.t('On: only devices seen in the last scan. Off: every device on record.')
                }, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[10] || (_cache[10] = $event => ((_ctx.onlyOnline) = $event))
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.onlyOnline]
                  ]),
                  _hoisted_25,
                  _createElementVNode("span", _hoisted_26, _toDisplayString(_ctx.t('Online only')), 1 /* TEXT */)
                ], 8 /* PROPS */, _hoisted_24),
                (_ctx.allowed('scan'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 0,
                      class: "btn sm keep",
                      title: _ctx.t('Edit the devices you have named, all in one place'),
                      onClick: _cache[11] || (_cache[11] = (...args) => (_ctx.openRegEditor && _ctx.openRegEditor(...args)))
                    }, [
                      _hoisted_28,
                      _createElementVNode("span", _hoisted_29, _toDisplayString(_ctx.t('Edit named')), 1 /* TEXT */)
                    ], 8 /* PROPS */, _hoisted_27))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("button", {
                  class: "btn sm keep",
                  title: _ctx.t('Download what this tool found'),
                  onClick: _cache[12] || (_cache[12] = (...args) => (_ctx.exportCsv && _ctx.exportCsv(...args))),
                  disabled: !_ctx.shownDevices.length
                }, _hoisted_33, 8 /* PROPS */, _hoisted_30)
              ]))
            : _createCommentVNode("v-if", true),
          _createCommentVNode(" Whatever this tool has found: onto the clipboard, into a file, or\n               into the person's own Nextcloud folder. "),
          _createElementVNode("button", {
            class: "btn sm keep",
            title: _ctx.t('Copy what this tool found'),
            disabled: !_ctx.hasResult,
            onClick: _cache[13] || (_cache[13] = (...args) => (_ctx.copyResult && _ctx.copyResult(...args)))
          }, [
            _hoisted_35,
            _createElementVNode("span", _hoisted_36, _toDisplayString(_ctx.t('Copy')), 1 /* TEXT */)
          ], 8 /* PROPS */, _hoisted_34),
          _createElementVNode("button", {
            class: "btn sm keep",
            title: _ctx.t('Download what this tool found'),
            disabled: !_ctx.hasResult,
            onClick: _cache[14] || (_cache[14] = (...args) => (_ctx.downloadResult && _ctx.downloadResult(...args)))
          }, [
            _hoisted_38,
            _createElementVNode("span", _hoisted_39, _toDisplayString(_ctx.t('Download as a file')), 1 /* TEXT */)
          ], 8 /* PROPS */, _hoisted_37),
          _createElementVNode("button", {
            class: "btn sm keep",
            title: _ctx.t('Save it to your Nextcloud files'),
            disabled: !_ctx.hasResult,
            onClick: _cache[15] || (_cache[15] = (...args) => (_ctx.saveResultToFiles && _ctx.saveResultToFiles(...args)))
          }, [
            _createCommentVNode(" \"Save\" on its own sat in the same screen as the Save inside a\n                 text window, and somebody pressed this one meaning that one and\n                 got a report written into their files. It says what it saves. "),
            _hoisted_41,
            _createElementVNode("span", _hoisted_42, _toDisplayString(_ctx.t('Save the result')), 1 /* TEXT */)
          ], 8 /* PROPS */, _hoisted_40)
        ])
      ]),
      _createElementVNode("div", _hoisted_43, [
        _createCommentVNode(" One \"working\" bar for every tool: a stripe slides across the top of\n             the panel whenever any request is in flight, so an operation with no\n             count of its own (whois, TLS, DNS, mail, SSH…) still shows it is running. "),
        _createElementVNode("div", {
          class: _normalizeClass(["global-busy", {on: _ctx.anyBusy}]),
          role: "progressbar",
          "aria-label": _ctx.t('Working…')
        }, _hoisted_46, 10 /* CLASS, PROPS */, _hoisted_44),
        (_ctx.banner)
          ? (_openBlock(), _createElementBlock("div", {
              key: 0,
              class: _normalizeClass(["banner", _ctx.banner.kind])
            }, [
              _createElementVNode("span", null, _toDisplayString(_ctx.banner.text), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[16] || (_cache[16] = $event => (_ctx.banner=null))
              }, _hoisted_49, 8 /* PROPS */, _hoisted_47)
            ], 2 /* CLASS */))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ devices ============ "),
        (_ctx.tab==='devices')
          ? (_openBlock(), _createElementBlock("section", _hoisted_50, [
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_51, [
                    _createCommentVNode(" What is being scanned, before anything about how. The two are\n                 different jobs: one walks every address in the network, the\n                 other starts from what this server has already met. "),
                    _createElementVNode("div", _hoisted_52, [
                      _createElementVNode("span", _hoisted_53, _toDisplayString(_ctx.t('What to scan')), 1 /* TEXT */),
                      _createElementVNode("label", {
                        title: _ctx.t('Starts from the ARP table and what announces itself, instead of walking every address. Seconds rather than minutes, and everything found is still asked for its name and its open ports — but a device that has never spoken to this server and does not announce itself will not be found.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "radio",
                          value: "arp",
                          "onUpdate:modelValue": _cache[17] || (_cache[17] = $event => ((_ctx.scanWhat) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelRadio, _ctx.scanWhat]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('The ARP table only')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_54),
                      _createElementVNode("label", {
                        title: _ctx.t('Walks every address in the networks below. Thorough, and the slow one.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "radio",
                          value: "network",
                          "onUpdate:modelValue": _cache[18] || (_cache[18] = $event => ((_ctx.scanWhat) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelRadio, _ctx.scanWhat]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('The whole network')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_55)
                    ]),
                    _createElementVNode("div", _hoisted_56, [
                      (_ctx.scanWhat === 'network')
                        ? (_openBlock(), _createElementBlock("label", {
                            key: 0,
                            class: "fl",
                            title: _ctx.t('Which networks to look at. Left blank, it uses the ones this server is on. Several can be given, separated by commas.')
                          }, [
                            _createElementVNode("span", _hoisted_58, _toDisplayString(_ctx.t('Networks to scan')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[19] || (_cache[19] = $event => ((_ctx.scanTargets) = $event)),
                              placeholder: _ctx.suggestedPlaceholder
                            }, null, 8 /* PROPS */, _hoisted_59), [
                              [_vModelText, _ctx.scanTargets]
                            ])
                          ], 8 /* PROPS */, _hoisted_57))
                        : _createCommentVNode("v-if", true),
                      _createCommentVNode(" Two different things, named as the two different things they\n                   are. This one walks the addresses; the wait beneath is what a\n                   port that says nothing costs, and it is the wait, not this,\n                   that decides how long a long scan takes. "),
                      (_ctx.scanWhat === 'network')
                        ? (_openBlock(), _createElementBlock("label", {
                            key: 1,
                            class: "fl narrow pace",
                            title: _ctx.t('How quickly the addresses are walked through. A slower speed finds more Wi-Fi devices, because a wireless network carries broadcasts slowly: on a /16 with ten devices, 15,000 a second found six of them and 1,500 found all ten.')
                          }, [
                            _createElementVNode("span", _hoisted_61, _toDisplayString(_ctx.t('Scan speed')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[20] || (_cache[20] = $event => ((_ctx.pace) = $event))
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.paceRates, (r) => {
                                return (_openBlock(), _createElementBlock("option", {
                                  key: r,
                                  value: String(r)
                                }, _toDisplayString(_ctx.paceLabel(r)), 9 /* TEXT, PROPS */, _hoisted_62))
                              }), 128 /* KEYED_FRAGMENT */))
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.pace]
                            ])
                          ], 8 /* PROPS */, _hoisted_60))
                        : _createCommentVNode("v-if", true),
                      _createCommentVNode(" Two buttons for two jobs. The first re-checks which devices\n                   are online and is fast because it skips the ports; the second\n                   is the full sweep that also reads each device's open ports.\n                   The per-device \"every port\" search lives in a device's own\n                   properties, and stays there. "),
                      (!_ctx.scanning)
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                            _createElementVNode("button", {
                              class: "btn primary",
                              onClick: _cache[21] || (_cache[21] = $event => (_ctx.startScan({ ports: false }))),
                              title: _ctx.t('Finds devices and rechecks which are online. Does not scan ports, so it is fast.')
                            }, _toDisplayString(_ctx.t('Refresh devices')), 9 /* TEXT, PROPS */, _hoisted_63),
                            _createElementVNode("button", {
                              class: "btn",
                              onClick: _cache[22] || (_cache[22] = $event => (_ctx.startScan({ ports: true, names: false, multicast: false, rdns: false, arpOnly: true }))),
                              title: _ctx.t('Checks the open ports of the devices already found, without repeating the name and multicast discovery a refresh does.')
                            }, _toDisplayString(_ctx.t('Port scan')), 9 /* TEXT, PROPS */, _hoisted_64),
                            _createCommentVNode(" Clearing the neighbour (ARP) table needs privileges NetBase does\n                     not have; the button only works once an administrator installs a\n                     small helper, and the ? explains how. "),
                            _createElementVNode("span", _hoisted_65, [
                              _createElementVNode("button", {
                                class: _normalizeClass(["btn", {working: _ctx.busy.arpflush}]),
                                disabled: !(_ctx.status.arpFlush && _ctx.status.arpFlush.available) || _ctx.busy.arpflush,
                                onClick: _cache[23] || (_cache[23] = (...args) => (_ctx.clearArp && _ctx.clearArp(...args))),
                                title: _ctx.t('Forget every remembered address so a refresh shows only what answers now. Stale entries (a device switched off) disappear. Needs a helper an administrator installs.')
                              }, _toDisplayString(_ctx.t('Clear the ARP table')), 11 /* TEXT, CLASS, PROPS */, _hoisted_66),
                              (!(_ctx.status.arpFlush && _ctx.status.arpFlush.available))
                                ? (_openBlock(), _createElementBlock("button", {
                                    key: 0,
                                    class: "btn xs ib arp-help-btn",
                                    title: _ctx.t('How to switch this on'),
                                    "aria-label": _ctx.t('How to switch this on'),
                                    onClick: _cache[24] || (_cache[24] = $event => (_ctx.arpHelp = true))
                                  }, "?", 8 /* PROPS */, _hoisted_67))
                                : _createCommentVNode("v-if", true)
                            ])
                          ], 64 /* STABLE_FRAGMENT */))
                        : (_openBlock(), _createElementBlock("button", _hoisted_68, _toDisplayString(_ctx.t('Scanning…')), 1 /* TEXT */)),
                      (_ctx.scanning)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 4,
                            class: "btn",
                            onClick: _cache[25] || (_cache[25] = (...args) => (_ctx.cancelScan && _ctx.cancelScan(...args)))
                          }, _toDisplayString(_ctx.t('Stop')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createCommentVNode(" The four steps of a scan, in the order they happen, so the row\n                 reads as what the scan is about to do. "),
                    _createElementVNode("div", _hoisted_69, [
                      _createElementVNode("label", {
                        title: _ctx.t('Asks each address for its own name, over NetBIOS and mDNS.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[26] || (_cache[26] = $event => ((_ctx.opts.names) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.names]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Ask devices for their names')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_70),
                      _createElementVNode("label", {
                        title: _ctx.t('Listens for the devices that announce themselves — mDNS, WS-Discovery and SSDP. It finds devices the sweep missed.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[27] || (_cache[27] = $event => ((_ctx.opts.multicast) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.multicast]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Multicast discovery')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_71),
                      _createElementVNode("label", {
                        title: _ctx.t('Asks the DNS server what name it has on record for each address.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[28] || (_cache[28] = $event => ((_ctx.opts.rdns) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.rdns]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Reverse DNS')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_72)
                    ]),
                    _createCommentVNode(" The settings for the \"Port scan\" button, kept under the row so\n                 a depth can be chosen before it is pressed. They do nothing for\n                 \"Refresh devices\", which never scans ports. "),
                    _createElementVNode("div", _hoisted_73, [
                      _createElementVNode("span", _hoisted_74, _toDisplayString(_ctx.t('Port scan')), 1 /* TEXT */),
                      _createElementVNode("label", {
                        title: _ctx.t('How many ports to try on each device.')
                      }, [
                        _createElementVNode("span", _hoisted_76, _toDisplayString(_ctx.t('Ports to try')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[29] || (_cache[29] = $event => ((_ctx.opts.portScan) = $event))
                        }, [
                          _createElementVNode("option", _hoisted_77, _toDisplayString(_ctx.t('Common ports')) + " (" + _toDisplayString(_ctx.portCount('common')) + ")", 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_78, _toDisplayString(_ctx.t('Detailed search')) + " (" + _toDisplayString(_ctx.portCount('detailed')) + ")", 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_79, _toDisplayString(_ctx.t('Well-known ports')) + " (" + _toDisplayString(_ctx.portCount('wellKnown')) + ")", 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_80, _toDisplayString(_ctx.t('High ports')) + " (" + _toDisplayString(_ctx.portCount('high')) + ")", 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_81, _toDisplayString(_ctx.t('Every port')) + " (" + _toDisplayString(_ctx.portCount('all')) + ")", 1 /* TEXT */)
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.opts.portScan]
                        ])
                      ], 8 /* PROPS */, _hoisted_75),
                      _createCommentVNode(" The number that actually decides how long this takes. "),
                      _createElementVNode("label", {
                        title: _ctx.t('How long to wait for a port to answer. A port that refuses is instant whatever this is; the wait only applies to one that says nothing at all, which is what a firewall and a sleeping device both look like. Waiting less is quicker and misses more.')
                      }, [
                        _createElementVNode("span", _hoisted_83, _toDisplayString(_ctx.t('Wait for an answer')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[30] || (_cache[30] = $event => ((_ctx.opts.portWait) = $event))
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.portWaits, (w) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: w,
                              value: w
                            }, _toDisplayString(_ctx.waitLabel(w)), 9 /* TEXT, PROPS */, _hoisted_84))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [
                            _vModelSelect,
                            _ctx.opts.portWait,
                            void 0,
                            { number: true }
                          ]
                        ])
                      ], 8 /* PROPS */, _hoisted_82)
                    ]),
                    (_ctx.scanning && _ctx.scan)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_85, [
                          _createElementVNode("div", _hoisted_86, [
                            _createElementVNode("span", _hoisted_87, _toDisplayString(_ctx.phaseLabel(_ctx.scan)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("div", {
                            class: _normalizeClass(["bar", { waiting: _ctx.phaseWaiting(_ctx.scan) }])
                          }, [
                            (!_ctx.phaseWaiting(_ctx.scan))
                              ? (_openBlock(), _createElementBlock("div", {
                                  key: 0,
                                  class: "fill",
                                  style: _normalizeStyle({width: _ctx.scan.percent + '%'})
                                }, null, 4 /* STYLE */))
                              : _createCommentVNode("v-if", true)
                          ], 2 /* CLASS */),
                          _createElementVNode("div", _hoisted_88, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.progressText(_ctx.scan)), 1 /* TEXT */),
                            _hoisted_89,
                            (!_ctx.phaseWaiting(_ctx.scan))
                              ? (_openBlock(), _createElementBlock("span", _hoisted_90, _toDisplayString(_ctx.scan.percent) + "%", 1 /* TEXT */))
                              : _createCommentVNode("v-if", true)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.advice && !_ctx.advice.ok)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_91, [
                          _createTextVNode(" ⚠ " + _toDisplayString(_ctx.t('This target has {hosts} addresses but the kernel ARP table holds {gc3}. The sweep still works, but the kernel will log overflow warnings. To avoid that, an administrator can run:', { hosts: _ctx.advice.hosts, gc3: _ctx.advice.gc3 })) + " ", 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(_ctx.advice.advice), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (!_ctx.shownDevices.length)
                ? (_openBlock(), _createElementBlock("div", _hoisted_92, _toDisplayString(_ctx.allowed('scan') ? _ctx.t('No devices recorded yet. Start a scan to build the list.') : _ctx.t('No devices have been recorded yet. An administrator has to run a scan first.')), 1 /* TEXT */))
                : (_openBlock(), _createElementBlock("table", _hoisted_93, [
                    _createElementVNode("thead", null, [
                      _createElementVNode("tr", null, [
                        _hoisted_94,
                        _createCommentVNode(" The header mirrors a row: the name on top, then the address\n                     line's fields (IPv4, MAC, vendor) beneath, each one its own\n                     sort with an arrow showing the direction. "),
                        _createElementVNode("th", _hoisted_95, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line head", _ctx.sortClass('name')]),
                            onClick: _cache[31] || (_cache[31] = $event => (_ctx.sortBy('name'))),
                            title: _ctx.t('The name a device reports over NetBIOS, mDNS or reverse DNS. A name you type yourself is shown instead when set.')
                          }, _toDisplayString(_ctx.t('Name')), 11 /* TEXT, CLASS, PROPS */, _hoisted_96),
                          _createElementVNode("span", _hoisted_97, [
                            _createElementVNode("span", {
                              class: _normalizeClass(["th-line", _ctx.sortClass('ip')]),
                              onClick: _cache[32] || (_cache[32] = $event => (_ctx.sortBy('ip')))
                            }, _toDisplayString(_ctx.t('IPv4')), 3 /* TEXT, CLASS */),
                            _hoisted_98,
                            _createElementVNode("span", {
                              class: _normalizeClass(["th-line", _ctx.sortClass('mac')]),
                              onClick: _cache[33] || (_cache[33] = $event => (_ctx.sortBy('mac')))
                            }, _toDisplayString(_ctx.t('MAC address')), 3 /* TEXT, CLASS */),
                            _hoisted_99,
                            _createElementVNode("span", {
                              class: _normalizeClass(["th-line", _ctx.sortClass('vendor')]),
                              onClick: _cache[34] || (_cache[34] = $event => (_ctx.sortBy('vendor')))
                            }, _toDisplayString(_ctx.t('Vendor')), 3 /* TEXT, CLASS */),
                            _hoisted_100,
                            _createElementVNode("span", _hoisted_101, _toDisplayString(_ctx.t('Open ports')), 1 /* TEXT */)
                          ])
                        ]),
                        _createElementVNode("th", _hoisted_102, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line head", _ctx.sortClass('type')]),
                            onClick: _cache[35] || (_cache[35] = $event => (_ctx.sortBy('type')))
                          }, _toDisplayString(_ctx.t('Type')), 3 /* TEXT, CLASS */)
                        ]),
                        _createElementVNode("th", _hoisted_103, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line head", _ctx.sortClass('lastSeen')]),
                            onClick: _cache[36] || (_cache[36] = $event => (_ctx.sortBy('lastSeen')))
                          }, _toDisplayString(_ctx.t('Last seen')), 3 /* TEXT, CLASS */)
                        ])
                      ])
                    ]),
                    _createElementVNode("tbody", null, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.deviceGroups, (g) => {
                        return (_openBlock(), _createElementBlock("tr", {
                          key: g.key,
                          onClick: $event => (_ctx.openDevice(g.rep)),
                          onContextmenu: _withModifiers($event => (_ctx.openRowMenu(g.rep, $event)), ["prevent"]),
                          class: _normalizeClass({offline: !g.online})
                        }, [
                          _createElementVNode("td", _hoisted_105, [
                            _createElementVNode("span", {
                              class: _normalizeClass(["dot", {on: g.online}]),
                              title: g.online ? _ctx.t('Online') : _ctx.t('Not seen in the last sweep')
                            }, null, 10 /* CLASS, PROPS */, _hoisted_106)
                          ]),
                          _createElementVNode("td", _hoisted_107, [
                            _createElementVNode("div", _hoisted_108, [
                              _createElementVNode("span", _hoisted_109, _toDisplayString(_ctx.icon(g.rep)), 1 /* TEXT */),
                              _createElementVNode("span", {
                                class: _normalizeClass(["nm", {unnamed: !_ctx.listName(g.rep).named}])
                              }, _toDisplayString(_ctx.listName(g.rep).text), 3 /* TEXT, CLASS */),
                              (g.isSelf)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_110, _toDisplayString(_ctx.t('this server')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true),
                              (g.rep.label)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_111, _toDisplayString(_ctx.t('named')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]),
                            _createCommentVNode(" Ports belong to the address they are open on, so they sit\n                       on each address line and open a window on THAT IP — a\n                       device with several addresses shows each one's ports. "),
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(g.members, (m, mi) => {
                              return (_openBlock(), _createElementBlock("div", {
                                key: m.id,
                                class: _normalizeClass(["addr-line mono", {'addr-off': !m.online, 'addr-sep': mi > 0}])
                              }, [
                                _createElementVNode("span", _hoisted_112, [
                                  (_ctx.netBadge(m))
                                    ? (_openBlock(), _createElementBlock("span", {
                                        key: 0,
                                        class: _normalizeClass(["badge", _ctx.netRank(m) >= 1 ? 'secondary' : 'away']),
                                        title: _ctx.netTitle(m)
                                      }, _toDisplayString(_ctx.netBadge(m)), 11 /* TEXT, CLASS, PROPS */, _hoisted_113))
                                    : _createCommentVNode("v-if", true)
                                ]),
                                _createElementVNode("span", _hoisted_114, [
                                  _createTextVNode(_toDisplayString(m.ip), 1 /* TEXT */),
                                  (_ctx.cidrBitsFor(m))
                                    ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                                        _createTextVNode("/" + _toDisplayString(_ctx.cidrBitsFor(m)), 1 /* TEXT */)
                                      ], 64 /* STABLE_FRAGMENT */))
                                    : _createCommentVNode("v-if", true)
                                ]),
                                _createElementVNode("span", _hoisted_115, _toDisplayString(m.mac || '—'), 1 /* TEXT */),
                                _createElementVNode("span", {
                                  class: "addr-vendor dim",
                                  title: _ctx.macVendor(m)
                                }, _toDisplayString(_ctx.macVendor(m) ? '(' + _ctx.macVendor(m) + ')' : ''), 9 /* TEXT, PROPS */, _hoisted_116),
                                (m.ports && m.ports.length)
                                  ? (_openBlock(), _createElementBlock("span", {
                                      key: 0,
                                      class: "addr-ports dim",
                                      onClick: _cache[37] || (_cache[37] = _withModifiers(() => {}, ["stop"]))
                                    }, [
                                      _createElementVNode("span", _hoisted_117, _toDisplayString(_ctx.t('ports')), 1 /* TEXT */),
                                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(m.ports, (p, i) => {
                                        return (_openBlock(), _createElementBlock(_Fragment, { key: p }, [
                                          (_ctx.portLink(m, p))
                                            ? (_openBlock(), _createElementBlock("a", {
                                                key: 0,
                                                href: "#",
                                                title: _ctx.portLink(m, p).title,
                                                onClick: _withModifiers($event => (_ctx.openDeviceWindow(m, p)), ["prevent"])
                                              }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_118))
                                            : (_ctx.portTool(m, p))
                                              ? (_openBlock(), _createElementBlock("a", {
                                                  key: 1,
                                                  href: "#",
                                                  title: _ctx.portTool(m, p).title,
                                                  onClick: _withModifiers($event => (_ctx.openPortTool(m, p)), ["prevent"])
                                                }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_119))
                                              : (_openBlock(), _createElementBlock("span", _hoisted_120, _toDisplayString(p), 1 /* TEXT */)),
                                          (i < m.ports.length - 1)
                                            ? (_openBlock(), _createElementBlock("span", _hoisted_121, ", "))
                                            : _createCommentVNode("v-if", true)
                                        ], 64 /* STABLE_FRAGMENT */))
                                      }), 128 /* KEYED_FRAGMENT */))
                                    ]))
                                  : _createCommentVNode("v-if", true)
                              ], 2 /* CLASS */))
                            }), 128 /* KEYED_FRAGMENT */)),
                            (g.rep.notes)
                              ? (_openBlock(), _createElementBlock("div", {
                                  key: 0,
                                  class: "pair-note",
                                  title: g.rep.notes
                                }, "📝 " + _toDisplayString(g.rep.notes), 9 /* TEXT, PROPS */, _hoisted_122))
                              : _createCommentVNode("v-if", true)
                          ]),
                          _createElementVNode("td", _hoisted_123, [
                            _createElementVNode("div", _hoisted_124, _toDisplayString(_ctx.typeText(g.rep.type)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("td", _hoisted_125, _toDisplayString(_ctx.ago(g.lastSeen)), 1 /* TEXT */)
                        ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_104))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ dns ============ "),
        (_ctx.tab==='dns')
          ? (_openBlock(), _createElementBlock("section", _hoisted_126, [
              _createElementVNode("div", _hoisted_127, [
                _createElementVNode("div", _hoisted_128, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsViews, (v) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: v.id,
                      class: _normalizeClass(["seg-btn", {active: _ctx.dnsView===v.id}]),
                      onClick: $event => (_ctx.dnsView=v.id)
                    }, _toDisplayString(_ctx.t(v.label)), 11 /* TEXT, CLASS, PROPS */, _hoisted_129))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.dnsView==='records')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_130, [
                      _createElementVNode("div", _hoisted_131, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[38] || (_cache[38] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[39] || (_cache[39] = _withKeys((...args) => (_ctx.runDns && _ctx.runDns(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_132), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.dns}]),
                          disabled: _ctx.busy.dns,
                          onClick: _cache[40] || (_cache[40] = (...args) => (_ctx.runDns && _ctx.runDns(...args)))
                        }, _toDisplayString(_ctx.t('Look up')), 11 /* TEXT, CLASS, PROPS */, _hoisted_133)
                      ]),
                      _createElementVNode("div", _hoisted_134, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsTypes, (ty) => {
                          return (_openBlock(), _createElementBlock("label", { key: ty }, [
                            _withDirectives(_createElementVNode("input", {
                              type: "checkbox",
                              value: ty,
                              "onUpdate:modelValue": _cache[41] || (_cache[41] = $event => ((_ctx.dnsWanted) = $event))
                            }, null, 8 /* PROPS */, _hoisted_135), [
                              [_vModelCheckbox, _ctx.dnsWanted]
                            ]),
                            _createTextVNode(" " + _toDisplayString(ty), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_ctx.dnsResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_136, [
                          _createElementVNode("table", _hoisted_137, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('TTL')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Value')), 1 /* TEXT */)
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsResult.records, (r, i) => {
                                return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                  _createElementVNode("td", _hoisted_138, _toDisplayString(r.type), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_139, _toDisplayString(r.ttl), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_140, _toDisplayString(r.value), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (!_ctx.dnsResult.records.length)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_141, _toDisplayString(_ctx.t('No records returned.')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.dnsResult.analysis && (_ctx.dnsResult.analysis.spf || _ctx.dnsResult.analysis.dmarc))
                            ? (_openBlock(), _createElementBlock("div", _hoisted_142, [
                                (_ctx.dnsResult.analysis.spf)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_143, [
                                      _hoisted_144,
                                      _createElementVNode("code", null, _toDisplayString(_ctx.dnsResult.analysis.spf), 1 /* TEXT */)
                                    ]))
                                  : _createCommentVNode("v-if", true),
                                (_ctx.dnsResult.analysis.dmarc)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_145, [
                                      _hoisted_146,
                                      _createElementVNode("code", null, _toDisplayString(_ctx.dnsResult.analysis.dmarc), 1 /* TEXT */)
                                    ]))
                                  : _createCommentVNode("v-if", true)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.dnsView==='advanced')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                    _createElementVNode("div", _hoisted_147, [
                      _createElementVNode("div", _hoisted_148, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[42] || (_cache[42] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[43] || (_cache[43] = _withKeys((...args) => (_ctx.runDnsQuery && _ctx.runDnsQuery(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_149), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[44] || (_cache[44] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_150))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[45] || (_cache[45] = $event => ((_ctx.dnsServer) = $event)),
                          class: "short"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.knownResolvers, (r) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: r.host || 'self',
                              value: r.host
                            }, _toDisplayString(r.host ? r.host + ' — ' + r.label : _ctx.t('This server')), 9 /* TEXT, PROPS */, _hoisted_151))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsServer]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[46] || (_cache[46] = $event => ((_ctx.dnsServer) = $event)),
                          class: "short",
                          placeholder: _ctx.t('Resolver (blank = this server)')
                        }, null, 8 /* PROPS */, _hoisted_152), [
                          [_vModelText, _ctx.dnsServer]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.dnsq}]),
                          disabled: _ctx.busy.dnsq,
                          onClick: _cache[47] || (_cache[47] = (...args) => (_ctx.runDnsQuery && _ctx.runDnsQuery(...args)))
                        }, _toDisplayString(_ctx.t('Ask')), 11 /* TEXT, CLASS, PROPS */, _hoisted_153)
                      ]),
                      _createElementVNode("label", _hoisted_154, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[48] || (_cache[48] = $event => ((_ctx.dnsDnssec) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.dnsDnssec]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Ask the resolver to validate DNSSEC')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("p", _hoisted_155, _toDisplayString(_ctx.t('Any record type, from any resolver — NetBase speaks DNS itself instead of going through PHP.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsQueryResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_156, [
                          _createElementVNode("div", _hoisted_157, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Status')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.dnsQueryResult.status === 'NOERROR' ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.dnsQueryResult.status), 3 /* TEXT, CLASS */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Answered by')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.dnsQueryResult.server) + " · " + _toDisplayString(_ctx.dnsQueryResult.ms) + " ms", 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Flags')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.dnsFlags(_ctx.dnsQueryResult)), 1 /* TEXT */)
                            ]),
                            (_ctx.dnsQueryResult.error)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_158, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Error')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_159, _toDisplayString(_ctx.dnsQueryResult.error), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]),
                          (_ctx.dnsQueryResult.answers.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_160, [
                                _createElementVNode("thead", null, [
                                  _createElementVNode("tr", null, [
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('TTL')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Value')), 1 /* TEXT */)
                                  ])
                                ]),
                                _createElementVNode("tbody", null, [
                                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsQueryResult.answers, (r, i) => {
                                    return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                      _createElementVNode("td", _hoisted_161, _toDisplayString(r.name), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_162, _toDisplayString(r.type), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_163, _toDisplayString(r.ttl), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_164, _toDisplayString(r.value), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : (_openBlock(), _createElementBlock("p", _hoisted_165, _toDisplayString(_ctx.t('No records returned.')), 1 /* TEXT */)),
                          (_ctx.dnsQueryResult.authority.length)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_166, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Authority section')), 1 /* TEXT */),
                                _createElementVNode("table", _hoisted_167, [
                                  _createElementVNode("tbody", null, [
                                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsQueryResult.authority, (r, i) => {
                                      return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                        _createElementVNode("td", _hoisted_168, _toDisplayString(r.name), 1 /* TEXT */),
                                        _createElementVNode("td", _hoisted_169, _toDisplayString(r.type), 1 /* TEXT */),
                                        _createElementVNode("td", _hoisted_170, _toDisplayString(r.value), 1 /* TEXT */)
                                      ]))
                                    }), 128 /* KEYED_FRAGMENT */))
                                  ])
                                ])
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.dnsView==='compare')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                    _createElementVNode("div", _hoisted_171, [
                      _createElementVNode("div", _hoisted_172, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[49] || (_cache[49] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[50] || (_cache[50] = _withKeys((...args) => (_ctx.runDnsCompare && _ctx.runDnsCompare(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_173), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[51] || (_cache[51] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_174))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.dnsc}]),
                          disabled: _ctx.busy.dnsc,
                          onClick: _cache[52] || (_cache[52] = (...args) => (_ctx.runDnsCompare && _ctx.runDnsCompare(...args)))
                        }, _toDisplayString(_ctx.t('Compare resolvers')), 11 /* TEXT, CLASS, PROPS */, _hoisted_175)
                      ]),
                      _createElementVNode("p", _hoisted_176, _toDisplayString(_ctx.t('Asks this server and the large public resolvers the same question, so you can see whether a change has spread yet.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsCompareResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_177, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsCompareResult.findings, (f, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: _normalizeClass(["finding", f.level])
                            }, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", f.level])
                              }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                              _createElementVNode("div", null, [
                                _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                                _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                              ])
                            ], 2 /* CLASS */))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _createElementVNode("table", _hoisted_178, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Resolver')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Time')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Status')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Answer')), 1 /* TEXT */)
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsCompareResult.rows, (r, i) => {
                                return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                  _createElementVNode("td", null, [
                                    _createTextVNode(_toDisplayString(r.label) + " ", 1 /* TEXT */),
                                    _createElementVNode("span", _hoisted_179, _toDisplayString(r.server), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", _hoisted_180, _toDisplayString(r.ms) + " ms", 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_181, _toDisplayString(r.status), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_182, [
                                    _createTextVNode(_toDisplayString(r.values.join(', ') || '—') + " ", 1 /* TEXT */),
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", r.agrees ? 'ok' : 'warn'])
                                    }, _toDisplayString(r.agrees ? _ctx.t('same') : _ctx.t('differs')), 3 /* TEXT, CLASS */)
                                  ])
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ])
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.dnsView==='trace')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 3 }, [
                    _createElementVNode("div", _hoisted_183, [
                      _createElementVNode("div", _hoisted_184, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[53] || (_cache[53] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[54] || (_cache[54] = _withKeys((...args) => (_ctx.runDnsTrace && _ctx.runDnsTrace(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_185), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[55] || (_cache[55] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_186))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.dnst}]),
                          disabled: _ctx.busy.dnst,
                          onClick: _cache[56] || (_cache[56] = (...args) => (_ctx.runDnsTrace && _ctx.runDnsTrace(...args)))
                        }, _toDisplayString(_ctx.t('Trace from the root')), 11 /* TEXT, CLASS, PROPS */, _hoisted_187)
                      ]),
                      _createElementVNode("p", _hoisted_188, _toDisplayString(_ctx.t('Follows the delegation the way a resolver does, so a broken hand-off between zones is visible.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsTraceResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_189, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsTraceResult.steps, (s, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: "trace-step"
                            }, [
                              _createElementVNode("div", _hoisted_190, [
                                _createElementVNode("span", _hoisted_191, _toDisplayString(i + 1), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("strong", _hoisted_192, _toDisplayString(s.serverName), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("span", _hoisted_193, _toDisplayString(s.server), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("span", _hoisted_194, _toDisplayString(s.ms) + " ms · " + _toDisplayString(s.status), 1 /* TEXT */)
                              ]),
                              (s.answers.length)
                                ? (_openBlock(), _createElementBlock("div", _hoisted_195, "→ " + _toDisplayString(s.answers.map(a => a.type + ' ' + a.value).join(', ')), 1 /* TEXT */))
                                : (_openBlock(), _createElementBlock("div", _hoisted_196, _toDisplayString(_ctx.t('delegates to')) + " " + _toDisplayString(s.authority.filter(a => a.type === 'NS').map(a => a.value).join(', ') || '—'), 1 /* TEXT */))
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.dnsView==='axfr')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                    _createElementVNode("div", _hoisted_197, [
                      _createElementVNode("div", _hoisted_198, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[57] || (_cache[57] = $event => ((_ctx.axfrZone) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[58] || (_cache[58] = _withKeys((...args) => (_ctx.runAxfr && _ctx.runAxfr(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_199), [
                          [_vModelText, _ctx.axfrZone]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[59] || (_cache[59] = $event => ((_ctx.axfrServer) = $event)),
                          class: "short",
                          placeholder: _ctx.t('Name server (blank = all of them)')
                        }, null, 8 /* PROPS */, _hoisted_200), [
                          [_vModelText, _ctx.axfrServer]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.axfr}]),
                          disabled: _ctx.busy.axfr,
                          onClick: _cache[60] || (_cache[60] = (...args) => (_ctx.runAxfr && _ctx.runAxfr(...args)))
                        }, _toDisplayString(_ctx.t('Test zone transfer')), 11 /* TEXT, CLASS, PROPS */, _hoisted_201)
                      ]),
                      _createElementVNode("p", _hoisted_202, _toDisplayString(_ctx.t('A name server that hands its whole zone to a stranger gives away every host name it knows. This checks whether yours refuses.')), 1 /* TEXT */)
                    ]),
                    (_ctx.axfrResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_203, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.axfrResult.findings, (f, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: _normalizeClass(["finding", f.level])
                            }, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", f.level])
                              }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                              _createElementVNode("div", null, [
                                _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                                _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                              ])
                            ], 2 /* CLASS */))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _createElementVNode("table", _hoisted_204, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Name server')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Records')), 1 /* TEXT */)
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.axfrResult.results, (r, i) => {
                                return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                  _createElementVNode("td", _hoisted_205, [
                                    _createTextVNode(_toDisplayString(r.server) + " ", 1 /* TEXT */),
                                    _createElementVNode("span", _hoisted_206, _toDisplayString(r.address), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", r.allowed ? 'bad' : 'ok'])
                                    }, _toDisplayString(r.allowed ? _ctx.t('transfer allowed') : _ctx.t('refused')), 3 /* TEXT, CLASS */),
                                    _createTextVNode(),
                                    _createElementVNode("span", _hoisted_207, _toDisplayString(r.error || ''), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", _hoisted_208, _toDisplayString(r.records || ''), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.axfrResult.results, (r, i) => {
                            return (_openBlock(), _createElementBlock(_Fragment, {
                              key: 's'+i
                            }, [
                              (r.sample && r.sample.length)
                                ? (_openBlock(), _createElementBlock("details", _hoisted_209, [
                                    _createElementVNode("summary", null, _toDisplayString(r.server), 1 /* TEXT */),
                                    _createElementVNode("pre", _hoisted_210, _toDisplayString(r.sample.join('\n')), 1 /* TEXT */)
                                  ]))
                                : _createCommentVNode("v-if", true)
                            ], 64 /* STABLE_FRAGMENT */))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ whois ============ "),
        (_ctx.tab==='whois')
          ? (_openBlock(), _createElementBlock("section", _hoisted_211, [
              _createCommentVNode(" Whois lookup first: a single domain or IP, with its registration\n               shown just below. "),
              _createElementVNode("div", _hoisted_212, [
                _createElementVNode("div", _hoisted_213, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[61] || (_cache[61] = $event => ((_ctx.whoisQuery) = $event)),
                    placeholder: _ctx.t('Domain name or IP address'),
                    onKeyup: _cache[62] || (_cache[62] = _withKeys((...args) => (_ctx.runWhois && _ctx.runWhois(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_214), [
                    [_vModelText, _ctx.whoisQuery]
                  ]),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.whois}]),
                    disabled: _ctx.busy.whois,
                    onClick: _cache[63] || (_cache[63] = (...args) => (_ctx.runWhois && _ctx.runWhois(...args)))
                  }, _toDisplayString(_ctx.t('Look up')), 11 /* TEXT, CLASS, PROPS */, _hoisted_215)
                ])
              ]),
              (_ctx.whoisResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_216, [
                    (Object.keys(_ctx.whoisResult.fields).length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_217, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.whoisResult.fields, (v, k) => {
                            return (_openBlock(), _createElementBlock("div", { key: k }, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.fieldLabel(k))), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(v), 1 /* TEXT */)
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.whoisResult.chain, (hop, i) => {
                      return (_openBlock(), _createElementBlock("details", {
                        key: i,
                        open: i===_ctx.whoisResult.chain.length-1
                      }, [
                        _createElementVNode("summary", null, _toDisplayString(hop.server), 1 /* TEXT */),
                        _createElementVNode("pre", _hoisted_219, _toDisplayString(hop.response), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_218))
                    }), 128 /* KEYED_FRAGMENT */))
                  ]))
                : _createCommentVNode("v-if", true),
              _createCommentVNode(" Free-domain search below: type the name before the dot and every\n               common ending is checked at once. A free one gets an OK mark; a taken\n               one gets a Whois button that opens its registration above. "),
              _createElementVNode("div", _hoisted_220, [
                _createElementVNode("div", _hoisted_221, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[64] || (_cache[64] = $event => ((_ctx.availDomains) = $event)),
                    placeholder: _ctx.t('A name, without the ending — e.g. example'),
                    onKeyup: _cache[65] || (_cache[65] = _withKeys((...args) => (_ctx.runAvailability && _ctx.runAvailability(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_222), [
                    [_vModelText, _ctx.availDomains]
                  ]),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.avail}]),
                    disabled: _ctx.busy.avail || !_ctx.availBase,
                    onClick: _cache[66] || (_cache[66] = (...args) => (_ctx.runAvailability && _ctx.runAvailability(...args)))
                  }, _toDisplayString(_ctx.busy.avail ? _ctx.t('Checking…') : _ctx.t('Find a free domain')), 11 /* TEXT, CLASS, PROPS */, _hoisted_223)
                ]),
                _createElementVNode("div", _hoisted_224, [
                  _createElementVNode("span", _hoisted_225, _toDisplayString(_ctx.t('Range to check')), 1 /* TEXT */),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.availTierList, (ti) => {
                    return (_openBlock(), _createElementBlock("label", {
                      key: ti.key,
                      class: _normalizeClass(["avail-scope-opt", {on: _ctx.availTier===ti.key}])
                    }, [
                      _withDirectives(_createElementVNode("input", {
                        type: "radio",
                        value: ti.key,
                        "onUpdate:modelValue": _cache[67] || (_cache[67] = $event => ((_ctx.availTier) = $event))
                      }, null, 8 /* PROPS */, _hoisted_226), [
                        [_vModelRadio, _ctx.availTier]
                      ]),
                      _createTextVNode(" " + _toDisplayString(_ctx.t(ti.label)) + " ", 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_227, "(" + _toDisplayString(ti.count) + ")", 1 /* TEXT */)
                    ], 2 /* CLASS */))
                  }), 128 /* KEYED_FRAGMENT */)),
                  (_ctx.availTier!=='core')
                    ? (_openBlock(), _createElementBlock("span", _hoisted_228, _toDisplayString(_ctx.t('A large range can take 30–60 seconds.')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true)
                ]),
                (_ctx.busy.avail || (_ctx.availProgress.total && _ctx.availProgress.done < _ctx.availProgress.total))
                  ? (_openBlock(), _createElementBlock("div", _hoisted_229, [
                      _createElementVNode("div", _hoisted_230, [
                        _createElementVNode("div", {
                          class: "fill",
                          style: _normalizeStyle({width: (_ctx.availProgress.total ? Math.round(_ctx.availProgress.done / _ctx.availProgress.total * 100) : 0) + '%'})
                        }, null, 4 /* STYLE */)
                      ]),
                      _createElementVNode("div", _hoisted_231, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Checking “{name}”…', {name: _ctx.availBase})), 1 /* TEXT */),
                        _hoisted_232,
                        _createElementVNode("span", null, _toDisplayString(_ctx.availProgress.done) + " / " + _toDisplayString(_ctx.availProgress.total), 1 /* TEXT */)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.availResults.length)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_233, [
                      _createElementVNode("div", _hoisted_234, [
                        _createElementVNode("label", {
                          class: "switch",
                          title: _ctx.t('On: shown. Off: hidden.')
                        }, [
                          _withDirectives(_createElementVNode("input", {
                            type: "checkbox",
                            "onUpdate:modelValue": _cache[68] || (_cache[68] = $event => ((_ctx.availShowTaken) = $event))
                          }, null, 512 /* NEED_PATCH */), [
                            [_vModelCheckbox, _ctx.availShowTaken]
                          ]),
                          _hoisted_236,
                          _createElementVNode("span", _hoisted_237, _toDisplayString(_ctx.t('Show taken (×)')), 1 /* TEXT */)
                        ], 8 /* PROPS */, _hoisted_235),
                        _createElementVNode("label", {
                          class: "switch",
                          title: _ctx.t('On: shown. Off: hidden.')
                        }, [
                          _withDirectives(_createElementVNode("input", {
                            type: "checkbox",
                            "onUpdate:modelValue": _cache[69] || (_cache[69] = $event => ((_ctx.availShowUnknown) = $event))
                          }, null, 512 /* NEED_PATCH */), [
                            [_vModelCheckbox, _ctx.availShowUnknown]
                          ]),
                          _hoisted_239,
                          _createElementVNode("span", _hoisted_240, _toDisplayString(_ctx.t('Show undetermined (?)')), 1 /* TEXT */)
                        ], 8 /* PROPS */, _hoisted_238)
                      ]),
                      _createElementVNode("div", _hoisted_241, "○ " + _toDisplayString(_ctx.t('free')) + " · × " + _toDisplayString(_ctx.t('taken')) + " · △ " + _toDisplayString(_ctx.t('likely free (registry unreachable)')) + " · ? " + _toDisplayString(_ctx.t('undetermined')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_242, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.availShown, (r) => {
                          return (_openBlock(), _createElementBlock("div", {
                            key: r.domain,
                            class: _normalizeClass(["avail-row", 'avail-'+r.cls])
                          }, [
                            _createElementVNode("span", {
                              class: _normalizeClass(["avail-mark", 'm-'+r.cls]),
                              title: _ctx.availTitle(r)
                            }, _toDisplayString(r.mark), 11 /* TEXT, CLASS, PROPS */, _hoisted_243),
                            _createElementVNode("span", {
                              class: "avail-domain mono",
                              title: _ctx.availTitle(r)
                            }, _toDisplayString(r.domain), 9 /* TEXT, PROPS */, _hoisted_244),
                            (r.mark==='×')
                              ? (_openBlock(), _createElementBlock("button", {
                                  key: 0,
                                  class: "btn xs avail-taken",
                                  title: _ctx.t('Taken — show the Whois registration'),
                                  onClick: $event => (_ctx.showWhoisFor(r))
                                }, [
                                  _hoisted_246,
                                  _createTextVNode(" Whois")
                                ], 8 /* PROPS */, _hoisted_245))
                              : _createCommentVNode("v-if", true)
                          ], 2 /* CLASS */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]),
                      (!_ctx.availShown.length)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_247, [
                            _createTextVNode(_toDisplayString(_ctx.t('All {n} results are hidden by the switches above.', {n: _ctx.availResults.length})) + " ", 1 /* TEXT */),
                            _createElementVNode("a", {
                              href: "#",
                              onClick: _cache[70] || (_cache[70] = _withModifiers($event => {_ctx.availShowTaken=true; _ctx.availShowUnknown=true}, ["prevent"]))
                            }, _toDisplayString(_ctx.t('Show all')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]))
                  : _createCommentVNode("v-if", true)
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ tls / http ============ "),
        (_ctx.tab==='tls')
          ? (_openBlock(), _createElementBlock("section", _hoisted_248, [
              _createElementVNode("div", _hoisted_249, [
                _createElementVNode("div", _hoisted_250, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[71] || (_cache[71] = $event => ((_ctx.tlsHost) = $event)),
                    placeholder: _ctx.t('example.com'),
                    onKeyup: _cache[72] || (_cache[72] = _withKeys((...args) => (_ctx.runTls && _ctx.runTls(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_251), [
                    [_vModelText, _ctx.tlsHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[73] || (_cache[73] = $event => ((_ctx.tlsPort) = $event)),
                    class: "tiny",
                    type: "number"
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.tlsPort,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.tls}]),
                    disabled: _ctx.busy.tls,
                    onClick: _cache[74] || (_cache[74] = (...args) => (_ctx.runTls && _ctx.runTls(...args)))
                  }, _toDisplayString(_ctx.t('Inspect certificate')), 11 /* TEXT, CLASS, PROPS */, _hoisted_252),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn", {working: _ctx.busy.http}]),
                    disabled: _ctx.busy.http,
                    onClick: _cache[75] || (_cache[75] = (...args) => (_ctx.runHttp && _ctx.runHttp(...args)))
                  }, _toDisplayString(_ctx.t('HTTP headers')), 11 /* TEXT, CLASS, PROPS */, _hoisted_253),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn", {working: _ctx.busy.tlsver}]),
                    disabled: _ctx.busy.tlsver,
                    onClick: _cache[76] || (_cache[76] = (...args) => (_ctx.runTlsVersions && _ctx.runTlsVersions(...args)))
                  }, _toDisplayString(_ctx.t('Which TLS versions?')), 11 /* TEXT, CLASS, PROPS */, _hoisted_254)
                ])
              ]),
              (_ctx.tlsVersionsResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_255, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.tlsVersionsResult.findings, (f, i) => {
                      return (_openBlock(), _createElementBlock("div", {
                        key: i,
                        class: _normalizeClass(["finding", f.level])
                      }, [
                        _createElementVNode("span", {
                          class: _normalizeClass(["pill", f.level])
                        }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                        _createElementVNode("div", null, [
                          _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                          _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                        ])
                      ], 2 /* CLASS */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    _createElementVNode("table", _hoisted_256, [
                      _createElementVNode("thead", null, [
                        _createElementVNode("tr", null, [
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Version')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Accepted')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Cipher')), 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("tbody", null, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.tlsVersionsResult.versions, (v, name) => {
                          return (_openBlock(), _createElementBlock("tr", { key: name }, [
                            _createElementVNode("td", _hoisted_257, _toDisplayString(name), 1 /* TEXT */),
                            _createElementVNode("td", null, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", v.supported ? (name === 'TLSv1.0' || name === 'TLSv1.1' ? 'warn' : 'ok') : 'no'])
                              }, _toDisplayString(v.supported ? _ctx.t('yes') : _ctx.t('no')), 3 /* TEXT, CLASS */)
                            ]),
                            _createElementVNode("td", _hoisted_258, _toDisplayString(v.cipher || ''), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.tlsResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_259, [
                    (!_ctx.tlsResult.ok)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_260, "⚠ " + _toDisplayString(_ctx.tlsResult.error), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_261, [
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Subject')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.tlsResult.subject), 1 /* TEXT */)
                          ]),
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Issuer')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.tlsResult.issuer), 1 /* TEXT */)
                          ]),
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Valid until')), 1 /* TEXT */),
                            _createElementVNode("code", {
                              class: _normalizeClass({danger: _ctx.tlsResult.daysLeft < 14})
                            }, _toDisplayString(_ctx.stamp(_ctx.tlsResult.validTo)) + " (" + _toDisplayString(_ctx.t('{n} days left', {n: _ctx.tlsResult.daysLeft})) + ")", 3 /* TEXT, CLASS */)
                          ]),
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Protocol')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.tlsResult.protocol) + " / " + _toDisplayString(_ctx.tlsResult.cipher), 1 /* TEXT */)
                          ]),
                          (_ctx.tlsResult.sans.length)
                            ? (_openBlock(), _createElementBlock("div", _hoisted_262, [
                                _createElementVNode("span", null, _toDisplayString(_ctx.t('Names')), 1 /* TEXT */),
                                _createElementVNode("code", _hoisted_263, _toDisplayString(_ctx.tlsResult.sans.join(', ')), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.httpResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_264, [
                    _createElementVNode("table", _hoisted_265, [
                      _createElementVNode("thead", null, [
                        _createElementVNode("tr", null, [
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('URL')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Status')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Time')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Server')), 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("tbody", null, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.httpResult.chain, (h, i) => {
                          return (_openBlock(), _createElementBlock("tr", { key: i }, [
                            _createElementVNode("td", _hoisted_266, _toDisplayString(h.url), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_267, _toDisplayString(h.status), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_268, _toDisplayString(h.ms) + " ms", 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_269, _toDisplayString(h.server), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.httpResult.findings || []), (f, i) => {
                      return (_openBlock(), _createElementBlock("div", {
                        key: i,
                        class: _normalizeClass(["finding", f.level])
                      }, [
                        _createElementVNode("span", {
                          class: _normalizeClass(["pill", f.level])
                        }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                        _createElementVNode("div", null, [
                          _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                          _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                        ])
                      ], 2 /* CLASS */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    _createElementVNode("div", _hoisted_270, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.httpResult.security, (v, k) => {
                        return (_openBlock(), _createElementBlock("div", { key: k }, [
                          _createElementVNode("span", null, _toDisplayString(k), 1 /* TEXT */),
                          _createElementVNode("code", {
                            class: _normalizeClass({dim: !v})
                          }, _toDisplayString(v || _ctx.t('not set')), 3 /* TEXT, CLASS */)
                        ]))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ benchmarks ============ "),
        (_ctx.tab==='bench')
          ? (_openBlock(), _createElementBlock("section", _hoisted_271, [
              _createElementVNode("div", _hoisted_272, [
                _createElementVNode("div", _hoisted_273, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Live throughput')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[77] || (_cache[77] = $event => ((_ctx.liveIface) = $event)),
                    class: "narrow"
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.liveIfaces, (i) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: i,
                        value: i
                      }, _toDisplayString(i), 9 /* TEXT, PROPS */, _hoisted_274))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.liveIface]
                  ]),
                  _hoisted_275,
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn sm", {active: _ctx.liveOn}]),
                    onClick: _cache[78] || (_cache[78] = (...args) => (_ctx.toggleLive && _ctx.toggleLive(...args)))
                  }, _toDisplayString(_ctx.liveOn ? _ctx.t('Stop') : _ctx.t('Start')), 3 /* TEXT, CLASS */)
                ]),
                (_ctx.liveIface)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_276, [
                      _createElementVNode("div", _hoisted_277, [
                        _createElementVNode("span", _hoisted_278, "↓ " + _toDisplayString(_ctx.t('Receive')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_279, _toDisplayString(_ctx.fmtRate(_ctx.liveNow.rx)), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", _hoisted_280, [
                        _createElementVNode("span", _hoisted_281, "↑ " + _toDisplayString(_ctx.t('Send')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_282, _toDisplayString(_ctx.fmtRate(_ctx.liveNow.tx)), 1 /* TEXT */)
                      ]),
                      (_openBlock(), _createElementBlock("svg", _hoisted_283, [
                        _createElementVNode("polyline", {
                          class: "sp-rx",
                          points: _ctx.spark(_ctx.liveRx)
                        }, null, 8 /* PROPS */, _hoisted_284),
                        _createElementVNode("polyline", {
                          class: "sp-tx",
                          points: _ctx.spark(_ctx.liveTx)
                        }, null, 8 /* PROPS */, _hoisted_285)
                      ]))
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("p", _hoisted_286, [
                  _createTextVNode(_toDisplayString(_ctx.t('Read straight from the kernel counters, so it costs nothing and needs no extra software.')) + " ", 1 /* TEXT */),
                  (_ctx.liveErrors)
                    ? (_openBlock(), _createElementBlock("span", _hoisted_287, " ⚠ " + _toDisplayString(_ctx.t('{n} interface errors / drops recorded since boot', {n: _ctx.liveErrors})), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true)
                ])
              ]),
              _createElementVNode("div", _hoisted_288, [
                _createElementVNode("div", _hoisted_289, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Internet speed test')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[79] || (_cache[79] = $event => ((_ctx.speedSize) = $event)),
                    class: "narrow"
                  }, _hoisted_294, 512 /* NEED_PATCH */), [
                    [
                      _vModelSelect,
                      _ctx.speedSize,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[80] || (_cache[80] = $event => ((_ctx.speedVia) = $event)),
                    class: "narrow",
                    title: _ctx.t('Where to measure against')
                  }, [
                    _createElementVNode("option", _hoisted_296, _toDisplayString(_ctx.t('Nearest (automatic)')), 1 /* TEXT */),
                    _hoisted_297,
                    _hoisted_298
                  ], 8 /* PROPS */, _hoisted_295), [
                    [_vModelSelect, _ctx.speedVia]
                  ]),
                  _createElementVNode("label", _hoisted_299, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[81] || (_cache[81] = $event => ((_ctx.speedUpload) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.speedUpload]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Also test upload')), 1 /* TEXT */)
                  ]),
                  _hoisted_300,
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.speed}]),
                    disabled: _ctx.busy.speed,
                    onClick: _cache[82] || (_cache[82] = (...args) => (_ctx.runSpeed && _ctx.runSpeed(...args)))
                  }, _toDisplayString(_ctx.busy.speed ? _ctx.t('Measuring…') : _ctx.t('Run')), 11 /* TEXT, CLASS, PROPS */, _hoisted_301)
                ]),
                (_ctx.speedEndpoint)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_302, _toDisplayString(_ctx.t('Measured against {host}{where}. Nothing but the test payload is sent.', {host: _ctx.speedEndpoint, where: _ctx.speedWhere ? ' (' + _ctx.speedWhere + ')' : ''})) + " " + _toDisplayString(_ctx.t('Treat the figure as a guide: it moves with the server that was chosen and with the time of day.')), 1 /* TEXT */))
                  : (_openBlock(), _createElementBlock("p", _hoisted_303, _toDisplayString(_ctx.speedVia === 'cloudflare' ? _ctx.t('Cloudflare will be measured against. Nothing but the test payload is sent.') : _ctx.speedVia === 'mlab' ? _ctx.t('The nearest M-Lab server will be measured against. Nothing but the test payload is sent.') : _ctx.t('The nearest measurement server is chosen when the test runs. Nothing but the test payload is sent.')) + " " + _toDisplayString(_ctx.t('Treat the figure as a guide: it moves with the server that was chosen and with the time of day.')), 1 /* TEXT */)),
                (_ctx.speedResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_304, [
                      _createElementVNode("div", _hoisted_305, [
                        _createElementVNode("span", _hoisted_306, "↓ " + _toDisplayString(_ctx.t('Download')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_307, _toDisplayString(_ctx.speedResult.download ? _ctx.speedResult.download.mbps : '—'), 1 /* TEXT */),
                        _hoisted_308
                      ]),
                      _createElementVNode("div", _hoisted_309, [
                        _createElementVNode("span", _hoisted_310, "↑ " + _toDisplayString(_ctx.t('Upload')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_311, _toDisplayString(_ctx.speedResult.upload ? _ctx.speedResult.upload.mbps : '—'), 1 /* TEXT */),
                        _hoisted_312
                      ]),
                      _createElementVNode("div", _hoisted_313, [
                        _createElementVNode("span", _hoisted_314, _toDisplayString(_ctx.t('Latency')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_315, _toDisplayString(_ctx.speedResult.latency ? _ctx.speedResult.latency.avg : '—'), 1 /* TEXT */),
                        _hoisted_316
                      ]),
                      _createElementVNode("div", _hoisted_317, [
                        _createElementVNode("span", _hoisted_318, _toDisplayString(_ctx.t('Jitter')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_319, _toDisplayString(_ctx.speedResult.latency && _ctx.speedResult.latency.jitter != null ? _ctx.speedResult.latency.jitter : '—'), 1 /* TEXT */),
                        _hoisted_320
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                _createCommentVNode(" The line as it is drawn: an average at the end hides the\n                 ramp-up, a stall, or a line that fades under load. "),
                (_ctx.speedLive.running || _ctx.speedLive.down.length || _ctx.speedLive.up.length)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_321, [
                      _createElementVNode("div", _hoisted_322, [
                        _createElementVNode("strong", null, _toDisplayString(_ctx.t('Speed over time')), 1 /* TEXT */),
                        (_ctx.speedLive.running && !_ctx.speedLive.down.length && !_ctx.speedLive.up.length)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_323, _toDisplayString(_ctx.t('Starting…')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _hoisted_324,
                        (_ctx.speedLive.down.length)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_325, "↓ " + _toDisplayString(_ctx.speedLive.down[_ctx.speedLive.down.length - 1].mbps) + " Mbps", 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        (_ctx.speedLive.up.length)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_326, "↑ " + _toDisplayString(_ctx.speedLive.up[_ctx.speedLive.up.length - 1].mbps) + " Mbps", 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      _createElementVNode("canvas", _hoisted_327, null, 512 /* NEED_PATCH */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.speedResult && (_ctx.speedResult.downloadError || _ctx.speedResult.uploadError))
                  ? (_openBlock(), _createElementBlock("p", _hoisted_328, "⚠ " + _toDisplayString(_ctx.speedResult.downloadError || _ctx.speedResult.uploadError), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_329, [
                _createElementVNode("div", _hoisted_330, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('LAN throughput (iperf3)')), 1 /* TEXT */)
                ]),
                (_ctx.hasTool('iperf3'))
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("div", _hoisted_331, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[83] || (_cache[83] = $event => ((_ctx.iperfHost) = $event)),
                          placeholder: _ctx.t('Address of a machine running: iperf3 -s'),
                          onKeyup: _cache[84] || (_cache[84] = _withKeys((...args) => (_ctx.runIperf && _ctx.runIperf(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_332), [
                          [_vModelText, _ctx.iperfHost]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[85] || (_cache[85] = $event => ((_ctx.iperfPort) = $event)),
                          class: "tiny",
                          type: "number"
                        }, null, 512 /* NEED_PATCH */), [
                          [
                            _vModelText,
                            _ctx.iperfPort,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[86] || (_cache[86] = $event => ((_ctx.iperfSeconds) = $event)),
                          class: "tiny"
                        }, _hoisted_336, 512 /* NEED_PATCH */), [
                          [
                            _vModelSelect,
                            _ctx.iperfSeconds,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("label", _hoisted_337, [
                          _withDirectives(_createElementVNode("input", {
                            type: "checkbox",
                            "onUpdate:modelValue": _cache[87] || (_cache[87] = $event => ((_ctx.iperfReverse) = $event))
                          }, null, 512 /* NEED_PATCH */), [
                            [_vModelCheckbox, _ctx.iperfReverse]
                          ]),
                          _createTextVNode(" " + _toDisplayString(_ctx.t('Reverse')), 1 /* TEXT */)
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.iperf}]),
                          disabled: _ctx.busy.iperf,
                          onClick: _cache[88] || (_cache[88] = (...args) => (_ctx.runIperf && _ctx.runIperf(...args)))
                        }, _toDisplayString(_ctx.busy.iperf ? _ctx.t('Measuring…') : _ctx.t('Run')), 11 /* TEXT, CLASS, PROPS */, _hoisted_338)
                      ]),
                      (_ctx.iperfResult && !_ctx.iperfResult.error)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_339, [
                            _createElementVNode("div", _hoisted_340, [
                              _createElementVNode("span", _hoisted_341, _toDisplayString(_ctx.t('Sent')), 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_342, _toDisplayString(_ctx.iperfResult.sentMbps), 1 /* TEXT */),
                              _hoisted_343
                            ]),
                            _createElementVNode("div", _hoisted_344, [
                              _createElementVNode("span", _hoisted_345, _toDisplayString(_ctx.t('Received')), 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_346, _toDisplayString(_ctx.iperfResult.receivedMbps), 1 /* TEXT */),
                              _hoisted_347
                            ]),
                            (_ctx.iperfResult.retransmits != null)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_348, [
                                  _createElementVNode("span", _hoisted_349, _toDisplayString(_ctx.t('Retransmits')), 1 /* TEXT */),
                                  _createElementVNode("span", _hoisted_350, _toDisplayString(_ctx.iperfResult.retransmits), 1 /* TEXT */),
                                  _hoisted_351
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.iperfResult && _ctx.iperfResult.intervals && _ctx.iperfResult.intervals.length)
                        ? (_openBlock(), _createElementBlock("svg", _hoisted_352, [
                            _createElementVNode("polyline", {
                              class: "sp-rx",
                              points: _ctx.spark(_ctx.iperfResult.intervals.map(i => i.mbps))
                            }, null, 8 /* PROPS */, _hoisted_353)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.iperfResult && _ctx.iperfResult.error)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_354, "⚠ " + _toDisplayString(_ctx.iperfResult.error), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_openBlock(), _createElementBlock("div", _hoisted_355, [
                      _createElementVNode("p", null, _toDisplayString(_ctx.t('An internet speed test measures the internet. To measure the local link you need iperf3 on this server and on one other machine.')), 1 /* TEXT */),
                      _createElementVNode("pre", _hoisted_356, _toDisplayString(_ctx.installFor('iperf3')), 1 /* TEXT */)
                    ]))
              ]),
              _createElementVNode("div", _hoisted_357, [
                _createElementVNode("div", _hoisted_358, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('DNS resolver comparison')), 1 /* TEXT */),
                  _hoisted_359,
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.dnsbench}]),
                    disabled: _ctx.busy.dnsbench,
                    onClick: _cache[89] || (_cache[89] = (...args) => (_ctx.runDnsBench && _ctx.runDnsBench(...args)))
                  }, _toDisplayString(_ctx.busy.dnsbench ? _ctx.t('Measuring…') : _ctx.t('Compare')), 11 /* TEXT, CLASS, PROPS */, _hoisted_360)
                ]),
                _createElementVNode("p", _hoisted_361, _toDisplayString(_ctx.t('Each resolver is asked for the same names, and the times are compared. The resolver this server uses is included.')), 1 /* TEXT */),
                (_ctx.dnsBench)
                  ? (_openBlock(), _createElementBlock("table", _hoisted_362, [
                      _createElementVNode("thead", null, [
                        _createElementVNode("tr", null, [
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Resolver')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Median')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Average')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Jitter')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Answered')), 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("tbody", null, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsBench.resolvers, (r) => {
                          return (_openBlock(), _createElementBlock("tr", {
                            key: r.resolver,
                            class: _normalizeClass({winner: r.resolver===_ctx.dnsBench.fastest})
                          }, [
                            _createElementVNode("td", _hoisted_363, [
                              _createTextVNode(_toDisplayString(r.resolver) + " ", 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_364, _toDisplayString(_ctx.t(r.name)), 1 /* TEXT */),
                              _createTextVNode(),
                              (r.resolver===_ctx.dnsBench.fastest)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_365, _toDisplayString(_ctx.t('fastest')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]),
                            _createElementVNode("td", _hoisted_366, _toDisplayString(r.median != null ? r.median + ' ms' : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_367, _toDisplayString(r.avg != null ? r.avg + ' ms' : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_368, _toDisplayString(r.jitter != null ? r.jitter : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_369, _toDisplayString(r.answered) + " / " + _toDisplayString(r.queries), 1 /* TEXT */)
                          ], 2 /* CLASS */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_370, [
                _createElementVNode("div", _hoisted_371, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Where the time goes')), 1 /* TEXT */)
                ]),
                _createElementVNode("div", _hoisted_372, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[90] || (_cache[90] = $event => ((_ctx.timingUrl) = $event)),
                    placeholder: "https://example.com",
                    onKeyup: _cache[91] || (_cache[91] = _withKeys((...args) => (_ctx.runTiming && _ctx.runTiming(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.timingUrl]
                  ]),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.timing}]),
                    disabled: _ctx.busy.timing,
                    onClick: _cache[92] || (_cache[92] = (...args) => (_ctx.runTiming && _ctx.runTiming(...args)))
                  }, _toDisplayString(_ctx.t('Measure')), 11 /* TEXT, CLASS, PROPS */, _hoisted_373)
                ]),
                (_ctx.timingResult)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("div", _hoisted_374, [
                        _createElementVNode("div", null, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t('Status')), 1 /* TEXT */),
                          _createElementVNode("code", null, [
                            _createTextVNode(_toDisplayString(_ctx.timingResult.status), 1 /* TEXT */),
                            (_ctx.timingResult.location)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_375, " → " + _toDisplayString(_ctx.timingResult.location), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true)
                          ])
                        ]),
                        _createElementVNode("div", null, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t('Server address')), 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(_ctx.timingResult.ip) + ":" + _toDisplayString(_ctx.timingResult.port), 1 /* TEXT */)
                        ]),
                        _createElementVNode("div", null, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t('Total')), 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(_ctx.timingResult.total) + " ms", 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("div", _hoisted_376, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.timingResult.phases, (p) => {
                          return (_openBlock(), _createElementBlock("div", {
                            key: p.name,
                            class: "wf-row"
                          }, [
                            _createElementVNode("span", _hoisted_377, _toDisplayString(_ctx.t(p.name)), 1 /* TEXT */),
                            _createElementVNode("span", _hoisted_378, [
                              _createElementVNode("span", {
                                style: _normalizeStyle({width: _ctx.barWidth(p.ms, _ctx.timingResult.total)})
                              }, null, 4 /* STYLE */)
                            ]),
                            _createElementVNode("span", _hoisted_379, _toDisplayString(p.ms) + " ms", 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ], 64 /* STABLE_FRAGMENT */))
                  : _createCommentVNode("v-if", true)
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ subnet ============ "),
        (_ctx.tab==='subnet')
          ? (_openBlock(), _createElementBlock("section", _hoisted_380, [
              _createElementVNode("div", _hoisted_381, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('What does this network cover?')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_382, _toDisplayString(_ctx.t('An address and a prefix in, and out come the network and broadcast addresses, the usable range, and how many hosts fit.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_383, [
                  _createElementVNode("select", {
                    class: "pick",
                    title: _ctx.t('Pick one NetBase already knows'),
                    onChange: _cache[93] || (_cache[93] = $event => (_ctx.pickIntoAddress('calcAddress', $event)))
                  }, [
                    _createElementVNode("option", _hoisted_385, _toDisplayString(_ctx.t('Choose…')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.networkChoices, (g) => {
                      return (_openBlock(), _createElementBlock("optgroup", {
                        key: g.label,
                        label: _ctx.t(g.label)
                      }, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(g.items, (o) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: o.value,
                            value: o.value
                          }, _toDisplayString(o.text), 9 /* TEXT, PROPS */, _hoisted_387))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 8 /* PROPS */, _hoisted_386))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_384),
                  (!_ctx.subnetFreeText)
                    ? (_openBlock(), _createElementBlock("span", _hoisted_388, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.calcAddress.octets, (part, i) => {
                          return (_openBlock(), _createElementBlock(_Fragment, { key: i }, [
                            _createElementVNode("input", {
                              class: "ip-box",
                              value: part,
                              maxlength: "3",
                              inputmode: "numeric",
                              spellcheck: "false",
                              autocomplete: "off",
                              "data-group": "calc",
                              "data-col": i,
                              "aria-label": _ctx.t('Address') + ' ' + (i + 1),
                              onInput: $event => (_ctx.typeOctet(_ctx.calcAddress, i, $event)),
                              onKeydown: $event => (_ctx.octetKey(_ctx.calcAddress, 'calc', i, $event, _ctx.runSubnet)),
                              onPaste: _cache[94] || (_cache[94] = $event => (_ctx.pasteAddress(_ctx.calcAddress, $event))),
                              onFocus: _cache[95] || (_cache[95] = $event => ($event.target.select()))
                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_389),
                            (i < 3)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_390, "."))
                              : _createCommentVNode("v-if", true)
                          ], 64 /* STABLE_FRAGMENT */))
                        }), 128 /* KEYED_FRAGMENT */)),
                        _hoisted_391,
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[96] || (_cache[96] = $event => ((_ctx.calcAddress.prefix) = $event)),
                          class: "ip-prefix",
                          "aria-label": _ctx.t('Prefix')
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.prefixes, (p) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: p,
                              value: p
                            }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_393))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 8 /* PROPS */, _hoisted_392), [
                          [
                            _vModelSelect,
                            _ctx.calcAddress.prefix,
                            void 0,
                            { number: true }
                          ]
                        ])
                      ]))
                    : _withDirectives((_openBlock(), _createElementBlock("input", {
                        key: 1,
                        "onUpdate:modelValue": _cache[97] || (_cache[97] = $event => ((_ctx.subnetInput) = $event)),
                        placeholder: "2001:db8::1/64",
                        onKeyup: _cache[98] || (_cache[98] = _withKeys((...args) => (_ctx.runSubnet && _ctx.runSubnet(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */)), [
                        [_vModelText, _ctx.subnetInput]
                      ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    onClick: _cache[99] || (_cache[99] = (...args) => (_ctx.runSubnet && _ctx.runSubnet(...args)))
                  }, _toDisplayString(_ctx.t('Calculate')), 1 /* TEXT */)
                ]),
                _createElementVNode("label", _hoisted_394, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[100] || (_cache[100] = $event => ((_ctx.subnetFreeText) = $event))
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.subnetFreeText]
                  ]),
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Type it myself (IPv6, or a mask like 255.255.255.0)')), 1 /* TEXT */)
                ])
              ]),
              (_ctx.subnetResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_395, [
                    _createElementVNode("div", _hoisted_396, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.subnetResult, (v, k) => {
                        return (_openBlock(), _createElementBlock("div", { key: k }, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.fieldLabel(k))), 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(v), 1 /* TEXT */)
                        ]))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_397, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Split into smaller networks')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_398, _toDisplayString(_ctx.t('One network in, and the equal parts it divides into — with the range and host count of each.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_399, [
                  _createElementVNode("span", _hoisted_400, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.splitAddress.octets, (part, i) => {
                      return (_openBlock(), _createElementBlock(_Fragment, { key: i }, [
                        _createElementVNode("input", {
                          class: "ip-box",
                          value: part,
                          maxlength: "3",
                          inputmode: "numeric",
                          spellcheck: "false",
                          autocomplete: "off",
                          "data-group": "split",
                          "data-col": i,
                          "aria-label": _ctx.t('Network') + ' ' + (i + 1),
                          onInput: $event => (_ctx.typeOctet(_ctx.splitAddress, i, $event)),
                          onKeydown: $event => (_ctx.octetKey(_ctx.splitAddress, 'split', i, $event, _ctx.runSplit)),
                          onPaste: _cache[101] || (_cache[101] = $event => (_ctx.pasteAddress(_ctx.splitAddress, $event))),
                          onFocus: _cache[102] || (_cache[102] = $event => ($event.target.select()))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_401),
                        (i < 3)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_402, "."))
                          : _createCommentVNode("v-if", true)
                      ], 64 /* STABLE_FRAGMENT */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    _hoisted_403,
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[103] || (_cache[103] = $event => ((_ctx.splitAddress.prefix) = $event)),
                      class: "ip-prefix",
                      "aria-label": _ctx.t('Prefix')
                    }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.prefixes, (p) => {
                        return (_openBlock(), _createElementBlock("option", {
                          key: p,
                          value: p
                        }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_405))
                      }), 128 /* KEYED_FRAGMENT */))
                    ], 8 /* PROPS */, _hoisted_404), [
                      [
                        _vModelSelect,
                        _ctx.splitAddress.prefix,
                        void 0,
                        { number: true }
                      ]
                    ])
                  ]),
                  _createElementVNode("span", _hoisted_406, _toDisplayString(_ctx.t('into')), 1 /* TEXT */),
                  _hoisted_407,
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[104] || (_cache[104] = $event => ((_ctx.splitPrefix) = $event)),
                    class: "ip-prefix",
                    "aria-label": _ctx.t('Into networks of')
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.splitPrefixes, (p) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: p,
                        value: p
                      }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_409))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 8 /* PROPS */, _hoisted_408), [
                    [
                      _vModelSelect,
                      _ctx.splitPrefix,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn", {working: _ctx.busy.split}]),
                    disabled: _ctx.busy.split,
                    onClick: _cache[105] || (_cache[105] = (...args) => (_ctx.runSplit && _ctx.runSplit(...args)))
                  }, _toDisplayString(_ctx.t('Split')), 11 /* TEXT, CLASS, PROPS */, _hoisted_410)
                ]),
                (_ctx.splitResult)
                  ? (_openBlock(), _createElementBlock("table", _hoisted_411, [
                      _createElementVNode("thead", null, [
                        _createElementVNode("tr", null, [
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Network')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('First host')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Last host')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Broadcast')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Hosts')), 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("tbody", null, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.splitResult.subnets, (n, i) => {
                          return (_openBlock(), _createElementBlock("tr", { key: i }, [
                            _createElementVNode("td", _hoisted_412, _toDisplayString(n.cidr), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_413, _toDisplayString(n.firstHost), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_414, _toDisplayString(n.lastHost), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_415, _toDisplayString(n.broadcast), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_416, _toDisplayString(n.hosts), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_417, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Combine addresses into the fewest networks')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_418, _toDisplayString(_ctx.t('Add a row for each network you have. NetBase works out the smallest set of blocks that covers them all — the shortest firewall rule that still means the same thing.')), 1 /* TEXT */),
                (!_ctx.aggregateFreeText)
                  ? (_openBlock(true), _createElementBlock(_Fragment, { key: 0 }, _renderList(_ctx.ipRows, (row, r) => {
                      return (_openBlock(), _createElementBlock("div", {
                        class: "ip-row",
                        key: r
                      }, [
                        _createElementVNode("span", _hoisted_419, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(row.octets, (part, i) => {
                            return (_openBlock(), _createElementBlock(_Fragment, { key: i }, [
                              _createElementVNode("input", {
                                class: "ip-box",
                                value: part,
                                maxlength: "3",
                                inputmode: "numeric",
                                spellcheck: "false",
                                autocomplete: "off",
                                "data-group": 'agg' + r,
                                "data-col": i,
                                "aria-label": _ctx.t('Network') + ' ' + (r + 1) + ' — ' + (i + 1),
                                onInput: $event => (_ctx.typeOctet(row, i, $event)),
                                onKeydown: $event => (_ctx.octetKey(row, 'agg' + r, i, $event, _ctx.runAggregate)),
                                onPaste: $event => (_ctx.pasteAddress(row, $event)),
                                onFocus: _cache[106] || (_cache[106] = $event => ($event.target.select()))
                              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_420),
                              (i < 3)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_421, "."))
                                : _createCommentVNode("v-if", true)
                            ], 64 /* STABLE_FRAGMENT */))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _hoisted_422,
                          _withDirectives(_createElementVNode("select", {
                            "onUpdate:modelValue": $event => ((row.prefix) = $event),
                            class: "ip-prefix",
                            "aria-label": _ctx.t('Prefix')
                          }, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.prefixes, (p) => {
                              return (_openBlock(), _createElementBlock("option", {
                                key: p,
                                value: p
                              }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_424))
                            }), 128 /* KEYED_FRAGMENT */))
                          ], 8 /* PROPS */, _hoisted_423), [
                            [
                              _vModelSelect,
                              row.prefix,
                              void 0,
                              { number: true }
                            ]
                          ])
                        ]),
                        _createElementVNode("button", {
                          class: "btn xs",
                          title: _ctx.t('Add a row below'),
                          onClick: $event => (_ctx.addIpRow(r))
                        }, "＋", 8 /* PROPS */, _hoisted_425),
                        _createElementVNode("button", {
                          class: "btn xs",
                          disabled: _ctx.ipRows.length < 2,
                          title: _ctx.t('Remove this row'),
                          onClick: $event => (_ctx.removeIpRow(r))
                        }, "−", 8 /* PROPS */, _hoisted_426)
                      ]))
                    }), 128 /* KEYED_FRAGMENT */))
                  : _withDirectives((_openBlock(), _createElementBlock("textarea", {
                      key: 1,
                      "onUpdate:modelValue": _cache[107] || (_cache[107] = $event => ((_ctx.aggregateInput) = $event)),
                      rows: "3",
                      class: "mono tiny",
                      placeholder: _ctx.t('192.168.1.0/24, 10.0.0.5, 10.0.0.8-10.0.0.20, 2001:db8::/48')
                    }, null, 8 /* PROPS */, _hoisted_427)), [
                      [_vModelText, _ctx.aggregateInput]
                    ]),
                _createElementVNode("div", _hoisted_428, [
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn", {working: _ctx.busy.aggregate}]),
                    disabled: _ctx.busy.aggregate,
                    onClick: _cache[108] || (_cache[108] = (...args) => (_ctx.runAggregate && _ctx.runAggregate(...args)))
                  }, _toDisplayString(_ctx.t('Combine')), 11 /* TEXT, CLASS, PROPS */, _hoisted_429),
                  _createElementVNode("label", _hoisted_430, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[109] || (_cache[109] = $event => ((_ctx.aggregateFreeText) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.aggregateFreeText]
                    ]),
                    _createElementVNode("span", null, _toDisplayString(_ctx.t('Type them myself (ranges, IPv6)')), 1 /* TEXT */)
                  ])
                ]),
                (_ctx.aggregateResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_431, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Blocks')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_432, _toDisplayString(_ctx.aggregateResult.blocks.join(', ')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Ranges')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_433, _toDisplayString(_ctx.aggregateResult.ranges.join(', ')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Addresses covered')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.aggregateResult.addresses), 1 /* TEXT */)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_434, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Whose equipment is this?')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_435, _toDisplayString(_ctx.t('The first half of a MAC address says who made the device. NetBase looks it up in the bundled IEEE registry, so nothing leaves this server.')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_436, _toDisplayString(_ctx.t('Colons and hyphens are optional; six hex digits are enough.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_437, [
                  _createCommentVNode(" One box, taken as it comes: written with colons, with hyphens,\n                   in fours, or as bare hex. Six hex digits name the vendor, so\n                   the lookup happens as soon as that many have been typed. "),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[110] || (_cache[110] = $event => ((_ctx.macInput) = $event)),
                    class: "mac-input",
                    placeholder: "84:af:ec:85:7a:e0",
                    inputmode: "text",
                    spellcheck: "false",
                    autocomplete: "off",
                    "aria-label": _ctx.t('MAC address'),
                    onKeyup: _cache[111] || (_cache[111] = _withKeys((...args) => (_ctx.runMac && _ctx.runMac(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_438), [
                    [_vModelText, _ctx.macInput]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: !_ctx.macReady,
                    onClick: _cache[112] || (_cache[112] = (...args) => (_ctx.runMac && _ctx.runMac(...args)))
                  }, _toDisplayString(_ctx.t('Identify vendor')), 9 /* TEXT, PROPS */, _hoisted_439)
                ]),
                (_ctx.macResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_440, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.macResult.vendor || (_ctx.macResult.local ? _ctx.t('Randomised (privacy) address') : _ctx.t('Not registered'))), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Prefix')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.macResult.prefix), 1 /* TEXT */)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ server ============ "),
        _createCommentVNode(" ============ mail ============ "),
        (_ctx.tab==='mail')
          ? (_openBlock(), _createElementBlock("section", _hoisted_441, [
              _createElementVNode("div", _hoisted_442, [
                _createElementVNode("div", _hoisted_443, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailViews, (v) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: v.id,
                      class: _normalizeClass(["seg-btn", {active: _ctx.mailView===v.id}]),
                      onClick: $event => (_ctx.mailView=v.id)
                    }, _toDisplayString(_ctx.t(v.label)), 11 /* TEXT, CLASS, PROPS */, _hoisted_444))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.mailView==='domain')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_445, [
                      _createElementVNode("div", _hoisted_446, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[113] || (_cache[113] = $event => ((_ctx.mailDomain) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[114] || (_cache[114] = _withKeys((...args) => (_ctx.runMailAudit && _ctx.runMailAudit(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_447), [
                          [_vModelText, _ctx.mailDomain]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[115] || (_cache[115] = $event => ((_ctx.mailSelectors) = $event)),
                          class: "short",
                          placeholder: _ctx.t('DKIM selectors, comma separated')
                        }, null, 8 /* PROPS */, _hoisted_448), [
                          [_vModelText, _ctx.mailSelectors]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.mailAudit}]),
                          disabled: _ctx.busy.mailAudit,
                          onClick: _cache[116] || (_cache[116] = (...args) => (_ctx.runMailAudit && _ctx.runMailAudit(...args)))
                        }, _toDisplayString(_ctx.busy.mailAudit ? _ctx.t('Checking…') : _ctx.t('Check this domain')), 11 /* TEXT, CLASS, PROPS */, _hoisted_449)
                      ]),
                      _createElementVNode("label", _hoisted_450, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[117] || (_cache[117] = $event => ((_ctx.mailBlocklists) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.mailBlocklists]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Also ask the public blocklists about each MX address')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("p", _hoisted_451, _toDisplayString(_ctx.t('Reads only public DNS and, for MTA-STS, one HTTPS file. Nothing is sent to your servers.')), 1 /* TEXT */)
                    ]),
                    (_ctx.mailAudit)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_452, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('What this domain looks like to a receiving mail server')), 1 /* TEXT */),
                          _createElementVNode("div", _hoisted_453, [
                            (_ctx.mailAudit.score.bad)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_454, _toDisplayString(_ctx.mailAudit.score.bad) + " " + _toDisplayString(_ctx.t('to fix')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAudit.score.warn)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_455, _toDisplayString(_ctx.mailAudit.score.warn) + " " + _toDisplayString(_ctx.t('to look at')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAudit.score.ok)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_456, _toDisplayString(_ctx.mailAudit.score.ok) + " " + _toDisplayString(_ctx.t('fine')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true)
                          ]),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.findings, (f, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: _normalizeClass(["finding", f.level])
                            }, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", f.level])
                              }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                              _createElementVNode("div", null, [
                                _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                                _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                              ])
                            ], 2 /* CLASS */))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.mailAudit && _ctx.mailAudit.mx.length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_457, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Mail exchangers')), 1 /* TEXT */),
                          _createElementVNode("table", _hoisted_458, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Priority')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Address')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Reverse name')), 1 /* TEXT */),
                                _hoisted_459
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.mx, (m) => {
                                return (_openBlock(), _createElementBlock(_Fragment, {
                                  key: m.host
                                }, [
                                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((m.addresses.length ? m.addresses : [{}]), (a, j) => {
                                    return (_openBlock(), _createElementBlock("tr", {
                                      key: m.host + j
                                    }, [
                                      _createElementVNode("td", _hoisted_460, _toDisplayString(j === 0 ? m.priority : ''), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_461, _toDisplayString(j === 0 ? m.host : ''), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_462, _toDisplayString(a.ip || '—'), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_463, [
                                        _createTextVNode(_toDisplayString(a.ptr || '—') + " ", 1 /* TEXT */),
                                        (a.ptr)
                                          ? (_openBlock(), _createElementBlock("span", {
                                              key: 0,
                                              class: _normalizeClass(["pill", a.fcrdns ? 'ok' : 'no'])
                                            }, _toDisplayString(a.fcrdns ? _ctx.t('confirmed') : _ctx.t('not confirmed')), 3 /* TEXT, CLASS */))
                                          : _createCommentVNode("v-if", true)
                                      ]),
                                      _createElementVNode("td", null, [
                                        (j === 0)
                                          ? (_openBlock(), _createElementBlock("span", {
                                              key: 0,
                                              class: _normalizeClass(["pill", (_ctx.mailAudit.dane[m.host]||[]).length ? 'ok' : 'no'])
                                            }, _toDisplayString((_ctx.mailAudit.dane[m.host]||[]).length ? _ctx.t('TLSA published') : _ctx.t('none')), 3 /* TEXT, CLASS */))
                                          : _createCommentVNode("v-if", true)
                                      ])
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ], 64 /* STABLE_FRAGMENT */))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.mailAudit)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_464, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Published policies')), 1 /* TEXT */),
                          _createElementVNode("div", _hoisted_465, [
                            _createElementVNode("div", null, [
                              _hoisted_466,
                              _createElementVNode("code", _hoisted_467, _toDisplayString(_ctx.mailAudit.spf ? _ctx.mailAudit.spf.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            (_ctx.mailAudit.spf)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_468, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('SPF lookups')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.mailAudit.spf.lookups) + " / 10", 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("div", null, [
                              _hoisted_469,
                              _createElementVNode("code", _hoisted_470, _toDisplayString(_ctx.mailAudit.dmarc ? _ctx.mailAudit.dmarc.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_471,
                              _createElementVNode("code", _hoisted_472, _toDisplayString(_ctx.mailAudit.mtaSts ? _ctx.mailAudit.mtaSts.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_473,
                              _createElementVNode("code", _hoisted_474, _toDisplayString(_ctx.mailAudit.tlsRpt || _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_475,
                              _createElementVNode("code", _hoisted_476, _toDisplayString(_ctx.mailAudit.bimi || _ctx.t('not published')), 1 /* TEXT */)
                            ])
                          ]),
                          (_ctx.mailAudit.mtaSts && _ctx.mailAudit.mtaSts.policy)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_477, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('MTA-STS policy file')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_478, _toDisplayString(_ctx.mailAudit.mtaSts.policy), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.dkim.length)
                            ? (_openBlock(), _createElementBlock("h3", _hoisted_479, _toDisplayString(_ctx.t('DKIM keys')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.dkim.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_480, [
                                _createElementVNode("thead", null, [
                                  _createElementVNode("tr", null, [
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Selector')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Key size')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Record')), 1 /* TEXT */)
                                  ])
                                ]),
                                _createElementVNode("tbody", null, [
                                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.dkim, (k) => {
                                    return (_openBlock(), _createElementBlock("tr", {
                                      key: k.selector
                                    }, [
                                      _createElementVNode("td", _hoisted_481, _toDisplayString(k.selector), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_482, _toDisplayString(k.bits ? k.bits + ' bit' : '—'), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_483, _toDisplayString(k.record), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.srv.length)
                            ? (_openBlock(), _createElementBlock("h3", _hoisted_484, _toDisplayString(_ctx.t('Client autoconfiguration records')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.srv.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_485, [
                                _createElementVNode("thead", null, [
                                  _createElementVNode("tr", null, [
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Record')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Target')), 1 /* TEXT */),
                                    _createElementVNode("th", null, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */)
                                  ])
                                ]),
                                _createElementVNode("tbody", null, [
                                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.srv, (s, i) => {
                                    return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                      _createElementVNode("td", _hoisted_486, _toDisplayString(s.name), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_487, _toDisplayString(s.target), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_488, _toDisplayString(s.port), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.mailAudit && Object.keys(_ctx.mailAudit.blocklists).length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_489, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Blocklists')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.blocklists, (rows, ip) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: ip,
                              class: "bl-group"
                            }, [
                              _createElementVNode("strong", _hoisted_490, _toDisplayString(ip), 1 /* TEXT */),
                              _createElementVNode("div", _hoisted_491, [
                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(rows, (r) => {
                                  return (_openBlock(), _createElementBlock("span", {
                                    key: r.zone,
                                    class: _normalizeClass(["pill", r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')]),
                                    title: r.reason || r.zone
                                  }, _toDisplayString(r.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_492))
                                }), 128 /* KEYED_FRAGMENT */))
                              ])
                            ]))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _createElementVNode("p", _hoisted_493, _toDisplayString(_ctx.t('Grey means the list refused the query — that usually means this server asks a public resolver, not that the address is clean.')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.mailView==='server')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                    _createElementVNode("div", _hoisted_494, [
                      _createElementVNode("div", _hoisted_495, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[118] || (_cache[118] = $event => ((_ctx.mailHost) = $event)),
                          placeholder: _ctx.t('mail.example.com'),
                          onKeyup: _cache[119] || (_cache[119] = _withKeys((...args) => (_ctx.runMailProbe && _ctx.runMailProbe(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_496), [
                          [_vModelText, _ctx.mailHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[120] || (_cache[120] = $event => ((_ctx.mailProtocol) = $event)),
                          class: "short"
                        }, _hoisted_500, 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.mailProtocol]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[121] || (_cache[121] = $event => ((_ctx.mailMode) = $event)),
                          class: "short"
                        }, [
                          _createElementVNode("option", _hoisted_501, _toDisplayString(_ctx.t('Pick automatically')), 1 /* TEXT */),
                          _hoisted_502,
                          _hoisted_503,
                          _createElementVNode("option", _hoisted_504, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.mailMode]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[122] || (_cache[122] = $event => ((_ctx.mailPort) = $event)),
                          type: "number",
                          min: "0",
                          max: "65535",
                          class: "tiny",
                          placeholder: _ctx.t('Port')
                        }, null, 8 /* PROPS */, _hoisted_505), [
                          [
                            _vModelText,
                            _ctx.mailPort,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.mailProbe}]),
                          disabled: _ctx.busy.mailProbe,
                          onClick: _cache[123] || (_cache[123] = (...args) => (_ctx.runMailProbe && _ctx.runMailProbe(...args)))
                        }, _toDisplayString(_ctx.t('Test the server')), 11 /* TEXT, CLASS, PROPS */, _hoisted_506)
                      ]),
                      _createElementVNode("div", _hoisted_507, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailPresets, (p) => {
                          return (_openBlock(), _createElementBlock("button", {
                            class: "btn xs",
                            key: p.label,
                            onClick: $event => (_ctx.applyMailPreset(p))
                          }, _toDisplayString(p.label), 9 /* TEXT, PROPS */, _hoisted_508))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_ctx.mailProbeResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_509, [
                          (_ctx.mailProbeResult.error)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_510, "⚠ " + _toDisplayString(_ctx.mailProbeResult.error), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailProbeResult.findings, (f, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: _normalizeClass(["finding", f.level])
                            }, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", f.level])
                              }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                              _createElementVNode("div", null, [
                                _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                                _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                              ])
                            ], 2 /* CLASS */))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _createElementVNode("div", _hoisted_511, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Greeting')), 1 /* TEXT */),
                              _createElementVNode("code", _hoisted_512, _toDisplayString(_ctx.mailProbeResult.greeting), 1 /* TEXT */)
                            ]),
                            (_ctx.mailProbeResult.tls)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_513, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Encryption')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.mailProbeResult.tls.protocol) + " · " + _toDisplayString(_ctx.mailProbeResult.tls.cipher), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailProbeResult.tls && _ctx.mailProbeResult.tls.subject)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_514, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Certificate')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_515, _toDisplayString(_ctx.mailProbeResult.tls.subject) + " · " + _toDisplayString(_ctx.t('issued by')) + " " + _toDisplayString(_ctx.mailProbeResult.tls.issuer) + " · " + _toDisplayString(_ctx.t('{n} days left', {n: _ctx.mailProbeResult.tls.expiresIn})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            ((_ctx.mailProbeResult.auth||[]).length)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_516, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Sign-in methods')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString((_ctx.mailProbeResult.auth||[]).join(', ')), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Time taken')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.mailProbeResult.seconds) + " s", 1 /* TEXT */)
                            ])
                          ]),
                          _createElementVNode("details", null, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Capabilities')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_517, _toDisplayString(_ctx.capabilityText(_ctx.mailProbeResult.capabilities)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("details", null, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_518, _toDisplayString((_ctx.mailProbeResult.transcript||[]).join('\n')), 1 /* TEXT */)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_519, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Open relay test')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_520, _toDisplayString(_ctx.t('Offers the server a foreign sender and a foreign recipient and stops before anything is sent. Run it against your own server.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_521, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[124] || (_cache[124] = $event => ((_ctx.relayHost) = $event)),
                          placeholder: _ctx.t('mail.example.com')
                        }, null, 8 /* PROPS */, _hoisted_522), [
                          [_vModelText, _ctx.relayHost]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[125] || (_cache[125] = $event => ((_ctx.relayPort) = $event)),
                          type: "number",
                          class: "tiny",
                          min: "1",
                          max: "65535"
                        }, null, 512 /* NEED_PATCH */), [
                          [
                            _vModelText,
                            _ctx.relayPort,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn", {working: _ctx.busy.relay}]),
                          disabled: _ctx.busy.relay,
                          onClick: _cache[126] || (_cache[126] = (...args) => (_ctx.runRelay && _ctx.runRelay(...args)))
                        }, _toDisplayString(_ctx.t('Test for open relay')), 11 /* TEXT, CLASS, PROPS */, _hoisted_523)
                      ]),
                      (_ctx.relayResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_524, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.relayResult.findings, (f, i) => {
                              return (_openBlock(), _createElementBlock("div", {
                                key: i,
                                class: _normalizeClass(["finding", f.level])
                              }, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["pill", f.level])
                                }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                                _createElementVNode("div", null, [
                                  _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                                  _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                                ])
                              ], 2 /* CLASS */))
                            }), 128 /* KEYED_FRAGMENT */)),
                            (_ctx.relayResult.error)
                              ? (_openBlock(), _createElementBlock("p", _hoisted_525, "⚠ " + _toDisplayString(_ctx.relayResult.error), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.relayResult.transcript)
                              ? (_openBlock(), _createElementBlock("details", _hoisted_526, [
                                  _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                                  _createElementVNode("pre", _hoisted_527, _toDisplayString(_ctx.relayResult.transcript.join('\n')), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_528, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Blocklist lookup')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_529, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[127] || (_cache[127] = $event => ((_ctx.blIp) = $event)),
                          placeholder: _ctx.t('IPv4 address of a sending server'),
                          onKeyup: _cache[128] || (_cache[128] = _withKeys((...args) => (_ctx.runBlocklist && _ctx.runBlocklist(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_530), [
                          [_vModelText, _ctx.blIp]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn", {working: _ctx.busy.bl}]),
                          disabled: _ctx.busy.bl,
                          onClick: _cache[129] || (_cache[129] = (...args) => (_ctx.runBlocklist && _ctx.runBlocklist(...args)))
                        }, _toDisplayString(_ctx.t('Check')), 11 /* TEXT, CLASS, PROPS */, _hoisted_531)
                      ]),
                      (_ctx.blResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_532, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.blResult.results, (r) => {
                              return (_openBlock(), _createElementBlock("span", {
                                key: r.zone,
                                class: _normalizeClass(["pill", r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')]),
                                title: r.reason || r.zone
                              }, _toDisplayString(r.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_533))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.mailView==='send')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                    _createCommentVNode(" One address is one account: it is read with IMAP or POP3 and\n                 sent through SMTP, but it is the same person with the same\n                 password. So it is chosen once, on one card, and both halves\n                 are tested from there. "),
                    _createElementVNode("div", _hoisted_534, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Send and receive test')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_535, _toDisplayString(_ctx.t('One mail account, both directions: sign in to the mailbox, and send a real message through the same account.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_536, [
                        _createElementVNode("div", _hoisted_537, [
                          _createElementVNode("button", {
                            class: _normalizeClass(["seg-btn", {active: _ctx.acctMode === 'type'}]),
                            onClick: _cache[130] || (_cache[130] = $event => (_ctx.setAcctMode('type')))
                          }, _toDisplayString(_ctx.t('Enter it by hand')), 3 /* TEXT, CLASS */),
                          _createElementVNode("button", {
                            class: _normalizeClass(["seg-btn", {active: _ctx.acctMode === 'saved'}]),
                            onClick: _cache[131] || (_cache[131] = $event => (_ctx.setAcctMode('saved')))
                          }, _toDisplayString(_ctx.t('Pick from the list')), 3 /* TEXT, CLASS */)
                        ]),
                        _hoisted_538,
                        _createElementVNode("button", {
                          class: "btn sm",
                          onClick: _cache[132] || (_cache[132] = $event => (_ctx.openConn(null, _ctx.mailAdhoc.kind)))
                        }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */),
                        (_ctx.mailAccountSaved)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 0,
                              class: "btn sm",
                              onClick: _cache[133] || (_cache[133] = $event => (_ctx.openConn(_ctx.mailAccountSaved)))
                            }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      (_ctx.acctMode === 'saved' && _ctx.connLocked)
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                            _createElementVNode("p", _hoisted_539, _toDisplayString(_ctx.t('Please enter the RegiBase master key.')), 1 /* TEXT */),
                            _createElementVNode("div", _hoisted_540, [
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": _cache[134] || (_cache[134] = $event => ((_ctx.connMaster) = $event)),
                                type: "password",
                                class: "grow mono",
                                autocomplete: "new-password",
                                placeholder: _ctx.t('RegiBase master key'),
                                onKeyup: _cache[135] || (_cache[135] = _withKeys($event => (_ctx.unlockConns()), ["enter"]))
                              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_541), [
                                [_vModelText, _ctx.connMaster]
                              ]),
                              _createElementVNode("button", {
                                class: "btn sm",
                                disabled: !_ctx.connMaster || _ctx.busy.connsetup,
                                onClick: _cache[136] || (_cache[136] = $event => (_ctx.unlockConns()))
                              }, _toDisplayString(_ctx.t('Unlock')), 9 /* TEXT, PROPS */, _hoisted_542)
                            ]),
                            _createElementVNode("p", _hoisted_543, _toDisplayString(_ctx.t('This key lasts until you close the browser — this session only.')), 1 /* TEXT */)
                          ], 64 /* STABLE_FRAGMENT */))
                        : (_ctx.acctMode === 'saved')
                          ? (_openBlock(), _createElementBlock("div", _hoisted_544, [
                              _withDirectives(_createElementVNode("select", {
                                "onUpdate:modelValue": _cache[137] || (_cache[137] = $event => ((_ctx.mailAccountId) = $event)),
                                class: "grow"
                              }, [
                                _createElementVNode("option", _hoisted_545, _toDisplayString(_ctx.t('Not chosen yet')), 1 /* TEXT */),
                                (_ctx.mailAccounts.length)
                                  ? (_openBlock(), _createElementBlock("optgroup", {
                                      key: 0,
                                      label: _ctx.t('Saved connections')
                                    }, [
                                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAccounts, (c) => {
                                        return (_openBlock(), _createElementBlock("option", {
                                          key: c.id,
                                          value: c.id
                                        }, _toDisplayString(c.name) + " — " + _toDisplayString(c.kind.toUpperCase()) + " " + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_547))
                                      }), 128 /* KEYED_FRAGMENT */))
                                    ], 8 /* PROPS */, _hoisted_546))
                                  : _createCommentVNode("v-if", true)
                              ], 512 /* NEED_PATCH */), [
                                [
                                  _vModelSelect,
                                  _ctx.mailAccountId,
                                  void 0,
                                  { number: true }
                                ]
                              ])
                            ]))
                          : _createCommentVNode("v-if", true),
                      (_ctx.acctMode === 'saved' && !_ctx.connLocked && !_ctx.mailAccounts.length)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_548, _toDisplayString(_ctx.t('No saved connections yet — enter the address by hand instead.')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true),
                      (_ctx.acctMode === 'type')
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 3 }, [
                            _createElementVNode("p", _hoisted_549, _toDisplayString(_ctx.t('Where this address is read')), 1 /* TEXT */),
                            _createElementVNode("div", _hoisted_550, [
                              _withDirectives(_createElementVNode("select", {
                                "onUpdate:modelValue": _cache[138] || (_cache[138] = $event => ((_ctx.mailAdhoc.kind) = $event)),
                                class: "tiny",
                                onChange: _cache[139] || (_cache[139] = (...args) => (_ctx.mailKindChanged && _ctx.mailKindChanged(...args)))
                              }, [
                                _hoisted_551,
                                _hoisted_552,
                                _createElementVNode("option", _hoisted_553, _toDisplayString(_ctx.t('SMTP only (no mailbox)')), 1 /* TEXT */)
                              ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                                [_vModelSelect, _ctx.mailAdhoc.kind]
                              ]),
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": _cache[140] || (_cache[140] = $event => ((_ctx.mailAdhoc.host) = $event)),
                                class: "grow",
                                placeholder: "imap.example.com"
                              }, null, 512 /* NEED_PATCH */), [
                                [_vModelText, _ctx.mailAdhoc.host]
                              ]),
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": _cache[141] || (_cache[141] = $event => ((_ctx.mailAdhoc.port) = $event)),
                                type: "number",
                                class: "tiny",
                                min: "1",
                                max: "65535"
                              }, null, 512 /* NEED_PATCH */), [
                                [
                                  _vModelText,
                                  _ctx.mailAdhoc.port,
                                  void 0,
                                  { number: true }
                                ]
                              ]),
                              _withDirectives(_createElementVNode("select", {
                                "onUpdate:modelValue": _cache[142] || (_cache[142] = $event => ((_ctx.mailAdhoc.mode) = $event)),
                                class: "tiny"
                              }, [
                                _hoisted_554,
                                _hoisted_555,
                                _createElementVNode("option", _hoisted_556, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                              ], 512 /* NEED_PATCH */), [
                                [_vModelSelect, _ctx.mailAdhoc.mode]
                              ]),
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": _cache[143] || (_cache[143] = $event => ((_ctx.mailAdhoc.username) = $event)),
                                class: "short",
                                placeholder: _ctx.t('User name'),
                                autocomplete: "off"
                              }, null, 8 /* PROPS */, _hoisted_557), [
                                [_vModelText, _ctx.mailAdhoc.username]
                              ]),
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": _cache[144] || (_cache[144] = $event => ((_ctx.mailAdhoc.secret) = $event)),
                                type: "password",
                                class: "short",
                                placeholder: _ctx.t('Password'),
                                autocomplete: "new-password"
                              }, null, 8 /* PROPS */, _hoisted_558), [
                                [_vModelText, _ctx.mailAdhoc.secret]
                              ])
                            ]),
                            (_ctx.mailAdhoc.kind !== 'smtp')
                              ? (_openBlock(), _createElementBlock("p", _hoisted_559, _toDisplayString(_ctx.t('Where it sends from — the same user name and password')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAdhoc.kind !== 'smtp')
                              ? (_openBlock(), _createElementBlock("div", _hoisted_560, [
                                  _withDirectives(_createElementVNode("input", {
                                    "onUpdate:modelValue": _cache[145] || (_cache[145] = $event => ((_ctx.mailAdhoc.sendHost) = $event)),
                                    class: "grow",
                                    placeholder: "smtp.example.com"
                                  }, null, 512 /* NEED_PATCH */), [
                                    [_vModelText, _ctx.mailAdhoc.sendHost]
                                  ]),
                                  _withDirectives(_createElementVNode("input", {
                                    "onUpdate:modelValue": _cache[146] || (_cache[146] = $event => ((_ctx.mailAdhoc.sendPort) = $event)),
                                    type: "number",
                                    class: "tiny",
                                    min: "1",
                                    max: "65535"
                                  }, null, 512 /* NEED_PATCH */), [
                                    [
                                      _vModelText,
                                      _ctx.mailAdhoc.sendPort,
                                      void 0,
                                      { number: true }
                                    ]
                                  ]),
                                  _withDirectives(_createElementVNode("select", {
                                    "onUpdate:modelValue": _cache[147] || (_cache[147] = $event => ((_ctx.mailAdhoc.sendMode) = $event)),
                                    class: "tiny"
                                  }, [
                                    _hoisted_561,
                                    _hoisted_562,
                                    _createElementVNode("option", _hoisted_563, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                                  ], 512 /* NEED_PATCH */), [
                                    [_vModelSelect, _ctx.mailAdhoc.sendMode]
                                  ]),
                                  _withDirectives(_createElementVNode("input", {
                                    "onUpdate:modelValue": _cache[148] || (_cache[148] = $event => ((_ctx.mailAdhoc.from) = $event)),
                                    class: "short",
                                    placeholder: _ctx.t('Sender address')
                                  }, null, 8 /* PROPS */, _hoisted_564), [
                                    [_vModelText, _ctx.mailAdhoc.from]
                                  ]),
                                  _createElementVNode("button", {
                                    class: "btn sm",
                                    onClick: _cache[149] || (_cache[149] = $event => (_ctx.saveMailAdhoc()))
                                  }, _toDisplayString(_ctx.t('Save to the list')), 1 /* TEXT */)
                                ]))
                              : (_openBlock(), _createElementBlock("div", _hoisted_565, [
                                  _withDirectives(_createElementVNode("input", {
                                    "onUpdate:modelValue": _cache[150] || (_cache[150] = $event => ((_ctx.mailAdhoc.from) = $event)),
                                    class: "short",
                                    placeholder: _ctx.t('Sender address')
                                  }, null, 8 /* PROPS */, _hoisted_566), [
                                    [_vModelText, _ctx.mailAdhoc.from]
                                  ]),
                                  _createElementVNode("button", {
                                    class: "btn sm",
                                    onClick: _cache[151] || (_cache[151] = $event => (_ctx.saveMailAdhoc()))
                                  }, _toDisplayString(_ctx.t('Save to the list')), 1 /* TEXT */)
                                ]))
                          ], 64 /* STABLE_FRAGMENT */))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Receive')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_567, [
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn", {working: _ctx.busy.mailbox}]),
                          disabled: _ctx.busy.mailbox || !_ctx.mailCanReceive || (_ctx.acctMode === 'saved' ? !_ctx.mailAccountId : !_ctx.mailAdhoc.host),
                          onClick: _cache[152] || (_cache[152] = (...args) => (_ctx.runMailbox && _ctx.runMailbox(...args)))
                        }, _toDisplayString(_ctx.t('Sign in to the mailbox')), 11 /* TEXT, CLASS, PROPS */, _hoisted_568),
                        (!_ctx.mailCanReceive)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_569, _toDisplayString(_ctx.t('An SMTP-only connection has no mailbox to read.')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      (_ctx.mailboxResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_570, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.mailboxResult.ok ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.mailboxResult.ok ? _ctx.t('Signed in') : (_ctx.mailboxResult.error || _ctx.t('Failed'))), 3 /* TEXT, CLASS */)
                            ]),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.inbox)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_571, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Inbox')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} messages', {n: _ctx.mailboxResult.details.inbox.messages})) + " · " + _toDisplayString(_ctx.t('{n} unread', {n: _ctx.mailboxResult.details.inbox.unseen})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.mailbox)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_572, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Mailbox')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} messages', {n: _ctx.mailboxResult.details.mailbox.messages})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.folders)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_573, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Folders')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_574, _toDisplayString(_ctx.mailboxResult.details.folders.join(', ')), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Send')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_575, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[153] || (_cache[153] = $event => ((_ctx.sendTo) = $event)),
                          placeholder: _ctx.t('Recipient address')
                        }, null, 8 /* PROPS */, _hoisted_576), [
                          [_vModelText, _ctx.sendTo]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[154] || (_cache[154] = $event => ((_ctx.sendSubject) = $event)),
                          placeholder: _ctx.t('Subject (optional)')
                        }, null, 8 /* PROPS */, _hoisted_577), [
                          [_vModelText, _ctx.sendSubject]
                        ])
                      ]),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[155] || (_cache[155] = $event => ((_ctx.sendBody) = $event)),
                        rows: "3",
                        placeholder: _ctx.t('Message (optional)')
                      }, null, 8 /* PROPS */, _hoisted_578), [
                        [_vModelText, _ctx.sendBody]
                      ]),
                      _createElementVNode("div", _hoisted_579, [
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn primary", {working: _ctx.busy.send}]),
                          disabled: _ctx.busy.send || !_ctx.sendTo || (_ctx.acctMode === 'saved' ? !_ctx.mailAccountId : !_ctx.mailAdhoc.host),
                          onClick: _cache[156] || (_cache[156] = (...args) => (_ctx.runSend && _ctx.runSend(...args)))
                        }, _toDisplayString(_ctx.busy.send ? _ctx.t('Sending…') : _ctx.t('Send the test message')), 11 /* TEXT, CLASS, PROPS */, _hoisted_580)
                      ]),
                      (_ctx.sendResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_581, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.sendResult.ok ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.sendResult.ok ? _ctx.t('Accepted by the server') : (_ctx.sendResult.error || _ctx.t('Failed'))), 3 /* TEXT, CLASS */)
                            ]),
                            (_ctx.sendResult.reply)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_582, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Reply')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_583, _toDisplayString(_ctx.sendResult.reply), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.sendResult && _ctx.sendResult.transcript)
                        ? (_openBlock(), _createElementBlock("details", _hoisted_584, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_585, _toDisplayString(_ctx.sendResult.transcript.join('\n')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ clock check ============ "),
        (_ctx.tab==='ntp')
          ? (_openBlock(), _createElementBlock("section", _hoisted_586, [
              _createElementVNode("div", _hoisted_587, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Clock check (NTP)')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_588, _toDisplayString(_ctx.t('A clock that has drifted is behind more certificate and sign-in failures than anything else.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_589, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[157] || (_cache[157] = $event => ((_ctx.ntpHost) = $event)),
                    class: "short"
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.ntpServers, (s) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: s.host,
                        value: s.host
                      }, _toDisplayString(s.host) + " — " + _toDisplayString(s.label), 9 /* TEXT, PROPS */, _hoisted_590))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.ntpHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[158] || (_cache[158] = $event => ((_ctx.ntpHost) = $event)),
                    placeholder: _ctx.t('pool.ntp.org'),
                    onKeyup: _cache[159] || (_cache[159] = _withKeys((...args) => (_ctx.runNtp && _ctx.runNtp(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_591), [
                    [_vModelText, _ctx.ntpHost]
                  ]),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn", {working: _ctx.busy.ntp}]),
                    disabled: _ctx.busy.ntp,
                    onClick: _cache[160] || (_cache[160] = (...args) => (_ctx.runNtp && _ctx.runNtp(...args)))
                  }, _toDisplayString(_ctx.t('Compare clocks')), 11 /* TEXT, CLASS, PROPS */, _hoisted_592)
                ]),
                _createElementVNode("p", _hoisted_593, _toDisplayString(_ctx.t('Pick a well-known time server, or type any other.')), 1 /* TEXT */),
                (_ctx.ntpResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_594, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.ntpResult.findings||[]), (f, i) => {
                        return (_openBlock(), _createElementBlock("div", {
                          key: i,
                          class: _normalizeClass(["finding", f.level])
                        }, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["pill", f.level])
                          }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                          _createElementVNode("div", null, [
                            _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                            _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                          ])
                        ], 2 /* CLASS */))
                      }), 128 /* KEYED_FRAGMENT */)),
                      (_ctx.ntpResult.ok)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_595, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Offset')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.ntpResult.offsetSeconds) + " s", 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Round trip')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.ntpResult.roundTripMs) + " ms", 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Stratum')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.ntpResult.stratum), 1 /* TEXT */)
                            ])
                          ]))
                        : (_openBlock(), _createElementBlock("p", _hoisted_596, "⚠ " + _toDisplayString(_ctx.ntpResult.error), 1 /* TEXT */))
                    ]))
                  : _createCommentVNode("v-if", true)
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ FTP / SFTP / SCP ============ "),
        (_ctx.tab==='files')
          ? (_openBlock(), _createElementBlock("section", _hoisted_597, [
              _createCommentVNode(" The same shape as the SSH screen, in the same order: the choice\n               first, then the server, then what you do with it, all in one\n               card. Two screens doing the same job asked for it two different\n               ways, which is a thing to fix rather than to explain. "),
              _createElementVNode("div", _hoisted_598, [
                _createElementVNode("div", _hoisted_599, [
                  _createElementVNode("div", _hoisted_600, [
                    _createElementVNode("button", {
                      class: _normalizeClass(["seg-btn", {active: _ctx.filesMode === 'type'}]),
                      onClick: _cache[161] || (_cache[161] = $event => (_ctx.setFilesMode('type')))
                    }, _toDisplayString(_ctx.t('Enter it by hand')), 3 /* TEXT, CLASS */),
                    _createElementVNode("button", {
                      class: _normalizeClass(["seg-btn", {active: _ctx.filesMode === 'saved'}]),
                      onClick: _cache[162] || (_cache[162] = $event => (_ctx.setFilesMode('saved')))
                    }, _toDisplayString(_ctx.t('Pick from the list')), 3 /* TEXT, CLASS */)
                  ]),
                  _hoisted_601,
                  _createElementVNode("button", {
                    class: "btn sm",
                    onClick: _cache[163] || (_cache[163] = $event => (_ctx.openConn(null, _ctx.filesKind)))
                  }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */),
                  (_ctx.filesSaved)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn sm",
                        onClick: _cache[164] || (_cache[164] = $event => (_ctx.openConn(_ctx.filesSaved)))
                      }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  (_ctx.filesSaved)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 1,
                        class: _normalizeClass(["btn sm", {working: _ctx.busy.conntest}]),
                        disabled: _ctx.busy.conntest,
                        onClick: _cache[165] || (_cache[165] = $event => (_ctx.testConn(_ctx.filesSaved)))
                      }, _toDisplayString(_ctx.t('Test')), 11 /* TEXT, CLASS, PROPS */, _hoisted_602))
                    : _createCommentVNode("v-if", true)
                ]),
                (_ctx.filesMode === 'saved' && _ctx.connLocked)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("p", _hoisted_603, _toDisplayString(_ctx.t('Please enter the RegiBase master key.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_604, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[166] || (_cache[166] = $event => ((_ctx.connMaster) = $event)),
                          type: "password",
                          class: "grow mono",
                          autocomplete: "new-password",
                          placeholder: _ctx.t('RegiBase master key'),
                          onKeyup: _cache[167] || (_cache[167] = _withKeys($event => (_ctx.unlockConns()), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_605), [
                          [_vModelText, _ctx.connMaster]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          disabled: !_ctx.connMaster || _ctx.busy.connsetup,
                          onClick: _cache[168] || (_cache[168] = $event => (_ctx.unlockConns()))
                        }, _toDisplayString(_ctx.t('Unlock')), 9 /* TEXT, PROPS */, _hoisted_606)
                      ]),
                      _createElementVNode("p", _hoisted_607, _toDisplayString(_ctx.t('This key lasts until you close the browser — this session only.')), 1 /* TEXT */)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_ctx.filesMode === 'saved')
                    ? (_openBlock(), _createElementBlock("div", _hoisted_608, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[169] || (_cache[169] = $event => ((_ctx.filesKind) = $event)),
                          class: "tiny",
                          onChange: _cache[170] || (_cache[170] = (...args) => (_ctx.filesKindPicked && _ctx.filesKindPicked(...args)))
                        }, [
                          _hoisted_609,
                          (_ctx.connCaps.scp)
                            ? (_openBlock(), _createElementBlock("option", _hoisted_610, "SCP"))
                            : _createCommentVNode("v-if", true),
                          _hoisted_611
                        ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                          [_vModelSelect, _ctx.filesKind]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[171] || (_cache[171] = $event => ((_ctx.filesPick) = $event)),
                          class: "grow",
                          onChange: _cache[172] || (_cache[172] = (...args) => (_ctx.filesPicked && _ctx.filesPicked(...args)))
                        }, [
                          _createElementVNode("option", _hoisted_612, _toDisplayString(_ctx.t('Not chosen yet')), 1 /* TEXT */),
                          (_ctx.fileConnections.length)
                            ? (_openBlock(), _createElementBlock("optgroup", {
                                key: 0,
                                label: _ctx.t('Saved connections')
                              }, [
                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fileConnections, (c) => {
                                  return (_openBlock(), _createElementBlock("option", {
                                    key: 'c' + c.id,
                                    value: 'c' + c.id
                                  }, _toDisplayString(c.name) + " — " + _toDisplayString(c.kind.toUpperCase()) + " " + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_614))
                                }), 128 /* KEYED_FRAGMENT */))
                              ], 8 /* PROPS */, _hoisted_613))
                            : _createCommentVNode("v-if", true),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.hostChoices, (g) => {
                            return (_openBlock(), _createElementBlock("optgroup", {
                              key: g.label,
                              label: _ctx.t(g.label)
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(g.items, (o) => {
                                return (_openBlock(), _createElementBlock("option", {
                                  key: o.value,
                                  value: o.value
                                }, _toDisplayString(o.text), 9 /* TEXT, PROPS */, _hoisted_616))
                              }), 128 /* KEYED_FRAGMENT */))
                            ], 8 /* PROPS */, _hoisted_615))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                          [_vModelSelect, _ctx.filesPick]
                        ])
                      ]))
                    : _createCommentVNode("v-if", true),
                (_ctx.filesMode === 'saved' && !_ctx.connLocked && !_ctx.fileConnections.length && !_ctx.hostChoices.length)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_617, _toDisplayString(_ctx.t('No saved connections yet — enter the address by hand instead.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                (_ctx.filesMode === 'type')
                  ? (_openBlock(), _createElementBlock("div", _hoisted_618, [
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[173] || (_cache[173] = $event => ((_ctx.filesKind) = $event)),
                        class: "tiny",
                        onChange: _cache[174] || (_cache[174] = (...args) => (_ctx.filesKindPicked && _ctx.filesKindPicked(...args)))
                      }, [
                        _hoisted_619,
                        (_ctx.connCaps.scp)
                          ? (_openBlock(), _createElementBlock("option", _hoisted_620, "SCP"))
                          : _createCommentVNode("v-if", true),
                        _hoisted_621
                      ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelSelect, _ctx.filesKind]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[175] || (_cache[175] = $event => ((_ctx.adhoc.host) = $event)),
                        class: "grow",
                        placeholder: "server.example.com",
                        onKeyup: _cache[176] || (_cache[176] = _withKeys((...args) => (_ctx.quickConnect && _ctx.quickConnect(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.adhoc.host]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[177] || (_cache[177] = $event => ((_ctx.adhoc.port) = $event)),
                        type: "number",
                        class: "tiny",
                        min: "1",
                        max: "65535"
                      }, null, 512 /* NEED_PATCH */), [
                        [
                          _vModelText,
                          _ctx.adhoc.port,
                          void 0,
                          { number: true }
                        ]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[178] || (_cache[178] = $event => ((_ctx.adhoc.username) = $event)),
                        class: "short",
                        placeholder: _ctx.t('User name'),
                        autocomplete: "off"
                      }, null, 8 /* PROPS */, _hoisted_622), [
                        [_vModelText, _ctx.adhoc.username]
                      ])
                    ]))
                  : (_ctx.filesSaved)
                    ? (_openBlock(), _createElementBlock("div", _hoisted_623, [
                        _createElementVNode("strong", _hoisted_624, _toDisplayString(_ctx.filesSaved.kind.toUpperCase()) + " " + _toDisplayString(_ctx.filesSaved.username || _ctx.t('anonymous')) + "@" + _toDisplayString(_ctx.filesSaved.host) + ":" + _toDisplayString(_ctx.filesSaved.port), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_625, _toDisplayString(_ctx.t('Signs in with the password or key kept for it.')), 1 /* TEXT */)
                      ]))
                    : _createCommentVNode("v-if", true),
                (_ctx.filesMode === 'type')
                  ? (_openBlock(), _createElementBlock("div", _hoisted_626, [
                      (_ctx.adhoc.kind!=='ftp')
                        ? _withDirectives((_openBlock(), _createElementBlock("select", {
                            key: 0,
                            "onUpdate:modelValue": _cache[179] || (_cache[179] = $event => ((_ctx.adhoc.authType) = $event)),
                            class: "tiny"
                          }, [
                            _createElementVNode("option", _hoisted_627, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                            _createElementVNode("option", _hoisted_628, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                          ], 512 /* NEED_PATCH */)), [
                            [_vModelSelect, _ctx.adhoc.authType]
                          ])
                        : _createCommentVNode("v-if", true),
                      (_ctx.adhoc.kind==='ftp')
                        ? _withDirectives((_openBlock(), _createElementBlock("select", {
                            key: 1,
                            "onUpdate:modelValue": _cache[180] || (_cache[180] = $event => ((_ctx.adhoc.mode) = $event)),
                            class: "tiny"
                          }, [
                            _createElementVNode("option", _hoisted_629, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */),
                            _hoisted_630
                          ], 512 /* NEED_PATCH */)), [
                            [_vModelSelect, _ctx.adhoc.mode]
                          ])
                        : _createCommentVNode("v-if", true),
                      (_ctx.adhoc.authType==='key' && _ctx.adhoc.kind!=='ftp')
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[181] || (_cache[181] = $event => ((_ctx.adhoc.privateKeyPath) = $event)),
                              class: "grow mono",
                              placeholder: _ctx.t('Key file in your Nextcloud files')
                            }, null, 8 /* PROPS */, _hoisted_631), [
                              [_vModelText, _ctx.adhoc.privateKeyPath]
                            ]),
                            _createElementVNode("button", {
                              class: "btn sm",
                              onClick: _cache[182] || (_cache[182] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.adhoc.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                            }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */)
                          ], 64 /* STABLE_FRAGMENT */))
                        : _withDirectives((_openBlock(), _createElementBlock("input", {
                            key: 3,
                            "onUpdate:modelValue": _cache[183] || (_cache[183] = $event => ((_ctx.adhoc.secret) = $event)),
                            type: "password",
                            class: "short",
                            placeholder: _ctx.t('Password'),
                            autocomplete: "new-password"
                          }, null, 8 /* PROPS */, _hoisted_632)), [
                            [_vModelText, _ctx.adhoc.secret]
                          ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[184] || (_cache[184] = $event => ((_ctx.adhoc.path) = $event)),
                        class: "short mono",
                        placeholder: _ctx.t('Start folder (optional)')
                      }, null, 8 /* PROPS */, _hoisted_633), [
                        [_vModelText, _ctx.adhoc.path]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        disabled: !_ctx.adhoc.host,
                        onClick: _cache[185] || (_cache[185] = (...args) => (_ctx.saveAdhoc && _ctx.saveAdhoc(...args)))
                      }, _toDisplayString(_ctx.t('Save to the list')), 9 /* TEXT, PROPS */, _hoisted_634)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.filesMode === 'type' && _ctx.adhoc.kind==='ftp' && !_ctx.adhoc.username)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_635, _toDisplayString(_ctx.t('Leave the user name blank to sign in anonymously.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", _hoisted_636, [
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.browse}]),
                    disabled: _ctx.busy.browse || !_ctx.filesHostNow,
                    onClick: _cache[186] || (_cache[186] = (...args) => (_ctx.filesConnect && _ctx.filesConnect(...args)))
                  }, _toDisplayString(_ctx.t('Connect')), 11 /* TEXT, CLASS, PROPS */, _hoisted_637)
                ]),
                (!_ctx.connCaps.sftp && !_ctx.connCaps.ftp && !_ctx.connCaps.scp)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_638, _toDisplayString(_ctx.t('Neither FTP, SFTP nor SCP is available on this server.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createCommentVNode(" Only once something was actually opened. Choosing a saved\n               connection no longer connects on its own, so \"a connection is\n               chosen\" and \"a folder is open\" are different things now. "),
              _createCommentVNode(" Two panes: what you have on the left, what the server has on the\n               right, and the queue underneath. A file manager that shows only\n               the far end leaves you guessing what you are sending; showing\n               both is what every FTP client does, and it is what makes\n               dragging from one side to the other mean anything. "),
              (_ctx.filesData)
                ? (_openBlock(), _createElementBlock("div", _hoisted_639, [
                    _createElementVNode("div", _hoisted_640, [
                      _createElementVNode("div", _hoisted_641, [
                        _createElementVNode("strong", null, _toDisplayString(_ctx.t('Your Nextcloud files')), 1 /* TEXT */),
                        _hoisted_642,
                        _createElementVNode("button", {
                          class: "btn xs",
                          disabled: !_ctx.localData || _ctx.localData.parent === null,
                          onClick: _cache[187] || (_cache[187] = $event => (_ctx.browseLocal(_ctx.localData ? _ctx.localData.parent : '')))
                        }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_643),
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[188] || (_cache[188] = $event => (_ctx.browseLocal(_ctx.localPath)))
                        }, "⟳ " + _toDisplayString(_ctx.t('Refresh')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", _hoisted_644, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[189] || (_cache[189] = $event => ((_ctx.localPath) = $event)),
                          class: "mono",
                          placeholder: _ctx.t('Your Nextcloud files'),
                          onKeyup: _cache[190] || (_cache[190] = _withKeys($event => (_ctx.browseLocal(_ctx.localPath)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_645), [
                          [_vModelText, _ctx.localPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[191] || (_cache[191] = $event => (_ctx.browseLocal(_ctx.localPath)))
                        }, _toDisplayString(_ctx.t('Go')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", {
                        class: "pane-body",
                        onDragover: _cache[196] || (_cache[196] = _withModifiers($event => ($event.dataTransfer.dropEffect = 'copy'), ["prevent"])),
                        onDrop: _cache[197] || (_cache[197] = _withModifiers((...args) => (_ctx.dropOnLocal && _ctx.dropOnLocal(...args)), ["prevent"]))
                      }, [
                        _createElementVNode("table", _hoisted_646, [
                          _createElementVNode("thead", null, [
                            _createElementVNode("tr", null, [
                              _createElementVNode("th", null, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["th-line head", _ctx.localSortClass('name')]),
                                  onClick: _cache[192] || (_cache[192] = $event => (_ctx.sortLocal('name')))
                                }, _toDisplayString(_ctx.t('Name')), 3 /* TEXT, CLASS */)
                              ]),
                              _createElementVNode("th", null, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["th-line head", _ctx.localSortClass('size')]),
                                  onClick: _cache[193] || (_cache[193] = $event => (_ctx.sortLocal('size')))
                                }, _toDisplayString(_ctx.t('Size')), 3 /* TEXT, CLASS */)
                              ]),
                              _createElementVNode("th", null, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["th-line head", _ctx.localSortClass('modified')]),
                                  onClick: _cache[194] || (_cache[194] = $event => (_ctx.sortLocal('modified')))
                                }, _toDisplayString(_ctx.t('Changed')), 3 /* TEXT, CLASS */)
                              ])
                            ])
                          ]),
                          _createElementVNode("tbody", null, [
                            (_ctx.localData && _ctx.localData.parent !== null)
                              ? (_openBlock(), _createElementBlock("tr", {
                                  key: 0,
                                  class: "dir up-row",
                                  onClick: _cache[195] || (_cache[195] = $event => (_ctx.browseLocal(_ctx.localData.parent)))
                                }, _hoisted_648))
                              : _createCommentVNode("v-if", true),
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sortedLocal, (e) => {
                              return (_openBlock(), _createElementBlock("tr", {
                                key: e.name,
                                class: _normalizeClass({dir: e.directory, picked: !!_ctx.localPicked[e.name]}),
                                draggable: "true",
                                onDragstart: $event => (_ctx.startFileDrag('local', e, $event)),
                                onClick: $event => (_ctx.pickRow('local', e, $event)),
                                onDblclick: $event => (e.directory ? _ctx.browseLocal(e.path) : null)
                              }, [
                                _createElementVNode("td", null, [
                                  _createElementVNode("span", _hoisted_650, _toDisplayString(e.directory ? '📁' : '📄') + " " + _toDisplayString(e.name), 1 /* TEXT */)
                                ]),
                                _createElementVNode("td", _hoisted_651, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_652, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */)
                              ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_649))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]),
                        (_ctx.localData && !_ctx.sortedLocal.length)
                          ? (_openBlock(), _createElementBlock("p", _hoisted_653, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ], 32 /* NEED_HYDRATION */),
                      _createElementVNode("div", _hoisted_654, [
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[198] || (_cache[198] = $event => (_ctx.pickAll('local')))
                        }, _toDisplayString(_ctx.t('Select all')), 1 /* TEXT */),
                        (_ctx.localCount)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_655, _toDisplayString(_ctx.t('{n} chosen', {n: _ctx.localCount})), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _hoisted_656,
                        _createElementVNode("button", {
                          class: "btn sm primary",
                          disabled: !_ctx.localCount,
                          onClick: _cache[199] || (_cache[199] = $event => (_ctx.enqueue('local')))
                        }, "⤒ " + _toDisplayString(_ctx.t('Send')), 9 /* TEXT, PROPS */, _hoisted_657)
                      ])
                    ]),
                    _createElementVNode("div", _hoisted_658, [
                      _createElementVNode("div", _hoisted_659, [
                        _createElementVNode("strong", _hoisted_660, _toDisplayString(_ctx.filesSaved ? _ctx.filesSaved.host : _ctx.adhoc.host), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_661, _toDisplayString((_ctx.filesSaved ? _ctx.filesSaved.kind : _ctx.adhoc.kind).toUpperCase()), 1 /* TEXT */),
                        _hoisted_662,
                        (_ctx.canElevate)
                          ? (_openBlock(), _createElementBlock("label", {
                              key: 0,
                              class: "inline-check",
                              title: _ctx.t('Runs the listing and the file actions through sudo on the far end. The password is used for that one request and kept nowhere.')
                            }, [
                              _withDirectives(_createElementVNode("input", {
                                type: "checkbox",
                                "onUpdate:modelValue": _cache[200] || (_cache[200] = $event => ((_ctx.asRoot) = $event)),
                                onChange: _cache[201] || (_cache[201] = $event => (_ctx.rootToggled()))
                              }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                                [_vModelCheckbox, _ctx.asRoot]
                              ]),
                              _createTextVNode(" " + _toDisplayString(_ctx.t('Act as root')), 1 /* TEXT */)
                            ], 8 /* PROPS */, _hoisted_663))
                          : _createCommentVNode("v-if", true),
                        _createElementVNode("button", {
                          class: "btn xs",
                          disabled: !_ctx.filesData || !_ctx.filesData.parent,
                          onClick: _cache[202] || (_cache[202] = $event => (_ctx.browse(_ctx.filesData ? _ctx.filesData.parent : '')))
                        }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_664),
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[203] || (_cache[203] = $event => (_ctx.browse(_ctx.filesData ? _ctx.filesData.path : _ctx.filesPath)))
                        }, "⟳ " + _toDisplayString(_ctx.t('Refresh')), 1 /* TEXT */),
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[204] || (_cache[204] = $event => (_ctx.fileAction('mkdir')))
                        }, _toDisplayString(_ctx.t('New folder')), 1 /* TEXT */),
                        (_ctx.adhocActive)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 1,
                              class: "btn xs",
                              onClick: _cache[205] || (_cache[205] = (...args) => (_ctx.disconnect && _ctx.disconnect(...args)))
                            }, _toDisplayString(_ctx.t('Disconnect')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      _createElementVNode("div", _hoisted_665, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[206] || (_cache[206] = $event => ((_ctx.filesPath) = $event)),
                          class: "mono",
                          onKeyup: _cache[207] || (_cache[207] = _withKeys($event => (_ctx.browse(_ctx.filesPath)), ["enter"]))
                        }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                          [_vModelText, _ctx.filesPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[208] || (_cache[208] = $event => (_ctx.browse(_ctx.filesPath)))
                        }, _toDisplayString(_ctx.t('Go')), 1 /* TEXT */)
                      ]),
                      (_ctx.asRoot && !_ctx.sudoPassword)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_666, _toDisplayString(_ctx.t('Enter the sudo password for this server. It is used for this one request and is never stored — you will be asked again next time.')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true),
                      (_ctx.asRoot && !_ctx.sudoPassword)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_667, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[209] || (_cache[209] = $event => ((_ctx.sudoDraft) = $event)),
                              type: "password",
                              class: "grow mono",
                              autocomplete: "new-password",
                              placeholder: _ctx.t('sudo password'),
                              onKeyup: _cache[210] || (_cache[210] = _withKeys($event => (_ctx.useSudo()), ["enter"]))
                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_668), [
                              [_vModelText, _ctx.sudoDraft]
                            ]),
                            _createElementVNode("button", {
                              class: "btn sm",
                              disabled: !_ctx.sudoDraft,
                              onClick: _cache[211] || (_cache[211] = $event => (_ctx.useSudo()))
                            }, _toDisplayString(_ctx.t('Use it')), 9 /* TEXT, PROPS */, _hoisted_669),
                            _createElementVNode("button", {
                              class: "btn sm",
                              onClick: _cache[212] || (_cache[212] = $event => {_ctx.asRoot = false; _ctx.sudoDraft = ''})
                            }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.asRoot && _ctx.sudoPassword)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_670, [
                            _createTextVNode(" 🔓 " + _toDisplayString(_ctx.t('Acting as root. The password is held only while this page stays open.')) + " ", 1 /* TEXT */),
                            (_ctx.rootLeft)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_671, _toDisplayString(_ctx.t('Given up in {n} min with nothing touched.', {n: _ctx.rootLeft})), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("button", {
                              class: "btn sm danger",
                              onClick: _cache[213] || (_cache[213] = $event => (_ctx.forgetSudo()))
                            }, _toDisplayString(_ctx.t('Give up root now')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", {
                        class: "pane-body",
                        onDragover: _cache[218] || (_cache[218] = _withModifiers($event => ($event.dataTransfer.dropEffect = 'copy'), ["prevent"])),
                        onDrop: _cache[219] || (_cache[219] = _withModifiers((...args) => (_ctx.dropOnRemote && _ctx.dropOnRemote(...args)), ["prevent"]))
                      }, [
                        _createElementVNode("table", _hoisted_672, [
                          _createElementVNode("thead", null, [
                            _createElementVNode("tr", null, [
                              _createElementVNode("th", null, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["th-line head", _ctx.fileSortClass('name')]),
                                  onClick: _cache[214] || (_cache[214] = $event => (_ctx.sortFiles('name')))
                                }, _toDisplayString(_ctx.t('Name')), 3 /* TEXT, CLASS */)
                              ]),
                              _createElementVNode("th", null, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["th-line head", _ctx.fileSortClass('size')]),
                                  onClick: _cache[215] || (_cache[215] = $event => (_ctx.sortFiles('size')))
                                }, _toDisplayString(_ctx.t('Size')), 3 /* TEXT, CLASS */)
                              ]),
                              _createElementVNode("th", null, [
                                _createElementVNode("span", {
                                  class: _normalizeClass(["th-line head", _ctx.fileSortClass('modified')]),
                                  onClick: _cache[216] || (_cache[216] = $event => (_ctx.sortFiles('modified')))
                                }, _toDisplayString(_ctx.t('Changed')), 3 /* TEXT, CLASS */)
                              ]),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Rights')), 1 /* TEXT */),
                              _createElementVNode("th", _hoisted_673, _toDisplayString(_ctx.t('Owner')), 1 /* TEXT */)
                            ])
                          ]),
                          _createElementVNode("tbody", null, [
                            (_ctx.filesData.parent)
                              ? (_openBlock(), _createElementBlock("tr", {
                                  key: 0,
                                  class: "dir up-row",
                                  onClick: _cache[217] || (_cache[217] = $event => (_ctx.browse(_ctx.filesData.parent)))
                                }, _hoisted_675))
                              : _createCommentVNode("v-if", true),
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sortedFiles, (e) => {
                              return (_openBlock(), _createElementBlock("tr", {
                                key: e.name,
                                class: _normalizeClass({dir: e.directory, picked: !!_ctx.remotePicked[e.name]}),
                                draggable: "true",
                                onDragstart: $event => (_ctx.startFileDrag('remote', e, $event)),
                                onClick: $event => (_ctx.pickRow('remote', e, $event)),
                                onDblclick: $event => (_ctx.openEntry(e)),
                                onContextmenu: _withModifiers($event => (_ctx.openFileMenu(e, $event)), ["prevent"])
                              }, [
                                _createElementVNode("td", null, [
                                  _createElementVNode("span", _hoisted_677, _toDisplayString(e.directory ? '📁' : '📄') + " " + _toDisplayString(e.name), 1 /* TEXT */)
                                ]),
                                _createElementVNode("td", _hoisted_678, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_679, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_680, _toDisplayString(e.permissions), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_681, _toDisplayString(e.owner || ''), 1 /* TEXT */)
                              ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_676))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]),
                        (_ctx.filesData && !_ctx.sortedFiles.length)
                          ? (_openBlock(), _createElementBlock("p", _hoisted_682, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ], 32 /* NEED_HYDRATION */),
                      _createElementVNode("div", _hoisted_683, [
                        _createElementVNode("button", {
                          class: "btn xs",
                          onClick: _cache[220] || (_cache[220] = $event => (_ctx.pickAll('remote')))
                        }, _toDisplayString(_ctx.t('Select all')), 1 /* TEXT */),
                        (_ctx.remoteCount)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_684, _toDisplayString(_ctx.t('{n} chosen', {n: _ctx.remoteCount})), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _hoisted_685,
                        _createElementVNode("button", {
                          class: "btn sm primary",
                          disabled: !_ctx.remoteCount,
                          onClick: _cache[221] || (_cache[221] = $event => (_ctx.enqueue('remote')))
                        }, "⤓ " + _toDisplayString(_ctx.t('Receive')), 9 /* TEXT, PROPS */, _hoisted_686)
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.filesData)
                ? (_openBlock(), _createElementBlock("div", _hoisted_687, [
                    _createElementVNode("div", _hoisted_688, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[222] || (_cache[222] = $event => ((_ctx.filesTarget) = $event)),
                        class: "short mono",
                        placeholder: _ctx.t('Nextcloud folder for downloads')
                      }, null, 8 /* PROPS */, _hoisted_689), [
                        [_vModelText, _ctx.filesTarget]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[223] || (_cache[223] = $event => {_ctx.pickFile('Choose a folder for downloads', (p) => { _ctx.filesTarget = p; _ctx.browseLocal(p); }, true)})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                      _createElementVNode("label", _hoisted_690, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[224] || (_cache[224] = $event => ((_ctx.showHidden) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.showHidden]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Show hidden files')), 1 /* TEXT */)
                      ]),
                      _hoisted_691,
                      _createElementVNode("span", _hoisted_692, _toDisplayString(_ctx.t('Double-click a folder to open it. Right-click a row for what can be done with it. Drag between the panes to transfer.')), 1 /* TEXT */)
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createCommentVNode(" What is being moved, and what has been. A transfer that says\n               nothing for a minute is indistinguishable from one that has\n               hung, so this says how far along it is, how fast, and how much\n               longer — and can be stopped. "),
              (_ctx.queue.length || _ctx.queueDone.length)
                ? (_openBlock(), _createElementBlock("div", _hoisted_693, [
                    _createElementVNode("div", _hoisted_694, [
                      _createElementVNode("strong", null, _toDisplayString(_ctx.t('Transfers')), 1 /* TEXT */),
                      (_ctx.queueSummary && _ctx.queueSummary.waiting)
                        ? (_openBlock(), _createElementBlock("span", _hoisted_695, _toDisplayString(_ctx.t('{n} waiting', {n: _ctx.queueSummary.waiting})), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true),
                      _hoisted_696,
                      (_ctx.queue.length)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 1,
                            class: "btn sm danger",
                            onClick: _cache[225] || (_cache[225] = (...args) => (_ctx.stopQueue && _ctx.stopQueue(...args)))
                          }, _toDisplayString(_ctx.t('Stop')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true),
                      (_ctx.queueDone.length)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 2,
                            class: "btn sm",
                            onClick: _cache[226] || (_cache[226] = (...args) => (_ctx.clearQueueDone && _ctx.clearQueueDone(...args)))
                          }, _toDisplayString(_ctx.t('Clear finished')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ]),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.queue, (j) => {
                      return (_openBlock(), _createElementBlock("div", {
                        class: "job",
                        key: j.id
                      }, [
                        _createElementVNode("span", _hoisted_697, _toDisplayString(j.direction === 'up' ? '⤒' : '⤓'), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_698, _toDisplayString(j.name), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_699, [
                          _createElementVNode("span", {
                            class: "fill",
                            style: _normalizeStyle({ width: _ctx.jobPercent(j) + '%' })
                          }, null, 4 /* STYLE */)
                        ]),
                        _createElementVNode("span", _hoisted_700, _toDisplayString(_ctx.jobPercent(j)) + "%", 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_701, _toDisplayString(j.state === 'running' ? _ctx.jobRate(j) : _ctx.t('Waiting')), 1 /* TEXT */)
                      ]))
                    }), 128 /* KEYED_FRAGMENT */)),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.queueDone, (j) => {
                      return (_openBlock(), _createElementBlock("div", {
                        class: "job done",
                        key: 'd' + j.id
                      }, [
                        _createElementVNode("span", _hoisted_702, _toDisplayString(j.state === 'failed' ? '⚠' : (j.state === 'stopped' ? '⊘' : (j.direction === 'up' ? '⤒' : '⤓'))), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_703, _toDisplayString(j.name), 1 /* TEXT */),
                        (j.state === 'failed')
                          ? (_openBlock(), _createElementBlock("span", _hoisted_704, _toDisplayString(j.error), 1 /* TEXT */))
                          : (j.state === 'stopped')
                            ? (_openBlock(), _createElementBlock("span", _hoisted_705, _toDisplayString(_ctx.t('Stopped')), 1 /* TEXT */))
                            : (_openBlock(), _createElementBlock("span", _hoisted_706, _toDisplayString(_ctx.fmtBytes(j.done)), 1 /* TEXT */))
                      ]))
                    }), 128 /* KEYED_FRAGMENT */))
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ SSH / Telnet / NTP ============ "),
        (_ctx.tab==='ssh')
          ? (_openBlock(), _createElementBlock("section", _hoisted_707, [
              _createCommentVNode(" The page does two different jobs and used to run them together:\n               looking at a server, which needs nothing, and working on it,\n               which needs an account. Each is now under its own heading, and\n               the host typed above is carried down so the two are visibly the\n               same machine. "),
              _createCommentVNode(" ============ one server, and what you want to do with it ============\n               This was three cards: a probe that needs no account, a box for\n               details typed on the spot, and a list of saved connections. Each\n               asked for the machine again. Now the machine is named once — from\n               the saved list, from the devices NetBase has found, or typed — and\n               everything that can be done to it sits underneath. What needs an\n               account is still gated on the account: a reader who may probe but\n               not sign in sees the top half and nothing more. "),
              _createElementVNode("div", _hoisted_708, [
                _createCommentVNode(" Which way the server is named is a choice, and it is shown as\n                 one. It used to be the first entry of the list of saved\n                 connections: choosing a saved one made the typing fields\n                 vanish, with nothing on screen to say they could come back, so\n                 they read as deleted — and Telnet, which is only ever typed in,\n                 looked unreachable. "),
                _createElementVNode("div", _hoisted_709, [
                  _createElementVNode("div", _hoisted_710, [
                    _createElementVNode("button", {
                      class: _normalizeClass(["seg-btn", {active: _ctx.sshMode === 'type'}]),
                      onClick: _cache[227] || (_cache[227] = $event => (_ctx.setSshMode('type')))
                    }, _toDisplayString(_ctx.t('Enter it by hand')), 3 /* TEXT, CLASS */),
                    _createElementVNode("button", {
                      class: _normalizeClass(["seg-btn", {active: _ctx.sshMode === 'saved'}]),
                      onClick: _cache[228] || (_cache[228] = $event => (_ctx.setSshMode('saved')))
                    }, _toDisplayString(_ctx.t('Pick from the list')), 3 /* TEXT, CLASS */)
                  ]),
                  _hoisted_711,
                  (_ctx.allowed('sshexec'))
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn sm",
                        onClick: _cache[229] || (_cache[229] = $event => (_ctx.openConn(null,'ssh')))
                      }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  (_ctx.allowed('sshexec') && _ctx.sshSaved)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 1,
                        class: "btn sm",
                        onClick: _cache[230] || (_cache[230] = $event => (_ctx.openConn(_ctx.sshSaved)))
                      }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true)
                ]),
                _createCommentVNode(" One list, everything in it: the connections saved in RegiBase,\n                 the devices NetBase has found, and whatever was asked about\n                 last. Splitting it in two — saved here, devices there — was a\n                 step backwards; a reader looking for a machine should not have\n                 to know which half NetBase filed it under. "),
                _createCommentVNode(" A list you can choose from but cannot connect with is worse\n                 than no list: the names are not secret, but the passwords and\n                 keys are, so the saved entries were selectable and then failed\n                 at the moment of use. The key is asked for here instead. "),
                (_ctx.sshMode === 'saved' && _ctx.connLocked)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("p", _hoisted_712, _toDisplayString(_ctx.t('Please enter the RegiBase master key.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_713, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[231] || (_cache[231] = $event => ((_ctx.connMaster) = $event)),
                          type: "password",
                          class: "grow mono",
                          autocomplete: "new-password",
                          placeholder: _ctx.t('RegiBase master key'),
                          onKeyup: _cache[232] || (_cache[232] = _withKeys($event => (_ctx.unlockConns()), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_714), [
                          [_vModelText, _ctx.connMaster]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          disabled: !_ctx.connMaster || _ctx.busy.connsetup,
                          onClick: _cache[233] || (_cache[233] = $event => (_ctx.unlockConns()))
                        }, _toDisplayString(_ctx.t('Unlock')), 9 /* TEXT, PROPS */, _hoisted_715)
                      ]),
                      _createElementVNode("p", _hoisted_716, _toDisplayString(_ctx.t('This key lasts until you close the browser — this session only.')), 1 /* TEXT */)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_ctx.sshMode === 'saved')
                    ? (_openBlock(), _createElementBlock("div", _hoisted_717, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[234] || (_cache[234] = $event => ((_ctx.sshPick) = $event)),
                          class: "grow",
                          onChange: _cache[235] || (_cache[235] = (...args) => (_ctx.sshPicked && _ctx.sshPicked(...args)))
                        }, [
                          _createElementVNode("option", _hoisted_718, _toDisplayString(_ctx.t('Not chosen yet')), 1 /* TEXT */),
                          (_ctx.sshConnections.length)
                            ? (_openBlock(), _createElementBlock("optgroup", {
                                key: 0,
                                label: _ctx.t('Saved connections')
                              }, [
                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshConnections, (c) => {
                                  return (_openBlock(), _createElementBlock("option", {
                                    key: 'c' + c.id,
                                    value: 'c' + c.id
                                  }, _toDisplayString(c.name) + " — " + _toDisplayString(c.username) + "@" + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_720))
                                }), 128 /* KEYED_FRAGMENT */))
                              ], 8 /* PROPS */, _hoisted_719))
                            : _createCommentVNode("v-if", true),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.hostChoices, (g) => {
                            return (_openBlock(), _createElementBlock("optgroup", {
                              key: g.label,
                              label: _ctx.t(g.label)
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(g.items, (o) => {
                                return (_openBlock(), _createElementBlock("option", {
                                  key: o.value,
                                  value: o.value
                                }, _toDisplayString(o.text), 9 /* TEXT, PROPS */, _hoisted_722))
                              }), 128 /* KEYED_FRAGMENT */))
                            ], 8 /* PROPS */, _hoisted_721))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                          [_vModelSelect, _ctx.sshPick]
                        ])
                      ]))
                    : _createCommentVNode("v-if", true),
                (_ctx.sshMode === 'saved' && !_ctx.connLocked && !_ctx.sshConnections.length && !_ctx.hostChoices.length)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_723, _toDisplayString(_ctx.t('No saved connections yet — enter the address by hand instead.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                (_ctx.sshMode === 'type')
                  ? (_openBlock(), _createElementBlock("div", _hoisted_724, [
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[236] || (_cache[236] = $event => ((_ctx.sshAdhoc.kind) = $event)),
                        class: "tiny",
                        onChange: _cache[237] || (_cache[237] = $event => (_ctx.sshKindChanged()))
                      }, _hoisted_727, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelSelect, _ctx.sshAdhoc.kind]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[238] || (_cache[238] = $event => ((_ctx.sshAdhoc.host) = $event)),
                        class: "grow",
                        placeholder: _ctx.t('Host name or IP address'),
                        onKeyup: _cache[239] || (_cache[239] = _withKeys((...args) => (_ctx.runSsh && _ctx.runSsh(...args)), ["enter"]))
                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_728), [
                        [_vModelText, _ctx.sshAdhoc.host]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[240] || (_cache[240] = $event => ((_ctx.sshAdhoc.port) = $event)),
                        type: "number",
                        class: "tiny",
                        min: "1",
                        max: "65535"
                      }, null, 512 /* NEED_PATCH */), [
                        [
                          _vModelText,
                          _ctx.sshAdhoc.port,
                          void 0,
                          { number: true }
                        ]
                      ]),
                      (_ctx.allowed('sshexec') && _ctx.sshAdhoc.kind !== 'telnet')
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[241] || (_cache[241] = $event => ((_ctx.sshAdhoc.username) = $event)),
                              class: "short",
                              placeholder: _ctx.t('User name'),
                              autocomplete: "off"
                            }, null, 8 /* PROPS */, _hoisted_729), [
                              [_vModelText, _ctx.sshAdhoc.username]
                            ]),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[242] || (_cache[242] = $event => ((_ctx.sshAdhoc.authType) = $event)),
                              class: "tiny"
                            }, [
                              _createElementVNode("option", _hoisted_730, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_731, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.sshAdhoc.authType]
                            ])
                          ], 64 /* STABLE_FRAGMENT */))
                        : _createCommentVNode("v-if", true)
                    ]))
                  : (_ctx.sshSaved)
                    ? (_openBlock(), _createElementBlock("div", _hoisted_732, [
                        _createElementVNode("strong", _hoisted_733, _toDisplayString(_ctx.sshSaved.kind.toUpperCase()) + " " + _toDisplayString(_ctx.sshSaved.username) + "@" + _toDisplayString(_ctx.sshSaved.host) + ":" + _toDisplayString(_ctx.sshSaved.port || 22), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_734, _toDisplayString(_ctx.t('Signs in with the password or key kept for it.')), 1 /* TEXT */)
                      ]))
                    : _createCommentVNode("v-if", true),
                (_ctx.sshMode === 'type' && _ctx.allowed('sshexec') && _ctx.sshAdhoc.kind !== 'telnet')
                  ? (_openBlock(), _createElementBlock("div", _hoisted_735, [
                      (_ctx.sshAdhoc.authType === 'key')
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[243] || (_cache[243] = $event => ((_ctx.sshAdhoc.privateKeyPath) = $event)),
                              class: "grow mono",
                              placeholder: _ctx.t('Key file in your Nextcloud files')
                            }, null, 8 /* PROPS */, _hoisted_736), [
                              [_vModelText, _ctx.sshAdhoc.privateKeyPath]
                            ]),
                            _createElementVNode("button", {
                              class: "btn sm",
                              onClick: _cache[244] || (_cache[244] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (path) => { _ctx.sshAdhoc.privateKeyPath = path; }, false, _ctx.settings.keyFolder)})
                            }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[245] || (_cache[245] = $event => ((_ctx.sshAdhoc.passphrase) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Key passphrase (if any)'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_737), [
                              [_vModelText, _ctx.sshAdhoc.passphrase]
                            ])
                          ], 64 /* STABLE_FRAGMENT */))
                        : _withDirectives((_openBlock(), _createElementBlock("input", {
                            key: 1,
                            "onUpdate:modelValue": _cache[246] || (_cache[246] = $event => ((_ctx.sshAdhoc.secret) = $event)),
                            type: "password",
                            class: "short",
                            placeholder: _ctx.t('Password'),
                            autocomplete: "new-password"
                          }, null, 8 /* PROPS */, _hoisted_738)), [
                            [_vModelText, _ctx.sshAdhoc.secret]
                          ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        disabled: !_ctx.sshAdhoc.host,
                        onClick: _cache[247] || (_cache[247] = (...args) => (_ctx.saveSshAdhoc && _ctx.saveSshAdhoc(...args)))
                      }, _toDisplayString(_ctx.t('Save to the list')), 9 /* TEXT, PROPS */, _hoisted_739)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.sshMode === 'type' && _ctx.sshAdhoc.kind === 'telnet')
                  ? (_openBlock(), _createElementBlock("p", _hoisted_740, _toDisplayString(_ctx.t('Telnet asks who you are inside the window, and carries everything in the clear.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                _createCommentVNode(" Looking costs nothing and needs no account; signing in does. "),
                _createElementVNode("div", _hoisted_741, [
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn primary", {working: _ctx.busy.ssh}]),
                    disabled: _ctx.busy.ssh || !_ctx.sshHostNow,
                    onClick: _cache[248] || (_cache[248] = (...args) => (_ctx.runSsh && _ctx.runSsh(...args)))
                  }, _toDisplayString(_ctx.t('Inspect SSH')), 11 /* TEXT, CLASS, PROPS */, _hoisted_742),
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn", {working: _ctx.busy.telnet}]),
                    disabled: _ctx.busy.telnet || !_ctx.sshHostNow,
                    onClick: _cache[249] || (_cache[249] = (...args) => (_ctx.runTelnet && _ctx.runTelnet(...args)))
                  }, _toDisplayString(_ctx.t('Try Telnet')), 11 /* TEXT, CLASS, PROPS */, _hoisted_743),
                  _createCommentVNode(" SSH signs in before it shows anything, so it needs a user name.\n                   Leaving that out sent the request anyway and the server\n                   answered \"could not sign in as \" — a refusal with nobody\n                   named in it, eighty-two bytes of red text that is easy to\n                   miss in a terminal that has just opened. A saved connection\n                   carries its own user, and Telnet asks inside the window. "),
                  (_ctx.allowed('sshexec'))
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: _normalizeClass(["btn", {working: _ctx.busy.term}]),
                        disabled: _ctx.busy.term || !_ctx.sshHostNow || !_ctx.sshReadyToOpen,
                        onClick: _cache[250] || (_cache[250] = (...args) => (_ctx.openConsoleHere && _ctx.openConsoleHere(...args)))
                      }, "🖳 " + _toDisplayString(_ctx.t('Open a console')), 11 /* TEXT, CLASS, PROPS */, _hoisted_744))
                    : _createCommentVNode("v-if", true)
                ]),
                _createElementVNode("label", _hoisted_745, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[251] || (_cache[251] = $event => ((_ctx.sshAuthMethods) = $event))
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.sshAuthMethods]
                  ]),
                  _createTextVNode(" " + _toDisplayString(_ctx.t('Also ask which sign-in methods are accepted (leaves one failed attempt in the server log)')), 1 /* TEXT */)
                ]),
                (_ctx.allowed('sshexec') && _ctx.sshCanRun)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 7 }, [
                      _createElementVNode("div", _hoisted_746, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[252] || (_cache[252] = $event => ((_ctx.sshPreset) = $event)),
                          class: "grow"
                        }, [
                          _createElementVNode("option", _hoisted_747, _toDisplayString(_ctx.t('Or type a command below…')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshPresets, (preset, id) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: id,
                              value: id
                            }, _toDisplayString(_ctx.t(preset.label)), 9 /* TEXT, PROPS */, _hoisted_748))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.sshPreset]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn", {working: _ctx.busy.sshrun}]),
                          disabled: _ctx.busy.sshrun || !_ctx.sshPreset,
                          onClick: _cache[253] || (_cache[253] = (...args) => (_ctx.runSshPreset && _ctx.runSshPreset(...args)))
                        }, _toDisplayString(_ctx.t('Run')), 11 /* TEXT, CLASS, PROPS */, _hoisted_749)
                      ]),
                      _createElementVNode("div", _hoisted_750, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[254] || (_cache[254] = $event => ((_ctx.sshCommand) = $event)),
                          class: "mono",
                          placeholder: _ctx.t('uptime'),
                          onKeyup: _cache[255] || (_cache[255] = _withKeys((...args) => (_ctx.runSshCommand && _ctx.runSshCommand(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_751), [
                          [_vModelText, _ctx.sshCommand]
                        ]),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn", {working: _ctx.busy.sshrun}]),
                          disabled: _ctx.busy.sshrun || !_ctx.sshCommand,
                          onClick: _cache[256] || (_cache[256] = (...args) => (_ctx.runSshCommand && _ctx.runSshCommand(...args)))
                        }, _toDisplayString(_ctx.t('Run command')), 11 /* TEXT, CLASS, PROPS */, _hoisted_752)
                      ])
                    ], 64 /* STABLE_FRAGMENT */))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.sshResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_753, [
                    (_ctx.sshResult.error)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_754, "⚠ " + _toDisplayString(_ctx.sshResult.error), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshResult.findings, (f, i) => {
                      return (_openBlock(), _createElementBlock("div", {
                        key: i,
                        class: _normalizeClass(["finding", f.level])
                      }, [
                        _createElementVNode("span", {
                          class: _normalizeClass(["pill", f.level])
                        }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                        _createElementVNode("div", null, [
                          _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                          _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                        ])
                      ], 2 /* CLASS */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    _createElementVNode("div", _hoisted_755, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Identification')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_756, _toDisplayString(_ctx.sshResult.banner), 1 /* TEXT */)
                      ]),
                      (_ctx.sshResult.authMethods)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_757, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Sign-in methods')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.sshResult.authMethods.join(', ')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    ((_ctx.sshResult.hostKeys||[]).length)
                      ? (_openBlock(), _createElementBlock("table", _hoisted_758, [
                          _createElementVNode("thead", null, [
                            _createElementVNode("tr", null, [
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Host key')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Size')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Fingerprint')), 1 /* TEXT */)
                            ])
                          ]),
                          _createElementVNode("tbody", null, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshResult.hostKeys, (k, i) => {
                              return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                _createElementVNode("td", _hoisted_759, _toDisplayString(k.type), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_760, _toDisplayString(k.bits ? k.bits + ' bit' : ''), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_761, _toDisplayString(k.sha256), 1 /* TEXT */)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("details", null, [
                      _createElementVNode("summary", null, _toDisplayString(_ctx.t('Algorithms offered')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_762, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshResult.algorithms, (list, name) => {
                          return _withDirectives((_openBlock(), _createElementBlock("div", { key: name }, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.algoLabel(name) || name)), 1 /* TEXT */),
                            _createElementVNode("code", _hoisted_763, _toDisplayString(list.join(', ')), 1 /* TEXT */)
                          ])), [
                            [_vShow, list.length && _ctx.algoLabel(name)]
                          ])
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.telnetResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_764, [
                    _hoisted_765,
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.telnetResult.findings, (f, i) => {
                      return (_openBlock(), _createElementBlock("div", {
                        key: i,
                        class: _normalizeClass(["finding", f.level])
                      }, [
                        _createElementVNode("span", {
                          class: _normalizeClass(["pill", f.level])
                        }, _toDisplayString(_ctx.t(_ctx.levelLabel(f.level))), 3 /* TEXT, CLASS */),
                        _createElementVNode("div", null, [
                          _createElementVNode("strong", null, _toDisplayString(f.area), 1 /* TEXT */),
                          _createTextVNode(" · " + _toDisplayString(f.text), 1 /* TEXT */)
                        ])
                      ], 2 /* CLASS */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    (_ctx.telnetResult.error)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_766, "⚠ " + _toDisplayString(_ctx.telnetResult.error), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    (_ctx.telnetResult.banner)
                      ? (_openBlock(), _createElementBlock("pre", _hoisted_767, _toDisplayString(_ctx.telnetResult.banner), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.sshRunResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_768, [
                    _createElementVNode("div", _hoisted_769, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Command')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_770, _toDisplayString(_ctx.sshRunResult.command), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Exit status')), 1 /* TEXT */),
                        _createElementVNode("code", {
                          class: _normalizeClass(_ctx.sshRunResult.exitStatus ? 'bad' : 'good')
                        }, _toDisplayString(_ctx.sshRunResult.exitStatus === null ? '—' : _ctx.sshRunResult.exitStatus), 3 /* TEXT, CLASS */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Time taken')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.sshRunResult.seconds) + " s", 1 /* TEXT */)
                      ])
                    ]),
                    _createElementVNode("pre", _hoisted_771, _toDisplayString(_ctx.sshRunResult.output || _ctx.t('(no output)')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true)
      ])
    ]),
    _createCommentVNode(" ============ system information ============ "),
    _createCommentVNode(" Opening a shell: shown only when a code has to be entered, or when\n         something is in the way. On a closed network the shell opens with no\n         dialog at all. "),
    (_ctx.shellModal)
      ? (_openBlock(), _createElementBlock("div", {
          key: 1,
          class: "drawer-backdrop centred",
          onClick: _cache[265] || (_cache[265] = _withModifiers((...args) => (_ctx.closeShellModal && _ctx.closeShellModal(...args)), ["self"]))
        }, [
          _createElementVNode("div", {
            class: "drawer narrow-drawer shell-modal",
            onMousedown: _cache[264] || (_cache[264] = _withModifiers(() => {}, ["stop"]))
          }, [
            _createElementVNode("div", _hoisted_772, [
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Open a shell')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_773, _toDisplayString(_ctx.t('A terminal on this server, running with the same privileges as Nextcloud (the {user} account) — no more. For administrators only.', { user: 'www-data' })), 1 /* TEXT */)
              ]),
              _hoisted_774,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[257] || (_cache[257] = (...args) => (_ctx.closeShellModal && _ctx.closeShellModal(...args)))
              }, _hoisted_777, 8 /* PROPS */, _hoisted_775)
            ]),
            _createElementVNode("div", _hoisted_778, [
              (_ctx.shellStage==='no-email')
                ? (_openBlock(), _createElementBlock("div", _hoisted_779, [
                    _createElementVNode("p", _hoisted_780, "⚠ " + _toDisplayString(_ctx.t('No administrator email address is set.')), 1 /* TEXT */),
                    _createElementVNode("p", _hoisted_781, _toDisplayString(_ctx.t('This server can reach the internet, so a verification code is required — but your account has no email address for it to be sent to. Set one in your personal settings, then try again.')), 1 /* TEXT */)
                  ]))
                : (_ctx.shellStage==='mail-failed')
                  ? (_openBlock(), _createElementBlock("div", _hoisted_782, [
                      _createElementVNode("p", _hoisted_783, "⚠ " + _toDisplayString(_ctx.t('The verification code could not be sent. Check this server’s email settings and try again.')), 1 /* TEXT */)
                    ]))
                  : (_ctx.shellStage==='verify')
                    ? (_openBlock(), _createElementBlock("div", _hoisted_784, [
                        _createElementVNode("p", null, _toDisplayString(_ctx.t('A six-digit code was sent to {email}. Enter it to open the shell.', { email: _ctx.shellEmail })), 1 /* TEXT */),
                        _createElementVNode("div", _hoisted_785, [
                          _withDirectives(_createElementVNode("input", {
                            "onUpdate:modelValue": _cache[258] || (_cache[258] = $event => ((_ctx.shellCode) = $event)),
                            inputmode: "numeric",
                            maxlength: "6",
                            autocomplete: "one-time-code",
                            class: "shell-code mono",
                            placeholder: "––––––",
                            ref: "shellCode",
                            onInput: _cache[259] || (_cache[259] = $event => (_ctx.shellCode = _ctx.onlyDigits(_ctx.shellCode))),
                            onKeyup: _cache[260] || (_cache[260] = _withKeys((...args) => (_ctx.verifyShell && _ctx.verifyShell(...args)), ["enter"]))
                          }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                            [_vModelText, _ctx.shellCode]
                          ]),
                          _createElementVNode("button", {
                            class: _normalizeClass(["btn primary", {working: _ctx.shellBusy}]),
                            disabled: _ctx.shellBusy || _ctx.shellCode.length !== 6,
                            onClick: _cache[261] || (_cache[261] = (...args) => (_ctx.verifyShell && _ctx.verifyShell(...args)))
                          }, _toDisplayString(_ctx.t('Open the shell')), 11 /* TEXT, CLASS, PROPS */, _hoisted_786)
                        ]),
                        (_ctx.shellError)
                          ? (_openBlock(), _createElementBlock("p", _hoisted_787, "⚠ " + _toDisplayString(_ctx.shellError), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _createElementVNode("p", _hoisted_788, [
                          _createTextVNode(_toDisplayString(_ctx.t('The code is valid for ten minutes.')) + " · ", 1 /* TEXT */),
                          _createElementVNode("a", {
                            href: "#",
                            onClick: _cache[262] || (_cache[262] = _withModifiers((...args) => (_ctx.beginShell && _ctx.beginShell(...args)), ["prevent"]))
                          }, _toDisplayString(_ctx.t('Send a new code')), 1 /* TEXT */)
                        ])
                      ]))
                    : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_789, [
              _hoisted_790,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[263] || (_cache[263] = (...args) => (_ctx.closeShellModal && _ctx.closeShellModal(...args)))
              }, _toDisplayString(_ctx.shellStage==='verify' ? _ctx.t('Cancel') : _ctx.t('Close')), 1 /* TEXT */)
            ])
          ], 32 /* NEED_HYDRATION */)
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.sysInfo)
      ? (_openBlock(), _createElementBlock("div", {
          key: 2,
          class: "drawer-backdrop centred",
          onClick: _cache[269] || (_cache[269] = _withModifiers($event => (_ctx.sysInfo=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_791, [
            _createElementVNode("div", _hoisted_792, [
              _hoisted_793,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('System information')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_794, _toDisplayString(_ctx.t('What this server can do, and what it could do')), 1 /* TEXT */)
              ]),
              _hoisted_795,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[266] || (_cache[266] = $event => (_ctx.sysInfo=false))
              }, _hoisted_798, 8 /* PROPS */, _hoisted_796)
            ]),
            _createElementVNode("div", _hoisted_799, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Basics')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_800, [
                _createElementVNode("div", null, [
                  _hoisted_801,
                  _createElementVNode("code", null, "v" + _toDisplayString(_ctx.version), 1 /* TEXT */)
                ]),
                (_ctx.requirements && _ctx.requirements.distro)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_802, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('System')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.requirements.distro), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.requirements && _ctx.requirements.phpVersion)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_803, [
                      _hoisted_804,
                      _createElementVNode("code", null, [
                        _createTextVNode(_toDisplayString(_ctx.requirements.phpVersion), 1 /* TEXT */),
                        (_ctx.requirements.phpUser)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_805, " (" + _toDisplayString(_ctx.requirements.phpUser) + ")", 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor database')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} IEEE prefixes', {n: _ctx.status.ouiEntries})), 1 /* TEXT */)
                ]),
                (_ctx.status.neighbourLimits)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_806, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('ARP table')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.status.neighbourCount) + " / " + _toDisplayString(_ctx.status.neighbourLimits.gc3), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.status.defaultRoute && _ctx.status.defaultRoute.gateway)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_807, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Default gateway')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.status.defaultRoute.gateway) + " (" + _toDisplayString(_ctx.status.defaultRoute.interface) + ")", 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.status.targets || []), (tgt) => {
                  return (_openBlock(), _createElementBlock("div", {
                    key: tgt.cidr
                  }, [
                    _createElementVNode("span", null, _toDisplayString(_ctx.t('Local network')), 1 /* TEXT */),
                    _createElementVNode("code", null, [
                      _createTextVNode(_toDisplayString(tgt.cidr) + " ", 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_808, _toDisplayString(tgt.interface), 1 /* TEXT */)
                    ])
                  ]))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              (_ctx.allowed('server'))
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('This server')), 1 /* TEXT */),
                    (_ctx.serverResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_809, [
                          _createElementVNode("div", _hoisted_810, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Host name')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.serverResult.hostname), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Default gateway')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.serverResult.defaultRoute.gateway) + " (" + _toDisplayString(_ctx.serverResult.defaultRoute.interface) + ")", 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Resolvers')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.serverResult.resolvers.join(', ')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('ARP entries')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.serverResult.neighbours), 1 /* TEXT */)
                            ])
                          ]),
                          _createElementVNode("table", _hoisted_811, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Interface')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('State')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('MAC address')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Addresses')), 1 /* TEXT */),
                                _hoisted_812
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.serverResult.interfaces, (i) => {
                                return (_openBlock(), _createElementBlock("tr", {
                                  key: i.name
                                }, [
                                  _createElementVNode("td", _hoisted_813, _toDisplayString(i.name), 1 /* TEXT */),
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", i.up ? 'ok' : 'no'])
                                    }, _toDisplayString(i.up ? 'UP' : 'DOWN'), 3 /* TEXT, CLASS */)
                                  ]),
                                  _createElementVNode("td", _hoisted_814, _toDisplayString(i.mac), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_815, _toDisplayString(i.addresses.map(a => a.ip + (a.family==='inet' ? '/'+a.cidr : '')).join(' ')), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_816, _toDisplayString(i.mtu), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (_ctx.serverResult.listeners.length)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_817, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Listening sockets')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_818, _toDisplayString(_ctx.serverResult.listeners.join('\n')), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Tools you can use now')), 1 /* TEXT */),
              (!_ctx.activeComponents.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_819, _toDisplayString(_ctx.t('None of the optional components are installed yet.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.activeComponents, (c) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: c.id,
                  class: "sys-row on"
                }, [
                  _createElementVNode("span", _hoisted_820, _toDisplayString(_ctx.t('installed')), 1 /* TEXT */),
                  _createElementVNode("div", null, [
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(c.name)), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_821, _toDisplayString(_ctx.t(c.enables)), 1 /* TEXT */)
                  ])
                ]))
              }), 128 /* KEYED_FRAGMENT */)),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Install these to unlock more')), 1 /* TEXT */),
              (!_ctx.dormantComponents.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_822, _toDisplayString(_ctx.t('Everything NetBase can use is already installed.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dormantComponents, (c) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: c.id,
                  class: "sys-row off"
                }, [
                  _createElementVNode("span", _hoisted_823, _toDisplayString(_ctx.t('missing')), 1 /* TEXT */),
                  _createElementVNode("div", null, [
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(c.name)), 1 /* TEXT */),
                    _createElementVNode("div", null, _toDisplayString(_ctx.t(c.enables)), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_824, _toDisplayString(_ctx.t(c.without)), 1 /* TEXT */),
                    (_ctx.status.isAdmin && _ctx.installFor(c.id))
                      ? (_openBlock(), _createElementBlock("pre", _hoisted_825, _toDisplayString(_ctx.installFor(c.id)), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_826, _toDisplayString(_ctx.t('Ask an administrator to install it.')), 1 /* TEXT */))
                  ])
                ]))
              }), 128 /* KEYED_FRAGMENT */)),
              _createCommentVNode(" Docker/AIO: the per-distro install commands above do not apply in a\n               container, so show the recipe that does — verified on the official\n               Nextcloud image. Only when running in a container and something is\n               actually missing. "),
              (_ctx.requirements && _ctx.requirements.container && _ctx.requirements.docker && !_ctx.requirements.docker.nothingMissing)
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 3 }, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Running in Docker or Nextcloud-AIO')), 1 /* TEXT */),
                    _createElementVNode("p", _hoisted_827, _toDisplayString(_ctx.t('An app cannot bundle PHP extensions, but the official Nextcloud image runs any script placed in this folder on every start — so it adds what is missing once and survives image updates, with no rebuild.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_828, _toDisplayString(_ctx.requirements.docker.hooksDir), 1 /* TEXT */),
                    (_ctx.status.isAdmin)
                      ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                          _createElementVNode("pre", _hoisted_829, _toDisplayString(_ctx.requirements.docker.script), 1 /* TEXT */),
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[267] || (_cache[267] = $event => (_ctx.copyField(_ctx.t('Docker recipe'), _ctx.requirements.docker.script)))
                          }, _toDisplayString(_ctx.t('Copy')), 1 /* TEXT */)
                        ], 64 /* STABLE_FRAGMENT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_830, _toDisplayString(_ctx.t('Ask an administrator to set this up.')), 1 /* TEXT */))
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_831, [
              (_ctx.status.isAdmin)
                ? (_openBlock(), _createElementBlock("a", {
                    key: 0,
                    class: "btn sm",
                    href: _ctx.adminUrl
                  }, _toDisplayString(_ctx.t('Open administration settings')), 9 /* TEXT, PROPS */, _hoisted_832))
                : _createCommentVNode("v-if", true),
              _hoisted_833,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[268] || (_cache[268] = $event => (_ctx.sysInfo=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ edit the named (registered) devices ============ "),
    (_ctx.editReg)
      ? (_openBlock(), _createElementBlock("div", {
          key: 3,
          class: "drawer-backdrop centred",
          onClick: _cache[274] || (_cache[274] = _withModifiers($event => (_ctx.editReg=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_834, [
            _createElementVNode("div", _hoisted_835, [
              _hoisted_836,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Edit named devices')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_837, _toDisplayString(_ctx.t('The devices you have given a name. Rename them, change the type, edit the note, or remove one.')), 1 /* TEXT */)
              ]),
              _hoisted_838,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[270] || (_cache[270] = $event => (_ctx.editReg=false))
              }, _hoisted_841, 8 /* PROPS */, _hoisted_839)
            ]),
            _createElementVNode("div", _hoisted_842, [
              (!_ctx.editRegRows.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_843, _toDisplayString(_ctx.t('No named devices yet. Open a device from the list and give it a name to add it here.')), 1 /* TEXT */))
                : (_openBlock(), _createElementBlock("table", _hoisted_844, [
                    _createElementVNode("thead", null, [
                      _createElementVNode("tr", null, [
                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                        _createElementVNode("th", _hoisted_845, _toDisplayString(_ctx.t('IPv4')) + " / " + _toDisplayString(_ctx.t('MAC address')), 1 /* TEXT */),
                        _hoisted_846
                      ])
                    ]),
                    _createElementVNode("tbody", null, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.editRegRows, (r) => {
                        return (_openBlock(), _createElementBlock("tr", {
                          key: r.id,
                          class: _normalizeClass({'reg-del': r.remove})
                        }, [
                          _createElementVNode("td", null, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": $event => ((r.label) = $event),
                              placeholder: r.hostname || r.ip,
                              disabled: r.remove
                            }, null, 8 /* PROPS */, _hoisted_847), [
                              [_vModelText, r.label]
                            ])
                          ]),
                          _createElementVNode("td", null, [
                            _createElementVNode("div", _hoisted_848, [
                              (r.type !== _ctx.customType)
                                ? _withDirectives((_openBlock(), _createElementBlock("select", {
                                    key: 0,
                                    "onUpdate:modelValue": $event => ((r.type) = $event),
                                    disabled: r.remove,
                                    "aria-label": _ctx.t('Type'),
                                    onChange: _cache[271] || (_cache[271] = $event => (_ctx.focusOwnType($event)))
                                  }, [
                                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.typeLabels, (l, k) => {
                                      return (_openBlock(), _createElementBlock("option", {
                                        key: k,
                                        value: k
                                      }, _toDisplayString(_ctx.t(l)), 9 /* TEXT, PROPS */, _hoisted_850))
                                    }), 128 /* KEYED_FRAGMENT */)),
                                    _createElementVNode("option", { value: _ctx.customType }, _toDisplayString(_ctx.t('Other (enter your own)')), 9 /* TEXT, PROPS */, _hoisted_851)
                                  ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_849)), [
                                    [_vModelSelect, r.type]
                                  ])
                                : (_openBlock(), _createElementBlock("span", _hoisted_852, [
                                    _withDirectives(_createElementVNode("input", {
                                      "onUpdate:modelValue": $event => ((r.typeText) = $event),
                                      disabled: r.remove,
                                      maxlength: "32",
                                      placeholder: _ctx.t('Enter a type'),
                                      "aria-label": _ctx.t('Enter a type'),
                                      onKeydown: _withKeys(_withModifiers($event => (r.type = _ctx.typeBack(r.oldType)), ["stop"]), ["esc"])
                                    }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_853), [
                                      [_vModelText, r.typeText]
                                    ]),
                                    _createElementVNode("button", {
                                      type: "button",
                                      class: "btn xs ib type-back",
                                      disabled: r.remove,
                                      title: _ctx.t('Choose from the list'),
                                      "aria-label": _ctx.t('Choose from the list'),
                                      onClick: $event => (r.type = _ctx.typeBack(r.oldType))
                                    }, _hoisted_856, 8 /* PROPS */, _hoisted_854)
                                  ]))
                            ])
                          ]),
                          _createElementVNode("td", null, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": $event => ((r.notes) = $event),
                              disabled: r.remove
                            }, null, 8 /* PROPS */, _hoisted_857), [
                              [_vModelText, r.notes]
                            ])
                          ]),
                          _createElementVNode("td", _hoisted_858, [
                            _createTextVNode(_toDisplayString(r.ip), 1 /* TEXT */),
                            _hoisted_859,
                            _createTextVNode(_toDisplayString(r.mac || '—'), 1 /* TEXT */)
                          ]),
                          _createElementVNode("td", null, [
                            _createElementVNode("button", {
                              class: "btn xs ib",
                              title: r.remove ? _ctx.t('Keep') : _ctx.t('Remove'),
                              "aria-label": r.remove ? _ctx.t('Keep') : _ctx.t('Remove'),
                              onClick: $event => (r.remove = !r.remove)
                            }, [
                              (!r.remove)
                                ? (_openBlock(), _createElementBlock("svg", _hoisted_861, _hoisted_865))
                                : (_openBlock(), _createElementBlock("svg", _hoisted_866, _hoisted_869))
                            ], 8 /* PROPS */, _hoisted_860)
                          ])
                        ], 2 /* CLASS */))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
            ]),
            _createElementVNode("div", _hoisted_870, [
              (_ctx.editRegRows.some((r) => r.remove))
                ? (_openBlock(), _createElementBlock("span", _hoisted_871, _toDisplayString(_ctx.t('{n} to remove', {n: _ctx.editRegRows.filter((r) => r.remove).length})), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_872,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[272] || (_cache[272] = $event => (_ctx.editReg=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: _normalizeClass(["btn primary", {working: _ctx.busy.reg}]),
                disabled: _ctx.busy.reg,
                onClick: _cache[273] || (_cache[273] = (...args) => (_ctx.saveRegEditor && _ctx.saveRegEditor(...args)))
              }, _toDisplayString(_ctx.busy.reg ? _ctx.t('Saving…') : _ctx.t('Save')), 11 /* TEXT, CLASS, PROPS */, _hoisted_873)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" How to switch the \"Clear the ARP table\" button on. NetBase runs\n         unprivileged and cannot flush the kernel table itself; an administrator\n         installs a tiny helper and a one-line sudoers rule, and NetBase then\n         detects it and enables the button on its own. "),
    (_ctx.arpHelp)
      ? (_openBlock(), _createElementBlock("div", {
          key: 4,
          class: "drawer-backdrop centred",
          onClick: _cache[279] || (_cache[279] = _withModifiers($event => (_ctx.arpHelp=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_874, [
            _createElementVNode("div", _hoisted_875, [
              _hoisted_876,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Switch on “Clear the ARP table”')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_877, _toDisplayString(_ctx.t('NetBase runs without special privileges, so clearing the kernel neighbour (ARP) table needs a small helper an administrator installs once.')), 1 /* TEXT */)
              ]),
              _hoisted_878,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[275] || (_cache[275] = $event => (_ctx.arpHelp=false))
              }, _hoisted_881, 8 /* PROPS */, _hoisted_879)
            ]),
            _createElementVNode("div", _hoisted_882, [
              _createElementVNode("p", _hoisted_883, "⚠ " + _toDisplayString(_ctx.t('This is optional. NetBase works fully without it — “Refresh devices” already re-checks what is online. It grants the web user one root command, so if you are not confident about the security trade-off, do not install it.')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_884, _toDisplayString(_ctx.t('When the helper is installed and the check passes, the button turns on by itself (reload this page).')), 1 /* TEXT */),
              _createElementVNode("h4", null, _toDisplayString(_ctx.t('On the server (bare metal or VM)')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_885, _toDisplayString(_ctx.t('Run as an administrator. This writes the helper and a sudoers rule that lets only the web user ({user}) run only this one command.', {user: _ctx.arpUser()})), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_886, [
                _createElementVNode("button", {
                  class: "btn xs ib arp-copy",
                  title: _ctx.t('Copy'),
                  onClick: _cache[276] || (_cache[276] = $event => (_ctx.copyText(_ctx.arpBareSteps())))
                }, _hoisted_889, 8 /* PROPS */, _hoisted_887),
                _createElementVNode("pre", null, _toDisplayString(_ctx.arpBareSteps()), 1 /* TEXT */)
              ]),
              _createElementVNode("h4", null, _toDisplayString(_ctx.t('Docker / Podman')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_890, _toDisplayString(_ctx.t('The image is rebuilt as a whole, so install the helper from a start-up hook and give the container the NET_ADMIN capability (and the host network to reach the LAN).')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_891, [
                _createElementVNode("button", {
                  class: "btn xs ib arp-copy",
                  title: _ctx.t('Copy'),
                  onClick: _cache[277] || (_cache[277] = $event => (_ctx.copyText(_ctx.arpDockerHook())))
                }, _hoisted_894, 8 /* PROPS */, _hoisted_892),
                _createElementVNode("pre", null, _toDisplayString(_ctx.arpDockerHook()), 1 /* TEXT */)
              ]),
              _createElementVNode("p", _hoisted_895, _toDisplayString(_ctx.t('The helper only ever runs “ip neigh flush all”. You can read it before installing; NetBase probes it with a harmless “--check”.')), 1 /* TEXT */)
            ]),
            _createElementVNode("div", _hoisted_896, [
              _hoisted_897,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[278] || (_cache[278] = $event => (_ctx.arpHelp=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" How to give this server a language it does not yet have. The list of\n         locales is read from the machine, so this is the only way to add to\n         it — and it is done on the server, not from here. "),
    (_ctx.termLog.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 5,
          class: "drawer-backdrop centred over-dialog",
          onClick: _cache[284] || (_cache[284] = _withModifiers($event => (_ctx.termLog.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_898, [
            _createElementVNode("div", _hoisted_899, [
              _hoisted_900,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.termLog.session ? _ctx.t('What was done') : _ctx.t('Recorded sessions')), 1 /* TEXT */),
                (_ctx.termLog.session)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_901, _toDisplayString(_ctx.termLog.session.target), 1 /* TEXT */))
                  : (_openBlock(), _createElementBlock("div", _hoisted_902, _toDisplayString(_ctx.t('Kept for your account only. Nobody else can read these.')), 1 /* TEXT */))
              ]),
              _hoisted_903,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[280] || (_cache[280] = $event => (_ctx.termLog.open=false))
              }, _hoisted_906, 8 /* PROPS */, _hoisted_904)
            ]),
            _createElementVNode("div", _hoisted_907, [
              (_ctx.termLog.loading)
                ? (_openBlock(), _createElementBlock("p", _hoisted_908, _toDisplayString(_ctx.t('Reading…')), 1 /* TEXT */))
                : (!_ctx.termLog.session)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                      (!_ctx.termLog.sessions.length)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_909, _toDisplayString(_ctx.t('Nothing has been kept yet. Set a number of steps above, then open a terminal.')), 1 /* TEXT */))
                        : (_openBlock(), _createElementBlock("table", _hoisted_910, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Where')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Steps')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Last used')), 1 /* TEXT */),
                                _hoisted_911
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.termLog.sessions, (s) => {
                                return (_openBlock(), _createElementBlock("tr", {
                                  key: s.session
                                }, [
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", _hoisted_912, _toDisplayString(s.kind === 'shell' ? _ctx.t('Shell') : 'SSH'), 1 /* TEXT */),
                                    _createTextVNode(),
                                    _createElementVNode("span", _hoisted_913, _toDisplayString(s.target), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", null, _toDisplayString(s.steps), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_914, _toDisplayString(_ctx.ago(s.last)), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_915, [
                                    _createElementVNode("button", {
                                      class: "btn xs",
                                      onClick: $event => (_ctx.readTermLog(s))
                                    }, _toDisplayString(_ctx.t('Open')), 9 /* TEXT, PROPS */, _hoisted_916),
                                    _createElementVNode("button", {
                                      class: "btn xs danger",
                                      onClick: $event => (_ctx.forgetTermLog(s.session))
                                    }, _toDisplayString(_ctx.t('Forget')), 9 /* TEXT, PROPS */, _hoisted_917)
                                  ])
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]))
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.termLog.steps, (st) => {
                        return (_openBlock(), _createElementBlock("div", {
                          class: "log-step",
                          key: st.id
                        }, [
                          _createElementVNode("div", _hoisted_918, _toDisplayString(st.typed.trim()), 1 /* TEXT */),
                          (st.said.trim())
                            ? (_openBlock(), _createElementBlock("pre", _hoisted_919, _toDisplayString(st.said.trim()), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          _createElementVNode("div", _hoisted_920, _toDisplayString(_ctx.stamp(st.created)), 1 /* TEXT */)
                        ]))
                      }), 128 /* KEYED_FRAGMENT */)),
                      (!_ctx.termLog.steps.length)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_921, _toDisplayString(_ctx.t('This session has no steps left.')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 64 /* STABLE_FRAGMENT */))
            ]),
            _createElementVNode("div", _hoisted_922, [
              (_ctx.termLog.session)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn sm",
                    onClick: _cache[281] || (_cache[281] = $event => {_ctx.termLog.session = null; _ctx.termLog.steps = []})
                  }, _toDisplayString(_ctx.t('Back to the list')), 1 /* TEXT */))
                : (_ctx.termLog.sessions.length)
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 1,
                      class: "btn sm danger",
                      onClick: _cache[282] || (_cache[282] = $event => (_ctx.forgetTermLog('')))
                    }, _toDisplayString(_ctx.t('Forget all of them')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
              _hoisted_923,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[283] || (_cache[283] = $event => (_ctx.termLog.open=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.localeHelp)
      ? (_openBlock(), _createElementBlock("div", {
          key: 6,
          class: "drawer-backdrop centred over-dialog",
          onClick: _cache[289] || (_cache[289] = _withModifiers($event => (_ctx.localeHelp=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_924, [
            _createElementVNode("div", _hoisted_925, [
              _hoisted_926,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Adding a language to this server')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_927, _toDisplayString(_ctx.t('The shell speaks the language of a locale the machine has installed.')), 1 /* TEXT */)
              ]),
              _hoisted_928,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[285] || (_cache[285] = $event => (_ctx.localeHelp=false))
              }, _hoisted_931, 8 /* PROPS */, _hoisted_929)
            ]),
            _createElementVNode("div", _hoisted_932, [
              _createElementVNode("p", _hoisted_933, _toDisplayString(_ctx.t('NetBase offers only the locales this server already has, so a shell is never started in a language the machine cannot produce. Adding one is done on the server itself.')), 1 /* TEXT */),
              _createElementVNode("h4", null, _toDisplayString(_ctx.t('On the server (bare metal or VM)')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_934, _toDisplayString(_ctx.t('Run as an administrator. Change LOCALE on the first line to the language you want.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_935, [
                _createElementVNode("button", {
                  class: "btn xs ib arp-copy",
                  title: _ctx.t('Copy'),
                  onClick: _cache[286] || (_cache[286] = $event => (_ctx.copyText(_ctx.localeSteps())))
                }, _hoisted_938, 8 /* PROPS */, _hoisted_936),
                _createElementVNode("pre", null, _toDisplayString(_ctx.localeSteps()), 1 /* TEXT */)
              ]),
              _createElementVNode("h4", null, _toDisplayString(_ctx.t('Docker / Podman')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_939, _toDisplayString(_ctx.t('The image is rebuilt as a whole, so make the locale from a start-up hook; it then survives every image update.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_940, [
                _createElementVNode("button", {
                  class: "btn xs ib arp-copy",
                  title: _ctx.t('Copy'),
                  onClick: _cache[287] || (_cache[287] = $event => (_ctx.copyText(_ctx.localeDockerHook())))
                }, _hoisted_943, 8 /* PROPS */, _hoisted_941),
                _createElementVNode("pre", null, _toDisplayString(_ctx.localeDockerHook()), 1 /* TEXT */)
              ]),
              _createElementVNode("p", _hoisted_944, _toDisplayString(_ctx.t('Then open these settings again: the new locale is in the list. A shell that is already open keeps the language it started with.')), 1 /* TEXT */)
            ]),
            _createElementVNode("div", _hoisted_945, [
              _hoisted_946,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[288] || (_cache[288] = $event => (_ctx.localeHelp=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ settings (per user, NetBase only) ============\n         Four subjects, not eleven. The dialog had grown by addition: the\n         terminal's font, the shell's language and the shell's log ended up in\n         three separate places with the connection list wedged between them,\n         and the word \"language\" appeared twice at the same size meaning two\n         different things. Grouping them costs nothing and the reader stops\n         having to hold the whole column in their head. "),
    (_ctx.themeBox)
      ? (_openBlock(), _createElementBlock("div", _hoisted_947, [
          _createElementVNode("div", _hoisted_948, [
            _createElementVNode("div", _hoisted_949, [
              _hoisted_950,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Settings')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_951, _toDisplayString(_ctx.t('Applies to NetBase only, for your account.')), 1 /* TEXT */)
              ]),
              _hoisted_952,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[290] || (_cache[290] = $event => (_ctx.themeBox=false))
              }, _hoisted_955, 8 /* PROPS */, _hoisted_953)
            ]),
            _createElementVNode("div", _hoisted_956, [
              _createCommentVNode(" The same tabs as the connection list. Four groups stacked made a\n               dialog longer than the screen, and the one being changed was\n               never wholly in view. "),
              _createElementVNode("div", _hoisted_957, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.settingTabs, (s) => {
                  return (_openBlock(), _createElementBlock("button", {
                    key: s.id,
                    class: _normalizeClass(["set-tab", {active: _ctx.settingTab === s.id}]),
                    role: "tab",
                    "aria-selected": _ctx.settingTab === s.id,
                    title: _ctx.t(s.label),
                    onClick: $event => (_ctx.settingTab = s.id)
                  }, [
                    _createElementVNode("span", _hoisted_959, _toDisplayString(s.icon), 1 /* TEXT */),
                    _createTextVNode(_toDisplayString(_ctx.t(s.label)), 1 /* TEXT */)
                  ], 10 /* CLASS, PROPS */, _hoisted_958))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              _withDirectives(_createElementVNode("section", _hoisted_960, [
                _createElementVNode("h3", null, [
                  _hoisted_961,
                  _createTextVNode(_toDisplayString(_ctx.t('Appearance and language')), 1 /* TEXT */)
                ]),
                _createElementVNode("div", _hoisted_962, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.themeOptions, (opt) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: opt.id,
                      class: _normalizeClass(["theme-pick", {active: _ctx.settings.theme===opt.id}]),
                      onClick: $event => (_ctx.setTheme(opt.id))
                    }, [
                      _createElementVNode("span", {
                        class: _normalizeClass(["swatch", opt.id])
                      }, _hoisted_967, 2 /* CLASS */),
                      _createElementVNode("strong", null, _toDisplayString(_ctx.t(opt.label)), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_968, _toDisplayString(_ctx.t(opt.hint)), 1 /* TEXT */),
                      (_ctx.settings.theme===opt.id)
                        ? (_openBlock(), _createElementBlock("span", _hoisted_969, "✓"))
                        : _createCommentVNode("v-if", true)
                    ], 10 /* CLASS, PROPS */, _hoisted_963))
                  }), 128 /* KEYED_FRAGMENT */))
                ]),
                _createElementVNode("p", _hoisted_970, _toDisplayString(_ctx.t('Saved to your account, so it follows you to every browser you sign in from.')), 1 /* TEXT */),
                _createElementVNode("h4", null, _toDisplayString(_ctx.t('Language')), 1 /* TEXT */),
                _createElementVNode("label", _hoisted_971, [
                  _createElementVNode("select", {
                    value: _ctx.settings.language || 'auto',
                    onChange: _cache[291] || (_cache[291] = $event => (_ctx.setLanguage($event.target.value)))
                  }, [
                    _createElementVNode("option", _hoisted_973, _toDisplayString(_ctx.t('Follow Nextcloud')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.settings.languages || []), (l) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: l.code,
                        value: l.code
                      }, _toDisplayString(l.name), 9 /* TEXT, PROPS */, _hoisted_974))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_972)
                ]),
                _createElementVNode("p", _hoisted_975, _toDisplayString(_ctx.t('NetBase can speak a different language from the rest of Nextcloud.')), 1 /* TEXT */)
              ], 512 /* NEED_PATCH */), [
                [_vShow, _ctx.settingTab === 'look']
              ]),
              _withDirectives(_createElementVNode("section", _hoisted_976, [
                _createElementVNode("h3", null, [
                  _hoisted_977,
                  _createTextVNode(_toDisplayString(_ctx.t('Terminal (shell and SSH)')), 1 /* TEXT */)
                ]),
                _createElementVNode("h4", null, _toDisplayString(_ctx.t('Terminal font')), 1 /* TEXT */),
                _createElementVNode("label", _hoisted_978, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[292] || (_cache[292] = $event => ((_ctx.settings.termFont) = $event)),
                    onChange: _cache[293] || (_cache[293] = $event => (_ctx.applyTermFont()))
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.termFonts, (f) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: f.id,
                        value: f.id
                      }, _toDisplayString(_ctx.t(f.label)), 9 /* TEXT, PROPS */, _hoisted_979))
                    }), 128 /* KEYED_FRAGMENT */)),
                    ((_ctx.settings.serverFonts || []).length)
                      ? (_openBlock(), _createElementBlock("optgroup", {
                          key: 0,
                          label: _ctx.t('Fonts on this server')
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.settings.serverFonts, (f) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: f.id,
                              value: 'server:' + f.id
                            }, _toDisplayString(f.family) + " (" + _toDisplayString(_ctx.fontSize(f.bytes)) + ")", 9 /* TEXT, PROPS */, _hoisted_981))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 8 /* PROPS */, _hoisted_980))
                      : _createCommentVNode("v-if", true)
                  ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelSelect, _ctx.settings.termFont]
                  ])
                ]),
                _createElementVNode("p", _hoisted_982, _toDisplayString(_ctx.t('The face the shell and SSH terminals are drawn in. The size is set in the terminal window itself.')), 1 /* TEXT */),
                (String(_ctx.settings.termFont || '').startsWith('server:'))
                  ? (_openBlock(), _createElementBlock("p", _hoisted_983, _toDisplayString(_ctx.t('A font from this server is sent to your browser the first time it is used, and kept afterwards.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                (_ctx.status.isAdmin && _ctx.settings.admin)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                      _createElementVNode("label", _hoisted_984, [
                        _createElementVNode("span", _hoisted_985, [
                          _createTextVNode(_toDisplayString(_ctx.t('Extra font folder')), 1 /* TEXT */),
                          _createElementVNode("span", _hoisted_986, _toDisplayString(_ctx.t('For everyone on this server')), 1 /* TEXT */)
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[294] || (_cache[294] = $event => ((_ctx.settings.admin.fontDir) = $event)),
                          spellcheck: "false",
                          autocomplete: "off",
                          placeholder: "/usr/local/share/fonts",
                          onChange: _cache[295] || (_cache[295] = $event => (_ctx.saveFontDir()))
                        }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                          [_vModelText, _ctx.settings.admin.fontDir]
                        ])
                      ]),
                      _createElementVNode("p", _hoisted_987, _toDisplayString(_ctx.t('Another folder on this server to look in for fonts. What is found there is offered alongside the rest.')), 1 /* TEXT */)
                    ], 64 /* STABLE_FRAGMENT */))
                  : _createCommentVNode("v-if", true),
                (_ctx.status.isAdmin)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                      _createElementVNode("h4", null, _toDisplayString(_ctx.t('Shell')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_988, [
                        _createElementVNode("span", _hoisted_989, [
                          _createTextVNode(_toDisplayString(_ctx.t('Language')), 1 /* TEXT */),
                          _createElementVNode("span", _hoisted_990, _toDisplayString(_ctx.t('For everyone on this server')), 1 /* TEXT */)
                        ]),
                        _createElementVNode("span", _hoisted_991, [
                          _withDirectives(_createElementVNode("select", {
                            "onUpdate:modelValue": _cache[296] || (_cache[296] = $event => ((_ctx.settings.shellLang) = $event)),
                            onChange: _cache[297] || (_cache[297] = $event => (_ctx.saveShell()))
                          }, [
                            _createElementVNode("option", _hoisted_992, _toDisplayString(_ctx.t('Follow the server')), 1 /* TEXT */),
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.settings.shellLocales || []), (l) => {
                              return (_openBlock(), _createElementBlock("option", {
                                key: l,
                                value: l
                              }, _toDisplayString(l), 9 /* TEXT, PROPS */, _hoisted_993))
                            }), 128 /* KEYED_FRAGMENT */))
                          ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                            [_vModelSelect, _ctx.settings.shellLang]
                          ]),
                          _createElementVNode("button", {
                            class: "btn xs ib shell-help-btn",
                            title: _ctx.t('How to add a language to this server'),
                            "aria-label": _ctx.t('How to add a language to this server'),
                            onClick: _cache[298] || (_cache[298] = $event => (_ctx.localeHelp = true))
                          }, "?", 8 /* PROPS */, _hoisted_994)
                        ])
                      ]),
                      ((_ctx.settings.shellLocales || []).length < 2)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_995, _toDisplayString(_ctx.t('This server has only one locale installed, so the shell speaks that language. An administrator can install more on the server itself.')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("label", _hoisted_996, [
                        _createElementVNode("span", _hoisted_997, [
                          _createTextVNode(_toDisplayString(_ctx.t('Environment variables')), 1 /* TEXT */),
                          _createElementVNode("span", _hoisted_998, _toDisplayString(_ctx.t('For everyone on this server')), 1 /* TEXT */)
                        ]),
                        _withDirectives(_createElementVNode("textarea", {
                          "onUpdate:modelValue": _cache[299] || (_cache[299] = $event => ((_ctx.settings.shellEnv) = $event)),
                          rows: "4",
                          spellcheck: "false",
                          autocomplete: "off",
                          placeholder: "EDITOR=vi",
                          onChange: _cache[300] || (_cache[300] = $event => (_ctx.saveShell()))
                        }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                          [_vModelText, _ctx.settings.shellEnv]
                        ])
                      ]),
                      _createElementVNode("p", _hoisted_999, _toDisplayString(_ctx.t('One NAME=value to a line. Both apply to shells opened from now on, not to a window that is already open.')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_1000, _toDisplayString(_ctx.t('These two are for the shell on this server only. An SSH window takes its language and environment from the machine it reaches.')), 1 /* TEXT */)
                    ], 64 /* STABLE_FRAGMENT */))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("h4", null, _toDisplayString(_ctx.t('Shell log')), 1 /* TEXT */),
                _createElementVNode("label", _hoisted_1001, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[301] || (_cache[301] = $event => ((_ctx.settings.termLogOn) = $event)),
                    onChange: _cache[302] || (_cache[302] = $event => (_ctx.saveTermLog()))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.settings.termLogOn]
                  ]),
                  _createTextVNode(" " + _toDisplayString(_ctx.t('Keep a log of shell and SSH sessions')), 1 /* TEXT */)
                ]),
                _createElementVNode("p", _hoisted_1002, _toDisplayString(_ctx.t('One step is a line you typed together with what came back.')), 1 /* TEXT */),
                (_ctx.settings.termLogOn)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 3 }, [
                      _createElementVNode("div", _hoisted_1003, [
                        _createElementVNode("label", _hoisted_1004, [
                          _createElementVNode("span", _hoisted_1005, _toDisplayString(_ctx.t('Steps to keep')), 1 /* TEXT */),
                          _withDirectives(_createElementVNode("input", {
                            "onUpdate:modelValue": _cache[303] || (_cache[303] = $event => ((_ctx.settings.termLogSteps) = $event)),
                            type: "number",
                            min: "1",
                            max: "10000",
                            step: "100",
                            onChange: _cache[304] || (_cache[304] = $event => (_ctx.saveTermLog()))
                          }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                            [
                              _vModelText,
                              _ctx.settings.termLogSteps,
                              void 0,
                              { number: true }
                            ]
                          ])
                        ]),
                        _createElementVNode("label", _hoisted_1006, [
                          _createElementVNode("span", _hoisted_1007, _toDisplayString(_ctx.t('Days to keep')), 1 /* TEXT */),
                          _withDirectives(_createElementVNode("input", {
                            "onUpdate:modelValue": _cache[305] || (_cache[305] = $event => ((_ctx.settings.termLogDays) = $event)),
                            type: "number",
                            min: "1",
                            max: "3650",
                            onChange: _cache[306] || (_cache[306] = $event => (_ctx.saveTermLog()))
                          }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                            [
                              _vModelText,
                              _ctx.settings.termLogDays,
                              void 0,
                              { number: true }
                            ]
                          ])
                        ])
                      ]),
                      _createElementVNode("p", _hoisted_1008, _toDisplayString(_ctx.t('Per window, counting from the most recent.')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_1009, _toDisplayString(_ctx.t('Counted from the last step of a window, so one still being used is never cut short. When the days run out, that whole session goes.')), 1 /* TEXT */)
                    ], 64 /* STABLE_FRAGMENT */))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", _hoisted_1010, [
                  _createElementVNode("button", {
                    class: "btn sm",
                    onClick: _cache[307] || (_cache[307] = $event => (_ctx.openTermLog()))
                  }, _toDisplayString(_ctx.t('Show what was kept')), 1 /* TEXT */)
                ])
              ], 512 /* NEED_PATCH */), [
                [_vShow, _ctx.settingTab === 'term']
              ]),
              _withDirectives(_createElementVNode("section", _hoisted_1011, [
                _createElementVNode("h3", null, [
                  _hoisted_1012,
                  _createTextVNode(_toDisplayString(_ctx.t('Connections and keys')), 1 /* TEXT */)
                ]),
                _createElementVNode("h4", null, _toDisplayString(_ctx.t('Connection list for SSH, Telnet, FTP, SFTP and SCP')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_1013, _toDisplayString(_ctx.t('The servers you connect to are kept in RegiBase, so a password is sealed with your own master key and not with a secret held on this server.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1014, [
                  _createElementVNode("button", {
                    class: "btn sm",
                    onClick: _cache[308] || (_cache[308] = $event => (_ctx.openConnSetup()))
                  }, _toDisplayString(_ctx.t('Set up the connection list')), 1 /* TEXT */)
                ]),
                _createElementVNode("h4", null, _toDisplayString(_ctx.t('Acting as root')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_1015, _toDisplayString(_ctx.t('Over SCP a command can be put through sudo. The password is asked for each time and kept nowhere, but it stays usable while the page is open — so it is let go after this long with nothing touched.')), 1 /* TEXT */),
                _createElementVNode("label", _hoisted_1016, [
                  _createElementVNode("span", _hoisted_1017, _toDisplayString(_ctx.t('Give up root after')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[309] || (_cache[309] = $event => ((_ctx.settings.rootIdleMinutes) = $event)),
                    onChange: _cache[310] || (_cache[310] = (...args) => (_ctx.saveRootIdle && _ctx.saveRootIdle(...args)))
                  }, [
                    _createElementVNode("option", _hoisted_1018, _toDisplayString(_ctx.t('1 minute')), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_1019, _toDisplayString(_ctx.t('{n} minutes', {n: 3})), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_1020, _toDisplayString(_ctx.t('{n} minutes', {n: 5})), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_1021, _toDisplayString(_ctx.t('{n} minutes', {n: 10})), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_1022, _toDisplayString(_ctx.t('{n} minutes', {n: 30})), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_1023, _toDisplayString(_ctx.t('Do not give it up on its own')), 1 /* TEXT */)
                  ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [
                      _vModelSelect,
                      _ctx.settings.rootIdleMinutes,
                      void 0,
                      { number: true }
                    ]
                  ])
                ]),
                _createElementVNode("h4", null, _toDisplayString(_ctx.t('Where your SSH keys are kept')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_1024, _toDisplayString(_ctx.t('Name the folder your keys live in, and the file chooser starts there every time.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1025, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[311] || (_cache[311] = $event => ((_ctx.settings.keyFolder) = $event)),
                    class: "grow mono",
                    placeholder: _ctx.t('Anywhere in your Nextcloud files'),
                    onChange: _cache[312] || (_cache[312] = (...args) => (_ctx.saveKeyFolder && _ctx.saveKeyFolder(...args)))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1026), [
                    [_vModelText, _ctx.settings.keyFolder]
                  ]),
                  _createElementVNode("button", {
                    class: "btn sm",
                    onClick: _cache[313] || (_cache[313] = $event => {_ctx.pickFile(_ctx.t('Choose a folder'), (p) => { _ctx.settings.keyFolder = p; _ctx.saveKeyFolder(); }, true, _ctx.settings.keyFolder)})
                  }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn sm",
                    disabled: !_ctx.settings.keyFolder,
                    onClick: _cache[314] || (_cache[314] = $event => {_ctx.settings.keyFolder = ''; _ctx.saveKeyFolder()})
                  }, _toDisplayString(_ctx.t('Clear the folder')), 9 /* TEXT, PROPS */, _hoisted_1027)
                ])
              ], 512 /* NEED_PATCH */), [
                [_vShow, _ctx.settingTab === 'conn']
              ]),
              _withDirectives(_createElementVNode("section", _hoisted_1028, [
                _createElementVNode("h3", null, [
                  _hoisted_1029,
                  _createTextVNode(_toDisplayString(_ctx.t('The list of tools')), 1 /* TEXT */)
                ]),
                _createElementVNode("p", _hoisted_1030, _toDisplayString(_ctx.t('Drag the tools in the sidebar into the order you work in, or hold Alt and press the up and down arrows.')), 1 /* TEXT */),
                _createElementVNode("button", {
                  class: "btn sm",
                  disabled: !(_ctx.settings.tabOrder || []).length,
                  onClick: _cache[315] || (_cache[315] = (...args) => (_ctx.resetTabOrder && _ctx.resetTabOrder(...args)))
                }, _toDisplayString(_ctx.t('Put them back in the original order')), 9 /* TEXT, PROPS */, _hoisted_1031)
              ], 512 /* NEED_PATCH */), [
                [_vShow, _ctx.settingTab === 'tools']
              ])
            ]),
            _createElementVNode("div", _hoisted_1032, [
              _hoisted_1033,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[316] || (_cache[316] = $event => (_ctx.themeBox=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ sign in to a server, asked for on the spot ============ "),
    (_ctx.sshAsk.open)
      ? (_openBlock(), _createElementBlock("div", _hoisted_1034, [
          _createElementVNode("div", _hoisted_1035, [
            _createElementVNode("div", _hoisted_1036, [
              _hoisted_1037,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Sign in with details typed here')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1038, _toDisplayString(_ctx.t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.')), 1 /* TEXT */)
              ]),
              _hoisted_1039,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[317] || (_cache[317] = $event => (_ctx.sshAsk.open=false))
              }, _hoisted_1042, 8 /* PROPS */, _hoisted_1040)
            ]),
            _createElementVNode("div", _hoisted_1043, [
              _createElementVNode("div", _hoisted_1044, [
                _createElementVNode("label", _hoisted_1045, [
                  _createElementVNode("span", _hoisted_1046, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[318] || (_cache[318] = $event => ((_ctx.sshAsk.host) = $event)),
                    class: "mono"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.sshAsk.host]
                  ])
                ]),
                _createElementVNode("label", _hoisted_1047, [
                  _createElementVNode("span", _hoisted_1048, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[319] || (_cache[319] = $event => ((_ctx.sshAsk.port) = $event)),
                    type: "number",
                    min: "1",
                    max: "65535"
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.sshAsk.port,
                      void 0,
                      { number: true }
                    ]
                  ])
                ])
              ]),
              _createElementVNode("div", _hoisted_1049, [
                _createElementVNode("label", _hoisted_1050, [
                  _createElementVNode("span", _hoisted_1051, _toDisplayString(_ctx.t('User name')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[320] || (_cache[320] = $event => ((_ctx.sshAsk.username) = $event)),
                    autocomplete: "off",
                    onKeyup: _cache[321] || (_cache[321] = _withKeys((...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.sshAsk.username]
                  ])
                ]),
                _createElementVNode("label", _hoisted_1052, [
                  _createElementVNode("span", _hoisted_1053, _toDisplayString(_ctx.t('Sign in with')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[322] || (_cache[322] = $event => ((_ctx.sshAsk.authType) = $event))
                  }, [
                    _createElementVNode("option", _hoisted_1054, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_1055, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.sshAsk.authType]
                  ])
                ])
              ]),
              (_ctx.sshAsk.authType === 'key')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_1056, [
                      _createElementVNode("label", _hoisted_1057, [
                        _createElementVNode("span", _hoisted_1058, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[323] || (_cache[323] = $event => ((_ctx.sshAsk.privateKeyPath) = $event)),
                          class: "mono",
                          placeholder: _ctx.t('Key file in your Nextcloud files')
                        }, null, 8 /* PROPS */, _hoisted_1059), [
                          [_vModelText, _ctx.sshAsk.privateKeyPath]
                        ])
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[324] || (_cache[324] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.sshAsk.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("label", _hoisted_1060, [
                      _createElementVNode("span", _hoisted_1061, _toDisplayString(_ctx.t('Key passphrase (if any)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[325] || (_cache[325] = $event => ((_ctx.sshAsk.passphrase) = $event)),
                        type: "password",
                        autocomplete: "new-password",
                        onKeyup: _cache[326] || (_cache[326] = _withKeys((...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.sshAsk.passphrase]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : (_openBlock(), _createElementBlock("label", _hoisted_1062, [
                    _createElementVNode("span", _hoisted_1063, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[327] || (_cache[327] = $event => ((_ctx.sshAsk.secret) = $event)),
                      type: "password",
                      autocomplete: "new-password",
                      onKeyup: _cache[328] || (_cache[328] = _withKeys((...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)), ["enter"]))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelText, _ctx.sshAsk.secret]
                    ])
                  ]))
            ]),
            _createElementVNode("div", _hoisted_1064, [
              _hoisted_1065,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[329] || (_cache[329] = $event => (_ctx.sshAsk.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: !_ctx.sshAsk.host || !_ctx.sshAsk.username,
                onClick: _cache[330] || (_cache[330] = (...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)))
              }, "🖳 " + _toDisplayString(_ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_1066)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ device windows (served through this server) ============ "),
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.windows, (w) => {
      return (_openBlock(), _createElementBlock("div", {
        key: w.id,
        class: _normalizeClass(["devwin", { dragging: !!_ctx.drag }]),
        style: _normalizeStyle({ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }),
        onMousedown: $event => (_ctx.focusWindow(w))
      }, [
        _createElementVNode("div", {
          class: "devwin-head",
          onMousedown: _withModifiers($event => (_ctx.startDrag(w, $event)), ["prevent"])
        }, [
          _hoisted_1069,
          _createElementVNode("strong", _hoisted_1070, _toDisplayString(w.title), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_1071, _toDisplayString(w.base) + _toDisplayString(w.path ? '/' + w.path : ''), 1 /* TEXT */),
          _hoisted_1072,
          _createCommentVNode(" Drawn, not typed: the arrows and crosses a font happens to carry are\n             hairline thin at this size, and no two systems draw them alike. "),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Back'),
            "aria-label": _ctx.t('Back'),
            disabled: w.trailAt < 1,
            onClick: _withModifiers($event => (_ctx.backWindow(w)), ["stop"])
          }, _hoisted_1075, 8 /* PROPS */, _hoisted_1073),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Front page'),
            "aria-label": _ctx.t('Front page'),
            onClick: _withModifiers($event => (_ctx.homeWindow(w)), ["stop"])
          }, _hoisted_1078, 8 /* PROPS */, _hoisted_1076),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Reload'),
            "aria-label": _ctx.t('Reload'),
            onClick: _withModifiers($event => (_ctx.reloadWindow(w)), ["stop"])
          }, _hoisted_1081, 8 /* PROPS */, _hoisted_1079),
          (!_ctx.narrow)
            ? (_openBlock(), _createElementBlock("button", {
                key: 0,
                class: "btn xs ib",
                title: _ctx.t('Fill the screen'),
                "aria-label": _ctx.t('Fill the screen'),
                onClick: _withModifiers($event => (_ctx.toggleFull(w)), ["stop"])
              }, _hoisted_1084, 8 /* PROPS */, _hoisted_1082))
            : _createCommentVNode("v-if", true),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('What this window can and cannot do'),
            "aria-label": _ctx.t('What this window can and cannot do'),
            onClick: _withModifiers($event => (w.help = !w.help), ["stop"])
          }, _hoisted_1087, 8 /* PROPS */, _hoisted_1085),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Close'),
            "aria-label": _ctx.t('Close'),
            onClick: _withModifiers($event => (_ctx.closeWindow(w)), ["stop"])
          }, _hoisted_1090, 8 /* PROPS */, _hoisted_1088)
        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1068),
        (w.help)
          ? (_openBlock(), _createElementBlock("div", {
              key: 0,
              class: "devwin-help",
              onMousedown: _cache[331] || (_cache[331] = _withModifiers(() => {}, ["stop"]))
            }, [
              _createElementVNode("strong", null, _toDisplayString(_ctx.t('What works here')), 1 /* TEXT */),
              _createElementVNode("ul", null, [
                _createElementVNode("li", null, _toDisplayString(_ctx.t('Sign in and change settings, exactly as you would in front of the device')), 1 /* TEXT */),
                _createElementVNode("li", null, _toDisplayString(_ctx.t('Send files to it — new firmware, a saved configuration')), 1 /* TEXT */),
                _createElementVNode("li", null, _toDisplayString(_ctx.t('Take files from it — a backup, a log — whatever their size')), 1 /* TEXT */),
                _createElementVNode("li", null, _toDisplayString(_ctx.t('Older interfaces built out of frames')), 1 /* TEXT */),
                _createElementVNode("li", null, _toDisplayString(_ctx.t('Its password, remembered for you after the first time')), 1 /* TEXT */)
              ]),
              _createElementVNode("strong", null, _toDisplayString(_ctx.t('What does not')), 1 /* TEXT */),
              _createElementVNode("ul", null, [
                _createElementVNode("li", null, _toDisplayString(_ctx.t('A console that stays connected, which some switches offer')), 1 /* TEXT */),
                _createElementVNode("li", null, _toDisplayString(_ctx.t('Anything needing Java or ActiveX in the browser')), 1 /* TEXT */)
              ]),
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _withModifiers($event => (w.help = false), ["stop"])
              }, _toDisplayString(_ctx.t('Close')), 9 /* TEXT, PROPS */, _hoisted_1091)
            ], 32 /* NEED_HYDRATION */))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" What used to be here was a sentence explaining the window to someone\n           who had already opened it. This is the row of things a person\n           actually reaches for while signing into a device: its address, what\n           is on the page, and the clipboard going the other way, because a\n           device password is nearly always pasted. "),
        (!w.busy && !w.error)
          ? (_openBlock(), _createElementBlock("div", {
              key: 1,
              class: "devwin-bar",
              onMousedown: _cache[338] || (_cache[338] = _withModifiers(() => {}, ["stop"]))
            }, [
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Copy this device\'s own address'),
                onClick: _withModifiers($event => (_ctx.copyText(w.base + (w.path ? '/' + w.path : ''), _ctx.t('Address copied'))), ["stop"])
              }, [
                _hoisted_1093,
                _createElementVNode("span", _hoisted_1094, _toDisplayString(_ctx.t('Address')), 1 /* TEXT */)
              ], 8 /* PROPS */, _hoisted_1092),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Copy whatever is selected on the page, or the whole page if nothing is'),
                onClick: _withModifiers($event => (_ctx.copyFromWindow(w)), ["stop"])
              }, [
                _hoisted_1096,
                _createElementVNode("span", _hoisted_1097, _toDisplayString(_ctx.t('Page text')), 1 /* TEXT */)
              ], 8 /* PROPS */, _hoisted_1095),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Paste the clipboard into the field the cursor is in'),
                onMousedown: _cache[332] || (_cache[332] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.pasteIntoWindow(w)), ["stop"])
              }, [
                _hoisted_1099,
                _createElementVNode("span", _hoisted_1100, _toDisplayString(_ctx.t('Paste')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1098),
              _hoisted_1101,
              _createCommentVNode(" Device interfaces are drawn for a screen of their own era. Some\n             are unreadably small in a window; some waste half of it. "),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Take a picture of this page'),
                onMousedown: _cache[333] || (_cache[333] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.shootWindow(w)), ["stop"])
              }, [
                _hoisted_1103,
                _createElementVNode("span", _hoisted_1104, _toDisplayString(_ctx.t('Screenshot')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1102),
              _createElementVNode("span", _hoisted_1105, [
                _createElementVNode("button", {
                  class: _normalizeClass(["btn xs ib", {active: w.fit}]),
                  title: _ctx.t('Fit the page to the window'),
                  "aria-label": _ctx.t('Fit the page to the window'),
                  onMousedown: _cache[334] || (_cache[334] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.toggleFit(w)), ["stop"])
                }, _hoisted_1108, 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_1106),
                _createElementVNode("button", {
                  class: "btn xs ib",
                  title: _ctx.t('Smaller'),
                  "aria-label": _ctx.t('Smaller'),
                  disabled: !_ctx.canZoom(w, -1),
                  onMousedown: _cache[335] || (_cache[335] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.zoomWindow(w, -1)), ["stop"])
                }, _hoisted_1111, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1109),
                _createElementVNode("button", {
                  class: "btn xs zoom-now",
                  title: _ctx.t('Back to 100%'),
                  onMousedown: _cache[336] || (_cache[336] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.resetZoom(w)), ["stop"])
                }, _toDisplayString(Math.round(w.zoom * 100)) + "%", 41 /* TEXT, PROPS, NEED_HYDRATION */, _hoisted_1112),
                _createElementVNode("button", {
                  class: "btn xs ib",
                  title: _ctx.t('Larger'),
                  "aria-label": _ctx.t('Larger'),
                  disabled: !_ctx.canZoom(w, 1),
                  onMousedown: _cache[337] || (_cache[337] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.zoomWindow(w, 1)), ["stop"])
                }, _hoisted_1115, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1113)
              ]),
              _createElementVNode("span", _hoisted_1116, _toDisplayString(w.base.replace(/^https?:\/\//, '')), 1 /* TEXT */)
            ], 32 /* NEED_HYDRATION */))
          : _createCommentVNode("v-if", true),
        (w.busy)
          ? (_openBlock(), _createElementBlock("div", _hoisted_1117, _toDisplayString(_ctx.t('Connecting…')), 1 /* TEXT */))
          : (w.error)
            ? (_openBlock(), _createElementBlock("div", _hoisted_1118, "⚠ " + _toDisplayString(w.error), 1 /* TEXT */))
            : (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                _createCommentVNode(" The page is sandboxed against navigating anything but itself, so a device\n           that tries to break out of frames cannot take the browser with it, and a\n           policy pins everything it loads or sends to the proxy path, so it cannot\n           reach a Nextcloud endpoint. The name is how its own \"replace everything\"\n           links find this window. "),
                _createElementVNode("div", _hoisted_1119, [
                  _createElementVNode("iframe", {
                    src: w.src,
                    class: "devwin-frame",
                    title: w.title,
                    "data-window": w.id,
                    name: "_netbase_window",
                    onLoad: $event => (_ctx.onWindowLoad(w, $event)),
                    sandbox: "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1120),
                  _createCommentVNode(" A slow line or a sleepy device leaves the frame blank; this sits over\n             it until the page loads, so it is clear it is still working. "),
                  (w.loading)
                    ? (_openBlock(), _createElementBlock("div", _hoisted_1121, [
                        _hoisted_1122,
                        _createElementVNode("span", _hoisted_1123, [
                          _createTextVNode(_toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */),
                          (w.loadSecs >= 3)
                            ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                                _createTextVNode(_toDisplayString(_ctx.t('({s}s)', {s: w.loadSecs})), 1 /* TEXT */)
                              ], 64 /* STABLE_FRAGMENT */))
                            : _createCommentVNode("v-if", true)
                        ])
                      ]))
                    : _createCommentVNode("v-if", true)
                ])
              ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */)),
        _createCommentVNode(" A message about this window, shown inside it: a device window sits above\n           the app's own banner (its z-index is raised on every focus), so a note\n           put there would be hidden behind the window it is about. "),
        (w.toast)
          ? (_openBlock(), _createElementBlock("div", {
              key: 5,
              class: _normalizeClass(["devwin-toast", w.toast.kind]),
              onClick: $event => (w.toast = null)
            }, _toDisplayString(w.toast.text), 11 /* TEXT, CLASS, PROPS */, _hoisted_1124))
          : _createCommentVNode("v-if", true),
        _createElementVNode("div", {
          class: "devwin-grip",
          onMousedown: _withModifiers($event => (_ctx.startResize(w, $event)), ["prevent","stop"])
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1125)
      ], 46 /* CLASS, STYLE, PROPS, NEED_HYDRATION */, _hoisted_1067))
    }), 128 /* KEYED_FRAGMENT */)),
    _createCommentVNode(" ============ what can be done to the device under the pointer ============ "),
    _createCommentVNode(" A right-click asks the obvious question — how do I get into this thing —\n         and the answer is already known: whichever of its ports are open. "),
    _createCommentVNode(" One line of text, or a yes, asked in the page rather than by the\n         browser: a native prompt() freezes an embedded window. "),
    (_ctx.ask.open)
      ? (_openBlock(), _createElementBlock("div", _hoisted_1126, [
          _createElementVNode("div", _hoisted_1127, [
            _createElementVNode("div", _hoisted_1128, [
              _createElementVNode("span", _hoisted_1129, _toDisplayString(_ctx.ask.icon), 1 /* TEXT */),
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.ask.title), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1130, _toDisplayString(_ctx.ask.subject), 1 /* TEXT */)
              ])
            ]),
            _createElementVNode("div", _hoisted_1131, [
              (_ctx.ask.body)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1132, _toDisplayString(_ctx.ask.body), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.ask.input)
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                    (_ctx.ask.label)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_1133, _toDisplayString(_ctx.ask.label), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    _withDirectives(_createElementVNode("input", {
                      ref: "askBox",
                      "onUpdate:modelValue": _cache[339] || (_cache[339] = $event => ((_ctx.ask.value) = $event)),
                      type: "text",
                      class: "grow mono",
                      autocomplete: "off",
                      onKeyup: _cache[340] || (_cache[340] = _withKeys($event => (_ctx.askOk()), ["enter"]))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelText, _ctx.ask.value]
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_1134, [
              _hoisted_1135,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[341] || (_cache[341] = $event => (_ctx.askClose(null)))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: _normalizeClass(["btn", _ctx.ask.danger ? 'danger' : 'primary']),
                disabled: _ctx.ask.input && !String(_ctx.ask.value || '').trim(),
                onClick: _cache[342] || (_cache[342] = $event => (_ctx.askOk()))
              }, _toDisplayString(_ctx.ask.confirm), 11 /* TEXT, CLASS, PROPS */, _hoisted_1136)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" What can be done with the file under the pointer. "),
    (_ctx.fileMenu.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 10,
          class: "row-menu-veil",
          onClick: _cache[343] || (_cache[343] = $event => (_ctx.fileMenu.open = false)),
          onContextmenu: _cache[344] || (_cache[344] = _withModifiers($event => (_ctx.fileMenu.open = false), ["prevent"]))
        }, null, 32 /* NEED_HYDRATION */))
      : _createCommentVNode("v-if", true),
    (_ctx.fileMenu.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 11,
          class: "row-menu",
          style: _normalizeStyle({ left: _ctx.fileMenu.x + 'px', top: _ctx.fileMenu.y + 'px' }),
          onClick: _cache[355] || (_cache[355] = _withModifiers(() => {}, ["stop"]))
        }, [
          _createElementVNode("div", _hoisted_1137, _toDisplayString(_ctx.fileMenu.entry.directory ? '📁' : '📄') + " " + _toDisplayString(_ctx.fileMenu.entry.name), 1 /* TEXT */),
          (_ctx.fileMenu.entry.directory)
            ? (_openBlock(), _createElementBlock("button", {
                key: 0,
                class: "row-menu-item",
                onClick: _cache[345] || (_cache[345] = $event => (_ctx.runFileMenu('open')))
              }, _toDisplayString(_ctx.t('Open')), 1 /* TEXT */))
            : _createCommentVNode("v-if", true),
          _createCommentVNode(" A text file opens in a window of its own, beside the listing rather\n           than instead of it, so it can be read against what is on the other\n           side. Anything larger than a megabyte is refused by the server with\n           a reason rather than filling the window with rubbish. "),
          (!_ctx.fileMenu.entry.directory)
            ? (_openBlock(), _createElementBlock("button", {
                key: 1,
                class: "row-menu-item",
                onClick: _cache[346] || (_cache[346] = $event => (_ctx.runFileMenu('view')))
              }, "📄 " + _toDisplayString(_ctx.t('Open in a window')), 1 /* TEXT */))
            : _createCommentVNode("v-if", true),
          _createElementVNode("button", {
            class: "row-menu-item",
            onClick: _cache[347] || (_cache[347] = $event => (_ctx.runFileMenu('download')))
          }, "⤓ " + _toDisplayString(_ctx.fileMenu.entry.directory ? _ctx.t('Download as ZIP') : _ctx.t('Download file')), 1 /* TEXT */),
          _createElementVNode("button", {
            class: "row-menu-item",
            onClick: _cache[348] || (_cache[348] = $event => (_ctx.runFileMenu('copyPath')))
          }, _toDisplayString(_ctx.t('Copy the path')), 1 /* TEXT */),
          _hoisted_1138,
          _createElementVNode("button", {
            class: "row-menu-item",
            onClick: _cache[349] || (_cache[349] = $event => (_ctx.runFileMenu('rename')))
          }, _toDisplayString(_ctx.t('Rename')), 1 /* TEXT */),
          _createElementVNode("button", {
            class: "row-menu-item",
            onClick: _cache[350] || (_cache[350] = $event => (_ctx.runFileMenu('chmod')))
          }, _toDisplayString(_ctx.t('Change permissions')), 1 /* TEXT */),
          _createCommentVNode(" The timestamp is yours to set on your own files, so it is always\n           offered. The owner and the group are not: every server refuses those\n           to an ordinary account, and showing them would be offering something\n           that cannot work. "),
          _createElementVNode("button", {
            class: "row-menu-item",
            onClick: _cache[351] || (_cache[351] = $event => (_ctx.runFileMenu('touch')))
          }, _toDisplayString(_ctx.t('Set the time to now')), 1 /* TEXT */),
          (_ctx.asRoot && _ctx.sudoPassword)
            ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                _createElementVNode("button", {
                  class: "row-menu-item",
                  onClick: _cache[352] || (_cache[352] = $event => (_ctx.runFileMenu('chown')))
                }, _toDisplayString(_ctx.t('Change owner')), 1 /* TEXT */),
                _createElementVNode("button", {
                  class: "row-menu-item",
                  onClick: _cache[353] || (_cache[353] = $event => (_ctx.runFileMenu('chgrp')))
                }, _toDisplayString(_ctx.t('Change group')), 1 /* TEXT */)
              ], 64 /* STABLE_FRAGMENT */))
            : _createCommentVNode("v-if", true),
          _hoisted_1139,
          _createElementVNode("button", {
            class: "row-menu-item",
            onClick: _cache[354] || (_cache[354] = $event => (_ctx.runFileMenu('delete')))
          }, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */)
        ], 4 /* STYLE */))
      : _createCommentVNode("v-if", true),
    (_ctx.rowMenu.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 12,
          class: "row-menu-veil",
          onClick: _cache[358] || (_cache[358] = $event => (_ctx.rowMenu.open = false)),
          onContextmenu: _cache[359] || (_cache[359] = _withModifiers($event => (_ctx.rowMenu.open = false), ["prevent"]))
        }, [
          _createElementVNode("ul", {
            class: "row-menu",
            style: _normalizeStyle({ left: _ctx.rowMenu.x + 'px', top: _ctx.rowMenu.y + 'px' }),
            onClick: _cache[357] || (_cache[357] = _withModifiers(() => {}, ["stop"]))
          }, [
            _createElementVNode("li", _hoisted_1140, _toDisplayString(_ctx.rowMenu.device ? (_ctx.rowMenu.device.name || _ctx.rowMenu.device.ip) : ''), 1 /* TEXT */),
            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.rowActions(_ctx.rowMenu.device), (a, i) => {
              return (_openBlock(), _createElementBlock("li", { key: i }, [
                _createElementVNode("button", {
                  class: "row-menu-item",
                  onClick: $event => {_ctx.rowMenu.open = false; a.run()}
                }, [
                  _createElementVNode("span", _hoisted_1142, _toDisplayString(a.icon), 1 /* TEXT */),
                  _createTextVNode(_toDisplayString(a.label), 1 /* TEXT */)
                ], 8 /* PROPS */, _hoisted_1141)
              ]))
            }), 128 /* KEYED_FRAGMENT */)),
            (!_ctx.rowActions(_ctx.rowMenu.device).length)
              ? (_openBlock(), _createElementBlock("li", _hoisted_1143, _toDisplayString(_ctx.t('No way in on the ports it has open')), 1 /* TEXT */))
              : _createCommentVNode("v-if", true),
            _hoisted_1144,
            _createElementVNode("li", null, [
              _createElementVNode("button", {
                class: "row-menu-item",
                onClick: _cache[356] || (_cache[356] = $event => {_ctx.rowMenu.open = false; _ctx.openDevice(_ctx.rowMenu.device)})
              }, [
                _hoisted_1145,
                _createTextVNode(_toDisplayString(_ctx.t('Properties')), 1 /* TEXT */)
              ])
            ])
          ], 4 /* STYLE */)
        ], 32 /* NEED_HYDRATION */))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ text windows (a file, open beside the list) ============ "),
    _createCommentVNode(" The same frame as a device or terminal window: moved, resized, several\n         at once. A file you are checking against another file has to be\n         readable at the same time as the listing, not instead of it. "),
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.textWins, (w) => {
      return (_openBlock(), _createElementBlock("div", {
        key: w.id,
        class: _normalizeClass(["devwin text-win", { dragging: !!_ctx.drag }]),
        style: _normalizeStyle({ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }),
        onMousedown: $event => (_ctx.focusWindow(w))
      }, [
        _createElementVNode("div", {
          class: "devwin-head",
          onMousedown: _withModifiers($event => (_ctx.startDrag(w, $event)), ["prevent"])
        }, [
          _hoisted_1148,
          _createElementVNode("strong", _hoisted_1149, [
            _createTextVNode(_toDisplayString(w.name), 1 /* TEXT */),
            (_ctx.textChanged(w))
              ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                  _createTextVNode(" ●")
                ], 64 /* STABLE_FRAGMENT */))
              : _createCommentVNode("v-if", true)
          ]),
          _createElementVNode("span", _hoisted_1150, _toDisplayString(w.path), 1 /* TEXT */),
          _hoisted_1151,
          _createElementVNode("span", _hoisted_1152, _toDisplayString(w.encoding) + " · " + _toDisplayString(w.newline === 'crlf' ? 'CRLF' : 'LF') + " · " + _toDisplayString(_ctx.fmtBytes(w.bytes)), 1 /* TEXT */),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Reload'),
            "aria-label": _ctx.t('Reload'),
            onClick: _withModifiers($event => (_ctx.reloadText(w)), ["stop"])
          }, _hoisted_1155, 8 /* PROPS */, _hoisted_1153),
          (!_ctx.narrow)
            ? (_openBlock(), _createElementBlock("button", {
                key: 0,
                class: "btn xs ib",
                title: _ctx.t('Fill the screen'),
                "aria-label": _ctx.t('Fill the screen'),
                onClick: _withModifiers($event => (_ctx.toggleFull(w)), ["stop"])
              }, _hoisted_1158, 8 /* PROPS */, _hoisted_1156))
            : _createCommentVNode("v-if", true),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Close'),
            "aria-label": _ctx.t('Close'),
            onClick: _withModifiers($event => (_ctx.closeText(w)), ["stop"])
          }, _hoisted_1161, 8 /* PROPS */, _hoisted_1159)
        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1147),
        _withDirectives(_createElementVNode("textarea", {
          "onUpdate:modelValue": $event => ((w.text) = $event),
          class: "text-body mono",
          spellcheck: "false"
        }, null, 8 /* PROPS */, _hoisted_1162), [
          [_vModelText, w.text]
        ]),
        _createElementVNode("div", _hoisted_1163, [
          (w.note)
            ? (_openBlock(), _createElementBlock("span", _hoisted_1164, _toDisplayString(w.note), 1 /* TEXT */))
            : (_ctx.textChanged(w))
              ? (_openBlock(), _createElementBlock("span", _hoisted_1165, _toDisplayString(_ctx.t('Changed — not saved yet')), 1 /* TEXT */))
              : _createCommentVNode("v-if", true),
          _hoisted_1166,
          _createElementVNode("button", {
            class: _normalizeClass(["btn sm primary", {working: w.saving}]),
            disabled: w.saving || !_ctx.textChanged(w),
            onClick: $event => (_ctx.saveText(w))
          }, _toDisplayString(_ctx.t('Save')), 11 /* TEXT, CLASS, PROPS */, _hoisted_1167)
        ]),
        _createElementVNode("div", {
          class: "devwin-grip",
          onMousedown: _withModifiers($event => (_ctx.startResize(w, $event)), ["prevent","stop"])
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1168)
      ], 46 /* CLASS, STYLE, PROPS, NEED_HYDRATION */, _hoisted_1146))
    }), 128 /* KEYED_FRAGMENT */)),
    _createCommentVNode(" ============ terminal windows (SSH and Telnet) ============ "),
    _createCommentVNode(" The same frame as a device window: moved, resized, several at once, and\n         open beside the list rather than instead of it. "),
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.terms, (w) => {
      return (_openBlock(), _createElementBlock("div", {
        key: w.id,
        class: _normalizeClass(["devwin term-win", { dragging: !!_ctx.drag }]),
        style: _normalizeStyle({ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }),
        onMousedown: $event => (_ctx.focusWindow(w))
      }, [
        _createElementVNode("div", {
          class: "devwin-head",
          onMousedown: _withModifiers($event => (_ctx.startDrag(w, $event)), ["prevent"])
        }, [
          _hoisted_1171,
          _createElementVNode("strong", _hoisted_1172, [
            _createTextVNode(_toDisplayString(w.kind === 'shell' ? _ctx.t('Shell') : (w.kind === 'telnet' ? 'Telnet' : 'SSH')), 1 /* TEXT */),
            (w.kind !== 'shell')
              ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                  _createTextVNode(" · " + _toDisplayString(w.host), 1 /* TEXT */)
                ], 64 /* STABLE_FRAGMENT */))
              : _createCommentVNode("v-if", true)
          ]),
          _createElementVNode("span", _hoisted_1173, _toDisplayString(w.kind === 'shell' ? _ctx.t('This server') : (w.prompt || (w.user ? w.user + '@' + w.host : w.host + ':' + w.port))), 1 /* TEXT */),
          _hoisted_1174,
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Clear'),
            "aria-label": _ctx.t('Clear'),
            onClick: _withModifiers($event => (_ctx.clearTerm(w)), ["stop"])
          }, _hoisted_1177, 8 /* PROPS */, _hoisted_1175),
          (!_ctx.narrow)
            ? (_openBlock(), _createElementBlock("button", {
                key: 0,
                class: "btn xs ib",
                title: _ctx.t('Fill the screen'),
                "aria-label": _ctx.t('Fill the screen'),
                onClick: _withModifiers($event => (_ctx.toggleFull(w)), ["stop"])
              }, _hoisted_1180, 8 /* PROPS */, _hoisted_1178))
            : _createCommentVNode("v-if", true),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Close'),
            "aria-label": _ctx.t('Close'),
            onClick: _withModifiers($event => (_ctx.closeTerm(w)), ["stop"])
          }, _hoisted_1183, 8 /* PROPS */, _hoisted_1181)
        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1170),
        _createCommentVNode(" A word about what just happened, inside this window. The app's own\n           banner sits across the top of everything, which is the wrong place\n           for something only this terminal did. "),
        (w.toast)
          ? (_openBlock(), _createElementBlock("div", {
              key: 0,
              class: _normalizeClass(["devwin-toast", w.toast.kind]),
              onClick: $event => (w.toast = null)
            }, _toDisplayString(w.toast.text), 11 /* TEXT, CLASS, PROPS */, _hoisted_1184))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" The same copy-and-paste row a device window has, for the screen\n           terminals (SSH and the local shell). The line-at-a-time Telnet\n           console has its own input, so it keeps out of this. "),
        (w.kind === 'ssh' || w.kind === 'shell')
          ? (_openBlock(), _createElementBlock("div", {
              key: 1,
              class: "devwin-bar term-bar",
              onMousedown: _cache[380] || (_cache[380] = _withModifiers(() => {}, ["stop"]))
            }, [
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Copy whatever is selected, or the whole screen if nothing is'),
                onMousedown: _cache[360] || (_cache[360] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.copyTerm(w)), ["stop"])
              }, [
                _hoisted_1186,
                _createElementVNode("span", _hoisted_1187, _toDisplayString(_ctx.t('Copy')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1185),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Paste the clipboard into the terminal'),
                onMousedown: _cache[361] || (_cache[361] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.pasteTerm(w)), ["stop"])
              }, [
                _hoisted_1189,
                _createElementVNode("span", _hoisted_1190, _toDisplayString(_ctx.t('Paste')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1188),
              _createCommentVNode(" Meta onward lives in this menu, so the row stays a single line.\n             An armed Meta or Ctrl still shows on the button itself, which is\n             the one thing that must be visible while the menu is shut. "),
              _createElementVNode("span", _hoisted_1191, [
                _createElementVNode("button", {
                  class: _normalizeClass(["btn xs", {active: w.meta || w.ctrl || w.keyMenu}]),
                  title: _ctx.t('Keys, and the terminal font'),
                  onMousedown: _cache[362] || (_cache[362] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.toggleKeyMenu(w, $event)), ["stop"])
                }, [
                  _hoisted_1193,
                  _createElementVNode("span", _hoisted_1194, _toDisplayString(_ctx.t('Keys')), 1 /* TEXT */)
                ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_1192),
                (w.keyMenu)
                  ? (_openBlock(), _createElementBlock("div", {
                      key: 0,
                      class: "term-menu-veil",
                      onClick: _withModifiers($event => (w.keyMenu = false), ["stop"]),
                      onContextmenu: _withModifiers($event => (w.keyMenu = false), ["prevent"])
                    }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1195))
                  : _createCommentVNode("v-if", true),
                (w.keyMenu)
                  ? (_openBlock(), _createElementBlock("div", {
                      key: 1,
                      class: "term-menu",
                      style: _normalizeStyle({ left: w.menuX + 'px', top: w.menuY + 'px' }),
                      onMousedown: _cache[372] || (_cache[372] = _withModifiers(() => {}, ["stop"])),
                      onClick: _cache[373] || (_cache[373] = _withModifiers(() => {}, ["stop"]))
                    }, [
                      _createElementVNode("div", _hoisted_1196, _toDisplayString(_ctx.t('Send a key')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_1197, [
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn xs key wide", {active: w.meta}]),
                          title: _ctx.t('Send the next key with Meta (Alt) held down'),
                          onMousedown: _cache[363] || (_cache[363] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.toggleMeta(w))
                        }, _toDisplayString(_ctx.t('Meta')), 43 /* TEXT, CLASS, PROPS, NEED_HYDRATION */, _hoisted_1198),
                        _createElementVNode("button", {
                          class: _normalizeClass(["btn xs key wide", {active: w.ctrl}]),
                          title: _ctx.t('Send the next key with Ctrl held down'),
                          onMousedown: _cache[364] || (_cache[364] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.toggleCtrl(w))
                        }, _toDisplayString(_ctx.t('Ctrl')), 43 /* TEXT, CLASS, PROPS, NEED_HYDRATION */, _hoisted_1199),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('Send Escape'),
                          onMousedown: _cache[365] || (_cache[365] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'esc'))
                        }, "Esc", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1200),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('Send a Tab, to complete a name'),
                          onMousedown: _cache[366] || (_cache[366] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'tab'))
                        }, "Tab", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1201),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('Interrupt what is running (Ctrl+C)'),
                          onMousedown: _cache[367] || (_cache[367] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'intr'))
                        }, "^C", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1202),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('End of input (Ctrl+D)'),
                          onMousedown: _cache[368] || (_cache[368] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'eof'))
                        }, "^D", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1203),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('Suspend what is running (Ctrl+Z)'),
                          onMousedown: _cache[369] || (_cache[369] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'susp'))
                        }, "^Z", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1204),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('Clear the screen (Ctrl+L)'),
                          onMousedown: _cache[370] || (_cache[370] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'clear'))
                        }, "^L", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1205),
                        _createElementVNode("button", {
                          class: "btn xs key",
                          title: _ctx.t('Search the command history (Ctrl+R)'),
                          onMousedown: _cache[371] || (_cache[371] = _withModifiers(() => {}, ["prevent"])),
                          onClick: $event => (_ctx.sendKey(w, 'search'))
                        }, "^R", 40 /* PROPS, NEED_HYDRATION */, _hoisted_1206)
                      ])
                    ], 36 /* STYLE, NEED_HYDRATION */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createCommentVNode(" The size is set here, while looking at the screen it changes. The\n             face itself is chosen once, and lives in Settings. "),
              _createElementVNode("span", _hoisted_1207, [
                _createElementVNode("button", {
                  class: "btn xs ib",
                  title: _ctx.t('Smaller'),
                  "aria-label": _ctx.t('Smaller'),
                  disabled: _ctx.settings.termFontSize <= 9,
                  onMousedown: _cache[374] || (_cache[374] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _cache[375] || (_cache[375] = _withModifiers($event => (_ctx.stepTermSize(-1)), ["stop"]))
                }, _hoisted_1210, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1208),
                _createElementVNode("span", _hoisted_1211, _toDisplayString(_ctx.settings.termFontSize) + "px", 1 /* TEXT */),
                _createElementVNode("button", {
                  class: "btn xs ib",
                  title: _ctx.t('Larger'),
                  "aria-label": _ctx.t('Larger'),
                  disabled: _ctx.settings.termFontSize >= 24,
                  onMousedown: _cache[376] || (_cache[376] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _cache[377] || (_cache[377] = _withModifiers($event => (_ctx.stepTermSize(1)), ["stop"]))
                }, _hoisted_1214, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1212)
              ]),
              _hoisted_1215,
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Save the screen as a picture'),
                onMousedown: _cache[378] || (_cache[378] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.shootTerm(w)), ["stop"])
              }, [
                _hoisted_1217,
                _createElementVNode("span", _hoisted_1218, _toDisplayString(_ctx.t('Save screen')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1216),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Copy the whole screen, including what has scrolled off'),
                onMousedown: _cache[379] || (_cache[379] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.copyTerm(w, true)), ["stop"])
              }, [
                _hoisted_1220,
                _createElementVNode("span", _hoisted_1221, _toDisplayString(_ctx.t('Copy all')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1219)
            ], 32 /* NEED_HYDRATION */))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" Telnet asks who you are before it will say anything useful, and PHP\n           cannot hold the answer between requests, so it is kept here and sent\n           with every line. "),
        (w.kind === 'telnet' && !w.signedIn)
          ? (_openBlock(), _createElementBlock("div", _hoisted_1222, [
              _withDirectives(_createElementVNode("input", {
                "onUpdate:modelValue": $event => ((w.user) = $event),
                placeholder: _ctx.t('User name'),
                autocomplete: "off",
                spellcheck: "false",
                onKeyup: _withKeys($event => (_ctx.signInTerm(w)), ["enter"])
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1223), [
                [_vModelText, w.user]
              ]),
              _withDirectives(_createElementVNode("input", {
                "onUpdate:modelValue": $event => ((w.password) = $event),
                type: "password",
                placeholder: _ctx.t('Password'),
                autocomplete: "off",
                onKeyup: _withKeys($event => (_ctx.signInTerm(w)), ["enter"])
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1224), [
                [_vModelText, w.password]
              ]),
              _createElementVNode("button", {
                class: "btn sm primary",
                disabled: w.busy,
                onClick: $event => (_ctx.signInTerm(w))
              }, _toDisplayString(w.busy ? _ctx.t('Connecting…') : _ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_1225),
              _createElementVNode("span", _hoisted_1226, _toDisplayString(_ctx.t('Leave both empty if the device does not ask.')), 1 /* TEXT */)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" SSH gets a screen, not a transcript: one connection stays open and\n           the far end draws on it, so vi, top and a password prompt all work\n           exactly as they do at the machine itself. "),
        (w.kind === 'ssh' || w.kind === 'shell')
          ? (_openBlock(), _createElementBlock("div", {
              key: 3,
              class: "term-screen",
              ref_for: true,
              ref: 'screen' + w.id
            }, null, 512 /* NEED_PATCH */))
          : (_openBlock(), _createElementBlock("div", {
              key: 4,
              class: "term-body",
              ref_for: true,
              ref: 'term' + w.id
            }, [
              _createElementVNode("p", _hoisted_1227, _toDisplayString(_ctx.t('Each line is its own connection: it signs in, sends the line, reads the answer and hangs up. Telnet carries everything in the clear, this window included.')), 1 /* TEXT */),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(w.lines, (l, i) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: i,
                  class: _normalizeClass('term-line ' + l.kind)
                }, [
                  (l.kind==='cmd')
                    ? (_openBlock(), _createElementBlock("span", _hoisted_1228, _toDisplayString(l.prompt), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  _createTextVNode(_toDisplayString(l.text), 1 /* TEXT */)
                ], 2 /* CLASS */))
              }), 128 /* KEYED_FRAGMENT */)),
              (w.busy)
                ? (_openBlock(), _createElementBlock("div", _hoisted_1229, "…"))
                : _createCommentVNode("v-if", true)
            ], 512 /* NEED_PATCH */)),
        (w.kind === 'telnet' && w.signedIn)
          ? (_openBlock(), _createElementBlock("div", _hoisted_1230, [
              _createElementVNode("span", _hoisted_1231, _toDisplayString(_ctx.termPrompt(w)), 1 /* TEXT */),
              _withDirectives(_createElementVNode("input", {
                "onUpdate:modelValue": $event => ((w.command) = $event),
                class: "mono",
                autocomplete: "off",
                spellcheck: "false",
                disabled: w.busy,
                onKeydown: [
                  _withKeys(_withModifiers($event => (_ctx.sendTerm(w)), ["prevent"]), ["enter"]),
                  _withKeys(_withModifiers($event => (_ctx.termHistory(w, -1)), ["prevent"]), ["up"]),
                  _withKeys(_withModifiers($event => (_ctx.termHistory(w, 1)), ["prevent"]), ["down"])
                ]
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1232), [
                [_vModelText, w.command]
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createElementVNode("div", {
          class: "devwin-grip",
          onMousedown: _withModifiers($event => (_ctx.startResize(w, $event)), ["prevent","stop"])
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1233)
      ], 46 /* CLASS, STYLE, PROPS, NEED_HYDRATION */, _hoisted_1169))
    }), 128 /* KEYED_FRAGMENT */)),
    _createCommentVNode(" ============ Nextcloud file picker ============ "),
    (_ctx.picker.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 13,
          class: "drawer-backdrop centred",
          onClick: _cache[385] || (_cache[385] = _withModifiers($event => (_ctx.picker.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_1234, [
            _createElementVNode("div", _hoisted_1235, [
              _hoisted_1236,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t(_ctx.picker.title)), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1237, _toDisplayString(_ctx.t('Your Nextcloud files')), 1 /* TEXT */)
              ]),
              _hoisted_1238,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[381] || (_cache[381] = $event => (_ctx.picker.open=false))
              }, _hoisted_1241, 8 /* PROPS */, _hoisted_1239)
            ]),
            _createElementVNode("div", _hoisted_1242, [
              _createElementVNode("div", _hoisted_1243, [
                _createElementVNode("button", {
                  class: "btn xs",
                  disabled: _ctx.picker.path==='',
                  onClick: _cache[382] || (_cache[382] = $event => (_ctx.pickerOpen(_ctx.picker.parent || '')))
                }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_1244),
                _createElementVNode("span", _hoisted_1245, "/" + _toDisplayString(_ctx.picker.path), 1 /* TEXT */)
              ]),
              _createElementVNode("table", _hoisted_1246, [
                _createElementVNode("tbody", null, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.picker.entries, (e) => {
                    return (_openBlock(), _createElementBlock("tr", {
                      key: e.path,
                      class: _normalizeClass({dir: e.directory})
                    }, [
                      _createElementVNode("td", null, [
                        (e.directory)
                          ? (_openBlock(), _createElementBlock("a", {
                              key: 0,
                              href: "#",
                              onClick: _withModifiers($event => (_ctx.pickerOpen(e.path)), ["prevent"])
                            }, "📁 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_1247))
                          : (_openBlock(), _createElementBlock("a", {
                              key: 1,
                              href: "#",
                              onClick: _withModifiers($event => (_ctx.pickerChoose(e.path)), ["prevent"])
                            }, "📄 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_1248))
                      ]),
                      _createElementVNode("td", _hoisted_1249, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                      _createElementVNode("td", _hoisted_1250, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */)
                    ], 2 /* CLASS */))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (!_ctx.picker.entries.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1251, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_1252, [
              _createElementVNode("span", _hoisted_1253, _toDisplayString(_ctx.picker.foldersOnly ? _ctx.t('Choose the folder you are in, or open another.') : _ctx.t('Click a file to choose it.')), 1 /* TEXT */),
              _hoisted_1254,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[383] || (_cache[383] = $event => (_ctx.picker.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              (_ctx.picker.foldersOnly)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn primary",
                    onClick: _cache[384] || (_cache[384] = $event => (_ctx.pickerChoose(_ctx.picker.path)))
                  }, _toDisplayString(_ctx.t('Use this folder')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ page preview ============ "),
    (_ctx.preview.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 14,
          class: "drawer-backdrop centred",
          onClick: _cache[393] || (_cache[393] = _withModifiers((...args) => (_ctx.closePreview && _ctx.closePreview(...args)), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_1255, [
            _createElementVNode("div", _hoisted_1256, [
              _hoisted_1257,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Page preview')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1258, _toDisplayString(_ctx.preview.url), 1 /* TEXT */)
              ]),
              _hoisted_1259,
              _createElementVNode("a", {
                class: "btn sm ib",
                href: _ctx.preview.url,
                target: "_blank",
                rel: "noopener noreferrer",
                title: _ctx.t('Only works from inside that network'),
                "aria-label": _ctx.t('Only works from inside that network')
              }, _hoisted_1262, 8 /* PROPS */, _hoisted_1260),
              _createElementVNode("button", {
                class: "btn sm",
                disabled: _ctx.preview.loading,
                onClick: _cache[386] || (_cache[386] = (...args) => (_ctx.reloadPreview && _ctx.reloadPreview(...args)))
              }, _toDisplayString(_ctx.t('Reload')), 9 /* TEXT, PROPS */, _hoisted_1263),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[387] || (_cache[387] = (...args) => (_ctx.closePreview && _ctx.closePreview(...args)))
              }, _hoisted_1266, 8 /* PROPS */, _hoisted_1264)
            ]),
            _createElementVNode("div", _hoisted_1267, [
              (_ctx.preview.loading)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1268, _toDisplayString(_ctx.t('Rendering the page on the server…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.preview.error)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1269, "⚠ " + _toDisplayString(_ctx.preview.error), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _withDirectives(_createElementVNode("img", {
                src: _ctx.preview.src,
                class: "preview-shot",
                onLoad: _cache[388] || (_cache[388] = $event => (_ctx.preview.loading=false)),
                onError: _cache[389] || (_cache[389] = (...args) => (_ctx.previewFailed && _ctx.previewFailed(...args))),
                alt: _ctx.t('Page preview')
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1270), [
                [_vShow, !_ctx.preview.loading && !_ctx.preview.error]
              ])
            ]),
            _createElementVNode("div", _hoisted_1271, [
              _createElementVNode("label", _hoisted_1272, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": _cache[390] || (_cache[390] = $event => ((_ctx.preview.full) = $event)),
                  onChange: _cache[391] || (_cache[391] = (...args) => (_ctx.reloadPreview && _ctx.reloadPreview(...args)))
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelCheckbox, _ctx.preview.full]
                ]),
                _createTextVNode(" " + _toDisplayString(_ctx.t('Whole page, not just the first screen')), 1 /* TEXT */)
              ]),
              _hoisted_1273,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[392] || (_cache[392] = (...args) => (_ctx.closePreview && _ctx.closePreview(...args)))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ saved connection editor ============ "),
    (_ctx.keyAsk)
      ? (_openBlock(), _createElementBlock("div", _hoisted_1274, [
          _createElementVNode("div", _hoisted_1275, [
            _createElementVNode("div", _hoisted_1276, [
              _hoisted_1277,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('RegiBase master key')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1278, _toDisplayString(_ctx.t('Held for this browser session only.')), 1 /* TEXT */)
              ])
            ]),
            _createElementVNode("div", _hoisted_1279, [
              _createElementVNode("p", _hoisted_1280, _toDisplayString(_ctx.t('Enter the RegiBase master key to use this connection. It is never stored: close the browser and it is gone.')), 1 /* TEXT */),
              _withDirectives(_createElementVNode("input", {
                "onUpdate:modelValue": _cache[394] || (_cache[394] = $event => ((_ctx.keyAskValue) = $event)),
                type: "password",
                class: "grow mono",
                autocomplete: "off",
                placeholder: _ctx.t('RegiBase master key'),
                onKeyup: _cache[395] || (_cache[395] = _withKeys($event => (_ctx.unlockFromAsk()), ["enter"]))
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1281), [
                [_vModelText, _ctx.keyAskValue]
              ])
            ]),
            _createElementVNode("div", _hoisted_1282, [
              _hoisted_1283,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[396] || (_cache[396] = $event => {_ctx.keyAsk=false; _ctx.keyAskValue=''})
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: !_ctx.keyAskValue || _ctx.busy.connsetup,
                onClick: _cache[397] || (_cache[397] = $event => (_ctx.unlockFromAsk()))
              }, _toDisplayString(_ctx.t('Unlock')), 9 /* TEXT, PROPS */, _hoisted_1284)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.connSetupModal)
      ? (_openBlock(), _createElementBlock("div", {
          key: 16,
          class: "drawer-backdrop centred over-dialog",
          onClick: _cache[404] || (_cache[404] = _withModifiers($event => (_ctx.connSetupModal=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_1285, [
            _createElementVNode("div", _hoisted_1286, [
              _hoisted_1287,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Connection list for SSH, Telnet, FTP, SFTP and SCP')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1288, _toDisplayString(_ctx.t('Kept in RegiBase, in a collection of your own.')), 1 /* TEXT */)
              ]),
              _hoisted_1289,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[398] || (_cache[398] = $event => (_ctx.connSetupModal=false))
              }, _hoisted_1292, 8 /* PROPS */, _hoisted_1290)
            ]),
            _createElementVNode("div", _hoisted_1293, [
              (_ctx.connSetup && !_ctx.connSetup.ready)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1294, _toDisplayString(_ctx.t('Connections used to be kept by NetBase itself. They are kept in RegiBase now, and any that were saved before this version are gone — please enter them again. A password there is sealed with your own master key, which this server never holds.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (!_ctx.connSetup)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1295, _toDisplayString(_ctx.t('Reading…')), 1 /* TEXT */))
                : (!_ctx.connSetup.available)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_1296, _toDisplayString(_ctx.t('RegiBase is not installed on this server, so there is nowhere to keep a connection. You can still reach a server by typing its details each time.')), 1 /* TEXT */))
                  : (!_ctx.connSetup.encrypted)
                    ? (_openBlock(), _createElementBlock("p", _hoisted_1297, _toDisplayString(_ctx.t('Set a master key in RegiBase first. Without one, a password would be stored as plain text.')), 1 /* TEXT */))
                    : (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                        _createElementVNode("h3", null, _toDisplayString(_ctx.t('RegiBase master key')), 1 /* TEXT */),
                        _createElementVNode("p", _hoisted_1298, _toDisplayString(_ctx.t('Held for this browser session only and never stored — not in these settings, not anywhere on this server.')), 1 /* TEXT */),
                        (!_ctx.connSetup.unlocked)
                          ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                              _createElementVNode("p", _hoisted_1299, _toDisplayString(_ctx.t('Enter the master key to change these settings')), 1 /* TEXT */),
                              _createElementVNode("div", _hoisted_1300, [
                                _withDirectives(_createElementVNode("input", {
                                  "onUpdate:modelValue": _cache[399] || (_cache[399] = $event => ((_ctx.connMaster) = $event)),
                                  type: "password",
                                  class: "grow mono",
                                  autocomplete: "new-password",
                                  placeholder: _ctx.t('RegiBase master key'),
                                  onKeyup: _cache[400] || (_cache[400] = _withKeys($event => (_ctx.unlockConns()), ["enter"]))
                                }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1301), [
                                  [_vModelText, _ctx.connMaster]
                                ]),
                                _createElementVNode("button", {
                                  class: "btn sm",
                                  disabled: !_ctx.connMaster || _ctx.busy.connsetup,
                                  onClick: _cache[401] || (_cache[401] = $event => (_ctx.unlockConns()))
                                }, _toDisplayString(_ctx.t('Unlock')), 9 /* TEXT, PROPS */, _hoisted_1302)
                              ])
                            ], 64 /* STABLE_FRAGMENT */))
                          : (_openBlock(), _createElementBlock("button", {
                              key: 1,
                              class: "btn sm",
                              onClick: _cache[402] || (_cache[402] = $event => (_ctx.lockConns()))
                            }, _toDisplayString(_ctx.t('Forget it now')), 1 /* TEXT */)),
                        _createElementVNode("p", _hoisted_1303, _toDisplayString(_ctx.t('Each kind is kept in its own collection. Choosing the same collection for several kinds is perfectly fine — SSH and SCP are usually the same list.')), 1 /* TEXT */),
                        (!_ctx.connSetup.unlocked)
                          ? (_openBlock(), _createElementBlock("p", _hoisted_1304, _toDisplayString(_ctx.t('Changing where connections are kept needs the master key. You will be asked for it when you save.')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _createCommentVNode(" Four kinds, four tabs, two to a row. Stacked one under another\n                 the dialog ran far past the bottom of the screen and the one\n                 being worked on was never wholly in view; behind a single\n                 selector, three of the four were invisible and there was no\n                 telling what was set up. The tabs say both at once: which one\n                 is open, and which of the others still need doing. "),
                        _createElementVNode("div", _hoisted_1305, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.connSetup.groups || {}), (g, key) => {
                            return (_openBlock(), _createElementBlock("button", {
                              key: key,
                              class: _normalizeClass(["set-tab", {active: _ctx.connGroup === key}]),
                              role: "tab",
                              "aria-selected": _ctx.connGroup === key,
                              title: _ctx.t(g.label),
                              onClick: $event => (_ctx.connGroup = key)
                            }, [
                              _createTextVNode(_toDisplayString(_ctx.t(g.label)), 1 /* TEXT */),
                              (!g.ready)
                                ? (_openBlock(), _createElementBlock("span", {
                                    key: 0,
                                    class: _normalizeClass(["dot-todo", {gone: g.gone}]),
                                    title: g.gone ? _ctx.t('its collection is gone') : _ctx.t('not set up yet')
                                  }, null, 10 /* CLASS, PROPS */, _hoisted_1307))
                                : _createCommentVNode("v-if", true)
                            ], 10 /* CLASS, PROPS */, _hoisted_1306))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.connSetup.groups || {}), (g, key) => {
                          return _withDirectives((_openBlock(), _createElementBlock("section", {
                            class: "set-group",
                            key: key
                          }, [
                            _createElementVNode("h3", null, [
                              _createTextVNode(_toDisplayString(_ctx.t(g.label)) + " ", 1 /* TEXT */),
                              (!g.ready)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_1308, "— " + _toDisplayString(g.gone ? _ctx.t('its collection is gone') : _ctx.t('not set up yet')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]),
                            (g.gone)
                              ? (_openBlock(), _createElementBlock("p", _hoisted_1309, _toDisplayString(_ctx.t('The RegiBase collection this was kept in has been deleted. Choose another one below, or make a new one — the connections that were in it are gone with it.')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("label", _hoisted_1310, [
                              _createElementVNode("span", _hoisted_1311, _toDisplayString(_ctx.t('RegiBase collection')), 1 /* TEXT */),
                              _createElementVNode("select", {
                                value: g.collection || 0,
                                onChange: $event => (_ctx.setConnCollection(key, $event.target.value))
                              }, [
                                _createElementVNode("option", _hoisted_1313, _toDisplayString(_ctx.t('Not chosen yet')), 1 /* TEXT */),
                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.connSetup.collections || []), (c) => {
                                  return (_openBlock(), _createElementBlock("option", {
                                    key: c.id,
                                    value: c.id
                                  }, _toDisplayString(c.name) + " — " + _toDisplayString(c.records), 9 /* TEXT, PROPS */, _hoisted_1314))
                                }), 128 /* KEYED_FRAGMENT */))
                              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1312)
                            ]),
                            _createElementVNode("div", _hoisted_1315, [
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": $event => ((_ctx.connNewName[key]) = $event),
                                class: "grow",
                                placeholder: _ctx.t('Name for a new collection')
                              }, null, 8 /* PROPS */, _hoisted_1316), [
                                [_vModelText, _ctx.connNewName[key]]
                              ]),
                              _createElementVNode("button", {
                                class: "btn sm",
                                onClick: $event => (_ctx.makeConnCollection(key))
                              }, _toDisplayString(_ctx.t('Create new')), 9 /* TEXT, PROPS */, _hoisted_1317)
                            ]),
                            (g.collection)
                              ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                                  _createElementVNode("h4", null, _toDisplayString(_ctx.t('Field assignment')), 1 /* TEXT */),
                                  _createElementVNode("p", _hoisted_1318, _toDisplayString(_ctx.t('Tell NetBase which field to use for each part of a connection. Only the host is required; anything left unset is not stored.')), 1 /* TEXT */),
                                  _createElementVNode("div", _hoisted_1319, [
                                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connSetup.slots, (meta, slot) => {
                                      return (_openBlock(), _createElementBlock("label", {
                                        class: "fl",
                                        key: slot
                                      }, [
                                        _createElementVNode("span", _hoisted_1320, [
                                          _createTextVNode(_toDisplayString(_ctx.t(meta.label)), 1 /* TEXT */),
                                          (meta.secret)
                                            ? (_openBlock(), _createElementBlock("span", _hoisted_1321, " 🔒"))
                                            : _createCommentVNode("v-if", true)
                                        ]),
                                        _createElementVNode("select", {
                                          value: _ctx.connMapValue(key, slot),
                                          onChange: $event => (_ctx.setConnMap(key, slot, $event.target.value))
                                        }, [
                                          _createElementVNode("option", _hoisted_1323, _toDisplayString(_ctx.t('Not stored')), 1 /* TEXT */),
                                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connFieldsFor(key, meta.secret), (f) => {
                                            return (_openBlock(), _createElementBlock("option", {
                                              key: f.key,
                                              value: f.key
                                            }, _toDisplayString(f.label || f.key), 9 /* TEXT, PROPS */, _hoisted_1324))
                                          }), 128 /* KEYED_FRAGMENT */))
                                        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1322)
                                      ]))
                                    }), 128 /* KEYED_FRAGMENT */))
                                  ]),
                                  _createElementVNode("div", _hoisted_1325, [
                                    _hoisted_1326,
                                    _createElementVNode("button", {
                                      class: "btn primary",
                                      disabled: _ctx.busy.connsetup,
                                      onClick: $event => (_ctx.saveConnMapping(key))
                                    }, _toDisplayString(_ctx.t('Save')), 9 /* TEXT, PROPS */, _hoisted_1327)
                                  ])
                                ], 64 /* STABLE_FRAGMENT */))
                              : _createCommentVNode("v-if", true)
                          ])), [
                            [_vShow, _ctx.connGroup === key]
                          ])
                        }), 128 /* KEYED_FRAGMENT */)),
                        _createElementVNode("p", _hoisted_1328, _toDisplayString(_ctx.t('The marked ones can only be matched to a field RegiBase treats as secret, so a password is never written in the clear.')), 1 /* TEXT */)
                      ], 64 /* STABLE_FRAGMENT */))
            ]),
            _createElementVNode("div", _hoisted_1329, [
              _hoisted_1330,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[403] || (_cache[403] = $event => (_ctx.connSetupModal=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.connModal)
      ? (_openBlock(), _createElementBlock("div", _hoisted_1331, [
          _createElementVNode("div", _hoisted_1332, [
            _createElementVNode("div", _hoisted_1333, [
              _hoisted_1334,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.connForm.id ? _ctx.t('Edit connection') : _ctx.t('New connection')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_1335, _toDisplayString(_ctx.t('Saved for your account only. The password is encrypted on the server and never sent back to the browser.')), 1 /* TEXT */)
              ]),
              _hoisted_1336,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[405] || (_cache[405] = $event => (_ctx.connModal=false))
              }, _hoisted_1339, 8 /* PROPS */, _hoisted_1337)
            ]),
            _createElementVNode("div", _hoisted_1340, [
              (_ctx.connSetup && !_ctx.connSetup.ready)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1341, [
                    _createTextVNode(_toDisplayString(_ctx.t('There is nowhere to keep this yet.')) + " ", 1 /* TEXT */),
                    _createElementVNode("button", {
                      class: "btn xs",
                      onClick: _cache[406] || (_cache[406] = $event => (_ctx.openConnSetup()))
                    }, _toDisplayString(_ctx.t('Choose where')), 1 /* TEXT */)
                  ]))
                : (_ctx.connSetup && !_ctx.connSetup.unlocked)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_1342, [
                      _createTextVNode(_toDisplayString(_ctx.t('The RegiBase master key is needed before a password can be saved.')) + " ", 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs",
                        onClick: _cache[407] || (_cache[407] = $event => (_ctx.keyAsk = true))
                      }, _toDisplayString(_ctx.t('Enter it')), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
              _createElementVNode("label", _hoisted_1343, [
                _createElementVNode("span", _hoisted_1344, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("select", {
                  "onUpdate:modelValue": _cache[408] || (_cache[408] = $event => ((_ctx.connForm.kind) = $event)),
                  onChange: _cache[409] || (_cache[409] = (...args) => (_ctx.connKindChanged && _ctx.connKindChanged(...args)))
                }, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.offeredKinds, (k, id) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: id,
                      value: id
                    }, _toDisplayString(_ctx.t(k.label)), 9 /* TEXT, PROPS */, _hoisted_1345))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelSelect, _ctx.connForm.kind]
                ])
              ]),
              _createElementVNode("label", _hoisted_1346, [
                _createElementVNode("span", _hoisted_1347, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  "onUpdate:modelValue": _cache[410] || (_cache[410] = $event => ((_ctx.connForm.name) = $event)),
                  placeholder: _ctx.t('Office file server')
                }, null, 8 /* PROPS */, _hoisted_1348), [
                  [_vModelText, _ctx.connForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_1349, [
                _createElementVNode("label", _hoisted_1350, [
                  _createElementVNode("span", _hoisted_1351, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[411] || (_cache[411] = $event => ((_ctx.connForm.host) = $event)),
                    placeholder: "server.example.com"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.connForm.host]
                  ])
                ]),
                _createElementVNode("label", _hoisted_1352, [
                  _createElementVNode("span", _hoisted_1353, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[412] || (_cache[412] = $event => ((_ctx.connForm.port) = $event)),
                    type: "number",
                    min: "1",
                    max: "65535"
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.connForm.port,
                      void 0,
                      { number: true }
                    ]
                  ])
                ])
              ]),
              _createCommentVNode(" A mail account has two of these, one for each direction. Naming\n               them both \"Encryption\" left the reader to guess which was which. "),
              (_ctx.connModes.length > 1)
                ? (_openBlock(), _createElementBlock("label", _hoisted_1354, [
                    _createElementVNode("span", _hoisted_1355, _toDisplayString(_ctx.connForm.kind==='imap' || _ctx.connForm.kind==='pop3' ? _ctx.t('Incoming encryption') : _ctx.t('Encryption')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[413] || (_cache[413] = $event => ((_ctx.connForm.mode) = $event))
                    }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connModes, (m) => {
                        return (_openBlock(), _createElementBlock("option", {
                          key: m,
                          value: m
                        }, _toDisplayString(_ctx.t(_ctx.modeLabel(m))), 9 /* TEXT, PROPS */, _hoisted_1356))
                      }), 128 /* KEYED_FRAGMENT */))
                    ], 512 /* NEED_PATCH */), [
                      [_vModelSelect, _ctx.connForm.mode]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='sftp' || _ctx.connForm.kind==='ssh')
                ? (_openBlock(), _createElementBlock("label", _hoisted_1357, [
                    _createElementVNode("span", _hoisted_1358, _toDisplayString(_ctx.t('Sign in with')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[414] || (_cache[414] = $event => ((_ctx.connForm.authType) = $event))
                    }, [
                      _createElementVNode("option", _hoisted_1359, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                      _createElementVNode("option", _hoisted_1360, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                    ], 512 /* NEED_PATCH */), [
                      [_vModelSelect, _ctx.connForm.authType]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_1361, [
                _createElementVNode("label", _hoisted_1362, [
                  _createElementVNode("span", _hoisted_1363, _toDisplayString(_ctx.t('User name')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[415] || (_cache[415] = $event => ((_ctx.connForm.username) = $event)),
                    autocomplete: "off"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.connForm.username]
                  ])
                ]),
                (_ctx.connForm.authType !== 'key')
                  ? (_openBlock(), _createElementBlock("label", _hoisted_1364, [
                      _createElementVNode("span", _hoisted_1365, _toDisplayString(_ctx.connForm.id && _ctx.connForm.hasSecret ? _ctx.t('Password (leave blank to keep)') : _ctx.t('Password')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[416] || (_cache[416] = $event => ((_ctx.connForm.secret) = $event)),
                        type: "password",
                        autocomplete: "new-password"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.secret]
                      ])
                    ]))
                  : (_openBlock(), _createElementBlock("label", _hoisted_1366, [
                      _createElementVNode("span", _hoisted_1367, _toDisplayString(_ctx.t('Key passphrase (if any)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[417] || (_cache[417] = $event => ((_ctx.connForm.passphrase) = $event)),
                        type: "password",
                        autocomplete: "new-password"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.passphrase]
                      ])
                    ]))
              ]),
              (_ctx.connForm.authType === 'key')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                    _createElementVNode("label", _hoisted_1368, [
                      _createElementVNode("span", _hoisted_1369, _toDisplayString(_ctx.t('Key file in your Nextcloud files')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_1370, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[418] || (_cache[418] = $event => ((_ctx.connForm.privateKeyPath) = $event)),
                          class: "mono",
                          placeholder: "Keys/id_ed25519"
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelText, _ctx.connForm.privateKeyPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          onClick: _cache[419] || (_cache[419] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.connForm.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                        }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */)
                      ])
                    ]),
                    _createElementVNode("p", _hoisted_1371, _toDisplayString(_ctx.t('Give the path of the private key inside your own Nextcloud files — the one without .pub. The server reads it when you save; the key itself never passes through the browser. Or paste it below instead.')), 1 /* TEXT */),
                    _createElementVNode("label", _hoisted_1372, [
                      _createElementVNode("span", _hoisted_1373, _toDisplayString(_ctx.connForm.id && _ctx.connForm.hasSecret ? _ctx.t('Private key (leave blank to keep)') : _ctx.t('Private key (paste)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[420] || (_cache[420] = $event => ((_ctx.connForm.privateKey) = $event)),
                        rows: "4",
                        class: "mono tiny",
                        placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.privateKey]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              _createCommentVNode(" The sending half of a mail account. One address is one record, so\n               the fields above are where it is read and these are where it is\n               sent from; the user name and password above serve both. "),
              (_ctx.connForm.kind==='imap' || _ctx.connForm.kind==='pop3')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 5 }, [
                    _createElementVNode("p", _hoisted_1374, _toDisplayString(_ctx.t('The fields above are where this address is read. Below is where it sends from — the same user name and password.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_1375, [
                      _createElementVNode("label", _hoisted_1376, [
                        _createElementVNode("span", _hoisted_1377, _toDisplayString(_ctx.t('Outgoing server (blank if the same)')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[421] || (_cache[421] = $event => ((_ctx.connForm.sendHost) = $event)),
                          placeholder: "smtp.example.com"
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelText, _ctx.connForm.sendHost]
                        ])
                      ]),
                      _createElementVNode("label", _hoisted_1378, [
                        _createElementVNode("span", _hoisted_1379, _toDisplayString(_ctx.t('Outgoing port')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[422] || (_cache[422] = $event => ((_ctx.connForm.sendPort) = $event)),
                          type: "number",
                          min: "1",
                          max: "65535"
                        }, null, 512 /* NEED_PATCH */), [
                          [
                            _vModelText,
                            _ctx.connForm.sendPort,
                            void 0,
                            { number: true }
                          ]
                        ])
                      ])
                    ]),
                    _createElementVNode("label", _hoisted_1380, [
                      _createElementVNode("span", _hoisted_1381, _toDisplayString(_ctx.t('Outgoing encryption')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[423] || (_cache[423] = $event => ((_ctx.connForm.sendMode) = $event))
                      }, [
                        _hoisted_1382,
                        _hoisted_1383,
                        _createElementVNode("option", _hoisted_1384, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.connForm.sendMode]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='smtp' || _ctx.connForm.kind==='imap' || _ctx.connForm.kind==='pop3')
                ? (_openBlock(), _createElementBlock("label", _hoisted_1385, [
                    _createElementVNode("span", _hoisted_1386, _toDisplayString(_ctx.t('Sender address')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[424] || (_cache[424] = $event => ((_ctx.connForm.from) = $event)),
                      placeholder: "notify@example.com"
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelText, _ctx.connForm.from]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='ftp' || _ctx.connForm.kind==='sftp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_1387, [
                    _createElementVNode("span", _hoisted_1388, _toDisplayString(_ctx.t('Start folder')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[425] || (_cache[425] = $event => ((_ctx.connForm.path) = $event)),
                      class: "mono",
                      placeholder: "/"
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelText, _ctx.connForm.path]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='ftp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_1389, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[426] || (_cache[426] = $event => ((_ctx.connForm.passive) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.connForm.passive]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Passive mode (usually right)')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("label", _hoisted_1390, [
                _createElementVNode("span", _hoisted_1391, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  "onUpdate:modelValue": _cache[427] || (_cache[427] = $event => ((_ctx.connForm.notes) = $event)),
                  rows: "2"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.connForm.notes]
                ])
              ]),
              (_ctx.connNote)
                ? (_openBlock(), _createElementBlock("p", _hoisted_1392, _toDisplayString(_ctx.connNote), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_1393, [
              (_ctx.connForm.id)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger sm",
                    onClick: _cache[428] || (_cache[428] = $event => (_ctx.deleteConn(_ctx.connForm)))
                  }, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_1394,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[429] || (_cache[429] = $event => (_ctx.connModal=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: _normalizeClass(["btn primary", {working: _ctx.busy.conn}]),
                disabled: _ctx.busy.conn,
                onClick: _cache[430] || (_cache[430] = (...args) => (_ctx.saveConn && _ctx.saveConn(...args)))
              }, _toDisplayString(_ctx.t('Save')), 11 /* TEXT, CLASS, PROPS */, _hoisted_1395)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ device drawer ============ "),
    (_ctx.selected)
      ? (_openBlock(), _createElementBlock("div", {
          key: 18,
          class: "drawer-backdrop",
          onClick: _cache[464] || (_cache[464] = _withModifiers($event => (_ctx.selected=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_1396, [
            _createElementVNode("div", _hoisted_1397, [
              _createElementVNode("span", _hoisted_1398, _toDisplayString(_ctx.icon(_ctx.selected)), 1 /* TEXT */),
              _createElementVNode("div", null, [
                _createElementVNode("div", {
                  class: _normalizeClass(["dev-title", {unnamed: !(_ctx.selected.label || _ctx.selected.hostname)}])
                }, _toDisplayString(_ctx.selected.label || _ctx.selected.hostname || _ctx.selected.ip), 3 /* TEXT, CLASS */)
              ]),
              _hoisted_1399,
              _createCommentVNode(" The whole record, and below, each row on its own: a device is\n               quoted into a ticket or a stock list far more often than it is\n               read on the screen. "),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Copy everything about this device'),
                "aria-label": _ctx.t('Copy all'),
                onClick: _cache[431] || (_cache[431] = $event => (_ctx.copyDevice(_ctx.selected)))
              }, _hoisted_1402, 8 /* PROPS */, _hoisted_1400),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[432] || (_cache[432] = $event => (_ctx.selected=null))
              }, _hoisted_1405, 8 /* PROPS */, _hoisted_1403)
            ]),
            _createElementVNode("div", _hoisted_1406, [
              _createElementVNode("div", _hoisted_1407, [
                _createCommentVNode(" Name first, and as a bordered field so it is clearly the one\n                 thing here you fill in yourself; then the address, MAC and\n                 vendor, top to bottom. "),
                _createElementVNode("div", _hoisted_1408, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                  (_ctx.allowed('scan'))
                    ? _withDirectives((_openBlock(), _createElementBlock("input", {
                        key: 0,
                        class: "kv-input",
                        "onUpdate:modelValue": _cache[433] || (_cache[433] = $event => ((_ctx.editLabel) = $event)),
                        placeholder: _ctx.selected.hostname || _ctx.selected.ip,
                        title: _ctx.t('A name you give this device. It is kept against the device (its MAC) and shown in place of the obtained name, so you can tell a device apart even when it reports no name of its own.')
                      }, null, 8 /* PROPS */, _hoisted_1409)), [
                        [_vModelText, _ctx.editLabel]
                      ])
                    : (_openBlock(), _createElementBlock("code", _hoisted_1410, _toDisplayString(_ctx.selected.label || '—'), 1 /* TEXT */))
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('IPv4')) + " / " + _toDisplayString(_ctx.t('Netmask')), 1 /* TEXT */),
                  _createElementVNode("code", null, [
                    _createTextVNode(_toDisplayString(_ctx.selected.ip), 1 /* TEXT */),
                    (_ctx.netmaskFor(_ctx.selected))
                      ? (_openBlock(), _createElementBlock("span", _hoisted_1411, " / " + _toDisplayString(_ctx.netmaskFor(_ctx.selected)), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[434] || (_cache[434] = $event => (_ctx.copyField(_ctx.t('IPv4'), _ctx.selected.ip)))
                  }, _hoisted_1414, 8 /* PROPS */, _hoisted_1412)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('MAC address')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.selected.mac || _ctx.t('no MAC')), 1 /* TEXT */),
                  (_ctx.selected.mac)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[435] || (_cache[435] = $event => (_ctx.copyField(_ctx.t('MAC address'), _ctx.selected.mac)))
                      }, _hoisted_1417, 8 /* PROPS */, _hoisted_1415))
                    : _createCommentVNode("v-if", true)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.vendorText(_ctx.selected)), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[436] || (_cache[436] = $event => (_ctx.copyField(_ctx.t('Vendor'), _ctx.vendorText(_ctx.selected))))
                  }, _hoisted_1420, 8 /* PROPS */, _hoisted_1418)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Reported name')), 1 /* TEXT */),
                  _createElementVNode("code", null, [
                    _createTextVNode(_toDisplayString(_ctx.selected.hostname || '—'), 1 /* TEXT */),
                    (_ctx.selected.hostname && _ctx.nameSource(_ctx.selected))
                      ? (_openBlock(), _createElementBlock("span", _hoisted_1421, " · " + _toDisplayString(_ctx.nameSource(_ctx.selected)), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[437] || (_cache[437] = $event => (_ctx.copyField(_ctx.t('Reported name'), _ctx.selected.hostname)))
                  }, _hoisted_1424, 8 /* PROPS */, _hoisted_1422)
                ]),
                (_ctx.selected.workgroup)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_1425, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Workgroup')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.workgroup), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[438] || (_cache[438] = $event => (_ctx.copyField(_ctx.t('Workgroup'), _ctx.selected.workgroup)))
                      }, _hoisted_1428, 8 /* PROPS */, _hoisted_1426)
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Open ports')), 1 /* TEXT */),
                  _createElementVNode("code", null, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.selected.ports, (p, i) => {
                      return (_openBlock(), _createElementBlock(_Fragment, { key: p }, [
                        (_ctx.portLink(_ctx.selected, p))
                          ? (_openBlock(), _createElementBlock("a", {
                              key: 0,
                              href: "#",
                              title: _ctx.portLink(_ctx.selected, p).title,
                              onClick: _withModifiers($event => (_ctx.openDeviceWindow(_ctx.selected, p)), ["prevent"])
                            }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_1429))
                          : (_ctx.portTool(_ctx.selected, p))
                            ? (_openBlock(), _createElementBlock("a", {
                                key: 1,
                                href: "#",
                                title: _ctx.portTool(_ctx.selected, p).title,
                                onClick: _withModifiers($event => (_ctx.openPortTool(_ctx.selected, p)), ["prevent"])
                              }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_1430))
                            : (_openBlock(), _createElementBlock("span", _hoisted_1431, _toDisplayString(p), 1 /* TEXT */)),
                        (i < _ctx.selected.ports.length - 1)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_1432, ", "))
                          : _createCommentVNode("v-if", true)
                      ], 64 /* STABLE_FRAGMENT */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    (!_ctx.selected.ports.length)
                      ? (_openBlock(), _createElementBlock("span", _hoisted_1433, "—"))
                      : _createCommentVNode("v-if", true)
                  ]),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[439] || (_cache[439] = $event => (_ctx.copyField(_ctx.t('Open ports'), _ctx.selected.ports.join(', '))))
                  }, _hoisted_1436, 8 /* PROPS */, _hoisted_1434)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Found by')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.selected.sources.join(', ')), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[440] || (_cache[440] = $event => (_ctx.copyField(_ctx.t('Found by'), _ctx.selected.sources.join(', '))))
                  }, _hoisted_1439, 8 /* PROPS */, _hoisted_1437)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('First seen')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.stamp(_ctx.selected.firstSeen)), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[441] || (_cache[441] = $event => (_ctx.copyField(_ctx.t('First seen'), _ctx.stamp(_ctx.selected.firstSeen))))
                  }, _hoisted_1442, 8 /* PROPS */, _hoisted_1440)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Last seen')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.stamp(_ctx.selected.lastSeen)), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[442] || (_cache[442] = $event => (_ctx.copyField(_ctx.t('Last seen'), _ctx.stamp(_ctx.selected.lastSeen))))
                  }, _hoisted_1445, 8 /* PROPS */, _hoisted_1443)
                ]),
                (_ctx.selected.extra && _ctx.selected.extra.mdns)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_1446, [
                      _hoisted_1447,
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.extra.mdns), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[443] || (_cache[443] = $event => (_ctx.copyField('mDNS', _ctx.selected.extra.mdns)))
                      }, _hoisted_1450, 8 /* PROPS */, _hoisted_1448)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.extra && _ctx.selected.extra.rdns)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_1451, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Reverse DNS')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.extra.rdns), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[444] || (_cache[444] = $event => (_ctx.copyField(_ctx.t('Reverse DNS'), _ctx.selected.extra.rdns)))
                      }, _hoisted_1454, 8 /* PROPS */, _hoisted_1452)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.extra && _ctx.selected.extra.ssdp)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_1455, [
                      _hoisted_1456,
                      _createElementVNode("code", _hoisted_1457, _toDisplayString(_ctx.selected.extra.ssdp), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[445] || (_cache[445] = $event => (_ctx.copyField('SSDP', _ctx.selected.extra.ssdp)))
                      }, _hoisted_1460, 8 /* PROPS */, _hoisted_1458)
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_1461, [
                      _createElementVNode("span", _hoisted_1462, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_1463, [
                        (_ctx.editType !== _ctx.customType)
                          ? _withDirectives((_openBlock(), _createElementBlock("select", {
                              key: 0,
                              "onUpdate:modelValue": _cache[446] || (_cache[446] = $event => ((_ctx.editType) = $event)),
                              "aria-label": _ctx.t('Type'),
                              onChange: _cache[447] || (_cache[447] = $event => (_ctx.focusOwnType($event)))
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.typeLabels, (l, k) => {
                                return (_openBlock(), _createElementBlock("option", {
                                  key: k,
                                  value: k
                                }, _toDisplayString(_ctx.t(l)), 9 /* TEXT, PROPS */, _hoisted_1465))
                              }), 128 /* KEYED_FRAGMENT */)),
                              _createElementVNode("option", { value: _ctx.customType }, _toDisplayString(_ctx.t('Other (enter your own)')), 9 /* TEXT, PROPS */, _hoisted_1466)
                            ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1464)), [
                              [_vModelSelect, _ctx.editType]
                            ])
                          : (_openBlock(), _createElementBlock("span", _hoisted_1467, [
                              _withDirectives(_createElementVNode("input", {
                                "onUpdate:modelValue": _cache[448] || (_cache[448] = $event => ((_ctx.editTypeText) = $event)),
                                maxlength: "32",
                                placeholder: _ctx.t('Enter a type'),
                                "aria-label": _ctx.t('Enter a type'),
                                onKeydown: _cache[449] || (_cache[449] = _withKeys(_withModifiers($event => (_ctx.editType = _ctx.typeBack(_ctx.selected.type)), ["stop"]), ["esc"]))
                              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1468), [
                                [_vModelText, _ctx.editTypeText]
                              ]),
                              _createElementVNode("button", {
                                type: "button",
                                class: "btn xs ib type-back",
                                title: _ctx.t('Choose from the list'),
                                "aria-label": _ctx.t('Choose from the list'),
                                onClick: _cache[450] || (_cache[450] = $event => (_ctx.editType = _ctx.typeBack(_ctx.selected.type)))
                              }, _hoisted_1471, 8 /* PROPS */, _hoisted_1469)
                            ]))
                      ])
                    ]),
                    _createElementVNode("label", _hoisted_1472, [
                      _createElementVNode("span", _hoisted_1473, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[451] || (_cache[451] = $event => ((_ctx.editNotes) = $event)),
                        rows: "2"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.editNotes]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : (_ctx.selected.notes)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_1474, [
                      (_ctx.selected.notes)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_1475, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                            _createElementVNode("code", _hoisted_1476, _toDisplayString(_ctx.selected.notes), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]))
                  : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_1477, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.webLinks(_ctx.selected), (l) => {
                  return (_openBlock(), _createElementBlock("div", {
                    class: "tool-line",
                    key: l.href
                  }, [
                    (_ctx.allowed('preview'))
                      ? (_openBlock(), _createElementBlock("button", {
                          key: 0,
                          class: "btn sm",
                          onClick: $event => (_ctx.openDeviceWindow(_ctx.selected, l.port))
                        }, "🖥 " + _toDisplayString(l.label), 9 /* TEXT, PROPS */, _hoisted_1478))
                      : _createCommentVNode("v-if", true),
                    (_ctx.allowed('preview') && _ctx.status.preview)
                      ? (_openBlock(), _createElementBlock("button", {
                          key: 1,
                          class: "btn sm ib",
                          title: _ctx.t('Show the page'),
                          "aria-label": _ctx.t('Show the page'),
                          onClick: $event => (_ctx.showPage(l.href))
                        }, "🖼", 8 /* PROPS */, _hoisted_1479))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("a", {
                      class: "btn sm ib",
                      href: l.href,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      title: _ctx.t('Only works from inside that network'),
                      "aria-label": _ctx.t('Only works from inside that network')
                    }, _hoisted_1482, 8 /* PROPS */, _hoisted_1480)
                  ]))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              _createCommentVNode(" A device on another network answers nothing, so the two\n               searches below would report \"nothing found\" when the truth is\n               \"never asked\". Say which it is, and say what would fix it. "),
              (_ctx.offNetwork(_ctx.selected))
                ? (_openBlock(), _createElementBlock("div", _hoisted_1483, [
                    _createElementVNode("p", null, [
                      _createElementVNode("strong", null, _toDisplayString(_ctx.t('This device is not on the same network as the Nextcloud server.')), 1 /* TEXT */),
                      _createTextVNode(" " + _toDisplayString(_ctx.t('To connect to its address or scan its ports, the Nextcloud server needs an address on the same network as this device.')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("p", null, _toDisplayString(_ctx.t('Open a console over SSH or similar and run the following command with administrator privileges.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_1484, [
                      _createElementVNode("code", _hoisted_1485, _toDisplayString(_ctx.joinCommand(_ctx.selected)), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[452] || (_cache[452] = $event => (_ctx.copyField(_ctx.t('Command'), _ctx.joinCommand(_ctx.selected))))
                      }, _hoisted_1488, 8 /* PROPS */, _hoisted_1486)
                    ]),
                    (_ctx.serverAddress && _ctx.allowed('sshexec'))
                      ? (_openBlock(), _createElementBlock("p", _hoisted_1489, [
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[453] || (_cache[453] = $event => (_ctx.askSsh(_ctx.serverAddress, 22)))
                          }, "🖳 " + _toDisplayString(_ctx.t('Open an SSH window')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("p", _hoisted_1490, _toDisplayString(_ctx.t('Note that the setting is erased when the server restarts.')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_1491, [
                _createCommentVNode(" Asking this one device what a sweep has no time to ask: every\n                 port it has, and which of those are really web pages. "),
                (_ctx.allowed('scan'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 0,
                      class: "btn sm",
                      disabled: !!_ctx.deep.busy || _ctx.offNetwork(_ctx.selected),
                      onClick: _cache[454] || (_cache[454] = $event => (_ctx.scanAllPorts(_ctx.selected)))
                    }, " 🔎 " + _toDisplayString(_ctx.deep.busy === 'ports' ? _ctx.t('Scanning… {done}%', { done: _ctx.deep.percent }) : _ctx.t('Scan every port')), 9 /* TEXT, PROPS */, _hoisted_1492))
                  : _createCommentVNode("v-if", true),
                (_ctx.allowed('scan'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 1,
                      class: "btn sm",
                      disabled: !!_ctx.deep.busy || !_ctx.selected.ports.length || _ctx.offNetwork(_ctx.selected),
                      onClick: _cache[455] || (_cache[455] = $event => (_ctx.findWebPages(_ctx.selected)))
                    }, " 🌐 " + _toDisplayString(_ctx.deep.busy === 'web' ? _ctx.t('Looking…') : _ctx.t('Find web pages')), 9 /* TEXT, PROPS */, _hoisted_1493))
                  : _createCommentVNode("v-if", true),
                _createCommentVNode(" A device's page is not always on a port the scan noticed, and\n                 a maker is free to put it anywhere, so the number can simply\n                 be typed. "),
                (_ctx.allowed('preview'))
                  ? (_openBlock(), _createElementBlock("span", {
                      key: 2,
                      class: "port-open",
                      title: _ctx.t('Opens a page on this device at a port of your choosing, through this server.')
                    }, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[456] || (_cache[456] = $event => ((_ctx.openPort) = $event)),
                        class: "tiny",
                        inputmode: "numeric",
                        placeholder: _ctx.t('Port'),
                        "aria-label": _ctx.t('Port'),
                        onKeyup: _cache[457] || (_cache[457] = _withKeys((...args) => (_ctx.openTypedPort && _ctx.openTypedPort(...args)), ["enter"]))
                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1495), [
                        [_vModelText, _ctx.openPort]
                      ]),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[458] || (_cache[458] = $event => ((_ctx.openScheme) = $event)),
                        "aria-label": _ctx.t('Protocol')
                      }, _hoisted_1499, 8 /* PROPS */, _hoisted_1496), [
                        [_vModelSelect, _ctx.openScheme]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        disabled: !_ctx.openPortReady,
                        onClick: _cache[459] || (_cache[459] = (...args) => (_ctx.openTypedPort && _ctx.openTypedPort(...args)))
                      }, "🖥 " + _toDisplayString(_ctx.t('Open this port')), 9 /* TEXT, PROPS */, _hoisted_1500)
                    ], 8 /* PROPS */, _hoisted_1494))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.mac && _ctx.allowed('wol'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 3,
                      class: "btn sm",
                      onClick: _cache[460] || (_cache[460] = $event => (_ctx.wake(_ctx.selected)))
                    }, "⏻ " + _toDisplayString(_ctx.t('Wake on LAN')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createCommentVNode(" What the two searches came back with, for this device. "),
              (_ctx.deep.note || _ctx.deep.pages.length)
                ? (_openBlock(), _createElementBlock("div", _hoisted_1501, [
                    (_ctx.deep.note)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_1502, _toDisplayString(_ctx.deep.note), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    (_ctx.deep.pages.length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_1503, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.deep.pages, (page) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: page.port
                            }, [
                              _createElementVNode("span", _hoisted_1504, _toDisplayString(page.scheme) + " · " + _toDisplayString(page.port), 1 /* TEXT */),
                              _createElementVNode("code", null, [
                                _createTextVNode(_toDisplayString(page.title || page.server || _ctx.t('a page')), 1 /* TEXT */),
                                (_ctx.allowed('preview'))
                                  ? (_openBlock(), _createElementBlock("button", {
                                      key: 0,
                                      class: "btn xs",
                                      onClick: $event => (_ctx.openDeviceWindow(_ctx.selected, page.port, page.scheme))
                                    }, _toDisplayString(_ctx.t('Open')), 9 /* TEXT, PROPS */, _hoisted_1505))
                                  : _createCommentVNode("v-if", true)
                              ])
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 512 /* NEED_PATCH */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_1506, [
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger sm",
                    onClick: _cache[461] || (_cache[461] = $event => (_ctx.removeDevice(_ctx.selected)))
                  }, _toDisplayString(_ctx.t('Forget this device')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_1507,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[462] || (_cache[462] = $event => (_ctx.selected=null))
              }, _toDisplayString(_ctx.allowed('scan') ? _ctx.t('Cancel') : _ctx.t('Close')), 1 /* TEXT */),
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("button", {
                    key: 1,
                    class: "btn primary",
                    onClick: _cache[463] || (_cache[463] = (...args) => (_ctx.saveDevice && _ctx.saveDevice(...args)))
                  }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true)
  ], 2 /* CLASS */))
}
})();

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
    render,
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
