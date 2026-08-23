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

  // Precompiled render function (eval-free). Source template lives in netbase.js;
  // regenerate with regibase-build/netbase-build.mjs after editing the template.
  const render = (function () {
const { createElementVNode: _createElementVNode, openBlock: _openBlock, createElementBlock: _createElementBlock, toDisplayString: _toDisplayString, createCommentVNode: _createCommentVNode, renderList: _renderList, Fragment: _Fragment, withModifiers: _withModifiers, normalizeClass: _normalizeClass, vModelText: _vModelText, withDirectives: _withDirectives, vModelSelect: _vModelSelect, vModelCheckbox: _vModelCheckbox, createTextVNode: _createTextVNode, normalizeStyle: _normalizeStyle, withKeys: _withKeys, vShow: _vShow, createStaticVNode: _createStaticVNode } = Vue

const _hoisted_1 = { class: "layout" }
const _hoisted_2 = { class: "sidebar" }
const _hoisted_3 = { class: "brand" }
const _hoisted_4 = /*#__PURE__*/_createStaticVNode("<span class=\"logo\"><svg viewBox=\"333 400 1335 1030\"><path d=\"M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></path><path d=\"M1040.38,1352.06c-3.65-4.48-4.91-9.8-3.78-15.97l115.97-542.87c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.57-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1353.41,1228.53c19.04,0,35.15-6.16,48.32-18.49,13.16-12.32,19.75-27.17,19.75-44.54,0-11.76-4.2-21.28-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1284.5,900.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\" fill=\"#2e3192\"></path><path d=\"M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></path><path d=\"M902.67,1351.87c-6.55-6.05-12.12-13.83-16.73-23.34l-201.98-440.64-83.09,438.06c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-151.2c-8.47,0-15.19-3.45-20.19-10.36s-6.73-15.12-5.2-24.62l159.28-837.22c1.53-9.5,5.95-17.72,13.27-24.62s15.2-10.38,23.67-10.38h96.95c19.22,0,33.08,9.94,41.55,29.81l204.28,443.23,83.11-438.05c1.53-9.5,5.95-17.72,13.27-24.62s15.19-10.38,23.66-10.38h151.2c8.45,0,15.19,3.47,20.19,10.38s6.73,15.12,5.2,24.62l-159.28,837.22c-1.55,9.5-5.97,17.72-13.28,24.62s-15.19,10.36-23.66,10.36h-96.94c-11.55,0-20.59-3.02-27.12-9.06Z\" fill=\"#2970e2\"></path></svg></span><span>NetBase</span>", 2)
const _hoisted_6 = {
  key: 0,
  class: "tag"
}
const _hoisted_7 = ["title", "onClick", "onKeydown", "onDragstart", "onDragover", "onDragleave", "onDrop"]
const _hoisted_8 = { class: "ic" }
const _hoisted_9 = { class: "nm" }
const _hoisted_10 = {
  key: 0,
  class: "ct"
}
const _hoisted_11 = /*#__PURE__*/_createElementVNode("span", {
  class: "grip",
  "aria-hidden": "true"
}, "⠿", -1 /* HOISTED */)
const _hoisted_12 = { class: "sidebar-foot" }
const _hoisted_13 = ["disabled"]
const _hoisted_14 = { class: "main" }
const _hoisted_15 = { class: "topbar" }
const _hoisted_16 = { class: "title" }
const _hoisted_17 = { class: "ic" }
const _hoisted_18 = { class: "nm" }
const _hoisted_19 = { class: "desc" }
const _hoisted_20 = /*#__PURE__*/_createElementVNode("div", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_21 = {
  key: 0,
  class: "topbar-actions"
}
const _hoisted_22 = ["placeholder"]
const _hoisted_23 = ["disabled"]
const _hoisted_24 = { class: "content" }
const _hoisted_25 = { key: 1 }
const _hoisted_26 = {
  key: 0,
  class: "card scan-card"
}
const _hoisted_27 = { class: "scan-row" }
const _hoisted_28 = { class: "fl" }
const _hoisted_29 = { class: "fl-label" }
const _hoisted_30 = ["placeholder"]
const _hoisted_31 = { class: "fl narrow" }
const _hoisted_32 = { class: "fl-label" }
const _hoisted_33 = { value: "fast" }
const _hoisted_34 = { value: "gentle" }
const _hoisted_35 = ["disabled"]
const _hoisted_36 = { class: "scan-opts" }
const _hoisted_37 = {
  key: 0,
  class: "progress"
}
const _hoisted_38 = { class: "bar" }
const _hoisted_39 = { class: "progress-text" }
const _hoisted_40 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_41 = {
  key: 1,
  class: "hint"
}
const _hoisted_42 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_43 = {
  key: 2,
  class: "grid"
}
const _hoisted_44 = /*#__PURE__*/_createElementVNode("th", { class: "c-dot" }, null, -1 /* HOISTED */)
const _hoisted_45 = ["onClick"]
const _hoisted_46 = { class: "c-dot" }
const _hoisted_47 = ["title"]
const _hoisted_48 = { class: "c-name" }
const _hoisted_49 = { class: "ic" }
const _hoisted_50 = { class: "nm" }
const _hoisted_51 = {
  key: 0,
  class: "badge"
}
const _hoisted_52 = { class: "mono" }
const _hoisted_53 = { class: "mono dim" }
const _hoisted_54 = ["title", "onClick"]
const _hoisted_55 = ["title", "onClick"]
const _hoisted_56 = { key: 2 }
const _hoisted_57 = { key: 3 }
const _hoisted_58 = { key: 0 }
const _hoisted_59 = { class: "dim" }
const _hoisted_60 = { key: 2 }
const _hoisted_61 = { class: "card tool-card" }
const _hoisted_62 = { class: "seg" }
const _hoisted_63 = ["onClick"]
const _hoisted_64 = { class: "card tool-card" }
const _hoisted_65 = { class: "tool-row" }
const _hoisted_66 = ["placeholder"]
const _hoisted_67 = ["disabled"]
const _hoisted_68 = { class: "chips" }
const _hoisted_69 = ["value"]
const _hoisted_70 = {
  key: 0,
  class: "card"
}
const _hoisted_71 = { class: "grid compact" }
const _hoisted_72 = { class: "mono" }
const _hoisted_73 = { class: "dim mono" }
const _hoisted_74 = { class: "mono wrap" }
const _hoisted_75 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_76 = {
  key: 1,
  class: "kv"
}
const _hoisted_77 = { key: 0 }
const _hoisted_78 = /*#__PURE__*/_createElementVNode("span", null, "SPF", -1 /* HOISTED */)
const _hoisted_79 = { key: 1 }
const _hoisted_80 = /*#__PURE__*/_createElementVNode("span", null, "DMARC", -1 /* HOISTED */)
const _hoisted_81 = { class: "card tool-card" }
const _hoisted_82 = { class: "tool-row" }
const _hoisted_83 = ["placeholder"]
const _hoisted_84 = ["value"]
const _hoisted_85 = ["placeholder"]
const _hoisted_86 = ["disabled"]
const _hoisted_87 = { class: "opt" }
const _hoisted_88 = { class: "dim" }
const _hoisted_89 = {
  key: 0,
  class: "card"
}
const _hoisted_90 = { class: "kv" }
const _hoisted_91 = { key: 0 }
const _hoisted_92 = { class: "bad" }
const _hoisted_93 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_94 = { class: "mono tiny" }
const _hoisted_95 = { class: "mono" }
const _hoisted_96 = { class: "dim mono" }
const _hoisted_97 = { class: "mono wrap tiny" }
const _hoisted_98 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_99 = { key: 2 }
const _hoisted_100 = { class: "grid compact" }
const _hoisted_101 = { class: "mono tiny" }
const _hoisted_102 = { class: "mono" }
const _hoisted_103 = { class: "mono wrap tiny" }
const _hoisted_104 = { class: "card tool-card" }
const _hoisted_105 = { class: "tool-row" }
const _hoisted_106 = ["placeholder"]
const _hoisted_107 = ["value"]
const _hoisted_108 = ["disabled"]
const _hoisted_109 = { class: "dim" }
const _hoisted_110 = {
  key: 0,
  class: "card"
}
const _hoisted_111 = { class: "grid compact" }
const _hoisted_112 = { class: "dim mono tiny" }
const _hoisted_113 = { class: "mono" }
const _hoisted_114 = { class: "mono" }
const _hoisted_115 = { class: "mono wrap tiny" }
const _hoisted_116 = { class: "card tool-card" }
const _hoisted_117 = { class: "tool-row" }
const _hoisted_118 = ["placeholder"]
const _hoisted_119 = ["value"]
const _hoisted_120 = ["disabled"]
const _hoisted_121 = { class: "dim" }
const _hoisted_122 = {
  key: 0,
  class: "card"
}
const _hoisted_123 = { class: "ts-head" }
const _hoisted_124 = { class: "pill" }
const _hoisted_125 = { class: "mono" }
const _hoisted_126 = { class: "dim mono" }
const _hoisted_127 = { class: "dim" }
const _hoisted_128 = {
  key: 0,
  class: "mono tiny wrap"
}
const _hoisted_129 = {
  key: 1,
  class: "dim mono tiny wrap"
}
const _hoisted_130 = { class: "card tool-card" }
const _hoisted_131 = { class: "tool-row" }
const _hoisted_132 = ["placeholder"]
const _hoisted_133 = ["placeholder"]
const _hoisted_134 = ["disabled"]
const _hoisted_135 = { class: "dim" }
const _hoisted_136 = {
  key: 0,
  class: "card"
}
const _hoisted_137 = { class: "grid compact" }
const _hoisted_138 = { class: "mono" }
const _hoisted_139 = { class: "dim tiny" }
const _hoisted_140 = { class: "dim tiny" }
const _hoisted_141 = { class: "mono" }
const _hoisted_142 = { key: 0 }
const _hoisted_143 = { class: "raw" }
const _hoisted_144 = { key: 3 }
const _hoisted_145 = { class: "card tool-card" }
const _hoisted_146 = { class: "tool-row" }
const _hoisted_147 = ["placeholder"]
const _hoisted_148 = ["disabled"]
const _hoisted_149 = {
  key: 0,
  class: "card"
}
const _hoisted_150 = {
  key: 0,
  class: "kv"
}
const _hoisted_151 = ["open"]
const _hoisted_152 = { class: "raw" }
const _hoisted_153 = { key: 4 }
const _hoisted_154 = { class: "card tool-card" }
const _hoisted_155 = { class: "tool-row" }
const _hoisted_156 = ["placeholder"]
const _hoisted_157 = ["disabled"]
const _hoisted_158 = ["disabled"]
const _hoisted_159 = ["disabled"]
const _hoisted_160 = { class: "tool-row" }
const _hoisted_161 = ["disabled"]
const _hoisted_162 = ["disabled"]
const _hoisted_163 = {
  key: 0,
  class: "card"
}
const _hoisted_164 = { class: "kv" }
const _hoisted_165 = { class: "dim" }
const _hoisted_166 = { key: 0 }
const _hoisted_167 = {
  key: 1,
  class: "card"
}
const _hoisted_168 = {
  key: 0,
  class: "kv"
}
const _hoisted_169 = /*#__PURE__*/_createElementVNode("span", null, "MTU", -1 /* HOISTED */)
const _hoisted_170 = {
  key: 2,
  class: "card"
}
const _hoisted_171 = { class: "area" }
const _hoisted_172 = {
  key: 0,
  class: "kv"
}
const _hoisted_173 = { key: 0 }
const _hoisted_174 = { class: "raw" }
const _hoisted_175 = {
  key: 3,
  class: "card"
}
const _hoisted_176 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_177 = {
  key: 1,
  class: "raw"
}
const _hoisted_178 = {
  key: 4,
  class: "card"
}
const _hoisted_179 = {
  key: 0,
  class: "missing"
}
const _hoisted_180 = { class: "raw" }
const _hoisted_181 = {
  key: 1,
  class: "grid compact"
}
const _hoisted_182 = /*#__PURE__*/_createElementVNode("th", null, "#", -1 /* HOISTED */)
const _hoisted_183 = { class: "mono dim" }
const _hoisted_184 = { class: "mono" }
const _hoisted_185 = { class: "mono" }
const _hoisted_186 = { class: "mono dim" }
const _hoisted_187 = { class: "mono dim" }
const _hoisted_188 = { class: "mono dim" }
const _hoisted_189 = { key: 5 }
const _hoisted_190 = { class: "card tool-card" }
const _hoisted_191 = { class: "tool-row" }
const _hoisted_192 = ["placeholder"]
const _hoisted_193 = ["placeholder"]
const _hoisted_194 = ["disabled"]
const _hoisted_195 = { class: "chips" }
const _hoisted_196 = ["onClick"]
const _hoisted_197 = {
  key: 0,
  class: "card"
}
const _hoisted_198 = { class: "grid compact" }
const _hoisted_199 = { class: "mono" }
const _hoisted_200 = { class: "dim mono" }
const _hoisted_201 = { class: "mono wrap dim" }
const _hoisted_202 = { key: 6 }
const _hoisted_203 = { class: "card tool-card" }
const _hoisted_204 = { class: "tool-row" }
const _hoisted_205 = ["placeholder"]
const _hoisted_206 = ["disabled"]
const _hoisted_207 = ["disabled"]
const _hoisted_208 = ["disabled"]
const _hoisted_209 = {
  key: 0,
  class: "card"
}
const _hoisted_210 = { class: "grid compact" }
const _hoisted_211 = { class: "mono" }
const _hoisted_212 = { class: "mono dim tiny" }
const _hoisted_213 = {
  key: 1,
  class: "card"
}
const _hoisted_214 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_215 = {
  key: 1,
  class: "kv"
}
const _hoisted_216 = { key: 0 }
const _hoisted_217 = { class: "wrap" }
const _hoisted_218 = {
  key: 2,
  class: "card"
}
const _hoisted_219 = { class: "grid compact" }
const _hoisted_220 = { class: "mono wrap" }
const _hoisted_221 = { class: "mono" }
const _hoisted_222 = { class: "dim mono" }
const _hoisted_223 = { class: "dim" }
const _hoisted_224 = { class: "kv" }
const _hoisted_225 = { key: 7 }
const _hoisted_226 = { class: "card" }
const _hoisted_227 = { class: "bench-head" }
const _hoisted_228 = ["value"]
const _hoisted_229 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_230 = {
  key: 0,
  class: "bench-live"
}
const _hoisted_231 = { class: "rate rx" }
const _hoisted_232 = { class: "lbl" }
const _hoisted_233 = { class: "val" }
const _hoisted_234 = { class: "rate tx" }
const _hoisted_235 = { class: "lbl" }
const _hoisted_236 = { class: "val" }
const _hoisted_237 = {
  class: "spark",
  viewBox: "0 0 300 60",
  preserveAspectRatio: "none"
}
const _hoisted_238 = ["points"]
const _hoisted_239 = ["points"]
const _hoisted_240 = { class: "hint" }
const _hoisted_241 = { key: 0 }
const _hoisted_242 = { class: "card" }
const _hoisted_243 = { class: "bench-head" }
const _hoisted_244 = /*#__PURE__*/_createElementVNode("option", { value: 5 }, "5 MB", -1 /* HOISTED */)
const _hoisted_245 = /*#__PURE__*/_createElementVNode("option", { value: 25 }, "25 MB", -1 /* HOISTED */)
const _hoisted_246 = /*#__PURE__*/_createElementVNode("option", { value: 50 }, "50 MB", -1 /* HOISTED */)
const _hoisted_247 = /*#__PURE__*/_createElementVNode("option", { value: 100 }, "100 MB", -1 /* HOISTED */)
const _hoisted_248 = [
  _hoisted_244,
  _hoisted_245,
  _hoisted_246,
  _hoisted_247
]
const _hoisted_249 = { class: "inline-check" }
const _hoisted_250 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_251 = ["disabled"]
const _hoisted_252 = { class: "hint" }
const _hoisted_253 = {
  key: 0,
  class: "bench-results"
}
const _hoisted_254 = { class: "big" }
const _hoisted_255 = { class: "lbl" }
const _hoisted_256 = { class: "num" }
const _hoisted_257 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_258 = { class: "big" }
const _hoisted_259 = { class: "lbl" }
const _hoisted_260 = { class: "num" }
const _hoisted_261 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_262 = { class: "big" }
const _hoisted_263 = { class: "lbl" }
const _hoisted_264 = { class: "num" }
const _hoisted_265 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "ms", -1 /* HOISTED */)
const _hoisted_266 = { class: "big" }
const _hoisted_267 = { class: "lbl" }
const _hoisted_268 = { class: "num" }
const _hoisted_269 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "ms", -1 /* HOISTED */)
const _hoisted_270 = {
  key: 1,
  class: "hint danger"
}
const _hoisted_271 = { class: "card" }
const _hoisted_272 = { class: "bench-head" }
const _hoisted_273 = { class: "tool-row" }
const _hoisted_274 = ["placeholder"]
const _hoisted_275 = /*#__PURE__*/_createElementVNode("option", { value: 5 }, "5s", -1 /* HOISTED */)
const _hoisted_276 = /*#__PURE__*/_createElementVNode("option", { value: 10 }, "10s", -1 /* HOISTED */)
const _hoisted_277 = /*#__PURE__*/_createElementVNode("option", { value: 30 }, "30s", -1 /* HOISTED */)
const _hoisted_278 = [
  _hoisted_275,
  _hoisted_276,
  _hoisted_277
]
const _hoisted_279 = { class: "inline-check" }
const _hoisted_280 = ["disabled"]
const _hoisted_281 = {
  key: 0,
  class: "bench-results"
}
const _hoisted_282 = { class: "big" }
const _hoisted_283 = { class: "lbl" }
const _hoisted_284 = { class: "num" }
const _hoisted_285 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_286 = { class: "big" }
const _hoisted_287 = { class: "lbl" }
const _hoisted_288 = { class: "num" }
const _hoisted_289 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, "Mbps", -1 /* HOISTED */)
const _hoisted_290 = {
  key: 0,
  class: "big"
}
const _hoisted_291 = { class: "lbl" }
const _hoisted_292 = { class: "num" }
const _hoisted_293 = /*#__PURE__*/_createElementVNode("span", { class: "unit" }, null, -1 /* HOISTED */)
const _hoisted_294 = {
  key: 1,
  class: "spark tall",
  viewBox: "0 0 300 60",
  preserveAspectRatio: "none"
}
const _hoisted_295 = ["points"]
const _hoisted_296 = {
  key: 2,
  class: "hint danger"
}
const _hoisted_297 = {
  key: 1,
  class: "missing"
}
const _hoisted_298 = { class: "raw" }
const _hoisted_299 = { class: "card" }
const _hoisted_300 = { class: "bench-head" }
const _hoisted_301 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_302 = ["disabled"]
const _hoisted_303 = { class: "hint" }
const _hoisted_304 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_305 = { class: "mono" }
const _hoisted_306 = { class: "dim" }
const _hoisted_307 = {
  key: 0,
  class: "badge"
}
const _hoisted_308 = { class: "mono" }
const _hoisted_309 = { class: "mono dim" }
const _hoisted_310 = { class: "mono dim" }
const _hoisted_311 = { class: "mono dim" }
const _hoisted_312 = { class: "card" }
const _hoisted_313 = { class: "bench-head" }
const _hoisted_314 = { class: "tool-row" }
const _hoisted_315 = ["disabled"]
const _hoisted_316 = { class: "kv" }
const _hoisted_317 = {
  key: 0,
  class: "dim"
}
const _hoisted_318 = { class: "waterfall" }
const _hoisted_319 = { class: "wf-name" }
const _hoisted_320 = { class: "wf-bar" }
const _hoisted_321 = { class: "wf-ms mono" }
const _hoisted_322 = { key: 8 }
const _hoisted_323 = { class: "card tool-card" }
const _hoisted_324 = { class: "tool-row" }
const _hoisted_325 = {
  key: 0,
  class: "card"
}
const _hoisted_326 = { class: "kv" }
const _hoisted_327 = { class: "card tool-card" }
const _hoisted_328 = { class: "tool-row" }
const _hoisted_329 = ["value"]
const _hoisted_330 = ["disabled"]
const _hoisted_331 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_332 = { class: "mono" }
const _hoisted_333 = { class: "mono dim" }
const _hoisted_334 = { class: "mono dim" }
const _hoisted_335 = { class: "mono dim" }
const _hoisted_336 = { class: "mono" }
const _hoisted_337 = { class: "card tool-card" }
const _hoisted_338 = ["placeholder"]
const _hoisted_339 = { class: "tool-row" }
const _hoisted_340 = ["disabled"]
const _hoisted_341 = {
  key: 0,
  class: "kv"
}
const _hoisted_342 = { class: "wrap" }
const _hoisted_343 = { class: "wrap" }
const _hoisted_344 = { class: "card tool-card" }
const _hoisted_345 = { class: "tool-row" }
const _hoisted_346 = ["placeholder"]
const _hoisted_347 = {
  key: 0,
  class: "kv"
}
const _hoisted_348 = { key: 9 }
const _hoisted_349 = {
  key: 0,
  class: "card"
}
const _hoisted_350 = { class: "empty-hint" }
const _hoisted_351 = /*#__PURE__*/_createElementVNode("pre", { class: "raw" }, "sudo apt install nmap        # Debian / Ubuntu\nsudo dnf install nmap        # Fedora / RHEL", -1 /* HOISTED */)
const _hoisted_352 = { class: "card tool-card" }
const _hoisted_353 = { class: "tool-row" }
const _hoisted_354 = ["placeholder"]
const _hoisted_355 = ["value"]
const _hoisted_356 = ["disabled"]
const _hoisted_357 = { class: "tool-row" }
const _hoisted_358 = ["placeholder"]
const _hoisted_359 = { class: "hint" }
const _hoisted_360 = { key: 0 }
const _hoisted_361 = {
  key: 0,
  class: "card"
}
const _hoisted_362 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_363 = { class: "kv" }
const _hoisted_364 = { class: "wrap" }
const _hoisted_365 = { class: "nh-head" }
const _hoisted_366 = { class: "mono" }
const _hoisted_367 = {
  key: 0,
  class: "dim"
}
const _hoisted_368 = {
  key: 1,
  class: "badge"
}
const _hoisted_369 = {
  key: 0,
  class: "grid compact"
}
const _hoisted_370 = { class: "mono" }
const _hoisted_371 = { class: "dim" }
const _hoisted_372 = {
  key: 1,
  class: "dim"
}
const _hoisted_373 = { key: 1 }
const _hoisted_374 = { class: "raw" }
const _hoisted_375 = { key: 10 }
const _hoisted_376 = { class: "card tool-card" }
const _hoisted_377 = { class: "seg" }
const _hoisted_378 = ["onClick"]
const _hoisted_379 = { class: "card tool-card" }
const _hoisted_380 = { class: "tool-row" }
const _hoisted_381 = ["placeholder"]
const _hoisted_382 = ["placeholder"]
const _hoisted_383 = ["disabled"]
const _hoisted_384 = { class: "opt" }
const _hoisted_385 = { class: "dim" }
const _hoisted_386 = {
  key: 0,
  class: "card"
}
const _hoisted_387 = { class: "score" }
const _hoisted_388 = {
  key: 0,
  class: "pill bad"
}
const _hoisted_389 = {
  key: 1,
  class: "pill warn"
}
const _hoisted_390 = {
  key: 2,
  class: "pill ok"
}
const _hoisted_391 = {
  key: 1,
  class: "card"
}
const _hoisted_392 = { class: "grid compact" }
const _hoisted_393 = /*#__PURE__*/_createElementVNode("th", null, "DANE", -1 /* HOISTED */)
const _hoisted_394 = { class: "mono" }
const _hoisted_395 = { class: "mono" }
const _hoisted_396 = { class: "mono" }
const _hoisted_397 = { class: "mono wrap" }
const _hoisted_398 = {
  key: 2,
  class: "card"
}
const _hoisted_399 = { class: "kv" }
const _hoisted_400 = /*#__PURE__*/_createElementVNode("span", null, "SPF", -1 /* HOISTED */)
const _hoisted_401 = { class: "wrap" }
const _hoisted_402 = { key: 0 }
const _hoisted_403 = /*#__PURE__*/_createElementVNode("span", null, "DMARC", -1 /* HOISTED */)
const _hoisted_404 = { class: "wrap" }
const _hoisted_405 = /*#__PURE__*/_createElementVNode("span", null, "MTA-STS", -1 /* HOISTED */)
const _hoisted_406 = { class: "wrap" }
const _hoisted_407 = /*#__PURE__*/_createElementVNode("span", null, "TLS-RPT", -1 /* HOISTED */)
const _hoisted_408 = { class: "wrap" }
const _hoisted_409 = /*#__PURE__*/_createElementVNode("span", null, "BIMI", -1 /* HOISTED */)
const _hoisted_410 = { class: "wrap" }
const _hoisted_411 = { key: 0 }
const _hoisted_412 = { class: "raw" }
const _hoisted_413 = { key: 1 }
const _hoisted_414 = {
  key: 2,
  class: "grid compact"
}
const _hoisted_415 = { class: "mono" }
const _hoisted_416 = { class: "mono" }
const _hoisted_417 = { class: "mono wrap tiny" }
const _hoisted_418 = { key: 3 }
const _hoisted_419 = {
  key: 4,
  class: "grid compact"
}
const _hoisted_420 = { class: "mono" }
const _hoisted_421 = { class: "mono" }
const _hoisted_422 = { class: "mono" }
const _hoisted_423 = {
  key: 3,
  class: "card"
}
const _hoisted_424 = { class: "mono" }
const _hoisted_425 = { class: "chips result" }
const _hoisted_426 = ["title"]
const _hoisted_427 = { class: "dim" }
const _hoisted_428 = { class: "card tool-card" }
const _hoisted_429 = { class: "tool-row" }
const _hoisted_430 = ["placeholder"]
const _hoisted_431 = /*#__PURE__*/_createElementVNode("option", { value: "smtp" }, "SMTP", -1 /* HOISTED */)
const _hoisted_432 = /*#__PURE__*/_createElementVNode("option", { value: "imap" }, "IMAP", -1 /* HOISTED */)
const _hoisted_433 = /*#__PURE__*/_createElementVNode("option", { value: "pop3" }, "POP3", -1 /* HOISTED */)
const _hoisted_434 = [
  _hoisted_431,
  _hoisted_432,
  _hoisted_433
]
const _hoisted_435 = { value: "auto" }
const _hoisted_436 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_437 = { value: "tls" }
const _hoisted_438 = { value: "none" }
const _hoisted_439 = ["placeholder"]
const _hoisted_440 = ["disabled"]
const _hoisted_441 = { class: "chips" }
const _hoisted_442 = ["onClick"]
const _hoisted_443 = {
  key: 0,
  class: "card"
}
const _hoisted_444 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_445 = { class: "kv" }
const _hoisted_446 = { class: "wrap" }
const _hoisted_447 = { key: 0 }
const _hoisted_448 = { key: 1 }
const _hoisted_449 = { class: "wrap" }
const _hoisted_450 = { key: 2 }
const _hoisted_451 = { class: "raw" }
const _hoisted_452 = { class: "raw" }
const _hoisted_453 = { class: "card tool-card" }
const _hoisted_454 = { class: "dim" }
const _hoisted_455 = { class: "tool-row" }
const _hoisted_456 = ["placeholder"]
const _hoisted_457 = ["disabled"]
const _hoisted_458 = { key: 0 }
const _hoisted_459 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_460 = { key: 1 }
const _hoisted_461 = { class: "raw" }
const _hoisted_462 = { class: "card tool-card" }
const _hoisted_463 = { class: "tool-row" }
const _hoisted_464 = ["placeholder"]
const _hoisted_465 = ["disabled"]
const _hoisted_466 = {
  key: 0,
  class: "chips result"
}
const _hoisted_467 = ["title"]
const _hoisted_468 = { class: "card tool-card" }
const _hoisted_469 = { class: "dim" }
const _hoisted_470 = { class: "tool-row" }
const _hoisted_471 = { value: 0 }
const _hoisted_472 = ["value"]
const _hoisted_473 = {
  key: 0,
  class: "tool-row"
}
const _hoisted_474 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_475 = { value: "tls" }
const _hoisted_476 = { value: "none" }
const _hoisted_477 = ["placeholder"]
const _hoisted_478 = ["placeholder"]
const _hoisted_479 = ["placeholder"]
const _hoisted_480 = { class: "tool-row" }
const _hoisted_481 = ["placeholder"]
const _hoisted_482 = ["placeholder"]
const _hoisted_483 = ["placeholder"]
const _hoisted_484 = { class: "tool-row" }
const _hoisted_485 = ["disabled"]
const _hoisted_486 = {
  key: 1,
  class: "kv"
}
const _hoisted_487 = { key: 0 }
const _hoisted_488 = { class: "wrap" }
const _hoisted_489 = { key: 2 }
const _hoisted_490 = { class: "raw" }
const _hoisted_491 = { class: "card" }
const _hoisted_492 = { class: "dim" }
const _hoisted_493 = { class: "tool-row" }
const _hoisted_494 = { value: 0 }
const _hoisted_495 = ["value"]
const _hoisted_496 = ["disabled"]
const _hoisted_497 = {
  key: 0,
  class: "tool-row"
}
const _hoisted_498 = /*#__PURE__*/_createElementVNode("option", { value: "imap" }, "IMAP", -1 /* HOISTED */)
const _hoisted_499 = /*#__PURE__*/_createElementVNode("option", { value: "pop3" }, "POP3", -1 /* HOISTED */)
const _hoisted_500 = [
  _hoisted_498,
  _hoisted_499
]
const _hoisted_501 = { value: "tls" }
const _hoisted_502 = /*#__PURE__*/_createElementVNode("option", { value: "starttls" }, "STARTTLS", -1 /* HOISTED */)
const _hoisted_503 = { value: "none" }
const _hoisted_504 = ["placeholder"]
const _hoisted_505 = ["placeholder"]
const _hoisted_506 = {
  key: 1,
  class: "kv"
}
const _hoisted_507 = { key: 0 }
const _hoisted_508 = { key: 1 }
const _hoisted_509 = { key: 2 }
const _hoisted_510 = { class: "wrap" }
const _hoisted_511 = { key: 11 }
const _hoisted_512 = { class: "card tool-card" }
const _hoisted_513 = { class: "dim" }
const _hoisted_514 = { class: "tool-row" }
const _hoisted_515 = ["placeholder"]
const _hoisted_516 = ["disabled"]
const _hoisted_517 = { key: 0 }
const _hoisted_518 = {
  key: 0,
  class: "kv"
}
const _hoisted_519 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_520 = { key: 12 }
const _hoisted_521 = { class: "card tool-card" }
const _hoisted_522 = { class: "dim" }
const _hoisted_523 = { class: "tool-row" }
const _hoisted_524 = /*#__PURE__*/_createElementVNode("option", { value: "sftp" }, "SFTP", -1 /* HOISTED */)
const _hoisted_525 = /*#__PURE__*/_createElementVNode("option", { value: "ftp" }, "FTP", -1 /* HOISTED */)
const _hoisted_526 = [
  _hoisted_524,
  _hoisted_525
]
const _hoisted_527 = ["placeholder"]
const _hoisted_528 = { class: "tool-row" }
const _hoisted_529 = { value: "password" }
const _hoisted_530 = { value: "key" }
const _hoisted_531 = { value: "none" }
const _hoisted_532 = { value: "tls" }
const _hoisted_533 = ["placeholder"]
const _hoisted_534 = ["placeholder"]
const _hoisted_535 = ["placeholder"]
const _hoisted_536 = ["disabled"]
const _hoisted_537 = ["disabled"]
const _hoisted_538 = {
  key: 0,
  class: "dim"
}
const _hoisted_539 = { class: "card tool-card" }
const _hoisted_540 = { class: "tool-row" }
const _hoisted_541 = { value: 0 }
const _hoisted_542 = ["value"]
const _hoisted_543 = ["disabled"]
const _hoisted_544 = {
  key: 0,
  class: "dim"
}
const _hoisted_545 = {
  key: 0,
  class: "card"
}
const _hoisted_546 = {
  key: 0,
  class: "tool-row"
}
const _hoisted_547 = { class: "mono" }
const _hoisted_548 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_549 = { class: "path-bar" }
const _hoisted_550 = ["disabled"]
const _hoisted_551 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_552 = {
  key: 1,
  class: "grid compact"
}
const _hoisted_553 = /*#__PURE__*/_createElementVNode("th", null, null, -1 /* HOISTED */)
const _hoisted_554 = ["onClick"]
const _hoisted_555 = { key: 1 }
const _hoisted_556 = { class: "mono dim" }
const _hoisted_557 = { class: "dim" }
const _hoisted_558 = { class: "mono dim tiny" }
const _hoisted_559 = { class: "row-actions" }
const _hoisted_560 = ["disabled", "onClick"]
const _hoisted_561 = ["onClick"]
const _hoisted_562 = ["onClick"]
const _hoisted_563 = {
  key: 2,
  class: "empty-hint"
}
const _hoisted_564 = {
  key: 1,
  class: "card tool-card"
}
const _hoisted_565 = { class: "tool-row" }
const _hoisted_566 = ["placeholder"]
const _hoisted_567 = { class: "dim" }
const _hoisted_568 = { class: "tool-row" }
const _hoisted_569 = ["placeholder"]
const _hoisted_570 = ["disabled"]
const _hoisted_571 = {
  key: 0,
  class: "note-line"
}
const _hoisted_572 = { key: 13 }
const _hoisted_573 = { class: "card tool-card" }
const _hoisted_574 = { class: "tool-row" }
const _hoisted_575 = ["placeholder"]
const _hoisted_576 = ["disabled"]
const _hoisted_577 = ["disabled"]
const _hoisted_578 = { class: "opt" }
const _hoisted_579 = {
  key: 0,
  class: "card"
}
const _hoisted_580 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_581 = { class: "kv" }
const _hoisted_582 = { class: "wrap" }
const _hoisted_583 = { key: 0 }
const _hoisted_584 = {
  key: 1,
  class: "grid compact"
}
const _hoisted_585 = { class: "mono" }
const _hoisted_586 = { class: "mono" }
const _hoisted_587 = { class: "mono wrap tiny" }
const _hoisted_588 = { class: "kv" }
const _hoisted_589 = { class: "wrap tiny" }
const _hoisted_590 = {
  key: 1,
  class: "card"
}
const _hoisted_591 = /*#__PURE__*/_createElementVNode("h3", null, "Telnet", -1 /* HOISTED */)
const _hoisted_592 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_593 = {
  key: 1,
  class: "raw"
}
const _hoisted_594 = {
  key: 2,
  class: "card tool-card"
}
const _hoisted_595 = { class: "dim" }
const _hoisted_596 = { class: "tool-row" }
const _hoisted_597 = ["placeholder"]
const _hoisted_598 = { value: "password" }
const _hoisted_599 = { value: "key" }
const _hoisted_600 = { class: "tool-row" }
const _hoisted_601 = ["placeholder"]
const _hoisted_602 = ["placeholder"]
const _hoisted_603 = ["placeholder"]
const _hoisted_604 = ["disabled"]
const _hoisted_605 = ["disabled"]
const _hoisted_606 = {
  key: 3,
  class: "card tool-card"
}
const _hoisted_607 = { class: "dim" }
const _hoisted_608 = { class: "tool-row" }
const _hoisted_609 = { value: 0 }
const _hoisted_610 = ["value"]
const _hoisted_611 = { class: "tool-row" }
const _hoisted_612 = { value: "" }
const _hoisted_613 = ["value"]
const _hoisted_614 = ["disabled"]
const _hoisted_615 = { class: "tool-row" }
const _hoisted_616 = ["placeholder"]
const _hoisted_617 = ["disabled"]
const _hoisted_618 = ["disabled"]
const _hoisted_619 = { key: 0 }
const _hoisted_620 = { class: "kv" }
const _hoisted_621 = { class: "wrap" }
const _hoisted_622 = { class: "raw" }
const _hoisted_623 = { class: "modal" }
const _hoisted_624 = { class: "drawer-head" }
const _hoisted_625 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖥", -1 /* HOISTED */)
const _hoisted_626 = { class: "dim" }
const _hoisted_627 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_628 = { class: "drawer-body" }
const _hoisted_629 = { class: "kv" }
const _hoisted_630 = /*#__PURE__*/_createElementVNode("span", null, "NetBase", -1 /* HOISTED */)
const _hoisted_631 = { key: 0 }
const _hoisted_632 = { key: 1 }
const _hoisted_633 = /*#__PURE__*/_createElementVNode("span", null, "PHP", -1 /* HOISTED */)
const _hoisted_634 = {
  key: 0,
  class: "dim"
}
const _hoisted_635 = { key: 2 }
const _hoisted_636 = { key: 3 }
const _hoisted_637 = { class: "dim" }
const _hoisted_638 = {
  key: 0,
  class: "card"
}
const _hoisted_639 = { class: "kv" }
const _hoisted_640 = { class: "grid compact" }
const _hoisted_641 = /*#__PURE__*/_createElementVNode("th", null, "MTU", -1 /* HOISTED */)
const _hoisted_642 = { class: "mono" }
const _hoisted_643 = { class: "mono dim" }
const _hoisted_644 = { class: "mono" }
const _hoisted_645 = { class: "dim mono" }
const _hoisted_646 = { key: 0 }
const _hoisted_647 = { class: "raw" }
const _hoisted_648 = {
  key: 1,
  class: "dim"
}
const _hoisted_649 = { class: "pill ok" }
const _hoisted_650 = { class: "dim" }
const _hoisted_651 = {
  key: 2,
  class: "dim"
}
const _hoisted_652 = { class: "pill no" }
const _hoisted_653 = { class: "dim" }
const _hoisted_654 = {
  key: 0,
  class: "raw"
}
const _hoisted_655 = {
  key: 1,
  class: "dim"
}
const _hoisted_656 = { class: "drawer-foot" }
const _hoisted_657 = ["href"]
const _hoisted_658 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_659 = { class: "modal narrow" }
const _hoisted_660 = { class: "drawer-head" }
const _hoisted_661 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🎨", -1 /* HOISTED */)
const _hoisted_662 = { class: "dim" }
const _hoisted_663 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_664 = { class: "drawer-body" }
const _hoisted_665 = { class: "theme-picks" }
const _hoisted_666 = ["onClick"]
const _hoisted_667 = /*#__PURE__*/_createElementVNode("i", { class: "bar" }, null, -1 /* HOISTED */)
const _hoisted_668 = /*#__PURE__*/_createElementVNode("i", { class: "line" }, null, -1 /* HOISTED */)
const _hoisted_669 = /*#__PURE__*/_createElementVNode("i", { class: "line short" }, null, -1 /* HOISTED */)
const _hoisted_670 = [
  _hoisted_667,
  _hoisted_668,
  _hoisted_669
]
const _hoisted_671 = { class: "dim" }
const _hoisted_672 = {
  key: 0,
  class: "tick"
}
const _hoisted_673 = { class: "dim" }
const _hoisted_674 = { class: "fl" }
const _hoisted_675 = ["value"]
const _hoisted_676 = { value: "auto" }
const _hoisted_677 = ["value"]
const _hoisted_678 = { class: "dim" }
const _hoisted_679 = { class: "dim" }
const _hoisted_680 = ["disabled"]
const _hoisted_681 = { class: "drawer-foot" }
const _hoisted_682 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_683 = ["onMousedown"]
const _hoisted_684 = ["onMousedown"]
const _hoisted_685 = /*#__PURE__*/_createElementVNode("span", { class: "ic" }, "🖥", -1 /* HOISTED */)
const _hoisted_686 = { class: "nm" }
const _hoisted_687 = { class: "dim mono tiny addr" }
const _hoisted_688 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_689 = ["title", "disabled", "onClick"]
const _hoisted_690 = ["title", "onClick"]
const _hoisted_691 = ["title", "onClick"]
const _hoisted_692 = ["title", "onClick"]
const _hoisted_693 = ["title", "onClick"]
const _hoisted_694 = {
  key: 0,
  class: "devwin-bar"
}
const _hoisted_695 = ["onClick"]
const _hoisted_696 = {
  key: 1,
  class: "devwin-note dim"
}
const _hoisted_697 = {
  key: 2,
  class: "devwin-note error"
}
const _hoisted_698 = ["src", "title"]
const _hoisted_699 = ["src", "title"]
const _hoisted_700 = ["onMousedown"]
const _hoisted_701 = { class: "modal" }
const _hoisted_702 = { class: "drawer-head" }
const _hoisted_703 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "📂", -1 /* HOISTED */)
const _hoisted_704 = { class: "dim tiny" }
const _hoisted_705 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_706 = { class: "drawer-body" }
const _hoisted_707 = { class: "path-bar" }
const _hoisted_708 = ["disabled"]
const _hoisted_709 = { class: "mono dim" }
const _hoisted_710 = { class: "grid compact" }
const _hoisted_711 = ["onClick"]
const _hoisted_712 = ["onClick"]
const _hoisted_713 = { class: "mono dim" }
const _hoisted_714 = { class: "dim" }
const _hoisted_715 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_716 = { class: "drawer-foot" }
const _hoisted_717 = { class: "dim tiny" }
const _hoisted_718 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_719 = { class: "modal wide term-modal" }
const _hoisted_720 = { class: "drawer-head" }
const _hoisted_721 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖳", -1 /* HOISTED */)
const _hoisted_722 = { class: "dim mono tiny" }
const _hoisted_723 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_724 = {
  class: "term-body",
  ref: "termBody"
}
const _hoisted_725 = { class: "dim tiny" }
const _hoisted_726 = {
  key: 0,
  class: "term-prompt"
}
const _hoisted_727 = {
  key: 0,
  class: "term-line dim"
}
const _hoisted_728 = { class: "term-input" }
const _hoisted_729 = { class: "term-prompt mono" }
const _hoisted_730 = { class: "modal wide" }
const _hoisted_731 = { class: "drawer-head" }
const _hoisted_732 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🖼", -1 /* HOISTED */)
const _hoisted_733 = { class: "dim mono tiny" }
const _hoisted_734 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_735 = ["href", "title"]
const _hoisted_736 = ["disabled"]
const _hoisted_737 = { class: "drawer-body preview-body" }
const _hoisted_738 = {
  key: 0,
  class: "dim centred-text"
}
const _hoisted_739 = {
  key: 1,
  class: "empty-hint"
}
const _hoisted_740 = ["src", "alt"]
const _hoisted_741 = { class: "drawer-foot" }
const _hoisted_742 = { class: "opt" }
const _hoisted_743 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_744 = { class: "modal narrow" }
const _hoisted_745 = { class: "drawer-head" }
const _hoisted_746 = /*#__PURE__*/_createElementVNode("span", { class: "ic big" }, "🔗", -1 /* HOISTED */)
const _hoisted_747 = { class: "dim" }
const _hoisted_748 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_749 = { class: "drawer-body" }
const _hoisted_750 = { class: "fl" }
const _hoisted_751 = { class: "fl-label" }
const _hoisted_752 = ["value"]
const _hoisted_753 = { class: "fl" }
const _hoisted_754 = { class: "fl-label" }
const _hoisted_755 = ["placeholder"]
const _hoisted_756 = { class: "fl-row" }
const _hoisted_757 = { class: "fl grow" }
const _hoisted_758 = { class: "fl-label" }
const _hoisted_759 = { class: "fl short" }
const _hoisted_760 = { class: "fl-label" }
const _hoisted_761 = {
  key: 0,
  class: "fl"
}
const _hoisted_762 = { class: "fl-label" }
const _hoisted_763 = ["value"]
const _hoisted_764 = {
  key: 1,
  class: "fl"
}
const _hoisted_765 = { class: "fl-label" }
const _hoisted_766 = { value: "password" }
const _hoisted_767 = { value: "key" }
const _hoisted_768 = { class: "fl-row" }
const _hoisted_769 = { class: "fl grow" }
const _hoisted_770 = { class: "fl-label" }
const _hoisted_771 = {
  key: 0,
  class: "fl grow"
}
const _hoisted_772 = { class: "fl-label" }
const _hoisted_773 = {
  key: 1,
  class: "fl grow"
}
const _hoisted_774 = { class: "fl-label" }
const _hoisted_775 = { class: "fl" }
const _hoisted_776 = { class: "fl-label" }
const _hoisted_777 = { class: "with-button" }
const _hoisted_778 = { class: "dim" }
const _hoisted_779 = { class: "fl" }
const _hoisted_780 = { class: "fl-label" }
const _hoisted_781 = {
  key: 3,
  class: "fl"
}
const _hoisted_782 = { class: "fl-label" }
const _hoisted_783 = {
  key: 4,
  class: "fl"
}
const _hoisted_784 = { class: "fl-label" }
const _hoisted_785 = {
  key: 5,
  class: "opt"
}
const _hoisted_786 = { class: "fl" }
const _hoisted_787 = { class: "fl-label" }
const _hoisted_788 = {
  key: 6,
  class: "note-line"
}
const _hoisted_789 = { class: "drawer-foot" }
const _hoisted_790 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_791 = ["disabled"]
const _hoisted_792 = { class: "drawer" }
const _hoisted_793 = { class: "drawer-head" }
const _hoisted_794 = { class: "ic big" }
const _hoisted_795 = ["placeholder", "readonly"]
const _hoisted_796 = { class: "dim mono" }
const _hoisted_797 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_798 = { class: "drawer-body" }
const _hoisted_799 = { class: "kv" }
const _hoisted_800 = { key: 0 }
const _hoisted_801 = ["title", "onClick"]
const _hoisted_802 = ["title", "onClick"]
const _hoisted_803 = { key: 2 }
const _hoisted_804 = { key: 3 }
const _hoisted_805 = { key: 0 }
const _hoisted_806 = { key: 1 }
const _hoisted_807 = /*#__PURE__*/_createElementVNode("span", null, "mDNS", -1 /* HOISTED */)
const _hoisted_808 = { key: 2 }
const _hoisted_809 = { key: 3 }
const _hoisted_810 = /*#__PURE__*/_createElementVNode("span", null, "SSDP", -1 /* HOISTED */)
const _hoisted_811 = { class: "wrap" }
const _hoisted_812 = { class: "fl" }
const _hoisted_813 = { class: "fl-label" }
const _hoisted_814 = ["value"]
const _hoisted_815 = { class: "fl" }
const _hoisted_816 = { class: "fl-label" }
const _hoisted_817 = ["placeholder"]
const _hoisted_818 = { class: "fl" }
const _hoisted_819 = { class: "fl-label" }
const _hoisted_820 = {
  key: 1,
  class: "kv"
}
const _hoisted_821 = { key: 0 }
const _hoisted_822 = { key: 1 }
const _hoisted_823 = { class: "wrap" }
const _hoisted_824 = { class: "drawer-tools" }
const _hoisted_825 = ["onClick"]
const _hoisted_826 = ["onClick"]
const _hoisted_827 = ["href", "title"]
const _hoisted_828 = { class: "drawer-foot" }
const _hoisted_829 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)

