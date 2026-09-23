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
