/* NetBase — Nextcloud native SPA (buildless Vue 3).
 * A device list built from a privilege-free LAN sweep, with the everyday
 * lookup tools (DNS, whois, ping, ports, TLS, subnet maths, nmap) beside it.
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

  const TEMPLATE = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="logo"><svg viewBox="333 400 1335 1030"><path d="M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z" fill="none" stroke="#fff" stroke-width="100" stroke-linejoin="round" stroke-linecap="round"/><path d="M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z" fill="#2e3192"/><path d="M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z" fill="none" stroke="#fff" stroke-width="100" stroke-linejoin="round" stroke-linecap="round"/><path d="M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z" fill="#2970e2"/></svg></span><span>NetBase</span><span class="tag" v-if="version">v{{ version }}</span></div>
      <nav class="nav-list">
        <button v-for="item in visibleTabs" :key="item.id" class="nav-item" :class="{active: tab===item.id}" @click="tab=item.id">
          <span class="ic">{{ item.icon }}</span><span class="nm">{{ t(item.label) }}</span>
          <span class="ct" v-if="item.id==='devices' && devices.length">{{ onlineCount }}</span>
        </button>
      </nav>
      <div class="sidebar-foot">
        <button class="btn primary block" v-if="status.canScan" :disabled="scanning" @click="startScan()">{{ scanning ? t('Scanning…') : t('🛰️ Scan the network') }}</button>
        <button class="btn sm block" v-if="status.isAdmin" @click="openSysInfo">{{ t('🖥 System information') }}</button>
        <button class="btn sm block" @click="themeBox = true">{{ t('🎨 Appearance') }}</button>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div class="title"><span class="ic">{{ currentTab.icon }}</span><span class="nm">{{ t(currentTab.label) }}</span><span class="desc">{{ t(currentTab.hint) }}</span></div>
        <div class="spacer"></div>
        <div class="topbar-actions" v-if="tab==='devices'">
          <input class="filter" v-model="filter" :placeholder="t('Filter by name, IP, MAC or vendor')">
          <button class="btn sm" @click="onlyOnline=!onlyOnline" :class="{active: onlyOnline}">{{ onlyOnline ? t('Online only') : t('All records') }}</button>
          <button class="btn sm" @click="exportCsv" :disabled="!shownDevices.length">{{ t('⤓ CSV') }}</button>
        </div>
      </div>

      <div class="content">
        <div v-if="banner" class="banner" :class="banner.kind">
          <span>{{ banner.text }}</span>
          <button class="btn xs" @click="banner=null">✕</button>
        </div>

        <!-- ============ devices ============ -->
        <section v-if="tab==='devices'">
          <div class="card scan-card" v-if="allowed('scan')">
            <div class="scan-row">
              <label class="fl">
                <span class="fl-label">{{ t('Networks to scan') }}</span>
                <input v-model="scanTargets" :placeholder="suggestedPlaceholder">
              </label>
              <label class="fl narrow">
                <span class="fl-label">{{ t('Pace') }}</span>
                <select v-model="pace">
                  <option value="fast">{{ t('Fast') }}</option>
                  <option value="gentle">{{ t('Gentle') }}</option>
                </select>
              </label>
              <button class="btn primary" :disabled="scanning" @click="startScan()">{{ scanning ? t('Scanning…') : t('Start') }}</button>
              <button class="btn" v-if="scanning" @click="cancelScan">{{ t('Stop') }}</button>
            </div>
            <div class="scan-opts">
              <label><input type="checkbox" v-model="opts.names"> {{ t('Ask devices for their names') }}</label>
              <label><input type="checkbox" v-model="opts.multicast"> {{ t('Multicast discovery') }}</label>
              <label><input type="checkbox" v-model="opts.ports"> {{ t('Check common ports') }}</label>
              <label><input type="checkbox" v-model="opts.rdns"> {{ t('Reverse DNS') }}</label>
              <label><input type="checkbox" v-model="opts.arpOnly"> {{ t('Read neighbour table only (instant)') }}</label>
            </div>
            <div class="progress" v-if="scan">
              <div class="bar"><div class="fill" :style="{width: scan.percent + '%'}"></div></div>
              <div class="progress-text"><span>{{ progressText(scan) }}</span><span class="spacer"></span><span>{{ scan.percent }}%</span></div>
            </div>
            <p class="hint" v-if="advice && !advice.ok">
              ⚠ {{ t('This target has {hosts} addresses but the kernel neighbour table holds {gc3}. The sweep still works, but the kernel will log overflow warnings. To avoid that, an administrator can run:', { hosts: advice.hosts, gc3: advice.gc3 }) }}
              <code>{{ advice.advice }}</code>
            </p>
          </div>

          <div v-if="!shownDevices.length" class="empty-hint">{{ allowed('scan') ? t('No devices recorded yet. Start a scan to build the list.') : t('No devices have been recorded yet. An administrator has to run a scan first.') }}</div>
          <table v-else class="grid">
            <thead>
              <tr>
                <th class="c-dot"></th>
                <th @click="sortBy('name')" :class="sortClass('name')">{{ t('Name') }}</th>
                <th @click="sortBy('ip')" :class="sortClass('ip')">{{ t('IPv4') }}</th>
                <th @click="sortBy('mac')" :class="sortClass('mac')">{{ t('MAC address') }}</th>
                <th @click="sortBy('vendor')" :class="sortClass('vendor')">{{ t('Vendor') }}</th>
                <th @click="sortBy('type')" :class="sortClass('type')">{{ t('Type') }}</th>
                <th>{{ t('Open ports') }}</th>
                <th @click="sortBy('lastSeen')" :class="sortClass('lastSeen')">{{ t('Last seen') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in shownDevices" :key="d.id" @click="openDevice(d)" :class="{offline: !d.online}">
                <td class="c-dot"><span class="dot" :class="{on: d.online}" :title="d.online ? t('Online') : t('Not seen in the last sweep')"></span></td>
                <td class="c-name"><span class="ic">{{ icon(d) }}</span><span class="nm">{{ d.name }}</span><span class="badge" v-if="d.label">{{ t('named') }}</span></td>
                <td class="mono">{{ d.ip }}</td>
                <td class="mono dim">{{ d.mac || '—' }}</td>
                <td>{{ vendorText(d) }}</td>
                <td>{{ t(typeLabel(d.type)) }}</td>
                <td class="mono dim ports-cell" @click.stop>
                  <template v-for="(p,i) in d.ports" :key="p">
                    <a v-if="portLink(d, p)" :href="portLink(d, p).href" :title="portLink(d, p).title" target="_blank" rel="noopener noreferrer">{{ p }}</a>
                    <a v-else-if="portTool(d, p)" href="#" :title="portTool(d, p).title" @click.prevent="openPortTool(d, p)">{{ p }}</a>
                    <span v-else>{{ p }}</span><span v-if="i < d.ports.length - 1">, </span>
                  </template>
                  <span v-if="!d.ports.length">—</span>
                </td>
                <td class="dim">{{ ago(d.lastSeen) }}</td>
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
                <button class="btn primary" :disabled="busy.dns" @click="runDns">{{ t('Look up') }}</button>
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
                <input v-model="dnsServer" class="short" :placeholder="t('Resolver (blank = this server)')">
                <button class="btn primary" :disabled="busy.dnsq" @click="runDnsQuery">{{ t('Ask') }}</button>
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
                <button class="btn primary" :disabled="busy.dnsc" @click="runDnsCompare">{{ t('Compare resolvers') }}</button>
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
                <button class="btn primary" :disabled="busy.dnst" @click="runDnsTrace">{{ t('Trace from the root') }}</button>
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
                <button class="btn primary" :disabled="busy.axfr" @click="runAxfr">{{ t('Test zone transfer') }}</button>
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
          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="whoisQuery" :placeholder="t('Domain name or IP address')" @keyup.enter="runWhois">
              <button class="btn primary" :disabled="busy.whois" @click="runWhois">{{ t('Look up') }}</button>
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
        </section>

        <!-- ============ ping / traceroute ============ -->
        <section v-if="tab==='ping'">
          <div class="card tool-card">
            <div class="tool-row">
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

        <!-- ============ ports ============ -->
        <section v-if="tab==='ports'">
          <div class="card tool-card">
            <div class="tool-row">
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

        <!-- ============ tls / http ============ -->
        <section v-if="tab==='tls'">
          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="tlsHost" :placeholder="t('example.com')" @keyup.enter="runTls">
              <input v-model.number="tlsPort" class="tiny" type="number">
              <button class="btn primary" :disabled="busy.tls" @click="runTls">{{ t('Inspect certificate') }}</button>
              <button class="btn" :disabled="busy.http" @click="runHttp">{{ t('HTTP headers') }}</button>
              <button class="btn" :disabled="busy.tlsver" @click="runTlsVersions">{{ t('Which TLS versions?') }}</button>
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
              <label class="inline-check"><input type="checkbox" v-model="speedUpload"> {{ t('Also test upload') }}</label>
              <span class="spacer"></span>
              <button class="btn primary" :disabled="busy.speed" @click="runSpeed">{{ busy.speed ? t('Measuring…') : t('Run') }}</button>
            </div>
            <p class="hint">{{ t('Traffic is exchanged with {host}. Nothing but the test payload is sent.', {host: speedEndpoint}) }}</p>
            <div class="bench-results" v-if="speedResult">
              <div class="big"><span class="lbl">↓ {{ t('Download') }}</span><span class="num">{{ speedResult.download ? speedResult.download.mbps : '—' }}</span><span class="unit">Mbps</span></div>
              <div class="big"><span class="lbl">↑ {{ t('Upload') }}</span><span class="num">{{ speedResult.upload ? speedResult.upload.mbps : '—' }}</span><span class="unit">Mbps</span></div>
              <div class="big"><span class="lbl">{{ t('Latency') }}</span><span class="num">{{ speedResult.latency ? speedResult.latency.avg : '—' }}</span><span class="unit">ms</span></div>
              <div class="big"><span class="lbl">{{ t('Jitter') }}</span><span class="num">{{ speedResult.latency && speedResult.latency.jitter != null ? speedResult.latency.jitter : '—' }}</span><span class="unit">ms</span></div>
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
                <button class="btn primary" :disabled="busy.iperf" @click="runIperf">{{ busy.iperf ? t('Measuring…') : t('Run') }}</button>
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
              <button class="btn primary" :disabled="busy.dnsbench" @click="runDnsBench">{{ busy.dnsbench ? t('Measuring…') : t('Compare') }}</button>
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
              <button class="btn primary" :disabled="busy.timing" @click="runTiming">{{ t('Measure') }}</button>
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
            <div class="tool-row">
              <input v-model="subnetInput" placeholder="192.168.1.10/24" @keyup.enter="runSubnet">
              <button class="btn primary" @click="runSubnet">{{ t('Calculate') }}</button>
            </div>
          </div>
          <div class="card" v-if="subnetResult">
            <div class="kv">
              <div v-for="(v,k) in subnetResult" :key="k"><span>{{ t(fieldLabel(k)) }}</span><code>{{ v }}</code></div>
            </div>
          </div>
          <div class="card tool-card">
            <h3>{{ t('Split into smaller networks') }}</h3>
            <div class="tool-row">
              <input v-model="splitCidr" class="short" placeholder="192.168.0.0/16">
              <select v-model.number="splitPrefix" class="tiny"><option v-for="p in splitPrefixes" :key="p" :value="p">/{{ p }}</option></select>
              <button class="btn" :disabled="busy.split" @click="runSplit">{{ t('Split') }}</button>
            </div>
            <table class="grid compact" v-if="splitResult">
              <thead><tr><th>{{ t('Network') }}</th><th>{{ t('First host') }}</th><th>{{ t('Last host') }}</th><th>{{ t('Broadcast') }}</th><th>{{ t('Hosts') }}</th></tr></thead>
              <tbody><tr v-for="(n,i) in splitResult.subnets" :key="i"><td class="mono">{{ n.cidr }}</td><td class="mono dim">{{ n.firstHost }}</td><td class="mono dim">{{ n.lastHost }}</td><td class="mono dim">{{ n.broadcast }}</td><td class="mono">{{ n.hosts }}</td></tr></tbody>
            </table>
          </div>

          <div class="card tool-card">
            <h3>{{ t('Combine addresses into the fewest networks') }}</h3>
            <textarea v-model="aggregateInput" rows="3" class="mono tiny" :placeholder="t('192.168.1.0/24, 192.168.2.0/24, 10.0.0.5, 10.0.0.8-10.0.0.20')"></textarea>
            <div class="tool-row">
              <button class="btn" :disabled="busy.aggregate" @click="runAggregate">{{ t('Combine') }}</button>
            </div>
            <div class="kv" v-if="aggregateResult">
              <div><span>{{ t('Blocks') }}</span><code class="wrap">{{ aggregateResult.blocks.join(', ') }}</code></div>
              <div><span>{{ t('Ranges') }}</span><code class="wrap">{{ aggregateResult.ranges.join(', ') }}</code></div>
              <div><span>{{ t('Addresses covered') }}</span><code>{{ aggregateResult.addresses }}</code></div>
            </div>
          </div>

          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="macQuery" :placeholder="t('MAC address, e.g. 00:1b:a9:3f:8d:fe')" @keyup.enter="runMac">
              <button class="btn" @click="runMac">{{ t('Identify vendor') }}</button>
            </div>
            <div class="kv" v-if="macResult">
              <div><span>{{ t('Vendor') }}</span><code>{{ macResult.vendor || (macResult.local ? t('Randomised (privacy) address') : t('Not registered')) }}</code></div>
              <div><span>{{ t('Prefix') }}</span><code>{{ macResult.prefix }}</code></div>
            </div>
          </div>
        </section>

        <!-- ============ server ============ -->

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
                <button class="btn primary" :disabled="busy.mailAudit" @click="runMailAudit">{{ busy.mailAudit ? t('Checking…') : t('Check this domain') }}</button>
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
                  <option value="tls">{{ t('TLS from the start') }}</option>
                  <option value="none">{{ t('No encryption') }}</option>
                </select>
                <input v-model.number="mailPort" type="number" min="0" max="65535" class="tiny" :placeholder="t('Port')">
                <button class="btn primary" :disabled="busy.mailProbe" @click="runMailProbe">{{ t('Test the server') }}</button>
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
                <button class="btn" :disabled="busy.relay" @click="runRelay">{{ t('Test for open relay') }}</button>
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
                <button class="btn" :disabled="busy.bl" @click="runBlocklist">{{ t('Check') }}</button>
              </div>
              <div class="chips result" v-if="blResult">
                <span v-for="r in blResult.results" :key="r.zone" class="pill" :class="r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')" :title="r.reason || r.zone">{{ r.name }}</span>
              </div>
            </div>
          </template>

          <template v-if="mailView==='send'">
            <div class="card tool-card">
              <h3>{{ t('Send a test message') }}</h3>
              <p class="dim">{{ t('Sends a real message through one of your saved SMTP connections — the honest way to prove that sending works.') }}</p>
              <div class="tool-row">
                <select v-model.number="sendId" class="grow">
                  <option :value="0">{{ t('Choose a saved SMTP connection…') }}</option>
                  <option v-for="c in smtpConnections" :key="c.id" :value="c.id">{{ c.name }} ({{ c.host }})</option>
                </select>
                <button class="btn sm" @click="openConn(null,'smtp')">{{ t('+ Add') }}</button>
              </div>
              <div class="tool-row">
                <input v-model="sendTo" :placeholder="t('Recipient address')">
                <input v-model="sendSubject" :placeholder="t('Subject (optional)')">
              </div>
              <textarea v-model="sendBody" rows="3" :placeholder="t('Message (optional)')"></textarea>
              <div class="tool-row">
                <button class="btn primary" :disabled="busy.send || !sendId || !sendTo" @click="runSend">{{ busy.send ? t('Sending…') : t('Send the test message') }}</button>
              </div>
              <div v-if="sendResult" class="kv">
                <div><span>{{ t('Result') }}</span><code :class="sendResult.ok ? 'good' : 'bad'">{{ sendResult.ok ? t('Accepted by the server') : (sendResult.error || t('Failed')) }}</code></div>
                <div v-if="sendResult.reply"><span>{{ t('Reply') }}</span><code class="wrap">{{ sendResult.reply }}</code></div>
              </div>
              <details v-if="sendResult && sendResult.transcript"><summary>{{ t('Conversation') }}</summary><pre class="raw">{{ sendResult.transcript.join('\n') }}</pre></details>
            </div>

            <div class="card">
              <h3>{{ t('Mailbox check') }}</h3>
              <p class="dim">{{ t('Signs in to a saved IMAP or POP3 account and reports what is in the inbox.') }}</p>
              <div class="tool-row">
                <select v-model.number="mailboxId" class="grow">
                  <option :value="0">{{ t('Choose a saved mailbox…') }}</option>
                  <option v-for="c in mailboxConnections" :key="c.id" :value="c.id">{{ c.name }} ({{ c.kind.toUpperCase() }})</option>
                </select>
                <button class="btn" :disabled="busy.mailbox || !mailboxId" @click="runMailbox">{{ t('Sign in') }}</button>
                <button class="btn sm" @click="openConn(null,'imap')">{{ t('+ Add') }}</button>
              </div>
              <div v-if="mailboxResult" class="kv">
                <div><span>{{ t('Result') }}</span><code :class="mailboxResult.ok ? 'good' : 'bad'">{{ mailboxResult.ok ? t('Signed in') : (mailboxResult.error || t('Failed')) }}</code></div>
                <div v-if="mailboxResult.details && mailboxResult.details.inbox"><span>{{ t('Inbox') }}</span><code>{{ t('{n} messages', {n: mailboxResult.details.inbox.messages}) }} · {{ t('{n} unread', {n: mailboxResult.details.inbox.unseen}) }}</code></div>
                <div v-if="mailboxResult.details && mailboxResult.details.mailbox"><span>{{ t('Mailbox') }}</span><code>{{ t('{n} messages', {n: mailboxResult.details.mailbox.messages}) }}</code></div>
                <div v-if="mailboxResult.details && mailboxResult.details.folders"><span>{{ t('Folders') }}</span><code class="wrap">{{ mailboxResult.details.folders.join(', ') }}</code></div>
              </div>
            </div>
          </template>
        </section>

        <!-- ============ clock check ============ -->
        <section v-if="tab==='ntp'">
          <div class="card tool-card">
            <h3>{{ t('Clock check (NTP)') }}</h3>
            <p class="dim">{{ t('A clock that has drifted is behind more certificate and sign-in failures than anything else.') }}</p>
            <div class="tool-row">
              <input v-model="ntpHost" :placeholder="t('pool.ntp.org')" @keyup.enter="runNtp">
              <button class="btn" :disabled="busy.ntp" @click="runNtp">{{ t('Compare clocks') }}</button>
            </div>
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

        <!-- ============ FTP / SFTP ============ -->
        <section v-if="tab==='files'">
          <div class="card tool-card">
            <h3>{{ t('Enter the connection details') }}</h3>
            <p class="dim">{{ t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.') }}</p>
            <div class="tool-row">
              <select v-model="adhoc.kind" class="tiny" @change="adhocKindChanged">
                <option value="sftp">SFTP</option>
                <option value="ftp">FTP</option>
              </select>
              <input v-model="adhoc.host" class="grow" placeholder="server.example.com" @keyup.enter="quickConnect">
              <input v-model.number="adhoc.port" type="number" class="tiny" min="1" max="65535">
              <input v-model="adhoc.username" class="short" :placeholder="t('User name')" autocomplete="off">
            </div>
            <div class="tool-row">
              <select v-model="adhoc.authType" class="tiny" v-if="adhoc.kind==='sftp'">
                <option value="password">{{ t('Password') }}</option>
                <option value="key">{{ t('Private key') }}</option>
              </select>
              <select v-model="adhoc.mode" class="tiny" v-if="adhoc.kind==='ftp'">
                <option value="none">{{ t('No encryption') }}</option>
                <option value="tls">{{ t('TLS from the start') }}</option>
              </select>
              <input v-if="adhoc.authType==='key' && adhoc.kind==='sftp'" v-model="adhoc.privateKeyPath" class="grow mono" :placeholder="t('Key file in your Nextcloud files')">
              <input v-else v-model="adhoc.secret" type="password" class="short" :placeholder="t('Password')" autocomplete="new-password">
              <input v-model="adhoc.path" class="short mono" :placeholder="t('Start folder (optional)')">
              <button class="btn primary" :disabled="busy.browse || !adhoc.host" @click="quickConnect">{{ t('Connect') }}</button>
              <button class="btn" :disabled="!adhoc.host" @click="saveAdhoc">{{ t('Save to the list') }}</button>
            </div>
            <p class="dim" v-if="adhoc.kind==='ftp' && !adhoc.username">{{ t('Leave the user name blank to sign in anonymously.') }}</p>
          </div>

          <div class="card tool-card">
            <div class="tool-row">
              <select v-model.number="filesConn" class="grow" @change="useSaved">
                <option :value="0">{{ t('Choose a saved FTP or SFTP connection…') }}</option>
                <option v-for="c in fileConnections" :key="c.id" :value="c.id">{{ c.name }} — {{ c.kind.toUpperCase() }} {{ c.host }}</option>
              </select>
              <button class="btn sm" @click="openConn(null,'sftp')">{{ t('+ Add connection') }}</button>
              <button class="btn sm" v-if="filesConn" @click="openConn(connById(filesConn))">{{ t('Edit') }}</button>
              <button class="btn sm" v-if="filesConn" :disabled="busy.conntest" @click="testConn(connById(filesConn))">{{ t('Test') }}</button>
            </div>
            <p class="dim" v-if="!connCaps.sftp && !connCaps.ftp">{{ t('Neither FTP nor SFTP is available in this PHP build.') }}</p>
          </div>

          <div class="card" v-if="filesConn || adhocActive">
            <div class="tool-row" v-if="adhocActive">
              <strong class="mono">{{ adhoc.kind.toUpperCase() }} {{ adhoc.username || t('anonymous') }}@{{ adhoc.host }}</strong>
              <span class="spacer"></span>
              <button class="btn sm" @click="saveAdhoc">{{ t('Save this connection') }}</button>
              <button class="btn sm" @click="disconnect">{{ t('Disconnect') }}</button>
            </div>
            <div class="path-bar">
              <button class="btn xs" :disabled="!filesData || !filesData.parent" @click="browse(filesData ? filesData.parent : '')">↑ {{ t('Up') }}</button>
              <input v-model="filesPath" class="mono" @keyup.enter="browse(filesPath)">
              <button class="btn xs" @click="browse(filesPath)">{{ t('Go') }}</button>
              <span class="spacer"></span>
              <button class="btn xs" @click="fileAction('mkdir')">{{ t('New folder') }}</button>
            </div>
            <table class="grid compact" v-if="filesData">
              <thead><tr><th>{{ t('Name') }}</th><th>{{ t('Size') }}</th><th>{{ t('Changed') }}</th><th>{{ t('Rights') }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="e in filesData.entries" :key="e.name" :class="{dir: e.directory}">
                  <td>
                    <a v-if="e.directory" href="#" @click.prevent="browse(joinPath(filesData.path, e.name))">📁 {{ e.name }}</a>
                    <span v-else>📄 {{ e.name }}</span>
                  </td>
                  <td class="mono dim">{{ e.directory ? '' : fmtBytes(e.size) }}</td>
                  <td class="dim">{{ e.modified ? ago(e.modified) : '' }}</td>
                  <td class="mono dim tiny">{{ e.permissions }}</td>
                  <td class="row-actions">
                    <button class="btn xs" v-if="!e.directory" :disabled="busy.dl" @click="downloadFile(e)">⤓ {{ t('To my files') }}</button>
                    <button class="btn xs" @click="fileAction('rename', e)">{{ t('Rename') }}</button>
                    <button class="btn xs danger" @click="fileAction(e.directory ? 'rmdir' : 'delete', e)">{{ t('Delete') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="filesData && !filesData.entries.length" class="empty-hint">{{ t('This folder is empty.') }}</p>
          </div>

          <div class="card tool-card" v-if="filesConn || adhocActive">
            <h3>{{ t('Move files') }}</h3>
            <div class="tool-row">
              <input v-model="filesTarget" class="short" :placeholder="t('Nextcloud folder for downloads')">
              <span class="dim">{{ t('Downloads land in this folder of your Nextcloud files.') }}</span>
            </div>
            <div class="tool-row">
              <input v-model="filesSource" :placeholder="t('Path in your Nextcloud files, e.g. Documents/report.pdf')">
              <button class="btn" :disabled="busy.ul || !filesSource" @click="uploadFile">⤒ {{ t('Upload to this folder') }}</button>
            </div>
            <p v-if="transferNote" class="note-line">{{ transferNote }}</p>
          </div>
        </section>

        <!-- ============ SSH / Telnet / NTP ============ -->
        <section v-if="tab==='ssh'">
          <div class="card tool-card">
            <div class="tool-row">
              <input v-model="sshHost" :placeholder="t('Host name or IP address')" @keyup.enter="runSsh">
              <input v-model.number="sshPort" type="number" class="tiny" min="1" max="65535">
              <button class="btn primary" :disabled="busy.ssh" @click="runSsh">{{ t('Inspect SSH') }}</button>
              <button class="btn" :disabled="busy.telnet" @click="runTelnet">{{ t('Try Telnet') }}</button>
            </div>
            <label class="opt"><input type="checkbox" v-model="sshAuthMethods"> {{ t('Also ask which sign-in methods are accepted (leaves one failed attempt in the server log)') }}</label>
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

          <div class="card tool-card" v-if="allowed('sshexec')">
            <h3>{{ t('Run a command over SSH') }}</h3>
            <p class="dim">{{ t('Signs in to a saved SSH connection with its password or private key. Run a single command, pick a preset, or open a console that keeps its working directory from one line to the next.') }}</p>
            <div class="tool-row">
              <select v-model.number="sshConn" class="grow">
                <option :value="0">{{ t('Choose a saved SSH connection…') }}</option>
                <option v-for="c in sshConnections" :key="c.id" :value="c.id">{{ c.name }} — {{ c.username }}@{{ c.host }}</option>
              </select>
              <button class="btn sm" @click="openConn(null,'ssh')">{{ t('+ Add connection') }}</button>
              <button class="btn sm" v-if="sshConn" @click="openConn(connById(sshConn))">{{ t('Edit') }}</button>
            </div>
            <div class="tool-row">
              <select v-model="sshPreset" class="grow">
                <option value="">{{ t('Or type a command below…') }}</option>
                <option v-for="(p,id) in sshPresets" :key="id" :value="id">{{ t(p.label) }}</option>
              </select>
              <button class="btn primary" :disabled="busy.sshrun || !sshConn || !sshPreset" @click="runSshPreset">{{ t('Run') }}</button>
            </div>
            <div class="tool-row">
              <input v-model="sshCommand" class="mono" :placeholder="t('uptime')" @keyup.enter="runSshCommand">
              <button class="btn" :disabled="busy.sshrun || !sshConn || !sshCommand" @click="runSshCommand">{{ t('Run command') }}</button>
              <button class="btn" :disabled="!sshConn" @click="openConsole">🖳 {{ t('Open a console') }}</button>
            </div>
            <div v-if="sshRunResult">
              <div class="kv">
                <div><span>{{ t('Command') }}</span><code class="wrap">{{ sshRunResult.command }}</code></div>
                <div><span>{{ t('Exit status') }}</span><code :class="sshRunResult.exitStatus ? 'bad' : 'good'">{{ sshRunResult.exitStatus === null ? '—' : sshRunResult.exitStatus }}</code></div>
                <div><span>{{ t('Time taken') }}</span><code>{{ sshRunResult.seconds }} s</code></div>
              </div>
              <pre class="raw">{{ sshRunResult.output || t('(no output)') }}</pre>
            </div>
          </div>

        </section>

      </div>
    </main>

    <!-- ============ system information ============ -->
    <div v-if="sysInfo" class="drawer-backdrop centred" @click.self="sysInfo=false">
      <div class="modal">
        <div class="drawer-head">
          <span class="ic big">🖥</span>
          <div><strong>{{ t('System information') }}</strong><div class="dim">{{ t('What this server can do, and what it could do') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs" @click="sysInfo=false">✕</button>
        </div>
        <div class="drawer-body">
          <h3>{{ t('Basics') }}</h3>
          <div class="kv">
            <div><span>NetBase</span><code>v{{ version }}</code></div>
            <div v-if="requirements && requirements.distro"><span>{{ t('System') }}</span><code>{{ requirements.distro }}</code></div>
            <div v-if="requirements && requirements.phpVersion"><span>PHP</span><code>{{ requirements.phpVersion }}<span v-if="requirements.phpUser" class="dim"> ({{ requirements.phpUser }})</span></code></div>
            <div><span>{{ t('Vendor database') }}</span><code>{{ t('{n} IEEE prefixes', {n: status.ouiEntries}) }}</code></div>
            <div v-if="status.neighbourLimits"><span>{{ t('Neighbour table') }}</span><code>{{ status.neighbourCount }} / {{ status.neighbourLimits.gc3 }}</code></div>
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
                <div><span>{{ t('Neighbour entries') }}</span><code>{{ serverResult.neighbours }}</code></div>
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
        </div>
        <div class="drawer-foot">
          <a class="btn sm" v-if="status.isAdmin" :href="adminUrl">{{ t('Open administration settings') }}</a>
          <span class="spacer"></span>
          <button class="btn primary" @click="sysInfo=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ appearance (per user, NetBase only) ============ -->
    <div v-if="themeBox" class="drawer-backdrop centred" @click.self="themeBox=false">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">🎨</span>
          <div><strong>{{ t('Appearance and language') }}</strong><div class="dim">{{ t('Applies to NetBase only, for your account.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs" @click="themeBox=false">✕</button>
        </div>
        <div class="drawer-body">
          <div class="theme-picks">
            <button v-for="opt in themeOptions" :key="opt.id" class="theme-pick" :class="{active: settings.theme===opt.id}" @click="setTheme(opt.id)">
              <span class="swatch" :class="opt.id"><i class="bar"></i><i class="line"></i><i class="line short"></i></span>
              <strong>{{ t(opt.label) }}</strong>
              <span class="dim">{{ t(opt.hint) }}</span>
              <span class="tick" v-if="settings.theme===opt.id">✓</span>
            </button>
          </div>
          <p class="dim">{{ t('Saved to your account, so it follows you to every browser you sign in from.') }}</p>

          <h3>{{ t('Language') }}</h3>
          <label class="fl">
            <select :value="settings.language || 'auto'" @change="setLanguage($event.target.value)">
              <option value="auto">{{ t('Follow Nextcloud') }}</option>
              <option v-for="l in (settings.languages || [])" :key="l.code" :value="l.code">{{ l.name }}</option>
            </select>
          </label>
          <p class="dim">{{ t('NetBase can speak a different language from the rest of Nextcloud — handy when the interface language and the language you think in are not the same.') }}</p>
        </div>
        <div class="drawer-foot">
          <span class="spacer"></span>
          <button class="btn primary" @click="themeBox=false">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ SSH console ============ -->
    <div v-if="term.open" class="drawer-backdrop centred" @click.self="closeConsole">
      <div class="modal wide term-modal">
        <div class="drawer-head">
          <span class="ic big">🖳</span>
          <div>
            <strong>{{ t('SSH console') }}</strong>
            <div class="dim mono tiny">{{ term.user }}@{{ term.host }}:{{ term.cwd || '~' }}</div>
          </div>
          <span class="spacer"></span>
          <button class="btn sm" @click="term.lines = []">{{ t('Clear') }}</button>
          <button class="btn xs" @click="closeConsole">✕</button>
        </div>
        <div class="term-body" ref="termBody">
          <p class="dim tiny">{{ t('Each line runs on its own connection and the working directory is carried over, so cd, ls and tail behave as expected. Programs that need a real terminal — vi, top, an interactive password prompt — cannot run here.') }}</p>
          <div v-for="(l,i) in term.lines" :key="i" :class="'term-line ' + l.kind"><span v-if="l.kind==='cmd'" class="term-prompt">{{ l.prompt }}</span>{{ l.text }}</div>
          <div v-if="busy.term" class="term-line dim">…</div>
        </div>
        <div class="term-input">
          <span class="term-prompt mono">{{ term.user }}@{{ term.host }}:{{ term.cwd || '~' }}$</span>
          <input ref="termInput" v-model="term.command" class="mono" autocomplete="off" spellcheck="false"
                 @keydown.enter.prevent="sendConsole" @keydown.up.prevent="historyBack" @keydown.down.prevent="historyForward">
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
          <a class="btn sm" :href="preview.url" target="_blank" rel="noopener noreferrer">{{ t('Open in a new tab') }}</a>
          <button class="btn sm" :disabled="preview.loading" @click="reloadPreview">{{ t('Reload') }}</button>
          <button class="btn xs" @click="closePreview">✕</button>
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
    <div v-if="connModal" class="drawer-backdrop centred" @click.self="connModal=false">
      <div class="modal narrow">
        <div class="drawer-head">
          <span class="ic big">🔗</span>
          <div><strong>{{ connForm.id ? t('Edit connection') : t('New connection') }}</strong><div class="dim">{{ t('Saved for your account only. The password is encrypted on the server and never sent back to the browser.') }}</div></div>
          <span class="spacer"></span>
          <button class="btn xs" @click="connModal=false">✕</button>
        </div>
        <div class="drawer-body">
          <label class="fl"><span class="fl-label">{{ t('Type') }}</span>
            <select v-model="connForm.kind" @change="connKindChanged">
              <option v-for="(k,id) in connKinds" :key="id" :value="id">{{ t(k.label) }}</option>
            </select>
          </label>
          <label class="fl"><span class="fl-label">{{ t('Name') }}</span><input v-model="connForm.name" :placeholder="t('Office file server')"></label>
          <div class="fl-row">
            <label class="fl grow"><span class="fl-label">{{ t('Host') }}</span><input v-model="connForm.host" placeholder="server.example.com"></label>
            <label class="fl short"><span class="fl-label">{{ t('Port') }}</span><input v-model.number="connForm.port" type="number" min="1" max="65535"></label>
          </div>
          <label class="fl" v-if="connModes.length > 1"><span class="fl-label">{{ t('Encryption') }}</span>
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
              <input v-model="connForm.privateKeyPath" class="mono" placeholder="Keys/id_ed25519">
            </label>
            <p class="dim">{{ t('Give the path of the private key inside your own Nextcloud files — the one without .pub. The server reads it when you save; the key itself never passes through the browser. Or paste it below instead.') }}</p>
            <label class="fl"><span class="fl-label">{{ connForm.id && connForm.hasSecret ? t('Private key (leave blank to keep)') : t('Private key (paste)') }}</span>
              <textarea v-model="connForm.privateKey" rows="4" class="mono tiny" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
            </label>
          </template>
          <label class="fl" v-if="connForm.kind==='smtp'"><span class="fl-label">{{ t('Sender address') }}</span><input v-model="connForm.from" placeholder="notify@example.com"></label>
          <label class="fl" v-if="connForm.kind==='ftp' || connForm.kind==='sftp'"><span class="fl-label">{{ t('Start folder') }}</span><input v-model="connForm.path" class="mono" placeholder="/"></label>
          <label class="opt" v-if="connForm.kind==='ftp'"><input type="checkbox" v-model="connForm.passive"> {{ t('Passive mode (usually right)') }}</label>
          <label class="fl"><span class="fl-label">{{ t('Notes') }}</span><textarea v-model="connForm.notes" rows="2"></textarea></label>
          <p v-if="connNote" class="note-line">{{ connNote }}</p>
        </div>
        <div class="drawer-foot">
          <button class="btn danger sm" v-if="connForm.id" @click="deleteConn(connForm)">{{ t('Delete') }}</button>
          <span class="spacer"></span>
          <button class="btn sm" @click="connModal=false">{{ t('Cancel') }}</button>
          <button class="btn primary" :disabled="busy.conn" @click="saveConn">{{ t('Save') }}</button>
        </div>
      </div>
    </div>

    <!-- ============ device drawer ============ -->
    <div v-if="selected" class="drawer-backdrop" @click.self="selected=null">
      <div class="drawer">
        <div class="drawer-head">
          <span class="ic big">{{ icon(selected) }}</span>
          <div>
            <input class="dev-name" v-model="editLabel" :placeholder="selected.hostname || selected.ip" :readonly="!allowed('scan')">
            <div class="dim mono">{{ selected.ip }} · {{ selected.mac || t('no MAC') }}</div>
          </div>
          <span class="spacer"></span>
          <button class="btn xs" @click="selected=null">✕</button>
        </div>
        <div class="drawer-body">
          <div class="kv">
            <div><span>{{ t('Vendor') }}</span><code>{{ vendorText(selected) }}</code></div>
            <div><span>{{ t('Reported name') }}</span><code>{{ selected.hostname || '—' }}</code></div>
            <div v-if="selected.workgroup"><span>{{ t('Workgroup') }}</span><code>{{ selected.workgroup }}</code></div>
            <div><span>{{ t('Open ports') }}</span><code>
              <template v-for="(p,i) in selected.ports" :key="p">
                <a v-if="portLink(selected, p)" :href="portLink(selected, p).href" :title="portLink(selected, p).title" target="_blank" rel="noopener noreferrer">{{ p }}</a>
                <a v-else-if="portTool(selected, p)" href="#" :title="portTool(selected, p).title" @click.prevent="openPortTool(selected, p)">{{ p }}</a>
                <span v-else>{{ p }}</span><span v-if="i < selected.ports.length - 1">, </span>
              </template>
              <span v-if="!selected.ports.length">—</span>
            </code></div>
            <div><span>{{ t('Found by') }}</span><code>{{ selected.sources.join(', ') }}</code></div>
            <div><span>{{ t('First seen') }}</span><code>{{ stamp(selected.firstSeen) }}</code></div>
            <div><span>{{ t('Last seen') }}</span><code>{{ stamp(selected.lastSeen) }}</code></div>
            <div v-if="selected.extra && selected.extra.mdns"><span>mDNS</span><code>{{ selected.extra.mdns }}</code></div>
            <div v-if="selected.extra && selected.extra.rdns"><span>{{ t('Reverse DNS') }}</span><code>{{ selected.extra.rdns }}</code></div>
            <div v-if="selected.extra && selected.extra.ssdp"><span>SSDP</span><code class="wrap">{{ selected.extra.ssdp }}</code></div>
          </div>
          <template v-if="allowed('scan')">
            <label class="fl"><span class="fl-label">{{ t('Type') }}</span>
              <select v-model="editType"><option v-for="(l,k) in typeLabels" :key="k" :value="k">{{ t(l) }}</option></select>
            </label>
            <label class="fl"><span class="fl-label">{{ t('Tags') }}</span><input v-model="editTags" :placeholder="t('office, 2F, spare')"></label>
            <label class="fl"><span class="fl-label">{{ t('Notes') }}</span><textarea v-model="editNotes" rows="3"></textarea></label>
          </template>
          <div class="kv" v-else-if="selected.tags.length || selected.notes">
            <div v-if="selected.tags.length"><span>{{ t('Tags') }}</span><code>{{ selected.tags.join(', ') }}</code></div>
            <div v-if="selected.notes"><span>{{ t('Notes') }}</span><code class="wrap">{{ selected.notes }}</code></div>
          </div>
          <div class="drawer-tools">
            <template v-for="l in webLinks(selected)" :key="l.href">
              <a class="btn sm" :href="l.href" target="_blank" rel="noopener noreferrer">🌐 {{ l.label }}</a>
              <button class="btn sm" v-if="status.preview" @click="showPage(l.href)">🖼 {{ t('Show the page') }}</button>
            </template>
            <button class="btn sm" v-if="allowed('ping')" @click="toolFor('ping')">📡 {{ t('Ping') }}</button>
            <button class="btn sm" v-if="allowed('ports')" @click="toolFor('ports')">🔌 {{ t('Ports') }}</button>
            <button class="btn sm" v-if="allowed('nmap') && status.nmap && status.nmap.available" @click="toolFor('nmap')">🗺️ nmap</button>
            <button class="btn sm" v-if="selected.mac && allowed('wol')" @click="wake(selected)">⏻ {{ t('Wake on LAN') }}</button>
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
    { id: 'ping', icon: '📡', label: 'Ping & traceroute', hint: 'Reachability and the path there' },
    { id: 'ports', icon: '🔌', label: 'Ports', hint: 'TCP connect check with banners' },
    { id: 'tls', icon: '🔒', label: 'TLS & HTTP', hint: 'Certificates, redirects and headers' },
    { id: 'subnet', icon: '🧮', label: 'Subnet & MAC', hint: 'Address maths and vendor lookup' },
    { id: 'bench', icon: '⏱️', label: 'Benchmarks', hint: 'Throughput, latency and where the time goes' },
    { id: 'mail', icon: '📧', label: 'Mail', hint: 'Domain policy, server tests and a real test message' },
    { id: 'files', icon: '📁', label: 'FTP & SFTP', hint: 'Browse a remote server and move files' },
    { id: 'ssh', icon: '🔐', label: 'SSH & Telnet', hint: 'What a service offers, and commands on the servers you keep' },
    { id: 'ntp', icon: '🕒', label: 'Clock check', hint: 'How far the clock has drifted from a time server' },
    { id: 'nmap', icon: '🗺️', label: 'nmap', hint: 'Presets over the nmap scanner' },
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
  const PORT_PRESETS = [
    { label: 'Common', ports: '21,22,23,25,53,80,110,139,143,443,445,587,993,995,3389,8080' },
    { label: 'Web', ports: '80,443,8000,8008,8080,8443,8888' },
    { label: 'Mail', ports: '25,110,143,465,587,993,995' },
    { label: 'Databases', ports: '1433,1521,3306,5432,6379,9200,27017' },
    { label: 'Remote access', ports: '22,23,3389,5900,5901' },
    { label: 'Printers and NAS', ports: '139,445,515,631,5000,5001,9100' },
  ];

  // Ports a browser can open directly, and what scheme to use.
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
        version: '', tab: 'devices', banner: null, authenticated: true,
        status: { canScan: false, canLookup: false, isAdmin: false, binaries: {}, nmap: { available: false }, ouiEntries: 0, targets: [] },
        settings: { language: 'auto', theme: 'auto', languages: [] },
        devices: [], scan: null, scanning: false, advice: null,
        scanTargets: '', pace: 'fast',
        opts: { names: true, multicast: true, ports: true, rdns: true, arpOnly: false },
        filter: '', onlyOnline: true, sortKey: 'ip', sortDir: 1,
        selected: null, editLabel: '', editTags: '', editNotes: '', editType: 'unknown',
        busy: {},
        dnsHost: '', dnsWanted: ['A', 'AAAA', 'MX', 'NS', 'TXT'], dnsResult: null,
        dnsView: 'records', dnsViews: DNS_VIEWS, dnsAllTypes: DNS_ALL_TYPES,
        dnsType: 'A', dnsServer: '', dnsDnssec: false, dnsQueryResult: null,
        dnsCompareResult: null, dnsTraceResult: null,
        axfrZone: '', axfrServer: '', axfrResult: null,
        tlsVersionsResult: null, tcpPingPort: 443, tcpPingResult: null, mtuResult: null,
        splitCidr: '', splitPrefix: 26, splitPrefixes: SPLIT_PREFIXES, splitResult: null,
        aggregateInput: '', aggregateResult: null,
        portPresets: PORT_PRESETS,
        sshConn: 0, sshPreset: '', sshCommand: '', sshRunResult: null,
        dnsTypes: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA'],
        whoisQuery: '', whoisResult: null,
        pingHost: '', pingResult: null, traceResult: null,
        portHost: '', portList: '', portResult: null,
        tlsHost: '', tlsPort: 443, tlsResult: null, httpResult: null,
        subnetInput: '', subnetResult: null, macQuery: '', macResult: null,
        // saved connections (FTP / SFTP / mail accounts)
        connections: [], connKinds: {}, connCaps: {}, connModal: false, connNote: '',
        connForm: { id: 0, kind: 'sftp', name: '', host: '', port: 22, mode: 'ssh', username: '', secret: '', authType: 'password', privateKey: '', privateKeyPath: '', passphrase: '', from: '', path: '', passive: true, notes: '', hasSecret: false },
        // mail
        mailView: 'domain', mailViews: MAIL_VIEWS, mailPresets: MAIL_PRESETS,
        mailDomain: '', mailSelectors: '', mailBlocklists: true, mailAudit: null,
        mailHost: '', mailPort: 0, mailProtocol: 'smtp', mailMode: 'auto', mailProbeResult: null,
        relayHost: '', relayPort: 25, relayResult: null, blIp: '', blResult: null,
        sendId: 0, sendTo: '', sendSubject: '', sendBody: '', sendResult: null,
        mailboxId: 0, mailboxResult: null,
        // file transfer
        filesConn: 0, filesPath: '', filesData: null, filesTarget: 'NetBase', filesSource: '', transferNote: '',
        adhocActive: false,
        adhoc: { kind: 'sftp', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh', passive: true, path: '' },
        // service probes
        sshHost: '', sshPort: 22, sshAuthMethods: false, sshResult: null, telnetResult: null,
        ntpHost: 'pool.ntp.org', ntpResult: null,
        locale: 0,
        term: { open: false, id: 0, host: '', user: '', cwd: '', command: '', lines: [], history: [], at: -1 },
        preview: { open: false, url: '', src: '', loading: false, error: null, full: false },
        serverResult: null, requirements: null, sysInfo: false, themeBox: false,
        themeOptions: THEME_OPTIONS,
        adminUrl: (window.OC && OC.generateUrl) ? OC.generateUrl('/settings/admin/netbase') : '/settings/admin/netbase',
        liveOn: false, liveIface: '', liveIfaces: [], liveNow: { rx: 0, tx: 0 }, liveRx: [], liveTx: [],
        liveErrors: 0, lastCounters: null, liveTimer: null,
        speedSize: 25, speedUpload: true, speedResult: null,
        iperfHost: '', iperfPort: 5201, iperfSeconds: 10, iperfReverse: false, iperfResult: null,
        dnsBench: null, timingUrl: '', timingResult: null, pathResult: null,
        nmapTargets: '', nmapPreset: 'quick', nmapExtra: '', nmapResult: null,
        typeLabels: TYPE_LABEL,
      };
    },
    computed: {
      visibleTabs() {
        // 'ping' covers traceroute too. Anyone allowed nothing at all never
        // reaches this page — the server answers 403 before it loads.
        const can = this.status.can || {};
        return TABS.filter((x) => can[x.id]);
      },
      currentTab() { return TABS.find((x) => x.id === this.tab) || this.visibleTabs[0] || TABS[0]; },
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
          case 'sweep': return T('{done} / {total} addresses swept', v);
          case 'names': return T('Asking devices for their names ({done} / {total})', v);
          case 'names2': return T('Asking again, more slowly ({done} / {total})', v);
          case 'mcast': return T('Multicast discovery complete');
          case 'ports': return T('Checking services ({done} / {total})', v);
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

      allowed(tool) { return !!(this.status.can || {})[tool]; },

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
        try {
          this.advice = await api('scan/advice?' + qs({ targets }));
          const r = await api('scan', { method: 'POST', body: JSON.stringify({ targets, options: { ...this.opts, pace: this.pace } }) });
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
        if (tool === 'ping') { this.pingHost = target; this.tab = 'ping'; this.runPing(); }
        if (tool === 'ports') { this.portHost = target; this.tab = 'ports'; this.runPorts(); }
        if (tool === 'nmap') { this.nmapTargets = target; this.tab = 'nmap'; }
      },

      async guarded(key, fn) {
        this.busy[key] = true;
        try { return await fn(); } catch (e) { this.fail(e); return null; } finally { this.busy[key] = false; }
      },
      /** A device's own web interface, when the port says it has one. */
      portLink(device, port) {
        const scheme = WEB_PORTS[port];
        if (!scheme || !device.ip) return null;
        const host = device.ip.includes(':') ? '[' + device.ip + ']' : device.ip;
        const href = scheme + '://' + host + (port === 80 || port === 443 ? '' : ':' + port);
        return { href, title: T('Open {url} in a new tab', { url: href }) };
      },
      /** Ports NetBase can act on itself, rather than hand to the browser. */
      portTool(device, port) {
        const tool = TOOL_PORTS[port];
        if (!tool || !device.ip) return null;
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
          href: this.portLink(device, p).href,
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
        this.sendResult = await this.guarded('send', () => api('mail/send', { method: 'POST', body: JSON.stringify({ id: this.sendId, to: this.sendTo, subject: this.sendSubject, body: this.sendBody }) }));
        if (this.sendResult) this.note(this.sendResult.ok ? T('The server accepted the message') : T('Sending failed: {error}', { error: this.sendResult.error }));
      },
      async runMailbox() {
        this.mailboxResult = await this.guarded('mailbox', () => api('connections/' + this.mailboxId + '/test', { method: 'POST', body: '{}' }));
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
      async runSsh() { this.sshResult = await this.guarded('ssh', () => api('probe/ssh?' + qs({ host: this.sshHost, port: this.sshPort || 22, authMethods: this.sshAuthMethods ? 1 : 0 }))); },
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
      async runTcpPing() { this.tcpPingResult = await this.guarded('tcpping', () => api('tools/tcp-ping?' + qs({ host: this.pingHost, port: this.tcpPingPort || 443 }))); },
      async runMtu() { this.mtuResult = await this.guarded('mtu', () => api('tools/mtu?' + qs({ host: this.pingHost }))); },
      async runSplit() { this.splitResult = await this.guarded('split', () => api('tools/subnet-split?' + qs({ cidr: this.splitCidr || this.subnetInput, prefix: this.splitPrefix }))); },
      async runAggregate() { this.aggregateResult = await this.guarded('aggregate', () => api('tools/subnet-aggregate?' + qs({ input: this.aggregateInput }))); },
      openConsole() {
        const conn = this.connById(this.sshConn);
        if (!conn) return;
        this.term = {
          open: true, id: conn.id, host: conn.host, user: conn.username || '',
          cwd: (conn.options && conn.options.path) || '', command: '', lines: [], history: [], at: -1,
        };
        this.$nextTick(() => this.$refs.termInput && this.$refs.termInput.focus());
      },
      closeConsole() { this.term.open = false; },
      historyBack() {
        if (!this.term.history.length) return;
        this.term.at = this.term.at < 0 ? this.term.history.length - 1 : Math.max(0, this.term.at - 1);
        this.term.command = this.term.history[this.term.at];
      },
      historyForward() {
        if (this.term.at < 0) return;
        this.term.at++;
        if (this.term.at >= this.term.history.length) { this.term.at = -1; this.term.command = ''; return; }
        this.term.command = this.term.history[this.term.at];
      },
      async sendConsole() {
        const command = this.term.command.trim();
        if (!command || this.busy.term) return;
        const prompt = (this.term.user || '') + '@' + this.term.host + ':' + (this.term.cwd || '~') + '$ ';
        this.term.lines.push({ kind: 'cmd', prompt, text: command });
        this.term.history.push(command);
        this.term.at = -1;
        this.term.command = '';
        if (command === 'clear') { this.term.lines = []; return; }
        if (command === 'exit') { this.closeConsole(); return; }
        const r = await this.guarded('term', () => api('ssh/shell', { method: 'POST', body: JSON.stringify({ id: this.term.id, command, cwd: this.term.cwd }) }));
        if (r) {
          if (r.output !== '') this.term.lines.push({ kind: r.exitStatus ? 'err' : 'out', text: r.output });
          if (r.exitStatus) this.term.lines.push({ kind: 'code', text: T('exit status {n}', { n: r.exitStatus }) });
          this.term.cwd = r.cwd || this.term.cwd;
        } else {
          this.term.lines.push({ kind: 'err', text: (this.banner && this.banner.text) || T('The command could not be run.') });
        }
        this.$nextTick(() => {
          const box = this.$refs.termBody;
          if (box) box.scrollTop = box.scrollHeight;
          if (this.$refs.termInput) this.$refs.termInput.focus();
        });
      },
      async runSshPreset() { this.sshRunResult = await this.guarded('sshrun', () => api('ssh/preset', { method: 'POST', body: JSON.stringify({ id: this.sshConn, preset: this.sshPreset }) })); },
      async runSshCommand() { this.sshRunResult = await this.guarded('sshrun', () => api('ssh/run', { method: 'POST', body: JSON.stringify({ id: this.sshConn, command: this.sshCommand }) })); },

      async runDns() { this.dnsResult = await this.guarded('dns', () => api('tools/dns?' + qs({ host: this.dnsHost, types: this.dnsWanted }))); },
      async runWhois() { this.whoisResult = await this.guarded('whois', () => api('tools/whois?' + qs({ query: this.whoisQuery }))); },
      async runPing() { this.pingResult = await this.guarded('ping', () => api('tools/ping?' + qs({ host: this.pingHost }))); },
      async runTrace() { this.traceResult = await this.guarded('trace', () => api('tools/traceroute?' + qs({ host: this.pingHost }))); },
      async runPorts() {
        // The server understands "22,80,8000-8100"; sending the text as typed
        // keeps ranges intact.
        this.portResult = await this.guarded('ports', () => api('tools/ports?' + qs({ host: this.portHost, spec: this.portList })));
      },
      async runTls() { this.tlsResult = await this.guarded('tls', () => api('tools/tls?' + qs({ host: this.tlsHost, port: this.tlsPort }))); },
      async runHttp() { this.httpResult = await this.guarded('http', () => api('tools/http?' + qs({ url: this.tlsHost }))); },
      async runSubnet() { this.subnetResult = await this.guarded('subnet', () => api('tools/subnet?' + qs({ cidr: this.subnetInput }))); },
      async runMac() { this.macResult = await this.guarded('mac', () => api('tools/mac?' + qs({ mac: this.macQuery }))); },
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
      async runPath() { this.pathResult = await this.guarded('path', () => api('tools/path?' + qs({ host: this.pingHost }))); },
      openSysInfo() {
        this.sysInfo = true;
        if (this.allowed('server') && !this.serverResult) this.runServer();
      },
      async runServer() { this.serverResult = await this.guarded('server', () => api('tools/server')); },
      async runNmap() {
        const targets = this.nmapTargets.split(/[\s,]+/).filter(Boolean);
        this.nmapResult = await this.guarded('nmap', () => api('nmap', {
          method: 'POST',
          body: JSON.stringify({ targets, preset: this.nmapPreset, extra: this.nmapExtra ? [this.nmapExtra] : [] }),
        }));
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
    },
    mounted() {
      rootProxy = this;
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
