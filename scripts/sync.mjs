#!/usr/bin/env node
/**
 * 把派生产物重新同步到源。
 *
 *   node scripts/sync.mjs            # 重新生成镜像与示例
 *   node scripts/sync.mjs --check    # 只检查是否同步，不写入（CI / check.mjs --mirror 用）
 *
 * 两件事：
 *   1. 用根目录的 SKILL.md / references 覆盖 .agents/skills/craft/ 镜像
 *      （agentskills.io 约定要求镜像，但手抄两份必然漂移）
 *   2. 用 assets/template.html + examples/<类型>/slots/ + data.json
 *      重新组装 examples/<类型>/index.html
 *
 * 幂等：内容没变就不写盘。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MIRRORS, mirrorFiles, exampleTypes } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const MIRROR_FILES = mirrorFiles(ROOT);

const SLOT_MARKERS = {
  head: '<!-- CRAFT:HEAD_SLOT -->',
  body: '<!-- CRAFT:BODY_SLOT -->',
  data: '<!-- CRAFT:DATA_SLOT -->',
  script: '<!-- CRAFT:SCRIPT_SLOT -->'
};

const checkOnly = process.argv.includes('--check');
let written = 0, stale = 0, skipped = 0;

/** 示例目录名 → body 的 data-craft-type。 */
function typeForExample(name) {
  if (name === 'explainer' || name === 'simulation' || name === 'chart') return name;
  if (name.startsWith('diagram')) return 'diagram';
  return 'chart';
}

function report(rel, kind) {
  if (kind === 'stale') { stale++; console.log(`  过期  ${rel}`); }
  else if (kind === 'written') { written++; console.log(`  写入  ${rel}`); }
  else skipped++;
}

/** 内容相同就不写盘，保证幂等 */
function writeIfChanged(abs, content, rel) {
  const exists = fs.existsSync(abs);
  if (exists && fs.readFileSync(abs, 'utf8') === content) { report(rel, 'same'); return; }
  if (checkOnly) { report(rel, 'stale'); return; }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  report(rel, 'written');
}

console.log('── 同步技能镜像 ──');
for (const mirror of MIRRORS) {
  console.log(`  ${mirror}/`);
  for (const rel of MIRROR_FILES) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { console.log(`    跳过  ${rel}（源文件不存在）`); continue; }
    writeIfChanged(path.join(ROOT, mirror, rel), fs.readFileSync(src, 'utf8'), `${mirror}/${rel}`);
  }
}

/**
 * 技能目录哈希 —— 复刻 `skills` CLI 的 computeSkillFolderHash：
 * 递归收集文件（跳过 .git / node_modules），按相对路径 localeCompare 排序，
 * 依次把「相对路径 + 内容」喂进 sha256。
 *
 * 两处有意的偏离：
 *   1. 排除 skills-lock.json 自身。CLI 把 computedHash 写进**使用者项目**的锁文件，
 *      对它而言不存在自指问题；但本仓库把锁文件提交在自己根目录里，若把它算进去，
 *      哈希会随自己的值变化，永远无法自洽。
 *   2. 排除证据产物（*.shot.png / *.shot.json / *.receipt.json）。它们属于某一次交付，
 *      不属于技能内容，算进去会让哈希随手删几张图、冻结一次产物就变。
 */
const HASH_EXCLUDE = [/^skills-lock\.json$/, /\.shot\.(png|json)$/, /\.receipt\.json$/];

function computeSkillFolderHash(root) {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !HASH_EXCLUDE.some(re => re.test(rel))) files.push({ rel, full });
    }
  })(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f.rel);
    hash.update(fs.readFileSync(f.full));
  }
  return hash.digest('hex');
}

console.log('\n── 重新组装示例产物 ──');
const templatePath = path.join(ROOT, 'assets/template.html');
if (!fs.existsSync(templatePath)) {
  console.log('  跳过：assets/template.html 不存在');
} else {
  const template = fs.readFileSync(templatePath, 'utf8');
  for (const type of exampleTypes(ROOT)) {
    const dir = path.join(ROOT, 'examples', type);
    const slotsDir = path.join(dir, 'slots');
    if (!fs.existsSync(slotsDir)) { console.log(`  跳过  examples/${type}/（无 slots/ 目录）`); continue; }

    const readSlot = name => {
      const p = path.join(slotsDir, name + '.html');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
    };

    /* 必须用函数形式的 replacer：字符串形式的替换串会把内容里的
       $$ / $& / $` / $' / $1 当成替换模式解释，静默改写作者代码。
       填完还要回验内容确实原样进了产物 —— 这类静默改写不报错，只会让产物悄悄坏掉。 */
    const fill = (src, marker, content) => {
      const filled = src.replace(marker, () => content);
      if (content && !filled.includes(content)) {
        throw new Error(`槽位 ${marker} 填充后内容不一致 —— 检查内容里是否含 $ 序列`);
      }
      return filled;
    };

    let out = template;
    out = fill(out, SLOT_MARKERS.head, readSlot('head'));
    out = fill(out, SLOT_MARKERS.body, readSlot('body'));
    /* body 上的 data-craft-type 决定产物的类型声明。
       模板默认写的是 chart，图解示例照抄就成了「声明是图表、内容是图解」——
       契约里对不上，以前也没有任何规则拦它。这里按示例目录名自动改正。 */
    out = out.replace(/(<body[^>]*\bdata-craft-type=")[^"]*(")/, (_, a, b) => a + typeForExample(type) + b);

    const dataPath = path.join(dir, 'data.json');
    const dataSlot = fs.existsSync(dataPath)
      ? `<script type="application/json" data-craft-data="main">\n${fs.readFileSync(dataPath, 'utf8').trim()}\n</script>`
      : readSlot('data');
    out = fill(out, SLOT_MARKERS.data, dataSlot);
    out = fill(out, SLOT_MARKERS.script, readSlot('script'));

    writeIfChanged(path.join(dir, 'index.html'), out, `examples/${type}/index.html`);
  }
}

/* 锁哈希必须在所有派生文件都生成之后再算，否则它自己就过期 */
console.log('── 同步 skills-lock.json ──');
{
  const lockPath = path.join(ROOT, 'skills-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.log('  跳过  skills-lock.json（不存在）');
  } else {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const name = Object.keys(lock.skills || {})[0];
    if (!name) {
      console.log('  跳过  skills-lock.json（skills 为空）');
    } else {
      const hash = computeSkillFolderHash(ROOT);
      if (lock.skills[name].computedHash === hash) {
        report('skills-lock.json', 'same');
      } else if (checkOnly) {
        report('skills-lock.json', 'stale');
      } else {
        lock.skills[name].computedHash = hash;
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
        report('skills-lock.json', 'written');
      }
    }
  }
}

console.log('');
if (checkOnly) {
  console.log(stale ? `✗ ${stale} 个文件与源不一致 —— 运行 node scripts/sync.mjs 修复` : '✓ 全部已同步');
  process.exit(stale ? 1 : 0);
}
console.log(`✓ 写入 ${written} 个，已是最新 ${skipped} 个`);
