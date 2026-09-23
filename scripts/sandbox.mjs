#!/usr/bin/env node
/**
 * 布局沙箱 —— 把运行时里 DOM-free 的部分抽出来，在 Node 里直接执行。
 *
 * 这是整套几何验证的地基：check.mjs 用它跑真正的 Craft.layout / Craft.route，
 * 对自动布局算出的坐标做机械断言；测试也用它做确定性回归。
 *
 * 抽成独立模块是为了让 check.mjs 与 test/ 共用同一份实现 ——
 * 各写一份的话，两边迟早会沙箱化出不同的运行时子集，验证结果就不可比了。
 */

import fs from 'node:fs';

/**
 * 从产物（或 assets/template.html）里抽出所有 `<script data-craft-owned>` 区块，
 * 在无 DOM 的桩环境里执行，拿回 `window.Craft`。
 *
 * 返回：
 *   Craft 对象   —— 正常
 *   null         —— 没有任何 owned 区块（不是产物）
 *   {__error}    —— 运行时在桩环境里抛错（说明它依赖了 DOM）
 */
export function makeLayoutSandbox(src) {
  const blocks = [...src.matchAll(/<script data-craft-owned>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) return null;
  const code = blocks.join('\n');

  const noop = () => {};
  const stubEl = () => ({
    style: { setProperty: noop }, setAttribute: noop, getAttribute: () => null,
    appendChild: noop, addEventListener: noop, querySelector: () => null,
    querySelectorAll: () => [], classList: { add: noop }
  });
  const fakeDocument = {
    readyState: 'loading',
    documentElement: { getAttribute: () => 'dark', setAttribute: noop, dispatchEvent: noop },
    body: { getAttribute: () => null, setAttribute: noop, appendChild: noop },
    addEventListener: noop, createElement: stubEl, createElementNS: stubEl,
    querySelector: () => null, querySelectorAll: () => [], dispatchEvent: noop
  };
  const fakeWindow = { matchMedia: () => ({ matches: false }), addEventListener: noop };

  try {
    const factory = new Function(
      'document', 'window', 'getComputedStyle', 'requestAnimationFrame',
      'CustomEvent', 'localStorage',
      code + '\nreturn window.Craft;'
    );
    const craft = factory(
      fakeDocument, fakeWindow,
      () => ({ getPropertyValue: () => '' }),
      (fn) => setTimeout(fn, 0),
      class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
      { getItem: () => null, setItem: noop }
    );
    return craft && craft.layout ? craft : null;
  } catch (err) {
    return { __error: String(err && err.message || err) };
  }
}

/** 从文件读并沙箱化。文件不存在时返回 null。 */
export function sandboxFile(file) {
  if (!fs.existsSync(file)) return null;
  return makeLayoutSandbox(fs.readFileSync(file, 'utf8'));
}

/** 产物里的所有 JSON 模型块（key + 解析结果 + 位置）。解析失败的会被跳过。 */
export function artifactModels(src) {
  const out = [];
  const re = /<script[^>]*type="application\/json"[^>]*data-craft-data="([^"]*)"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src))) {
    let data = null;
    try { data = JSON.parse(m[2]); } catch (_) { continue; }
    out.push({ key: m[1], data, index: m.index });
  }
  return out;
}
