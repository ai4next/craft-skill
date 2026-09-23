/**
 * 测试共用的工具。
 *
 * 反向夹具的做法是「拿一个真示例，按需做坏」，而不是把坏产物提交进仓库 ——
 * 产物里内嵌着整个运行时，模板一改就会过期（artifact/runtime-stale），
 * 提交的坏产物会集体失效。现做现坏则永远与当前模板同步。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHECK = path.join(ROOT, 'scripts/check.mjs');
export const EXAMPLES = path.join(ROOT, 'examples');

let tmpRoot = null;

/** 临时目录，进程退出时清理。 */
export function tmpDir() {
  if (!tmpRoot) {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-test-'));
    process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {} });
  }
  return tmpRoot;
}

export function readExample(type) {
  return fs.readFileSync(path.join(EXAMPLES, type, 'index.html'), 'utf8');
}

/** 跑 check.mjs，返回 { status, report }。非零退出不抛错 —— 那正是我们要断言的东西。 */
export function runCheck(file, args = []) {
  const r = spawnSync(process.execPath, [CHECK, file, '--json', ...args], { encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch (_) {}
  return { status: r.status, report, stderr: r.stderr };
}

/** 把改写过的 HTML 写到临时文件并检查，返回 { status, report, codes }。 */
export function checkMutated(html, name = 'candidate') {
  const file = path.join(tmpDir(), `${name}-${Math.random().toString(36).slice(2, 8)}.html`);
  fs.writeFileSync(file, html);
  const out = runCheck(file);
  return {
    ...out,
    codes: (out.report && out.report.diagnostics || []).map(d => d.code)
  };
}

/** 取出产物里第一个 JSON 模型块，交给 fn 改写后再写回。 */
export function mutateModel(html, fn) {
  const re = /(<script[^>]*type="application\/json"[^>]*data-craft-data="[^"]*"[^>]*>)([\s\S]*?)(<\/script>)/;
  const m = html.match(re);
  if (!m) throw new Error('产物里找不到 JSON 模型块');
  const model = JSON.parse(m[2]);
  const next = fn(model) || model;
  return html.replace(re, (_, open, __, close) => open + '\n' + JSON.stringify(next, null, 2) + '\n' + close);
}

const SLOT_NAMES = ['HEAD', 'BODY', 'DATA', 'SCRIPT'];

/** 把 examples/<类型>/skeleton.html 的四段骨架按 sync.mjs 的规则组装成完整产物。
    骨架是「往四个哨兵槽里写什么」的示范，模型会照抄 —— 所以它自己必须先过门禁。
    槽位填充一律用函数形式的 replacer：字符串形式会把内容里的 $$ / $& / $1
    当成替换模式解释，静默改写作者代码。 */
export function assembleSkeleton(type) {
  const src = fs.readFileSync(path.join(EXAMPLES, type, 'skeleton.html'), 'utf8');

  const marks = SLOT_NAMES.map(n => {
    const marker = `<!-- ═══════════ 替换 ${n}_SLOT ═══════════ -->`;
    const i = src.indexOf(marker);
    if (i < 0) throw new Error(`${type}/skeleton.html 找不到 ${n}_SLOT 标记`);
    return { n, i, len: marker.length };
  });

  const slots = {};
  marks.forEach((mk, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].i : src.length;
    slots[mk.n] = src.slice(mk.i + mk.len, end).trim();
  });

  const fill = (s, marker, content) => {
    const out = s.replace(marker, () => content);
    if (content && !out.includes(content)) throw new Error(`槽位 ${marker} 填充后内容不一致`);
    return out;
  };

  let out = fs.readFileSync(path.join(ROOT, 'assets', 'template.html'), 'utf8');
  out = fill(out, '<!-- CRAFT:HEAD_SLOT -->', slots.HEAD);
  out = fill(out, '<!-- CRAFT:BODY_SLOT -->', slots.BODY);
  /* 模板 body 上的 data-craft-type 默认是 chart，按示例目录名改正 */
  const bodyType = type.startsWith('diagram') ? 'diagram' : type;
  out = out.replace(/(<body[^>]*\bdata-craft-type=")[^"]*(")/, (_, a, b) => a + bodyType + b);
  out = fill(out, '<!-- CRAFT:DATA_SLOT -->', slots.DATA);
  out = fill(out, '<!-- CRAFT:SCRIPT_SLOT -->', slots.SCRIPT);
  return out;
}
