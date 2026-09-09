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
    if (!res.ok) throw new Error((body && body.error) || res.statusText);
    return body;
  }
  const qs = (params) => Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => encodeURIComponent(k) + '[]=' + encodeURIComponent(x)) : [encodeURIComponent(k) + '=' + encodeURIComponent(v)]))
    .join('&');

  /* ---------- presentation helpers ---------- */
  const TYPE_ICON = {
    router: '📶', printer: '🖨️', camera: '📷', nas: '💾', pc: '💻', phone: '📱',
    iot: '💡', av: '📺', sbc: '🍓', server: '🖥️', host: '🌐', unknown: '❔',
  };
  const TYPE_LABEL = {
    router: 'Network gear', printer: 'Printer', camera: 'Camera', nas: 'NAS',
    pc: 'PC', phone: 'Phone', iot: 'IoT', av: 'AV device', sbc: 'Single-board',
    server: 'Server', host: 'Host', unknown: 'Unknown',
  };

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
              <button class="btn primary" :disabled="busy.ping" @click="runPing">{{ t('Ping') }}</button>
              <button class="btn" :disabled="busy.trace" @click="runTrace">{{ t('Traceroute') }}</button>
              <button class="btn" :disabled="busy.path" @click="runPath">{{ t('Path quality') }}</button>
            </div>
            <div class="tool-row">
              <input v-model.number="tcpPingPort" type="number" class="tiny" min="1" max="65535">
              <button class="btn" :disabled="busy.tcpping" @click="runTcpPing">{{ t('TCP ping (works without ICMP)') }}</button>
              <button class="btn" :disabled="busy.mtu" @click="runMtu">{{ t('Find the path MTU') }}</button>
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
              <button class="btn primary" :disabled="busy.ports" @click="runPorts">{{ t('Check') }}</button>
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
                <button class="btn primary" :disabled="busy.nmap" @click="runNmap">{{ busy.nmap ? t('Scanning…') : t('Run') }}</button>
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
const { openBlock: _openBlock, createElementBlock: _createElementBlock, createCommentVNode: _createCommentVNode, createElementVNode: _createElementVNode, toDisplayString: _toDisplayString, renderList: _renderList, Fragment: _Fragment, withModifiers: _withModifiers, normalizeClass: _normalizeClass, vModelText: _vModelText, withDirectives: _withDirectives, vModelRadio: _vModelRadio, createTextVNode: _createTextVNode, vModelSelect: _vModelSelect, vModelCheckbox: _vModelCheckbox, normalizeStyle: _normalizeStyle, withKeys: _withKeys, vShow: _vShow, createStaticVNode: _createStaticVNode } = Vue