return function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("aside", _hoisted_2, [
      _createElementVNode("div", _hoisted_3, [
        _hoisted_4,
        (_ctx.version)
          ? (_openBlock(), _createElementBlock("span", _hoisted_6, "v" + _toDisplayString(_ctx.version), 1 /* TEXT */))
          : _createCommentVNode("v-if", true)
      ]),
      _createElementVNode("nav", {
        class: "nav-list",
        onDragover: _cache[1] || (_cache[1] = _withModifiers(() => {}, ["prevent"])),
        onDrop: _cache[2] || (_cache[2] = _withModifiers($event => (_ctx.dropTab(null)), ["prevent"]))
      }, [
        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.visibleTabs, (item) => {
          return (_openBlock(), _createElementBlock("button", {
            key: item.id,
            class: _normalizeClass(["nav-item", {active: _ctx.tab===item.id, dragged: _ctx.dragTab===item.id, over: _ctx.overTab===item.id}]),
            draggable: "true",
            title: _ctx.t('Drag to put the tools in the order you want'),
            onClick: $event => (_ctx.tab=item.id),
            onKeydown: $event => (_ctx.moveTabByKey(item, $event)),
            onDragstart: $event => (_ctx.startTabDrag(item, $event)),
            onDragend: _cache[0] || (_cache[0] = (...args) => (_ctx.endTabDrag && _ctx.endTabDrag(...args))),
            onDragover: _withModifiers($event => (_ctx.overTab = item.id), ["prevent"]),
            onDragleave: $event => (_ctx.overTab === item.id && (_ctx.overTab = '')),
            onDrop: _withModifiers($event => (_ctx.dropTab(item)), ["prevent","stop"])
          }, [
            _createElementVNode("span", _hoisted_8, _toDisplayString(item.icon), 1 /* TEXT */),
            _createElementVNode("span", _hoisted_9, _toDisplayString(_ctx.t(item.label)), 1 /* TEXT */),
            (item.id==='devices' && _ctx.devices.length)
              ? (_openBlock(), _createElementBlock("span", _hoisted_10, _toDisplayString(_ctx.onlineCount), 1 /* TEXT */))
              : _createCommentVNode("v-if", true),
            _hoisted_11
          ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_7))
        }), 128 /* KEYED_FRAGMENT */))
      ], 32 /* NEED_HYDRATION */),
      _createElementVNode("div", _hoisted_12, [
        (_ctx.status.canScan)
          ? (_openBlock(), _createElementBlock("button", {
              key: 0,
              class: "btn primary block",
              disabled: _ctx.scanning,
              onClick: _cache[3] || (_cache[3] = $event => (_ctx.startScan()))
            }, _toDisplayString(_ctx.scanning ? _ctx.t('Scanning…') : _ctx.t('🛰️ Scan the network')), 9 /* TEXT, PROPS */, _hoisted_13))
          : _createCommentVNode("v-if", true),
        (_ctx.status.isAdmin)
          ? (_openBlock(), _createElementBlock("button", {
              key: 1,
              class: "btn sm block",
              onClick: _cache[4] || (_cache[4] = (...args) => (_ctx.openSysInfo && _ctx.openSysInfo(...args)))
            }, _toDisplayString(_ctx.t('🖥 System information')), 1 /* TEXT */))
          : _createCommentVNode("v-if", true),
        _createElementVNode("button", {
          class: "btn sm block",
          onClick: _cache[5] || (_cache[5] = $event => (_ctx.themeBox = true))
        }, _toDisplayString(_ctx.t('⚙ Settings')), 1 /* TEXT */)
      ])
    ]),
    _createElementVNode("main", _hoisted_14, [
      _createElementVNode("div", _hoisted_15, [
        _createElementVNode("div", _hoisted_16, [
          _createElementVNode("span", _hoisted_17, _toDisplayString(_ctx.currentTab.icon), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_18, _toDisplayString(_ctx.t(_ctx.currentTab.label)), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_19, _toDisplayString(_ctx.t(_ctx.currentTab.hint)), 1 /* TEXT */)
        ]),
        _hoisted_20,
        (_ctx.tab==='devices')
          ? (_openBlock(), _createElementBlock("div", _hoisted_21, [
              _withDirectives(_createElementVNode("input", {
                class: "filter",
                "onUpdate:modelValue": _cache[6] || (_cache[6] = $event => ((_ctx.filter) = $event)),
                placeholder: _ctx.t('Filter by name, IP, MAC or vendor')
              }, null, 8 /* PROPS */, _hoisted_22), [
                [_vModelText, _ctx.filter]
              ]),
              _createElementVNode("button", {
                class: _normalizeClass(["btn sm", {active: _ctx.onlyOnline}]),
                onClick: _cache[7] || (_cache[7] = $event => (_ctx.onlyOnline=!_ctx.onlyOnline))
              }, _toDisplayString(_ctx.onlyOnline ? _ctx.t('Online only') : _ctx.t('All records')), 3 /* TEXT, CLASS */),
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[8] || (_cache[8] = (...args) => (_ctx.exportCsv && _ctx.exportCsv(...args))),
                disabled: !_ctx.shownDevices.length
              }, _toDisplayString(_ctx.t('⤓ CSV')), 9 /* TEXT, PROPS */, _hoisted_23)
            ]))
          : _createCommentVNode("v-if", true)
      ]),
      _createElementVNode("div", _hoisted_24, [
        (_ctx.banner)
          ? (_openBlock(), _createElementBlock("div", {
              key: 0,
              class: _normalizeClass(["banner", _ctx.banner.kind])
            }, [
              _createElementVNode("span", null, _toDisplayString(_ctx.banner.text), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[9] || (_cache[9] = $event => (_ctx.banner=null))
              }, "✕")
            ], 2 /* CLASS */))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ devices ============ "),
        (_ctx.tab==='devices')
          ? (_openBlock(), _createElementBlock("section", _hoisted_25, [
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_26, [
                    _createElementVNode("div", _hoisted_27, [
                      _createElementVNode("label", _hoisted_28, [
                        _createElementVNode("span", _hoisted_29, _toDisplayString(_ctx.t('Networks to scan')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[10] || (_cache[10] = $event => ((_ctx.scanTargets) = $event)),
                          placeholder: _ctx.suggestedPlaceholder
                        }, null, 8 /* PROPS */, _hoisted_30), [
                          [_vModelText, _ctx.scanTargets]
                        ])
                      ]),
                      _createElementVNode("label", _hoisted_31, [
                        _createElementVNode("span", _hoisted_32, _toDisplayString(_ctx.t('Pace')), 1 /* TEXT */),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[11] || (_cache[11] = $event => ((_ctx.pace) = $event))
                        }, [
                          _createElementVNode("option", _hoisted_33, _toDisplayString(_ctx.t('Fast')), 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_34, _toDisplayString(_ctx.t('Gentle')), 1 /* TEXT */)
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.pace]
                        ])
                      ]),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: _ctx.scanning,
                        onClick: _cache[12] || (_cache[12] = $event => (_ctx.startScan()))
                      }, _toDisplayString(_ctx.scanning ? _ctx.t('Scanning…') : _ctx.t('Start')), 9 /* TEXT, PROPS */, _hoisted_35),
                      (_ctx.scanning)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 0,
                            class: "btn",
                            onClick: _cache[13] || (_cache[13] = (...args) => (_ctx.cancelScan && _ctx.cancelScan(...args)))
                          }, _toDisplayString(_ctx.t('Stop')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_36, [
                      _createElementVNode("label", null, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[14] || (_cache[14] = $event => ((_ctx.opts.names) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.names]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Ask devices for their names')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("label", null, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[15] || (_cache[15] = $event => ((_ctx.opts.multicast) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.multicast]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Multicast discovery')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("label", null, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[16] || (_cache[16] = $event => ((_ctx.opts.ports) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.ports]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Check common ports')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("label", null, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[17] || (_cache[17] = $event => ((_ctx.opts.rdns) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.rdns]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Reverse DNS')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("label", null, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[18] || (_cache[18] = $event => ((_ctx.opts.arpOnly) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.opts.arpOnly]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Read neighbour table only (instant)')), 1 /* TEXT */)
                      ])
                    ]),
                    (_ctx.scan)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_37, [
                          _createElementVNode("div", _hoisted_38, [
                            _createElementVNode("div", {
                              class: "fill",
                              style: _normalizeStyle({width: _ctx.scan.percent + '%'})
                            }, null, 4 /* STYLE */)
                          ]),
                          _createElementVNode("div", _hoisted_39, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.progressText(_ctx.scan)), 1 /* TEXT */),
                            _hoisted_40,
                            _createElementVNode("span", null, _toDisplayString(_ctx.scan.percent) + "%", 1 /* TEXT */)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.advice && !_ctx.advice.ok)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_41, [
                          _createTextVNode(" ⚠ " + _toDisplayString(_ctx.t('This target has {hosts} addresses but the kernel neighbour table holds {gc3}. The sweep still works, but the kernel will log overflow warnings. To avoid that, an administrator can run:', { hosts: _ctx.advice.hosts, gc3: _ctx.advice.gc3 })) + " ", 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(_ctx.advice.advice), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (!_ctx.shownDevices.length)
                ? (_openBlock(), _createElementBlock("div", _hoisted_42, _toDisplayString(_ctx.allowed('scan') ? _ctx.t('No devices recorded yet. Start a scan to build the list.') : _ctx.t('No devices have been recorded yet. An administrator has to run a scan first.')), 1 /* TEXT */))
                : (_openBlock(), _createElementBlock("table", _hoisted_43, [
                    _createElementVNode("thead", null, [
                      _createElementVNode("tr", null, [
                        _hoisted_44,
                        _createElementVNode("th", {
                          onClick: _cache[19] || (_cache[19] = $event => (_ctx.sortBy('name'))),
                          class: _normalizeClass(_ctx.sortClass('name'))
                        }, _toDisplayString(_ctx.t('Name')), 3 /* TEXT, CLASS */),
                        _createElementVNode("th", {
                          onClick: _cache[20] || (_cache[20] = $event => (_ctx.sortBy('ip'))),
                          class: _normalizeClass(_ctx.sortClass('ip'))
                        }, _toDisplayString(_ctx.t('IPv4')), 3 /* TEXT, CLASS */),
                        _createElementVNode("th", {
                          onClick: _cache[21] || (_cache[21] = $event => (_ctx.sortBy('mac'))),
                          class: _normalizeClass(_ctx.sortClass('mac'))
                        }, _toDisplayString(_ctx.t('MAC address')), 3 /* TEXT, CLASS */),
                        _createElementVNode("th", {
                          onClick: _cache[22] || (_cache[22] = $event => (_ctx.sortBy('vendor'))),
                          class: _normalizeClass(_ctx.sortClass('vendor'))
                        }, _toDisplayString(_ctx.t('Vendor')), 3 /* TEXT, CLASS */),
                        _createElementVNode("th", {
                          onClick: _cache[23] || (_cache[23] = $event => (_ctx.sortBy('type'))),
                          class: _normalizeClass(_ctx.sortClass('type'))
                        }, _toDisplayString(_ctx.t('Type')), 3 /* TEXT, CLASS */),
                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Open ports')), 1 /* TEXT */),
                        _createElementVNode("th", {
                          onClick: _cache[24] || (_cache[24] = $event => (_ctx.sortBy('lastSeen'))),
                          class: _normalizeClass(_ctx.sortClass('lastSeen'))
                        }, _toDisplayString(_ctx.t('Last seen')), 3 /* TEXT, CLASS */)
                      ])
                    ]),
                    _createElementVNode("tbody", null, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.shownDevices, (d) => {
                        return (_openBlock(), _createElementBlock("tr", {
                          key: d.id,
                          onClick: $event => (_ctx.openDevice(d)),
                          class: _normalizeClass({offline: !d.online})
                        }, [
                          _createElementVNode("td", _hoisted_46, [
                            _createElementVNode("span", {
                              class: _normalizeClass(["dot", {on: d.online}]),
                              title: d.online ? _ctx.t('Online') : _ctx.t('Not seen in the last sweep')
                            }, null, 10 /* CLASS, PROPS */, _hoisted_47)
                          ]),
                          _createElementVNode("td", _hoisted_48, [
                            _createElementVNode("span", _hoisted_49, _toDisplayString(_ctx.icon(d)), 1 /* TEXT */),
                            _createElementVNode("span", _hoisted_50, _toDisplayString(d.name), 1 /* TEXT */),
                            (d.label)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_51, _toDisplayString(_ctx.t('named')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true)
                          ]),
                          _createElementVNode("td", _hoisted_52, _toDisplayString(d.ip), 1 /* TEXT */),
                          _createElementVNode("td", _hoisted_53, _toDisplayString(d.mac || '—'), 1 /* TEXT */),
                          _createElementVNode("td", null, _toDisplayString(_ctx.vendorText(d)), 1 /* TEXT */),
                          _createElementVNode("td", null, _toDisplayString(_ctx.t(_ctx.typeLabel(d.type))), 1 /* TEXT */),
                          _createElementVNode("td", {
                            class: "mono dim ports-cell",
                            onClick: _cache[25] || (_cache[25] = _withModifiers(() => {}, ["stop"]))
                          }, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(d.ports, (p, i) => {
                              return (_openBlock(), _createElementBlock(_Fragment, { key: p }, [
                                (_ctx.portLink(d, p))
                                  ? (_openBlock(), _createElementBlock("a", {
                                      key: 0,
                                      href: "#",
                                      title: _ctx.portLink(d, p).title,
                                      onClick: _withModifiers($event => (_ctx.openDeviceWindow(d, p)), ["prevent"])
                                    }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_54))
                                  : (_ctx.portTool(d, p))
                                    ? (_openBlock(), _createElementBlock("a", {
                                        key: 1,
                                        href: "#",
                                        title: _ctx.portTool(d, p).title,
                                        onClick: _withModifiers($event => (_ctx.openPortTool(d, p)), ["prevent"])
                                      }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_55))
                                    : (_openBlock(), _createElementBlock("span", _hoisted_56, _toDisplayString(p), 1 /* TEXT */)),
                                (i < d.ports.length - 1)
                                  ? (_openBlock(), _createElementBlock("span", _hoisted_57, ", "))
                                  : _createCommentVNode("v-if", true)
                              ], 64 /* STABLE_FRAGMENT */))
                            }), 128 /* KEYED_FRAGMENT */)),
                            (!d.ports.length)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_58, "—"))
                              : _createCommentVNode("v-if", true)
                          ]),
                          _createElementVNode("td", _hoisted_59, _toDisplayString(_ctx.ago(d.lastSeen)), 1 /* TEXT */)
                        ], 10 /* CLASS, PROPS */, _hoisted_45))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ dns ============ "),
        (_ctx.tab==='dns')
          ? (_openBlock(), _createElementBlock("section", _hoisted_60, [
              _createElementVNode("div", _hoisted_61, [
                _createElementVNode("div", _hoisted_62, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsViews, (v) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: v.id,
                      class: _normalizeClass(["seg-btn", {active: _ctx.dnsView===v.id}]),
                      onClick: $event => (_ctx.dnsView=v.id)
                    }, _toDisplayString(_ctx.t(v.label)), 11 /* TEXT, CLASS, PROPS */, _hoisted_63))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.dnsView==='records')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_64, [
                      _createElementVNode("div", _hoisted_65, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[26] || (_cache[26] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[27] || (_cache[27] = _withKeys((...args) => (_ctx.runDns && _ctx.runDns(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_66), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dns,
                          onClick: _cache[28] || (_cache[28] = (...args) => (_ctx.runDns && _ctx.runDns(...args)))
                        }, _toDisplayString(_ctx.t('Look up')), 9 /* TEXT, PROPS */, _hoisted_67)
                      ]),
                      _createElementVNode("div", _hoisted_68, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsTypes, (ty) => {
                          return (_openBlock(), _createElementBlock("label", { key: ty }, [
                            _withDirectives(_createElementVNode("input", {
                              type: "checkbox",
                              value: ty,
                              "onUpdate:modelValue": _cache[29] || (_cache[29] = $event => ((_ctx.dnsWanted) = $event))
                            }, null, 8 /* PROPS */, _hoisted_69), [
                              [_vModelCheckbox, _ctx.dnsWanted]
                            ]),
                            _createTextVNode(" " + _toDisplayString(ty), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_ctx.dnsResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_70, [
                          _createElementVNode("table", _hoisted_71, [
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
                                  _createElementVNode("td", _hoisted_72, _toDisplayString(r.type), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_73, _toDisplayString(r.ttl), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_74, _toDisplayString(r.value), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (!_ctx.dnsResult.records.length)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_75, _toDisplayString(_ctx.t('No records returned.')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.dnsResult.analysis && (_ctx.dnsResult.analysis.spf || _ctx.dnsResult.analysis.dmarc))
                            ? (_openBlock(), _createElementBlock("div", _hoisted_76, [
                                (_ctx.dnsResult.analysis.spf)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_77, [
                                      _hoisted_78,
                                      _createElementVNode("code", null, _toDisplayString(_ctx.dnsResult.analysis.spf), 1 /* TEXT */)
                                    ]))
                                  : _createCommentVNode("v-if", true),
                                (_ctx.dnsResult.analysis.dmarc)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_79, [
                                      _hoisted_80,
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
                    _createElementVNode("div", _hoisted_81, [
                      _createElementVNode("div", _hoisted_82, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[30] || (_cache[30] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[31] || (_cache[31] = _withKeys((...args) => (_ctx.runDnsQuery && _ctx.runDnsQuery(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_83), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[32] || (_cache[32] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_84))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[33] || (_cache[33] = $event => ((_ctx.dnsServer) = $event)),
                          class: "short",
                          placeholder: _ctx.t('Resolver (blank = this server)')
                        }, null, 8 /* PROPS */, _hoisted_85), [
                          [_vModelText, _ctx.dnsServer]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dnsq,
                          onClick: _cache[34] || (_cache[34] = (...args) => (_ctx.runDnsQuery && _ctx.runDnsQuery(...args)))
                        }, _toDisplayString(_ctx.t('Ask')), 9 /* TEXT, PROPS */, _hoisted_86)
                      ]),
                      _createElementVNode("label", _hoisted_87, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[35] || (_cache[35] = $event => ((_ctx.dnsDnssec) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.dnsDnssec]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Ask the resolver to validate DNSSEC')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("p", _hoisted_88, _toDisplayString(_ctx.t('Any record type, from any resolver — NetBase speaks DNS itself instead of going through PHP.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsQueryResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_89, [
                          _createElementVNode("div", _hoisted_90, [
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
                              ? (_openBlock(), _createElementBlock("div", _hoisted_91, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Error')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_92, _toDisplayString(_ctx.dnsQueryResult.error), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]),
                          (_ctx.dnsQueryResult.answers.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_93, [
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
                                      _createElementVNode("td", _hoisted_94, _toDisplayString(r.name), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_95, _toDisplayString(r.type), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_96, _toDisplayString(r.ttl), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_97, _toDisplayString(r.value), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : (_openBlock(), _createElementBlock("p", _hoisted_98, _toDisplayString(_ctx.t('No records returned.')), 1 /* TEXT */)),
                          (_ctx.dnsQueryResult.authority.length)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_99, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Authority section')), 1 /* TEXT */),
                                _createElementVNode("table", _hoisted_100, [
                                  _createElementVNode("tbody", null, [
                                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsQueryResult.authority, (r, i) => {
                                      return (_openBlock(), _createElementBlock("tr", { key: i }, [
                                        _createElementVNode("td", _hoisted_101, _toDisplayString(r.name), 1 /* TEXT */),
                                        _createElementVNode("td", _hoisted_102, _toDisplayString(r.type), 1 /* TEXT */),
                                        _createElementVNode("td", _hoisted_103, _toDisplayString(r.value), 1 /* TEXT */)
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
                    _createElementVNode("div", _hoisted_104, [
                      _createElementVNode("div", _hoisted_105, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[36] || (_cache[36] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[37] || (_cache[37] = _withKeys((...args) => (_ctx.runDnsCompare && _ctx.runDnsCompare(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_106), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[38] || (_cache[38] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_107))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dnsc,
                          onClick: _cache[39] || (_cache[39] = (...args) => (_ctx.runDnsCompare && _ctx.runDnsCompare(...args)))
                        }, _toDisplayString(_ctx.t('Compare resolvers')), 9 /* TEXT, PROPS */, _hoisted_108)
                      ]),
                      _createElementVNode("p", _hoisted_109, _toDisplayString(_ctx.t('Asks this server and the large public resolvers the same question, so you can see whether a change has spread yet.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsCompareResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_110, [
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
                          _createElementVNode("table", _hoisted_111, [
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
                                    _createElementVNode("span", _hoisted_112, _toDisplayString(r.server), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", _hoisted_113, _toDisplayString(r.ms) + " ms", 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_114, _toDisplayString(r.status), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_115, [
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
                    _createElementVNode("div", _hoisted_116, [
                      _createElementVNode("div", _hoisted_117, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[40] || (_cache[40] = $event => ((_ctx.dnsHost) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[41] || (_cache[41] = _withKeys((...args) => (_ctx.runDnsTrace && _ctx.runDnsTrace(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_118), [
                          [_vModelText, _ctx.dnsHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[42] || (_cache[42] = $event => ((_ctx.dnsType) = $event)),
                          class: "tiny"
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsAllTypes, (ty) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: ty,
                              value: ty
                            }, _toDisplayString(ty), 9 /* TEXT, PROPS */, _hoisted_119))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.dnsType]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.dnst,
                          onClick: _cache[43] || (_cache[43] = (...args) => (_ctx.runDnsTrace && _ctx.runDnsTrace(...args)))
                        }, _toDisplayString(_ctx.t('Trace from the root')), 9 /* TEXT, PROPS */, _hoisted_120)
                      ]),
                      _createElementVNode("p", _hoisted_121, _toDisplayString(_ctx.t('Follows the delegation the way a resolver does, so a broken hand-off between zones is visible.')), 1 /* TEXT */)
                    ]),
                    (_ctx.dnsTraceResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_122, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dnsTraceResult.steps, (s, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: "trace-step"
                            }, [
                              _createElementVNode("div", _hoisted_123, [
                                _createElementVNode("span", _hoisted_124, _toDisplayString(i + 1), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("strong", _hoisted_125, _toDisplayString(s.serverName), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("span", _hoisted_126, _toDisplayString(s.server), 1 /* TEXT */),
                                _createTextVNode(),
                                _createElementVNode("span", _hoisted_127, _toDisplayString(s.ms) + " ms · " + _toDisplayString(s.status), 1 /* TEXT */)
                              ]),
                              (s.answers.length)
                                ? (_openBlock(), _createElementBlock("div", _hoisted_128, "→ " + _toDisplayString(s.answers.map(a => a.type + ' ' + a.value).join(', ')), 1 /* TEXT */))
                                : (_openBlock(), _createElementBlock("div", _hoisted_129, _toDisplayString(_ctx.t('delegates to')) + " " + _toDisplayString(s.authority.filter(a => a.type === 'NS').map(a => a.value).join(', ') || '—'), 1 /* TEXT */))
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.dnsView==='axfr')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 4 }, [
                    _createElementVNode("div", _hoisted_130, [
                      _createElementVNode("div", _hoisted_131, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[44] || (_cache[44] = $event => ((_ctx.axfrZone) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[45] || (_cache[45] = _withKeys((...args) => (_ctx.runAxfr && _ctx.runAxfr(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_132), [
                          [_vModelText, _ctx.axfrZone]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[46] || (_cache[46] = $event => ((_ctx.axfrServer) = $event)),
                          class: "short",
                          placeholder: _ctx.t('Name server (blank = all of them)')
                        }, null, 8 /* PROPS */, _hoisted_133), [
                          [_vModelText, _ctx.axfrServer]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.axfr,
                          onClick: _cache[47] || (_cache[47] = (...args) => (_ctx.runAxfr && _ctx.runAxfr(...args)))
                        }, _toDisplayString(_ctx.t('Test zone transfer')), 9 /* TEXT, PROPS */, _hoisted_134)
                      ]),
                      _createElementVNode("p", _hoisted_135, _toDisplayString(_ctx.t('A name server that hands its whole zone to a stranger gives away every host name it knows. This checks whether yours refuses.')), 1 /* TEXT */)
                    ]),
                    (_ctx.axfrResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_136, [
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
                          _createElementVNode("table", _hoisted_137, [
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
                                  _createElementVNode("td", _hoisted_138, [
                                    _createTextVNode(_toDisplayString(r.server) + " ", 1 /* TEXT */),
                                    _createElementVNode("span", _hoisted_139, _toDisplayString(r.address), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", r.allowed ? 'bad' : 'ok'])
                                    }, _toDisplayString(r.allowed ? _ctx.t('transfer allowed') : _ctx.t('refused')), 3 /* TEXT, CLASS */),
                                    _createTextVNode(),
                                    _createElementVNode("span", _hoisted_140, _toDisplayString(r.error || ''), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("td", _hoisted_141, _toDisplayString(r.records || ''), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.axfrResult.results, (r, i) => {
                            return (_openBlock(), _createElementBlock(_Fragment, {
                              key: 's'+i
                            }, [
                              (r.sample && r.sample.length)
                                ? (_openBlock(), _createElementBlock("details", _hoisted_142, [
                                    _createElementVNode("summary", null, _toDisplayString(r.server), 1 /* TEXT */),
                                    _createElementVNode("pre", _hoisted_143, _toDisplayString(r.sample.join('\n')), 1 /* TEXT */)
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_144, [
              _createElementVNode("div", _hoisted_145, [
                _createElementVNode("div", _hoisted_146, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[48] || (_cache[48] = $event => ((_ctx.whoisQuery) = $event)),
                    placeholder: _ctx.t('Domain name or IP address'),
                    onKeyup: _cache[49] || (_cache[49] = _withKeys((...args) => (_ctx.runWhois && _ctx.runWhois(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_147), [
                    [_vModelText, _ctx.whoisQuery]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.whois,
                    onClick: _cache[50] || (_cache[50] = (...args) => (_ctx.runWhois && _ctx.runWhois(...args)))
                  }, _toDisplayString(_ctx.t('Look up')), 9 /* TEXT, PROPS */, _hoisted_148)
                ])
              ]),
              (_ctx.whoisResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_149, [
                    (Object.keys(_ctx.whoisResult.fields).length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_150, [
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
                        _createElementVNode("pre", _hoisted_152, _toDisplayString(hop.response), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_151))
                    }), 128 /* KEYED_FRAGMENT */))
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ ping / traceroute ============ "),
        (_ctx.tab==='ping')
          ? (_openBlock(), _createElementBlock("section", _hoisted_153, [
              _createElementVNode("div", _hoisted_154, [
                _createElementVNode("div", _hoisted_155, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[51] || (_cache[51] = $event => ((_ctx.pingHost) = $event)),
                    placeholder: _ctx.t('Host name or IP address'),
                    onKeyup: _cache[52] || (_cache[52] = _withKeys((...args) => (_ctx.runPing && _ctx.runPing(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_156), [
                    [_vModelText, _ctx.pingHost]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.ping,
                    onClick: _cache[53] || (_cache[53] = (...args) => (_ctx.runPing && _ctx.runPing(...args)))
                  }, _toDisplayString(_ctx.t('Ping')), 9 /* TEXT, PROPS */, _hoisted_157),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.trace,
                    onClick: _cache[54] || (_cache[54] = (...args) => (_ctx.runTrace && _ctx.runTrace(...args)))
                  }, _toDisplayString(_ctx.t('Traceroute')), 9 /* TEXT, PROPS */, _hoisted_158),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.path,
                    onClick: _cache[55] || (_cache[55] = (...args) => (_ctx.runPath && _ctx.runPath(...args)))
                  }, _toDisplayString(_ctx.t('Path quality')), 9 /* TEXT, PROPS */, _hoisted_159)
                ]),
                _createElementVNode("div", _hoisted_160, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[56] || (_cache[56] = $event => ((_ctx.tcpPingPort) = $event)),
                    type: "number",
                    class: "tiny",
                    min: "1",
                    max: "65535"
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.tcpPingPort,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.tcpping,
                    onClick: _cache[57] || (_cache[57] = (...args) => (_ctx.runTcpPing && _ctx.runTcpPing(...args)))
                  }, _toDisplayString(_ctx.t('TCP ping (works without ICMP)')), 9 /* TEXT, PROPS */, _hoisted_161),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.mtu,
                    onClick: _cache[58] || (_cache[58] = (...args) => (_ctx.runMtu && _ctx.runMtu(...args)))
                  }, _toDisplayString(_ctx.t('Find the path MTU')), 9 /* TEXT, PROPS */, _hoisted_162)
                ])
              ]),
              (_ctx.tcpPingResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_163, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('TCP ping')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_164, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Target')), 1 /* TEXT */),
                        _createElementVNode("code", null, [
                          _createTextVNode(_toDisplayString(_ctx.tcpPingResult.host) + ":" + _toDisplayString(_ctx.tcpPingResult.port) + " ", 1 /* TEXT */),
                          _createElementVNode("span", _hoisted_165, _toDisplayString(_ctx.tcpPingResult.service), 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Answered')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.tcpPingResult.received) + " / " + _toDisplayString(_ctx.tcpPingResult.sent) + " (" + _toDisplayString(_ctx.tcpPingResult.loss) + "% " + _toDisplayString(_ctx.t('lost')) + ")", 1 /* TEXT */)
                      ]),
                      (_ctx.tcpPingResult.stats.avg)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_166, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Round trip')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.t('min')) + " " + _toDisplayString(_ctx.tcpPingResult.stats.min) + " · " + _toDisplayString(_ctx.t('avg')) + " " + _toDisplayString(_ctx.tcpPingResult.stats.avg) + " · " + _toDisplayString(_ctx.t('max')) + " " + _toDisplayString(_ctx.tcpPingResult.stats.max) + " ms", 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.mtuResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_167, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Path MTU')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.mtuResult.findings || []), (f, i) => {
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
                    (_ctx.mtuResult.mtu)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_168, [
                          _createElementVNode("div", null, [
                            _hoisted_169,
                            _createElementVNode("code", null, _toDisplayString(_ctx.mtuResult.mtu) + " " + _toDisplayString(_ctx.t('bytes')), 1 /* TEXT */)
                          ]),
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Largest payload')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.mtuResult.payload) + " " + _toDisplayString(_ctx.t('bytes')), 1 /* TEXT */)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.pingResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_170, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.pingResult.findings || []), (f, i) => {
                      return (_openBlock(), _createElementBlock("div", {
                        key: i,
                        class: _normalizeClass(["finding", f.level])
                      }, [
                        _createElementVNode("span", _hoisted_171, _toDisplayString(f.area), 1 /* TEXT */),
                        _createElementVNode("span", null, _toDisplayString(f.text), 1 /* TEXT */)
                      ], 2 /* CLASS */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    (_ctx.pingResult.stats && _ctx.pingResult.stats.sent)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_172, [
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Sent')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.pingResult.stats.sent), 1 /* TEXT */)
                          ]),
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Received')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.pingResult.stats.received), 1 /* TEXT */)
                          ]),
                          _createElementVNode("div", null, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Loss')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.pingResult.stats.loss) + "%", 1 /* TEXT */)
                          ]),
                          (_ctx.pingResult.stats.avg)
                            ? (_openBlock(), _createElementBlock("div", _hoisted_173, [
                                _createElementVNode("span", null, _toDisplayString(_ctx.t('Average')), 1 /* TEXT */),
                                _createElementVNode("code", null, _toDisplayString(_ctx.pingResult.stats.avg) + " ms", 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("pre", _hoisted_174, _toDisplayString(_ctx.pingResult.output), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.traceResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_175, [
                    (!_ctx.traceResult.available)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_176, _toDisplayString(_ctx.t('traceroute is not installed on this server.')), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("pre", _hoisted_177, _toDisplayString(_ctx.traceResult.output), 1 /* TEXT */))
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.pathResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_178, [
                    (!_ctx.pathResult.available)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_179, [
                          _createElementVNode("p", null, _toDisplayString(_ctx.t('Per-hop loss and latency needs mtr.')), 1 /* TEXT */),
                          _createElementVNode("pre", _hoisted_180, _toDisplayString(_ctx.installFor('mtr')), 1 /* TEXT */)
                        ]))
                      : (_openBlock(), _createElementBlock("table", _hoisted_181, [
                          _createElementVNode("thead", null, [
                            _createElementVNode("tr", null, [
                              _hoisted_182,
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Loss')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Average')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Best')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Worst')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Jitter')), 1 /* TEXT */)
                            ])
                          ]),
                          _createElementVNode("tbody", null, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.pathResult.hops, (h) => {
                              return (_openBlock(), _createElementBlock("tr", {
                                key: h.hop
                              }, [
                                _createElementVNode("td", _hoisted_183, _toDisplayString(h.hop), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_184, _toDisplayString(h.host), 1 /* TEXT */),
                                _createElementVNode("td", null, [
                                  _createElementVNode("span", {
                                    class: _normalizeClass(["pill", h.loss > 0 ? 'no' : 'ok'])
                                  }, _toDisplayString(h.loss) + "%", 3 /* TEXT, CLASS */)
                                ]),
                                _createElementVNode("td", _hoisted_185, _toDisplayString(h.avg) + " ms", 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_186, _toDisplayString(h.best), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_187, _toDisplayString(h.worst), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_188, _toDisplayString(h.jitter), 1 /* TEXT */)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]))
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ ports ============ "),
        (_ctx.tab==='ports')
          ? (_openBlock(), _createElementBlock("section", _hoisted_189, [
              _createElementVNode("div", _hoisted_190, [
                _createElementVNode("div", _hoisted_191, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[59] || (_cache[59] = $event => ((_ctx.portHost) = $event)),
                    placeholder: _ctx.t('Host name or IP address'),
                    onKeyup: _cache[60] || (_cache[60] = _withKeys((...args) => (_ctx.runPorts && _ctx.runPorts(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_192), [
                    [_vModelText, _ctx.portHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[61] || (_cache[61] = $event => ((_ctx.portList) = $event)),
                    class: "narrow",
                    placeholder: _ctx.t('22,80,443,8000-8100 (blank = common ports)')
                  }, null, 8 /* PROPS */, _hoisted_193), [
                    [_vModelText, _ctx.portList]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.ports,
                    onClick: _cache[62] || (_cache[62] = (...args) => (_ctx.runPorts && _ctx.runPorts(...args)))
                  }, _toDisplayString(_ctx.t('Check')), 9 /* TEXT, PROPS */, _hoisted_194)
                ]),
                _createElementVNode("div", _hoisted_195, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.portPresets, (p) => {
                    return (_openBlock(), _createElementBlock("button", {
                      class: "btn xs",
                      key: p.label,
                      onClick: $event => {_ctx.portList = p.ports; _ctx.runPorts()}
                    }, _toDisplayString(_ctx.t(p.label)), 9 /* TEXT, PROPS */, _hoisted_196))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.portResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_197, [
                    _createElementVNode("table", _hoisted_198, [
                      _createElementVNode("thead", null, [
                        _createElementVNode("tr", null, [
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('State')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Service')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Response')), 1 /* TEXT */),
                          _createElementVNode("th", null, _toDisplayString(_ctx.t('Banner')), 1 /* TEXT */)
                        ])
                      ]),
                      _createElementVNode("tbody", null, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.portResult.results, (r) => {
                          return (_openBlock(), _createElementBlock("tr", {
                            key: r.port
                          }, [
                            _createElementVNode("td", _hoisted_199, _toDisplayString(r.port), 1 /* TEXT */),
                            _createElementVNode("td", null, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", r.open ? 'ok' : 'no'])
                              }, _toDisplayString(r.open ? _ctx.t('open') : _ctx.t('closed')), 3 /* TEXT, CLASS */)
                            ]),
                            _createElementVNode("td", null, _toDisplayString(r.service), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_200, _toDisplayString(r.ms) + " ms", 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_201, _toDisplayString(r.banner), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ tls / http ============ "),
        (_ctx.tab==='tls')
          ? (_openBlock(), _createElementBlock("section", _hoisted_202, [
              _createElementVNode("div", _hoisted_203, [
                _createElementVNode("div", _hoisted_204, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[63] || (_cache[63] = $event => ((_ctx.tlsHost) = $event)),
                    placeholder: _ctx.t('example.com'),
                    onKeyup: _cache[64] || (_cache[64] = _withKeys((...args) => (_ctx.runTls && _ctx.runTls(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_205), [
                    [_vModelText, _ctx.tlsHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[65] || (_cache[65] = $event => ((_ctx.tlsPort) = $event)),
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
                    onClick: _cache[66] || (_cache[66] = (...args) => (_ctx.runTls && _ctx.runTls(...args)))
                  }, _toDisplayString(_ctx.t('Inspect certificate')), 9 /* TEXT, PROPS */, _hoisted_206),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.http,
                    onClick: _cache[67] || (_cache[67] = (...args) => (_ctx.runHttp && _ctx.runHttp(...args)))
                  }, _toDisplayString(_ctx.t('HTTP headers')), 9 /* TEXT, PROPS */, _hoisted_207),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.tlsver,
                    onClick: _cache[68] || (_cache[68] = (...args) => (_ctx.runTlsVersions && _ctx.runTlsVersions(...args)))
                  }, _toDisplayString(_ctx.t('Which TLS versions?')), 9 /* TEXT, PROPS */, _hoisted_208)
                ])
              ]),
              (_ctx.tlsVersionsResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_209, [
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
                    _createElementVNode("table", _hoisted_210, [
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
                            _createElementVNode("td", _hoisted_211, _toDisplayString(name), 1 /* TEXT */),
                            _createElementVNode("td", null, [
                              _createElementVNode("span", {
                                class: _normalizeClass(["pill", v.supported ? (name === 'TLSv1.0' || name === 'TLSv1.1' ? 'warn' : 'ok') : 'no'])
                              }, _toDisplayString(v.supported ? _ctx.t('yes') : _ctx.t('no')), 3 /* TEXT, CLASS */)
                            ]),
                            _createElementVNode("td", _hoisted_212, _toDisplayString(v.cipher || ''), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.tlsResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_213, [
                    (!_ctx.tlsResult.ok)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_214, "⚠ " + _toDisplayString(_ctx.tlsResult.error), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_215, [
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
                            ? (_openBlock(), _createElementBlock("div", _hoisted_216, [
                                _createElementVNode("span", null, _toDisplayString(_ctx.t('Names')), 1 /* TEXT */),
                                _createElementVNode("code", _hoisted_217, _toDisplayString(_ctx.tlsResult.sans.join(', ')), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.httpResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_218, [
                    _createElementVNode("table", _hoisted_219, [
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
                            _createElementVNode("td", _hoisted_220, _toDisplayString(h.url), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_221, _toDisplayString(h.status), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_222, _toDisplayString(h.ms) + " ms", 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_223, _toDisplayString(h.server), 1 /* TEXT */)
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
                    _createElementVNode("div", _hoisted_224, [
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_225, [
              _createElementVNode("div", _hoisted_226, [
                _createElementVNode("div", _hoisted_227, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Live throughput')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[69] || (_cache[69] = $event => ((_ctx.liveIface) = $event)),
                    class: "narrow"
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.liveIfaces, (i) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: i,
                        value: i
                      }, _toDisplayString(i), 9 /* TEXT, PROPS */, _hoisted_228))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.liveIface]
                  ]),
                  _hoisted_229,
                  _createElementVNode("button", {
                    class: _normalizeClass(["btn sm", {active: _ctx.liveOn}]),
                    onClick: _cache[70] || (_cache[70] = (...args) => (_ctx.toggleLive && _ctx.toggleLive(...args)))
                  }, _toDisplayString(_ctx.liveOn ? _ctx.t('Stop') : _ctx.t('Start')), 3 /* TEXT, CLASS */)
                ]),
                (_ctx.liveIface)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_230, [
                      _createElementVNode("div", _hoisted_231, [
                        _createElementVNode("span", _hoisted_232, "↓ " + _toDisplayString(_ctx.t('Receive')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_233, _toDisplayString(_ctx.fmtRate(_ctx.liveNow.rx)), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", _hoisted_234, [
                        _createElementVNode("span", _hoisted_235, "↑ " + _toDisplayString(_ctx.t('Send')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_236, _toDisplayString(_ctx.fmtRate(_ctx.liveNow.tx)), 1 /* TEXT */)
                      ]),
                      (_openBlock(), _createElementBlock("svg", _hoisted_237, [
                        _createElementVNode("polyline", {
                          class: "sp-rx",
                          points: _ctx.spark(_ctx.liveRx)
                        }, null, 8 /* PROPS */, _hoisted_238),
                        _createElementVNode("polyline", {
                          class: "sp-tx",
                          points: _ctx.spark(_ctx.liveTx)
                        }, null, 8 /* PROPS */, _hoisted_239)
                      ]))
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("p", _hoisted_240, [
                  _createTextVNode(_toDisplayString(_ctx.t('Read straight from the kernel counters, so it costs nothing and needs no extra software.')) + " ", 1 /* TEXT */),
                  (_ctx.liveErrors)
                    ? (_openBlock(), _createElementBlock("span", _hoisted_241, " ⚠ " + _toDisplayString(_ctx.t('{n} interface errors / drops recorded since boot', {n: _ctx.liveErrors})), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true)
                ])
              ]),
              _createElementVNode("div", _hoisted_242, [
                _createElementVNode("div", _hoisted_243, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Internet speed test')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[71] || (_cache[71] = $event => ((_ctx.speedSize) = $event)),
                    class: "narrow"
                  }, _hoisted_248, 512 /* NEED_PATCH */), [
                    [
                      _vModelSelect,
                      _ctx.speedSize,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("label", _hoisted_249, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[72] || (_cache[72] = $event => ((_ctx.speedUpload) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.speedUpload]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Also test upload')), 1 /* TEXT */)
                  ]),
                  _hoisted_250,
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.speed,
                    onClick: _cache[73] || (_cache[73] = (...args) => (_ctx.runSpeed && _ctx.runSpeed(...args)))
                  }, _toDisplayString(_ctx.busy.speed ? _ctx.t('Measuring…') : _ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_251)
                ]),
                _createElementVNode("p", _hoisted_252, _toDisplayString(_ctx.t('Traffic is exchanged with {host}. Nothing but the test payload is sent.', {host: _ctx.speedEndpoint})), 1 /* TEXT */),
                (_ctx.speedResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_253, [
                      _createElementVNode("div", _hoisted_254, [
                        _createElementVNode("span", _hoisted_255, "↓ " + _toDisplayString(_ctx.t('Download')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_256, _toDisplayString(_ctx.speedResult.download ? _ctx.speedResult.download.mbps : '—'), 1 /* TEXT */),
                        _hoisted_257
                      ]),
                      _createElementVNode("div", _hoisted_258, [
                        _createElementVNode("span", _hoisted_259, "↑ " + _toDisplayString(_ctx.t('Upload')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_260, _toDisplayString(_ctx.speedResult.upload ? _ctx.speedResult.upload.mbps : '—'), 1 /* TEXT */),
                        _hoisted_261
                      ]),
                      _createElementVNode("div", _hoisted_262, [
                        _createElementVNode("span", _hoisted_263, _toDisplayString(_ctx.t('Latency')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_264, _toDisplayString(_ctx.speedResult.latency ? _ctx.speedResult.latency.avg : '—'), 1 /* TEXT */),
                        _hoisted_265
                      ]),
                      _createElementVNode("div", _hoisted_266, [
                        _createElementVNode("span", _hoisted_267, _toDisplayString(_ctx.t('Jitter')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_268, _toDisplayString(_ctx.speedResult.latency && _ctx.speedResult.latency.jitter != null ? _ctx.speedResult.latency.jitter : '—'), 1 /* TEXT */),
                        _hoisted_269
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.speedResult && (_ctx.speedResult.downloadError || _ctx.speedResult.uploadError))
                  ? (_openBlock(), _createElementBlock("p", _hoisted_270, "⚠ " + _toDisplayString(_ctx.speedResult.downloadError || _ctx.speedResult.uploadError), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_271, [
                _createElementVNode("div", _hoisted_272, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('LAN throughput (iperf3)')), 1 /* TEXT */)
                ]),
                (_ctx.hasTool('iperf3'))
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("div", _hoisted_273, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[74] || (_cache[74] = $event => ((_ctx.iperfHost) = $event)),
                          placeholder: _ctx.t('Address of a machine running: iperf3 -s'),
                          onKeyup: _cache[75] || (_cache[75] = _withKeys((...args) => (_ctx.runIperf && _ctx.runIperf(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_274), [
                          [_vModelText, _ctx.iperfHost]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[76] || (_cache[76] = $event => ((_ctx.iperfPort) = $event)),
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
                          "onUpdate:modelValue": _cache[77] || (_cache[77] = $event => ((_ctx.iperfSeconds) = $event)),
                          class: "tiny"
                        }, _hoisted_278, 512 /* NEED_PATCH */), [
                          [
                            _vModelSelect,
                            _ctx.iperfSeconds,
                            void 0,
                            { number: true }
                          ]
                        ]),
                        _createElementVNode("label", _hoisted_279, [
                          _withDirectives(_createElementVNode("input", {
                            type: "checkbox",
                            "onUpdate:modelValue": _cache[78] || (_cache[78] = $event => ((_ctx.iperfReverse) = $event))
                          }, null, 512 /* NEED_PATCH */), [
                            [_vModelCheckbox, _ctx.iperfReverse]
                          ]),
                          _createTextVNode(" " + _toDisplayString(_ctx.t('Reverse')), 1 /* TEXT */)
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.iperf,
                          onClick: _cache[79] || (_cache[79] = (...args) => (_ctx.runIperf && _ctx.runIperf(...args)))
                        }, _toDisplayString(_ctx.busy.iperf ? _ctx.t('Measuring…') : _ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_280)
                      ]),
                      (_ctx.iperfResult && !_ctx.iperfResult.error)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_281, [
                            _createElementVNode("div", _hoisted_282, [
                              _createElementVNode("span", _hoisted_283, _toDisplayString(_ctx.t('Sent')), 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_284, _toDisplayString(_ctx.iperfResult.sentMbps), 1 /* TEXT */),
                              _hoisted_285
                            ]),
                            _createElementVNode("div", _hoisted_286, [
                              _createElementVNode("span", _hoisted_287, _toDisplayString(_ctx.t('Received')), 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_288, _toDisplayString(_ctx.iperfResult.receivedMbps), 1 /* TEXT */),
                              _hoisted_289
                            ]),
                            (_ctx.iperfResult.retransmits != null)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_290, [
                                  _createElementVNode("span", _hoisted_291, _toDisplayString(_ctx.t('Retransmits')), 1 /* TEXT */),
                                  _createElementVNode("span", _hoisted_292, _toDisplayString(_ctx.iperfResult.retransmits), 1 /* TEXT */),
                                  _hoisted_293
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.iperfResult && _ctx.iperfResult.intervals && _ctx.iperfResult.intervals.length)
                        ? (_openBlock(), _createElementBlock("svg", _hoisted_294, [
                            _createElementVNode("polyline", {
                              class: "sp-rx",
                              points: _ctx.spark(_ctx.iperfResult.intervals.map(i => i.mbps))
                            }, null, 8 /* PROPS */, _hoisted_295)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.iperfResult && _ctx.iperfResult.error)
                        ? (_openBlock(), _createElementBlock("p", _hoisted_296, "⚠ " + _toDisplayString(_ctx.iperfResult.error), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_openBlock(), _createElementBlock("div", _hoisted_297, [
                      _createElementVNode("p", null, _toDisplayString(_ctx.t('An internet speed test measures the internet. To measure the local link you need iperf3 on this server and on one other machine.')), 1 /* TEXT */),
                      _createElementVNode("pre", _hoisted_298, _toDisplayString(_ctx.installFor('iperf3')), 1 /* TEXT */)
                    ]))
              ]),
              _createElementVNode("div", _hoisted_299, [
                _createElementVNode("div", _hoisted_300, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('DNS resolver comparison')), 1 /* TEXT */),
                  _hoisted_301,
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.dnsbench,
                    onClick: _cache[80] || (_cache[80] = (...args) => (_ctx.runDnsBench && _ctx.runDnsBench(...args)))
                  }, _toDisplayString(_ctx.busy.dnsbench ? _ctx.t('Measuring…') : _ctx.t('Compare')), 9 /* TEXT, PROPS */, _hoisted_302)
                ]),
                _createElementVNode("p", _hoisted_303, _toDisplayString(_ctx.t('Each resolver is asked for the same names, and the times are compared. The resolver this server uses is included.')), 1 /* TEXT */),
                (_ctx.dnsBench)
                  ? (_openBlock(), _createElementBlock("table", _hoisted_304, [
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
                            _createElementVNode("td", _hoisted_305, [
                              _createTextVNode(_toDisplayString(r.resolver) + " ", 1 /* TEXT */),
                              _createElementVNode("span", _hoisted_306, _toDisplayString(_ctx.t(r.name)), 1 /* TEXT */),
                              _createTextVNode(),
                              (r.resolver===_ctx.dnsBench.fastest)
                                ? (_openBlock(), _createElementBlock("span", _hoisted_307, _toDisplayString(_ctx.t('fastest')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]),
                            _createElementVNode("td", _hoisted_308, _toDisplayString(r.median != null ? r.median + ' ms' : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_309, _toDisplayString(r.avg != null ? r.avg + ' ms' : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_310, _toDisplayString(r.jitter != null ? r.jitter : '—'), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_311, _toDisplayString(r.answered) + " / " + _toDisplayString(r.queries), 1 /* TEXT */)
                          ], 2 /* CLASS */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_312, [
                _createElementVNode("div", _hoisted_313, [
                  _createElementVNode("h3", null, _toDisplayString(_ctx.t('Where the time goes')), 1 /* TEXT */)
                ]),
                _createElementVNode("div", _hoisted_314, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[81] || (_cache[81] = $event => ((_ctx.timingUrl) = $event)),
                    placeholder: "https://example.com",
                    onKeyup: _cache[82] || (_cache[82] = _withKeys((...args) => (_ctx.runTiming && _ctx.runTiming(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.timingUrl]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.timing,
                    onClick: _cache[83] || (_cache[83] = (...args) => (_ctx.runTiming && _ctx.runTiming(...args)))
                  }, _toDisplayString(_ctx.t('Measure')), 9 /* TEXT, PROPS */, _hoisted_315)
                ]),
                (_ctx.timingResult)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("div", _hoisted_316, [
                        _createElementVNode("div", null, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t('Status')), 1 /* TEXT */),
                          _createElementVNode("code", null, [
                            _createTextVNode(_toDisplayString(_ctx.timingResult.status), 1 /* TEXT */),
                            (_ctx.timingResult.location)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_317, " → " + _toDisplayString(_ctx.timingResult.location), 1 /* TEXT */))
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
                      _createElementVNode("div", _hoisted_318, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.timingResult.phases, (p) => {
                          return (_openBlock(), _createElementBlock("div", {
                            key: p.name,
                            class: "wf-row"
                          }, [
                            _createElementVNode("span", _hoisted_319, _toDisplayString(_ctx.t(p.name)), 1 /* TEXT */),
                            _createElementVNode("span", _hoisted_320, [
                              _createElementVNode("span", {
                                style: _normalizeStyle({width: _ctx.barWidth(p.ms, _ctx.timingResult.total)})
                              }, null, 4 /* STYLE */)
                            ]),
                            _createElementVNode("span", _hoisted_321, _toDisplayString(p.ms) + " ms", 1 /* TEXT */)
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_322, [
              _createElementVNode("div", _hoisted_323, [
                _createElementVNode("div", _hoisted_324, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[84] || (_cache[84] = $event => ((_ctx.subnetInput) = $event)),
                    placeholder: "192.168.1.10/24",
                    onKeyup: _cache[85] || (_cache[85] = _withKeys((...args) => (_ctx.runSubnet && _ctx.runSubnet(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.subnetInput]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    onClick: _cache[86] || (_cache[86] = (...args) => (_ctx.runSubnet && _ctx.runSubnet(...args)))
                  }, _toDisplayString(_ctx.t('Calculate')), 1 /* TEXT */)
                ])
              ]),
              (_ctx.subnetResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_325, [
                    _createElementVNode("div", _hoisted_326, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.subnetResult, (v, k) => {
                        return (_openBlock(), _createElementBlock("div", { key: k }, [
                          _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.fieldLabel(k))), 1 /* TEXT */),
                          _createElementVNode("code", null, _toDisplayString(v), 1 /* TEXT */)
                        ]))
                      }), 128 /* KEYED_FRAGMENT */))
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_327, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Split into smaller networks')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_328, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[87] || (_cache[87] = $event => ((_ctx.splitCidr) = $event)),
                    class: "short",
                    placeholder: "192.168.0.0/16"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.splitCidr]
                  ]),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[88] || (_cache[88] = $event => ((_ctx.splitPrefix) = $event)),
                    class: "tiny"
                  }, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.splitPrefixes, (p) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: p,
                        value: p
                      }, "/" + _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_329))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 512 /* NEED_PATCH */), [
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
                    onClick: _cache[89] || (_cache[89] = (...args) => (_ctx.runSplit && _ctx.runSplit(...args)))
                  }, _toDisplayString(_ctx.t('Split')), 9 /* TEXT, PROPS */, _hoisted_330)
                ]),
                (_ctx.splitResult)
                  ? (_openBlock(), _createElementBlock("table", _hoisted_331, [
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
                            _createElementVNode("td", _hoisted_332, _toDisplayString(n.cidr), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_333, _toDisplayString(n.firstHost), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_334, _toDisplayString(n.lastHost), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_335, _toDisplayString(n.broadcast), 1 /* TEXT */),
                            _createElementVNode("td", _hoisted_336, _toDisplayString(n.hosts), 1 /* TEXT */)
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_337, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Combine addresses into the fewest networks')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  "onUpdate:modelValue": _cache[90] || (_cache[90] = $event => ((_ctx.aggregateInput) = $event)),
                  rows: "3",
                  class: "mono tiny",
                  placeholder: _ctx.t('192.168.1.0/24, 192.168.2.0/24, 10.0.0.5, 10.0.0.8-10.0.0.20')
                }, null, 8 /* PROPS */, _hoisted_338), [
                  [_vModelText, _ctx.aggregateInput]
                ]),
                _createElementVNode("div", _hoisted_339, [
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.aggregate,
                    onClick: _cache[91] || (_cache[91] = (...args) => (_ctx.runAggregate && _ctx.runAggregate(...args)))
                  }, _toDisplayString(_ctx.t('Combine')), 9 /* TEXT, PROPS */, _hoisted_340)
                ]),
                (_ctx.aggregateResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_341, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Blocks')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_342, _toDisplayString(_ctx.aggregateResult.blocks.join(', ')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Ranges')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_343, _toDisplayString(_ctx.aggregateResult.ranges.join(', ')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Addresses covered')), 1 /* TEXT */),
                        _createElementVNode("code", null, _toDisplayString(_ctx.aggregateResult.addresses), 1 /* TEXT */)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_344, [
                _createElementVNode("div", _hoisted_345, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[92] || (_cache[92] = $event => ((_ctx.macQuery) = $event)),
                    placeholder: _ctx.t('MAC address, e.g. 00:1b:a9:3f:8d:fe'),
                    onKeyup: _cache[93] || (_cache[93] = _withKeys((...args) => (_ctx.runMac && _ctx.runMac(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_346), [
                    [_vModelText, _ctx.macQuery]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    onClick: _cache[94] || (_cache[94] = (...args) => (_ctx.runMac && _ctx.runMac(...args)))
                  }, _toDisplayString(_ctx.t('Identify vendor')), 1 /* TEXT */)
                ]),
                (_ctx.macResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_347, [
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
        _createCommentVNode(" ============ nmap ============ "),
        (_ctx.tab==='nmap')
          ? (_openBlock(), _createElementBlock("section", _hoisted_348, [
              (!_ctx.status.nmap || !_ctx.status.nmap.available)
                ? (_openBlock(), _createElementBlock("div", _hoisted_349, [
                    _createElementVNode("p", _hoisted_350, _toDisplayString(_ctx.t('nmap is not installed on this server. An administrator can install it, then reload this page.')), 1 /* TEXT */),
                    _hoisted_351
                  ]))
                : (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                    _createElementVNode("div", _hoisted_352, [
                      _createElementVNode("div", _hoisted_353, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[95] || (_cache[95] = $event => ((_ctx.nmapTargets) = $event)),
                          placeholder: _ctx.t('Host, address or 192.168.1.0/24'),
                          onKeyup: _cache[96] || (_cache[96] = _withKeys((...args) => (_ctx.runNmap && _ctx.runNmap(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_354), [
                          [_vModelText, _ctx.nmapTargets]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[97] || (_cache[97] = $event => ((_ctx.nmapPreset) = $event))
                        }, [
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.status.nmap.presets, (p, k) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: k,
                              value: k
                            }, _toDisplayString(_ctx.t(p.label)), 9 /* TEXT, PROPS */, _hoisted_355))
                          }), 128 /* KEYED_FRAGMENT */))
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.nmapPreset]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.nmap,
                          onClick: _cache[98] || (_cache[98] = (...args) => (_ctx.runNmap && _ctx.runNmap(...args)))
                        }, _toDisplayString(_ctx.busy.nmap ? _ctx.t('Scanning…') : _ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_356)
                      ]),
                      _createElementVNode("div", _hoisted_357, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[99] || (_cache[99] = $event => ((_ctx.nmapExtra) = $event)),
                          placeholder: _ctx.t('Extra options (allow-listed), e.g. -Pn --top-ports 200')
                        }, null, 8 /* PROPS */, _hoisted_358), [
                          [_vModelText, _ctx.nmapExtra]
                        ])
                      ]),
                      _createElementVNode("p", _hoisted_359, [
                        _createTextVNode(_toDisplayString(_ctx.t('nmap {version} · running as {user}', { version: _ctx.status.nmap.version, user: _ctx.status.nmap.user })) + " ", 1 /* TEXT */),
                        (!_ctx.status.nmap.privileged)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_360, "— " + _toDisplayString(_ctx.t('no raw-socket privileges, so SYN/OS/UDP presets are unavailable')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ])
                    ]),
                    (_ctx.nmapResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_361, [
                          (_ctx.nmapResult.error)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_362, "⚠ " + _toDisplayString(_ctx.nmapResult.error), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          _createElementVNode("div", _hoisted_363, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Command')), 1 /* TEXT */),
                              _createElementVNode("code", _hoisted_364, _toDisplayString(_ctx.nmapResult.command), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Duration')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.nmapResult.seconds) + " s", 1 /* TEXT */)
                            ])
                          ]),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.nmapResult.hosts, (h, i) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: i,
                              class: "nmap-host"
                            }, [
                              _createElementVNode("div", _hoisted_365, [
                                _createElementVNode("strong", _hoisted_366, _toDisplayString(h.addresses.join(', ')), 1 /* TEXT */),
                                (h.hostnames.length)
                                  ? (_openBlock(), _createElementBlock("span", _hoisted_367, _toDisplayString(h.hostnames.join(', ')), 1 /* TEXT */))
                                  : _createCommentVNode("v-if", true),
                                (h.vendor)
                                  ? (_openBlock(), _createElementBlock("span", _hoisted_368, _toDisplayString(h.vendor), 1 /* TEXT */))
                                  : _createCommentVNode("v-if", true),
                                _createElementVNode("span", {
                                  class: _normalizeClass(["pill", h.state==='up' ? 'ok' : 'no'])
                                }, _toDisplayString(h.state), 3 /* TEXT, CLASS */)
                              ]),
                              (h.ports.length)
                                ? (_openBlock(), _createElementBlock("table", _hoisted_369, [
                                    _createElementVNode("thead", null, [
                                      _createElementVNode("tr", null, [
                                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                                        _createElementVNode("th", null, _toDisplayString(_ctx.t('State')), 1 /* TEXT */),
                                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Service')), 1 /* TEXT */),
                                        _createElementVNode("th", null, _toDisplayString(_ctx.t('Product')), 1 /* TEXT */)
                                      ])
                                    ]),
                                    _createElementVNode("tbody", null, [
                                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(h.ports, (p) => {
                                        return (_openBlock(), _createElementBlock("tr", {
                                          key: p.port
                                        }, [
                                          _createElementVNode("td", _hoisted_370, _toDisplayString(p.port) + "/" + _toDisplayString(p.protocol), 1 /* TEXT */),
                                          _createElementVNode("td", null, _toDisplayString(p.state), 1 /* TEXT */),
                                          _createElementVNode("td", null, _toDisplayString(p.service), 1 /* TEXT */),
                                          _createElementVNode("td", _hoisted_371, _toDisplayString(p.product), 1 /* TEXT */)
                                        ]))
                                      }), 128 /* KEYED_FRAGMENT */))
                                    ])
                                  ]))
                                : _createCommentVNode("v-if", true),
                              (h.os.length)
                                ? (_openBlock(), _createElementBlock("div", _hoisted_372, "OS: " + _toDisplayString(h.os.map(o => o.name + ' (' + o.accuracy + '%)').join(', ')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true)
                            ]))
                          }), 128 /* KEYED_FRAGMENT */)),
                          (_ctx.nmapResult.output)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_373, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Raw output')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_374, _toDisplayString(_ctx.nmapResult.output), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ mail ============ "),
        (_ctx.tab==='mail')
          ? (_openBlock(), _createElementBlock("section", _hoisted_375, [
              _createElementVNode("div", _hoisted_376, [
                _createElementVNode("div", _hoisted_377, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailViews, (v) => {
                    return (_openBlock(), _createElementBlock("button", {
                      key: v.id,
                      class: _normalizeClass(["seg-btn", {active: _ctx.mailView===v.id}]),
                      onClick: $event => (_ctx.mailView=v.id)
                    }, _toDisplayString(_ctx.t(v.label)), 11 /* TEXT, CLASS, PROPS */, _hoisted_378))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (_ctx.mailView==='domain')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("div", _hoisted_379, [
                      _createElementVNode("div", _hoisted_380, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[100] || (_cache[100] = $event => ((_ctx.mailDomain) = $event)),
                          placeholder: _ctx.t('example.com'),
                          onKeyup: _cache[101] || (_cache[101] = _withKeys((...args) => (_ctx.runMailAudit && _ctx.runMailAudit(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_381), [
                          [_vModelText, _ctx.mailDomain]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[102] || (_cache[102] = $event => ((_ctx.mailSelectors) = $event)),
                          class: "short",
                          placeholder: _ctx.t('DKIM selectors, comma separated')
                        }, null, 8 /* PROPS */, _hoisted_382), [
                          [_vModelText, _ctx.mailSelectors]
                        ]),
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.mailAudit,
                          onClick: _cache[103] || (_cache[103] = (...args) => (_ctx.runMailAudit && _ctx.runMailAudit(...args)))
                        }, _toDisplayString(_ctx.busy.mailAudit ? _ctx.t('Checking…') : _ctx.t('Check this domain')), 9 /* TEXT, PROPS */, _hoisted_383)
                      ]),
                      _createElementVNode("label", _hoisted_384, [
                        _withDirectives(_createElementVNode("input", {
                          type: "checkbox",
                          "onUpdate:modelValue": _cache[104] || (_cache[104] = $event => ((_ctx.mailBlocklists) = $event))
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelCheckbox, _ctx.mailBlocklists]
                        ]),
                        _createTextVNode(" " + _toDisplayString(_ctx.t('Also ask the public blocklists about each MX address')), 1 /* TEXT */)
                      ]),
                      _createElementVNode("p", _hoisted_385, _toDisplayString(_ctx.t('Reads only public DNS and, for MTA-STS, one HTTPS file. Nothing is sent to your servers.')), 1 /* TEXT */)
                    ]),
                    (_ctx.mailAudit)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_386, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('What this domain looks like to a receiving mail server')), 1 /* TEXT */),
                          _createElementVNode("div", _hoisted_387, [
                            (_ctx.mailAudit.score.bad)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_388, _toDisplayString(_ctx.mailAudit.score.bad) + " " + _toDisplayString(_ctx.t('to fix')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAudit.score.warn)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_389, _toDisplayString(_ctx.mailAudit.score.warn) + " " + _toDisplayString(_ctx.t('to look at')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailAudit.score.ok)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_390, _toDisplayString(_ctx.mailAudit.score.ok) + " " + _toDisplayString(_ctx.t('fine')), 1 /* TEXT */))
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
                      ? (_openBlock(), _createElementBlock("div", _hoisted_391, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Mail exchangers')), 1 /* TEXT */),
                          _createElementVNode("table", _hoisted_392, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Priority')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Address')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Reverse name')), 1 /* TEXT */),
                                _hoisted_393
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
                                      _createElementVNode("td", _hoisted_394, _toDisplayString(j === 0 ? m.priority : ''), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_395, _toDisplayString(j === 0 ? m.host : ''), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_396, _toDisplayString(a.ip || '—'), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_397, [
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
                      ? (_openBlock(), _createElementBlock("div", _hoisted_398, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Published policies')), 1 /* TEXT */),
                          _createElementVNode("div", _hoisted_399, [
                            _createElementVNode("div", null, [
                              _hoisted_400,
                              _createElementVNode("code", _hoisted_401, _toDisplayString(_ctx.mailAudit.spf ? _ctx.mailAudit.spf.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            (_ctx.mailAudit.spf)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_402, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('SPF lookups')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.mailAudit.spf.lookups) + " / 10", 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("div", null, [
                              _hoisted_403,
                              _createElementVNode("code", _hoisted_404, _toDisplayString(_ctx.mailAudit.dmarc ? _ctx.mailAudit.dmarc.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_405,
                              _createElementVNode("code", _hoisted_406, _toDisplayString(_ctx.mailAudit.mtaSts ? _ctx.mailAudit.mtaSts.record : _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_407,
                              _createElementVNode("code", _hoisted_408, _toDisplayString(_ctx.mailAudit.tlsRpt || _ctx.t('not published')), 1 /* TEXT */)
                            ]),
                            _createElementVNode("div", null, [
                              _hoisted_409,
                              _createElementVNode("code", _hoisted_410, _toDisplayString(_ctx.mailAudit.bimi || _ctx.t('not published')), 1 /* TEXT */)
                            ])
                          ]),
                          (_ctx.mailAudit.mtaSts && _ctx.mailAudit.mtaSts.policy)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_411, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('MTA-STS policy file')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_412, _toDisplayString(_ctx.mailAudit.mtaSts.policy), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.dkim.length)
                            ? (_openBlock(), _createElementBlock("h3", _hoisted_413, _toDisplayString(_ctx.t('DKIM keys')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.dkim.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_414, [
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
                                      _createElementVNode("td", _hoisted_415, _toDisplayString(k.selector), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_416, _toDisplayString(k.bits ? k.bits + ' bit' : '—'), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_417, _toDisplayString(k.record), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.srv.length)
                            ? (_openBlock(), _createElementBlock("h3", _hoisted_418, _toDisplayString(_ctx.t('Client autoconfiguration records')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_ctx.mailAudit.srv.length)
                            ? (_openBlock(), _createElementBlock("table", _hoisted_419, [
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
                                      _createElementVNode("td", _hoisted_420, _toDisplayString(s.name), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_421, _toDisplayString(s.target), 1 /* TEXT */),
                                      _createElementVNode("td", _hoisted_422, _toDisplayString(s.port), 1 /* TEXT */)
                                    ]))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ])
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.mailAudit && Object.keys(_ctx.mailAudit.blocklists).length)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_423, [
                          _createElementVNode("h3", null, _toDisplayString(_ctx.t('Blocklists')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailAudit.blocklists, (rows, ip) => {
                            return (_openBlock(), _createElementBlock("div", {
                              key: ip,
                              class: "bl-group"
                            }, [
                              _createElementVNode("strong", _hoisted_424, _toDisplayString(ip), 1 /* TEXT */),
                              _createElementVNode("div", _hoisted_425, [
                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(rows, (r) => {
                                  return (_openBlock(), _createElementBlock("span", {
                                    key: r.zone,
                                    class: _normalizeClass(["pill", r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')]),
                                    title: r.reason || r.zone
                                  }, _toDisplayString(r.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_426))
                                }), 128 /* KEYED_FRAGMENT */))
                              ])
                            ]))
                          }), 128 /* KEYED_FRAGMENT */)),
                          _createElementVNode("p", _hoisted_427, _toDisplayString(_ctx.t('Grey means the list refused the query — that usually means this server asks a public resolver, not that the address is clean.')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.mailView==='server')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                    _createElementVNode("div", _hoisted_428, [
                      _createElementVNode("div", _hoisted_429, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[105] || (_cache[105] = $event => ((_ctx.mailHost) = $event)),
                          placeholder: _ctx.t('mail.example.com'),
                          onKeyup: _cache[106] || (_cache[106] = _withKeys((...args) => (_ctx.runMailProbe && _ctx.runMailProbe(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_430), [
                          [_vModelText, _ctx.mailHost]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[107] || (_cache[107] = $event => ((_ctx.mailProtocol) = $event)),
                          class: "short"
                        }, _hoisted_434, 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.mailProtocol]
                        ]),
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[108] || (_cache[108] = $event => ((_ctx.mailMode) = $event)),
                          class: "short"
                        }, [
                          _createElementVNode("option", _hoisted_435, _toDisplayString(_ctx.t('Pick automatically')), 1 /* TEXT */),
                          _hoisted_436,
                          _createElementVNode("option", _hoisted_437, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */),
                          _createElementVNode("option", _hoisted_438, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                        ], 512 /* NEED_PATCH */), [
                          [_vModelSelect, _ctx.mailMode]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[109] || (_cache[109] = $event => ((_ctx.mailPort) = $event)),
                          type: "number",
                          min: "0",
                          max: "65535",
                          class: "tiny",
                          placeholder: _ctx.t('Port')
                        }, null, 8 /* PROPS */, _hoisted_439), [
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
                          onClick: _cache[110] || (_cache[110] = (...args) => (_ctx.runMailProbe && _ctx.runMailProbe(...args)))
                        }, _toDisplayString(_ctx.t('Test the server')), 9 /* TEXT, PROPS */, _hoisted_440)
                      ]),
                      _createElementVNode("div", _hoisted_441, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailPresets, (p) => {
                          return (_openBlock(), _createElementBlock("button", {
                            class: "btn xs",
                            key: p.label,
                            onClick: $event => (_ctx.applyMailPreset(p))
                          }, _toDisplayString(p.label), 9 /* TEXT, PROPS */, _hoisted_442))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ]),
                    (_ctx.mailProbeResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_443, [
                          (_ctx.mailProbeResult.error)
                            ? (_openBlock(), _createElementBlock("p", _hoisted_444, "⚠ " + _toDisplayString(_ctx.mailProbeResult.error), 1 /* TEXT */))
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
                          _createElementVNode("div", _hoisted_445, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Greeting')), 1 /* TEXT */),
                              _createElementVNode("code", _hoisted_446, _toDisplayString(_ctx.mailProbeResult.greeting), 1 /* TEXT */)
                            ]),
                            (_ctx.mailProbeResult.tls)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_447, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Encryption')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.mailProbeResult.tls.protocol) + " · " + _toDisplayString(_ctx.mailProbeResult.tls.cipher), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailProbeResult.tls && _ctx.mailProbeResult.tls.subject)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_448, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Certificate')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_449, _toDisplayString(_ctx.mailProbeResult.tls.subject) + " · " + _toDisplayString(_ctx.t('issued by')) + " " + _toDisplayString(_ctx.mailProbeResult.tls.issuer) + " · " + _toDisplayString(_ctx.t('{n} days left', {n: _ctx.mailProbeResult.tls.expiresIn})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            ((_ctx.mailProbeResult.auth||[]).length)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_450, [
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
                            _createElementVNode("pre", _hoisted_451, _toDisplayString(_ctx.capabilityText(_ctx.mailProbeResult.capabilities)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("details", null, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_452, _toDisplayString((_ctx.mailProbeResult.transcript||[]).join('\n')), 1 /* TEXT */)
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_453, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Open relay test')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_454, _toDisplayString(_ctx.t('Offers the server a foreign sender and a foreign recipient and stops before anything is sent. Run it against your own server.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_455, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[111] || (_cache[111] = $event => ((_ctx.relayHost) = $event)),
                          placeholder: _ctx.t('mail.example.com')
                        }, null, 8 /* PROPS */, _hoisted_456), [
                          [_vModelText, _ctx.relayHost]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[112] || (_cache[112] = $event => ((_ctx.relayPort) = $event)),
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
                          onClick: _cache[113] || (_cache[113] = (...args) => (_ctx.runRelay && _ctx.runRelay(...args)))
                        }, _toDisplayString(_ctx.t('Test for open relay')), 9 /* TEXT, PROPS */, _hoisted_457)
                      ]),
                      (_ctx.relayResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_458, [
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
                              ? (_openBlock(), _createElementBlock("p", _hoisted_459, "⚠ " + _toDisplayString(_ctx.relayResult.error), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            (_ctx.relayResult.transcript)
                              ? (_openBlock(), _createElementBlock("details", _hoisted_460, [
                                  _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                                  _createElementVNode("pre", _hoisted_461, _toDisplayString(_ctx.relayResult.transcript.join('\n')), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_462, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Blocklist lookup')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_463, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[114] || (_cache[114] = $event => ((_ctx.blIp) = $event)),
                          placeholder: _ctx.t('IPv4 address of a sending server'),
                          onKeyup: _cache[115] || (_cache[115] = _withKeys((...args) => (_ctx.runBlocklist && _ctx.runBlocklist(...args)), ["enter"]))
                        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_464), [
                          [_vModelText, _ctx.blIp]
                        ]),
                        _createElementVNode("button", {
                          class: "btn",
                          disabled: _ctx.busy.bl,
                          onClick: _cache[116] || (_cache[116] = (...args) => (_ctx.runBlocklist && _ctx.runBlocklist(...args)))
                        }, _toDisplayString(_ctx.t('Check')), 9 /* TEXT, PROPS */, _hoisted_465)
                      ]),
                      (_ctx.blResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_466, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.blResult.results, (r) => {
                              return (_openBlock(), _createElementBlock("span", {
                                key: r.zone,
                                class: _normalizeClass(["pill", r.listed ? 'bad' : (r.blocked ? 'no' : 'ok')]),
                                title: r.reason || r.zone
                              }, _toDisplayString(r.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_467))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.mailView==='send')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                    _createElementVNode("div", _hoisted_468, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Send a test message')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_469, _toDisplayString(_ctx.t('Sends a real message through one of your saved SMTP connections — the honest way to prove that sending works.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_470, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[117] || (_cache[117] = $event => ((_ctx.sendId) = $event)),
                          class: "grow"
                        }, [
                          _createElementVNode("option", _hoisted_471, _toDisplayString(_ctx.t('Type the details below')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.smtpConnections, (c) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: c.id,
                              value: c.id
                            }, _toDisplayString(c.name) + " (" + _toDisplayString(c.host) + ")", 9 /* TEXT, PROPS */, _hoisted_472))
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
                              onClick: _cache[118] || (_cache[118] = $event => (_ctx.saveMailAdhoc('smtp')))
                            }, _toDisplayString(_ctx.t('Save to the list')), 1 /* TEXT */))
                          : (_openBlock(), _createElementBlock("button", {
                              key: 1,
                              class: "btn sm",
                              onClick: _cache[119] || (_cache[119] = $event => (_ctx.openConn(_ctx.connById(_ctx.sendId))))
                            }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                      ]),
                      (!_ctx.sendId)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_473, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[120] || (_cache[120] = $event => ((_ctx.smtpAdhoc.host) = $event)),
                              class: "grow",
                              placeholder: "smtp.example.com"
                            }, null, 512 /* NEED_PATCH */), [
                              [_vModelText, _ctx.smtpAdhoc.host]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[121] || (_cache[121] = $event => ((_ctx.smtpAdhoc.port) = $event)),
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
                              "onUpdate:modelValue": _cache[122] || (_cache[122] = $event => ((_ctx.smtpAdhoc.mode) = $event)),
                              class: "tiny"
                            }, [
                              _hoisted_474,
                              _createElementVNode("option", _hoisted_475, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */),
                              _createElementVNode("option", _hoisted_476, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.smtpAdhoc.mode]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[123] || (_cache[123] = $event => ((_ctx.smtpAdhoc.username) = $event)),
                              class: "short",
                              placeholder: _ctx.t('User name'),
                              autocomplete: "off"
                            }, null, 8 /* PROPS */, _hoisted_477), [
                              [_vModelText, _ctx.smtpAdhoc.username]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[124] || (_cache[124] = $event => ((_ctx.smtpAdhoc.secret) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Password'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_478), [
                              [_vModelText, _ctx.smtpAdhoc.secret]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[125] || (_cache[125] = $event => ((_ctx.smtpAdhoc.from) = $event)),
                              class: "short",
                              placeholder: _ctx.t('Sender address')
                            }, null, 8 /* PROPS */, _hoisted_479), [
                              [_vModelText, _ctx.smtpAdhoc.from]
                            ])
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", _hoisted_480, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[126] || (_cache[126] = $event => ((_ctx.sendTo) = $event)),
                          placeholder: _ctx.t('Recipient address')
                        }, null, 8 /* PROPS */, _hoisted_481), [
                          [_vModelText, _ctx.sendTo]
                        ]),
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[127] || (_cache[127] = $event => ((_ctx.sendSubject) = $event)),
                          placeholder: _ctx.t('Subject (optional)')
                        }, null, 8 /* PROPS */, _hoisted_482), [
                          [_vModelText, _ctx.sendSubject]
                        ])
                      ]),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[128] || (_cache[128] = $event => ((_ctx.sendBody) = $event)),
                        rows: "3",
                        placeholder: _ctx.t('Message (optional)')
                      }, null, 8 /* PROPS */, _hoisted_483), [
                        [_vModelText, _ctx.sendBody]
                      ]),
                      _createElementVNode("div", _hoisted_484, [
                        _createElementVNode("button", {
                          class: "btn primary",
                          disabled: _ctx.busy.send || !_ctx.sendTo || (!_ctx.sendId && !_ctx.smtpAdhoc.host),
                          onClick: _cache[129] || (_cache[129] = (...args) => (_ctx.runSend && _ctx.runSend(...args)))
                        }, _toDisplayString(_ctx.busy.send ? _ctx.t('Sending…') : _ctx.t('Send the test message')), 9 /* TEXT, PROPS */, _hoisted_485)
                      ]),
                      (_ctx.sendResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_486, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.sendResult.ok ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.sendResult.ok ? _ctx.t('Accepted by the server') : (_ctx.sendResult.error || _ctx.t('Failed'))), 3 /* TEXT, CLASS */)
                            ]),
                            (_ctx.sendResult.reply)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_487, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Reply')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_488, _toDisplayString(_ctx.sendResult.reply), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.sendResult && _ctx.sendResult.transcript)
                        ? (_openBlock(), _createElementBlock("details", _hoisted_489, [
                            _createElementVNode("summary", null, _toDisplayString(_ctx.t('Conversation')), 1 /* TEXT */),
                            _createElementVNode("pre", _hoisted_490, _toDisplayString(_ctx.sendResult.transcript.join('\n')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_491, [
                      _createElementVNode("h3", null, _toDisplayString(_ctx.t('Mailbox check')), 1 /* TEXT */),
                      _createElementVNode("p", _hoisted_492, _toDisplayString(_ctx.t('Signs in to a saved IMAP or POP3 account and reports what is in the inbox.')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_493, [
                        _withDirectives(_createElementVNode("select", {
                          "onUpdate:modelValue": _cache[130] || (_cache[130] = $event => ((_ctx.mailboxId) = $event)),
                          class: "grow"
                        }, [
                          _createElementVNode("option", _hoisted_494, _toDisplayString(_ctx.t('Type the details below')), 1 /* TEXT */),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.mailboxConnections, (c) => {
                            return (_openBlock(), _createElementBlock("option", {
                              key: c.id,
                              value: c.id
                            }, _toDisplayString(c.name) + " (" + _toDisplayString(c.kind.toUpperCase()) + ")", 9 /* TEXT, PROPS */, _hoisted_495))
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
                          onClick: _cache[131] || (_cache[131] = (...args) => (_ctx.runMailbox && _ctx.runMailbox(...args)))
                        }, _toDisplayString(_ctx.t('Sign in')), 9 /* TEXT, PROPS */, _hoisted_496),
                        (!_ctx.mailboxId)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 0,
                              class: "btn sm",
                              onClick: _cache[132] || (_cache[132] = $event => (_ctx.saveMailAdhoc('box')))
                            }, _toDisplayString(_ctx.t('Save to the list')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      (!_ctx.mailboxId)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_497, [
                            _withDirectives(_createElementVNode("select", {
                              "onUpdate:modelValue": _cache[133] || (_cache[133] = $event => ((_ctx.boxAdhoc.kind) = $event)),
                              class: "tiny",
                              onChange: _cache[134] || (_cache[134] = $event => (_ctx.boxAdhoc.port = _ctx.boxAdhoc.kind === 'imap' ? 993 : 995))
                            }, _hoisted_500, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                              [_vModelSelect, _ctx.boxAdhoc.kind]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[135] || (_cache[135] = $event => ((_ctx.boxAdhoc.host) = $event)),
                              class: "grow",
                              placeholder: "imap.example.com"
                            }, null, 512 /* NEED_PATCH */), [
                              [_vModelText, _ctx.boxAdhoc.host]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[136] || (_cache[136] = $event => ((_ctx.boxAdhoc.port) = $event)),
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
                              "onUpdate:modelValue": _cache[137] || (_cache[137] = $event => ((_ctx.boxAdhoc.mode) = $event)),
                              class: "tiny"
                            }, [
                              _createElementVNode("option", _hoisted_501, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */),
                              _hoisted_502,
                              _createElementVNode("option", _hoisted_503, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */)
                            ], 512 /* NEED_PATCH */), [
                              [_vModelSelect, _ctx.boxAdhoc.mode]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[138] || (_cache[138] = $event => ((_ctx.boxAdhoc.username) = $event)),
                              class: "short",
                              placeholder: _ctx.t('User name'),
                              autocomplete: "off"
                            }, null, 8 /* PROPS */, _hoisted_504), [
                              [_vModelText, _ctx.boxAdhoc.username]
                            ]),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[139] || (_cache[139] = $event => ((_ctx.boxAdhoc.secret) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Password'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_505), [
                              [_vModelText, _ctx.boxAdhoc.secret]
                            ])
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.mailboxResult)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_506, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Result')), 1 /* TEXT */),
                              _createElementVNode("code", {
                                class: _normalizeClass(_ctx.mailboxResult.ok ? 'good' : 'bad')
                              }, _toDisplayString(_ctx.mailboxResult.ok ? _ctx.t('Signed in') : (_ctx.mailboxResult.error || _ctx.t('Failed'))), 3 /* TEXT, CLASS */)
                            ]),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.inbox)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_507, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Inbox')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} messages', {n: _ctx.mailboxResult.details.inbox.messages})) + " · " + _toDisplayString(_ctx.t('{n} unread', {n: _ctx.mailboxResult.details.inbox.unseen})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.mailbox)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_508, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Mailbox')), 1 /* TEXT */),
                                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} messages', {n: _ctx.mailboxResult.details.mailbox.messages})), 1 /* TEXT */)
                                ]))
                              : _createCommentVNode("v-if", true),
                            (_ctx.mailboxResult.details && _ctx.mailboxResult.details.folders)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_509, [
                                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Folders')), 1 /* TEXT */),
                                  _createElementVNode("code", _hoisted_510, _toDisplayString(_ctx.mailboxResult.details.folders.join(', ')), 1 /* TEXT */)
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
          ? (_openBlock(), _createElementBlock("section", _hoisted_511, [
              _createElementVNode("div", _hoisted_512, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Clock check (NTP)')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_513, _toDisplayString(_ctx.t('A clock that has drifted is behind more certificate and sign-in failures than anything else.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_514, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[140] || (_cache[140] = $event => ((_ctx.ntpHost) = $event)),
                    placeholder: _ctx.t('pool.ntp.org'),
                    onKeyup: _cache[141] || (_cache[141] = _withKeys((...args) => (_ctx.runNtp && _ctx.runNtp(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_515), [
                    [_vModelText, _ctx.ntpHost]
                  ]),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.ntp,
                    onClick: _cache[142] || (_cache[142] = (...args) => (_ctx.runNtp && _ctx.runNtp(...args)))
                  }, _toDisplayString(_ctx.t('Compare clocks')), 9 /* TEXT, PROPS */, _hoisted_516)
                ]),
                (_ctx.ntpResult)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_517, [
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
                        ? (_openBlock(), _createElementBlock("div", _hoisted_518, [
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
                        : (_openBlock(), _createElementBlock("p", _hoisted_519, "⚠ " + _toDisplayString(_ctx.ntpResult.error), 1 /* TEXT */))
                    ]))
                  : _createCommentVNode("v-if", true)
              ])
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ FTP / SFTP ============ "),
        (_ctx.tab==='files')
          ? (_openBlock(), _createElementBlock("section", _hoisted_520, [
              _createElementVNode("div", _hoisted_521, [
                _createElementVNode("h3", null, _toDisplayString(_ctx.t('Enter the connection details')), 1 /* TEXT */),
                _createElementVNode("p", _hoisted_522, _toDisplayString(_ctx.t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_523, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[143] || (_cache[143] = $event => ((_ctx.adhoc.kind) = $event)),
                    class: "tiny",
                    onChange: _cache[144] || (_cache[144] = (...args) => (_ctx.adhocKindChanged && _ctx.adhocKindChanged(...args)))
                  }, _hoisted_526, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelSelect, _ctx.adhoc.kind]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[145] || (_cache[145] = $event => ((_ctx.adhoc.host) = $event)),
                    class: "grow",
                    placeholder: "server.example.com",
                    onKeyup: _cache[146] || (_cache[146] = _withKeys((...args) => (_ctx.quickConnect && _ctx.quickConnect(...args)), ["enter"]))
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [_vModelText, _ctx.adhoc.host]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[147] || (_cache[147] = $event => ((_ctx.adhoc.port) = $event)),
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
                    "onUpdate:modelValue": _cache[148] || (_cache[148] = $event => ((_ctx.adhoc.username) = $event)),
                    class: "short",
                    placeholder: _ctx.t('User name'),
                    autocomplete: "off"
                  }, null, 8 /* PROPS */, _hoisted_527), [
                    [_vModelText, _ctx.adhoc.username]
                  ])
                ]),
                _createElementVNode("div", _hoisted_528, [
                  (_ctx.adhoc.kind==='sftp')
                    ? _withDirectives((_openBlock(), _createElementBlock("select", {
                        key: 0,
                        "onUpdate:modelValue": _cache[149] || (_cache[149] = $event => ((_ctx.adhoc.authType) = $event)),
                        class: "tiny"
                      }, [
                        _createElementVNode("option", _hoisted_529, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                        _createElementVNode("option", _hoisted_530, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */)), [
                        [_vModelSelect, _ctx.adhoc.authType]
                      ])
                    : _createCommentVNode("v-if", true),
                  (_ctx.adhoc.kind==='ftp')
                    ? _withDirectives((_openBlock(), _createElementBlock("select", {
                        key: 1,
                        "onUpdate:modelValue": _cache[150] || (_cache[150] = $event => ((_ctx.adhoc.mode) = $event)),
                        class: "tiny"
                      }, [
                        _createElementVNode("option", _hoisted_531, _toDisplayString(_ctx.t('No encryption')), 1 /* TEXT */),
                        _createElementVNode("option", _hoisted_532, _toDisplayString(_ctx.t('TLS from the start')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */)), [
                        [_vModelSelect, _ctx.adhoc.mode]
                      ])
                    : _createCommentVNode("v-if", true),
                  (_ctx.adhoc.authType==='key' && _ctx.adhoc.kind==='sftp')
                    ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[151] || (_cache[151] = $event => ((_ctx.adhoc.privateKeyPath) = $event)),
                          class: "grow mono",
                          placeholder: _ctx.t('Key file in your Nextcloud files')
                        }, null, 8 /* PROPS */, _hoisted_533), [
                          [_vModelText, _ctx.adhoc.privateKeyPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          onClick: _cache[152] || (_cache[152] = $event => {_ctx.pickFile('Choose a key file', (p) => { _ctx.adhoc.privateKeyPath = p; })})
                        }, "📂")
                      ], 64 /* STABLE_FRAGMENT */))
                    : _withDirectives((_openBlock(), _createElementBlock("input", {
                        key: 3,
                        "onUpdate:modelValue": _cache[153] || (_cache[153] = $event => ((_ctx.adhoc.secret) = $event)),
                        type: "password",
                        class: "short",
                        placeholder: _ctx.t('Password'),
                        autocomplete: "new-password"
                      }, null, 8 /* PROPS */, _hoisted_534)), [
                        [_vModelText, _ctx.adhoc.secret]
                      ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[154] || (_cache[154] = $event => ((_ctx.adhoc.path) = $event)),
                    class: "short mono",
                    placeholder: _ctx.t('Start folder (optional)')
                  }, null, 8 /* PROPS */, _hoisted_535), [
                    [_vModelText, _ctx.adhoc.path]
                  ]),
                  _createElementVNode("button", {
                    class: "btn primary",
                    disabled: _ctx.busy.browse || !_ctx.adhoc.host,
                    onClick: _cache[155] || (_cache[155] = (...args) => (_ctx.quickConnect && _ctx.quickConnect(...args)))
                  }, _toDisplayString(_ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_536),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: !_ctx.adhoc.host,
                    onClick: _cache[156] || (_cache[156] = (...args) => (_ctx.saveAdhoc && _ctx.saveAdhoc(...args)))
                  }, _toDisplayString(_ctx.t('Save to the list')), 9 /* TEXT, PROPS */, _hoisted_537)
                ]),
                (_ctx.adhoc.kind==='ftp' && !_ctx.adhoc.username)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_538, _toDisplayString(_ctx.t('Leave the user name blank to sign in anonymously.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              _createElementVNode("div", _hoisted_539, [
                _createElementVNode("div", _hoisted_540, [
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[157] || (_cache[157] = $event => ((_ctx.filesConn) = $event)),
                    class: "grow",
                    onChange: _cache[158] || (_cache[158] = (...args) => (_ctx.useSaved && _ctx.useSaved(...args)))
                  }, [
                    _createElementVNode("option", _hoisted_541, _toDisplayString(_ctx.t('Choose a saved FTP or SFTP connection…')), 1 /* TEXT */),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fileConnections, (c) => {
                      return (_openBlock(), _createElementBlock("option", {
                        key: c.id,
                        value: c.id
                      }, _toDisplayString(c.name) + " — " + _toDisplayString(c.kind.toUpperCase()) + " " + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_542))
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
                    onClick: _cache[159] || (_cache[159] = $event => (_ctx.openConn(null,'sftp')))
                  }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */),
                  (_ctx.filesConn)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn sm",
                        onClick: _cache[160] || (_cache[160] = $event => (_ctx.openConn(_ctx.connById(_ctx.filesConn))))
                      }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  (_ctx.filesConn)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 1,
                        class: "btn sm",
                        disabled: _ctx.busy.conntest,
                        onClick: _cache[161] || (_cache[161] = $event => (_ctx.testConn(_ctx.connById(_ctx.filesConn))))
                      }, _toDisplayString(_ctx.t('Test')), 9 /* TEXT, PROPS */, _hoisted_543))
                    : _createCommentVNode("v-if", true)
                ]),
                (!_ctx.connCaps.sftp && !_ctx.connCaps.ftp)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_544, _toDisplayString(_ctx.t('Neither FTP nor SFTP is available in this PHP build.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.filesConn || _ctx.adhocActive)
                ? (_openBlock(), _createElementBlock("div", _hoisted_545, [
                    (_ctx.adhocActive)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_546, [
                          _createElementVNode("strong", _hoisted_547, _toDisplayString(_ctx.adhoc.kind.toUpperCase()) + " " + _toDisplayString(_ctx.adhoc.username || _ctx.t('anonymous')) + "@" + _toDisplayString(_ctx.adhoc.host), 1 /* TEXT */),
                          _hoisted_548,
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[162] || (_cache[162] = (...args) => (_ctx.saveAdhoc && _ctx.saveAdhoc(...args)))
                          }, _toDisplayString(_ctx.t('Save this connection')), 1 /* TEXT */),
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _cache[163] || (_cache[163] = (...args) => (_ctx.disconnect && _ctx.disconnect(...args)))
                          }, _toDisplayString(_ctx.t('Disconnect')), 1 /* TEXT */)
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("div", _hoisted_549, [
                      _createElementVNode("button", {
                        class: "btn xs",
                        disabled: !_ctx.filesData || !_ctx.filesData.parent,
                        onClick: _cache[164] || (_cache[164] = $event => (_ctx.browse(_ctx.filesData ? _ctx.filesData.parent : '')))
                      }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_550),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[165] || (_cache[165] = $event => ((_ctx.filesPath) = $event)),
                        class: "mono",
                        onKeyup: _cache[166] || (_cache[166] = _withKeys($event => (_ctx.browse(_ctx.filesPath)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.filesPath]
                      ]),
                      _createElementVNode("button", {
                        class: "btn xs",
                        onClick: _cache[167] || (_cache[167] = $event => (_ctx.browse(_ctx.filesPath)))
                      }, _toDisplayString(_ctx.t('Go')), 1 /* TEXT */),
                      _hoisted_551,
                      _createElementVNode("button", {
                        class: "btn xs",
                        onClick: _cache[168] || (_cache[168] = $event => (_ctx.fileAction('mkdir')))
                      }, _toDisplayString(_ctx.t('New folder')), 1 /* TEXT */)
                    ]),
                    (_ctx.filesData)
                      ? (_openBlock(), _createElementBlock("table", _hoisted_552, [
                          _createElementVNode("thead", null, [
                            _createElementVNode("tr", null, [
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Size')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Changed')), 1 /* TEXT */),
                              _createElementVNode("th", null, _toDisplayString(_ctx.t('Rights')), 1 /* TEXT */),
                              _hoisted_553
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
                                      }, "📁 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_554))
                                    : (_openBlock(), _createElementBlock("span", _hoisted_555, "📄 " + _toDisplayString(e.name), 1 /* TEXT */))
                                ]),
                                _createElementVNode("td", _hoisted_556, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_557, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_558, _toDisplayString(e.permissions), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_559, [
                                  (!e.directory)
                                    ? (_openBlock(), _createElementBlock("button", {
                                        key: 0,
                                        class: "btn xs",
                                        disabled: _ctx.busy.dl,
                                        onClick: $event => (_ctx.downloadFile(e))
                                      }, "⤓ " + _toDisplayString(_ctx.t('To my files')), 9 /* TEXT, PROPS */, _hoisted_560))
                                    : _createCommentVNode("v-if", true),
                                  _createElementVNode("button", {
                                    class: "btn xs",
                                    onClick: $event => (_ctx.fileAction('rename', e))
                                  }, _toDisplayString(_ctx.t('Rename')), 9 /* TEXT, PROPS */, _hoisted_561),
                                  _createElementVNode("button", {
                                    class: "btn xs danger",
                                    onClick: $event => (_ctx.fileAction(e.directory ? 'rmdir' : 'delete', e))
                                  }, _toDisplayString(_ctx.t('Delete')), 9 /* TEXT, PROPS */, _hoisted_562)
                                ])
                              ], 2 /* CLASS */))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    (_ctx.filesData && !_ctx.filesData.entries.length)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_563, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.filesConn || _ctx.adhocActive)
                ? (_openBlock(), _createElementBlock("div", _hoisted_564, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Move files')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_565, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[169] || (_cache[169] = $event => ((_ctx.filesTarget) = $event)),
                        class: "short mono",
                        placeholder: _ctx.t('Nextcloud folder for downloads')
                      }, null, 8 /* PROPS */, _hoisted_566), [
                        [_vModelText, _ctx.filesTarget]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[170] || (_cache[170] = $event => {_ctx.pickFile('Choose a folder for downloads', (p) => { _ctx.filesTarget = p; }, true)})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_567, _toDisplayString(_ctx.t('Downloads land in this folder of your Nextcloud files.')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("div", _hoisted_568, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[171] || (_cache[171] = $event => ((_ctx.filesSource) = $event)),
                        class: "mono",
                        placeholder: _ctx.t('Path in your Nextcloud files, e.g. Documents/report.pdf')
                      }, null, 8 /* PROPS */, _hoisted_569), [
                        [_vModelText, _ctx.filesSource]
                      ]),
                      _createElementVNode("button", {
                        class: "btn sm",
                        onClick: _cache[172] || (_cache[172] = $event => {_ctx.pickFile('Choose a file to upload', (p) => { _ctx.filesSource = p; })})
                      }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: _ctx.busy.ul || !_ctx.filesSource,
                        onClick: _cache[173] || (_cache[173] = (...args) => (_ctx.uploadFile && _ctx.uploadFile(...args)))
                      }, "⤒ " + _toDisplayString(_ctx.t('Upload to this folder')), 9 /* TEXT, PROPS */, _hoisted_570)
                    ]),
                    (_ctx.transferNote)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_571, _toDisplayString(_ctx.transferNote), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true),
        _createCommentVNode(" ============ SSH / Telnet / NTP ============ "),
        (_ctx.tab==='ssh')
          ? (_openBlock(), _createElementBlock("section", _hoisted_572, [
              _createElementVNode("div", _hoisted_573, [
                _createElementVNode("div", _hoisted_574, [
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[174] || (_cache[174] = $event => ((_ctx.sshHost) = $event)),
                    placeholder: _ctx.t('Host name or IP address'),
                    onKeyup: _cache[175] || (_cache[175] = _withKeys((...args) => (_ctx.runSsh && _ctx.runSsh(...args)), ["enter"]))
                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_575), [
                    [_vModelText, _ctx.sshHost]
                  ]),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[176] || (_cache[176] = $event => ((_ctx.sshPort) = $event)),
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
                    onClick: _cache[177] || (_cache[177] = (...args) => (_ctx.runSsh && _ctx.runSsh(...args)))
                  }, _toDisplayString(_ctx.t('Inspect SSH')), 9 /* TEXT, PROPS */, _hoisted_576),
                  _createElementVNode("button", {
                    class: "btn",
                    disabled: _ctx.busy.telnet,
                    onClick: _cache[178] || (_cache[178] = (...args) => (_ctx.runTelnet && _ctx.runTelnet(...args)))
                  }, _toDisplayString(_ctx.t('Try Telnet')), 9 /* TEXT, PROPS */, _hoisted_577)
                ]),
                _createElementVNode("label", _hoisted_578, [
                  _withDirectives(_createElementVNode("input", {
                    type: "checkbox",
                    "onUpdate:modelValue": _cache[179] || (_cache[179] = $event => ((_ctx.sshAuthMethods) = $event))
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelCheckbox, _ctx.sshAuthMethods]
                  ]),
                  _createTextVNode(" " + _toDisplayString(_ctx.t('Also ask which sign-in methods are accepted (leaves one failed attempt in the server log)')), 1 /* TEXT */)
                ])
              ]),
              (_ctx.sshResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_579, [
                    (_ctx.sshResult.error)
                      ? (_openBlock(), _createElementBlock("p", _hoisted_580, "⚠ " + _toDisplayString(_ctx.sshResult.error), 1 /* TEXT */))
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
                    _createElementVNode("div", _hoisted_581, [
                      _createElementVNode("div", null, [
                        _createElementVNode("span", null, _toDisplayString(_ctx.t('Identification')), 1 /* TEXT */),
                        _createElementVNode("code", _hoisted_582, _toDisplayString(_ctx.sshResult.banner), 1 /* TEXT */)
                      ]),
                      (_ctx.sshResult.authMethods)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_583, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Sign-in methods')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.sshResult.authMethods.join(', ')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]),
                    ((_ctx.sshResult.hostKeys||[]).length)
                      ? (_openBlock(), _createElementBlock("table", _hoisted_584, [
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
                                _createElementVNode("td", _hoisted_585, _toDisplayString(k.type), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_586, _toDisplayString(k.bits ? k.bits + ' bit' : ''), 1 /* TEXT */),
                                _createElementVNode("td", _hoisted_587, _toDisplayString(k.sha256), 1 /* TEXT */)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          ])
                        ]))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("details", null, [
                      _createElementVNode("summary", null, _toDisplayString(_ctx.t('Algorithms offered')), 1 /* TEXT */),
                      _createElementVNode("div", _hoisted_588, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshResult.algorithms, (list, name) => {
                          return _withDirectives((_openBlock(), _createElementBlock("div", { key: name }, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t(_ctx.algoLabel(name) || name)), 1 /* TEXT */),
                            _createElementVNode("code", _hoisted_589, _toDisplayString(list.join(', ')), 1 /* TEXT */)
                          ])), [
                            [_vShow, list.length && _ctx.algoLabel(name)]
                          ])
                        }), 128 /* KEYED_FRAGMENT */))
                      ])
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.telnetResult)
                ? (_openBlock(), _createElementBlock("div", _hoisted_590, [
                    _hoisted_591,
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
                      ? (_openBlock(), _createElementBlock("p", _hoisted_592, "⚠ " + _toDisplayString(_ctx.telnetResult.error), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true),
                    (_ctx.telnetResult.banner)
                      ? (_openBlock(), _createElementBlock("pre", _hoisted_593, _toDisplayString(_ctx.telnetResult.banner), 1 /* TEXT */))
                      : _createCommentVNode("v-if", true)
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.allowed('sshexec'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_594, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Enter the connection details')), 1 /* TEXT */),
                    _createElementVNode("p", _hoisted_595, _toDisplayString(_ctx.t('Nothing has to be saved first. Fill this in and connect; save it to the list only if you want it again.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_596, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[180] || (_cache[180] = $event => ((_ctx.sshAdhoc.host) = $event)),
                        class: "grow",
                        placeholder: "server.example.com",
                        onKeyup: _cache[181] || (_cache[181] = _withKeys((...args) => (_ctx.quickConsole && _ctx.quickConsole(...args)), ["enter"]))
                      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                        [_vModelText, _ctx.sshAdhoc.host]
                      ]),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[182] || (_cache[182] = $event => ((_ctx.sshAdhoc.port) = $event)),
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
                        "onUpdate:modelValue": _cache[183] || (_cache[183] = $event => ((_ctx.sshAdhoc.username) = $event)),
                        class: "short",
                        placeholder: _ctx.t('User name'),
                        autocomplete: "off"
                      }, null, 8 /* PROPS */, _hoisted_597), [
                        [_vModelText, _ctx.sshAdhoc.username]
                      ]),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[184] || (_cache[184] = $event => ((_ctx.sshAdhoc.authType) = $event)),
                        class: "tiny"
                      }, [
                        _createElementVNode("option", _hoisted_598, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                        _createElementVNode("option", _hoisted_599, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.sshAdhoc.authType]
                      ])
                    ]),
                    _createElementVNode("div", _hoisted_600, [
                      (_ctx.sshAdhoc.authType === 'key')
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[185] || (_cache[185] = $event => ((_ctx.sshAdhoc.privateKeyPath) = $event)),
                              class: "grow mono",
                              placeholder: _ctx.t('Key file in your Nextcloud files')
                            }, null, 8 /* PROPS */, _hoisted_601), [
                              [_vModelText, _ctx.sshAdhoc.privateKeyPath]
                            ]),
                            _createElementVNode("button", {
                              class: "btn sm",
                              onClick: _cache[186] || (_cache[186] = $event => {_ctx.pickFile('Choose a key file', (p) => { _ctx.sshAdhoc.privateKeyPath = p; })})
                            }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */),
                            _withDirectives(_createElementVNode("input", {
                              "onUpdate:modelValue": _cache[187] || (_cache[187] = $event => ((_ctx.sshAdhoc.passphrase) = $event)),
                              type: "password",
                              class: "short",
                              placeholder: _ctx.t('Key passphrase (if any)'),
                              autocomplete: "new-password"
                            }, null, 8 /* PROPS */, _hoisted_602), [
                              [_vModelText, _ctx.sshAdhoc.passphrase]
                            ])
                          ], 64 /* STABLE_FRAGMENT */))
                        : _withDirectives((_openBlock(), _createElementBlock("input", {
                            key: 1,
                            "onUpdate:modelValue": _cache[188] || (_cache[188] = $event => ((_ctx.sshAdhoc.secret) = $event)),
                            type: "password",
                            class: "short",
                            placeholder: _ctx.t('Password'),
                            autocomplete: "new-password"
                          }, null, 8 /* PROPS */, _hoisted_603)), [
                            [_vModelText, _ctx.sshAdhoc.secret]
                          ]),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: _ctx.busy.term || !_ctx.sshAdhoc.host || !_ctx.sshAdhoc.username,
                        onClick: _cache[189] || (_cache[189] = (...args) => (_ctx.quickConsole && _ctx.quickConsole(...args)))
                      }, "🖳 " + _toDisplayString(_ctx.t('Connect')), 9 /* TEXT, PROPS */, _hoisted_604),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: !_ctx.sshAdhoc.host,
                        onClick: _cache[190] || (_cache[190] = (...args) => (_ctx.saveSshAdhoc && _ctx.saveSshAdhoc(...args)))
                      }, _toDisplayString(_ctx.t('Save to the list')), 9 /* TEXT, PROPS */, _hoisted_605)
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.allowed('sshexec'))
                ? (_openBlock(), _createElementBlock("div", _hoisted_606, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('Run a command over SSH')), 1 /* TEXT */),
                    _createElementVNode("p", _hoisted_607, _toDisplayString(_ctx.t('Signs in to a saved SSH connection with its password or private key. Run a single command, pick a preset, or open a console that keeps its working directory from one line to the next.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_608, [
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[191] || (_cache[191] = $event => ((_ctx.sshConn) = $event)),
                        class: "grow"
                      }, [
                        _createElementVNode("option", _hoisted_609, _toDisplayString(_ctx.t('Choose a saved SSH connection…')), 1 /* TEXT */),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshConnections, (c) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: c.id,
                            value: c.id
                          }, _toDisplayString(c.name) + " — " + _toDisplayString(c.username) + "@" + _toDisplayString(c.host), 9 /* TEXT, PROPS */, _hoisted_610))
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
                        onClick: _cache[192] || (_cache[192] = $event => (_ctx.openConn(null,'ssh')))
                      }, _toDisplayString(_ctx.t('+ Add connection')), 1 /* TEXT */),
                      (_ctx.sshConn)
                        ? (_openBlock(), _createElementBlock("button", {
                            key: 0,
                            class: "btn sm",
                            onClick: _cache[193] || (_cache[193] = $event => (_ctx.openConn(_ctx.connById(_ctx.sshConn))))
                          }, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ]),
                    _createElementVNode("div", _hoisted_611, [
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[194] || (_cache[194] = $event => ((_ctx.sshPreset) = $event)),
                        class: "grow"
                      }, [
                        _createElementVNode("option", _hoisted_612, _toDisplayString(_ctx.t('Or type a command below…')), 1 /* TEXT */),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sshPresets, (p, id) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: id,
                            value: id
                          }, _toDisplayString(_ctx.t(p.label)), 9 /* TEXT, PROPS */, _hoisted_613))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.sshPreset]
                      ]),
                      _createElementVNode("button", {
                        class: "btn primary",
                        disabled: _ctx.busy.sshrun || !_ctx.sshConn || !_ctx.sshPreset,
                        onClick: _cache[195] || (_cache[195] = (...args) => (_ctx.runSshPreset && _ctx.runSshPreset(...args)))
                      }, _toDisplayString(_ctx.t('Run')), 9 /* TEXT, PROPS */, _hoisted_614)
                    ]),
                    _createElementVNode("div", _hoisted_615, [
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[196] || (_cache[196] = $event => ((_ctx.sshCommand) = $event)),
                        class: "mono",
                        placeholder: _ctx.t('uptime'),
                        onKeyup: _cache[197] || (_cache[197] = _withKeys((...args) => (_ctx.runSshCommand && _ctx.runSshCommand(...args)), ["enter"]))
                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_616), [
                        [_vModelText, _ctx.sshCommand]
                      ]),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: _ctx.busy.sshrun || !_ctx.sshConn || !_ctx.sshCommand,
                        onClick: _cache[198] || (_cache[198] = (...args) => (_ctx.runSshCommand && _ctx.runSshCommand(...args)))
                      }, _toDisplayString(_ctx.t('Run command')), 9 /* TEXT, PROPS */, _hoisted_617),
                      _createElementVNode("button", {
                        class: "btn",
                        disabled: !_ctx.sshConn,
                        onClick: _cache[199] || (_cache[199] = (...args) => (_ctx.openConsole && _ctx.openConsole(...args)))
                      }, "🖳 " + _toDisplayString(_ctx.t('Open a console')), 9 /* TEXT, PROPS */, _hoisted_618)
                    ]),
                    (_ctx.sshRunResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_619, [
                          _createElementVNode("div", _hoisted_620, [
                            _createElementVNode("div", null, [
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Command')), 1 /* TEXT */),
                              _createElementVNode("code", _hoisted_621, _toDisplayString(_ctx.sshRunResult.command), 1 /* TEXT */)
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
                          _createElementVNode("pre", _hoisted_622, _toDisplayString(_ctx.sshRunResult.output || _ctx.t('(no output)')), 1 /* TEXT */)
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
          key: 0,
          class: "drawer-backdrop centred",
          onClick: _cache[202] || (_cache[202] = _withModifiers($event => (_ctx.sysInfo=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_623, [
            _createElementVNode("div", _hoisted_624, [
              _hoisted_625,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('System information')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_626, _toDisplayString(_ctx.t('What this server can do, and what it could do')), 1 /* TEXT */)
              ]),
              _hoisted_627,
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[200] || (_cache[200] = $event => (_ctx.sysInfo=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_628, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Basics')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_629, [
                _createElementVNode("div", null, [
                  _hoisted_630,
                  _createElementVNode("code", null, "v" + _toDisplayString(_ctx.version), 1 /* TEXT */)
                ]),
                (_ctx.requirements && _ctx.requirements.distro)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_631, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('System')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.requirements.distro), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.requirements && _ctx.requirements.phpVersion)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_632, [
                      _hoisted_633,
                      _createElementVNode("code", null, [
                        _createTextVNode(_toDisplayString(_ctx.requirements.phpVersion), 1 /* TEXT */),
                        (_ctx.requirements.phpUser)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_634, " (" + _toDisplayString(_ctx.requirements.phpUser) + ")", 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ])
                    ]))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor database')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.t('{n} IEEE prefixes', {n: _ctx.status.ouiEntries})), 1 /* TEXT */)
                ]),
                (_ctx.status.neighbourLimits)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_635, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Neighbour table')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.status.neighbourCount) + " / " + _toDisplayString(_ctx.status.neighbourLimits.gc3), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.status.defaultRoute && _ctx.status.defaultRoute.gateway)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_636, [
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
                      _createElementVNode("span", _hoisted_637, _toDisplayString(tgt.interface), 1 /* TEXT */)
                    ])
                  ]))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              (_ctx.allowed('server'))
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("h3", null, _toDisplayString(_ctx.t('This server')), 1 /* TEXT */),
                    (_ctx.serverResult)
                      ? (_openBlock(), _createElementBlock("div", _hoisted_638, [
                          _createElementVNode("div", _hoisted_639, [
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
                              _createElementVNode("span", null, _toDisplayString(_ctx.t('Neighbour entries')), 1 /* TEXT */),
                              _createElementVNode("code", null, _toDisplayString(_ctx.serverResult.neighbours), 1 /* TEXT */)
                            ])
                          ]),
                          _createElementVNode("table", _hoisted_640, [
                            _createElementVNode("thead", null, [
                              _createElementVNode("tr", null, [
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Interface')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('State')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('MAC address')), 1 /* TEXT */),
                                _createElementVNode("th", null, _toDisplayString(_ctx.t('Addresses')), 1 /* TEXT */),
                                _hoisted_641
                              ])
                            ]),
                            _createElementVNode("tbody", null, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.serverResult.interfaces, (i) => {
                                return (_openBlock(), _createElementBlock("tr", {
                                  key: i.name
                                }, [
                                  _createElementVNode("td", _hoisted_642, _toDisplayString(i.name), 1 /* TEXT */),
                                  _createElementVNode("td", null, [
                                    _createElementVNode("span", {
                                      class: _normalizeClass(["pill", i.up ? 'ok' : 'no'])
                                    }, _toDisplayString(i.up ? 'UP' : 'DOWN'), 3 /* TEXT, CLASS */)
                                  ]),
                                  _createElementVNode("td", _hoisted_643, _toDisplayString(i.mac), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_644, _toDisplayString(i.addresses.map(a => a.ip + (a.family==='inet' ? '/'+a.cidr : '')).join(' ')), 1 /* TEXT */),
                                  _createElementVNode("td", _hoisted_645, _toDisplayString(i.mtu), 1 /* TEXT */)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ]),
                          (_ctx.serverResult.listeners.length)
                            ? (_openBlock(), _createElementBlock("details", _hoisted_646, [
                                _createElementVNode("summary", null, _toDisplayString(_ctx.t('Listening sockets')), 1 /* TEXT */),
                                _createElementVNode("pre", _hoisted_647, _toDisplayString(_ctx.serverResult.listeners.join('\n')), 1 /* TEXT */)
                              ]))
                            : _createCommentVNode("v-if", true)
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Tools you can use now')), 1 /* TEXT */),
              (!_ctx.activeComponents.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_648, _toDisplayString(_ctx.t('None of the optional components are installed yet.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.activeComponents, (c) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: c.id,
                  class: "sys-row on"
                }, [
                  _createElementVNode("span", _hoisted_649, _toDisplayString(_ctx.t('installed')), 1 /* TEXT */),
                  _createElementVNode("div", null, [
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(c.name)), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_650, _toDisplayString(_ctx.t(c.enables)), 1 /* TEXT */)
                  ])
                ]))
              }), 128 /* KEYED_FRAGMENT */)),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Install these to unlock more')), 1 /* TEXT */),
              (!_ctx.dormantComponents.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_651, _toDisplayString(_ctx.t('Everything NetBase can use is already installed.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.dormantComponents, (c) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: c.id,
                  class: "sys-row off"
                }, [
                  _createElementVNode("span", _hoisted_652, _toDisplayString(_ctx.t('missing')), 1 /* TEXT */),
                  _createElementVNode("div", null, [
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(c.name)), 1 /* TEXT */),
                    _createElementVNode("div", null, _toDisplayString(_ctx.t(c.enables)), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_653, _toDisplayString(_ctx.t(c.without)), 1 /* TEXT */),
                    (_ctx.status.isAdmin && _ctx.installFor(c.id))
                      ? (_openBlock(), _createElementBlock("pre", _hoisted_654, _toDisplayString(_ctx.installFor(c.id)), 1 /* TEXT */))
                      : (_openBlock(), _createElementBlock("div", _hoisted_655, _toDisplayString(_ctx.t('Ask an administrator to install it.')), 1 /* TEXT */))
                  ])
                ]))
              }), 128 /* KEYED_FRAGMENT */))
            ]),
            _createElementVNode("div", _hoisted_656, [
              (_ctx.status.isAdmin)
                ? (_openBlock(), _createElementBlock("a", {
                    key: 0,
                    class: "btn sm",
                    href: _ctx.adminUrl
                  }, _toDisplayString(_ctx.t('Open administration settings')), 9 /* TEXT, PROPS */, _hoisted_657))
                : _createCommentVNode("v-if", true),
              _hoisted_658,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[201] || (_cache[201] = $event => (_ctx.sysInfo=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ appearance (per user, NetBase only) ============ "),
    (_ctx.themeBox)
      ? (_openBlock(), _createElementBlock("div", {
          key: 1,
          class: "drawer-backdrop centred",
          onClick: _cache[207] || (_cache[207] = _withModifiers($event => (_ctx.themeBox=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_659, [
            _createElementVNode("div", _hoisted_660, [
              _hoisted_661,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Settings')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_662, _toDisplayString(_ctx.t('Applies to NetBase only, for your account.')), 1 /* TEXT */)
              ]),
              _hoisted_663,
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[203] || (_cache[203] = $event => (_ctx.themeBox=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_664, [
              _createElementVNode("div", _hoisted_665, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.themeOptions, (opt) => {
                  return (_openBlock(), _createElementBlock("button", {
                    key: opt.id,
                    class: _normalizeClass(["theme-pick", {active: _ctx.settings.theme===opt.id}]),
                    onClick: $event => (_ctx.setTheme(opt.id))
                  }, [
                    _createElementVNode("span", {
                      class: _normalizeClass(["swatch", opt.id])
                    }, _hoisted_670, 2 /* CLASS */),
                    _createElementVNode("strong", null, _toDisplayString(_ctx.t(opt.label)), 1 /* TEXT */),
                    _createElementVNode("span", _hoisted_671, _toDisplayString(_ctx.t(opt.hint)), 1 /* TEXT */),
                    (_ctx.settings.theme===opt.id)
                      ? (_openBlock(), _createElementBlock("span", _hoisted_672, "✓"))
                      : _createCommentVNode("v-if", true)
                  ], 10 /* CLASS, PROPS */, _hoisted_666))
                }), 128 /* KEYED_FRAGMENT */))
              ]),
              _createElementVNode("p", _hoisted_673, _toDisplayString(_ctx.t('Saved to your account, so it follows you to every browser you sign in from.')), 1 /* TEXT */),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Language')), 1 /* TEXT */),
              _createElementVNode("label", _hoisted_674, [
                _createElementVNode("select", {
                  value: _ctx.settings.language || 'auto',
                  onChange: _cache[204] || (_cache[204] = $event => (_ctx.setLanguage($event.target.value)))
                }, [
                  _createElementVNode("option", _hoisted_676, _toDisplayString(_ctx.t('Follow Nextcloud')), 1 /* TEXT */),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.settings.languages || []), (l) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: l.code,
                      value: l.code
                    }, _toDisplayString(l.name), 9 /* TEXT, PROPS */, _hoisted_677))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_675)
              ]),
              _createElementVNode("p", _hoisted_678, _toDisplayString(_ctx.t('NetBase can speak a different language from the rest of Nextcloud — handy when the interface language and the language you think in are not the same.')), 1 /* TEXT */),
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('The list of tools')), 1 /* TEXT */),
              _createElementVNode("p", _hoisted_679, _toDisplayString(_ctx.t('Drag the tools in the sidebar into the order you work in — or hold Alt and press the up and down arrows. The order is kept for your account.')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn sm",
                disabled: !(_ctx.settings.tabOrder || []).length,
                onClick: _cache[205] || (_cache[205] = (...args) => (_ctx.resetTabOrder && _ctx.resetTabOrder(...args)))
              }, _toDisplayString(_ctx.t('Put them back in the original order')), 9 /* TEXT, PROPS */, _hoisted_680)
            ]),
            _createElementVNode("div", _hoisted_681, [
              _hoisted_682,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[206] || (_cache[206] = $event => (_ctx.themeBox=false))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
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
          _hoisted_685,
          _createElementVNode("strong", _hoisted_686, _toDisplayString(w.title), 1 /* TEXT */),
          _createElementVNode("span", _hoisted_687, _toDisplayString(w.base) + _toDisplayString(w.path ? '/' + w.path : ''), 1 /* TEXT */),
          _hoisted_688,
          _createElementVNode("button", {
            class: "btn xs",
            title: _ctx.t('Back'),
            disabled: w.trailAt < 1,
            onClick: _withModifiers($event => (_ctx.backWindow(w)), ["stop"])
          }, "←", 8 /* PROPS */, _hoisted_689),
          _createElementVNode("button", {
            class: "btn xs",
            title: _ctx.t('Front page'),
            onClick: _withModifiers($event => (_ctx.homeWindow(w)), ["stop"])
          }, "⌂", 8 /* PROPS */, _hoisted_690),
          _createElementVNode("button", {
            class: "btn xs",
            title: _ctx.t('Reload'),
            onClick: _withModifiers($event => (_ctx.reloadWindow(w)), ["stop"])
          }, "⟳", 8 /* PROPS */, _hoisted_691),
          _createElementVNode("button", {
            class: "btn xs",
            title: _ctx.t('Fill the screen'),
            onClick: _withModifiers($event => (_ctx.toggleFull(w)), ["stop"])
          }, "⤢", 8 /* PROPS */, _hoisted_692),
          _createElementVNode("button", {
            class: "btn xs",
            title: _ctx.t('Close'),
            onClick: _withModifiers($event => (_ctx.closeWindow(w)), ["stop"])
          }, "✕", 8 /* PROPS */, _hoisted_693)
        ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_684),
        (w.framed && !w.trusted)
          ? (_openBlock(), _createElementBlock("div", _hoisted_694, [
              _createElementVNode("span", null, _toDisplayString(_ctx.t('This page is built from frames, which a window kept away from Nextcloud cannot load.')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _withModifiers($event => (_ctx.trustWindow(w)), ["stop"])
              }, _toDisplayString(_ctx.t('Show it anyway')), 9 /* TEXT, PROPS */, _hoisted_695)
            ]))
          : _createCommentVNode("v-if", true),
        (w.busy)
          ? (_openBlock(), _createElementBlock("div", _hoisted_696, _toDisplayString(_ctx.t('Connecting…')), 1 /* TEXT */))
          : (w.error)
            ? (_openBlock(), _createElementBlock("div", _hoisted_697, "⚠ " + _toDisplayString(w.error), 1 /* TEXT */))
            : (w.trusted)
              ? (_openBlock(), _createElementBlock("iframe", {
                  key: "trusted",
                  src: w.src,
                  class: "devwin-frame",
                  title: w.title,
                  sandbox: "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"
                }, null, 8 /* PROPS */, _hoisted_698))
              : (_openBlock(), _createElementBlock("iframe", {
                  key: "sandboxed",
                  src: w.src,
                  class: "devwin-frame",
                  title: w.title,
                  sandbox: "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
                }, null, 8 /* PROPS */, _hoisted_699)),
        _createElementVNode("div", {
          class: "devwin-grip",
          onMousedown: _withModifiers($event => (_ctx.startResize(w, $event)), ["prevent","stop"])
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_700)
      ], 46 /* CLASS, STYLE, PROPS, NEED_HYDRATION */, _hoisted_683))
    }), 128 /* KEYED_FRAGMENT */)),
    _createCommentVNode(" ============ Nextcloud file picker ============ "),
    (_ctx.picker.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 2,
          class: "drawer-backdrop centred",
          onClick: _cache[212] || (_cache[212] = _withModifiers($event => (_ctx.picker.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_701, [
            _createElementVNode("div", _hoisted_702, [
              _hoisted_703,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t(_ctx.picker.title)), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_704, _toDisplayString(_ctx.t('Your Nextcloud files')), 1 /* TEXT */)
              ]),
              _hoisted_705,
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[208] || (_cache[208] = $event => (_ctx.picker.open=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_706, [
              _createElementVNode("div", _hoisted_707, [
                _createElementVNode("button", {
                  class: "btn xs",
                  disabled: _ctx.picker.path==='',
                  onClick: _cache[209] || (_cache[209] = $event => (_ctx.pickerOpen(_ctx.picker.parent || '')))
                }, "↑ " + _toDisplayString(_ctx.t('Up')), 9 /* TEXT, PROPS */, _hoisted_708),
                _createElementVNode("span", _hoisted_709, "/" + _toDisplayString(_ctx.picker.path), 1 /* TEXT */)
              ]),
              _createElementVNode("table", _hoisted_710, [
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
                            }, "📁 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_711))
                          : (_openBlock(), _createElementBlock("a", {
                              key: 1,
                              href: "#",
                              onClick: _withModifiers($event => (_ctx.pickerChoose(e.path)), ["prevent"])
                            }, "📄 " + _toDisplayString(e.name), 9 /* TEXT, PROPS */, _hoisted_712))
                      ]),
                      _createElementVNode("td", _hoisted_713, _toDisplayString(e.directory ? '' : _ctx.fmtBytes(e.size)), 1 /* TEXT */),
                      _createElementVNode("td", _hoisted_714, _toDisplayString(e.modified ? _ctx.ago(e.modified) : ''), 1 /* TEXT */)
                    ], 2 /* CLASS */))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ]),
              (!_ctx.picker.entries.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_715, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_716, [
              _createElementVNode("span", _hoisted_717, _toDisplayString(_ctx.picker.foldersOnly ? _ctx.t('Choose the folder you are in, or open another.') : _ctx.t('Click a file to choose it.')), 1 /* TEXT */),
              _hoisted_718,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[210] || (_cache[210] = $event => (_ctx.picker.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              (_ctx.picker.foldersOnly)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn primary",
                    onClick: _cache[211] || (_cache[211] = $event => (_ctx.pickerChoose(_ctx.picker.path)))
                  }, _toDisplayString(_ctx.t('Use this folder')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ SSH console ============ "),
    (_ctx.term.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 3,
          class: "drawer-backdrop centred",
          onClick: _cache[219] || (_cache[219] = _withModifiers((...args) => (_ctx.closeConsole && _ctx.closeConsole(...args)), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_719, [
            _createElementVNode("div", _hoisted_720, [
              _hoisted_721,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('SSH console')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_722, _toDisplayString(_ctx.term.user) + "@" + _toDisplayString(_ctx.term.host) + ":" + _toDisplayString(_ctx.term.cwd || '~'), 1 /* TEXT */)
              ]),
              _hoisted_723,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[213] || (_cache[213] = $event => (_ctx.term.lines = []))
              }, _toDisplayString(_ctx.t('Clear')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[214] || (_cache[214] = (...args) => (_ctx.closeConsole && _ctx.closeConsole(...args)))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_724, [
              _createElementVNode("p", _hoisted_725, _toDisplayString(_ctx.t('Each line runs on its own connection and the working directory is carried over, so cd, ls and tail behave as expected. Programs that need a real terminal — vi, top, an interactive password prompt — cannot run here.')), 1 /* TEXT */),
              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.term.lines, (l, i) => {
                return (_openBlock(), _createElementBlock("div", {
                  key: i,
                  class: _normalizeClass('term-line ' + l.kind)
                }, [
                  (l.kind==='cmd')
                    ? (_openBlock(), _createElementBlock("span", _hoisted_726, _toDisplayString(l.prompt), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  _createTextVNode(_toDisplayString(l.text), 1 /* TEXT */)
                ], 2 /* CLASS */))
              }), 128 /* KEYED_FRAGMENT */)),
              (_ctx.busy.term)
                ? (_openBlock(), _createElementBlock("div", _hoisted_727, "…"))
                : _createCommentVNode("v-if", true)
            ], 512 /* NEED_PATCH */),
            _createElementVNode("div", _hoisted_728, [
              _createElementVNode("span", _hoisted_729, _toDisplayString(_ctx.term.user) + "@" + _toDisplayString(_ctx.term.host) + ":" + _toDisplayString(_ctx.term.cwd || '~') + "$", 1 /* TEXT */),
              _withDirectives(_createElementVNode("input", {
                ref: "termInput",
                "onUpdate:modelValue": _cache[215] || (_cache[215] = $event => ((_ctx.term.command) = $event)),
                class: "mono",
                autocomplete: "off",
                spellcheck: "false",
                onKeydown: [
                  _cache[216] || (_cache[216] = _withKeys(_withModifiers((...args) => (_ctx.sendConsole && _ctx.sendConsole(...args)), ["prevent"]), ["enter"])),
                  _cache[217] || (_cache[217] = _withKeys(_withModifiers((...args) => (_ctx.historyBack && _ctx.historyBack(...args)), ["prevent"]), ["up"])),
                  _cache[218] || (_cache[218] = _withKeys(_withModifiers((...args) => (_ctx.historyForward && _ctx.historyForward(...args)), ["prevent"]), ["down"]))
                ]
              }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                [_vModelText, _ctx.term.command]
              ])
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ page preview ============ "),
    (_ctx.preview.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 4,
          class: "drawer-backdrop centred",
          onClick: _cache[227] || (_cache[227] = _withModifiers((...args) => (_ctx.closePreview && _ctx.closePreview(...args)), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_730, [
            _createElementVNode("div", _hoisted_731, [
              _hoisted_732,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.t('Page preview')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_733, _toDisplayString(_ctx.preview.url), 1 /* TEXT */)
              ]),
              _hoisted_734,
              _createElementVNode("a", {
                class: "btn sm",
                href: _ctx.preview.url,
                target: "_blank",
                rel: "noopener noreferrer",
                title: _ctx.t('Only works from inside that network')
              }, "↗", 8 /* PROPS */, _hoisted_735),
              _createElementVNode("button", {
                class: "btn sm",
                disabled: _ctx.preview.loading,
                onClick: _cache[220] || (_cache[220] = (...args) => (_ctx.reloadPreview && _ctx.reloadPreview(...args)))
              }, _toDisplayString(_ctx.t('Reload')), 9 /* TEXT, PROPS */, _hoisted_736),
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[221] || (_cache[221] = (...args) => (_ctx.closePreview && _ctx.closePreview(...args)))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_737, [
              (_ctx.preview.loading)
                ? (_openBlock(), _createElementBlock("p", _hoisted_738, _toDisplayString(_ctx.t('Rendering the page on the server…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.preview.error)
                ? (_openBlock(), _createElementBlock("p", _hoisted_739, "⚠ " + _toDisplayString(_ctx.preview.error), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _withDirectives(_createElementVNode("img", {
                src: _ctx.preview.src,
                class: "preview-shot",
                onLoad: _cache[222] || (_cache[222] = $event => (_ctx.preview.loading=false)),
                onError: _cache[223] || (_cache[223] = (...args) => (_ctx.previewFailed && _ctx.previewFailed(...args))),
                alt: _ctx.t('Page preview')
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_740), [
                [_vShow, !_ctx.preview.loading && !_ctx.preview.error]
              ])
            ]),
            _createElementVNode("div", _hoisted_741, [
              _createElementVNode("label", _hoisted_742, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": _cache[224] || (_cache[224] = $event => ((_ctx.preview.full) = $event)),
                  onChange: _cache[225] || (_cache[225] = (...args) => (_ctx.reloadPreview && _ctx.reloadPreview(...args)))
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelCheckbox, _ctx.preview.full]
                ]),
                _createTextVNode(" " + _toDisplayString(_ctx.t('Whole page, not just the first screen')), 1 /* TEXT */)
              ]),
              _hoisted_743,
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[226] || (_cache[226] = (...args) => (_ctx.closePreview && _ctx.closePreview(...args)))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ saved connection editor ============ "),
    (_ctx.connModal)
      ? (_openBlock(), _createElementBlock("div", {
          key: 5,
          class: "drawer-backdrop centred",
          onClick: _cache[249] || (_cache[249] = _withModifiers($event => (_ctx.connModal=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_744, [
            _createElementVNode("div", _hoisted_745, [
              _hoisted_746,
              _createElementVNode("div", null, [
                _createElementVNode("strong", null, _toDisplayString(_ctx.connForm.id ? _ctx.t('Edit connection') : _ctx.t('New connection')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_747, _toDisplayString(_ctx.t('Saved for your account only. The password is encrypted on the server and never sent back to the browser.')), 1 /* TEXT */)
              ]),
              _hoisted_748,
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[228] || (_cache[228] = $event => (_ctx.connModal=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_749, [
              _createElementVNode("label", _hoisted_750, [
                _createElementVNode("span", _hoisted_751, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("select", {
                  "onUpdate:modelValue": _cache[229] || (_cache[229] = $event => ((_ctx.connForm.kind) = $event)),
                  onChange: _cache[230] || (_cache[230] = (...args) => (_ctx.connKindChanged && _ctx.connKindChanged(...args)))
                }, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connKinds, (k, id) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: id,
                      value: id
                    }, _toDisplayString(_ctx.t(k.label)), 9 /* TEXT, PROPS */, _hoisted_752))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelSelect, _ctx.connForm.kind]
                ])
              ]),
              _createElementVNode("label", _hoisted_753, [
                _createElementVNode("span", _hoisted_754, _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  "onUpdate:modelValue": _cache[231] || (_cache[231] = $event => ((_ctx.connForm.name) = $event)),
                  placeholder: _ctx.t('Office file server')
                }, null, 8 /* PROPS */, _hoisted_755), [
                  [_vModelText, _ctx.connForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_756, [
                _createElementVNode("label", _hoisted_757, [
                  _createElementVNode("span", _hoisted_758, _toDisplayString(_ctx.t('Host')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[232] || (_cache[232] = $event => ((_ctx.connForm.host) = $event)),
                    placeholder: "server.example.com"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.connForm.host]
                  ])
                ]),
                _createElementVNode("label", _hoisted_759, [
                  _createElementVNode("span", _hoisted_760, _toDisplayString(_ctx.t('Port')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[233] || (_cache[233] = $event => ((_ctx.connForm.port) = $event)),
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
                ? (_openBlock(), _createElementBlock("label", _hoisted_761, [
                    _createElementVNode("span", _hoisted_762, _toDisplayString(_ctx.t('Encryption')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[234] || (_cache[234] = $event => ((_ctx.connForm.mode) = $event))
                    }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.connModes, (m) => {
                        return (_openBlock(), _createElementBlock("option", {
                          key: m,
                          value: m
                        }, _toDisplayString(_ctx.t(_ctx.modeLabel(m))), 9 /* TEXT, PROPS */, _hoisted_763))
                      }), 128 /* KEYED_FRAGMENT */))
                    ], 512 /* NEED_PATCH */), [
                      [_vModelSelect, _ctx.connForm.mode]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='sftp' || _ctx.connForm.kind==='ssh')
                ? (_openBlock(), _createElementBlock("label", _hoisted_764, [
                    _createElementVNode("span", _hoisted_765, _toDisplayString(_ctx.t('Sign in with')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("select", {
                      "onUpdate:modelValue": _cache[235] || (_cache[235] = $event => ((_ctx.connForm.authType) = $event))
                    }, [
                      _createElementVNode("option", _hoisted_766, _toDisplayString(_ctx.t('Password')), 1 /* TEXT */),
                      _createElementVNode("option", _hoisted_767, _toDisplayString(_ctx.t('Private key')), 1 /* TEXT */)
                    ], 512 /* NEED_PATCH */), [
                      [_vModelSelect, _ctx.connForm.authType]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_768, [
                _createElementVNode("label", _hoisted_769, [
                  _createElementVNode("span", _hoisted_770, _toDisplayString(_ctx.t('User name')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    "onUpdate:modelValue": _cache[236] || (_cache[236] = $event => ((_ctx.connForm.username) = $event)),
                    autocomplete: "off"
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.connForm.username]
                  ])
                ]),
                (_ctx.connForm.authType !== 'key')
                  ? (_openBlock(), _createElementBlock("label", _hoisted_771, [
                      _createElementVNode("span", _hoisted_772, _toDisplayString(_ctx.connForm.id && _ctx.connForm.hasSecret ? _ctx.t('Password (leave blank to keep)') : _ctx.t('Password')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[237] || (_cache[237] = $event => ((_ctx.connForm.secret) = $event)),
                        type: "password",
                        autocomplete: "new-password"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.secret]
                      ])
                    ]))
                  : (_openBlock(), _createElementBlock("label", _hoisted_773, [
                      _createElementVNode("span", _hoisted_774, _toDisplayString(_ctx.t('Key passphrase (if any)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[238] || (_cache[238] = $event => ((_ctx.connForm.passphrase) = $event)),
                        type: "password",
                        autocomplete: "new-password"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.connForm.passphrase]
                      ])
                    ]))
              ]),
              (_ctx.connForm.authType === 'key')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                    _createElementVNode("label", _hoisted_775, [
                      _createElementVNode("span", _hoisted_776, _toDisplayString(_ctx.t('Key file in your Nextcloud files')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_777, [
                        _withDirectives(_createElementVNode("input", {
                          "onUpdate:modelValue": _cache[239] || (_cache[239] = $event => ((_ctx.connForm.privateKeyPath) = $event)),
                          class: "mono",
                          placeholder: "Keys/id_ed25519"
                        }, null, 512 /* NEED_PATCH */), [
                          [_vModelText, _ctx.connForm.privateKeyPath]
                        ]),
                        _createElementVNode("button", {
                          class: "btn sm",
                          onClick: _cache[240] || (_cache[240] = $event => {_ctx.pickFile('Choose a key file', (p) => { _ctx.connForm.privateKeyPath = p; })})
                        }, "📂 " + _toDisplayString(_ctx.t('Browse…')), 1 /* TEXT */)
                      ])
                    ]),
                    _createElementVNode("p", _hoisted_778, _toDisplayString(_ctx.t('Give the path of the private key inside your own Nextcloud files — the one without .pub. The server reads it when you save; the key itself never passes through the browser. Or paste it below instead.')), 1 /* TEXT */),
                    _createElementVNode("label", _hoisted_779, [
                      _createElementVNode("span", _hoisted_780, _toDisplayString(_ctx.connForm.id && _ctx.connForm.hasSecret ? _ctx.t('Private key (leave blank to keep)') : _ctx.t('Private key (paste)')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[241] || (_cache[241] = $event => ((_ctx.connForm.privateKey) = $event)),
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
                ? (_openBlock(), _createElementBlock("label", _hoisted_781, [
                    _createElementVNode("span", _hoisted_782, _toDisplayString(_ctx.t('Sender address')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[242] || (_cache[242] = $event => ((_ctx.connForm.from) = $event)),
                      placeholder: "notify@example.com"
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelText, _ctx.connForm.from]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='ftp' || _ctx.connForm.kind==='sftp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_783, [
                    _createElementVNode("span", _hoisted_784, _toDisplayString(_ctx.t('Start folder')), 1 /* TEXT */),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[243] || (_cache[243] = $event => ((_ctx.connForm.path) = $event)),
                      class: "mono",
                      placeholder: "/"
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelText, _ctx.connForm.path]
                    ])
                  ]))
                : _createCommentVNode("v-if", true),
              (_ctx.connForm.kind==='ftp')
                ? (_openBlock(), _createElementBlock("label", _hoisted_785, [
                    _withDirectives(_createElementVNode("input", {
                      type: "checkbox",
                      "onUpdate:modelValue": _cache[244] || (_cache[244] = $event => ((_ctx.connForm.passive) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelCheckbox, _ctx.connForm.passive]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Passive mode (usually right)')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("label", _hoisted_786, [
                _createElementVNode("span", _hoisted_787, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  "onUpdate:modelValue": _cache[245] || (_cache[245] = $event => ((_ctx.connForm.notes) = $event)),
                  rows: "2"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.connForm.notes]
                ])
              ]),
              (_ctx.connNote)
                ? (_openBlock(), _createElementBlock("p", _hoisted_788, _toDisplayString(_ctx.connNote), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_789, [
              (_ctx.connForm.id)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger sm",
                    onClick: _cache[246] || (_cache[246] = $event => (_ctx.deleteConn(_ctx.connForm)))
                  }, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_790,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[247] || (_cache[247] = $event => (_ctx.connModal=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: _ctx.busy.conn,
                onClick: _cache[248] || (_cache[248] = (...args) => (_ctx.saveConn && _ctx.saveConn(...args)))
              }, _toDisplayString(_ctx.t('Save')), 9 /* TEXT, PROPS */, _hoisted_791)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" ============ device drawer ============ "),
    (_ctx.selected)
      ? (_openBlock(), _createElementBlock("div", {
          key: 6,
          class: "drawer-backdrop",
          onClick: _cache[262] || (_cache[262] = _withModifiers($event => (_ctx.selected=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_792, [
            _createElementVNode("div", _hoisted_793, [
              _createElementVNode("span", _hoisted_794, _toDisplayString(_ctx.icon(_ctx.selected)), 1 /* TEXT */),
              _createElementVNode("div", null, [
                _withDirectives(_createElementVNode("input", {
                  class: "dev-name",
                  "onUpdate:modelValue": _cache[250] || (_cache[250] = $event => ((_ctx.editLabel) = $event)),
                  placeholder: _ctx.selected.hostname || _ctx.selected.ip,
                  readonly: !_ctx.allowed('scan')
                }, null, 8 /* PROPS */, _hoisted_795), [
                  [_vModelText, _ctx.editLabel]
                ]),
                _createElementVNode("div", _hoisted_796, _toDisplayString(_ctx.selected.ip) + " · " + _toDisplayString(_ctx.selected.mac || _ctx.t('no MAC')), 1 /* TEXT */)
              ]),
              _hoisted_797,
              _createElementVNode("button", {
                class: "btn xs",
                onClick: _cache[251] || (_cache[251] = $event => (_ctx.selected=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_798, [
              _createElementVNode("div", _hoisted_799, [
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Vendor')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.vendorText(_ctx.selected)), 1 /* TEXT */)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Reported name')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.selected.hostname || '—'), 1 /* TEXT */)
                ]),
                (_ctx.selected.workgroup)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_800, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Workgroup')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.workgroup), 1 /* TEXT */)
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
                            }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_801))
                          : (_ctx.portTool(_ctx.selected, p))
                            ? (_openBlock(), _createElementBlock("a", {
                                key: 1,
                                href: "#",
                                title: _ctx.portTool(_ctx.selected, p).title,
                                onClick: _withModifiers($event => (_ctx.openPortTool(_ctx.selected, p)), ["prevent"])
                              }, _toDisplayString(p), 9 /* TEXT, PROPS */, _hoisted_802))
                            : (_openBlock(), _createElementBlock("span", _hoisted_803, _toDisplayString(p), 1 /* TEXT */)),
                        (i < _ctx.selected.ports.length - 1)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_804, ", "))
                          : _createCommentVNode("v-if", true)
                      ], 64 /* STABLE_FRAGMENT */))
                    }), 128 /* KEYED_FRAGMENT */)),
                    (!_ctx.selected.ports.length)
                      ? (_openBlock(), _createElementBlock("span", _hoisted_805, "—"))
                      : _createCommentVNode("v-if", true)
                  ])
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Found by')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.selected.sources.join(', ')), 1 /* TEXT */)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('First seen')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.stamp(_ctx.selected.firstSeen)), 1 /* TEXT */)
                ]),
                _createElementVNode("div", null, [
                  _createElementVNode("span", null, _toDisplayString(_ctx.t('Last seen')), 1 /* TEXT */),
                  _createElementVNode("code", null, _toDisplayString(_ctx.stamp(_ctx.selected.lastSeen)), 1 /* TEXT */)
                ]),
                (_ctx.selected.extra && _ctx.selected.extra.mdns)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_806, [
                      _hoisted_807,
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.extra.mdns), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.extra && _ctx.selected.extra.rdns)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_808, [
                      _createElementVNode("span", null, _toDisplayString(_ctx.t('Reverse DNS')), 1 /* TEXT */),
                      _createElementVNode("code", null, _toDisplayString(_ctx.selected.extra.rdns), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.extra && _ctx.selected.extra.ssdp)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_809, [
                      _hoisted_810,
                      _createElementVNode("code", _hoisted_811, _toDisplayString(_ctx.selected.extra.ssdp), 1 /* TEXT */)
                    ]))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("label", _hoisted_812, [
                      _createElementVNode("span", _hoisted_813, _toDisplayString(_ctx.t('Type')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("select", {
                        "onUpdate:modelValue": _cache[252] || (_cache[252] = $event => ((_ctx.editType) = $event))
                      }, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.typeLabels, (l, k) => {
                          return (_openBlock(), _createElementBlock("option", {
                            key: k,
                            value: k
                          }, _toDisplayString(_ctx.t(l)), 9 /* TEXT, PROPS */, _hoisted_814))
                        }), 128 /* KEYED_FRAGMENT */))
                      ], 512 /* NEED_PATCH */), [
                        [_vModelSelect, _ctx.editType]
                      ])
                    ]),
                    _createElementVNode("label", _hoisted_815, [
                      _createElementVNode("span", _hoisted_816, _toDisplayString(_ctx.t('Tags')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("input", {
                        "onUpdate:modelValue": _cache[253] || (_cache[253] = $event => ((_ctx.editTags) = $event)),
                        placeholder: _ctx.t('office, 2F, spare')
                      }, null, 8 /* PROPS */, _hoisted_817), [
                        [_vModelText, _ctx.editTags]
                      ])
                    ]),
                    _createElementVNode("label", _hoisted_818, [
                      _createElementVNode("span", _hoisted_819, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                      _withDirectives(_createElementVNode("textarea", {
                        "onUpdate:modelValue": _cache[254] || (_cache[254] = $event => ((_ctx.editNotes) = $event)),
                        rows: "3"
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelText, _ctx.editNotes]
                      ])
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : (_ctx.selected.tags.length || _ctx.selected.notes)
                  ? (_openBlock(), _createElementBlock("div", _hoisted_820, [
                      (_ctx.selected.tags.length)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_821, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Tags')), 1 /* TEXT */),
                            _createElementVNode("code", null, _toDisplayString(_ctx.selected.tags.join(', ')), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.selected.notes)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_822, [
                            _createElementVNode("span", null, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                            _createElementVNode("code", _hoisted_823, _toDisplayString(_ctx.selected.notes), 1 /* TEXT */)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ]))
                  : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_824, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.webLinks(_ctx.selected), (l) => {
                  return (_openBlock(), _createElementBlock(_Fragment, {
                    key: l.href
                  }, [
                    (_ctx.allowed('preview'))
                      ? (_openBlock(), _createElementBlock("button", {
                          key: 0,
                          class: "btn sm",
                          onClick: $event => (_ctx.openDeviceWindow(_ctx.selected, l.port))
                        }, "🖥 " + _toDisplayString(l.label), 9 /* TEXT, PROPS */, _hoisted_825))
                      : _createCommentVNode("v-if", true),
                    (_ctx.allowed('preview') && _ctx.status.preview)
                      ? (_openBlock(), _createElementBlock("button", {
                          key: 1,
                          class: "btn sm",
                          onClick: $event => (_ctx.showPage(l.href))
                        }, "🖼 " + _toDisplayString(_ctx.t('Show the page')), 9 /* TEXT, PROPS */, _hoisted_826))
                      : _createCommentVNode("v-if", true),
                    _createElementVNode("a", {
                      class: "btn sm",
                      href: l.href,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      title: _ctx.t('Only works from inside that network')
                    }, "↗", 8 /* PROPS */, _hoisted_827)
                  ], 64 /* STABLE_FRAGMENT */))
                }), 128 /* KEYED_FRAGMENT */)),
                (_ctx.allowed('ping'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 0,
                      class: "btn sm",
                      onClick: _cache[255] || (_cache[255] = $event => (_ctx.toolFor('ping')))
                    }, "📡 " + _toDisplayString(_ctx.t('Ping')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                (_ctx.allowed('ports'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 1,
                      class: "btn sm",
                      onClick: _cache[256] || (_cache[256] = $event => (_ctx.toolFor('ports')))
                    }, "🔌 " + _toDisplayString(_ctx.t('Ports')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                (_ctx.allowed('nmap') && _ctx.status.nmap && _ctx.status.nmap.available)
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 2,
                      class: "btn sm",
                      onClick: _cache[257] || (_cache[257] = $event => (_ctx.toolFor('nmap')))
                    }, "🗺️ nmap"))
                  : _createCommentVNode("v-if", true),
                (_ctx.selected.mac && _ctx.allowed('wol'))
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 3,
                      class: "btn sm",
                      onClick: _cache[258] || (_cache[258] = $event => (_ctx.wake(_ctx.selected)))
                    }, "⏻ " + _toDisplayString(_ctx.t('Wake on LAN')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true)
              ])
            ]),
            _createElementVNode("div", _hoisted_828, [
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger sm",
                    onClick: _cache[259] || (_cache[259] = $event => (_ctx.removeDevice(_ctx.selected)))
                  }, _toDisplayString(_ctx.t('Forget this device')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_829,
              _createElementVNode("button", {
                class: "btn sm",
                onClick: _cache[260] || (_cache[260] = $event => (_ctx.selected=null))
              }, _toDisplayString(_ctx.allowed('scan') ? _ctx.t('Cancel') : _ctx.t('Close')), 1 /* TEXT */),
              (_ctx.allowed('scan'))
                ? (_openBlock(), _createElementBlock("button", {
                    key: 1,
                    class: "btn primary",
                    onClick: _cache[261] || (_cache[261] = (...args) => (_ctx.saveDevice && _ctx.saveDevice(...args)))
                  }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true)
  ]))
}
})();

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
    render,
    data() {
      return {
        version: '', tab: 'devices', banner: null, authenticated: true,
        status: { canScan: false, canLookup: false, isAdmin: false, binaries: {}, nmap: { available: false }, ouiEntries: 0, targets: [] },
        settings: { language: 'auto', theme: 'auto', languages: [], tabOrder: [] },
        dragTab: '', overTab: '',
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
        sshAdhoc: { kind: 'ssh', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh' },
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
        smtpAdhoc: { kind: 'smtp', host: '', port: 587, mode: 'starttls', username: '', secret: '', from: '' },
        boxAdhoc: { kind: 'imap', host: '', port: 993, mode: 'tls', username: '', secret: '' },
        mailboxId: 0, mailboxResult: null,
        // file transfer
        filesConn: 0, filesPath: '', filesData: null, filesTarget: 'NetBase', filesSource: '', transferNote: '',
        adhocActive: false,
        adhoc: { kind: 'sftp', host: '', port: 22, username: '', secret: '', authType: 'password', privateKeyPath: '', passphrase: '', mode: 'ssh', passive: true, path: '' },
        // service probes
        sshHost: '', sshPort: 22, sshAuthMethods: false, sshResult: null, telnetResult: null,
        ntpHost: 'pool.ntp.org', ntpResult: null,
        locale: 0,
        picker: { open: false, title: '', path: '', parent: null, entries: [], foldersOnly: false, onPick: null },
        windows: [], windowSeq: 0, windowTop: 3000, drag: null,
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
        const allowed = TABS.filter((x) => can[x.id]);
        const order = this.settings.tabOrder || [];
        if (!order.length) return allowed;
        // Anything the saved order does not mention — a tool added since, or
        // one just granted — keeps its place at the end rather than vanishing.
        const placed = order.map((id) => allowed.find((x) => x.id === id)).filter(Boolean);
        return placed.concat(allowed.filter((x) => !order.includes(x.id)));
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
      // ---- device windows: the page comes through this server, so it works
      // from outside the LAN and several can be open at once ----
      async openDeviceWindow(device, port) {
        const scheme = WEB_PORTS[port];
        if (!scheme || !device.ip) return;
        const host = device.ip.includes(':') ? '[' + device.ip + ']' : device.ip;
        const base = scheme + '://' + host + (port === 80 || port === 443 ? '' : ':' + port);
        const offset = (this.windows.length % 6) * 28;
        const w = {
          id: ++this.windowSeq, base, url: '', src: '', error: '', busy: true, full: false,
          framed: false, trusted: false, here: '', trail: [], trailAt: -1, rewinding: false, z: ++this.windowTop,
          title: (device.name || device.ip) + ' · ' + port,
          x: Math.max(20, Math.round(window.innerWidth / 2 - 520) + offset),
          y: 90 + offset, w: Math.min(1040, window.innerWidth - 60), h: Math.min(700, window.innerHeight - 140),
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
      focusWindow(w) { w.z = ++this.windowTop; },
      trustWindow(w) {
        if (!window.confirm(this.t('A page shown this way runs with the same rights as NetBase itself. Only do this for a device you trust.'))) return;
        w.trusted = true;
        w.framed = false;
        this.reloadWindow(w);
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
        if (data.netbase === 'frames' && !w.trusted) w.framed = true;
      },
      closeWindow(w) { this.windows = this.windows.filter((x) => x.id !== w.id); },
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
          return;
        }
        w.full = { x: w.x, y: w.y, w: w.w, h: w.h };
        Object.assign(w, { x: 12, y: 60, w: window.innerWidth - 24, h: window.innerHeight - 76 });
        this.focusWindow(w);
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
          this.drag = null;
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      },

      /** A device's own web interface, when the port says it has one. */
      /** The device's own address for a web port, whoever is asking. */
      webUrl(device, port) {
        const scheme = WEB_PORTS[port];
        if (!scheme || !device || !device.ip) return null;
        const host = device.ip.includes(':') ? '[' + device.ip + ']' : device.ip;
        return scheme + '://' + host + (port === 80 || port === 443 ? '' : ':' + port);
      },
      portLink(device, port) {
        // Without the right to open a device page, the number is just a number:
        // better plain text than a link that can only fail.
        const href = this.allowed('preview') ? this.webUrl(device, port) : null;
        if (!href) return null;
        return { href, title: T('Open {url} in a window, through this server', { url: href }) };
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

      openConsole() {
        const conn = this.connById(this.sshConn);
        if (!conn) { this.quickConsole(); return; }
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
        const body = { id: this.term.id, command, cwd: this.term.cwd, connection: this.term.id ? {} : { ...this.sshAdhoc } };
        const r = await this.guarded('term', () => api('ssh/shell', { method: 'POST', body: JSON.stringify(body) }));
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
      sshTarget(extra) { return { id: this.sshConn, connection: this.sshConn ? {} : { ...this.sshAdhoc }, ...extra }; },
      async runSshPreset() { this.sshRunResult = await this.guarded('sshrun', () => api('ssh/preset', { method: 'POST', body: JSON.stringify(this.sshTarget({ preset: this.sshPreset })) })); },
      async runSshCommand() { this.sshRunResult = await this.guarded('sshrun', () => api('ssh/run', { method: 'POST', body: JSON.stringify(this.sshTarget({ command: this.sshCommand })) })); },
      /** Open the console straight from the typed details, without saving. */
      async quickConsole() {
        this.sshConn = 0;
        this.term = {
          open: true, id: 0, host: this.sshAdhoc.host, user: this.sshAdhoc.username,
          cwd: '', command: '', lines: [], history: [], at: -1,
        };
        this.$nextTick(() => this.$refs.termInput && this.$refs.termInput.focus());
      },
      saveSshAdhoc() {
        this.openConn(null, 'ssh');
        this.connForm = { ...this.connForm, ...this.sshAdhoc, id: 0, name: this.sshAdhoc.host, privateKey: '' };
      },

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
      window.removeEventListener('message', this.onWindowMessage);
    },
    mounted() {
      rootProxy = this;
      window.addEventListener('message', this.onWindowMessage);
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
