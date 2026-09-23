/**
 * 回执与冻结：交付契约里「冻结」这一步的可执行形式。
 *
 * 以前它只是 SKILL.md 里的一句散文 —— 没有任何东西记录
 * 「这个产物是在什么状态下通过校验的」，产物被改过也没人知道。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, CHECK, EXAMPLES, runCheck } from './helpers.mjs';

/** 复制一份干净示例到临时目录，避免污染仓库里的产物 */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-receipt-'));
  const file = path.join(dir, 'candidate.html');
  fs.copyFileSync(path.join(EXAMPLES, 'diagram-architecture', 'index.html'), file);
  return file;
}

const freeze = (file) => spawnSync(process.execPath, [CHECK, file, '--freeze', '--json'], { encoding: 'utf8' });

test('--freeze 写出回执，且哈希与产物一致', () => {
  const file = scratch();
  const r = freeze(file);
  assert.equal(r.status, 0, '干净产物应当冻结成功');

  const receipt = path.join(file + '.receipt.json');
  assert.ok(fs.existsSync(receipt), '没有写出回执文件');

  const data = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.match(data.sha256, /^[0-9a-f]{64}$/, 'sha256 格式不对');
  assert.match(data.modelSha256, /^[0-9a-f]{64}$/, 'modelSha256 格式不对');
  assert.equal(data.errors, 0);
  assert.ok(data.frozenAt, '缺少冻结时间');
});

test('冻结后未改动：复检不报警，且报告里带 frozen 状态', () => {
  const file = scratch();
  freeze(file);
  const { report } = runCheck(file);
  assert.equal(report.summary.warnings, 0, '未改动的产物不该有警告');
  assert.equal(report.frozen && report.frozen.ok, true, '报告里应带 frozen.ok');
});

test('冻结后改动产物：复检必须报 receipt/artifact-modified', () => {
  const file = scratch();
  freeze(file);
  fs.appendFileSync(file, '\n<!-- 冻结之后又改了一行 -->\n');
  const { report, codes } = (() => {
    const o = runCheck(file);
    return { report: o.report, codes: o.report.diagnostics.map(d => d.code) };
  })();
  assert.ok(codes.includes('receipt/artifact-modified'),
    `期望报出 receipt/artifact-modified，实际：[${[...new Set(codes)].join(', ')}]`);
  assert.equal(report.summary.errors, 0, '这是 warning，不该变成 error');
});

test('有 error 的产物拒绝冻结 —— 不给坏产物盖章', () => {
  const file = scratch();
  const broken = fs.readFileSync(file, 'utf8').replace('<html lang="zh-CN"', '<html');
  fs.writeFileSync(file, broken);
  const r = freeze(file);
  assert.equal(r.status, 1, '有 error 时退出码应为 1');
  assert.ok(!fs.existsSync(file + '.receipt.json'), '有 error 却写出了回执');
  assert.match(r.stdout, /refused/, '回执里应标明拒绝冻结');
});

test('报告始终带产物与模型的哈希', () => {
  const { report } = runCheck(path.join(EXAMPLES, 'diagram-architecture', 'index.html'));
  assert.match(report.artifact.sha256, /^[0-9a-f]{64}$/);
  assert.ok(report.artifact.bytes > 0);
  assert.match(report.model.sha256, /^[0-9a-f]{64}$/);
});

test('回执不进技能目录哈希（证据不属于技能内容）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/sync.mjs'), 'utf8');
  assert.match(src, /receipt\\?\.json/, 'sync.mjs 的 HASH_EXCLUDE 应排除回执');
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /\*\.receipt\.json/, '.gitignore 应忽略回执');
});