const _hoisted_1 = { class: "brand" }
const _hoisted_2 = /*#__PURE__*/_createStaticVNode("<span class=\"logo\"><svg viewBox=\"333 400 1335 1030\"><path d=\"M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></path><path d=\"M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\" fill=\"#2e3192\"></path><path d=\"M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></path><path d=\"M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z\" fill=\"#2970e2\"></path></svg></span><span>NetBase</span>", 2)
const _hoisted_4 = {
  key: 0,
  class: "tag"
}
const _hoisted_5 = ["title", "onClick", "onKeydown", "onDragstart", "onDragover", "onDragleave", "onDrop"]
const _hoisted_6 = { class: "ic" }
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
const _hoisted_12 = { class: "main" }
const _hoisted_13 = { class: "topbar" }
const _hoisted_14 = ["title", "aria-label"]
const _hoisted_15 = { class: "title" }
const _hoisted_16 = { class: "ic" }
const _hoisted_17 = { class: "nm" }
const _hoisted_18 = { class: "desc" }
const _hoisted_19 = /*#__PURE__*/_createElementVNode("div", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_20 = { class: "topbar-actions" }
const _hoisted_21 = {
  key: 0,
  class: "tab-actions"
}
const _hoisted_22 = ["placeholder"]
const _hoisted_23 = ["title", "disabled"]
const _hoisted_24 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3.5v11.5\"></path><path d=\"M7.5 10.5L12 15l4.5-4.5\"></path><path d=\"M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5\"></path></svg></span><span class=\"lb\">CSV</span>", 2)
const _hoisted_26 = [
  _hoisted_24
]
const _hoisted_27 = ["title", "disabled"]
const _hoisted_28 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
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
const _hoisted_29 = { class: "lb" }
const _hoisted_30 = ["title", "disabled"]
const _hoisted_31 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3.5v11.5\"></path><path d=\"M7.5 10.5L12 15l4.5-4.5\"></path><path d=\"M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5\"></path></svg></span>", 1)
const _hoisted_32 = { class: "lb" }
const _hoisted_33 = ["title", "disabled"]
const _hoisted_34 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"></path><path d=\"M12 10.5v5\"></path><path d=\"M9.8 13.3l2.2 2.2 2.2-2.2\"></path></svg></span>", 1)
const _hoisted_35 = { class: "lb" }
const _hoisted_36 = { class: "content" }
const _hoisted_37 = ["title", "aria-label"]
const _hoisted_38 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_39 = [
  _hoisted_38
]
const _hoisted_40 = { key: 1 }
const _hoisted_41 = {
  key: 0,
  class: "card scan-card"
}
const _hoisted_42 = { class: "scan-what" }
const _hoisted_43 = { class: "fl-label" }
const _hoisted_44 = ["title"]
const _hoisted_45 = ["title"]
const _hoisted_46 = { class: "scan-row" }
const _hoisted_47 = ["title"]
const _hoisted_48 = { class: "fl-label" }
const _hoisted_49 = ["placeholder"]
const _hoisted_50 = ["title"]
const _hoisted_51 = { class: "fl-label" }
const _hoisted_52 = ["value"]
const _hoisted_53 = ["disabled"]
const _hoisted_54 = { class: "scan-opts" }
const _hoisted_55 = ["title"]
const _hoisted_56 = ["title"]
const _hoisted_57 = ["title"]
const _hoisted_58 = ["title"]
const _hoisted_59 = {
  key: 0,
  class: "scan-sub"
}
const _hoisted_60 = ["title"]
const _hoisted_61 = { class: "opt-label" }
const _hoisted_62 = { value: "common" }
const _hoisted_63 = { value: "detailed" }
const _hoisted_64 = { value: "wellKnown" }
const _hoisted_65 = { value: "high" }
const _hoisted_66 = { value: "all" }
const _hoisted_67 = ["title"]
const _hoisted_68 = { class: "opt-label" }
const _hoisted_69 = ["value"]
const _hoisted_70 = {
  key: 1,
  class: "progress"
}
const _hoisted_71 = { class: "bar" }
const _hoisted_72 = { class: "progress-text" }
const _hoisted_73 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_74 = {
  key: 2,
  class: "hint"
}
const _hoisted_75 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_76 = {
  key: 2,
  class: "grid"
}
const _hoisted_77 = /*#__PURE__*/_createElementVNode("th", { class: "c-dot" }, null, -1 /* HOISTED */)
const _hoisted_78 = { class: "c-pair" }
const _hoisted_79 = { class: "c-pair c-extra" }
const _hoisted_80 = { class: "c-pair" }
const _hoisted_81 = { class: "th-line plain" }
const _hoisted_82 = ["onClick", "onContextmenu"]
const _hoisted_83 = { class: "c-dot" }
const _hoisted_84 = ["title"]
const _hoisted_85 = { class: "c-pair c-name" }
const _hoisted_86 = { class: "pair-a" }
const _hoisted_87 = { class: "ic" }
const _hoisted_88 = {
  key: 0,
  class: "badge self"
}
const _hoisted_89 = ["title"]
const _hoisted_90 = {
  key: 2,
  class: "badge"
}
const _hoisted_91 = { class: "pair-b mono" }
const _hoisted_92 = { class: "c-pair c-extra" }
const _hoisted_93 = { class: "pair-a mono" }
const _hoisted_94 = { class: "pair-b dim" }
const _hoisted_95 = { class: "c-pair" }
const _hoisted_96 = { class: "pair-a" }
const _hoisted_97 = ["title", "onClick"]
const _hoisted_98 = ["title", "onClick"]
const _hoisted_99 = { key: 2 }
const _hoisted_100 = { key: 3 }
const _hoisted_101 = { key: 0 }
const _hoisted_102 = { class: "dim c-extra" }
const _hoisted_103 = { key: 2 }
const _hoisted_104 = { class: "card tool-card" }
const _hoisted_105 = { class: "seg" }
const _hoisted_106 = ["onClick"]
const _hoisted_107 = { class: "card tool-card" }
const _hoisted_108 = { class: "tool-row" }
const _hoisted_109 = ["placeholder"]
const _hoisted_110 = ["disabled"]
const _hoisted_111 = { class: "chips" }
const _hoisted_112 = ["value"]
const _hoisted_113 = {
  key: 0,
  class: "card"
}
const _hoisted_114 = { class: "grid compact" }
const _hoisted_115 = { class: "mono" }
const _hoisted_116 = { class: "dim mono" }
const _hoisted_117 = { class: "mono wrap" }
const _hoisted_118 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_119 = {
  key: 1,
  class: "kv"
}
const _hoisted_120 = { key: 0 }
const _hoisted_121 = /*#__PURE__*/_createElementVNode("span", null, "SPF", -1 /* HOISTED */)
const _hoisted_122 = { key: 1 }
const _hoisted_123 = /*#__PURE__*/_createElementVNode("span", null, "DMARC", -1 /* HOISTED */)
const _hoisted_124 = { class: "card tool-card" }
const _hoisted_125 = { class: "tool-row" }
const _hoisted_126 = ["placeholder"]
const _hoisted_127 = ["value"]
const _hoisted_128 = ["value"]
const _hoisted_129 = ["placeholder"]
const _hoisted_130 = ["disabled"]
const _hoisted_131 = { class: "opt" }
const _hoisted_132 = { class: "dim" }
const _hoisted_133 = {
  key: 0,
  class: "card"
}
const _hoisted_134 = { class: "kv" }
const _hoisted_135 = { key: 0 }
const _hoisted_136 = { class: "bad" }
const _hoisted_137 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_138 = { class: "mono tiny" }
const _hoisted_139 = { class: "mono" }
const _hoisted_140 = { class: "dim mono" }
const _hoisted_141 = { class: "mono wrap tiny" }
const _hoisted_142 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_143 = { key: 2 }
const _hoisted_144 = { class: "grid compact" }
const _hoisted_145 = { class: "mono tiny" }
const _hoisted_146 = { class: "mono" }
const _hoisted_147 = { class: "mono wrap tiny" }
const _hoisted_148 = { class: "card tool-card" }
const _hoisted_149 = { class: "tool-row" }
const _hoisted_150 = ["placeholder"]
const _hoisted_151 = ["value"]
const _hoisted_152 = ["disabled"]
const _hoisted_153 = { class: "dim" }
const _hoisted_154 = {
  key: 0,
  class: "card"
}
const _hoisted_155 = { class: "grid compact" }
const _hoisted_156 = { class: "dim mono tiny" }
const _hoisted_157 = { class: "mono" }
const _hoisted_158 = { class: "mono" }
const _hoisted_159 = { class: "mono wrap tiny" }
const _hoisted_160 = { class: "card tool-card" }
const _hoisted_161 = { class: "tool-row" }
const _hoisted_162 = ["placeholder"]
const _hoisted_163 = ["value"]
const _hoisted_164 = ["disabled"]
const _hoisted_165 = { class: "dim" }
const _hoisted_166 = {
  key: 0,
  class: "card"
}
const _hoisted_167 = { class: "ts-head" }
const _hoisted_168 = { class: "pill" }
const _hoisted_169 = { class: "mono" }
const _hoisted_170 = { class: "dim mono" }
const _hoisted_171 = { class: "dim" }
const _hoisted_172 = {
  key: 0,
  class: "mono tiny wrap"
}
const _hoisted_173 = {
  key: 1,
  class: "dim mono tiny wrap"
}
const _hoisted_174 = { class: "card tool-card" }
const _hoisted_175 = { class: "tool-row" }
const _hoisted_176 = ["placeholder"]
const _hoisted_177 = ["placeholder"]
const _hoisted_178 = ["disabled"]
const _hoisted_179 = { class: "dim" }
const _hoisted_180 = {
  key: 0,
  class: "card"
}
const _hoisted_181 = { class: "grid compact" }
const _hoisted_182 = { class: "mono" }
const _hoisted_183 = { class: "dim tiny" }
const _hoisted_184 = { class: "dim tiny" }
const _hoisted_185 = { class: "mono" }
const _hoisted_186 = { key: 0 }
const _hoisted_187 = { class: "raw" }
const _hoisted_188 = { key: 3 }
const _hoisted_189 = { class: "card tool-card" }
const _hoisted_190 = { class: "tool-row" }
const _hoisted_191 = ["placeholder"]
const _hoisted_192 = ["disabled"]
const _hoisted_193 = {
  key: 0,
  class: "card"
}
const _hoisted_194 = {
  key: 0,
  class: "kv"
}
const _hoisted_195 = ["open"]
const _hoisted_196 = { class: "raw" }
const _hoisted_197 = { key: 4 }
const _hoisted_198 = { class: "card tool-card" }
const _hoisted_199 = { class: "tool-row" }
const _hoisted_200 = ["placeholder"]
const _hoisted_201 = ["disabled"]
const _hoisted_202 = ["disabled"]
const _hoisted_203 = ["disabled"]
const _hoisted_204 = {
  key: 0,
  class: "card"
}
const _hoisted_205 = { class: "grid compact" }
const _hoisted_206 = { class: "mono" }
const _hoisted_207 = { class: "mono dim tiny" }
const _hoisted_208 = {
  key: 1,
  class: "card"
}
const _hoisted_209 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_210 = {
  key: 1,
  class: "kv"
}
const _hoisted_211 = { key: 0 }
const _hoisted_212 = { class: "wrap" }
const _hoisted_213 = {
  key: 2,
  class: "card"
}
const _hoisted_214 = { class: "grid compact" }
const _hoisted_215 = { class: "mono wrap" }
const _hoisted_216 = { class: "mono" }
const _hoisted_217 = { class: "dim mono" }
const _hoisted_218 = { class: "dim" }
const _hoisted_219 = { class: "kv" }
const _hoisted_220 = { key: 5 }
const _hoisted_221 = { class: "card" }
const _hoisted_222 = { class: "bench-head" }
const _hoisted_223 = ["value"]
const _hoisted_224 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_225 = {
  key: 0,
  class: "bench-live"
}
const _hoisted_226 = { class: "rate rx" }
const _hoisted_227 = { class: "lbl" }
const _hoisted_228 = { class: "val" }
const _hoisted_229 = { class: "rate tx" }
const _hoisted_230 = { class: "lbl" }
const _hoisted_231 = { class: "val" }
const _hoisted_232 = {
  class: "spark",
  viewBox: "0 0 300 60",
  preserveAspectRatio: "none"
}
const _hoisted_233 = ["points"]
const _hoisted_234 = ["points"]
const _hoisted_235 = { class: "hint" }
const _hoisted_236 = { key: 0 }
const _hoisted_237 = { class: "card" }
const _hoisted_238 = { class: "bench-head" }
const _hoisted_239 = /*#__PURE__*/_createElementVNode("option", { value: 5 }, "5 MB", -1 /* HOISTED */)
const _hoisted_240 = /*#__PURE__*/_createElementVNode("option", { value: 25 }, "25 MB", -1 /* HOISTED */)
const _hoisted_241 = /*#__PURE__*/_createElementVNode("option", { value: 50 }, "50 MB", -1 /* HOISTED */)
const _hoisted_242 = /*#__PURE__*/_createElementVNode("option", { value: 100 }, "100 MB", -1 /* HOISTED */)
const _hoisted_243 = [
  _hoisted_239,
  _hoisted_240,
  _hoisted_241,
  _hoisted_242
]
const _hoisted_244 = { class: "inline-check" }
const _hoisted_245 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_246 = ["disabled"]
const _hoisted_247 = { class: "hint" }
const _hoisted_248 = {
  key: 0,
  class: "bench-results"
}
const _hoisted_249 = { class: "big" }
const _hoisted_250 = { class: "lbl" }
const _hoisted_251 = { class: "num" }
const _hoisted_252 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_253 = { class: "big" }
const _hoisted_254 = { class: "lbl" }
const _hoisted_255 = { class: "num" }
const _hoisted_256 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_257 = { class: "big" }
const _hoisted_258 = { class: "lbl" }
const _hoisted_259 = { class: "num" }
const _hoisted_260 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "ms", -1 /* HOISTED */)
const _hoisted_261 = { class: "big" }
const _hoisted_262 = { class: "lbl" }
const _hoisted_263 = { class: "num" }
const _hoisted_264 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "ms", -1 /* HOISTED */)
const _hoisted_265 = {
  key: 1,
  class: "hint danger"
}
const _hoisted_266 = { class: "card" }
const _hoisted_267 = { class: "bench-head" }
const _hoisted_268 = { class: "tool-row" }
const _hoisted_269 = ["placeholder"]
const _hoisted_270 = /*#__PURE__*/_createElementVNode("option", { value: 5 }, "5s", -1 /* HOISTED */)
const _hoisted_271 = /*#__PURE__*/_createElementVNode("option", { value: 10 }, "10s", -1 /* HOISTED */)
const _hoisted_272 = /*#__PURE__*/_createElementVNode("option", { value: 30 }, "30s", -1 /* HOISTED */)
const _hoisted_273 = [
  _hoisted_270,
  _hoisted_271,
  _hoisted_272
]
const _hoisted_274 = { class: "inline-check" }
const _hoisted_275 = ["disabled"]
const _hoisted_276 = {
  key: 0,
  class: "bench-results"
}
const _hoisted_277 = { class: "big" }
const _hoisted_278 = { class: "lbl" }
const _hoisted_279 = { class: "num" }
const _hoisted_280 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_281 = { class: "big" }
const _hoisted_282 = { class: "lbl" }
const _hoisted_283 = { class: "num" }
const _hoisted_284 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_285 = {
  key: 0,
  class: "big"
}
const _hoisted_286 = { class: "lbl" }
const _hoisted_287 = { class: "num" }
const _hoisted_288 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, null, -1 /* HOISTED */)
const _hoisted_289 = {
  key: 1,
  class: "spark tall",
  viewBox: "0 0 300 60",
  preserveAspectRatio: "none"
}
const _hoisted_290 = ["points"]
const _hoisted_291 = {
  key: 2,
  class: "hint danger"
}
const _hoisted_292 = {
  key: 1,
  class: "missing"
}
const _hoisted_293 = { class: "raw" }
const _hoisted_294 = { class: "card" }
const _hoisted_295 = { class: "bench-head" }
const _hoisted_296 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_297 = ["disabled"]
const _hoisted_298 = { class: "hint" }
const _hoisted_299 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_300 = { class: "mono" }
const _hoisted_301 = { class: "dim" }
const _hoisted_302 = {
  key: 0,
  class: "badge"
}
const _hoisted_303 = { class: "mono" }
const _hoisted_304 = { class: "mono dim" }
const _hoisted_305 = { class: "mono dim" }
const _hoisted_306 = { class: "mono dim" }
const _hoisted_307 = { class: "card" }
const _hoisted_308 = { class: "bench-head" }
const _hoisted_309 = { class: "tool-row" }
const _hoisted_310 = ["disabled"]
const _hoisted_311 = { class: "kv" }
const _hoisted_312 = {
  key: 0,
  class: "dim"
}
const _hoisted_313 = { class: "waterfall" }
const _hoisted_314 = { class: "wf-name" }
const _hoisted_315 = { class: "wf-bar" }
const _hoisted_316 = { class: "wf-ms mono" }
const _hoisted_317 = { key: 6 }
const _hoisted_318 = { class: "card tool-card" }
const _hoisted_319 = { class: "dim" }
const _hoisted_320 = { class: "tool-row" }
const _hoisted_321 = ["title"]
const _hoisted_322 = { value: "" }
const _hoisted_323 = ["label"]
const _hoisted_324 = ["value"]
const _hoisted_325 = {
  key: 0,
  class: "ip-boxes"
}
const _hoisted_326 = ["value", "data-col", "aria-label", "onInput", "onKeydown"]
const _hoisted_327 = {
  key: 0,
  class: "ip-dot"
}
const _hoisted_328 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_329 = ["aria-label"]
const _hoisted_330 = ["value"]
const _hoisted_331 = { class: "fl-check" }
const _hoisted_332 = {
  key: 0,
  class: "card"
}
const _hoisted_333 = { class: "kv" }
const _hoisted_334 = { class: "card tool-card" }
const _hoisted_335 = { class: "dim" }
const _hoisted_336 = { class: "tool-row" }
const _hoisted_337 = { class: "ip-boxes" }
const _hoisted_338 = ["value", "data-col", "aria-label", "onInput", "onKeydown"]
const _hoisted_339 = {
  key: 0,
  class: "ip-dot"
}
const _hoisted_340 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_341 = ["aria-label"]
const _hoisted_342 = ["value"]
const _hoisted_343 = { class: "dim" }
const _hoisted_344 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_345 = ["aria-label"]
const _hoisted_346 = ["value"]
const _hoisted_347 = ["disabled"]
const _hoisted_348 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_349 = { class: "mono" }
const _hoisted_350 = { class: "mono dim" }
const _hoisted_351 = { class: "mono dim" }
const _hoisted_352 = { class: "mono dim" }
const _hoisted_353 = { class: "mono" }
const _hoisted_354 = { class: "card tool-card" }
const _hoisted_355 = { class: "dim" }
const _hoisted_356 = { class: "ip-boxes" }
const _hoisted_357 = ["value", "data-group", "data-col", "aria-label", "onInput", "onKeydown", "onPaste"]
const _hoisted_358 = {
  key: 0,
  class: "ip-dot"
}
const _hoisted_359 = /*#__PURE__*/_createElementVNode("span", { class: "ip-slash" }, "/", -1 /* HOISTED */)
const _hoisted_360 = ["onUpdate:modelValue", "aria-label"]
const _hoisted_361 = ["value"]
const _hoisted_362 = ["title", "onClick"]
const _hoisted_363 = ["disabled", "title", "onClick"]
const _hoisted_364 = ["placeholder"]
const _hoisted_365 = { class: "tool-row" }
const _hoisted_366 = ["disabled"]
const _hoisted_367 = { class: "fl-check" }
const _hoisted_368 = {
  key: 2,
  class: "kv"
}
const _hoisted_369 = { class: "wrap" }
const _hoisted_370 = { class: "wrap" }
const _hoisted_371 = { class: "card tool-card" }
const _hoisted_372 = { class: "dim" }
const _hoisted_373 = { class: "dim" }
const _hoisted_374 = { class: "tool-row" }
const _hoisted_375 = ["aria-label"]
const _hoisted_376 = ["disabled"]
const _hoisted_377 = {
  key: 0,
  class: "kv"
}
const _hoisted_378 = { key: 7 }
const _hoisted_379 = { class: "card tool-card" }
const _hoisted_380 = { class: "seg" }
const _hoisted_381 = ["onClick"]
const _hoisted_382 = { class: "card tool-card" }
const _hoisted_383 = { class: "tool-row" }
const _hoisted_384 = ["placeholder"]
const _hoisted_385 = ["placeholder"]
const _hoisted_386 = ["disabled"]
const _hoisted_387 = { class: "opt" }
const _hoisted_388 = { class: "dim" }
const _hoisted_389 = {
  key: 0,
  class: "card"
}
const _hoisted_390 = { class: "score" }
const _hoisted_391 = {
  key: 0,
  class: "pill bad"
}
const _hoisted_392 = {
  key: 1,
  class: "pill warn"
}
const _hoisted_393 = {
  key: 2,
  class: "pill ok"
}
const _hoisted_394 = {
  key: 1,
  class: "card"
}
const _hoisted_395 = { class: "grid compact" }
const _hoisted_396 = /*#__PURE__*/_createElementVNode("th", null, "DANE", -1 /* HOISTED */)
const _hoisted_397 = { class: "mono" }
const _hoisted_398 = { class: "mono" }
const _hoisted_399 = { class: "mono" }
const _hoisted_400 = { class: "mono wrap" }
const _hoisted_401 = {
  key: 2,
  class: "card"
}
const _hoisted_402 = { class: "kv" }
const _hoisted_403 = /*#__PURE__*/_createElementVNode("span", null, "SPF", -1 /* HOISTED */)
const _hoisted_404 = { class: "wrap" }
const _hoisted_405 = { key: 0 }
const _hoisted_406 = /*#__PURE__*/_createElementVNode("span", null, "DMARC", -1 /* HOISTED */)
const _hoisted_407 = { class: "wrap" }
const _hoisted_408 = /*#__PURE__*/_createElementVNode("span", null, "MTA-STS", -1 /* HOISTED */)
const _hoisted_409 = { class: "wrap" }
const _hoisted_410 = /*#__PURE__*/_createElementVNode("span", null, "TLS-RPT", -1 /* HOISTED */)
const _hoisted_411 = { class: "wrap" }
const _hoisted_412 = /*#__PURE__*/_createElementVNode("span", null, "BIMI", -1 /* HOISTED */)
const _hoisted_413 = { class: "wrap" }
const _hoisted_414 = { key: 0 }
const _hoisted_415 = { class: "raw" }
const _hoisted_416 = { key: 1 }
const _hoisted_417 = {
  key: 2,
  class: "grid compact"
}
const _hoisted_418 = { class: "mono" }
const _hoisted_419 = { class: "mono" }
const _hoisted_420 = { class: "mono wrap tiny" }
const _hoisted_421 = { key: 3 }
const _hoisted_422 = {
  key: 4,
  class: "grid compact"
}
const _hoisted_423 = { class: "mono" }
const _hoisted_424 = { class: "mono" }
const _hoisted_425 = { class: "mono" }
const _hoisted_426 = {
  key: 3,
  class: "card"
}
const _hoisted_427 = { class: "mono" }
const _hoisted_428 = { class: "chips result" }
const _hoisted_429 = ["title"]
const _hoisted_430 = { class: "dim" }
const _hoisted_431 = { class: "card tool-card" }
const _hoisted_432 = { class: "tool-row" }
const _hoisted_433 = ["placeholder"]
const _hoisted_434 = /*#__PURE__*/_createElementVNode("option", { value: "smtp" }, "SMTP", -1 /* HOISTED */)
const _hoisted_435 = /*#__PURE__*/_createElementVNode("option", { value: "imap" }, "IMAP", -1 /* HOISTED */)
const _hoisted_436 = /*#__PURE__*/_createElementVNode("option", { value: "pop3" }, "POP3", -1 /* HOISTED */)
const _hoisted_437 = [
  _hoisted_434,
  _hoisted_435,
  _hoisted_436
]
const _hoisted_438 = { value: "auto" }
const _hoisted_439 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_440 = { value: "tls" }
const _hoisted_441 = { value: "none" }
const _hoisted_442 = ["placeholder"]
const _hoisted_443 = ["disabled"]
const _hoisted_444 = { class: "chips" }
const _hoisted_445 = ["onClick"]
const _hoisted_446 = {
  key: 0,
  class: "card"
}
const _hoisted_447 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_448 = { class: "kv" }
const _hoisted_449 = { class: "wrap" }
const _hoisted_450 = { key: 0 }
const _hoisted_451 = { key: 1 }
const _hoisted_452 = { class: "wrap" }
const _hoisted_453 = { key: 2 }
const _hoisted_454 = { class: "raw" }
const _hoisted_455 = { class: "raw" }
const _hoisted_456 = { class: "card tool-card" }
const _hoisted_457 = { class: "dim" }
const _hoisted_458 = { class: "tool-row" }
const _hoisted_459 = ["placeholder"]
const _hoisted_460 = ["disabled"]
const _hoisted_461 = { key: 0 }
const _hoisted_462 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_463 = { key: 1 }
const _hoisted_464 = { class: "raw" }
const _hoisted_465 = { class: "card tool-card" }
const _hoisted_466 = { class: "tool-row" }
const _hoisted_467 = ["placeholder"]
const _hoisted_468 = ["disabled"]
const _hoisted_469 = {
  key: 0,
  class: "chips result"
}
const _hoisted_470 = ["title"]
const _hoisted_471 = { class: "card tool-card" }
const _hoisted_472 = { class: "dim" }
const _hoisted_473 = { class: "tool-row" }
const _hoisted_474 = { value: 0 }
const _hoisted_475 = ["value"]
const _hoisted_476 = {
  key: 0,
  class: "tool-row"
}
const _hoisted_477 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_478 = { value: "tls" }
const _hoisted_479 = { value: "none" }
const _hoisted_480 = ["placeholder"]
const _hoisted_481 = ["placeholder"]
const _hoisted_482 = ["placeholder"]
const _hoisted_483 = { class: "tool-row" }
const _hoisted_484 = ["placeholder"]
const _hoisted_485 = ["placeholder"]
const _hoisted_486 = ["placeholder"]
const _hoisted_487 = { class: "tool-row" }
const _hoisted_488 = ["disabled"]
const _hoisted_489 = {
  key: 1,
  class: "kv"
}
const _hoisted_490 = { key: 0 }
const _hoisted_491 = { class: "wrap" }
const _hoisted_492 = { key: 2 }
const _hoisted_493 = { class: "raw" }
const _hoisted_494 = { class: "card" }
const _hoisted_495 = { class: "dim" }
const _hoisted_496 = { class: "tool-row" }
const _hoisted_497 = { value: 0 }
const _hoisted_498 = ["value"]
const _hoisted_499 = ["disabled"]
const _hoisted_500 = {
  key: 0,
  class: "tool-row"
}
const _hoisted_501 = /*#__PURE__*/_createElementVNode("option", { value: "imap" }, "IMAP", -1 /* HOISTED */)
const _hoisted_502 = /*#__PURE__*/_createElementVNode("option", { value: "pop3" }, "POP3", -1 /* HOISTED */)
const _hoisted_503 = [
  _hoisted_501,
  _hoisted_502
]
const _hoisted_504 = { value: "tls" }
const _hoisted_505 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_506 = { value: "none" }
const _hoisted_507 = ["placeholder"]
const _hoisted_508 = ["placeholder"]
const _hoisted_509 = {
  key: 1,
  class: "kv"
}
const _hoisted_510 = { key: 0 }
const _hoisted_511 = { key: 1 }
const _hoisted_512 = { key: 2 }
const _hoisted_513 = { class: "wrap" }
const _hoisted_514 = { key: 8 }
const _hoisted_515 = { class: "card tool-card" }
const _hoisted_516 = { class: "dim" }
const _hoisted_517 = { class: "tool-row" }
const _hoisted_518 = ["value"]
const _hoisted_519 = ["placeholder"]
const _hoisted_520 = ["disabled"]
const _hoisted_521 = { class: "dim tiny" }
const _hoisted_522 = { key: 0 }
const _hoisted_523 = {
  key: 0,
  class: "kv"
}
const _hoisted_524 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_525 = { key: 9 }
const _hoisted_526 = { class: "card tool-card" }
const _hoisted_527 = { class: "dim" }
const _hoisted_528 = { class: "tool-row" }
const _hoisted_529 = /*#__PURE__*/_createElementVNode("option", { value: "sftp" }, "SFTP", -1 /* HOISTED */)
const _hoisted_530 = /*#__PURE__*/_createElementVNode("option", { value: "ftp" }, "FTP", -1 /* HOISTED */)
const _hoisted_531 = [
  _hoisted_529,
  _hoisted_530
]
const _hoisted_532 = ["placeholder"]
const _hoisted_533 = { class: "tool-row" }
const _hoisted_534 = { value: "password" }
const _hoisted_535 = { value: "key" }
const _hoisted_536 = { value: "none" }
const _hoisted_537 = { value: "tls" }
const _hoisted_538 = ["placeholder"]
const _hoisted_539 = ["placeholder"]
const _hoisted_540 = ["placeholder"]
const _hoisted_541 = ["disabled"]
const _hoisted_542 = ["disabled"]
const _hoisted_543 = {
  key: 0,
  class: "dim"
}
const _hoisted_544 = { class: "card tool-card" }
const _hoisted_545 = { class: "tool-row" }
const _hoisted_546 = { value: 0 }
const _hoisted_547 = ["value"]
const _hoisted_548 = ["disabled"]
const _hoisted_549 = {
  key: 0,
  class: "dim"
}
const _hoisted_550 = {
  key: 0,
  class: "card"
}
const _hoisted_551 = {
  key: 0,
  class: "tool-row"
}
const _hoisted_552 = { class: "mono" }
const _hoisted_553 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_554 = { class: "path-bar" }
const _hoisted_555 = ["disabled"]
const _hoisted_556 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_557 = {
  key: 1,
  class: "grid compact"
}
const _hoisted_558 = /*#__PURE__*/_createElementVNode("th", null, null, -1 /* HOISTED */)
const _hoisted_559 = ["onClick"]
const _hoisted_560 = { key: 1 }
const _hoisted_561 = { class: "mono dim" }
const _hoisted_562 = { class: "dim" }
const _hoisted_563 = { class: "mono dim tiny" }
const _hoisted_564 = { class: "row-actions" }
const _hoisted_565 = ["disabled", "onClick"]
const _hoisted_566 = ["onClick"]
const _hoisted_567 = ["onClick"]
const _hoisted_568 = {
  key: 2,
  class: "empty-hint"
}
const _hoisted_569 = {
  key: 1,
  class: "card tool-card"
}
const _hoisted_570 = { class: "tool-row" }
const _hoisted_571 = ["placeholder"]
const _hoisted_572 = { class: "dim" }
const _hoisted_573 = { class: "tool-row" }
const _hoisted_574 = ["placeholder"]
const _hoisted_575 = ["disabled"]
const _hoisted_576 = {
  key: 0,
  class: "note-line"
}
const _hoisted_577 = { key: 10 }
const _hoisted_578 = { class: "section-head" }
const _hoisted_579 = { class: "dim" }
const _hoisted_580 = { class: "card tool-card" }
const _hoisted_581 = { class: "tool-row" }
const _hoisted_582 = ["title"]
const _hoisted_583 = { value: "" }
const _hoisted_584 = ["label"]
const _hoisted_585 = ["value"]
const _hoisted_586 = ["placeholder"]
const _hoisted_587 = ["disabled"]
const _hoisted_588 = ["disabled"]
const _hoisted_589 = { class: "opt" }
const _hoisted_590 = {
  key: 0,
  class: "card"
}
const _hoisted_591 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_592 = { class: "kv" }
const _hoisted_593 = { class: "wrap" }
const _hoisted_594 = { key: 0 }
const _hoisted_595 = {
  key: 1,
  class: "grid compact"
}
const _hoisted_596 = { class: "mono" }
const _hoisted_597 = { class: "mono" }
const _hoisted_598 = { class: "mono wrap tiny" }
const _hoisted_599 = { class: "kv" }
const _hoisted_600 = { class: "wrap tiny" }
const _hoisted_601 = {
  key: 1,
  class: "card"
}
const _hoisted_602 = /*#__PURE__*/_createElementVNode("h3", null, "Telnet", -1 /* HOISTED */)
const _hoisted_603 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_604 = {
  key: 1,
  class: "raw"
}
const _hoisted_605 = {
  key: 2,
  class: "section-head"
}
const _hoisted_606 = { class: "dim" }
const _hoisted_607 = {
  key: 3,
  class: "card tool-card"
}
const _hoisted_608 = { class: "dim" }
const _hoisted_609 = {
  key: 0,
  class: "hint"
}
const _hoisted_610 = { class: "tool-row" }
const _hoisted_611 = ["placeholder"]
const _hoisted_612 = { value: "password" }
const _hoisted_613 = { value: "key" }
const _hoisted_614 = { class: "tool-row" }
const _hoisted_615 = ["placeholder"]
const _hoisted_616 = ["placeholder"]
const _hoisted_617 = ["placeholder"]
const _hoisted_618 = ["disabled"]
const _hoisted_619 = ["disabled"]
const _hoisted_620 = {
  key: 4,
  class: "card tool-card"
}
const _hoisted_621 = /*#__PURE__*/_createElementVNode("h3", null, "Telnet", -1 /* HOISTED */)
const _hoisted_622 = { class: "dim" }
const _hoisted_623 = {
  key: 0,
  class: "hint"
}
const _hoisted_624 = { class: "tool-row" }
const _hoisted_625 = ["placeholder"]
const _hoisted_626 = ["disabled"]
const _hoisted_627 = {
  key: 5,
  class: "card tool-card"
}
const _hoisted_628 = { class: "dim" }
const _hoisted_629 = { class: "tool-row" }
const _hoisted_630 = { value: 0 }
const _hoisted_631 = ["value"]
const _hoisted_632 = { class: "tool-row" }
const _hoisted_633 = { value: "" }
const _hoisted_634 = ["value"]
const _hoisted_635 = ["disabled"]
const _hoisted_636 = { class: "tool-row" }
const _hoisted_637 = ["placeholder"]
const _hoisted_638 = ["disabled"]
const _hoisted_639 = ["disabled"]
const _hoisted_640 = { key: 0 }
const _hoisted_641 = { class: "kv" }
const _hoisted_642 = { class: "wrap" }
const _hoisted_643 = { class: "raw" }
const _hoisted_644 = { class: "modal" }
const _hoisted_645 = { class: "drawer-head" }
const _hoisted_646 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖥", -1 /* HOISTED */)
const _hoisted_647 = { class: "dim" }
const _hoisted_648 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_649 = ["title", "aria-label"]
const _hoisted_650 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_651 = [
  _hoisted_650
]
const _hoisted_652 = { class: "drawer-body" }
const _hoisted_653 = { class: "kv" }
const _hoisted_654 = /*#__PURE__*/_createElementVNode("span", null, "NetBase", -1 /* HOISTED */)
const _hoisted_655 = { key: 0 }
const _hoisted_656 = { key: 1 }
const _hoisted_657 = /*#__PURE__*/_createElementVNode("span", null, "PHP", -1 /* HOISTED */)
const _hoisted_658 = {
  key: 0,
  class: "dim"
}
const _hoisted_659 = { key: 2 }
const _hoisted_660 = { key: 3 }
const _hoisted_661 = { class: "dim" }
const _hoisted_662 = {
  key: 0,
  class: "card"
}
const _hoisted_663 = { class: "kv" }
const _hoisted_664 = { class: "grid compact" }
const _hoisted_665 = /*#__PURE__*/_createElementVNode("th", null, "MTU", -1 /* HOISTED */)
const _hoisted_666 = { class: "mono" }
const _hoisted_667 = { class: "mono dim" }
const _hoisted_668 = { class: "mono" }
const _hoisted_669 = { class: "dim mono" }
const _hoisted_670 = { key: 0 }
const _hoisted_671 = { class: "raw" }
const _hoisted_672 = {
  key: 1,
  class: "dim"
}
const _hoisted_673 = { class: "pill ok" }
const _hoisted_674 = { class: "dim" }
const _hoisted_675 = {
  key: 2,
  class: "dim"
}
const _hoisted_676 = { class: "pill no" }
const _hoisted_677 = { class: "dim" }
const _hoisted_678 = {
  key: 0,
  class: "raw"
}
const _hoisted_679 = {
  key: 1,
  class: "dim"
}
const _hoisted_680 = { class: "drawer-foot" }
const _hoisted_681 = ["href"]
const _hoisted_682 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_683 = {
  key: 2,
  class: "drawer-backdrop centred"
}
const _hoisted_684 = { class: "modal narrow" }
const _hoisted_685 = { class: "drawer-head" }
const _hoisted_686 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🎨", -1 /* HOISTED */)
const _hoisted_687 = { class: "dim" }
const _hoisted_688 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_689 = ["title", "aria-label"]
const _hoisted_690 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_691 = [
  _hoisted_690
]
const _hoisted_692 = { class: "drawer-body" }
const _hoisted_693 = { class: "theme-picks" }
const _hoisted_694 = ["onClick"]
const _hoisted_695 = /*#__PURE__*/_createElementVNode("i", { class: "bar" }, null, -1 /* HOISTED */)
const _hoisted_696 = /*#__PURE__*/_createElementVNode("i", { class: "line" }, null, -1 /* HOISTED */)
const _hoisted_697 = /*#__PURE__*/_createElementVNode("i", { class: "line short" }, null, -1 /* HOISTED */)
const _hoisted_698 = [
  _hoisted_695,
  _hoisted_696,
  _hoisted_697
]
const _hoisted_699 = { class: "dim" }
const _hoisted_700 = {
  key: 0,
  class: "tick"
}
const _hoisted_701 = { class: "dim" }
const _hoisted_702 = { class: "fl" }
const _hoisted_703 = ["value"]
const _hoisted_704 = { value: "auto" }
const _hoisted_705 = ["value"]
const _hoisted_706 = { class: "dim" }
const _hoisted_707 = { class: "dim" }
const _hoisted_708 = { class: "fl-row" }
const _hoisted_709 = ["placeholder"]
const _hoisted_710 = ["disabled"]
const _hoisted_711 = { class: "dim" }
const _hoisted_712 = ["disabled"]
const _hoisted_713 = { class: "drawer-foot" }
const _hoisted_714 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_715 = {
  key: 3,
  class: "drawer-backdrop centred"
}
const _hoisted_716 = { class: "modal narrow" }
const _hoisted_717 = { class: "drawer-head" }
const _hoisted_718 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖳", -1 /* HOISTED */)
const _hoisted_719 = { class: "dim" }
const _hoisted_720 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_721 = ["title", "aria-label"]
const _hoisted_722 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_723 = [
  _hoisted_722
]
const _hoisted_724 = { class: "drawer-body" }
const _hoisted_725 = { class: "fl-row" }
const _hoisted_726 = { class: "fl grow" }
const _hoisted_727 = { class: "fl-label" }
const _hoisted_728 = { class: "fl short" }
const _hoisted_729 = { class: "fl-label" }
const _hoisted_730 = { class: "fl-row" }
const _hoisted_731 = { class: "fl grow" }
const _hoisted_732 = { class: "fl-label" }
const _hoisted_733 = { class: "fl short" }
const _hoisted_734 = { class: "fl-label" }
const _hoisted_735 = { value: "password" }
const _hoisted_736 = { value: "key" }
const _hoisted_737 = { class: "fl-row" }
const _hoisted_738 = { class: "fl grow" }
const _hoisted_739 = { class: "fl-label" }
const _hoisted_740 = ["placeholder"]
const _hoisted_741 = { class: "fl" }
const _hoisted_742 = { class: "fl-label" }
const _hoisted_743 = {
  key: 1,
  class: "fl"
}
const _hoisted_744 = { class: "fl-label" }
const _hoisted_745 = { class: "drawer-foot" }
const _hoisted_746 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_747 = ["disabled"]
const _hoisted_748 = ["onMousedown"]
const _hoisted_749 = ["onMousedown"]
const _hoisted_750 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🖥", -1 /* HOISTED */)
const _hoisted_751 = { class: "nm" }
const _hoisted_752 = { class: "dim mono tiny addr" }
const _hoisted_753 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_754 = ["title", "aria-label", "disabled", "onClick"]
const _hoisted_755 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M20 12H5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M12 19l-7-7 7-7" })
], -1 /* HOISTED */)
const _hoisted_756 = [
  _hoisted_755
]
const _hoisted_757 = ["title", "aria-label", "onClick"]
const _hoisted_758 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M3 10.5L12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M9.5 21.5v-8h5v8" })
], -1 /* HOISTED */)
const _hoisted_759 = [
  _hoisted_758
]
const _hoisted_760 = ["title", "aria-label", "onClick"]
const _hoisted_761 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M20.5 13.5A8.5 8.5 0 1 1 18 6.4L21.5 9.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M21.5 4v5.5H16" })
], -1 /* HOISTED */)
const _hoisted_762 = [
  _hoisted_761
]
const _hoisted_763 = ["title", "aria-label", "onClick"]
const _hoisted_764 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M14.5 3.5H20.5V9.5\"></path><path d=\"M9.5 20.5H3.5V14.5\"></path><path d=\"M20.5 3.5L13.5 10.5\"></path><path d=\"M3.5 20.5L10.5 13.5\"></path></svg>", 1)
const _hoisted_765 = [
  _hoisted_764
]
const _hoisted_766 = ["title", "aria-label", "onClick"]
const _hoisted_767 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("circle", {
    cx: "12",
    cy: "12",
    r: "9.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M9.2 9.3a2.9 2.9 0 0 1 5.7.8c0 1.9-2.9 2.4-2.9 4" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M12 17.4h.01" })
], -1 /* HOISTED */)
const _hoisted_768 = [
  _hoisted_767
]
const _hoisted_769 = ["title", "aria-label", "onClick"]
const _hoisted_770 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_771 = [
  _hoisted_770
]
const _hoisted_772 = ["onClick"]
const _hoisted_773 = ["title", "onClick"]
const _hoisted_774 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
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
const _hoisted_775 = { class: "lb" }
const _hoisted_776 = ["title", "onClick"]
const _hoisted_777 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M4 6.5h16\"></path><path d=\"M4 12h16\"></path><path d=\"M4 17.5h10\"></path></svg></span>", 1)
const _hoisted_778 = { class: "lb" }
const _hoisted_779 = ["title", "onClick"]
const _hoisted_780 = /*#__PURE__*/_createStaticVNode("<span class=\"ic\"><svg viewBox=\"0 0 24 24\"><path d=\"M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2\"></path><rect x=\"9\" y=\"2.5\" width=\"6\" height=\"3.5\" rx=\"1\"></rect><path d=\"M8.5 12h7\"></path><path d=\"M8.5 15.5h4.5\"></path></svg></span>", 1)
const _hoisted_781 = { class: "lb" }
const _hoisted_782 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_783 = ["title", "onClick"]
const _hoisted_784 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, [
  /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
    /*#__PURE__*/_createElementVNode("path", { d: "M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" }),
    /*#__PURE__*/_createElementVNode("circle", {
      cx: "12",
      cy: "12.7",
      r: "3.4"
    })
  ])
], -1 /* HOISTED */)
const _hoisted_785 = { class: "lb" }
const _hoisted_786 = { class: "devwin-zoom" }
const _hoisted_787 = ["title", "aria-label", "onClick"]
const _hoisted_788 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M3.5 8.5V4.5H7.5\"></path><path d=\"M20.5 8.5V4.5H16.5\"></path><path d=\"M3.5 15.5V19.5H7.5\"></path><path d=\"M20.5 15.5V19.5H16.5\"></path></svg>", 1)
const _hoisted_789 = [
  _hoisted_788
]
const _hoisted_790 = ["title", "aria-label", "disabled", "onClick"]
const _hoisted_791 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M5 12h14" })
], -1 /* HOISTED */)
const _hoisted_792 = [
  _hoisted_791
]
const _hoisted_793 = ["title", "onClick"]
const _hoisted_794 = ["title", "aria-label", "disabled", "onClick"]
const _hoisted_795 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M12 5v14" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M5 12h14" })
], -1 /* HOISTED */)
const _hoisted_796 = [
  _hoisted_795
]
const _hoisted_797 = { class: "dim mono tiny" }
const _hoisted_798 = {
  key: 2,
  class: "devwin-note dim"
}
const _hoisted_799 = {
  key: 3,
  class: "devwin-note error"
}
const _hoisted_800 = ["src", "title", "data-window", "onLoad"]
const _hoisted_801 = ["onClick"]
const _hoisted_802 = ["onMousedown"]
const _hoisted_803 = { class: "row-menu-head" }
const _hoisted_804 = ["onClick"]
const _hoisted_805 = { class: "ic" }
const _hoisted_806 = {
  key: 0,
  class: "row-menu-none"
}
const _hoisted_807 = /*#__PURE__*/_createElementVNode("li", { class: "row-menu-rule" }, null, -1 /* HOISTED */)
const _hoisted_808 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "📋", -1 /* HOISTED */)
const _hoisted_809 = ["onMousedown"]
const _hoisted_810 = ["onMousedown"]
const _hoisted_811 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🖳", -1 /* HOISTED */)
const _hoisted_812 = { class: "nm" }
const _hoisted_813 = { class: "dim mono tiny addr" }
const _hoisted_814 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_815 = ["title", "aria-label", "onClick"]
const _hoisted_816 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M4 7h16" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M9.5 7V4.5h5V7" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6.5 7l1 13h9l1-13" })
], -1 /* HOISTED */)
const _hoisted_817 = [
  _hoisted_816
]
const _hoisted_818 = ["title", "aria-label", "onClick"]
const _hoisted_819 = /*#__PURE__*/_createStaticVNode("<svg viewBox=\"0 0 24 24\"><path d=\"M14.5 3.5H20.5V9.5\"></path><path d=\"M9.5 20.5H3.5V14.5\"></path><path d=\"M20.5 3.5L13.5 10.5\"></path><path d=\"M3.5 20.5L10.5 13.5\"></path></svg>", 1)
const _hoisted_820 = [
  _hoisted_819
]
const _hoisted_821 = ["title", "aria-label", "onClick"]
const _hoisted_822 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_823 = [
  _hoisted_822
]
const _hoisted_824 = {
  key: 0,
  class: "term-signin"
}
const _hoisted_825 = ["onUpdate:modelValue", "placeholder", "onKeyup"]
const _hoisted_826 = ["onUpdate:modelValue", "placeholder", "onKeyup"]
const _hoisted_827 = ["disabled", "onClick"]
const _hoisted_828 = { class: "dim tiny" }
const _hoisted_829 = { class: "dim tiny" }
const _hoisted_830 = {
  key: 0,
  class: "term-prompt"
}
const _hoisted_831 = {
  key: 0,
  class: "term-line dim"
}
const _hoisted_832 = {
  key: 3,
  class: "term-input"
}
const _hoisted_833 = { class: "term-prompt mono" }
const _hoisted_834 = ["onUpdate:modelValue", "disabled", "onKeydown"]
const _hoisted_835 = ["onMousedown"]
const _hoisted_836 = { class: "modal" }
const _hoisted_837 = { class: "drawer-head" }
const _hoisted_838 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "📂", -1 /* HOISTED */)
const _hoisted_839 = { class: "dim tiny" }
const _hoisted_840 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_841 = ["title", "aria-label"]
const _hoisted_842 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_843 = [
  _hoisted_842
]
const _hoisted_844 = { class: "drawer-body" }
const _hoisted_845 = { class: "path-bar" }
const _hoisted_846 = ["disabled"]
const _hoisted_847 = { class: "mono dim" }
const _hoisted_848 = { class: "grid compact" }
const _hoisted_849 = ["onClick"]
const _hoisted_850 = ["onClick"]
const _hoisted_851 = { class: "mono dim" }
const _hoisted_852 = { class: "dim" }
const _hoisted_853 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_854 = { class: "drawer-foot" }
const _hoisted_855 = { class: "dim tiny" }
const _hoisted_856 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_857 = { class: "modal wide" }
const _hoisted_858 = { class: "drawer-head" }
const _hoisted_859 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖼", -1 /* HOISTED */)
const _hoisted_860 = { class: "dim mono tiny" }
const _hoisted_861 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_862 = ["href", "title", "aria-label"]
const _hoisted_863 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M14 4h6v6" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M20 4l-8.5 8.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" })
], -1 /* HOISTED */)
const _hoisted_864 = [
  _hoisted_863
]
const _hoisted_865 = ["disabled"]
const _hoisted_866 = ["title", "aria-label"]
const _hoisted_867 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_868 = [
  _hoisted_867
]
const _hoisted_869 = { class: "drawer-body preview-body" }
const _hoisted_870 = {
  key: 0,
  class: "dim centred-text"
}
const _hoisted_871 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_872 = ["src", "alt"]
const _hoisted_873 = { class: "drawer-foot" }
const _hoisted_874 = { class: "opt" }
const _hoisted_875 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_876 = {
  key: 7,
  class: "drawer-backdrop centred"
}
const _hoisted_877 = { class: "modal narrow" }
const _hoisted_878 = { class: "drawer-head" }
const _hoisted_879 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🔗", -1 /* HOISTED */)
const _hoisted_880 = { class: "dim" }
const _hoisted_881 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_882 = ["title", "aria-label"]
const _hoisted_883 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_884 = [
  _hoisted_883
]
const _hoisted_885 = { class: "drawer-body" }
const _hoisted_886 = { class: "fl" }
const _hoisted_887 = { class: "fl-label" }
const _hoisted_888 = ["value"]
const _hoisted_889 = { class: "fl" }
const _hoisted_890 = { class: "fl-label" }
const _hoisted_891 = ["placeholder"]
const _hoisted_892 = { class: "fl-row" }
const _hoisted_893 = { class: "fl grow" }
const _hoisted_894 = { class: "fl-label" }
const _hoisted_895 = { class: "fl short" }
const _hoisted_896 = { class: "fl-label" }
const _hoisted_897 = {
  key: 0,
  class: "fl"
}
const _hoisted_898 = { class: "fl-label" }
const _hoisted_899 = ["value"]
const _hoisted_900 = {
  key: 1,
  class: "fl"
}
const _hoisted_901 = { class: "fl-label" }
const _hoisted_902 = { value: "password" }
const _hoisted_903 = { value: "key" }
const _hoisted_904 = { class: "fl-row" }
const _hoisted_905 = { class: "fl grow" }
const _hoisted_906 = { class: "fl-label" }
const _hoisted_907 = {
  key: 0,
  class: "fl grow"
}
const _hoisted_908 = { class: "fl-label" }
const _hoisted_909 = {
  key: 1,
  class: "fl grow"
}
const _hoisted_910 = { class: "fl-label" }
const _hoisted_911 = { class: "fl" }
const _hoisted_912 = { class: "fl-label" }
const _hoisted_913 = { class: "with-button" }
const _hoisted_914 = { class: "dim" }
const _hoisted_915 = { class: "fl" }
const _hoisted_916 = { class: "fl-label" }
const _hoisted_917 = {
  key: 3,
  class: "fl"
}
const _hoisted_918 = { class: "fl-label" }
const _hoisted_919 = {
  key: 4,
  class: "fl"
}
const _hoisted_920 = { class: "fl-label" }
const _hoisted_921 = {
  key: 5,
  class: "opt"
}
const _hoisted_922 = { class: "fl" }
const _hoisted_923 = { class: "fl-label" }
const _hoisted_924 = {
  key: 6,
  class: "note-line"
}
const _hoisted_925 = { class: "drawer-foot" }
const _hoisted_926 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_927 = ["disabled"]
const _hoisted_928 = { class: "drawer" }
const _hoisted_929 = { class: "drawer-head" }
const _hoisted_930 = { class: "ic big" }
const _hoisted_931 = ["placeholder", "readonly"]
const _hoisted_932 = { class: "dim mono" }
const _hoisted_933 = ["title", "aria-label"]
const _hoisted_934 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_935 = [
  _hoisted_934
]
const _hoisted_936 = ["title", "aria-label"]
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
const _hoisted_939 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_940 = ["title", "aria-label"]
const _hoisted_941 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_942 = [
  _hoisted_941
]
const _hoisted_943 = ["title", "aria-label"]
const _hoisted_944 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M18 6L6 18" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 6l12 12" })
], -1 /* HOISTED */)
const _hoisted_945 = [
  _hoisted_944
]
const _hoisted_946 = { class: "drawer-body" }
const _hoisted_947 = { class: "kv" }
const _hoisted_948 = ["title", "aria-label"]
const _hoisted_949 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_950 = [
  _hoisted_949
]
const _hoisted_951 = ["title", "aria-label"]
const _hoisted_952 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_953 = [
  _hoisted_952
]
const _hoisted_954 = { key: 0 }
const _hoisted_955 = ["title", "aria-label"]
const _hoisted_956 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_957 = [
  _hoisted_956
]
const _hoisted_958 = ["title", "onClick"]
const _hoisted_959 = ["title", "onClick"]
const _hoisted_960 = { key: 2 }
const _hoisted_961 = { key: 3 }
const _hoisted_962 = { key: 0 }
const _hoisted_963 = ["title", "aria-label"]
const _hoisted_964 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_965 = [
  _hoisted_964
]
const _hoisted_966 = ["title", "aria-label"]
const _hoisted_967 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_968 = [
  _hoisted_967
]
const _hoisted_969 = ["title", "aria-label"]
const _hoisted_970 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_971 = [
  _hoisted_970
]
const _hoisted_972 = ["title", "aria-label"]
const _hoisted_973 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_974 = [
  _hoisted_973
]
const _hoisted_975 = { key: 1 }
const _hoisted_976 = /*#__PURE__*/_createElementVNode("span", null, "mDNS", -1 /* HOISTED */)
const _hoisted_977 = ["title", "aria-label"]
const _hoisted_978 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_979 = [
  _hoisted_978
]
const _hoisted_980 = { key: 2 }
const _hoisted_981 = ["title", "aria-label"]
const _hoisted_982 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_983 = [
  _hoisted_982
]
const _hoisted_984 = { key: 3 }
const _hoisted_985 = /*#__PURE__*/_createElementVNode("span", null, "SSDP", -1 /* HOISTED */)
const _hoisted_986 = { class: "wrap" }
const _hoisted_987 = ["title", "aria-label"]
const _hoisted_988 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_989 = [
  _hoisted_988
]
const _hoisted_990 = { class: "fl" }
const _hoisted_991 = { class: "fl-label" }
const _hoisted_992 = ["value"]
const _hoisted_993 = { class: "fl" }
const _hoisted_994 = { class: "fl-label" }
const _hoisted_995 = ["placeholder"]
const _hoisted_996 = { class: "fl" }
const _hoisted_997 = { class: "fl-label" }
const _hoisted_998 = {
  key: 1,
  class: "kv"
}
const _hoisted_999 = { key: 0 }
const _hoisted_1000 = { key: 1 }
const _hoisted_1001 = { class: "wrap" }
const _hoisted_1002 = { class: "drawer-tools" }
const _hoisted_1003 = ["onClick"]
const _hoisted_1004 = ["title", "aria-label", "onClick"]
const _hoisted_1005 = ["href", "title", "aria-label"]
const _hoisted_1006 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("path", { d: "M14 4h6v6" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M20 4l-8.5 8.5" }),
  /*#__PURE__*/_createElementVNode("path", { d: "M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" })
], -1 /* HOISTED */)
const _hoisted_1007 = [
  _hoisted_1006
]
const _hoisted_1008 = {
  key: 2,
  class: "away-note"
}
const _hoisted_1009 = { class: "away-cmd" }
const _hoisted_1010 = { class: "mono" }
const _hoisted_1011 = ["title", "aria-label"]
const _hoisted_1012 = /*#__PURE__*/_createElementVNode("svg", { viewBox: "0 0 24 24" }, [
  /*#__PURE__*/_createElementVNode("rect", {
    x: "9",
    y: "9",
    width: "12",
    height: "12",
    rx: "2.2"
  }),
  /*#__PURE__*/_createElementVNode("path", { d: "M6 15.5H5.5A2.5 2.5 0 0 1 3 13V5.5A2.5 2.5 0 0 1 5.5 3H13a2.5 2.5 0 0 1 2.5 2.5V6" })
], -1 /* HOISTED */)
const _hoisted_1013 = [
  _hoisted_1012
]
const _hoisted_1014 = {
  key: 0,
  class: "away-act"
}
const _hoisted_1015 = { class: "hint" }
const _hoisted_1016 = { class: "drawer-tools device" }
const _hoisted_1017 = ["disabled"]
const _hoisted_1018 = ["disabled"]
const _hoisted_1019 = ["title"]
const _hoisted_1020 = ["placeholder", "aria-label"]
const _hoisted_1021 = ["aria-label"]
const _hoisted_1022 = /*#__PURE__*/_createElementVNode("option", { value: "http" }, "HTTP", -1 /* HOISTED */)
const _hoisted_1023 = /*#__PURE__*/_createElementVNode("option", { value: "https" }, "HTTPS", -1 /* HOISTED */)
const _hoisted_1024 = [
  _hoisted_1022,
  _hoisted_1023
]
const _hoisted_1025 = ["disabled"]
const _hoisted_1026 = {
  key: 3,
  class: "deep-result",
  ref: "deepResult"
}
const _hoisted_1027 = {
  key: 0,
  class: "hint"
}
const _hoisted_1028 = {
  key: 1,
  class: "kv"
}
const _hoisted_1029 = { class: "mono" }
const _hoisted_1030 = ["onClick"]
const _hoisted_1031 = { class: "drawer-foot" }
const _hoisted_1032 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)

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
        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.visibleTabs, (item) => {
          return (_openBlock(), _createElementBlock("button", {
            key: item.id,
            class: _normalizeClass(["nav-item", {active: _ctx.tab===item.id, dragged: _ctx.dragTab===item.id, over: _ctx.overTab===item.id}]),
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
            _createElementVNode("span", _hoisted_6, _toDisplayString(item.icon), 1 /* TEXT */),
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
              class: "btn sm block",
              onClick: _cache[5] || (_cache[5] = $event => {_ctx.menu=false; _ctx.openSysInfo()})
            }, _toDisplayString(_ctx.t('🖥 System information')), 1 /* TEXT */))
          : _createCommentVNode("v-if", true),
        _createElementVNode("button", {
          class: "btn sm block",
          onClick: _cache[6] || (_cache[6] = $event => {_ctx.menu=false; _ctx.themeBox = true})
        }, _toDisplayString(_ctx.t('⚙ Settings')), 1 /* TEXT */)
      ])
    ], 2 /* CLASS */),
    _createElementVNode("main", _hoisted_12, [
      _createElementVNode("div", _hoisted_13, [
        _createCommentVNode(" On a phone the tool list is a drawer, and this is its handle. "),
        _createElementVNode("button", {
          class: "btn sm menu-btn",
          title: _ctx.t('The list of tools'),
          "aria-label": _ctx.t('The list of tools'),
          onClick: _cache[7] || (_cache[7] = $event => (_ctx.menu = !_ctx.menu))
        }, "☰", 8 /* PROPS */, _hoisted_14),
        _createElementVNode("div", _hoisted_15, [
          _createElementVNode("span", _hoisted_16, _toDisplayString(_ctx.currentTab.icon), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_17, _toDisplayString(_ctx.t(_ctx.currentTab.label)), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_18, _toDisplayString(_ctx.t(_ctx.currentTab.hint)), 1 /* TEXT */)
        ]),
        _hoisted_19,
        _createElementVNode("div", _hoisted_20, [
          _createCommentVNode(" What belongs to this tab alone. On a phone it takes a line of its\n               own, so the buttons every tab has keep their place beside the title. "),
          (_ctx.tab==='devices')
            ? (_openBlock(), _createElementBlock("div", _hoisted_21, [
                _withDirectives(_createElementVNode("input", {
                  class: "filter",
                  "onUpdate:modelValue": _cache[8] || (_cache[8] = $event => ((_ctx.filter) = $event)),
                  placeholder: _ctx.t('Filter by name, IP, MAC or vendor')
                }, null, 8 /* PROPS */, _hoisted_22), [
                  [_vModelText, _ctx.filter]
                ]),
                _createElementVNode("button", {
                  class: _normalizeClass(["btn sm", {active: _ctx.onlyOnline}]),
                  onClick: _cache[9] || (_cache[9] = $event => (_ctx.onlyOnline=!_ctx.onlyOnline))
                }, _toDisplayString(_ctx.onlyOnline ? _ctx.t('Online only') : _ctx.t('All records')), 3 /* TEXT, CLASS */),
                _createElementVNode("button", {
                  class: "btn sm keep",
                  title: _ctx.t('Download what this tool found'),
                  onClick: _cache[10] || (_cache[10] = (...args) => (_ctx.exportCsv && _ctx.exportCsv(...args))),
                  disabled: !_ctx.shownDevices.length
                }, _hoisted_26, 8 /* PROPS */, _hoisted_23)
              ]))
            : _createCommentVNode("v-if", true),
          _createCommentVNode(" Whatever this tool has found: onto the clipboard, into a file, or\n               into the person's own Nextcloud folder. "),
          _createElementVNode("button", {
            class: "btn sm keep",
            title: _ctx.t('Copy what this tool found'),
            disabled: !_ctx.hasResult,
            onClick: _cache[11] || (_cache[11] = (...args) => (_ctx.copyResult && _ctx.copyResult(...args)))
          }, [
            _hoisted_28,
            _createElementVNode("span", _hoisted_29, _toDisplayString(_ctx.t('Copy')), 1 /* TEXT */)
          ], 8 /* PROPS */, _hoisted_27),
          _createElementVNode("button", {
            class: "btn sm keep",
            title: _ctx.t('Download what this tool found'),
            disabled: !_ctx.hasResult,
            onClick: _cache[12] || (_cache[12] = (...args) => (_ctx.downloadResult && _ctx.downloadResult(...args)))
          }, [
            _hoisted_31,
            _createElementVNode("span", _hoisted_32, _toDisplayString(_ctx.t('Download as a file')), 1 /* TEXT */)
          ], 8 /* PROPS */, _hoisted_30),
          _createElementVNode("button", {
            class: "btn sm keep",
            title: _ctx.t('Save it to your Nextcloud files'),
            disabled: !_ctx.hasResult,
            onClick: _cache[13] || (_cache[13] = (...args) => (_ctx.saveResultToFiles && _ctx.saveResultToFiles(...args)))
          }, [
            _hoisted_34,
            _createElementVNode("span", _hoisted_35, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
          ], 8 /* PROPS */, _hoisted_33)
        ])
      ]),
      _createElementVNode("div", _hoisted_36, [
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
                onClick: _cache[14] || (_cache[14] = $event => (_ctx.banner=null))
              }, _hoisted_39, 8 /* PROPS */, _hoisted_37)
            ], 2 /* CLASS */))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ devices ============ "),
        (_ctx.tab==='devices')
          ? (_openBlock(), _createElementBlock("section", _hoisted_40, [
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_41, [
                    _createCommentVNode(" What is being scanned, before anything about how. The two are\n                 different jobs: one walks every address in the network, the\n                 other starts from what this server has already met. "),
                    _createElementVNode("div", _hoisted_42, [
                      _createElementVNode("span", _hoisted_43, _toDisplayString(_ctx.t('What to scan')), 1 /* TEXT */),
                      _createElementVNode("label", {
                        title: _ctx.t('Walks every address in the networks below. Thorough, and the slow one.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "radio",
                          value: "network",
                          "onUpdate:modelValue": _cache[15] || (_cache[15] = $event => ((_ctx.scanWhat) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelRadio, _ctx.scanWhat]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('The whole network')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_44),
                      _createElementVNode("label", {
                        title: _ctx.t('Starts from the ARP table and what announces itself, instead of walking every address. Seconds rather than minutes, and everything found is still asked for its name and its open ports — but a device that has never spoken to this server and does not announce itself will not be found.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "radio",
                          value: "arp",
                          "onUpdate:modelValue": _cache[16] || (_cache[16] = $event => ((_ctx.scanWhat) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelRadio, _ctx.scanWhat]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('The ARP table only')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_45)
                    ]),
                    _createElementVNode("div", _hoisted_46, [
                      (_ctx.scanWhat === 'network')
                        ? (_openBlock(), _createElementBlock("label", {
                            key: 0,
                            class: "fl",
                            title: _ctx.t('Which networks to look at. Left blank, it uses the ones this server is on. Several can be given, separated by commas.')
                          }, [
                            _createElementVNode("span", _hoisted_48, _toDisplayString(_ctx.t('Networks to scan')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[17] || (_cache[17] = $event => ((_ctx.scanTargets) = $event)),
                              placeholder: _ctx.suggestedPlaceholder
                            }, null, 8 /* PROPS */, _hoisted_49), [
                              [_vModelText, _ctx.scanTargets]
                            ])
                          ], 8 /* PROPS */, _hoisted_47))
                        : _createCommentVNode("v-if", true),
                      _createCommentVNode(" Two different things, named as the two different things they\n                   are. This one walks the addresses; the wait beneath is what a\n                   port that says nothing costs, and it is the wait, not this,\n                   that decides how long a long scan takes. "),
                      (_ctx.scanWhat === 'network')
                        ? (_openBlock(), _createElementBlock("label", {
                            key: 1,
                            class: "fl narrow pace",
                            title: _ctx.t('How quickly the addresses are walked through. A slower speed finds more Wi-Fi devices, because a wireless network carries broadcasts slowly: on a /16 with ten devices, 15,000 a second found six of them and 1,500 found all ten.')
                          }, [
                            _createElementVNode("span", _hoisted_51, _toDisplayString(_ctx.t('Scan speed')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[18] || (_cache[18] = $event => ((_ctx.pace) = $event))
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.paceRates, (r) => {
                                return (_openBlock(), _createElementBlock("option", {
                                  key: r,
                                  value: String(r)
                                }, _toDisplayString(_ctx.paceLabel(r)), 9 /* TEXT, PROPS */, _hoisted_52))
                              }), 128 /* KEYED_FRAGMENT */))
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.pace]
                            ])
                          ], 8 /* PROPS */, _hoisted_50))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: _ctx.scanning,
                        onClick: _cache[19] || (_cache[19] = $event => (_ctx.startScan()))
                      }, _toDisplayString(_ctx.scanning ? _ctx.t('Scanning…') : _ctx.t('Start scanning')), 9 /* TEXT, PROPS */, _hoisted_53),
                      (_ctx.scanning)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 2,
                            class: "btn",
                            onClick: _cache[20] || (_cache[20] = (...args) => (_ctx.cancelScan && _ctx.cancelScan(...args)))
                          }, _toDisplayString(_ctx.t('Stop')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createCommentVNode(" The four steps of a scan, in the order they happen, so the row\n                 reads as what the scan is about to do. "),
                    _createElementVNode("div", _hoisted_54, [
                      _createElementVNode("label", {
                        title: _ctx.t('Asks each address for its own name, over NetBIOS and mDNS.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[21] || (_cache[21] = $event => ((_ctx.opts.names) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.names]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Ask devices for their names')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_55),
                      _createElementVNode("label", {
                        title: _ctx.t('Listens for the devices that announce themselves — mDNS, WS-Discovery and SSDP. It finds devices the sweep missed.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[22] || (_cache[22] = $event => ((_ctx.opts.multicast) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.multicast]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Multicast discovery')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_56),
                      _createElementVNode("label", {
                        title: _ctx.t('Connects to each device to see which ports answer. This is what tells a printer from a camera.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[23] || (_cache[23] = $event => ((_ctx.opts.ports) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.ports]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Check open ports')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_57),
                      _createElementVNode("label", {
                        title: _ctx.t('Asks the DNS server what name it has on record for each address.')
                      }, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[24] || (_cache[24] = $event => ((_ctx.opts.rdns) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.rdns]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Reverse DNS')), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_58)
                    ]),
                    _createCommentVNode(" The two settings that belong to the third of them, kept under it\n                 rather than in the row, where the wrapping used to put an\n                 unrelated checkbox between a port setting and its own box. "),
                    (_ctx.opts.ports)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_59, [
                          _createElementVNode("label", {
                            title: _ctx.t('How many ports to try on each device.')
                          }, [
                            _createElementVNode("span", _hoisted_61, _toDisplayString(_ctx.t('Ports to try')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[25] || (_cache[25] = $event => ((_ctx.opts.portScan) = $event))
                            }, [
                              _createElementVNode("option", _hoisted_62, _toDisplayString(_ctx.t('Common ports')) + " (" + _toDisplayString(_ctx.portCount('common')) + ")", 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_63, _toDisplayString(_ctx.t('Detailed search')) + " (" + _toDisplayString(_ctx.portCount('detailed')) + ")", 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_64, _toDisplayString(_ctx.t('Well-known ports')) + " (" + _toDisplayString(_ctx.portCount('wellKnown')) + ")", 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_65, _toDisplayString(_ctx.t('High ports')) + " (" + _toDisplayString(_ctx.portCount('high')) + ")", 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_66, _toDisplayString(_ctx.t('Every port')) + " (" + _toDisplayString(_ctx.portCount('all')) + ")", 1 /* TEXT */)
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.opts.portScan]
                            ])
                          ], 8 /* PROPS */, _hoisted_60),
                          _createCommentVNode(" The number that actually decides how long this takes. "),
                          _createElementVNode("label", {
                            title: _ctx.t('How long to wait for a port to answer. A port that refuses is instant whatever this is; the wait only applies to one that says nothing at all, which is what a firewall and a sleeping device both look like. Waiting less is quicker and misses more.')
                          }, [
                            _createElementVNode("span", _hoisted_68, _toDisplayString(_ctx.t('Wait for an answer')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[26] || (_cache[26] = $event => ((_ctx.opts.portWait) = $event))
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.portWaits, (w) => {
                                return (_openBlock(), _createElementBlock("option", {
                                  key: w,
                                  value: w
                                }, _toDisplayString(_ctx.waitLabel(w)), 9 /* TEXT, PROPS */, _hoisted_69))
                              }), 128 /* KEYED_FRAGMENT */))
                            ], 512 /* NEED_PATCH */), [
                              [
                                _vModelSelect,
                                _ctx.opts.portWait,
                                void 0,
                                { number: true }
                              ]
                            ])
                          ], 8 /* PROPS */, _hoisted_67)
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.scan)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_70, [
                          _createElementVNode("div", _hoisted_71, [
                            _createElementVNode("div", {
                              class: "fill",
                              style: _normalizeStyle({width: _ctx.scan.percent + '%'})
                            }, null, 4 /* STYLE */)
                          ]),
                          _createElementVNode("div", _hoisted_72, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.progressText(_ctx.scan)), 1 /* TEXT */),
                            _hoisted_73,
                            _createElementVNode("span", null, _toDisplayString(_ctx.scan.percent) + "%", 1 /* TEXT */)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.advice && !_ctx.advice.ok)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_74, [
                          _createTextVNode(" ⚠ " + _toDisplayString(_ctx.t('This target has {hosts} addresses but the kernel ARP table holds {gc3}. The sweep still works, but the kernel will log overflow warnings. To avoid that, an administrator can run:', { hosts: _ctx.advice.hosts, gc3: _ctx.advice.gc3 })) + " ", 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(_ctx.advice.advice), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (!_ctx.shownDevices.length)
                ? (_openBlock(), _createElementBlock("div", _hoisted_75, _toDisplayString(_ctx.allowed('scan') ? _ctx.t('No devices recorded yet. Start a scan to build the list.') : _ctx.t('No devices have been recorded yet. An administrator has to run a scan first.')), 1 /* TEXT */))
                : (_openBlock(), _createElementBlock("table", _hoisted_76, [
                    _createElementVNode("thead", null, [
                      _createElementVNode("tr", null, [
                        _hoisted_77,
                        _createCommentVNode(" Paired columns, stacked. What belongs to one device reads\n                     as one block instead of a line the eye has to track all\n                     the way across the screen. Both halves still sort. "),
                        _createElementVNode("th", _hoisted_78, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line", _ctx.sortClass('name')]),
                            onClick: _cache[27] || (_cache[27] = $event => (_ctx.sortBy('name')))
                          }, _toDisplayString(_ctx.t('Name')), 3 /* TEXT, CLASS */),
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line", _ctx.sortClass('ip')]),
                            onClick: _cache[28] || (_cache[28] = $event => (_ctx.sortBy('ip')))
                          }, _toDisplayString(_ctx.t('IPv4')), 3 /* TEXT, CLASS */)
                        ]),
                        _createElementVNode("th", _hoisted_79, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line", _ctx.sortClass('mac')]),
                            onClick: _cache[29] || (_cache[29] = $event => (_ctx.sortBy('mac')))
                          }, _toDisplayString(_ctx.t('MAC address')), 3 /* TEXT, CLASS */),
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line", _ctx.sortClass('vendor')]),
                            onClick: _cache[30] || (_cache[30] = $event => (_ctx.sortBy('vendor')))
                          }, _toDisplayString(_ctx.t('Vendor')), 3 /* TEXT, CLASS */)
                        ]),
                        _createElementVNode("th", _hoisted_80, [
                          _createElementVNode("span", {
                            class: _normalizeClass(["th-line", _ctx.sortClass('type')]),
                            onClick: _cache[31] || (_cache[31] = $event => (_ctx.sortBy('type')))
                          }, _toDisplayString(_ctx.t('Type')), 3 /* TEXT, CLASS */),
                          _createElementVNode("span", _hoisted_81, _toDisplayString(_ctx.t('Open ports')), 1 /* TEXT */)
                        ]),
                        _createElementVNode("th", {
                          class: _normalizeClass(["c-extra", _ctx.sortClass('lastSeen')]),
                          onClick: _cache[32] || (_cache[32] = $event => (_ctx.sortBy('lastSeen')))
                        }, _toDisplayString(_ctx.t('Last seen')), 3 /* TEXT, CLASS */)
                      ])
                    ]),
                    _createElementVNode("tbody", null, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.shownDevices, (d) => {
                        return (_openBlock(), _createElementBlock("tr", {
                          key: d.id,
                          onClick: $event => (_ctx.openDevice(d)),
                          onContextmenu: _withModifiers($event => (_ctx.openRowMenu(d, $event)), ["prevent"]),
                          class: _normalizeClass({offline: !d.online})
                        }, [
                          _createElementVNode("td", _hoisted_83, [
                            _createElementVNode("span", {
                              class: _normalizeClass(["dot", {on: d.online}]),
                              title: d.online ? _ctx.t('Online') : _ctx.t('Not seen in the last sweep')
                            }, null, 10 /* CLASS, PROPS */, _hoisted_84)
                          ]),
                          _createElementVNode("td", _hoisted_85, [
                            _createElementVNode("div", _hoisted_86, [
                              _createElementVNode("span", _hoisted_87, _toDisplayString(_ctx.icon(d)), 1 /* TEXT */),
                              _createElementVNode("span", {
                                class: _normalizeClass(["nm", {unnamed: !_ctx.listName(d).named}])
                              }, _toDisplayString(_ctx.listName(d).text), 3 /* TEXT, CLASS */),
                              (_ctx.isSelf(d))
                                ? (_openBlock(), _createElementBlock("span", _hoisted_88, _toDisplayString(_ctx.t('this server')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true),
                              (_ctx.offNetwork(d))
                                ? (_openBlock(), _createElementBlock("span", {
                                    key: 1,
                                    class: "badge away",
                                    title: _ctx.t('It shares this wire but its address belongs to another network, so nothing here can reach it. Give it an address on this network, or give this server one on its own, to open it.')
                                  }, _toDisplayString(_ctx.t('another network')), 9 /* TEXT, PROPS */, _hoisted_89))
                                : _createCommentVNode("v-if", true),
                              (d.label)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_90, _toDisplayString(_ctx.t('named')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]),
                            _createElementVNode("div", _hoisted_91, _toDisplayString(d.ip), 1 /* TEXT */)
                          ]),
                          _createElementVNode("td", _hoisted_92, [
                            _createElementVNode("div", _hoisted_93, _toDisplayString(d.mac || '—'), 1 /* TEXT */),
                            _createElementVNode("div", _hoisted_94, _toDisplayString(_ctx.vendorText(d)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("td", _hoisted_95, [
                            _createElementVNode("div", _hoisted_96, _toDisplayString(_ctx.t(_ctx.typeLabel(d.type))), 1 /* TEXT */),
                            _createElementVNode("div", {
                              class: "pair-b mono dim ports-cell",
                              onClick: _cache[33] || (_cache[33] = _withModifiers(() => {}, ["stop"]))
                            }, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(d.ports, (p, i) => {
                                return (_openBlock(), _createElementBlock(_Fragment, { key: p }, [
                                  (_ctx.portLink(d, p))
                                    ? (_openBlock(), _createElementBlock("a", {
                                        key: 0,
                                        href: "#",
                                        title: _ctx.portLink(d, p).title,
                                        onClick: _withModifiers($event => (_ctx.openDeviceWindow(d, p)), ["prevent"])
                                      }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_97))
                                    : (_ctx.portTool(d, p))
                                      ? (_openBlock(), _createElementBlock("a", {
                                          key: 1,
                                          href: "#",
                                          title: _ctx.portTool(d, p).title,
                                          onClick: _withModifiers($event => (_ctx.openPortTool(d, p)), ["prevent"])
                                        }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_98))
                                      : (_openBlock(), _createElementBlock("span", _hoisted_99, _toDisplayString(p), 1 /* TEXT */)),
                                  (i < d.ports.length - 1)
                                    ? (_openBlock(), _createElementBlock("span", _hoisted_100, ", "))
                                    : _createCommentVNode("v-if", true)
                                ], 64 /* STABLE_FRAGMENT */))
                              }), 128 /* KEYED_FRAGMENT */)),
                              (!d.ports.length)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_101, "—"))
                                : _createCommentVNode("v-if", true)
                            ])
                          ]),
                          _createElementVNode("td", _hoisted_102, _toDisplayString(_ctx.ago(d.lastSeen)), 1 /* TEXT */)
                        ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_82))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ dns ============ "),
        (_ctx.tab==='dns')
          ? (_openBlock(), _createElementBlock("section", _hoisted_103, [
              _createElementVNode("div", _hoisted_104, [
                _createElementVNode("div", _hoisted_105, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsViews, (v) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: v.id,
                      class: _normalizeClass(["seg-btn", {active: _ctx.dnsView===v.id}]),
                      onClick: $event => (_ctx.dnsView=v.id)
                    }, _toDisplayString(_ctx.t(v.label)), 11 /* TEXT, CLASS, PROPS */, _hoisted_106))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.dnsView==='records')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_107, [
                      _createElementVNode("div", _hoisted_108, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[34] || (_cache[34] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[35] || (_cache[35] = _withKeys((...args) => (_ctx.runDns && _ctx.runDns(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_109), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dns,
                          onClick: _cache[36] || (_cache[36] = (...args) => (_ctx.runDns && _ctx.runDns(...args)))
                        }, _toDisplayString(_ctx.t('Look up')), 9 /* TEXT, PROPS */, _hoisted_110)
                      ]),
                      _createElementVNode("div", _hoisted_111, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsTypes, (ty) => {
                          return (_openBlock(), _createElementBlock("label", { key: ty }, [
                            _withDirectives(_createElementVNode("input", {
                              type: "checkbox",
                              value: ty,
                              "onUpdate:modelValue": _cache[37] || (_cache[37] = $event => ((_ctx.dnsWanted) = $event))
                            }, null, 8 /* PROPS */, _hoisted_112), [
                              [_vModelCheckbox, _ctx.dnsWanted]
                            ]),
                            _createTextVNode(" " + _toDisplayString(ty), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_ctx.dnsResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_113, [
                          _createElementVNode("table", _hoisted_114, [
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
                                  _createElementVNode("td", _hoisted_115, _toDisplayString(r.type), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_116, _toDisplayString(r.ttl), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_117, _toDisplayString(r.value), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (!_ctx.dnsResult.records.length)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_118, _toDisplayString(_ctx.t('No records returned.')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.dnsResult.analysis && (_ctx.dnsResult.analysis.spf || _ctx.dnsResult.analysis.dmarc))
                            ? (_openBlock(), _createElementBlock("div", _hoisted_119, [
                                (_ctx.dnsResult.analysis.spf)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_120, [
                                      _hoisted_121,
                                      _createElementVNode("code", null, _toDisplayString(_ctx.dnsResult.analysis.spf), 1 /* TEXT */)
                                    ]))
                                  : _createCommentVNode("v-if", true),
                                (_ctx.dnsResult.analysis.dmarc)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_122, [
                                      _hoisted_123,
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
                    _createElementVNode("div", _hoisted_124, [
                      _createElementVNode("div", _hoisted_125, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[38] || (_cache[38] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[39] || (_cache[39] = _withKeys((...args) => (_ctx.runDnsQuery && _ctx.runDnsQuery(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_126), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[40] || (_cache[40] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_127))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[41] || (_cache[41] = $event => ((_ctx.dnsServer) = $event)),
                          class: "short"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.knownResolvers, (r) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: r.host || 'self',
                              value: r.host
                            }, _toDisplayString(r.host ? r.host + ' — ' + r.label : _ctx.t('This server')), 9 /* TEXT, PROPS */, _hoisted_128))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsServer]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[42] || (_cache[42] = $event => ((_ctx.dnsServer) = $event)),
                          class: "short",
                          placeholder: _ctx.t('Resolver (blank = this server)')
                        }, null, 8 /* PROPS */, _hoisted_129), [
                          [_vModelText, _ctx.dnsServer]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dnsq,
                          onClick: _cache[43] || (_cache[43] = (...args) => (_ctx.runDnsQuery && _ctx.runDnsQuery(...args)))
                        }, _toDisplayString(_ctx.t('Ask')), 9 /* TEXT, PROPS */, _hoisted_130)
                      ]),
                      _createElementVNode("label", _hoisted_131, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[44] || (_cache[44] = $event => ((_ctx.dnsDnssec) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.dnsDnssec]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Ask the resolver to validate DNSSEC')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("p", _hoisted_132, _toDisplayString(_ctx.t('Any record type, from any resolver — NetBase speaks DNS itself instead of going through PHP.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsQueryResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_133, [
                          _createElementVNode("div", _hoisted_134, [
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
                              ? (_openBlock(), _createElementBlock("div", _hoisted_135, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Error')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_136, _toDisplayString(_ctx.dnsQueryResult.error), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]),
                          (_ctx.dnsQueryResult.answers.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_137, [
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
                                      _createElementVNode("td", _hoisted_138, _toDisplayString(r.name), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_139, _toDisplayString(r.type), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_140, _toDisplayString(r.ttl), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_141, _toDisplayString(r.value), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : (_openBlock(), _createElementBlock("p", _hoisted_142, _toDisplayString(_ctx.t('No records returned.')), 1 /* TEXT */)),
                          (_ctx.dnsQueryResult.authority.length)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_143, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Authority section')), 1 /* TEXT */),
                                _createElementVNode("table", _hoisted_144, [
                                  _createElementVNode("tbody", null, [
                                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsQueryResult.authority, (r, i) => {
                                      return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                        _createElementVNode("td", _hoisted_145, _toDisplayString(r.name), 1 /* TEXT */),
                                        _createElementVNode("td", _hoisted_146, _toDisplayString(r.type), 1 /* TEXT */),
                                        _createElementVNode("td", _hoisted_147, _toDisplayString(r.value), 1 /* TEXT */)
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
                    _createElementVNode("div", _hoisted_148, [
                      _createElementVNode("div", _hoisted_149, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[45] || (_cache[45] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[46] || (_cache[46] = _withKeys((...args) => (_ctx.runDnsCompare && _ctx.runDnsCompare(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_150), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[47] || (_cache[47] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_151))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dnsc,
                          onClick: _cache[48] || (_cache[48] = (...args) => (_ctx.runDnsCompare && _ctx.runDnsCompare(...args)))
                        }, _toDisplayString(_ctx.t('Compare resolvers')), 9 /* TEXT, PROPS */, _hoisted_152)
                      ]),
                      _createElementVNode("p", _hoisted_153, _toDisplayString(_ctx.t('Asks this server and the large public resolvers the same question, so you can see whether a change has spread yet.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsCompareResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_154, [
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
                          _createElementVNode("table", _hoisted_155, [
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
                                    _createElementVNode("span", _hoisted_156, _toDisplayString(r.server), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", _hoisted_157, _toDisplayString(r.ms) + " ms", 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_158, _toDisplayString(r.status), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_159, [
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
                    _createElementVNode("div", _hoisted_160, [
                      _createElementVNode("div", _hoisted_161, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[49] || (_cache[49] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[50] || (_cache[50] = _withKeys((...args) => (_ctx.runDnsTrace && _ctx.runDnsTrace(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_162), [
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
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_163))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dnst,
                          onClick: _cache[52] || (_cache[52] = (...args) => (_ctx.runDnsTrace && _ctx.runDnsTrace(...args)))
                        }, _toDisplayString(_ctx.t('Trace from the root')), 9 /* TEXT, PROPS */, _hoisted_164)
                      ]),
                      _createElementVNode("p", _hoisted_165, _toDisplayString(_ctx.t('Follows the delegation the way a resolver does, so a broken hand-off between zones is visible.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsTraceResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_166, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsTraceResult.steps, (s, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: "trace-step"
                            }, [
                              _createElementVNode("div", _hoisted_167, [
                                _createElementVNode("span", _hoisted_168, _toDisplayString(i + 1), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("strong", _hoisted_169, _toDisplayString(s.serverName), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("span", _hoisted_170, _toDisplayString(s.server), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("span", _hoisted_171, _toDisplayString(s.ms) + " ms · " + _toDisplayString(s.status), 1 /* TEXT */)
                              ]),
                              (s.answers.length)
                                ? (_openBlock(), _createElementBlock("div", _hoisted_172, "→ " + _toDisplayString(s.answers.map(a => a.type + ' ' + a.value).join(', ')), 1 /* TEXT */))
                                : (_openBlock(), _createElementBlock("div", _hoisted_173, _toDisplayString(_ctx.t('delegates to')) + " " + _toDisplayString(s.authority.filter(a => a.type === 'NS').map(a => a.value).join(', ') || '—'), 1 /* TEXT */))
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.dnsView==='axfr')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                    _createElementVNode("div", _hoisted_174, [
                      _createElementVNode("div", _hoisted_175, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[53] || (_cache[53] = $event => ((_ctx.axfrZone) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[54] || (_cache[54] = _withKeys((...args) => (_ctx.runAxfr && _ctx.runAxfr(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_176), [
                          [_vModelText, _ctx.axfrZone]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[55] || (_cache[55] = $event => ((_ctx.axfrServer) = $event)),
                          class: "short",
                          placeholder: _ctx.t('Name server (blank = all of them)')
                        }, null, 8 /* PROPS */, _hoisted_177), [
                          [_vModelText, _ctx.axfrServer]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.axfr,
                          onClick: _cache[56] || (_cache[56] = (...args) => (_ctx.runAxfr && _ctx.runAxfr(...args)))
                        }, _toDisplayString(_ctx.t('Test zone transfer')), 9 /* TEXT, PROPS */, _hoisted_178)
                      ]),
                      _createElementVNode("p", _hoisted_179, _toDisplayString(_ctx.t('A name server that hands its whole zone to a stranger gives away every host name it knows. This checks whether yours refuses.')), 1 /* TEXT */)
                    ]),
                    (_ctx.axfrResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_180, [
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
                          _createElementVNode("table", _hoisted_181, [
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
                                  _createElementVNode("td", _hoisted_182, [
                                    _createTextVNode(_toDisplayString(r.server) + " ", 1 /* TEXT */),
                                    _createElementVNode("span", _hoisted_183, _toDisplayString(r.address), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", r.allowed ? 'bad' : 'ok'])
                                    }, _toDisplayString(r.allowed ? _ctx.t('transfer allowed') : _ctx.t('refused')), 3 /* TEXT, CLASS */),
                                    _createTextVNode(),
                                    _createElementVNode("span", _hoisted_184, _toDisplayString(r.error || ''), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", _hoisted_185, _toDisplayString(r.records || ''), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.axfrResult.results, (r, i) => {
                            return (_openBlock(), _createElementBlock(_Fragment, {
                              key: 's'+i
                            }, [
                              (r.sample && r.sample.length)
                                ? (_openBlock(), _createElementBlock("details", _hoisted_186, [
                                    _createElementVNode("summary", null, _toDisplayString(r.server), 1 /* TEXT */),
                                    _createElementVNode("pre", _hoisted_187, _toDisplayString(r.sample.join('\n')), 1 /* TEXT */)
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_188, [
              _createElementVNode("div", _hoisted_189, [
                _createElementVNode("div", _hoisted_190, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[57] || (_cache[57] = $event => ((_ctx.whoisQuery) = $event)),
                    placeholder: _ctx.t('Domain name or IP address'),
                    onKeyup: _cache[58] || (_cache[58] = _withKeys((...args) => (_ctx.runWhois && _ctx.runWhois(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_191), [
                    [_vModelText, _ctx.whoisQuery]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.whois,
                    onClick: _cache[59] || (_cache[59] = (...args) => (_ctx.runWhois && _ctx.runWhois(...args)))
                  }, _toDisplayString(_ctx.t('Look up')), 9 /* TEXT, PROPS */, _hoisted_192)
                ])
              ]),
              (_ctx.whoisResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_193, [
                    (Object.keys(_ctx.whoisResult.fields).length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_194, [
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
                        _createElementVNode("pre", _hoisted_196, _toDisplayString(hop.response), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_195))
                    }), 128 /* KEYED_FRAGMENT */))
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ tls / http ============ "),
        (_ctx.tab==='tls')
          ? (_openBlock(), _createElementBlock("section", _hoisted_197, [
              _createElementVNode("div", _hoisted_198, [
                _createElementVNode("div", _hoisted_199, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[60] || (_cache[60] = $event => ((_ctx.tlsHost) = $event)),
                    placeholder: _ctx.t('example.com'),
                    onKeyup: _cache[61] || (_cache[61] = _withKeys((...args) => (_ctx.runTls && _ctx.runTls(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_200), [
                    [_vModelText, _ctx.tlsHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[62] || (_cache[62] = $event => ((_ctx.tlsPort) = $event)),
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
                    class: "btn primary",
                    disabled: _ctx.busy.tls,
                    onClick: _cache[63] || (_cache[63] = (...args) => (_ctx.runTls && _ctx.runTls(...args)))
                  }, _toDisplayString(_ctx.t('Inspect certificate')), 9 /* TEXT, PROPS */, _hoisted_201),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.http,
                    onClick: _cache[64] || (_cache[64] = (...args) => (_ctx.runHttp && _ctx.runHttp(...args)))
                  }, _toDisplayString(_ctx.t('HTTP headers')), 9 /* TEXT, PROPS */, _hoisted_202),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.tlsver,
                    onClick: _cache[65] || (_cache[65] = (...args) => (_ctx.runTlsVersions && _ctx.runTlsVersions(...args)))
                  }, _toDisplayString(_ctx.t('Which TLS versions?')), 9 /* TEXT, PROPS */, _hoisted_203)
                ])
              ]),
              (_ctx.tlsVersionsResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_204, [
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
                    _createElementVNode("table", _hoisted_205, [
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
                            _createElementVNode("td", _hoisted_206, _toDisplayString(name), 1 /* TEXT */),
                            _createElementVNode("td", null, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", v.supported ? (name === 'TLSv1.0' || name === 'TLSv1.1' ? 'warn' : 'ok') : 'no'])
                              }, _toDisplayString(v.supported ? _ctx.t('yes') : _ctx.t('no')), 3 /* TEXT, CLASS */)
                            ]),
                            _createElementVNode("td", _hoisted_207, _toDisplayString(v.cipher || ''), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.tlsResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_208, [
                    (!_ctx.tlsResult.ok)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_209, "⚠ " + _toDisplayString(_ctx.tlsResult.error), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_210, [
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
                            ? (_openBlock(), _createElementBlock("div", _hoisted_211, [
                                _createElementVNode("span", null, _toDisplayString(_ctx.t('Names')), 1 /* TEXT */),
                                _createElementVNode("code", _hoisted_212, _toDisplayString(_ctx.tlsResult.sans.join(', ')), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.httpResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_213, [
                    _createElementVNode("table", _hoisted_214, [
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
                            _createElementVNode("td", _hoisted_215, _toDisplayString(h.url), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_216, _toDisplayString(h.status), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_217, _toDisplayString(h.ms) + " ms", 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_218, _toDisplayString(h.server), 1 /* TEXT */)
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
                    _createElementVNode("div", _hoisted_219, [
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_220, [
              _createElementVNode("div", _hoisted_221, [
                _createElementVNode("div", _hoisted_222, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Live throughput')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[66] || (_cache[66] = $event => ((_ctx.liveIface) = $event)),
                    class: "narrow"
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.liveIfaces, (i) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: i,
                        value: i
                      }, _toDisplayString(i), 9 /* TEXT, PROPS */, _hoisted_223))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.liveIface]
                  ]),
                  _hoisted_224,
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn sm", {active: _ctx.liveOn}]),
                    onClick: _cache[67] || (_cache[67] = (...args) => (_ctx.toggleLive && _ctx.toggleLive(...args)))
                  }, _toDisplayString(_ctx.liveOn ? _ctx.t('Stop') : _ctx.t('Start')), 3 /* TEXT, CLASS */)
                ]),
                (_ctx.liveIface)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_225, [
                      _createElementVNode("div", _hoisted_226, [
                        _createElementVNode("span", _hoisted_227, "↓ " + _toDisplayString(_ctx.t('Receive')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_228, _toDisplayString(_ctx.fmtRate(_ctx.liveNow.rx)), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", _hoisted_229, [
                        _createElementVNode("span", _hoisted_230, "↑ " + _toDisplayString(_ctx.t('Send')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_231, _toDisplayString(_ctx.fmtRate(_ctx.liveNow.tx)), 1 /* TEXT */)
                      ]),
                      (_openBlock(), _createElementBlock("svg", _hoisted_232, [
                        _createElementVNode("polyline", {
                          class: "sp-rx",
                          points: _ctx.spark(_ctx.liveRx)
                        }, null, 8 /* PROPS */, _hoisted_233),
                        _createElementVNode("polyline", {
                          class: "sp-tx",
                          points: _ctx.spark(_ctx.liveTx)
                        }, null, 8 /* PROPS */, _hoisted_234)
                      ]))
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("p", _hoisted_235, [
                  _createTextVNode(_toDisplayString(_ctx.t('Read straight from the kernel counters, so it costs nothing and needs no extra software.')) + " ", 1 /* TEXT */),
                  (_ctx.liveErrors)
                    ? (_openBlock(), _createElementBlock("span", _hoisted_236, " ⚠ " + _toDisplayString(_ctx.t('{n} interface errors / drops recorded since boot', {n: _ctx.liveErrors})), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true)
                ])
              ]),
              _createElementVNode("div", _hoisted_237, [
                _createElementVNode("div", _hoisted_238, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Internet speed test')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[68] || (_cache[68] = $event => ((_ctx.speedSize) = $event)),
                    class: "narrow"
                  }, _hoisted_243, 512 /* NEED_PATCH */), [
                    [
                      _vModelSelect,
                      _ctx.speedSize,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("label", _hoisted_244, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[69] || (_cache[69] = $event => ((_ctx.speedUpload) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.speedUpload]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Also test upload')), 1 /* TEXT */)
                  ]),
                  _hoisted_245,
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.speed,
                    onClick: _cache[70] || (_cache[70] = (...args) => (_ctx.runSpeed && _ctx.runSpeed(...args)))
                  }, _toDisplayString(_ctx.busy.speed ? _ctx.t('Measuring…') : _ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_246)
                ]),
                _createElementVNode("p", _hoisted_247, _toDisplayString(_ctx.t('Traffic is exchanged with {host}. Nothing but the test payload is sent.', {host: _ctx.speedEndpoint})), 1 /* TEXT */),
                (_ctx.speedResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_248, [
                      _createElementVNode("div", _hoisted_249, [
                        _createElementVNode("span", _hoisted_250, "↓ " + _toDisplayString(_ctx.t('Download')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_251, _toDisplayString(_ctx.speedResult.download ? _ctx.speedResult.download.mbps : '—'), 1 /* TEXT */),
                        _hoisted_252
                      ]),
                      _createElementVNode("div", _hoisted_253, [
                        _createElementVNode("span", _hoisted_254, "↑ " + _toDisplayString(_ctx.t('Upload')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_255, _toDisplayString(_ctx.speedResult.upload ? _ctx.speedResult.upload.mbps : '—'), 1 /* TEXT */),
                        _hoisted_256
                      ]),
                      _createElementVNode("div", _hoisted_257, [
                        _createElementVNode("span", _hoisted_258, _toDisplayString(_ctx.t('Latency')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_259, _toDisplayString(_ctx.speedResult.latency ? _ctx.speedResult.latency.avg : '—'), 1 /* TEXT */),
                        _hoisted_260
                      ]),
                      _createElementVNode("div", _hoisted_261, [
                        _createElementVNode("span", _hoisted_262, _toDisplayString(_ctx.t('Jitter')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_263, _toDisplayString(_ctx.speedResult.latency && _ctx.speedResult.latency.jitter != null ? _ctx.speedResult.latency.jitter : '—'), 1 /* TEXT */),
                        _hoisted_264
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.speedResult && (_ctx.speedResult.downloadError || _ctx.speedResult.uploadError))
                  ? (_openBlock(), _createElementBlock("p", _hoisted_265, "⚠ " + _toDisplayString(_ctx.speedResult.downloadError || _ctx.speedResult.uploadError), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_266, [
                _createElementVNode("div", _hoisted_267, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('LAN throughput (iperf3)')), 1 /* TEXT */)
                ]),
                (_ctx.hasTool('iperf3'))
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("div", _hoisted_268, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[71] || (_cache[71] = $event => ((_ctx.iperfHost) = $event)),
                          placeholder: _ctx.t('Address of a machine running: iperf3 -s'),
                          onKeyup: _cache[72] || (_cache[72] = _withKeys((...args) => (_ctx.runIperf && _ctx.runIperf(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_269), [
                          [_vModelText, _ctx.iperfHost]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[73] || (_cache[73] = $event => ((_ctx.iperfPort) = $event)),
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
                          "onUpdate:modelValue": _cache[74] || (_cache[74] = $event => ((_ctx.iperfSeconds) = $event)),
                          class: "tiny"
                        }, _hoisted_273, 512 /* NEED_PATCH */), [
                          [
                            _vModelSelect,
                            _ctx.iperfSeconds,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("label", _hoisted_274, [
                          _withDirectives(_createElementVNode("input", {
                            type: "checkbox",
                            "onUpdate:modelValue": _cache[75] || (_cache[75] = $event => ((_ctx.iperfReverse) = $event))
                          }, null, 512 /* NEED_PATCH */), [
                            [_vModelCheckbox, _ctx.iperfReverse]
                          ]),
                          _createTextVNode(" " + _toDisplayString(_ctx.t('Reverse')), 1 /* TEXT */)
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.iperf,
                          onClick: _cache[76] || (_cache[76] = (...args) => (_ctx.runIperf && _ctx.runIperf(...args)))
                        }, _toDisplayString(_ctx.busy.iperf ? _ctx.t('Measuring…') : _ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_275)
                      ]),
                      (_ctx.iperfResult && !_ctx.iperfResult.error)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_276, [
                            _createElementVNode("div", _hoisted_277, [
                              _createElementVNode("span", _hoisted_278, _toDisplayString(_ctx.t('Sent')), 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_279, _toDisplayString(_ctx.iperfResult.sentMbps), 1 /* TEXT */),
                              _hoisted_280
                            ]),
                            _createElementVNode("div", _hoisted_281, [
                              _createElementVNode("span", _hoisted_282, _toDisplayString(_ctx.t('Received')), 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_283, _toDisplayString(_ctx.iperfResult.receivedMbps), 1 /* TEXT */),
                              _hoisted_284
                            ]),
                            (_ctx.iperfResult.retransmits != null)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_285, [
                                  _createElementVNode("span", _hoisted_286, _toDisplayString(_ctx.t('Retransmits')), 1 /* TEXT */),
                                  _createElementVNode("span", _hoisted_287, _toDisplayString(_ctx.iperfResult.retransmits), 1 /* TEXT */),
                                  _hoisted_288
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.iperfResult && _ctx.iperfResult.intervals && _ctx.iperfResult.intervals.length)
                        ? (_openBlock(), _createElementBlock("svg", _hoisted_289, [
                            _createElementVNode("polyline", {
                              class: "sp-rx",
                              points: _ctx.spark(_ctx.iperfResult.intervals.map(i => i.mbps))
                            }, null, 8 /* PROPS */, _hoisted_290)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.iperfResult && _ctx.iperfResult.error)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_291, "⚠ " + _toDisplayString(_ctx.iperfResult.error), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_openBlock(), _createElementBlock("div", _hoisted_292, [
                      _createElementVNode("p", null, _toDisplayString(_ctx.t('An internet speed test measures the internet. To measure the local link you need iperf3 on this server and on one other machine.')), 1 /* TEXT */),
                      _createElementVNode("pre", _hoisted_293, _toDisplayString(_ctx.installFor('iperf3')), 1 /* TEXT */)
                    ]))
              ]),
              _createElementVNode("div", _hoisted_294, [
                _createElementVNode("div", _hoisted_295, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('DNS resolver comparison')), 1 /* TEXT */),
                  _hoisted_296,
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.dnsbench,
                    onClick: _cache[77] || (_cache[77] = (...args) => (_ctx.runDnsBench && _ctx.runDnsBench(...args)))
                  }, _toDisplayString(_ctx.busy.dnsbench ? _ctx.t('Measuring…') : _ctx.t('Compare')), 9 /* TEXT, PROPS */, _hoisted_297)
                ]),
                _createElementVNode("p", _hoisted_298, _toDisplayString(_ctx.t('Each resolver is asked for the same names, and the times are compared. The resolver this server uses is included.')), 1 /* TEXT */),
                (_ctx.dnsBench)
                  ? (_openBlock(), _createElementBlock("table", _hoisted_299, [
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
                            _createElementVNode("td", _hoisted_300, [
                              _createTextVNode(_toDisplayString(r.resolver) + " ", 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_301, _toDisplayString(_ctx.t(r.name)), 1 /* TEXT */),
                              _createTextVNode(),
                              (r.resolver===_ctx.dnsBench.fastest)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_302, _toDisplayString(_ctx.t('fastest')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]),
                            _createElementVNode("td", _hoisted_303, _toDisplayString(r.median != null ? r.median + ' ms' : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_304, _toDisplayString(r.avg != null ? r.avg + ' ms' : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_305, _toDisplayString(r.jitter != null ? r.jitter : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_306, _toDisplayString(r.answered) + " / " + _toDisplayString(r.queries), 1 /* TEXT */)
                          ], 2 /* CLASS */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_307, [
                _createElementVNode("div", _hoisted_308, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Where the time goes')), 1 /* TEXT */)
                ]),
                _createElementVNode("div", _hoisted_309, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[78] || (_cache[78] = $event => ((_ctx.timingUrl) = $event)),
                    placeholder: "https://example.com",
                    onKeyup: _cache[79] || (_cache[79] = _withKeys((...args) => (_ctx.runTiming && _ctx.runTiming(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.timingUrl]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.timing,
                    onClick: _cache[80] || (_cache[80] = (...args) => (_ctx.runTiming && _ctx.runTiming(...args)))
                  }, _toDisplayString(_ctx.t('Measure')), 9 /* TEXT, PROPS */, _hoisted_310)
                ]),
                (_ctx.timingResult)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("div", _hoisted_311, [
                        _createElementVNode("div", null, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t('Status')), 1 /* TEXT */),
                          _createElementVNode("code", null, [
                            _createTextVNode(_toDisplayString(_ctx.timingResult.status), 1 /* TEXT */),
                            (_ctx.timingResult.location)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_312, " → " + _toDisplayString(_ctx.timingResult.location), 1 /* TEXT */))
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
                      _createElementVNode("div", _hoisted_313, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.timingResult.phases, (p) => {
                          return (_openBlock(), _createElementBlock("div", {
                            key: p.name,
                            class: "wf-row"
                          }, [
                            _createElementVNode("span", _hoisted_314, _toDisplayString(_ctx.t(p.name)), 1 /* TEXT */),
                            _createElementVNode("span", _hoisted_315, [
                              _createElementVNode("span", {
                                style: _normalizeStyle({width: _ctx.barWidth(p.ms, _ctx.timingResult.total)})
                              }, null, 4 /* STYLE */)
                            ]),
                            _createElementVNode("span", _hoisted_316, _toDisplayString(p.ms) + " ms", 1 /* TEXT */)
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_317, [
              _createElementVNode("div", _hoisted_318, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('What does this network cover?')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_319, _toDisplayString(_ctx.t('An address and a prefix in, and out come the network and broadcast addresses, the usable range, and how many hosts fit.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_320, [
                  _createElementVNode("select", {
                    class: "pick",
                    title: _ctx.t('Pick one NetBase already knows'),
                    onChange: _cache[81] || (_cache[81] = $event => (_ctx.pickIntoAddress('calcAddress', $event)))
                  }, [
                    _createElementVNode("option", _hoisted_322, _toDisplayString(_ctx.t('Choose…')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.networkChoices, (g) => {
                      return (_openBlock(), _createElementBlock("optgroup", {
                        key: g.label,
                        label: _ctx.t(g.label)
                      }, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(g.items, (o) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: o.value,
                            value: o.value
                          }, _toDisplayString(o.text), 9 /* TEXT, PROPS */, _hoisted_324))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 8 /* PROPS */, _hoisted_323))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_321),
                  (!_ctx.subnetFreeText)
                    ? (_openBlock(), _createElementBlock("span", _hoisted_325, [
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
                              onPaste: _cache[82] || (_cache[82] = $event => (_ctx.pasteAddress(_ctx.calcAddress, $event))),
                              onFocus: _cache[83] || (_cache[83] = $event => ($event.target.select()))
                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_326),
                            (i < 3)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_327, "."))
                              : _createCommentVNode("v-if", true)
                          ], 64 /* STABLE_FRAGMENT */))
                        }), 128 /* KEYED_FRAGMENT */)),
                        _hoisted_328,
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[84] || (_cache[84] = $event => ((_ctx.calcAddress.prefix) = $event)),
                          class: "ip-prefix",
                          "aria-label": _ctx.t('Prefix')
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.prefixes, (p) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: p,
                              value: p
                            }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_330))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 8 /* PROPS */, _hoisted_329), [
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
                        "onUpdate:modelValue": _cache[85] || (_cache[85] = $event => ((_ctx.subnetInput) = $event)),
                        placeholder: "2001:db8::1/64",
                        onKeyup: _cache[86] || (_cache[86] = _withKeys((...args) => (_ctx.runSubnet && _ctx.runSubnet(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */)), [
                        [_vModelText, _ctx.subnetInput]
                      ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    onClick: _cache[87] || (_cache[87] = (...args) => (_ctx.runSubnet && _ctx.runSubnet(...args)))
                  }, _toDisplayString(_ctx.t('Calculate')), 1 /* TEXT */)
                ]),
                _createElementVNode("label", _hoisted_331, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[88] || (_cache[88] = $event => ((_ctx.subnetFreeText) = $event))
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.subnetFreeText]
                  ]),
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Type it myself (IPv6, or a mask like 255.255.255.0)')), 1 /* TEXT */)
                ])
              ]),
              (_ctx.subnetResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_332, [
                    _createElementVNode("div", _hoisted_333, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.subnetResult, (v, k) => {
                        return (_openBlock(), _createElementBlock("div", { key: k }, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.fieldLabel(k))), 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(v), 1 /* TEXT */)
                        ]))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_334, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Split into smaller networks')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_335, _toDisplayString(_ctx.t('One network in, and the equal parts it divides into — with the range and host count of each.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_336, [
                  _createElementVNode("span", _hoisted_337, [
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
                          onPaste: _cache[89] || (_cache[89] = $event => (_ctx.pasteAddress(_ctx.splitAddress, $event))),
                          onFocus: _cache[90] || (_cache[90] = $event => ($event.target.select()))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_338),
                        (i < 3)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_339, "."))
                          : _createCommentVNode("v-if", true)
                      ], 64 /* STABLE_FRAGMENT */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    _hoisted_340,
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[91] || (_cache[91] = $event => ((_ctx.splitAddress.prefix) = $event)),
                      class: "ip-prefix",
                      "aria-label": _ctx.t('Prefix')
                    }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.prefixes, (p) => {
                        return (_openBlock(), _createElementBlock("option", {
                          key: p,
                          value: p
                        }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_342))
                      }), 128 /* KEYED_FRAGMENT */))
                    ], 8 /* PROPS */, _hoisted_341), [
                      [
                        _vModelSelect,
                        _ctx.splitAddress.prefix,
                        void 0,
                        { number: true }
                      ]
                    ])
                  ]),
                  _createElementVNode("span", _hoisted_343, _toDisplayString(_ctx.t('into')), 1 /* TEXT */),
                  _hoisted_344,
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[92] || (_cache[92] = $event => ((_ctx.splitPrefix) = $event)),
                    class: "ip-prefix",
                    "aria-label": _ctx.t('Into networks of')
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.splitPrefixes, (p) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: p,
                        value: p
                      }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_346))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 8 /* PROPS */, _hoisted_345), [
                    [
                      _vModelSelect,
                      _ctx.splitPrefix,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.split,
                    onClick: _cache[93] || (_cache[93] = (...args) => (_ctx.runSplit && _ctx.runSplit(...args)))
                  }, _toDisplayString(_ctx.t('Split')), 9 /* TEXT, PROPS */, _hoisted_347)
                ]),
                (_ctx.splitResult)
                  ? (_openBlock(), _createElementBlock("table", _hoisted_348, [
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
                            _createElementVNode("td", _hoisted_349, _toDisplayString(n.cidr), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_350, _toDisplayString(n.firstHost), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_351, _toDisplayString(n.lastHost), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_352, _toDisplayString(n.broadcast), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_353, _toDisplayString(n.hosts), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_354, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Combine addresses into the fewest networks')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_355, _toDisplayString(_ctx.t('Add a row for each network you have. NetBase works out the smallest set of blocks that covers them all — the shortest firewall rule that still means the same thing.')), 1 /* TEXT */),
                (!_ctx.aggregateFreeText)
                  ? (_openBlock(true), _createElementBlock(_Fragment, { key: 0 }, _renderList(_ctx.ipRows, (row, r) => {
                      return (_openBlock(), _createElementBlock("div", {
                        class: "ip-row",
                        key: r
                      }, [
                        _createElementVNode("span", _hoisted_356, [
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
                                onFocus: _cache[94] || (_cache[94] = $event => ($event.target.select()))
                              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_357),
                              (i < 3)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_358, "."))
                                : _createCommentVNode("v-if", true)
                            ], 64 /* STABLE_FRAGMENT */))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _hoisted_359,
                          _withDirectives(_createElementVNode("select", {
                            "onUpdate:modelValue": $event => ((row.prefix) = $event),
                            class: "ip-prefix",
                            "aria-label": _ctx.t('Prefix')
                          }, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.prefixes, (p) => {
                              return (_openBlock(), _createElementBlock("option", {
                                key: p,
                                value: p
                              }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_361))
                            }), 128 /* KEYED_FRAGMENT */))
                          ], 8 /* PROPS */, _hoisted_360), [
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
                        }, "＋", 8 /* PROPS */, _hoisted_362),
                        _createElementVNode("button", {
                          class: "btn xs",
                          disabled: _ctx.ipRows.length < 2,
                          title: _ctx.t('Remove this row'),
                          onClick: $event => (_ctx.removeIpRow(r))
                        }, "−", 8 /* PROPS */, _hoisted_363)
                      ]))
                    }), 128 /* KEYED_FRAGMENT */))
                  : _withDirectives((_openBlock(), _createElementBlock("textarea", {
                      key: 1,
                      "onUpdate:modelValue": _cache[95] || (_cache[95] = $event => ((_ctx.aggregateInput) = $event)),
                      rows: "3",
                      class: "mono tiny",
                      placeholder: _ctx.t('192.168.1.0/24, 10.0.0.5, 10.0.0.8-10.0.0.20, 2001:db8::/48')
                    }, null, 8 /* PROPS */, _hoisted_364)), [
                      [_vModelText, _ctx.aggregateInput]
                    ]),
                _createElementVNode("div", _hoisted_365, [
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.aggregate,
                    onClick: _cache[96] || (_cache[96] = (...args) => (_ctx.runAggregate && _ctx.runAggregate(...args)))
                  }, _toDisplayString(_ctx.t('Combine')), 9 /* TEXT, PROPS */, _hoisted_366),
                  _createElementVNode("label", _hoisted_367, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[97] || (_cache[97] = $event => ((_ctx.aggregateFreeText) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.aggregateFreeText]
                    ]),
                    _createElementVNode("span", null, _toDisplayString(_ctx.t('Type them myself (ranges, IPv6)')), 1 /* TEXT */)
                  ])
                ]),
                (_ctx.aggregateResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_368, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Blocks')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_369, _toDisplayString(_ctx.aggregateResult.blocks.join(', ')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Ranges')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_370, _toDisplayString(_ctx.aggregateResult.ranges.join(', ')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Addresses covered')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.aggregateResult.addresses), 1 /* TEXT */)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_371, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Whose equipment is this?')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_372, _toDisplayString(_ctx.t('The first half of a MAC address says who made the device. NetBase looks it up in the bundled IEEE registry, so nothing leaves this server.')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_373, _toDisplayString(_ctx.t('Colons and hyphens are optional; six hex digits are enough.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_374, [
                  _createCommentVNode(" One box, taken as it comes: written with colons, with hyphens,\n                   in fours, or as bare hex. Six hex digits name the vendor, so\n                   the lookup happens as soon as that many have been typed. "),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[98] || (_cache[98] = $event => ((_ctx.macInput) = $event)),
                    class: "mac-input",
                    placeholder: "84:af:ec:85:7a:e0",
                    inputmode: "text",
                    spellcheck: "false",
                    autocomplete: "off",
                    "aria-label": _ctx.t('MAC address'),
                    onKeyup: _cache[99] || (_cache[99] = _withKeys((...args) => (_ctx.runMac && _ctx.runMac(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_375), [
                    [_vModelText, _ctx.macInput]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: !_ctx.macReady,
                    onClick: _cache[100] || (_cache[100] = (...args) => (_ctx.runMac && _ctx.runMac(...args)))
                  }, _toDisplayString(_ctx.t('Identify vendor')), 9 /* TEXT, PROPS */, _hoisted_376)
                ]),
                (_ctx.macResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_377, [
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_378, [
              _createElementVNode("div", _hoisted_379, [
                _createElementVNode("div", _hoisted_380, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailViews, (v) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: v.id,
                      class: _normalizeClass(["seg-btn", {active: _ctx.mailView===v.id}]),
                      onClick: $event => (_ctx.mailView=v.id)
                    }, _toDisplayString(_ctx.t(v.label)), 11 /* TEXT, CLASS, PROPS */, _hoisted_381))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.mailView==='domain')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_382, [
                      _createElementVNode("div", _hoisted_383, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[101] || (_cache[101] = $event => ((_ctx.mailDomain) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[102] || (_cache[102] = _withKeys((...args) => (_ctx.runMailAudit && _ctx.runMailAudit(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_384), [
                          [_vModelText, _ctx.mailDomain]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[103] || (_cache[103] = $event => ((_ctx.mailSelectors) = $event)),
                          class: "short",
                          placeholder: _ctx.t('DKIM selectors, comma separated')
                        }, null, 8 /* PROPS */, _hoisted_385), [
                          [_vModelText, _ctx.mailSelectors]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.mailAudit,
                          onClick: _cache[104] || (_cache[104] = (...args) => (_ctx.runMailAudit && _ctx.runMailAudit(...args)))
                        }, _toDisplayString(_ctx.busy.mailAudit ? _ctx.t('Checking…') : _ctx.t('Check this domain')), 9 /* TEXT, PROPS */, _hoisted_386)
                      ]),
                      _createElementVNode("label", _hoisted_387, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[105] || (_cache[105] = $event => ((_ctx.mailBlocklists) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.mailBlocklists]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Also ask the public blocklists about each MX address')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("p", _hoisted_388, _toDisplayString(_ctx.t('Reads only public DNS and, for MTA-STS, one HTTPS file. Nothing is sent to your servers.')), 1 /* TEXT */)
                    ]),
                    (_ctx.mailAudit)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_389, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('What this domain looks like to a receiving mail server')), 1 /* TEXT */),
                          _createElementVNode("div", _hoisted_390, [
                            (_ctx.mailAudit.score.bad)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_391, _toDisplayString(_ctx.mailAudit.score.bad) + " " + _toDisplayString(_ctx.t('to fix')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAudit.score.warn)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_392, _toDisplayString(_ctx.mailAudit.score.warn) + " " + _toDisplayString(_ctx.t('to look at')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAudit.score.ok)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_393, _toDisplayString(_ctx.mailAudit.score.ok) + " " + _toDisplayString(_ctx.t('fine')), 1 /* TEXT */))
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
                      ? (_openBlock(), _createElementBlock("div", _hoisted_394, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Mail exchangers')), 1 /* TEXT */),
                          _createElementVNode("table", _hoisted_395, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Priority')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Address')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Reverse name')), 1 /* TEXT */),
                                _hoisted_396
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
                                      _createElementVNode("td", _hoisted_397, _toDisplayString(j === 0 ? m.priority : ''), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_398, _toDisplayString(j === 0 ? m.host : ''), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_399, _toDisplayString(a.ip || '—'), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_400, [
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
                      ? (_openBlock(), _createElementBlock("div", _hoisted_401, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Published policies')), 1 /* TEXT */),
                          _createElementVNode("div", _hoisted_402, [
                            _createElementVNode("div", null, [
                              _hoisted_403,
                              _createElementVNode("code", _hoisted_404, _toDisplayString(_ctx.mailAudit.spf ? _ctx.mailAudit.spf.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            (_ctx.mailAudit.spf)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_405, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('SPF lookups')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.mailAudit.spf.lookups) + " / 10", 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("div", null, [
                              _hoisted_406,
                              _createElementVNode("code", _hoisted_407, _toDisplayString(_ctx.mailAudit.dmarc ? _ctx.mailAudit.dmarc.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_408,
                              _createElementVNode("code", _hoisted_409, _toDisplayString(_ctx.mailAudit.mtaSts ? _ctx.mailAudit.mtaSts.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_410,
                              _createElementVNode("code", _hoisted_411, _toDisplayString(_ctx.mailAudit.tlsRpt || _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_412,
                              _createElementVNode("code", _hoisted_413, _toDisplayString(_ctx.mailAudit.bimi || _ctx.t('not published')), 1 /* TEXT */)
                            ])
                          ]),
                          (_ctx.mailAudit.mtaSts && _ctx.mailAudit.mtaSts.policy)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_414, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('MTA-STS policy file')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_415, _toDisplayString(_ctx.mailAudit.mtaSts.policy), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.dkim.length)
                            ? (_openBlock(), _createElementBlock("h3", _hoisted_416, _toDisplayString(_ctx.t('DKIM keys')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.dkim.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_417, [
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
                                      _createElementVNode("td", _hoisted_418, _toDisplayString(k.selector), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_419, _toDisplayString(k.bits ? k.bits + ' bit' : '—'), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_420, _toDisplayString(k.record), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.srv.length)
                            ? (_openBlock(), _createElementBlock("h3", _hoisted_421, _toDisplayString(_ctx.t('Client autoconfiguration records')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.srv.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_422, [
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
                                      _createElementVNode("td", _hoisted_423, _toDisplayString(s.name), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_424, _toDisplayString(s.target), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_425, _toDisplayString(s.port), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.mailAudit && Object.keys(_ctx.mailAudit.blocklists).length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_426, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Blocklists')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.blocklists, (rows, ip) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: ip,
                              class: "bl-group"
                            }, [
                              _createElementVNode("strong", _hoisted_427, _toDisplayString(ip), 1 /* TEXT */),
                              _createElementVNode("div", _hoisted_428, [
                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(rows, (r) => {
                                  return (_openBlock(), _createElementBlock("span", {
                                    key: r.zone,
                                    class: _normalizeClass(["pill", r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')]),
                                    title: r.reason || r.zone
                                  }, _toDisplayString(r.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_429))
                                }), 128 /* KEYED_FRAGMENT */))
                              ])
                            ]))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _createElementVNode("p", _hoisted_430, _toDisplayString(_ctx.t('Grey means the list refused the query — that usually means this server asks a public resolver, not that the address is clean.')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.mailView==='server')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                    _createElementVNode("div", _hoisted_431, [
                      _createElementVNode("div", _hoisted_432, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[106] || (_cache[106] = $event => ((_ctx.mailHost) = $event)),
                          placeholder: _ctx.t('mail.example.com'),
                          onKeyup: _cache[107] || (_cache[107] = _withKeys((...args) => (_ctx.runMailProbe && _ctx.runMailProbe(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_433), [
                          [_vModelText, _ctx.mailHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[108] || (_cache[108] = $event => ((_ctx.mailProtocol) = $event)),
                          class: "short"
                        }, _hoisted_437, 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.mailProtocol]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[109] || (_cache[109] = $event => ((_ctx.mailMode) = $event)),
                          class: "short"
                        }, [
                          _createElementVNode("option", _hoisted_438, _toDisplayString(_ctx.t('Pick automatically')), 1 /* TEXT */),
                          _hoisted_439,
                          _createElementVNode("option", _hoisted_440, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_441, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.mailMode]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[110] || (_cache[110] = $event => ((_ctx.mailPort) = $event)),
                          type: "number",
                          min: "0",
                          max: "65535",
                          class: "tiny",
                          placeholder: _ctx.t('Port')
                        }, null, 8 /* PROPS */, _hoisted_442), [
                          [
                            _vModelText,
                            _ctx.mailPort,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.mailProbe,
                          onClick: _cache[111] || (_cache[111] = (...args) => (_ctx.runMailProbe && _ctx.runMailProbe(...args)))
                        }, _toDisplayString(_ctx.t('Test the server')), 9 /* TEXT, PROPS */, _hoisted_443)
                      ]),
                      _createElementVNode("div", _hoisted_444, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailPresets, (p) => {
                          return (_openBlock(), _createElementBlock("button", {
                            class: "btn xs",
                            key: p.label,
                            onClick: $event => (_ctx.applyMailPreset(p))
                          }, _toDisplayString(p.label), 9 /* TEXT, PROPS */, _hoisted_445))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_ctx.mailProbeResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_446, [
                          (_ctx.mailProbeResult.error)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_447, "⚠ " + _toDisplayString(_ctx.mailProbeResult.error), 1 /* TEXT */))
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
                          _createElementVNode("div", _hoisted_448, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Greeting')), 1 /* TEXT */),
                              _createElementVNode("code", _hoisted_449, _toDisplayString(_ctx.mailProbeResult.greeting), 1 /* TEXT */)
                            ]),
                            (_ctx.mailProbeResult.tls)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_450, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Encryption')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.mailProbeResult.tls.protocol) + " · " + _toDisplayString(_ctx.mailProbeResult.tls.cipher), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailProbeResult.tls && _ctx.mailProbeResult.tls.subject)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_451, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Certificate')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_452, _toDisplayString(_ctx.mailProbeResult.tls.subject) + " · " + _toDisplayString(_ctx.t('issued by')) + " " + _toDisplayString(_ctx.mailProbeResult.tls.issuer) + " · " + _toDisplayString(_ctx.t('{n} days left', {n: _ctx.mailProbeResult.tls.expiresIn})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            ((_ctx.mailProbeResult.auth||[]).length)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_453, [
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
                            _createElementVNode("pre", _hoisted_454, _toDisplayString(_ctx.capabilityText(_ctx.mailProbeResult.capabilities)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("details", null, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_455, _toDisplayString((_ctx.mailProbeResult.transcript||[]).join('\n')), 1 /* TEXT */)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_456, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Open relay test')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_457, _toDisplayString(_ctx.t('Offers the server a foreign sender and a foreign recipient and stops before anything is sent. Run it against your own server.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_458, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[112] || (_cache[112] = $event => ((_ctx.relayHost) = $event)),
                          placeholder: _ctx.t('mail.example.com')
                        }, null, 8 /* PROPS */, _hoisted_459), [
                          [_vModelText, _ctx.relayHost]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[113] || (_cache[113] = $event => ((_ctx.relayPort) = $event)),
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
                          class: "btn",
                          disabled: _ctx.busy.relay,
                          onClick: _cache[114] || (_cache[114] = (...args) => (_ctx.runRelay && _ctx.runRelay(...args)))
                        }, _toDisplayString(_ctx.t('Test for open relay')), 9 /* TEXT, PROPS */, _hoisted_460)
                      ]),
                      (_ctx.relayResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_461, [
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
                              ? (_openBlock(), _createElementBlock("p", _hoisted_462, "⚠ " + _toDisplayString(_ctx.relayResult.error), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.relayResult.transcript)
                              ? (_openBlock(), _createElementBlock("details", _hoisted_463, [
                                  _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                                  _createElementVNode("pre", _hoisted_464, _toDisplayString(_ctx.relayResult.transcript.join('\n')), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_465, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Blocklist lookup')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_466, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[115] || (_cache[115] = $event => ((_ctx.blIp) = $event)),
                          placeholder: _ctx.t('IPv4 address of a sending server'),
                          onKeyup: _cache[116] || (_cache[116] = _withKeys((...args) => (_ctx.runBlocklist && _ctx.runBlocklist(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_467), [
                          [_vModelText, _ctx.blIp]
                        ]),
                        _createElementVNode("button", {
                          class: "btn",
                          disabled: _ctx.busy.bl,
                          onClick: _cache[117] || (_cache[117] = (...args) => (_ctx.runBlocklist && _ctx.runBlocklist(...args)))
                        }, _toDisplayString(_ctx.t('Check')), 9 /* TEXT, PROPS */, _hoisted_468)
                      ]),
                      (_ctx.blResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_469, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.blResult.results, (r) => {
                              return (_openBlock(), _createElementBlock("span", {
                                key: r.zone,
                                class: _normalizeClass(["pill", r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')]),
                                title: r.reason || r.zone
                              }, _toDisplayString(r.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_470))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.mailView==='send')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                    _createElementVNode("div", _hoisted_471, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Send a test message')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_472, _toDisplayString(_ctx.t('Sends a real message through one of your saved SMTP connections — the honest way to prove that sending works.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_473, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[118] || (_cache[118] = $event => ((_ctx.sendId) = $event)),
                          class: "grow"
                        }, [
                          _createElementVNode("option", _hoisted_474, _toDisplayString(_ctx.t('Type the details below')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.smtpConnections, (c) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: c.id,
                              value: c.id
                            }, _toDisplayString(c.name) + " (" + _toDisplayString(c.host) + ")", 9 /* TEXT, PROPS */, _hoisted_475))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [
                            _vModelSelect,
                            _ctx.sendId,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        (!_ctx.sendId)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 0,
                              class: "btn sm",
                              onClick: _cache[119] || (_cache[119] = $event => (_ctx.saveMailAdhoc('smtp')))
                            }, _toDisplayString(_ctx.t('Save to the list')), 1 /* TEXT */))
                          : (_openBlock(), _createElementBlock("button", {
                              key: 1,
                              class: "btn sm",
                              onClick: _cache[120] || (_cache[120] = $event => (_ctx.openConn(_ctx.connById(_ctx.sendId))))
                            }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                      ]),
                      (!_ctx.sendId)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_476, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[121] || (_cache[121] = $event => ((_ctx.smtpAdhoc.host) = $event)),
                              class: "grow",
                              placeholder: "smtp.example.com"
                            }, null, 512 /* NEED_PATCH */), [
                              [_vModelText, _ctx.smtpAdhoc.host]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[122] || (_cache[122] = $event => ((_ctx.smtpAdhoc.port) = $event)),
                              type: "number",
                              class: "tiny",
                              min: "1",
                              max: "65535"
                            }, null, 512 /* NEED_PATCH */), [
                              [
                                _vModelText,
                                _ctx.smtpAdhoc.port,
                                void 0,
                                { number: true }
                              ]
                            ]),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[123] || (_cache[123] = $event => ((_ctx.smtpAdhoc.mode) = $event)),
                              class: "tiny"
                            }, [
                              _hoisted_477,
                              _createElementVNode("option", _hoisted_478, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_479, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.smtpAdhoc.mode]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[124] || (_cache[124] = $event => ((_ctx.smtpAdhoc.username) = $event)),
                              class: "short",
                              placeholder: _ctx.t('User name'),
                              autocomplete: "off"
                            }, null, 8 /* PROPS */, _hoisted_480), [
                              [_vModelText, _ctx.smtpAdhoc.username]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[125] || (_cache[125] = $event => ((_ctx.smtpAdhoc.secret) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Password'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_481), [
                              [_vModelText, _ctx.smtpAdhoc.secret]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[126] || (_cache[126] = $event => ((_ctx.smtpAdhoc.from) = $event)),
                              class: "short",
                              placeholder: _ctx.t('Sender address')
                            }, null, 8 /* PROPS */, _hoisted_482), [
                              [_vModelText, _ctx.smtpAdhoc.from]
                            ])
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", _hoisted_483, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[127] || (_cache[127] = $event => ((_ctx.sendTo) = $event)),
                          placeholder: _ctx.t('Recipient address')
                        }, null, 8 /* PROPS */, _hoisted_484), [
                          [_vModelText, _ctx.sendTo]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[128] || (_cache[128] = $event => ((_ctx.sendSubject) = $event)),
                          placeholder: _ctx.t('Subject (optional)')
                        }, null, 8 /* PROPS */, _hoisted_485), [
                          [_vModelText, _ctx.sendSubject]
                        ])
                      ]),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[129] || (_cache[129] = $event => ((_ctx.sendBody) = $event)),
                        rows: "3",
                        placeholder: _ctx.t('Message (optional)')
                      }, null, 8 /* PROPS */, _hoisted_486), [
                        [_vModelText, _ctx.sendBody]
                      ]),
                      _createElementVNode("div", _hoisted_487, [
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.send || !_ctx.sendTo || (!_ctx.sendId && !_ctx.smtpAdhoc.host),
                          onClick: _cache[130] || (_cache[130] = (...args) => (_ctx.runSend && _ctx.runSend(...args)))
                        }, _toDisplayString(_ctx.busy.send ? _ctx.t('Sending…') : _ctx.t('Send the test message')), 9 /* TEXT, PROPS */, _hoisted_488)
                      ]),
                      (_ctx.sendResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_489, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.sendResult.ok ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.sendResult.ok ? _ctx.t('Accepted by the server') : (_ctx.sendResult.error || _ctx.t('Failed'))), 3 /* TEXT, CLASS */)
                            ]),
                            (_ctx.sendResult.reply)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_490, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Reply')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_491, _toDisplayString(_ctx.sendResult.reply), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.sendResult && _ctx.sendResult.transcript)
                        ? (_openBlock(), _createElementBlock("details", _hoisted_492, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_493, _toDisplayString(_ctx.sendResult.transcript.join('\n')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_494, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Mailbox check')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_495, _toDisplayString(_ctx.t('Signs in to a saved IMAP or POP3 account and reports what is in the inbox.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_496, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[131] || (_cache[131] = $event => ((_ctx.mailboxId) = $event)),
                          class: "grow"
                        }, [
                          _createElementVNode("option", _hoisted_497, _toDisplayString(_ctx.t('Type the details below')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailboxConnections, (c) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: c.id,
                              value: c.id
                            }, _toDisplayString(c.name) + " (" + _toDisplayString(c.kind.toUpperCase()) + ")", 9 /* TEXT, PROPS */, _hoisted_498))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [
                            _vModelSelect,
                            _ctx.mailboxId,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("button", {
                          class: "btn",
                          disabled: _ctx.busy.mailbox || (!_ctx.mailboxId && !_ctx.boxAdhoc.host),
                          onClick: _cache[132] || (_cache[132] = (...args) => (_ctx.runMailbox && _ctx.runMailbox(...args)))
                        }, _toDisplayString(_ctx.t('Sign in')), 9 /* TEXT, PROPS */, _hoisted_499),
                        (!_ctx.mailboxId)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 0,
                              class: "btn sm",
                              onClick: _cache[133] || (_cache[133] = $event => (_ctx.saveMailAdhoc('box')))
                            }, _toDisplayString(_ctx.t('Save to the list')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      (!_ctx.mailboxId)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_500, [
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[134] || (_cache[134] = $event => ((_ctx.boxAdhoc.kind) = $event)),
                              class: "tiny",
                              onChange: _cache[135] || (_cache[135] = $event => (_ctx.boxAdhoc.port = _ctx.boxAdhoc.kind === 'imap' ? 993 : 995))
                            }, _hoisted_503, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                              [_vModelSelect, _ctx.boxAdhoc.kind]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[136] || (_cache[136] = $event => ((_ctx.boxAdhoc.host) = $event)),
                              class: "grow",
                              placeholder: "imap.example.com"
                            }, null, 512 /* NEED_PATCH */), [
                              [_vModelText, _ctx.boxAdhoc.host]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[137] || (_cache[137] = $event => ((_ctx.boxAdhoc.port) = $event)),
                              type: "number",
                              class: "tiny",
                              min: "1",
                              max: "65535"
                            }, null, 512 /* NEED_PATCH */), [
                              [
                                _vModelText,
                                _ctx.boxAdhoc.port,
                                void 0,
                                { number: true }
                              ]
                            ]),
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[138] || (_cache[138] = $event => ((_ctx.boxAdhoc.mode) = $event)),
                              class: "tiny"
                            }, [
                              _createElementVNode("option", _hoisted_504, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */),
                              _hoisted_505,
                              _createElementVNode("option", _hoisted_506, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.boxAdhoc.mode]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[139] || (_cache[139] = $event => ((_ctx.boxAdhoc.username) = $event)),
                              class: "short",
                              placeholder: _ctx.t('User name'),
                              autocomplete: "off"
                            }, null, 8 /* PROPS */, _hoisted_507), [
                              [_vModelText, _ctx.boxAdhoc.username]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[140] || (_cache[140] = $event => ((_ctx.boxAdhoc.secret) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Password'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_508), [
                              [_vModelText, _ctx.boxAdhoc.secret]
                            ])
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.mailboxResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_509, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.mailboxResult.ok ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.mailboxResult.ok ? _ctx.t('Signed in') : (_ctx.mailboxResult.error || _ctx.t('Failed'))), 3 /* TEXT, CLASS */)
                            ]),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.inbox)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_510, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Inbox')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} messages', {n: _ctx.mailboxResult.details.inbox.messages})) + " · " + _toDisplayString(_ctx.t('{n} unread', {n: _ctx.mailboxResult.details.inbox.unseen})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.mailbox)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_511, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Mailbox')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} messages', {n: _ctx.mailboxResult.details.mailbox.messages})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.folders)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_512, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Folders')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_513, _toDisplayString(_ctx.mailboxResult.details.folders.join(', ')), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ clock check ============ "),
        (_ctx.tab==='ntp')
          ? (_openBlock(), _createElementBlock("section", _hoisted_514, [
              _createElementVNode("div", _hoisted_515, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Clock check (NTP)')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_516, _toDisplayString(_ctx.t('A clock that has drifted is behind more certificate and sign-in failures than anything else.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_517, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[141] || (_cache[141] = $event => ((_ctx.ntpHost) = $event)),
                    class: "short"
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.ntpServers, (s) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: s.host,
                        value: s.host
                      }, _toDisplayString(s.host) + " — " + _toDisplayString(s.label), 9 /* TEXT, PROPS */, _hoisted_518))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.ntpHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[142] || (_cache[142] = $event => ((_ctx.ntpHost) = $event)),
                    placeholder: _ctx.t('pool.ntp.org'),
                    onKeyup: _cache[143] || (_cache[143] = _withKeys((...args) => (_ctx.runNtp && _ctx.runNtp(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_519), [
                    [_vModelText, _ctx.ntpHost]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.ntp,
                    onClick: _cache[144] || (_cache[144] = (...args) => (_ctx.runNtp && _ctx.runNtp(...args)))
                  }, _toDisplayString(_ctx.t('Compare clocks')), 9 /* TEXT, PROPS */, _hoisted_520)
                ]),
                _createElementVNode("p", _hoisted_521, _toDisplayString(_ctx.t('Pick a well-known time server, or type any other.')), 1 /* TEXT */),
                (_ctx.ntpResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_522, [
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
                        ? (_openBlock(), _createElementBlock("div", _hoisted_523, [
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
                        : (_openBlock(), _createElementBlock("p", _hoisted_524, "⚠ " + _toDisplayString(_ctx.ntpResult.error), 1 /* TEXT */))
                    ]))
                  : _createCommentVNode("v-if", true)
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ FTP / SFTP ============ "),
        (_ctx.tab==='files')
          ? (_openBlock(), _createElementBlock("section", _hoisted_525, [
              _createElementVNode("div", _hoisted_526, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Enter the connection details')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_527, _toDisplayString(_ctx.t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_528, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[145] || (_cache[145] = $event => ((_ctx.adhoc.kind) = $event)),
                    class: "tiny",
                    onChange: _cache[146] || (_cache[146] = (...args) => (_ctx.adhocKindChanged && _ctx.adhocKindChanged(...args)))
                  }, _hoisted_531, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelSelect, _ctx.adhoc.kind]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[147] || (_cache[147] = $event => ((_ctx.adhoc.host) = $event)),
                    class: "grow",
                    placeholder: "server.example.com",
                    onKeyup: _cache[148] || (_cache[148] = _withKeys((...args) => (_ctx.quickConnect && _ctx.quickConnect(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.adhoc.host]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[149] || (_cache[149] = $event => ((_ctx.adhoc.port) = $event)),
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
                    "onUpdate:modelValue": _cache[150] || (_cache[150] = $event => ((_ctx.adhoc.username) = $event)),
                    class: "short",
                    placeholder: _ctx.t('User name'),
                    autocomplete: "off"
                  }, null, 8 /* PROPS */, _hoisted_532), [
                    [_vModelText, _ctx.adhoc.username]
                  ])
                ]),
                _createElementVNode("div", _hoisted_533, [
                  (_ctx.adhoc.kind==='sftp')
                    ? _withDirectives((_openBlock(), _createElementBlock("select", {
                        key: 0,
                        "onUpdate:modelValue": _cache[151] || (_cache[151] = $event => ((_ctx.adhoc.authType) = $event)),
                        class: "tiny"
                      }, [
                        _createElementVNode("option", _hoisted_534, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                        _createElementVNode("option", _hoisted_535, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */)), [
                        [_vModelSelect, _ctx.adhoc.authType]
                      ])
                    : _createCommentVNode("v-if", true),
                  (_ctx.adhoc.kind==='ftp')
                    ? _withDirectives((_openBlock(), _createElementBlock("select", {
                        key: 1,
                        "onUpdate:modelValue": _cache[152] || (_cache[152] = $event => ((_ctx.adhoc.mode) = $event)),
                        class: "tiny"
                      }, [
                        _createElementVNode("option", _hoisted_536, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */),
                        _createElementVNode("option", _hoisted_537, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */)), [
                        [_vModelSelect, _ctx.adhoc.mode]
                      ])
                    : _createCommentVNode("v-if", true),
                  (_ctx.adhoc.authType==='key' && _ctx.adhoc.kind==='sftp')
                    ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[153] || (_cache[153] = $event => ((_ctx.adhoc.privateKeyPath) = $event)),
                          class: "grow mono",
                          placeholder: _ctx.t('Key file in your Nextcloud files')
                        }, null, 8 /* PROPS */, _hoisted_538), [
                          [_vModelText, _ctx.adhoc.privateKeyPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          onClick: _cache[154] || (_cache[154] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.adhoc.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                        }, "📂")
                      ], 64 /* STABLE_FRAGMENT */))
                    : _withDirectives((_openBlock(), _createElementBlock("input", {
                        key: 3,
                        "onUpdate:modelValue": _cache[155] || (_cache[155] = $event => ((_ctx.adhoc.secret) = $event)),
                        type: "password",
                        class: "short",
                        placeholder: _ctx.t('Password'),
                        autocomplete: "new-password"
                      }, null, 8 /* PROPS */, _hoisted_539)), [
                        [_vModelText, _ctx.adhoc.secret]
                      ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[156] || (_cache[156] = $event => ((_ctx.adhoc.path) = $event)),
                    class: "short mono",
                    placeholder: _ctx.t('Start folder (optional)')
                  }, null, 8 /* PROPS */, _hoisted_540), [
                    [_vModelText, _ctx.adhoc.path]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.browse || !_ctx.adhoc.host,
                    onClick: _cache[157] || (_cache[157] = (...args) => (_ctx.quickConnect && _ctx.quickConnect(...args)))
                  }, _toDisplayString(_ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_541),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: !_ctx.adhoc.host,
                    onClick: _cache[158] || (_cache[158] = (...args) => (_ctx.saveAdhoc && _ctx.saveAdhoc(...args)))
                  }, _toDisplayString(_ctx.t('Save to the list')), 9 /* TEXT, PROPS */, _hoisted_542)
                ]),
                (_ctx.adhoc.kind==='ftp' && !_ctx.adhoc.username)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_543, _toDisplayString(_ctx.t('Leave the user name blank to sign in anonymously.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_544, [
                _createElementVNode("div", _hoisted_545, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[159] || (_cache[159] = $event => ((_ctx.filesConn) = $event)),
                    class: "grow",
                    onChange: _cache[160] || (_cache[160] = (...args) => (_ctx.useSaved && _ctx.useSaved(...args)))
                  }, [
                    _createElementVNode("option", _hoisted_546, _toDisplayString(_ctx.t('Choose a saved FTP or SFTP connection…')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fileConnections, (c) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: c.id,
                        value: c.id
                      }, _toDisplayString(c.name) + " — " + _toDisplayString(c.kind.toUpperCase()) + " " + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_547))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [
                      _vModelSelect,
                      _ctx.filesConn,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("button", {
                    class: "btn sm",
                    onClick: _cache[161] || (_cache[161] = $event => (_ctx.openConn(null,'sftp')))
                  }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */),
                  (_ctx.filesConn)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn sm",
                        onClick: _cache[162] || (_cache[162] = $event => (_ctx.openConn(_ctx.connById(_ctx.filesConn))))
                      }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  (_ctx.filesConn)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 1,
                        class: "btn sm",
                        disabled: _ctx.busy.conntest,
                        onClick: _cache[163] || (_cache[163] = $event => (_ctx.testConn(_ctx.connById(_ctx.filesConn))))
                      }, _toDisplayString(_ctx.t('Test')), 9 /* TEXT, PROPS */, _hoisted_548))
                    : _createCommentVNode("v-if", true)
                ]),
                (!_ctx.connCaps.sftp && !_ctx.connCaps.ftp)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_549, _toDisplayString(_ctx.t('Neither FTP nor SFTP is available in this PHP build.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.filesConn || _ctx.adhocActive)
                ? (_openBlock(), _createElementBlock("div", _hoisted_550, [
                    (_ctx.adhocActive)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_551, [
                          _createElementVNode("strong", _hoisted_552, _toDisplayString(_ctx.adhoc.kind.toUpperCase()) + " " + _toDisplayString(_ctx.adhoc.username || _ctx.t('anonymous')) + "@" + _toDisplayString(_ctx.adhoc.host), 1 /* TEXT */),
                          _hoisted_553,
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[164] || (_cache[164] = (...args) => (_ctx.saveAdhoc && _ctx.saveAdhoc(...args)))
                          }, _toDisplayString(_ctx.t('Save this connection')), 1 /* TEXT */),
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[165] || (_cache[165] = (...args) => (_ctx.disconnect && _ctx.disconnect(...args)))
                          }, _toDisplayString(_ctx.t('Disconnect')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_554, [
                      _createElementVNode("button", {
                        class: "btn xs",
                        disabled: !_ctx.filesData || !_ctx.filesData.parent,
                        onClick: _cache[166] || (_cache[166] = $event => (_ctx.browse(_ctx.filesData ? _ctx.filesData.parent : '')))
                      }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_555),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[167] || (_cache[167] = $event => ((_ctx.filesPath) = $event)),
                        class: "mono",
                        onKeyup: _cache[168] || (_cache[168] = _withKeys($event => (_ctx.browse(_ctx.filesPath)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.filesPath]
                      ]),
                      _createElementVNode("button", {
                        class: "btn xs",
                        onClick: _cache[169] || (_cache[169] = $event => (_ctx.browse(_ctx.filesPath)))
                      }, _toDisplayString(_ctx.t('Go')), 1 /* TEXT */),
                      _hoisted_556,
                      _createElementVNode("button", {
                        class: "btn xs",
                        onClick: _cache[170] || (_cache[170] = $event => (_ctx.fileAction('mkdir')))
                      }, _toDisplayString(_ctx.t('New folder')), 1 /* TEXT */)
                    ]),
                    (_ctx.filesData)
                      ? (_openBlock(), _createElementBlock("table", _hoisted_557, [
                          _createElementVNode("thead", null, [
                            _createElementVNode("tr", null, [
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Size')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Changed')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Rights')), 1 /* TEXT */),
                              _hoisted_558
                            ])
                          ]),
                          _createElementVNode("tbody", null, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.filesData.entries, (e) => {
                              return (_openBlock(), _createElementBlock("tr", {
                                key: e.name,
                                class: _normalizeClass({dir: e.directory})
                              }, [
                                _createElementVNode("td", null, [
                                  (e.directory)
                                    ? (_openBlock(), _createElementBlock("a", {
                                        key: 0,
                                        href: "#",
                                        onClick: _withModifiers($event => (_ctx.browse(_ctx.joinPath(_ctx.filesData.path, e.name))), ["prevent"])
                                      }, "📁 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_559))
                                    : (_openBlock(), _createElementBlock("span", _hoisted_560, "📄 " + _toDisplayString(e.name), 1 /* TEXT */))
                                ]),
                                _createElementVNode("td", _hoisted_561, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_562, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_563, _toDisplayString(e.permissions), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_564, [
                                  (!e.directory)
                                    ? (_openBlock(), _createElementBlock("button", {
                                        key: 0,
                                        class: "btn xs",
                                        disabled: _ctx.busy.dl,
                                        onClick: $event => (_ctx.downloadFile(e))
                                      }, "⤓ " + _toDisplayString(_ctx.t('To my files')), 9 /* TEXT, PROPS */, _hoisted_565))
                                    : _createCommentVNode("v-if", true),
                                  _createElementVNode("button", {
                                    class: "btn xs",
                                    onClick: $event => (_ctx.fileAction('rename', e))
                                  }, _toDisplayString(_ctx.t('Rename')), 9 /* TEXT, PROPS */, _hoisted_566),
                                  _createElementVNode("button", {
                                    class: "btn xs danger",
                                    onClick: $event => (_ctx.fileAction(e.directory ? 'rmdir' : 'delete', e))
                                  }, _toDisplayString(_ctx.t('Delete')), 9 /* TEXT, PROPS */, _hoisted_567)
                                ])
                              ], 2 /* CLASS */))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.filesData && !_ctx.filesData.entries.length)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_568, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.filesConn || _ctx.adhocActive)
                ? (_openBlock(), _createElementBlock("div", _hoisted_569, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Move files')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_570, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[171] || (_cache[171] = $event => ((_ctx.filesTarget) = $event)),
                        class: "short mono",
                        placeholder: _ctx.t('Nextcloud folder for downloads')
                      }, null, 8 /* PROPS */, _hoisted_571), [
                        [_vModelText, _ctx.filesTarget]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[172] || (_cache[172] = $event => {_ctx.pickFile('Choose a folder for downloads', (p) => { _ctx.filesTarget = p; }, true)})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_572, _toDisplayString(_ctx.t('Downloads land in this folder of your Nextcloud files.')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("div", _hoisted_573, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[173] || (_cache[173] = $event => ((_ctx.filesSource) = $event)),
                        class: "mono",
                        placeholder: _ctx.t('Path in your Nextcloud files, e.g. Documents/report.pdf')
                      }, null, 8 /* PROPS */, _hoisted_574), [
                        [_vModelText, _ctx.filesSource]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[174] || (_cache[174] = $event => {_ctx.pickFile('Choose a file to upload', (p) => { _ctx.filesSource = p; })})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: _ctx.busy.ul || !_ctx.filesSource,
                        onClick: _cache[175] || (_cache[175] = (...args) => (_ctx.uploadFile && _ctx.uploadFile(...args)))
                      }, "⤒ " + _toDisplayString(_ctx.t('Upload to this folder')), 9 /* TEXT, PROPS */, _hoisted_575)
                    ]),
                    (_ctx.transferNote)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_576, _toDisplayString(_ctx.transferNote), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ SSH / Telnet / NTP ============ "),
        (_ctx.tab==='ssh')
          ? (_openBlock(), _createElementBlock("section", _hoisted_577, [
              _createCommentVNode(" The page does two different jobs and used to run them together:\n               looking at a server, which needs nothing, and working on it,\n               which needs an account. Each is now under its own heading, and\n               the host typed above is carried down so the two are visibly the\n               same machine. "),
              _createElementVNode("h2", _hoisted_578, [
                _createTextVNode(_toDisplayString(_ctx.t('Look at a server')) + " ", 1 /* TEXT */),
                _createElementVNode("span", _hoisted_579, _toDisplayString(_ctx.t('no account needed')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_580, [
                _createElementVNode("div", _hoisted_581, [
                  _createElementVNode("select", {
                    class: "pick",
                    title: _ctx.t('Pick one NetBase already knows'),
                    onChange: _cache[176] || (_cache[176] = $event => (_ctx.pickInto('sshHost', $event)))
                  }, [
                    _createElementVNode("option", _hoisted_583, _toDisplayString(_ctx.t('Choose…')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.hostChoices, (g) => {
                      return (_openBlock(), _createElementBlock("optgroup", {
                        key: g.label,
                        label: _ctx.t(g.label)
                      }, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(g.items, (o) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: o.value,
                            value: o.value
                          }, _toDisplayString(o.text), 9 /* TEXT, PROPS */, _hoisted_585))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 8 /* PROPS */, _hoisted_584))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_582),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[177] || (_cache[177] = $event => ((_ctx.sshHost) = $event)),
                    placeholder: _ctx.t('Host name or IP address'),
                    onKeyup: _cache[178] || (_cache[178] = _withKeys((...args) => (_ctx.runSsh && _ctx.runSsh(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_586), [
                    [_vModelText, _ctx.sshHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[179] || (_cache[179] = $event => ((_ctx.sshPort) = $event)),
                    type: "number",
                    class: "tiny",
                    min: "1",
                    max: "65535"
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.sshPort,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.ssh,
                    onClick: _cache[180] || (_cache[180] = (...args) => (_ctx.runSsh && _ctx.runSsh(...args)))
                  }, _toDisplayString(_ctx.t('Inspect SSH')), 9 /* TEXT, PROPS */, _hoisted_587),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.telnet,
                    onClick: _cache[181] || (_cache[181] = (...args) => (_ctx.runTelnet && _ctx.runTelnet(...args)))
                  }, _toDisplayString(_ctx.t('Try Telnet')), 9 /* TEXT, PROPS */, _hoisted_588)
                ]),
                _createElementVNode("label", _hoisted_589, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[182] || (_cache[182] = $event => ((_ctx.sshAuthMethods) = $event))
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.sshAuthMethods]
                  ]),
                  _createTextVNode(" " + _toDisplayString(_ctx.t('Also ask which sign-in methods are accepted (leaves one failed attempt in the server log)')), 1 /* TEXT */)
                ])
              ]),
              (_ctx.sshResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_590, [
                    (_ctx.sshResult.error)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_591, "⚠ " + _toDisplayString(_ctx.sshResult.error), 1 /* TEXT */))
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
                    _createElementVNode("div", _hoisted_592, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Identification')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_593, _toDisplayString(_ctx.sshResult.banner), 1 /* TEXT */)
                      ]),
                      (_ctx.sshResult.authMethods)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_594, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Sign-in methods')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.sshResult.authMethods.join(', ')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    ((_ctx.sshResult.hostKeys||[]).length)
                      ? (_openBlock(), _createElementBlock("table", _hoisted_595, [
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
                                _createElementVNode("td", _hoisted_596, _toDisplayString(k.type), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_597, _toDisplayString(k.bits ? k.bits + ' bit' : ''), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_598, _toDisplayString(k.sha256), 1 /* TEXT */)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("details", null, [
                      _createElementVNode("summary", null, _toDisplayString(_ctx.t('Algorithms offered')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_599, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshResult.algorithms, (list, name) => {
                          return _withDirectives((_openBlock(), _createElementBlock("div", { key: name }, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.algoLabel(name) || name)), 1 /* TEXT */),
                            _createElementVNode("code", _hoisted_600, _toDisplayString(list.join(', ')), 1 /* TEXT */)
                          ])), [
                            [_vShow, list.length && _ctx.algoLabel(name)]
                          ])
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.telnetResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_601, [
                    _hoisted_602,
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
                      ? (_openBlock(), _createElementBlock("p", _hoisted_603, "⚠ " + _toDisplayString(_ctx.telnetResult.error), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    (_ctx.telnetResult.banner)
                      ? (_openBlock(), _createElementBlock("pre", _hoisted_604, _toDisplayString(_ctx.telnetResult.banner), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.allowed('sshexec'))
                ? (_openBlock(), _createElementBlock("h2", _hoisted_605, [
                    _createTextVNode(_toDisplayString(_ctx.t('Work on a server')) + " ", 1 /* TEXT */),
                    _createElementVNode("span", _hoisted_606, _toDisplayString(_ctx.t('signs in, so it needs an account')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.allowed('sshexec'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_607, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Sign in with details typed here')), 1 /* TEXT */),
                    _createElementVNode("p", _hoisted_608, _toDisplayString(_ctx.t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.')), 1 /* TEXT */),
                    (_ctx.sshHost && _ctx.sshAdhoc.host !== _ctx.sshHost)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_609, [
                          _createTextVNode(_toDisplayString(_ctx.t('Looking at {host} above?', { host: _ctx.sshHost })) + " ", 1 /* TEXT */),
                          _createElementVNode("button", {
                            class: "btn xs",
                            onClick: _cache[183] || (_cache[183] = $event => (_ctx.sshAdhoc.host = _ctx.sshHost))
                          }, _toDisplayString(_ctx.t('Use it here')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_610, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[184] || (_cache[184] = $event => ((_ctx.sshAdhoc.host) = $event)),
                        class: "grow",
                        placeholder: "server.example.com",
                        onKeyup: _cache[185] || (_cache[185] = _withKeys((...args) => (_ctx.quickConsole && _ctx.quickConsole(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.sshAdhoc.host]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[186] || (_cache[186] = $event => ((_ctx.sshAdhoc.port) = $event)),
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
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[187] || (_cache[187] = $event => ((_ctx.sshAdhoc.username) = $event)),
                        class: "short",
                        placeholder: _ctx.t('User name'),
                        autocomplete: "off"
                      }, null, 8 /* PROPS */, _hoisted_611), [
                        [_vModelText, _ctx.sshAdhoc.username]
                      ]),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[188] || (_cache[188] = $event => ((_ctx.sshAdhoc.authType) = $event)),
                        class: "tiny"
                      }, [
                        _createElementVNode("option", _hoisted_612, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                        _createElementVNode("option", _hoisted_613, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.sshAdhoc.authType]
                      ])
                    ]),
                    _createElementVNode("div", _hoisted_614, [
                      (_ctx.sshAdhoc.authType === 'key')
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[189] || (_cache[189] = $event => ((_ctx.sshAdhoc.privateKeyPath) = $event)),
                              class: "grow mono",
                              placeholder: _ctx.t('Key file in your Nextcloud files')
                            }, null, 8 /* PROPS */, _hoisted_615), [
                              [_vModelText, _ctx.sshAdhoc.privateKeyPath]
                            ]),
                            _createElementVNode("button", {
                              class: "btn sm",
                              onClick: _cache[190] || (_cache[190] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.sshAdhoc.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                            }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[191] || (_cache[191] = $event => ((_ctx.sshAdhoc.passphrase) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Key passphrase (if any)'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_616), [
                              [_vModelText, _ctx.sshAdhoc.passphrase]
                            ])
                          ], 64 /* STABLE_FRAGMENT */))
                        : _withDirectives((_openBlock(), _createElementBlock("input", {
                            key: 1,
                            "onUpdate:modelValue": _cache[192] || (_cache[192] = $event => ((_ctx.sshAdhoc.secret) = $event)),
                            type: "password",
                            class: "short",
                            placeholder: _ctx.t('Password'),
                            autocomplete: "new-password"
                          }, null, 8 /* PROPS */, _hoisted_617)), [
                            [_vModelText, _ctx.sshAdhoc.secret]
                          ]),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: _ctx.busy.term || !_ctx.sshAdhoc.host || !_ctx.sshAdhoc.username,
                        onClick: _cache[193] || (_cache[193] = (...args) => (_ctx.quickConsole && _ctx.quickConsole(...args)))
                      }, "🖳 " + _toDisplayString(_ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_618),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: !_ctx.sshAdhoc.host,
                        onClick: _cache[194] || (_cache[194] = (...args) => (_ctx.saveSshAdhoc && _ctx.saveSshAdhoc(...args)))
                      }, _toDisplayString(_ctx.t('Save to the list')), 9 /* TEXT, PROPS */, _hoisted_619)
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.allowed('sshexec'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_620, [
                    _hoisted_621,
                    _createElementVNode("p", _hoisted_622, _toDisplayString(_ctx.t('Equipment too old for SSH is worked on the same way, in a window of its own. The user name and password are asked for inside the window.')), 1 /* TEXT */),
                    (_ctx.sshHost && _ctx.telnetAdhoc.host !== _ctx.sshHost)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_623, [
                          _createTextVNode(_toDisplayString(_ctx.t('Looking at {host} above?', { host: _ctx.sshHost })) + " ", 1 /* TEXT */),
                          _createElementVNode("button", {
                            class: "btn xs",
                            onClick: _cache[195] || (_cache[195] = $event => (_ctx.telnetAdhoc.host = _ctx.sshHost))
                          }, _toDisplayString(_ctx.t('Use it here')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_624, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[196] || (_cache[196] = $event => ((_ctx.telnetAdhoc.host) = $event)),
                        class: "grow",
                        placeholder: _ctx.t('Host name or IP address'),
                        onKeyup: _cache[197] || (_cache[197] = _withKeys((...args) => (_ctx.openTelnetWindow && _ctx.openTelnetWindow(...args)), ["enter"]))
                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_625), [
                        [_vModelText, _ctx.telnetAdhoc.host]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[198] || (_cache[198] = $event => ((_ctx.telnetAdhoc.port) = $event)),
                        type: "number",
                        class: "tiny",
                        min: "1",
                        max: "65535"
                      }, null, 512 /* NEED_PATCH */), [
                        [
                          _vModelText,
                          _ctx.telnetAdhoc.port,
                          void 0,
                          { number: true }
                        ]
                      ]),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: !_ctx.telnetAdhoc.host,
                        onClick: _cache[199] || (_cache[199] = (...args) => (_ctx.openTelnetWindow && _ctx.openTelnetWindow(...args)))
                      }, "🖳 " + _toDisplayString(_ctx.t('Open a Telnet window')), 9 /* TEXT, PROPS */, _hoisted_626)
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.allowed('sshexec'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_627, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Use a connection already saved')), 1 /* TEXT */),
                    _createElementVNode("p", _hoisted_628, _toDisplayString(_ctx.t('Signs in to a saved SSH connection with its password or private key. Run a single command, pick a preset, or open a console that keeps its working directory from one line to the next.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_629, [
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[200] || (_cache[200] = $event => ((_ctx.sshConn) = $event)),
                        class: "grow"
                      }, [
                        _createElementVNode("option", _hoisted_630, _toDisplayString(_ctx.t('Choose a saved SSH connection…')), 1 /* TEXT */),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshConnections, (c) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: c.id,
                            value: c.id
                          }, _toDisplayString(c.name) + " — " + _toDisplayString(c.username) + "@" + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_631))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 512 /* NEED_PATCH */), [
                        [
                          _vModelSelect,
                          _ctx.sshConn,
                          void 0,
                          { number: true }
                        ]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[201] || (_cache[201] = $event => (_ctx.openConn(null,'ssh')))
                      }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */),
                      (_ctx.sshConn)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 0,
                            class: "btn sm",
                            onClick: _cache[202] || (_cache[202] = $event => (_ctx.openConn(_ctx.connById(_ctx.sshConn))))
                          }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_632, [
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[203] || (_cache[203] = $event => ((_ctx.sshPreset) = $event)),
                        class: "grow"
                      }, [
                        _createElementVNode("option", _hoisted_633, _toDisplayString(_ctx.t('Or type a command below…')), 1 /* TEXT */),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshPresets, (p, id) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: id,
                            value: id
                          }, _toDisplayString(_ctx.t(p.label)), 9 /* TEXT, PROPS */, _hoisted_634))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.sshPreset]
                      ]),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: _ctx.busy.sshrun || !_ctx.sshConn || !_ctx.sshPreset,
                        onClick: _cache[204] || (_cache[204] = (...args) => (_ctx.runSshPreset && _ctx.runSshPreset(...args)))
                      }, _toDisplayString(_ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_635)
                    ]),
                    _createElementVNode("div", _hoisted_636, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[205] || (_cache[205] = $event => ((_ctx.sshCommand) = $event)),
                        class: "mono",
                        placeholder: _ctx.t('uptime'),
                        onKeyup: _cache[206] || (_cache[206] = _withKeys((...args) => (_ctx.runSshCommand && _ctx.runSshCommand(...args)), ["enter"]))
                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_637), [
                        [_vModelText, _ctx.sshCommand]
                      ]),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: _ctx.busy.sshrun || !_ctx.sshConn || !_ctx.sshCommand,
                        onClick: _cache[207] || (_cache[207] = (...args) => (_ctx.runSshCommand && _ctx.runSshCommand(...args)))
                      }, _toDisplayString(_ctx.t('Run command')), 9 /* TEXT, PROPS */, _hoisted_638),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: !_ctx.sshConn,
                        onClick: _cache[208] || (_cache[208] = (...args) => (_ctx.openConsole && _ctx.openConsole(...args)))
                      }, "🖳 " + _toDisplayString(_ctx.t('Open a console')), 9 /* TEXT, PROPS */, _hoisted_639)
                    ]),
                    (_ctx.sshRunResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_640, [
                          _createElementVNode("div", _hoisted_641, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Command')), 1 /* TEXT */),
                              _createElementVNode("code", _hoisted_642, _toDisplayString(_ctx.sshRunResult.command), 1 /* TEXT */)
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
                          _createElementVNode("pre", _hoisted_643, _toDisplayString(_ctx.sshRunResult.output || _ctx.t('(no output)')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true)
      ])
    ]),
    _createCommentVNode(" ============ system information ============ "),
    (_ctx.sysInfo)
      ? (_openBlock(), _createElementBlock("div", {
          key: 1,
          class: "drawer-backdrop centred",
          onClick: _cache[211] || (_cache[211] = _withModifiers($event => (_ctx.sysInfo=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_644, [
            _createElementVNode("div", _hoisted_645, [
              _hoisted_646,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('System information')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_647, _toDisplayString(_ctx.t('What this server can do, and what it could do')), 1 /* TEXT */)
              ]),
              _hoisted_648,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[209] || (_cache[209] = $event => (_ctx.sysInfo=false))
              }, _hoisted_651, 8 /* PROPS */, _hoisted_649)
            ]),
            _createElementVNode("div", _hoisted_652, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Basics')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_653, [
                _createElementVNode("div", null, [
                  _hoisted_654,
                  _createElementVNode("code", null, "v" + _toDisplayString(_ctx.version), 1 /* TEXT */)
                ]),
                (_ctx.requirements && _ctx.requirements.distro)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_655, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('System')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.requirements.distro), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.requirements && _ctx.requirements.phpVersion)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_656, [
                      _hoisted_657,
                      _createElementVNode("code", null, [
                        _createTextVNode(_toDisplayString(_ctx.requirements.phpVersion), 1 /* TEXT */),
                        (_ctx.requirements.phpUser)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_658, " (" + _toDisplayString(_ctx.requirements.phpUser) + ")", 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor database')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} IEEE prefixes', {n: _ctx.status.ouiEntries})), 1 /* TEXT */)
                ]),
                (_ctx.status.neighbourLimits)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_659, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('ARP table')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.status.neighbourCount) + " / " + _toDisplayString(_ctx.status.neighbourLimits.gc3), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.status.defaultRoute && _ctx.status.defaultRoute.gateway)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_660, [
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
                      _createElementVNode("span", _hoisted_661, _toDisplayString(tgt.interface), 1 /* TEXT */)
                    ])
                  ]))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              (_ctx.allowed('server'))
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('This server')), 1 /* TEXT */),
                    (_ctx.serverResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_662, [
                          _createElementVNode("div", _hoisted_663, [
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
                          _createElementVNode("table", _hoisted_664, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Interface')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('State')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('MAC address')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Addresses')), 1 /* TEXT */),
                                _hoisted_665
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.serverResult.interfaces, (i) => {
                                return (_openBlock(), _createElementBlock("tr", {
                                  key: i.name
                                }, [
                                  _createElementVNode("td", _hoisted_666, _toDisplayString(i.name), 1 /* TEXT */),
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", i.up ? 'ok' : 'no'])
                                    }, _toDisplayString(i.up ? 'UP' : 'DOWN'), 3 /* TEXT, CLASS */)
                                  ]),
                                  _createElementVNode("td", _hoisted_667, _toDisplayString(i.mac), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_668, _toDisplayString(i.addresses.map(a => a.ip + (a.family==='inet' ? '/'+a.cidr : '')).join(' ')), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_669, _toDisplayString(i.mtu), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (_ctx.serverResult.listeners.length)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_670, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Listening sockets')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_671, _toDisplayString(_ctx.serverResult.listeners.join('\n')), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Tools you can use now')), 1 /* TEXT */),
              (!_ctx.activeComponents.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_672, _toDisplayString(_ctx.t('None of the optional components are installed yet.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.activeComponents, (c) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: c.id,
                  class: "sys-row on"
                }, [
                  _createElementVNode("span", _hoisted_673, _toDisplayString(_ctx.t('installed')), 1 /* TEXT */),
                  _createElementVNode("div", null, [
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(c.name)), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_674, _toDisplayString(_ctx.t(c.enables)), 1 /* TEXT */)
                  ])
                ]))
              }), 128 /* KEYED_FRAGMENT */)),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Install these to unlock more')), 1 /* TEXT */),
              (!_ctx.dormantComponents.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_675, _toDisplayString(_ctx.t('Everything NetBase can use is already installed.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dormantComponents, (c) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: c.id,
                  class: "sys-row off"
                }, [
                  _createElementVNode("span", _hoisted_676, _toDisplayString(_ctx.t('missing')), 1 /* TEXT */),
                  _createElementVNode("div", null, [
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(c.name)), 1 /* TEXT */),
                    _createElementVNode("div", null, _toDisplayString(_ctx.t(c.enables)), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_677, _toDisplayString(_ctx.t(c.without)), 1 /* TEXT */),
                    (_ctx.status.isAdmin && _ctx.installFor(c.id))
                      ? (_openBlock(), _createElementBlock("pre", _hoisted_678, _toDisplayString(_ctx.installFor(c.id)), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_679, _toDisplayString(_ctx.t('Ask an administrator to install it.')), 1 /* TEXT */))
                  ])
                ]))
              }), 128 /* KEYED_FRAGMENT */))
            ]),
            _createElementVNode("div", _hoisted_680, [
              (_ctx.status.isAdmin)
                ? (_openBlock(), _createElementBlock("a", {
                    key: 0,
                    class: "btn sm",
                    href: _ctx.adminUrl
                  }, _toDisplayString(_ctx.t('Open administration settings')), 9 /* TEXT, PROPS */, _hoisted_681))
                : _createCommentVNode("v-if", true),
              _hoisted_682,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[210] || (_cache[210] = $event => (_ctx.sysInfo=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ appearance (per user, NetBase only) ============ "),
    (_ctx.themeBox)
      ? (_openBlock(), _createElementBlock("div", _hoisted_683, [
          _createElementVNode("div", _hoisted_684, [
            _createElementVNode("div", _hoisted_685, [
              _hoisted_686,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Settings')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_687, _toDisplayString(_ctx.t('Applies to NetBase only, for your account.')), 1 /* TEXT */)
              ]),
              _hoisted_688,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[212] || (_cache[212] = $event => (_ctx.themeBox=false))
              }, _hoisted_691, 8 /* PROPS */, _hoisted_689)
            ]),
            _createElementVNode("div", _hoisted_692, [
              _createElementVNode("div", _hoisted_693, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.themeOptions, (opt) => {
                  return (_openBlock(), _createElementBlock("button", {
                    key: opt.id,
                    class: _normalizeClass(["theme-pick", {active: _ctx.settings.theme===opt.id}]),
                    onClick: $event => (_ctx.setTheme(opt.id))
                  }, [
                    _createElementVNode("span", {
                      class: _normalizeClass(["swatch", opt.id])
                    }, _hoisted_698, 2 /* CLASS */),
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(opt.label)), 1 /* TEXT */),
                    _createElementVNode("span", _hoisted_699, _toDisplayString(_ctx.t(opt.hint)), 1 /* TEXT */),
                    (_ctx.settings.theme===opt.id)
                      ? (_openBlock(), _createElementBlock("span", _hoisted_700, "✓"))
                      : _createCommentVNode("v-if", true)
                  ], 10 /* CLASS, PROPS */, _hoisted_694))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              _createElementVNode("p", _hoisted_701, _toDisplayString(_ctx.t('Saved to your account, so it follows you to every browser you sign in from.')), 1 /* TEXT */),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Language')), 1 /* TEXT */),
              _createElementVNode("label", _hoisted_702, [
                _createElementVNode("select", {
                  value: _ctx.settings.language || 'auto',
                  onChange: _cache[213] || (_cache[213] = $event => (_ctx.setLanguage($event.target.value)))
                }, [
                  _createElementVNode("option", _hoisted_704, _toDisplayString(_ctx.t('Follow Nextcloud')), 1 /* TEXT */),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.settings.languages || []), (l) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: l.code,
                      value: l.code
                    }, _toDisplayString(l.name), 9 /* TEXT, PROPS */, _hoisted_705))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_703)
              ]),
              _createElementVNode("p", _hoisted_706, _toDisplayString(_ctx.t('NetBase can speak a different language from the rest of Nextcloud — handy when the interface language and the language you think in are not the same.')), 1 /* TEXT */),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('SSH key files')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_707, _toDisplayString(_ctx.t('Keys usually live in one folder. Name it here and the file chooser starts there every time, instead of at the top of your files.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_708, [
                _withDirectives(_createElementVNode("input", {
                  "onUpdate:modelValue": _cache[214] || (_cache[214] = $event => ((_ctx.settings.keyFolder) = $event)),
                  class: "grow mono",
                  placeholder: _ctx.t('Anywhere in your Nextcloud files'),
                  onChange: _cache[215] || (_cache[215] = (...args) => (_ctx.saveKeyFolder && _ctx.saveKeyFolder(...args)))
                }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_709), [
                  [_vModelText, _ctx.settings.keyFolder]
                ]),
                _createElementVNode("button", {
                  class: "btn sm",
                  onClick: _cache[216] || (_cache[216] = $event => {_ctx.pickFile(_ctx.t('Choose a folder'), (p) => { _ctx.settings.keyFolder = p; _ctx.saveKeyFolder(); }, true, _ctx.settings.keyFolder)})
                }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                _createElementVNode("button", {
                  class: "btn sm",
                  disabled: !_ctx.settings.keyFolder,
                  onClick: _cache[217] || (_cache[217] = $event => {_ctx.settings.keyFolder = ''; _ctx.saveKeyFolder()})
                }, _toDisplayString(_ctx.t('Clear')), 9 /* TEXT, PROPS */, _hoisted_710)
              ]),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('The list of tools')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_711, _toDisplayString(_ctx.t('Drag the tools in the sidebar into the order you work in — or hold Alt and press the up and down arrows. The order is kept for your account.')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn sm",
                disabled: !(_ctx.settings.tabOrder || []).length,
                onClick: _cache[218] || (_cache[218] = (...args) => (_ctx.resetTabOrder && _ctx.resetTabOrder(...args)))
              }, _toDisplayString(_ctx.t('Put them back in the original order')), 9 /* TEXT, PROPS */, _hoisted_712)
            ]),
            _createElementVNode("div", _hoisted_713, [
              _hoisted_714,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[219] || (_cache[219] = $event => (_ctx.themeBox=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ sign in to a server, asked for on the spot ============ "),
    (_ctx.sshAsk.open)
      ? (_openBlock(), _createElementBlock("div", _hoisted_715, [
          _createElementVNode("div", _hoisted_716, [
            _createElementVNode("div", _hoisted_717, [
              _hoisted_718,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Sign in with details typed here')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_719, _toDisplayString(_ctx.t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.')), 1 /* TEXT */)
              ]),
              _hoisted_720,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[220] || (_cache[220] = $event => (_ctx.sshAsk.open=false))
              }, _hoisted_723, 8 /* PROPS */, _hoisted_721)
            ]),
            _createElementVNode("div", _hoisted_724, [
              _createElementVNode("div", _hoisted_725, [
                _createElementVNode("label", _hoisted_726, [
                  _createElementVNode("span", _hoisted_727, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[221] || (_cache[221] = $event => ((_ctx.sshAsk.host) = $event)),
                    class: "mono"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.sshAsk.host]
                  ])
                ]),
                _createElementVNode("label", _hoisted_728, [
                  _createElementVNode("span", _hoisted_729, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[222] || (_cache[222] = $event => ((_ctx.sshAsk.port) = $event)),
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
              _createElementVNode("div", _hoisted_730, [
                _createElementVNode("label", _hoisted_731, [
                  _createElementVNode("span", _hoisted_732, _toDisplayString(_ctx.t('User name')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[223] || (_cache[223] = $event => ((_ctx.sshAsk.username) = $event)),
                    autocomplete: "off",
                    onKeyup: _cache[224] || (_cache[224] = _withKeys((...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.sshAsk.username]
                  ])
                ]),
                _createElementVNode("label", _hoisted_733, [
                  _createElementVNode("span", _hoisted_734, _toDisplayString(_ctx.t('Sign in with')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[225] || (_cache[225] = $event => ((_ctx.sshAsk.authType) = $event))
                  }, [
                    _createElementVNode("option", _hoisted_735, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_736, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.sshAsk.authType]
                  ])
                ])
              ]),
              (_ctx.sshAsk.authType === 'key')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_737, [
                      _createElementVNode("label", _hoisted_738, [
                        _createElementVNode("span", _hoisted_739, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[226] || (_cache[226] = $event => ((_ctx.sshAsk.privateKeyPath) = $event)),
                          class: "mono",
                          placeholder: _ctx.t('Key file in your Nextcloud files')
                        }, null, 8 /* PROPS */, _hoisted_740), [
                          [_vModelText, _ctx.sshAsk.privateKeyPath]
                        ])
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[227] || (_cache[227] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.sshAsk.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("label", _hoisted_741, [
                      _createElementVNode("span", _hoisted_742, _toDisplayString(_ctx.t('Key passphrase (if any)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[228] || (_cache[228] = $event => ((_ctx.sshAsk.passphrase) = $event)),
                        type: "password",
                        autocomplete: "new-password",
                        onKeyup: _cache[229] || (_cache[229] = _withKeys((...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.sshAsk.passphrase]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : (_openBlock(), _createElementBlock("label", _hoisted_743, [
                    _createElementVNode("span", _hoisted_744, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[230] || (_cache[230] = $event => ((_ctx.sshAsk.secret) = $event)),
                      type: "password",
                      autocomplete: "new-password",
                      onKeyup: _cache[231] || (_cache[231] = _withKeys((...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)), ["enter"]))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelText, _ctx.sshAsk.secret]
                    ])
                  ]))
            ]),
            _createElementVNode("div", _hoisted_745, [
              _hoisted_746,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[232] || (_cache[232] = $event => (_ctx.sshAsk.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: !_ctx.sshAsk.host || !_ctx.sshAsk.username,
                onClick: _cache[233] || (_cache[233] = (...args) => (_ctx.connectAsk && _ctx.connectAsk(...args)))
              }, "🖳 " + _toDisplayString(_ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_747)
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
          _hoisted_750,
          _createElementVNode("strong", _hoisted_751, _toDisplayString(w.title), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_752, _toDisplayString(w.base) + _toDisplayString(w.path ? '/' + w.path : ''), 1 /* TEXT */),
          _hoisted_753,
          _createCommentVNode(" Drawn, not typed: the arrows and crosses a font happens to carry are\n             hairline thin at this size, and no two systems draw them alike. "),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Back'),
            "aria-label": _ctx.t('Back'),
            disabled: w.trailAt < 1,
            onClick: _withModifiers($event => (_ctx.backWindow(w)), ["stop"])
          }, _hoisted_756, 8 /* PROPS */, _hoisted_754),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Front page'),
            "aria-label": _ctx.t('Front page'),
            onClick: _withModifiers($event => (_ctx.homeWindow(w)), ["stop"])
          }, _hoisted_759, 8 /* PROPS */, _hoisted_757),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Reload'),
            "aria-label": _ctx.t('Reload'),
            onClick: _withModifiers($event => (_ctx.reloadWindow(w)), ["stop"])
          }, _hoisted_762, 8 /* PROPS */, _hoisted_760),
          (!_ctx.narrow)
            ? (_openBlock(), _createElementBlock("button", {
                key: 0,
                class: "btn xs ib",
                title: _ctx.t('Fill the screen'),
                "aria-label": _ctx.t('Fill the screen'),
                onClick: _withModifiers($event => (_ctx.toggleFull(w)), ["stop"])
              }, _hoisted_765, 8 /* PROPS */, _hoisted_763))
            : _createCommentVNode("v-if", true),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('What this window can and cannot do'),
            "aria-label": _ctx.t('What this window can and cannot do'),
            onClick: _withModifiers($event => (w.help = !w.help), ["stop"])
          }, _hoisted_768, 8 /* PROPS */, _hoisted_766),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Close'),
            "aria-label": _ctx.t('Close'),
            onClick: _withModifiers($event => (_ctx.closeWindow(w)), ["stop"])
          }, _hoisted_771, 8 /* PROPS */, _hoisted_769)
        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_749),
        (w.help)
          ? (_openBlock(), _createElementBlock("div", {
              key: 0,
              class: "devwin-help",
              onMousedown: _cache[234] || (_cache[234] = _withModifiers(() => {}, ["stop"]))
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
              }, _toDisplayString(_ctx.t('Close')), 9 /* TEXT, PROPS */, _hoisted_772)
            ], 32 /* NEED_HYDRATION */))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" What used to be here was a sentence explaining the window to someone\n           who had already opened it. This is the row of things a person\n           actually reaches for while signing into a device: its address, what\n           is on the page, and the clipboard going the other way, because a\n           device password is nearly always pasted. "),
        (!w.busy && !w.error)
          ? (_openBlock(), _createElementBlock("div", {
              key: 1,
              class: "devwin-bar",
              onMousedown: _cache[241] || (_cache[241] = _withModifiers(() => {}, ["stop"]))
            }, [
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Copy this device\'s own address'),
                onClick: _withModifiers($event => (_ctx.copyText(w.base + (w.path ? '/' + w.path : ''), _ctx.t('Address copied'))), ["stop"])
              }, [
                _hoisted_774,
                _createElementVNode("span", _hoisted_775, _toDisplayString(_ctx.t('Address')), 1 /* TEXT */)
              ], 8 /* PROPS */, _hoisted_773),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Copy whatever is selected on the page, or the whole page if nothing is'),
                onClick: _withModifiers($event => (_ctx.copyFromWindow(w)), ["stop"])
              }, [
                _hoisted_777,
                _createElementVNode("span", _hoisted_778, _toDisplayString(_ctx.t('Page text')), 1 /* TEXT */)
              ], 8 /* PROPS */, _hoisted_776),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Paste the clipboard into the field the cursor is in'),
                onMousedown: _cache[235] || (_cache[235] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.pasteIntoWindow(w)), ["stop"])
              }, [
                _hoisted_780,
                _createElementVNode("span", _hoisted_781, _toDisplayString(_ctx.t('Paste')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_779),
              _hoisted_782,
              _createCommentVNode(" Device interfaces are drawn for a screen of their own era. Some\n             are unreadably small in a window; some waste half of it. "),
              _createElementVNode("button", {
                class: "btn xs",
                title: _ctx.t('Take a picture of this page'),
                onMousedown: _cache[236] || (_cache[236] = _withModifiers(() => {}, ["prevent"])),
                onClick: _withModifiers($event => (_ctx.shootWindow(w)), ["stop"])
              }, [
                _hoisted_784,
                _createElementVNode("span", _hoisted_785, _toDisplayString(_ctx.t('Screenshot')), 1 /* TEXT */)
              ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_783),
              _createElementVNode("span", _hoisted_786, [
                _createElementVNode("button", {
                  class: _normalizeClass(["btn xs ib", {active: w.fit}]),
                  title: _ctx.t('Fit the page to the window'),
                  "aria-label": _ctx.t('Fit the page to the window'),
                  onMousedown: _cache[237] || (_cache[237] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.toggleFit(w)), ["stop"])
                }, _hoisted_789, 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_787),
                _createElementVNode("button", {
                  class: "btn xs ib",
                  title: _ctx.t('Smaller'),
                  "aria-label": _ctx.t('Smaller'),
                  disabled: !_ctx.canZoom(w, -1),
                  onMousedown: _cache[238] || (_cache[238] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.zoomWindow(w, -1)), ["stop"])
                }, _hoisted_792, 40 /* PROPS, NEED_HYDRATION */, _hoisted_790),
                _createElementVNode("button", {
                  class: "btn xs zoom-now",
                  title: _ctx.t('Back to 100%'),
                  onMousedown: _cache[239] || (_cache[239] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.resetZoom(w)), ["stop"])
                }, _toDisplayString(Math.round(w.zoom * 100)) + "%", 41 /* TEXT, PROPS, NEED_HYDRATION */, _hoisted_793),
                _createElementVNode("button", {
                  class: "btn xs ib",
                  title: _ctx.t('Larger'),
                  "aria-label": _ctx.t('Larger'),
                  disabled: !_ctx.canZoom(w, 1),
                  onMousedown: _cache[240] || (_cache[240] = _withModifiers(() => {}, ["prevent"])),
                  onClick: _withModifiers($event => (_ctx.zoomWindow(w, 1)), ["stop"])
                }, _hoisted_796, 40 /* PROPS, NEED_HYDRATION */, _hoisted_794)
              ]),
              _createElementVNode("span", _hoisted_797, _toDisplayString(w.base.replace(/^https?:\/\//, '')), 1 /* TEXT */)
            ], 32 /* NEED_HYDRATION */))
          : _createCommentVNode("v-if", true),
        (w.busy)
          ? (_openBlock(), _createElementBlock("div", _hoisted_798, _toDisplayString(_ctx.t('Connecting…')), 1 /* TEXT */))
          : (w.error)
            ? (_openBlock(), _createElementBlock("div", _hoisted_799, "⚠ " + _toDisplayString(w.error), 1 /* TEXT */))
            : (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                _createCommentVNode(" The page is sandboxed against navigating anything but itself, so a device\n           that tries to break out of frames cannot take the browser with it, and a\n           policy pins everything it loads or sends to the proxy path, so it cannot\n           reach a Nextcloud endpoint. The name is how its own \"replace everything\"\n           links find this window. "),
                _createElementVNode("iframe", {
                  src: w.src,
                  class: "devwin-frame",
                  title: w.title,
                  "data-window": w.id,
                  name: "_netbase_window",
                  onLoad: $event => (_ctx.onWindowLoad(w, $event)),
                  sandbox: "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"
                }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_800)
              ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */)),
        _createCommentVNode(" A message about this window, shown inside it: a device window sits above\n           the app's own banner (its z-index is raised on every focus), so a note\n           put there would be hidden behind the window it is about. "),
        (w.toast)
          ? (_openBlock(), _createElementBlock("div", {
              key: 5,
              class: _normalizeClass(["devwin-toast", w.toast.kind]),
              onClick: $event => (w.toast = null)
            }, _toDisplayString(w.toast.text), 11 /* TEXT, CLASS, PROPS */, _hoisted_801))
          : _createCommentVNode("v-if", true),
        _createElementVNode("div", {
          class: "devwin-grip",
          onMousedown: _withModifiers($event => (_ctx.startResize(w, $event)), ["prevent","stop"])
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_802)
      ], 46 /* CLASS, STYLE, PROPS, NEED_HYDRATION */, _hoisted_748))
    }), 128 /* KEYED_FRAGMENT */)),
    _createCommentVNode(" ============ what can be done to the device under the pointer ============ "),
    _createCommentVNode(" A right-click asks the obvious question — how do I get into this thing —\n         and the answer is already known: whichever of its ports are open. "),
    (_ctx.rowMenu.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 4,
          class: "row-menu-veil",
          onClick: _cache[244] || (_cache[244] = $event => (_ctx.rowMenu.open = false)),
          onContextmenu: _cache[245] || (_cache[245] = _withModifiers($event => (_ctx.rowMenu.open = false), ["prevent"]))
        }, [
          _createElementVNode("ul", {
            class: "row-menu",
            style: _normalizeStyle({ left: _ctx.rowMenu.x + 'px', top: _ctx.rowMenu.y + 'px' }),
            onClick: _cache[243] || (_cache[243] = _withModifiers(() => {}, ["stop"]))
          }, [
            _createElementVNode("li", _hoisted_803, _toDisplayString(_ctx.rowMenu.device ? (_ctx.rowMenu.device.name || _ctx.rowMenu.device.ip) : ''), 1 /* TEXT */),
            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.rowActions(_ctx.rowMenu.device), (a, i) => {
              return (_openBlock(), _createElementBlock("li", { key: i }, [
                _createElementVNode("button", {
                  class: "row-menu-item",
                  onClick: $event => {_ctx.rowMenu.open = false; a.run()}
                }, [
                  _createElementVNode("span", _hoisted_805, _toDisplayString(a.icon), 1 /* TEXT */),
                  _createTextVNode(_toDisplayString(a.label), 1 /* TEXT */)
                ], 8 /* PROPS */, _hoisted_804)
              ]))
            }), 128 /* KEYED_FRAGMENT */)),
            (!_ctx.rowActions(_ctx.rowMenu.device).length)
              ? (_openBlock(), _createElementBlock("li", _hoisted_806, _toDisplayString(_ctx.t('No way in on the ports it has open')), 1 /* TEXT */))
              : _createCommentVNode("v-if", true),
            _hoisted_807,
            _createElementVNode("li", null, [
              _createElementVNode("button", {
                class: "row-menu-item",
                onClick: _cache[242] || (_cache[242] = $event => {_ctx.rowMenu.open = false; _ctx.openDevice(_ctx.rowMenu.device)})
              }, [
                _hoisted_808,
                _createTextVNode(_toDisplayString(_ctx.t('Properties')), 1 /* TEXT */)
              ])
            ])
          ], 4 /* STYLE */)
        ], 32 /* NEED_HYDRATION */))
      : _createCommentVNode("v-if", true),
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
          _hoisted_811,
          _createElementVNode("strong", _hoisted_812, _toDisplayString(w.kind === 'telnet' ? 'Telnet' : 'SSH') + " · " + _toDisplayString(w.host), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_813, _toDisplayString(w.prompt || (w.user ? w.user + '@' + w.host : w.host + ':' + w.port)), 1 /* TEXT */),
          _hoisted_814,
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Clear'),
            "aria-label": _ctx.t('Clear'),
            onClick: _withModifiers($event => (_ctx.clearTerm(w)), ["stop"])
          }, _hoisted_817, 8 /* PROPS */, _hoisted_815),
          (!_ctx.narrow)
            ? (_openBlock(), _createElementBlock("button", {
                key: 0,
                class: "btn xs ib",
                title: _ctx.t('Fill the screen'),
                "aria-label": _ctx.t('Fill the screen'),
                onClick: _withModifiers($event => (_ctx.toggleFull(w)), ["stop"])
              }, _hoisted_820, 8 /* PROPS */, _hoisted_818))
            : _createCommentVNode("v-if", true),
          _createElementVNode("button", {
            class: "btn xs ib",
            title: _ctx.t('Close'),
            "aria-label": _ctx.t('Close'),
            onClick: _withModifiers($event => (_ctx.closeTerm(w)), ["stop"])
          }, _hoisted_823, 8 /* PROPS */, _hoisted_821)
        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_810),
        _createCommentVNode(" Telnet asks who you are before it will say anything useful, and PHP\n           cannot hold the answer between requests, so it is kept here and sent\n           with every line. "),
        (w.kind === 'telnet' && !w.signedIn)
          ? (_openBlock(), _createElementBlock("div", _hoisted_824, [
              _withDirectives(_createElementVNode("input", {
                "onUpdate:modelValue": $event => ((w.user) = $event),
                placeholder: _ctx.t('User name'),
                autocomplete: "off",
                spellcheck: "false",
                onKeyup: _withKeys($event => (_ctx.signInTerm(w)), ["enter"])
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_825), [
                [_vModelText, w.user]
              ]),
              _withDirectives(_createElementVNode("input", {
                "onUpdate:modelValue": $event => ((w.password) = $event),
                type: "password",
                placeholder: _ctx.t('Password'),
                autocomplete: "off",
                onKeyup: _withKeys($event => (_ctx.signInTerm(w)), ["enter"])
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_826), [
                [_vModelText, w.password]
              ]),
              _createElementVNode("button", {
                class: "btn sm primary",
                disabled: w.busy,
                onClick: $event => (_ctx.signInTerm(w))
              }, _toDisplayString(w.busy ? _ctx.t('Connecting…') : _ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_827),
              _createElementVNode("span", _hoisted_828, _toDisplayString(_ctx.t('Leave both empty if the device does not ask.')), 1 /* TEXT */)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" SSH gets a screen, not a transcript: one connection stays open and\n           the far end draws on it, so vi, top and a password prompt all work\n           exactly as they do at the machine itself. "),
        (w.kind === 'ssh')
          ? (_openBlock(), _createElementBlock("div", {
              key: 1,
              class: "term-screen",
              ref_for: true,
              ref: 'screen' + w.id
            }, null, 512 /* NEED_PATCH */))
          : (_openBlock(), _createElementBlock("div", {
              key: 2,
              class: "term-body",
              ref_for: true,
              ref: 'term' + w.id
            }, [
              _createElementVNode("p", _hoisted_829, _toDisplayString(_ctx.t('Each line is its own connection: it signs in, sends the line, reads the answer and hangs up. Telnet carries everything in the clear, this window included.')), 1 /* TEXT */),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(w.lines, (l, i) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: i,
                  class: _normalizeClass('term-line ' + l.kind)
                }, [
                  (l.kind==='cmd')
                    ? (_openBlock(), _createElementBlock("span", _hoisted_830, _toDisplayString(l.prompt), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  _createTextVNode(_toDisplayString(l.text), 1 /* TEXT */)
                ], 2 /* CLASS */))
              }), 128 /* KEYED_FRAGMENT */)),
              (w.busy)
                ? (_openBlock(), _createElementBlock("div", _hoisted_831, "…"))
                : _createCommentVNode("v-if", true)
            ], 512 /* NEED_PATCH */)),
        (w.kind === 'telnet' && w.signedIn)
          ? (_openBlock(), _createElementBlock("div", _hoisted_832, [
              _createElementVNode("span", _hoisted_833, _toDisplayString(_ctx.termPrompt(w)), 1 /* TEXT */),
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
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_834), [
                [_vModelText, w.command]
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createElementVNode("div", {
          class: "devwin-grip",
          onMousedown: _withModifiers($event => (_ctx.startResize(w, $event)), ["prevent","stop"])
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_835)
      ], 46 /* CLASS, STYLE, PROPS, NEED_HYDRATION */, _hoisted_809))
    }), 128 /* KEYED_FRAGMENT */)),
    _createCommentVNode(" ============ Nextcloud file picker ============ "),
    (_ctx.picker.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 5,
          class: "drawer-backdrop centred",
          onClick: _cache[250] || (_cache[250] = _withModifiers($event => (_ctx.picker.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_836, [
            _createElementVNode("div", _hoisted_837, [
              _hoisted_838,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t(_ctx.picker.title)), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_839, _toDisplayString(_ctx.t('Your Nextcloud files')), 1 /* TEXT */)
              ]),
              _hoisted_840,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[246] || (_cache[246] = $event => (_ctx.picker.open=false))
              }, _hoisted_843, 8 /* PROPS */, _hoisted_841)
            ]),
            _createElementVNode("div", _hoisted_844, [
              _createElementVNode("div", _hoisted_845, [
                _createElementVNode("button", {
                  class: "btn xs",
                  disabled: _ctx.picker.path==='',
                  onClick: _cache[247] || (_cache[247] = $event => (_ctx.pickerOpen(_ctx.picker.parent || '')))
                }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_846),
                _createElementVNode("span", _hoisted_847, "/" + _toDisplayString(_ctx.picker.path), 1 /* TEXT */)
              ]),
              _createElementVNode("table", _hoisted_848, [
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
                            }, "📁 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_849))
                          : (_openBlock(), _createElementBlock("a", {
                              key: 1,
                              href: "#",
                              onClick: _withModifiers($event => (_ctx.pickerChoose(e.path)), ["prevent"])
                            }, "📄 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_850))
                      ]),
                      _createElementVNode("td", _hoisted_851, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                      _createElementVNode("td", _hoisted_852, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */)
                    ], 2 /* CLASS */))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (!_ctx.picker.entries.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_853, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_854, [
              _createElementVNode("span", _hoisted_855, _toDisplayString(_ctx.picker.foldersOnly ? _ctx.t('Choose the folder you are in, or open another.') : _ctx.t('Click a file to choose it.')), 1 /* TEXT */),
              _hoisted_856,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[248] || (_cache[248] = $event => (_ctx.picker.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              (_ctx.picker.foldersOnly)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn primary",
                    onClick: _cache[249] || (_cache[249] = $event => (_ctx.pickerChoose(_ctx.picker.path)))
                  }, _toDisplayString(_ctx.t('Use this folder')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ page preview ============ "),
    (_ctx.preview.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 6,
          class: "drawer-backdrop centred",
          onClick: _cache[258] || (_cache[258] = _withModifiers((...args) => (_ctx.closePreview && _ctx.closePreview(...args)), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_857, [
            _createElementVNode("div", _hoisted_858, [
              _hoisted_859,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Page preview')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_860, _toDisplayString(_ctx.preview.url), 1 /* TEXT */)
              ]),
              _hoisted_861,
              _createElementVNode("a", {
                class: "btn sm ib",
                href: _ctx.preview.url,
                target: "_blank",
                rel: "noopener noreferrer",
                title: _ctx.t('Only works from inside that network'),
                "aria-label": _ctx.t('Only works from inside that network')
              }, _hoisted_864, 8 /* PROPS */, _hoisted_862),
              _createElementVNode("button", {
                class: "btn sm",
                disabled: _ctx.preview.loading,
                onClick: _cache[251] || (_cache[251] = (...args) => (_ctx.reloadPreview && _ctx.reloadPreview(...args)))
              }, _toDisplayString(_ctx.t('Reload')), 9 /* TEXT, PROPS */, _hoisted_865),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[252] || (_cache[252] = (...args) => (_ctx.closePreview && _ctx.closePreview(...args)))
              }, _hoisted_868, 8 /* PROPS */, _hoisted_866)
            ]),
            _createElementVNode("div", _hoisted_869, [
              (_ctx.preview.loading)
                ? (_openBlock(), _createElementBlock("p", _hoisted_870, _toDisplayString(_ctx.t('Rendering the page on the server…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.preview.error)
                ? (_openBlock(), _createElementBlock("p", _hoisted_871, "⚠ " + _toDisplayString(_ctx.preview.error), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _withDirectives(_createElementVNode("img", {
                src: _ctx.preview.src,
                class: "preview-shot",
                onLoad: _cache[253] || (_cache[253] = $event => (_ctx.preview.loading=false)),
                onError: _cache[254] || (_cache[254] = (...args) => (_ctx.previewFailed && _ctx.previewFailed(...args))),
                alt: _ctx.t('Page preview')
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_872), [
                [_vShow, !_ctx.preview.loading && !_ctx.preview.error]
              ])
            ]),
            _createElementVNode("div", _hoisted_873, [
              _createElementVNode("label", _hoisted_874, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": _cache[255] || (_cache[255] = $event => ((_ctx.preview.full) = $event)),
                  onChange: _cache[256] || (_cache[256] = (...args) => (_ctx.reloadPreview && _ctx.reloadPreview(...args)))
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelCheckbox, _ctx.preview.full]
                ]),
                _createTextVNode(" " + _toDisplayString(_ctx.t('Whole page, not just the first screen')), 1 /* TEXT */)
              ]),
              _hoisted_875,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[257] || (_cache[257] = (...args) => (_ctx.closePreview && _ctx.closePreview(...args)))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ saved connection editor ============ "),
    (_ctx.connModal)
      ? (_openBlock(), _createElementBlock("div", _hoisted_876, [
          _createElementVNode("div", _hoisted_877, [
            _createElementVNode("div", _hoisted_878, [
              _hoisted_879,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.connForm.id ? _ctx.t('Edit connection') : _ctx.t('New connection')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_880, _toDisplayString(_ctx.t('Saved for your account only. The password is encrypted on the server and never sent back to the browser.')), 1 /* TEXT */)
              ]),
              _hoisted_881,
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[259] || (_cache[259] = $event => (_ctx.connModal=false))
              }, _hoisted_884, 8 /* PROPS */, _hoisted_882)
            ]),
            _createElementVNode("div", _hoisted_885, [
              _createElementVNode("label", _hoisted_886, [
                _createElementVNode("span", _hoisted_887, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("select", {
                  "onUpdate:modelValue": _cache[260] || (_cache[260] = $event => ((_ctx.connForm.kind) = $event)),
                  onChange: _cache[261] || (_cache[261] = (...args) => (_ctx.connKindChanged && _ctx.connKindChanged(...args)))
                }, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connKinds, (k, id) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: id,
                      value: id
                    }, _toDisplayString(_ctx.t(k.label)), 9 /* TEXT, PROPS */, _hoisted_888))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelSelect, _ctx.connForm.kind]
                ])
              ]),
              _createElementVNode("label", _hoisted_889, [
                _createElementVNode("span", _hoisted_890, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  "onUpdate:modelValue": _cache[262] || (_cache[262] = $event => ((_ctx.connForm.name) = $event)),
                  placeholder: _ctx.t('Office file server')
                }, null, 8 /* PROPS */, _hoisted_891), [
                  [_vModelText, _ctx.connForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_892, [
                _createElementVNode("label", _hoisted_893, [
                  _createElementVNode("span", _hoisted_894, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[263] || (_cache[263] = $event => ((_ctx.connForm.host) = $event)),
                    placeholder: "server.example.com"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.connForm.host]
                  ])
                ]),
                _createElementVNode("label", _hoisted_895, [
                  _createElementVNode("span", _hoisted_896, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[264] || (_cache[264] = $event => ((_ctx.connForm.port) = $event)),
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
              (_ctx.connModes.length > 1)
                ? (_openBlock(), _createElementBlock("label", _hoisted_897, [
                    _createElementVNode("span", _hoisted_898, _toDisplayString(_ctx.t('Encryption')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[265] || (_cache[265] = $event => ((_ctx.connForm.mode) = $event))
                    }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connModes, (m) => {
                        return (_openBlock(), _createElementBlock("option", {
                          key: m,
                          value: m
                        }, _toDisplayString(_ctx.t(_ctx.modeLabel(m))), 9 /* TEXT, PROPS */, _hoisted_899))
                      }), 128 /* KEYED_FRAGMENT */))
                    ], 512 /* NEED_PATCH */), [
                      [_vModelSelect, _ctx.connForm.mode]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='sftp' || _ctx.connForm.kind==='ssh')
                ? (_openBlock(), _createElementBlock("label", _hoisted_900, [
                    _createElementVNode("span", _hoisted_901, _toDisplayString(_ctx.t('Sign in with')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[266] || (_cache[266] = $event => ((_ctx.connForm.authType) = $event))
                    }, [
                      _createElementVNode("option", _hoisted_902, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                      _createElementVNode("option", _hoisted_903, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                    ], 512 /* NEED_PATCH */), [
                      [_vModelSelect, _ctx.connForm.authType]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_904, [
                _createElementVNode("label", _hoisted_905, [
                  _createElementVNode("span", _hoisted_906, _toDisplayString(_ctx.t('User name')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[267] || (_cache[267] = $event => ((_ctx.connForm.username) = $event)),
                    autocomplete: "off"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.connForm.username]
                  ])
                ]),
                (_ctx.connForm.authType !== 'key')
                  ? (_openBlock(), _createElementBlock("label", _hoisted_907, [
                      _createElementVNode("span", _hoisted_908, _toDisplayString(_ctx.connForm.id && _ctx.connForm.hasSecret ? _ctx.t('Password (leave blank to keep)') : _ctx.t('Password')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[268] || (_cache[268] = $event => ((_ctx.connForm.secret) = $event)),
                        type: "password",
                        autocomplete: "new-password"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.secret]
                      ])
                    ]))
                  : (_openBlock(), _createElementBlock("label", _hoisted_909, [
                      _createElementVNode("span", _hoisted_910, _toDisplayString(_ctx.t('Key passphrase (if any)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[269] || (_cache[269] = $event => ((_ctx.connForm.passphrase) = $event)),
                        type: "password",
                        autocomplete: "new-password"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.passphrase]
                      ])
                    ]))
              ]),
              (_ctx.connForm.authType === 'key')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                    _createElementVNode("label", _hoisted_911, [
                      _createElementVNode("span", _hoisted_912, _toDisplayString(_ctx.t('Key file in your Nextcloud files')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_913, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[270] || (_cache[270] = $event => ((_ctx.connForm.privateKeyPath) = $event)),
                          class: "mono",
                          placeholder: "Keys/id_ed25519"
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelText, _ctx.connForm.privateKeyPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          onClick: _cache[271] || (_cache[271] = $event => {_ctx.pickFile(_ctx.t('Choose a key file'), (p) => { _ctx.connForm.privateKeyPath = p; }, false, _ctx.settings.keyFolder)})
                        }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */)
                      ])
                    ]),
                    _createElementVNode("p", _hoisted_914, _toDisplayString(_ctx.t('Give the path of the private key inside your own Nextcloud files — the one without .pub. The server reads it when you save; the key itself never passes through the browser. Or paste it below instead.')), 1 /* TEXT */),
                    _createElementVNode("label", _hoisted_915, [
                      _createElementVNode("span", _hoisted_916, _toDisplayString(_ctx.connForm.id && _ctx.connForm.hasSecret ? _ctx.t('Private key (leave blank to keep)') : _ctx.t('Private key (paste)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[272] || (_cache[272] = $event => ((_ctx.connForm.privateKey) = $event)),
                        rows: "4",
                        class: "mono tiny",
                        placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.privateKey]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='smtp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_917, [
                    _createElementVNode("span", _hoisted_918, _toDisplayString(_ctx.t('Sender address')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[273] || (_cache[273] = $event => ((_ctx.connForm.from) = $event)),
                      placeholder: "notify@example.com"
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelText, _ctx.connForm.from]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='ftp' || _ctx.connForm.kind==='sftp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_919, [
                    _createElementVNode("span", _hoisted_920, _toDisplayString(_ctx.t('Start folder')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[274] || (_cache[274] = $event => ((_ctx.connForm.path) = $event)),
                      class: "mono",
                      placeholder: "/"
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelText, _ctx.connForm.path]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='ftp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_921, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[275] || (_cache[275] = $event => ((_ctx.connForm.passive) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.connForm.passive]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Passive mode (usually right)')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("label", _hoisted_922, [
                _createElementVNode("span", _hoisted_923, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  "onUpdate:modelValue": _cache[276] || (_cache[276] = $event => ((_ctx.connForm.notes) = $event)),
                  rows: "2"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.connForm.notes]
                ])
              ]),
              (_ctx.connNote)
                ? (_openBlock(), _createElementBlock("p", _hoisted_924, _toDisplayString(_ctx.connNote), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_925, [
              (_ctx.connForm.id)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger sm",
                    onClick: _cache[277] || (_cache[277] = $event => (_ctx.deleteConn(_ctx.connForm)))
                  }, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_926,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[278] || (_cache[278] = $event => (_ctx.connModal=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: _ctx.busy.conn,
                onClick: _cache[279] || (_cache[279] = (...args) => (_ctx.saveConn && _ctx.saveConn(...args)))
              }, _toDisplayString(_ctx.t('Save')), 9 /* TEXT, PROPS */, _hoisted_927)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ device drawer ============ "),
    (_ctx.selected)
      ? (_openBlock(), _createElementBlock("div", {
          key: 8,
          class: "drawer-backdrop",
          onClick: _cache[310] || (_cache[310] = _withModifiers($event => (_ctx.selected=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_928, [
            _createElementVNode("div", _hoisted_929, [
              _createElementVNode("span", _hoisted_930, _toDisplayString(_ctx.icon(_ctx.selected)), 1 /* TEXT */),
              _createElementVNode("div", null, [
                _withDirectives(_createElementVNode("input", {
                  class: "dev-name",
                  "onUpdate:modelValue": _cache[280] || (_cache[280] = $event => ((_ctx.editLabel) = $event)),
                  placeholder: _ctx.selected.hostname || _ctx.selected.ip,
                  readonly: !_ctx.allowed('scan')
                }, null, 8 /* PROPS */, _hoisted_931), [
                  [_vModelText, _ctx.editLabel]
                ]),
                _createElementVNode("div", _hoisted_932, [
                  _createTextVNode(_toDisplayString(_ctx.selected.ip), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[281] || (_cache[281] = $event => (_ctx.copyField(_ctx.t('IPv4'), _ctx.selected.ip)))
                  }, _hoisted_935, 8 /* PROPS */, _hoisted_933),
                  _createTextVNode(" · " + _toDisplayString(_ctx.selected.mac || _ctx.t('no MAC')), 1 /* TEXT */),
                  (_ctx.selected.mac)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[282] || (_cache[282] = $event => (_ctx.copyField(_ctx.t('MAC address'), _ctx.selected.mac)))
                      }, _hoisted_938, 8 /* PROPS */, _hoisted_936))
                    : _createCommentVNode("v-if", true)
                ])
              ]),
              _hoisted_939,
              _createCommentVNode(" The whole record, and below, each row on its own: a device is\n               quoted into a ticket or a stock list far more often than it is\n               read on the screen. "),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Copy everything about this device'),
                "aria-label": _ctx.t('Copy all'),
                onClick: _cache[283] || (_cache[283] = $event => (_ctx.copyDevice(_ctx.selected)))
              }, _hoisted_942, 8 /* PROPS */, _hoisted_940),
              _createElementVNode("button", {
                class: "btn xs ib",
                title: _ctx.t('Close'),
                "aria-label": _ctx.t('Close'),
                onClick: _cache[284] || (_cache[284] = $event => (_ctx.selected=null))
              }, _hoisted_945, 8 /* PROPS */, _hoisted_943)
            ]),
            _createElementVNode("div", _hoisted_946, [
              _createElementVNode("div", _hoisted_947, [
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.vendorText(_ctx.selected)), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[285] || (_cache[285] = $event => (_ctx.copyField(_ctx.t('Vendor'), _ctx.vendorText(_ctx.selected))))
                  }, _hoisted_950, 8 /* PROPS */, _hoisted_948)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Reported name')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.selected.hostname || '—'), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[286] || (_cache[286] = $event => (_ctx.copyField(_ctx.t('Reported name'), _ctx.selected.hostname)))
                  }, _hoisted_953, 8 /* PROPS */, _hoisted_951)
                ]),
                (_ctx.selected.workgroup)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_954, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Workgroup')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.workgroup), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[287] || (_cache[287] = $event => (_ctx.copyField(_ctx.t('Workgroup'), _ctx.selected.workgroup)))
                      }, _hoisted_957, 8 /* PROPS */, _hoisted_955)
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
                            }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_958))
                          : (_ctx.portTool(_ctx.selected, p))
                            ? (_openBlock(), _createElementBlock("a", {
                                key: 1,
                                href: "#",
                                title: _ctx.portTool(_ctx.selected, p).title,
                                onClick: _withModifiers($event => (_ctx.openPortTool(_ctx.selected, p)), ["prevent"])
                              }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_959))
                            : (_openBlock(), _createElementBlock("span", _hoisted_960, _toDisplayString(p), 1 /* TEXT */)),
                        (i < _ctx.selected.ports.length - 1)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_961, ", "))
                          : _createCommentVNode("v-if", true)
                      ], 64 /* STABLE_FRAGMENT */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    (!_ctx.selected.ports.length)
                      ? (_openBlock(), _createElementBlock("span", _hoisted_962, "—"))
                      : _createCommentVNode("v-if", true)
                  ]),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[288] || (_cache[288] = $event => (_ctx.copyField(_ctx.t('Open ports'), _ctx.selected.ports.join(', '))))
                  }, _hoisted_965, 8 /* PROPS */, _hoisted_963)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Found by')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.selected.sources.join(', ')), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[289] || (_cache[289] = $event => (_ctx.copyField(_ctx.t('Found by'), _ctx.selected.sources.join(', '))))
                  }, _hoisted_968, 8 /* PROPS */, _hoisted_966)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('First seen')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.stamp(_ctx.selected.firstSeen)), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[290] || (_cache[290] = $event => (_ctx.copyField(_ctx.t('First seen'), _ctx.stamp(_ctx.selected.firstSeen))))
                  }, _hoisted_971, 8 /* PROPS */, _hoisted_969)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Last seen')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.stamp(_ctx.selected.lastSeen)), 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs ib copy-one",
                    title: _ctx.t('Copy this'),
                    "aria-label": _ctx.t('Copy this'),
                    onClick: _cache[291] || (_cache[291] = $event => (_ctx.copyField(_ctx.t('Last seen'), _ctx.stamp(_ctx.selected.lastSeen))))
                  }, _hoisted_974, 8 /* PROPS */, _hoisted_972)
                ]),
                (_ctx.selected.extra && _ctx.selected.extra.mdns)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_975, [
                      _hoisted_976,
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.extra.mdns), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[292] || (_cache[292] = $event => (_ctx.copyField('mDNS', _ctx.selected.extra.mdns)))
                      }, _hoisted_979, 8 /* PROPS */, _hoisted_977)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.extra && _ctx.selected.extra.rdns)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_980, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Reverse DNS')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.extra.rdns), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[293] || (_cache[293] = $event => (_ctx.copyField(_ctx.t('Reverse DNS'), _ctx.selected.extra.rdns)))
                      }, _hoisted_983, 8 /* PROPS */, _hoisted_981)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.extra && _ctx.selected.extra.ssdp)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_984, [
                      _hoisted_985,
                      _createElementVNode("code", _hoisted_986, _toDisplayString(_ctx.selected.extra.ssdp), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib copy-one",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[294] || (_cache[294] = $event => (_ctx.copyField('SSDP', _ctx.selected.extra.ssdp)))
                      }, _hoisted_989, 8 /* PROPS */, _hoisted_987)
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("label", _hoisted_990, [
                      _createElementVNode("span", _hoisted_991, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[295] || (_cache[295] = $event => ((_ctx.editType) = $event))
                      }, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.typeLabels, (l, k) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: k,
                            value: k
                          }, _toDisplayString(_ctx.t(l)), 9 /* TEXT, PROPS */, _hoisted_992))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.editType]
                      ])
                    ]),
                    _createElementVNode("label", _hoisted_993, [
                      _createElementVNode("span", _hoisted_994, _toDisplayString(_ctx.t('Tags')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[296] || (_cache[296] = $event => ((_ctx.editTags) = $event)),
                        placeholder: _ctx.t('office, 2F, spare')
                      }, null, 8 /* PROPS */, _hoisted_995), [
                        [_vModelText, _ctx.editTags]
                      ])
                    ]),
                    _createElementVNode("label", _hoisted_996, [
                      _createElementVNode("span", _hoisted_997, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[297] || (_cache[297] = $event => ((_ctx.editNotes) = $event)),
                        rows: "2"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.editNotes]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : (_ctx.selected.tags.length || _ctx.selected.notes)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_998, [
                      (_ctx.selected.tags.length)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_999, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Tags')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.selected.tags.join(', ')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.selected.notes)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_1000, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                            _createElementVNode("code", _hoisted_1001, _toDisplayString(_ctx.selected.notes), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]))
                  : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_1002, [
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
                        }, "🖥 " + _toDisplayString(l.label), 9 /* TEXT, PROPS */, _hoisted_1003))
                      : _createCommentVNode("v-if", true),
                    (_ctx.allowed('preview') && _ctx.status.preview)
                      ? (_openBlock(), _createElementBlock("button", {
                          key: 1,
                          class: "btn sm ib",
                          title: _ctx.t('Show the page'),
                          "aria-label": _ctx.t('Show the page'),
                          onClick: $event => (_ctx.showPage(l.href))
                        }, "🖼", 8 /* PROPS */, _hoisted_1004))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("a", {
                      class: "btn sm ib",
                      href: l.href,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      title: _ctx.t('Only works from inside that network'),
                      "aria-label": _ctx.t('Only works from inside that network')
                    }, _hoisted_1007, 8 /* PROPS */, _hoisted_1005)
                  ]))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              _createCommentVNode(" A device on another network answers nothing, so the two\n               searches below would report \"nothing found\" when the truth is\n               \"never asked\". Say which it is, and say what would fix it. "),
              (_ctx.offNetwork(_ctx.selected))
                ? (_openBlock(), _createElementBlock("div", _hoisted_1008, [
                    _createElementVNode("p", null, [
                      _createElementVNode("strong", null, _toDisplayString(_ctx.t('This device is not on the same network as the Nextcloud server.')), 1 /* TEXT */),
                      _createTextVNode(" " + _toDisplayString(_ctx.t('To connect to its address or scan its ports, the Nextcloud server needs an address on the same network as this device.')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("p", null, _toDisplayString(_ctx.t('Open a console over SSH or similar and run the following command with administrator privileges.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_1009, [
                      _createElementVNode("code", _hoisted_1010, _toDisplayString(_ctx.joinCommand(_ctx.selected)), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn xs ib",
                        title: _ctx.t('Copy this'),
                        "aria-label": _ctx.t('Copy this'),
                        onClick: _cache[298] || (_cache[298] = $event => (_ctx.copyField(_ctx.t('Command'), _ctx.joinCommand(_ctx.selected))))
                      }, _hoisted_1013, 8 /* PROPS */, _hoisted_1011)
                    ]),
                    (_ctx.serverAddress && _ctx.allowed('sshexec'))
                      ? (_openBlock(), _createElementBlock("p", _hoisted_1014, [
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[299] || (_cache[299] = $event => (_ctx.askSsh(_ctx.serverAddress, 22)))
                          }, "🖳 " + _toDisplayString(_ctx.t('Open an SSH window')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("p", _hoisted_1015, _toDisplayString(_ctx.t('Note that the setting is erased when the server restarts.')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_1016, [
                _createCommentVNode(" Asking this one device what a sweep has no time to ask: every\n                 port it has, and which of those are really web pages. "),
                (_ctx.allowed('scan'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 0,
                      class: "btn sm",
                      disabled: !!_ctx.deep.busy || _ctx.offNetwork(_ctx.selected),
                      onClick: _cache[300] || (_cache[300] = $event => (_ctx.scanAllPorts(_ctx.selected)))
                    }, " 🔎 " + _toDisplayString(_ctx.deep.busy === 'ports' ? _ctx.t('Scanning… {done}%', { done: _ctx.deep.percent }) : _ctx.t('Scan every port')), 9 /* TEXT, PROPS */, _hoisted_1017))
                  : _createCommentVNode("v-if", true),
                (_ctx.allowed('scan'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 1,
                      class: "btn sm",
                      disabled: !!_ctx.deep.busy || !_ctx.selected.ports.length || _ctx.offNetwork(_ctx.selected),
                      onClick: _cache[301] || (_cache[301] = $event => (_ctx.findWebPages(_ctx.selected)))
                    }, " 🌐 " + _toDisplayString(_ctx.deep.busy === 'web' ? _ctx.t('Looking…') : _ctx.t('Find web pages')), 9 /* TEXT, PROPS */, _hoisted_1018))
                  : _createCommentVNode("v-if", true),
                _createCommentVNode(" A device's page is not always on a port the scan noticed, and\n                 a maker is free to put it anywhere, so the number can simply\n                 be typed. "),
                (_ctx.allowed('preview'))
                  ? (_openBlock(), _createElementBlock("span", {
                      key: 2,
                      class: "port-open",
                      title: _ctx.t('Opens a page on this device at a port of your choosing, through this server.')
                    }, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[302] || (_cache[302] = $event => ((_ctx.openPort) = $event)),
                        class: "tiny",
                        inputmode: "numeric",
                        placeholder: _ctx.t('Port'),
                        "aria-label": _ctx.t('Port'),
                        onKeyup: _cache[303] || (_cache[303] = _withKeys((...args) => (_ctx.openTypedPort && _ctx.openTypedPort(...args)), ["enter"]))
                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_1020), [
                        [_vModelText, _ctx.openPort]
                      ]),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[304] || (_cache[304] = $event => ((_ctx.openScheme) = $event)),
                        "aria-label": _ctx.t('Protocol')
                      }, _hoisted_1024, 8 /* PROPS */, _hoisted_1021), [
                        [_vModelSelect, _ctx.openScheme]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        disabled: !_ctx.openPortReady,
                        onClick: _cache[305] || (_cache[305] = (...args) => (_ctx.openTypedPort && _ctx.openTypedPort(...args)))
                      }, "🖥 " + _toDisplayString(_ctx.t('Open this port')), 9 /* TEXT, PROPS */, _hoisted_1025)
                    ], 8 /* PROPS */, _hoisted_1019))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.mac && _ctx.allowed('wol'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 3,
                      class: "btn sm",
                      onClick: _cache[306] || (_cache[306] = $event => (_ctx.wake(_ctx.selected)))
                    }, "⏻ " + _toDisplayString(_ctx.t('Wake on LAN')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createCommentVNode(" What the two searches came back with, for this device. "),
              (_ctx.deep.note || _ctx.deep.pages.length)
                ? (_openBlock(), _createElementBlock("div", _hoisted_1026, [
                    (_ctx.deep.note)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_1027, _toDisplayString(_ctx.deep.note), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    (_ctx.deep.pages.length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_1028, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.deep.pages, (page) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: page.port
                            }, [
                              _createElementVNode("span", _hoisted_1029, _toDisplayString(page.scheme) + " · " + _toDisplayString(page.port), 1 /* TEXT */),
                              _createElementVNode("code", null, [
                                _createTextVNode(_toDisplayString(page.title || page.server || _ctx.t('a page')), 1 /* TEXT */),
                                (_ctx.allowed('preview'))
                                  ? (_openBlock(), _createElementBlock("button", {
                                      key: 0,
                                      class: "btn xs",
                                      onClick: $event => (_ctx.openDeviceWindow(_ctx.selected, page.port, page.scheme))
                                    }, _toDisplayString(_ctx.t('Open')), 9 /* TEXT, PROPS */, _hoisted_1030))
                                  : _createCommentVNode("v-if", true)
                              ])
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 512 /* NEED_PATCH */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_1031, [
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger sm",
                    onClick: _cache[307] || (_cache[307] = $event => (_ctx.removeDevice(_ctx.selected)))
                  }, _toDisplayString(_ctx.t('Forget this device')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_1032,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[308] || (_cache[308] = $event => (_ctx.selected=null))
              }, _toDisplayString(_ctx.allowed('scan') ? _ctx.t('Cancel') : _ctx.t('Close')), 1 /* TEXT */),
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("button", {
                    key: 1,
                    class: "btn primary",
                    onClick: _cache[309] || (_cache[309] = (...args) => (_ctx.saveDevice && _ctx.saveDevice(...args)))
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
    { id: 'files', icon: '📁', label: 'FTP & SFTP', hint: 'Browse a remote server and move files' },
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
  const SPLIT_PREFIXES = [22, 23, 24, 25, 26, 27, 28, 29, 30];
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
        version: '', tab: 'devices', banner: null, authenticated: true,
        // On a narrow screen the tool list is a drawer rather than a column,
        // and a device's page fills the screen instead of floating over it.
        menu: false, narrow: window.innerWidth <= 900,
        status: { canScan: false, canLookup: false, isAdmin: false, binaries: {}, nmap: { available: false }, ouiEntries: 0, targets: [] },
        settings: { language: 'auto', theme: 'auto', languages: [], tabOrder: [], keyFolder: '' },
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
        selected: null, editLabel: '', editTags: '', editNotes: '', editType: 'unknown',
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
        sshConn: 0, sshPreset: '', sshCommand: '', sshRunResult: null,
        sshAdhoc: { kind: 'ssh', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh' },
        // A sign-in asked for on the spot, from wherever a console is needed —
        // the notice about a device on another network, for one, where the
        // command has to be run on this server and nowhere else.
        sshAsk: { open: false, host: '', port: 22, username: '', authType: 'password', secret: '', privateKeyPath: '', passphrase: '' },
        telnetAdhoc: { host: '', port: 23 },
        dnsTypes: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA'],
        whoisQuery: '', whoisResult: null,
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
        connections: [], connKinds: {}, connCaps: {}, connModal: false, connNote: '',
        connForm: { id: 0, kind: 'sftp', name: '', host: '', port: 22, mode: 'ssh', username: '', secret: '', authType: 'password', privateKey: '', privateKeyPath: '', passphrase: '', from: '', path: '', passive: true, notes: '', hasSecret: false },
        // mail
        mailView: 'domain', mailViews: MAIL_VIEWS, mailPresets: MAIL_PRESETS,
        mailDomain: '', mailSelectors: '', mailBlocklists: true, mailAudit: null,
        mailHost: '', mailPort: 0, mailProtocol: 'smtp', mailMode: 'auto', mailProbeResult: null,
        relayHost: '', relayPort: 25, relayResult: null, blIp: '', blResult: null,
        sendId: 0, sendTo: '', sendSubject: '', sendBody: '', sendResult: null,
        smtpAdhoc: { kind: 'smtp', host: '', port: 587, mode: 'starttls', username: '', secret: '', from: '' },
        boxAdhoc: { kind: 'imap', host: '', port: 993, mode: 'tls', username: '', secret: '' },
        mailboxId: 0, mailboxResult: null,
        // file transfer
        filesConn: 0, filesPath: '', filesData: null, filesTarget: 'NetBase', filesSource: '', transferNote: '',
        adhocActive: false,
        adhoc: { kind: 'sftp', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh', passive: true, path: '' },
        // service probes
        sshHost: '', sshPort: 22, sshAuthMethods: false, sshResult: null, telnetResult: null,
        ntpHost: 'pool.ntp.org', ntpResult: null, ntpServers: NTP_SERVERS, knownResolvers: KNOWN_RESOLVERS,
        locale: 0,
        picker: { open: false, title: '', path: '', parent: null, entries: [], foldersOnly: false, onPick: null },
        windows: [], terms: [], windowSeq: 0, windowTop: 3000, drag: null,
        rowMenu: { open: false, x: 0, y: 0, device: null },
        preview: { open: false, url: '', src: '', loading: false, error: null, full: false },
        serverResult: null, requirements: null, sysInfo: false, themeBox: false,
        themeOptions: THEME_OPTIONS,
        adminUrl: (window.OC && OC.generateUrl) ? OC.generateUrl('/settings/admin/netbase') : '/settings/admin/netbase',
        liveOn: false, liveIface: '', liveIfaces: [], liveNow: { rx: 0, tx: 0 }, liveRx: [], liveTx: [],
        liveErrors: 0, lastCounters: null, liveTimer: null,
        speedSize: 25, speedUpload: true, speedResult: null,
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
      speedEndpoint() { return (this.speedResult && this.speedResult.endpoint) || 'speed.cloudflare.com'; },
      fileConnections() { return this.connections.filter((c) => c.kind === 'ftp' || c.kind === 'sftp'); },
      sshConnections() { return this.connections.filter((c) => c.kind === 'ssh' || c.kind === 'sftp'); },
      sshPresets() { return this.status.sshPresets || {}; },
      smtpConnections() { return this.connections.filter((c) => c.kind === 'smtp'); },
      mailboxConnections() { return this.connections.filter((c) => c.kind === 'imap' || c.kind === 'pop3'); },
      connModes() { return (this.connKinds[this.connForm.kind] || {}).modes || []; },
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
          list = list.filter((d) => [d.name, d.ip, d.mac, d.vendor, d.hostname, (d.tags || []).join(' ')]
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
          case 'mcast': return T('Multicast discovery complete');
          case 'ports': return T('Checking services ({done} / {total})', v);
          case 'portsAll': return T('Checking ports ({done} / {total})', v);
          case 'rdns': return T('Reverse DNS ({done} / {total})', v);
          default: return scan.message || scan.phase;
        }
      },
      icon(d) { return TYPE_ICON[d.type] || TYPE_ICON.unknown; },
      typeLabel(type) { return TYPE_LABEL[type] || TYPE_LABEL.unknown; },
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
      sortBy(key) { if (this.sortKey === key) { this.sortDir *= -1; } else { this.sortKey = key; this.sortDir = 1; } },
      sortClass(key) { return this.sortKey === key ? (this.sortDir > 0 ? 'sorted asc' : 'sorted desc') : ''; },
      fail(e) { this.banner = { kind: 'error', text: String((e && e.message) || e) }; },
      note(text) { this.banner = { kind: 'info', text }; },

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
      /**
       * A device heard on this wire whose address belongs to somewhere else.
       *
       * It announced itself, so it is certainly here; but nothing on this
       * server can route to it and it cannot answer, so its ports cannot be
       * checked and its pages cannot be opened. Saying so is kinder than
       * letting somebody click and wait.
       */
      offNetwork(device) {
        if (!device || !device.ip || this.isSelf(device)) return false;
        const own = (this.status.targets || []).map((t2) => t2.cidr);
        if (!own.length) return false;
        const value = (ip) => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
        const here = value(device.ip);
        if (!Number.isFinite(here)) return false;
        return !own.some((cidr) => {
          const [net, bitsText] = cidr.split('/');
          const bits = Number(bitsText);
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

      async startScan() {
        if (this.scanning) return;
        this.tab = 'devices';
        const targets = this.scanTargets.split(',').map((x) => x.trim()).filter(Boolean);
        const options = { ...this.opts, pace: this.pace, arpOnly: this.scanWhat === 'arp' };
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

      openDevice(d) {
        this.selected = d;
        this.editLabel = d.label || '';
        this.editTags = (d.tags || []).join(', ');
        this.editNotes = d.notes || '';
        this.editType = d.type || 'unknown';
      },
      async saveDevice() {
        try {
          const r = await api('devices/' + this.selected.id, {
            method: 'PATCH',
            body: JSON.stringify({ label: this.editLabel, tags: this.editTags, notes: this.editNotes, dtype: this.editType, known: true }),
          });
          const i = this.devices.findIndex((d) => d.id === r.device.id);
          if (i >= 0) this.devices.splice(i, 1, r.device);
          this.selected = null;
        } catch (e) { this.fail(e); }
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
        } catch (e) {
          live.error = e.message || String(e);
        }
        live.busy = false;
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
        try { here = frame.contentWindow.location.pathname + frame.contentWindow.location.search; } catch (e) { return; }
        if (!here || !w.url) return;
        const prefix = w.url.replace(/\/$/, '');
        if (here.indexOf(prefix) === 0) {
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
        if (w.escapes > 2) { w.error = T('This page keeps leaving the device window.'); return; }
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
      windowToast(w, text, kind = 'ok') {
        w.toast = { text, kind };
        const shown = text;
        setTimeout(() => { if (w.toast && w.toast.text === shown) { w.toast = null; } }, kind === 'error' ? 8000 : 4000);
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
      closeWindow(w) { this.windows = this.windows.filter((x) => x.id !== w.id); },

      // ---- terminal windows: the same frame as a device window, holding a
      // line of text rather than a page ----
      /**
       * A terminal for one device, opened beside the list rather than instead
       * of it. Ports 22 and 23 used to change tab, which closed the device and
       * left no way back to where the person was.
       */
      openTerminal(kind, host, port, auth = null) {
        const offset = this.narrow ? 0 : (this.terms.length % 6) * 26;
        const w = {
          id: ++this.windowSeq, kind, host, port: port || (kind === 'telnet' ? 23 : 22),
          user: '', password: '', signedIn: kind !== 'telnet', prompt: '',
          lines: [], command: '', history: [], at: -1, busy: false, cwd: '', full: false,
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
        if (kind === 'ssh') {
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
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
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
        term.onData((data) => this.ptyType(w, data));
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
          while (live.outbox) {
            const chunk = live.outbox;
            live.outbox = '';
            try {
              await api('ssh/pty/type', { method: 'POST', body: JSON.stringify({ session: w.sid, data: chunk }) });
            } catch (e) { /* the stream reports a lost session; a lost key need not */ }
          }
          live.sending = false;
        })();
      },
      async ptySize(w, cols, rows) {
        if (!w.sid) return;
        try {
          await api('ssh/pty/size', { method: 'POST', body: JSON.stringify({ session: w.sid, cols, rows }) });
        } catch (e) { /* the next redraw will sort itself out */ }
      },
      clearTerm(w) {
        const live = SCREENS.get(w.id);
        if (live) { live.term.clear(); return; }
        w.lines = [];
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
        if (w.sid) api('ssh/pty/close', { method: 'POST', body: JSON.stringify({ session: w.sid }) }).catch(() => {});
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
      openTelnetWindow() {
        if (!this.telnetAdhoc.host) return;
        this.openTerminal('telnet', this.telnetAdhoc.host, this.telnetAdhoc.port || 23);
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
        this.sshConn = 0;
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
        if (at) w.src = at + (at.includes('?') ? '&' : '?') + '_nb=' + Date.now();
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
          this.adhoc = { ...this.adhoc, kind: tool.kind, host: device.ip, port: port === 22 ? 22 : 21, mode: tool.kind === 'ftp' ? 'none' : 'ssh' };
        } else if (tool.tab === 'ssh') {
          this.sshHost = device.ip;
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
        return { none: 'None (plain text)', starttls: 'STARTTLS', tls: 'TLS from the start', ssh: 'SSH (always encrypted)' }[mode] || mode;
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
        this.connCaps = r.capabilities || {};
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
            notes: existing.notes || '', hasSecret: !!existing.hasSecret,
          };
        } else {
          const use = kind || 'sftp';
          const def = this.connKinds[use] || { port: 22, modes: ['none'] };
          this.connForm = { id: 0, kind: use, name: '', host: '', port: def.port, mode: def.modes[0], username: '', secret: '', authType: 'password', privateKey: '', privateKeyPath: '', passphrase: '', from: '', path: '', passive: true, notes: '', hasSecret: false };
        }
        this.connModal = true;
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
        if (!this.filesConn && (saved.connection.kind === 'ftp' || saved.connection.kind === 'sftp')) this.filesConn = saved.connection.id;
        if (!this.sendId && saved.connection.kind === 'smtp') this.sendId = saved.connection.id;
        if (!this.mailboxId && (saved.connection.kind === 'imap' || saved.connection.kind === 'pop3')) this.mailboxId = saved.connection.id;
      },
      async deleteConn(conn) {
        if (!conn || !conn.id) return;
        const r = await this.guarded('conn', () => api('connections/' + conn.id, { method: 'DELETE' }));
        if (!r) return;
        if (this.filesConn === conn.id) { this.filesConn = 0; this.filesData = null; }
        if (this.sendId === conn.id) this.sendId = 0;
        if (this.mailboxId === conn.id) this.mailboxId = 0;
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
      async runSend() {
        const body = { id: this.sendId, to: this.sendTo, subject: this.sendSubject, body: this.sendBody, connection: this.sendId ? {} : { ...this.smtpAdhoc } };
        this.sendResult = await this.guarded('send', () => api('mail/send', { method: 'POST', body: JSON.stringify(body) }));
        if (this.sendResult) this.note(this.sendResult.ok ? T('The server accepted the message') : T('Sending failed: {error}', { error: this.sendResult.error }));
      },
      async runMailbox() {
        const body = { id: this.mailboxId, connection: this.mailboxId ? {} : { ...this.boxAdhoc } };
        this.mailboxResult = await this.guarded('mailbox', () => api('mail/login', { method: 'POST', body: JSON.stringify(body) }));
      },
      /** Hand the typed mail details to the editor so they can be kept. */
      saveMailAdhoc(which) {
        const from = which === 'smtp' ? this.smtpAdhoc : this.boxAdhoc;
        this.openConn(null, from.kind);
        this.connForm = { ...this.connForm, ...from, id: 0, name: from.host };
      },

      // ---- FTP / SFTP ----
      // Every call carries either the id of a saved connection or the details
      // of the one-off one, so both work through the same endpoints.
      fileTarget(extra) { return { id: this.filesConn, connection: this.filesConn ? {} : { ...this.adhoc }, ...extra }; },
      adhocKindChanged() {
        const ftp = this.adhoc.kind === 'ftp';
        this.adhoc.port = ftp ? 21 : 22;
        this.adhoc.mode = ftp ? 'none' : 'ssh';
        this.adhoc.authType = 'password';
      },
      useSaved() { this.adhocActive = false; this.browse(''); },
      async quickConnect() {
        this.filesConn = 0;
        this.adhocActive = true;
        await this.browse(this.adhoc.path || '');
        if (!this.filesData) this.adhocActive = false;
      },
      disconnect() { this.adhocActive = false; this.filesData = null; this.transferNote = ''; },
      /** Hand the one-off details to the editor so they can be named and kept. */
      saveAdhoc() {
        this.openConn(null, this.adhoc.kind);
        this.connForm = { ...this.connForm, ...this.adhoc, id: 0, name: this.adhoc.host, privateKey: '' };
      },
      async browse(path) {
        if (!this.filesConn && !this.adhocActive) { this.filesData = null; return; }
        const query = this.filesConn
          ? qs({ id: this.filesConn, path: path || '' })
          // Booleans have to travel as 1/0: PHP reads the string "false" as true.
          : qs({ id: 0, path: path || '', ...Object.fromEntries(Object.entries(this.adhoc).map(([k, v]) => ['connection[' + k + ']', typeof v === 'boolean' ? (v ? 1 : 0) : v])) });
        const r = await this.guarded('browse', () => api('files/list?' + query));
        if (!r) return;
        this.filesData = r;
        this.filesPath = r.path;
      },
      async downloadFile(entry) {
        const r = await this.guarded('dl', () => api('files/download', { method: 'POST', body: JSON.stringify(this.fileTarget({ path: this.joinPath(this.filesData.path, entry.name), target: this.filesTarget })) }));
        if (r) this.transferNote = T('{name} saved to {folder} ({size})', { name: r.name, folder: this.filesTarget || '/', size: this.fmtBytes(r.bytes) });
      },
      async uploadFile() {
        const r = await this.guarded('ul', () => api('files/upload', { method: 'POST', body: JSON.stringify(this.fileTarget({ source: this.filesSource, remoteDir: this.filesData ? this.filesData.path : '' })) }));
        if (r) { this.transferNote = T('Uploaded to {path} ({size})', { path: r.remote, size: this.fmtBytes(r.bytes) }); this.browse(this.filesPath); }
      },
      async fileAction(action, entry) {
        let path = entry ? this.joinPath(this.filesData.path, entry.name) : '';
        let extra = '';
        if (action === 'mkdir') {
          const name = window.prompt(T('Name for the new folder'));
          if (!name) return;
          path = this.joinPath(this.filesData.path, name);
        } else if (action === 'rename') {
          const name = window.prompt(T('New name'), entry.name);
          if (!name || name === entry.name) return;
          extra = this.joinPath(this.filesData.path, name);
        } else if (!window.confirm(T('Delete {name} from the server?', { name: entry.name }))) {
          return;
        }
        const r = await this.guarded('fileact', () => api('files/manage', { method: 'POST', body: JSON.stringify(this.fileTarget({ action, path, extra })) }));
        if (r) this.browse(this.filesData.path);
      },

      // ---- SSH / Telnet / NTP ----
      async runSsh() {
        this.rememberHost(this.sshHost); this.sshResult = await this.guarded('ssh', () => api('probe/ssh?' + qs({ host: this.sshHost, port: this.sshPort || 22, authMethods: this.sshAuthMethods ? 1 : 0 }))); },
      async runTelnet() { this.telnetResult = await this.guarded('telnet', () => api('probe/telnet?' + qs({ host: this.sshHost, port: 23 }))); },
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
      openConsole() {
        const conn = this.connById(this.sshConn);
        if (!conn) { this.quickConsole(); return; }
        const w = this.openTerminal('ssh', conn.host, conn.port || 22);
        w.user = conn.username || '';
        w.cwd = (conn.options && conn.options.path) || '';
        w.conn = conn.id;
      },
      /** A console for details typed here and now, without saving them first. */
      async quickConsole() {
        this.sshConn = 0;
        const a = this.sshAdhoc;
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
      async runSpeed() {
        this.speedResult = await this.guarded('speed', () => api('bench/speedtest', {
          method: 'POST', body: JSON.stringify({ megabytes: this.speedSize, upload: this.speedUpload }),
        }));
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
          whois: () => [named(T('Whois'), this.whoisResult)],
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
          this.t(TYPE_LABEL[d.type] || d.type || ''), (d.ports || []).join(' '),
        ].join('\t'));
        return ['status\tip\tname\tmac\tvendor\ttype\tports', ...rows].join('\n');
      },
      /** Text onto the clipboard, whichever way this browser allows. */
      async copyText(text, said) {
        if (!text) return;
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
        this.note(said || T('Copied'));
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
          [T('Type'), T(this.typeLabels[device.type] || device.type || '')],
          [T('Open ports'), (device.ports || []).join(', ')],
          [T('Found by'), (device.sources || []).join(', ')],
          [T('First seen'), stamp(device.firstSeen)],
          [T('Last seen'), stamp(device.lastSeen)],
          ['mDNS', extra.mdns || ''],
          [T('Reverse DNS'), extra.rdns || ''],
          ['SSDP', extra.ssdp || ''],
          [T('Tags'), (device.tags || []).join(', ')],
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
        const head = ['name', 'ip', 'mac', 'vendor', 'type', 'ports', 'workgroup', 'tags', 'firstSeen', 'lastSeen', 'online'];
        const rows = this.shownDevices.map((d) => [
          d.name, d.ip, d.mac, this.vendorText(d), d.type, d.ports.join(' '), d.workgroup,
          (d.tags || []).join(' '), stamp(d.firstSeen), stamp(d.lastSeen), d.online ? 'yes' : 'no',
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
        // Saved connections are shared by the mail and file tabs; fetch them the
        // first time either one is opened.
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
