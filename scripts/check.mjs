#!/usr/bin/env node
/**
 * craft-skill 交付门禁。
 *
 *   node scripts/check.mjs <产物.html> [--json] [--mirror]
 *
 * 只读：从不修改产物，也从不自动修复。
 * 退出码 0 = 零 error（warning 允许并报告）／1 = ≥1 error／2 = 用法或读取错误。
 *
 * 规则的权威定义在 references/authoring-contract.md。两边必须同步演进。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MIRRORS, mirrorFiles } from './manifest.mjs';
import { makeLayoutSandbox } from './sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..');

const TYPE_ENUM = ['chart', 'explainer', 'diagram', 'simulation'];
const CHART_TYPE_ENUM = ['line', 'area', 'bar', 'stacked-bar', 'scatter', 'heatmap', 'sparkline', 'custom'];

const SIZE_WARN = 320 * 1024;
const SIZE_ERROR = 400 * 1024;
const DATA_WARN = 120 * 1024;
const DOM_NODE_WARN = 4000;

/* 图解子类型与各类型的节点种类 */
const DIAGRAM_SUBTYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'freeform'];
/* 运行时的 normDirection 会把其余取值静默当成 TB —— 拼错必须拦下 */
const DIRECTIONS = ['TB', 'LR', 'BT', 'RL'];
const NODE_KINDS = {
  architecture: ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'],
  workflow: ['start', 'end', 'task', 'decision', 'io'],
  lifecycle: ['normal', 'failure', 'terminal'],
  dataflow: ['source', 'transform', 'store', 'consumer'],
  sequence: ['participant'],
  freeform: ['default']
};
/* 各子类型必需的非节点/边字段 */
const SUBTYPE_REQUIRES = {
  architecture: [],
  workflow: ['lanes'],
  sequence: ['participants'],
  dataflow: ['stages'],
  lifecycle: ['phases'],
  freeform: []
};
const LABEL_MAX = { node: 18, sublabel: 24, edge: 12, group: 12 };   // 汉字数
const MODEL_NODE_WARN = 60;
const MODEL_EDGE_WARN = 90;
const RUNTIME_SHARE_WARN = 0.75;   // 运行时占产物体积的比例

const MIRROR_FILES = mirrorFiles(SKILL_ROOT);
const MIRROR_DIRS = MIRRORS;

/* ── 诊断收集 ─────────────────────────────────────────── */

function makeReport(file) {
  return { ok: true, file, summary: { errors: 0, warnings: 0 }, diagnostics: [] };
}

function addDiag(report, src, { code, severity, message, index = 0, evidence = {}, supportedFixes = [] }) {
  const pos = lineCol(src, index);
  report.diagnostics.push({
    code,
    severity,
    message,
    subject: { line: pos.line, col: pos.col, snippet: snippetAt(src, index) },
    evidence,
    supportedFixes
  });
  if (severity === 'error') report.summary.errors++;
  else report.summary.warnings++;
}

function lineCol(src, index) {
  let line = 1, col = 1;
  const stop = Math.min(index, src.length);
  for (let i = 0; i < stop; i++) {
    if (src.charCodeAt(i) === 10) { line++; col = 1; } else col++;
  }
  return { line, col };
}

function snippetAt(src, index, width = 88) {
  const start = src.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  let end = src.indexOf('\n', index);
  if (end < 0) end = src.length;
  let line = src.slice(start, end);
  if (line.length > width) {
    const offset = index - start;
    const from = Math.max(0, offset - Math.floor(width / 2));
    line = (from > 0 ? '…' : '') + line.slice(from, from + width) + (from + width < line.length ? '…' : '');
  }
  return line.trim();
}

/* ── 区域切分 ─────────────────────────────────────────── */

/** 把文档切成 owned（模板自带）／json（数据块）／author（作者写的）三类区块。 */
function splitRegions(src) {
  const regions = [];
  const re = /<(style|script)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(src))) {
    const [full, tag, attrs] = m;
    const bodyStart = m.index + full.indexOf('>') + 1;
    const bodyEnd = m.index + full.length - (`</${tag}>`.length);
    const owned = /\bdata-craft-owned\b/i.test(attrs);
    const isJson = /\btype\s*=\s*["']application\/json["']/i.test(attrs);
    const dataKey = (attrs.match(/data-craft-data\s*=\s*["']([^"']*)["']/i) || [])[1];
    regions.push({
      tag, attrs, full, start: m.index, end: m.index + full.length,
      bodyStart, bodyEnd,
      body: src.slice(bodyStart, bodyEnd < bodyStart ? bodyStart : bodyEnd),
      kind: owned ? 'owned' : isJson ? 'json' : 'author',
      dataKey: dataKey || 'main'
    });
  }
  return regions;
}

/** 只取作者写的片段（排除模板自带的 data-craft-owned 运行时块）。
    有些规则必须只看作者写了什么 —— 运行时的文档注释里就写着
    `<div data-craft-chart="x" ...>` 这样的示例，整篇扫描会把注释当成真的图表声明，
    于是任何没有 main 数据块的产物都会被误报 contract/chart-fields。 */
function authorSegments(src, regions) {
  return complementOf(src, regions, ['owned']);
}

/** 取某些类别区块之外的全部文本片段。 */
function complementOf(src, regions, excludeKinds) {
  const drop = regions.filter(r => excludeKinds.includes(r.kind)).sort((a, b) => a.start - b.start);
  const out = [];
  let pos = 0;
  for (const r of drop) {
    if (r.start > pos) out.push({ start: pos, end: r.start, text: src.slice(pos, r.start) });
    pos = Math.max(pos, r.end);
  }
  if (pos < src.length) out.push({ start: pos, end: src.length, text: src.slice(pos) });
  return out;
}

/* ── 颜色工具 ─────────────────────────────────────────── */

function parseColor(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return p.slice(0, 3);
  }
  m = s.match(/^hsla?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    const h = parseFloat(p[0]) / 360, sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
    if ([h, sat, l].every(Number.isFinite)) return hslToRgb(h, sat, l);
  }
  return null;
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

function luminance([r, g, b]) {
  const ch = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ── 令牌解析 ─────────────────────────────────────────── */

/** 按出现顺序解析 --craft-*，后出现的覆盖先出现的（作者块可覆盖模板默认值）。 */
function resolveTokens(src, regions) {
  const tokens = {};
  const ordered = regions
    .filter(r => r.tag === 'style' && (r.kind === 'owned' || r.kind === 'author'))
    .sort((a, b) => a.start - b.start);
  const re = /(--craft-[a-z0-9-]+)\s*:\s*([^;}]+)/gi;
  for (const r of ordered) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(r.body))) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/* ── 规则 ─────────────────────────────────────────────── */

function ruleSize(report, src) {
  const bytes = Buffer.byteLength(src, 'utf8');
  if (bytes > SIZE_ERROR) {
    addDiag(report, src, {
      code: 'artifact/size-budget', severity: 'error',
      message: `产物 ${(bytes / 1024).toFixed(0)}KB，超过 ${SIZE_ERROR / 1024}KB 上限`,
      evidence: { bytes, limit: SIZE_ERROR },
      supportedFixes: ['降采样内联数据', '删掉未使用的系列或标注', '把重复的说明文字改成一处']
    });
  } else if (bytes > SIZE_WARN) {
    addDiag(report, src, {
      code: 'artifact/size-budget', severity: 'warning',
      message: `产物 ${(bytes / 1024).toFixed(0)}KB，接近 ${SIZE_ERROR / 1024}KB 上限`,
      evidence: { bytes, limit: SIZE_ERROR },
      supportedFixes: ['降采样内联数据', '聚合到更粗的时间粒度']
    });
  }
}

function ruleSentinels(report, src) {
  const marker = '<!-- CRAFT:';
  let idx = src.indexOf(marker);
  while (idx >= 0) {
    const name = src.slice(idx + marker.length, src.indexOf('-->', idx)).trim();
    addDiag(report, src, {
      code: 'artifact/sentinel-unfilled', severity: 'error', index: idx,
      message: `哨兵槽 ${name} 未填充`,
      evidence: { slot: name },
      supportedFixes: ['把该注释整块替换成你的内容', '没有内容可填就删掉整条注释']
    });
    idx = src.indexOf(marker, idx + marker.length);
  }
  const legacy = '__CRAFT_';
  const li = src.indexOf(legacy);
  if (li >= 0) {
    addDiag(report, src, {
      code: 'artifact/sentinel-unfilled', severity: 'error', index: li,
      message: '残留占位符 ' + legacy,
      evidence: {},
      supportedFixes: ['删掉该占位符']
    });
  }
}

function ruleExternalRefs(report, src, regions) {
  /* 资源加载算外链；<a href> 只是超链接，放行（打印样式还会把它展开） */
  const attrRe = /<(\w+)\b[^>]*?\b(src|href|data|poster)\s*=\s*["']([^"']*)["']/gi;
  let m;
  while ((m = attrRe.exec(src))) {
    const tag = m[1].toLowerCase();
    const value = m[3].trim();
    if (!/^(https?:)?\/\//i.test(value)) continue;
    if (tag === 'a') continue;
    addDiag(report, src, {
      code: 'artifact/no-external-ref', severity: 'error', index: m.index,
      message: `<${tag}> 引用了外部资源：${value.slice(0, 60)}`,
      evidence: { tag, attribute: m[2], url: value },
      supportedFixes: ['把该资源内联进产物', '图标改用内联 SVG', '字体改用系统字体栈 --craft-font-*']
    });
  }

  const inlinePatterns = [
    [/@import\s+(?:url\()?["']?(?:https?:)?\/\//gi, '@import 引入了外部样式表'],
    [/url\(\s*["']?(?:https?:)?\/\//gi, 'CSS url() 指向外部资源'],
    [/\bfetch\s*\(\s*["'`](?:https?:)?\/\//gi, 'fetch() 请求外部地址'],
    [/\bimport\s*\(\s*["'`](?:https?:)?\/\//gi, '动态 import() 加载外部模块'],
    [/new\s+Worker\s*\(\s*["'`](?:https?:)?\/\//gi, 'Worker 加载外部脚本'],
    [/new\s+XMLHttpRequest|\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*["'](?:https?:)?\/\//gi, 'XHR 请求外部地址']
  ];
  const scannable = complementOf(src, regions, ['json']);
  for (const region of scannable) {
    for (const [re, why] of inlinePatterns) {
      re.lastIndex = 0;
      let hit;
      while ((hit = re.exec(region.text))) {
        addDiag(report, src, {
          code: 'artifact/no-external-ref', severity: 'error', index: region.start + hit.index,
          message: why,
          evidence: { match: hit[0].slice(0, 60) },
          supportedFixes: ['内联该资源', '去掉这次网络请求']
        });
      }
    }
  }
}

function ruleHtmlShell(report, src) {
  const htmlTag = src.match(/<html\b[^>]*>/i);
  if (!htmlTag) {
    addDiag(report, src, {
      code: 'html/lang-missing', severity: 'error', index: 0,
      message: '缺少 <html> 标签',
      supportedFixes: ['补上 <html lang="zh-CN">']
    });
  } else if (!/\blang\s*=\s*["'][^"']+["']/i.test(htmlTag[0])) {
    addDiag(report, src, {
      code: 'html/lang-missing', severity: 'error', index: htmlTag.index,
      message: '<html> 缺少 lang 属性',
      evidence: { tag: htmlTag[0].slice(0, 80) },
      supportedFixes: ['加上 lang="zh-CN"（或内容实际使用的语言）']
    });
  }

  const title = src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!title || !title[1].trim()) {
    addDiag(report, src, {
      code: 'html/title-missing', severity: 'error', index: title ? title.index : 0,
      message: '<title> 缺失或为空',
      supportedFixes: ['在 HEAD_SLOT 里加一个有意义的 <title>']
    });
  }

  if (!/<meta\b[^>]*\bname\s*=\s*["']viewport["']/i.test(src)) {
    addDiag(report, src, {
      code: 'html/viewport-missing', severity: 'error', index: 0,
      message: '缺少 viewport meta',
      supportedFixes: ['加 <meta name="viewport" content="width=device-width, initial-scale=1">']
    });
  }
}

function ruleThemeSupport(report, src) {
  if (!src.includes('prefers-color-scheme')) {
    addDiag(report, src, {
      code: 'theme/prefers-color-scheme-missing', severity: 'warning', index: 0,
      message: '没有跟随系统主题的 prefers-color-scheme 处理',
      supportedFixes: ['保留模板自带的预绘制主题脚本与媒体查询']
    });
  }
}

/** 只在作者写的 <style> 块和 style="" 属性里找硬编码颜色。 */
function ruleHardcodedColors(report, src, regions) {
  const targets = [];
  for (const r of regions) {
    if (r.kind === 'author' && r.tag === 'style') targets.push({ start: r.bodyStart, text: r.body });
  }
  const styleAttrRe = /\bstyle\s*=\s*["']([^"']*)["']/gi;
  let m;
  const drop = regions.filter(r => r.kind === 'owned' || r.kind === 'json');
  while ((m = styleAttrRe.exec(src))) {
    const inOwned = drop.some(r => m.index >= r.start && m.index < r.end);
    if (inOwned) continue;
    targets.push({ start: m.index, text: m[1] });
  }

  const colorRe = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/g;
  for (const target of targets) {
    colorRe.lastIndex = 0;
    let hit;
    while ((hit = colorRe.exec(target.text))) {
      const at = target.start + hit.index;
      const abs = hit.index;
      /* 排除 CSS 选择器里的 #id：向前找到最近的 { } ; ，若下一个界定符是 { 说明这是选择器 */
      const before = target.text.lastIndexOf('{', abs);
      const nextBrace = target.text.indexOf('{', abs);
      const nextSemi = target.text.indexOf(';', abs);
      const nextClose = target.text.indexOf('}', abs);
      const nextBound = Math.min(
        nextBrace < 0 ? Infinity : nextBrace,
        nextSemi < 0 ? Infinity : nextSemi,
        nextClose < 0 ? Infinity : nextClose
      );
      if (nextBound === nextBrace) continue;            // 选择器，不是声明
      if (before > 0 && abs - before > 200) continue;   // 太远，不像声明上下文
      const token = hit[0].startsWith('#')
        ? hit[0]
        : hit[0].replace(/\s*\($/, '()');
      if (/#[0-9a-fA-F]{6,8}\b/i.test(token) || /^(rgb|hsl)/i.test(token)) {
        addDiag(report, src, {
          code: 'theme/hardcoded-color', severity: 'warning', index: at,
          message: `作者区出现硬编码颜色 ${token}，暗色主题下可能不可读`,
          evidence: { color: token },
          supportedFixes: ['改用 var(--craft-*) 令牌', '需要新色就加一个 --craft-* 令牌']
        });
      }
    }
  }
}

function ruleContrast(report, src, regions) {
  const tokens = resolveTokens(src, regions);
  const pairs = [
    ['--craft-text', '--craft-bg', 4.5, 'error', '正文'],
    ['--craft-muted', '--craft-bg', 4.5, 'error', '次级文字'],
    ['--craft-text', '--craft-surface', 4.5, 'error', '卡片正文'],
    ['--craft-accent', '--craft-bg', 3.0, 'warning', '强调色']
  ];
  for (const [fgName, bgName, min, severity, label] of pairs) {
    const fg = parseColor(tokens[fgName]);
    const bg = parseColor(tokens[bgName]);
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) {
      addDiag(report, src, {
        code: 'theme/contrast', severity, index: 0,
        message: `${label} ${fgName} 对 ${bgName} 的对比度只有 ${ratio.toFixed(2)}:1，低于 ${min}:1`,
        evidence: { fg: tokens[fgName], bg: tokens[bgName], ratio: +ratio.toFixed(2), required: min },
        supportedFixes: ['调深/调浅该令牌', '换用对比度更高的令牌']
      });
    }
  }
  for (let i = 0; i < 8; i++) {
    const name = `--craft-cat-${i}`;
    const c = parseColor(tokens[name]);
    const bg = parseColor(tokens['--craft-bg']);
    if (!c || !bg) continue;
    const ratio = contrastRatio(c, bg);
    if (ratio < 3) {
      addDiag(report, src, {
        code: 'theme/contrast', severity: 'warning', index: 0,
        message: `分类色 ${name} 对背景的对比度只有 ${ratio.toFixed(2)}:1，低于图形元素建议的 3:1`,
        evidence: { token: name, color: tokens[name], ratio: +ratio.toFixed(2), required: 3 },
        supportedFixes: ['换用更深的分类色', '同时用形状或图案区分系列（非颜色线索）']
      });
    }
  }
}

function ruleReducedMotion(report, src, regions) {
  const animates = /transition|animation|@keyframes|requestAnimationFrame|scrollIntoView|Craft\.animate/;
  const guarded = /prefers-reduced-motion|Craft\.animate|motionReduced/;
  for (const r of regions) {
    if (r.kind !== 'author') continue;
    if (!animates.test(r.body)) continue;
    if (guarded.test(r.body)) continue;
    const at = r.body.search(animates);
    addDiag(report, src, {
      code: 'a11y/reduced-motion-missing', severity: 'error', index: r.bodyStart + at,
      message: '作者区有动效代码，但没有 prefers-reduced-motion 守卫',
      evidence: { region: r.tag, excerpt: r.body.slice(Math.max(0, at - 30), at + 60).trim() },
      supportedFixes: ['改用 Craft.animate（它自带守卫）', '或加 @media (prefers-reduced-motion: reduce) 分支']
    });
  }
}

function ruleLabels(report, src) {
  const svgRe = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi;
  let m;
  while ((m = svgRe.exec(src))) {
    const attrs = m[1];
    const inner = m[2];
    const decorative = /\baria-hidden\s*=\s*["']true["']/i.test(attrs);
    const labelled = /\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(attrs) ||
      /<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i.test(inner);
    if (decorative || labelled) continue;
    addDiag(report, src, {
      code: 'a11y/label-missing', severity: 'error', index: m.index,
      message: '<svg> 既没有 aria-label/<title>，也没有标记为装饰性',
      evidence: { tag: m[0].slice(0, 80) },
      supportedFixes: ['有语义就加 role="img" + aria-label', '纯装饰就加 aria-hidden="true"']
    });
  }

  const imgRe = /<img\b([^>]*)>/gi;
  while ((m = imgRe.exec(src))) {
    if (/\balt\s*=/i.test(m[1])) continue;
    addDiag(report, src, {
      code: 'a11y/label-missing', severity: 'error', index: m.index,
      message: '<img> 缺少 alt',
      supportedFixes: ['加描述性的 alt', '纯装饰用 alt=""']
    });
  }
}

function ruleData(report, src, regions) {
  const jsonRegions = regions.filter(r => r.kind === 'json');
  const parsed = {};
  for (const r of jsonRegions) {
    const bytes = Buffer.byteLength(r.body, 'utf8');
    if (bytes > DATA_WARN) {
      addDiag(report, src, {
        code: 'data/size', severity: 'warning', index: r.bodyStart,
        message: `数据块 "${r.dataKey}" 有 ${(bytes / 1024).toFixed(0)}KB，偏大`,
        evidence: { key: r.dataKey, bytes },
        supportedFixes: ['聚合到周/月粒度', '降采样', '只保留图里真正用到的字段']
      });
    }
    try {
      parsed[r.dataKey] = JSON.parse(r.body);
    } catch (err) {
      const msg = String(err.message || err);
      let line = null, col = null, offset = 0;
      const lm = msg.match(/line (\d+) column (\d+)/i);
      if (lm) { line = +lm[1]; col = +lm[2]; }
      const pm = msg.match(/position (\d+)/i);
      if (pm) {
        offset = +pm[1];
        const pos = lineCol(r.body, offset);
        line = pos.line; col = pos.col;
      }
      const at = r.bodyStart + offset;
      addDiag(report, src, {
        code: 'data/json-invalid', severity: 'error', index: at,
        message: `数据块 "${r.dataKey}" 解析失败：${msg}`,
        evidence: { key: r.dataKey, line, col, parseError: msg },
        supportedFixes: ['按上面给出的行列位置修 JSON 语法', '检查末尾是否多/少了逗号', '确认字符串用了双引号']
      });
      parsed[r.dataKey] = null;
    }
  }

  /* 只看作者区：运行时块的文档注释里写着 data-craft-chart= 的示例。
     只有**声明式图表**才需要数据块 —— 契约里 chart 要求「属性组 + 数据块」，
     而 simulation 要求的是「data-craft-sim + 控件」，它自己算数据，不需要静态块。 */
  const authorSrc = authorSegments(src, regions).map(s => s.text).join('\n');
  const needsData = /data-craft-chart\s*=/.test(authorSrc);
  if (needsData && !jsonRegions.length) {
    addDiag(report, src, {
      code: 'data/json-missing', severity: 'error', index: 0,
      message: '页面里有图表/模拟，但找不到任何数据块',
      supportedFixes: ['加 <script type="application/json" data-craft-data="main">…</script>']
    });
  }

  return { jsonRegions, parsed };
}

function ruleType(report, src) {
  const bodyTag = src.match(/<body\b[^>]*>/i);
  const type = bodyTag ? (bodyTag[0].match(/data-craft-type\s*=\s*["']([^"']*)["']/i) || [])[1] : null;
  if (!type) {
    addDiag(report, src, {
      code: 'contract/type-unknown', severity: 'error', index: bodyTag ? bodyTag.index : 0,
      message: '<body> 缺少 data-craft-type',
      evidence: { found: null, allowed: TYPE_ENUM },
      supportedFixes: [`设为 ${TYPE_ENUM.join(' | ')} 之一`]
    });
    return null;
  }
  if (!TYPE_ENUM.includes(type)) {
    addDiag(report, src, {
      code: 'contract/type-unknown', severity: 'error', index: bodyTag.index,
      message: `data-craft-type="${type}" 不在允许的取值内`,
      evidence: { found: type, allowed: TYPE_ENUM },
      supportedFixes: [`改为 ${TYPE_ENUM.join(' | ')} 之一`]
    });
    return null;
  }
  return type;
}

/** 声明的类型必须和页面里实际写了什么对得上。
    以前只校验「拼写是不是四类之一」，于是「声明 chart、内容是图解」这种产物一路绿灯 ——
    六个图解示例自己就一直是这么错的。 */
function ruleTypeConsistency(report, src, regions, declared) {
  if (!declared) return;
  const authorSrc = authorSegments(src, regions).map(s => s.text).join('\n');
  const present = new Set();
  if (/data-craft-diagram\s*=/.test(authorSrc)) present.add('diagram');
  if (/data-craft-chart\s*=/.test(authorSrc)) present.add('chart');
  if (/data-craft-sim\s*=/.test(authorSrc)) present.add('simulation');
  if (/data-craft-step\s*=/.test(authorSrc)) present.add('explainer');
  if (!present.size || present.has(declared)) return;

  addDiag(report, src, {
    code: 'contract/type-mismatch', severity: 'error', index: 0,
    message: `<body> 声明 data-craft-type="${declared}"，但页面里写的是 ${[...present].join('、')}`,
    evidence: { declared, present: [...present] },
    supportedFixes: [`把 data-craft-type 改成 ${[...present][0]}`, '或改掉页面里与之不符的内容']
  });
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && typeof data === 'object') {
    for (const k of Object.keys(data)) if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function ruleChartContract(report, src, dataCtx, regions) {
  const tagRe = /<[a-zA-Z][^>]*\bdata-craft-chart\s*=\s*["'][^"']*["'][^>]*>/gi;
  /* 只在作者区找图表标签 —— 运行时的文档注释里就有 data-craft-chart 的示例 */
  for (const seg of authorSegments(src, regions)) {
    tagRe.lastIndex = 0;
    let m;
    while ((m = tagRe.exec(seg.text))) {
      const tag = m[0];
      const at = seg.start + m.index;
    const attr = name => (tag.match(new RegExp(`data-craft-${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1];
    const id = attr('chart');
    const kind = attr('chart-type');
    if (kind && !CHART_TYPE_ENUM.includes(kind)) {
      addDiag(report, src, {
        code: 'contract/chart-fields', severity: 'error', index: at,
        message: `图表 "${id}" 的 data-craft-chart-type="${kind}" 不是支持的取值`,
        evidence: { id, found: kind, allowed: CHART_TYPE_ENUM },
        supportedFixes: [`改为 ${CHART_TYPE_ENUM.join(' | ')} 之一`]
      });
    }
    const dataKey = attr('data') || 'main';
    const data = dataCtx.parsed[dataKey];
    if (data === undefined) {
      addDiag(report, src, {
        code: 'contract/chart-fields', severity: 'error', index: at,
        message: `图表 "${id}" 引用了不存在的数据块 "${dataKey}"`,
        evidence: { id, dataKey, available: Object.keys(dataCtx.parsed) },
        supportedFixes: ['把 data-craft-data 改成已有数据块的 key', '补上该数据块']
      });
      continue;
    }
    if (kind === 'custom') continue;
    const rows = rowsOf(data);
    if (!rows.length) continue;
    for (const field of ['x', 'y', 'series']) {
      const name = attr(field);
      if (!name) continue;
      const missing = rows.filter(r => !r || r[name] === undefined || r[name] === null).length;
      if (missing > 0) {
        addDiag(report, src, {
          code: 'contract/chart-fields', severity: 'error', index: at,
          message: `图表 "${id}" 的字段 "${name}" 在 ${missing}/${rows.length} 行里缺失`,
          evidence: { id, field: name, missing, total: rows.length, sampleKeys: Object.keys(rows[0] || {}) },
          supportedFixes: ['统一字段名（注意大小写与空格）', '补全这些行的数据', '把 data-craft-' + field + ' 改成实际字段名']
        });
      }
    }
  }
  }
}
function ruleStepSequence(report, src) {
  const re = /data-craft-step\s*=\s*["'](\d+)["']/gi;
  const found = [];
  let m;
  while ((m = re.exec(src))) found.push({ value: +m[1], index: m.index });
  if (!found.length) return;
  const sorted = found.map(f => f.value).sort((a, b) => a - b);
  const expected = sorted.map((_, i) => i);
  if (sorted.join(',') !== expected.join(',')) {
    addDiag(report, src, {
      code: 'contract/step-sequence', severity: 'warning', index: found[0].index,
      message: `步骤号不连续：实际 [${sorted.join(', ')}]，应为 [${expected.join(', ')}]`,
      evidence: { found: sorted, expected },
      supportedFixes: ['把 data-craft-step 重新编号为 0..n-1', '检查是否有重复的步骤号']
    });
  }
}

function extractStateKeys(text) {
  const keys = new Set();
  const re = /state\s*:\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, i = m.index + m[0].length - 1, end = -1;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = text.slice(m.index + m[0].length, end);
    let d = 0;
    const keyRe = /([A-Za-z_$][\w$]*)\s*:/g;
    let k;
    while ((k = keyRe.exec(body))) {
      const before = body.slice(0, k.index);
      d = (before.match(/[{[(]/g) || []).length - (before.match(/[}\])]/g) || []).length;
      if (d === 0) keys.add(k[1]);
    }
  }
  return keys;
}

function ruleControlBinding(report, src, regions) {
  const controlRe = /data-craft-control\s*=\s*["']([^"']+)["']/gi;
  const controls = [];
  let m;
  while ((m = controlRe.exec(src))) controls.push({ key: m[1], index: m.index });
  if (!controls.length) return;

  const authorText = regions.filter(r => r.kind === 'author').map(r => r.body).join('\n');
  if (!/\bCraft\.(bind|sim)\b|state\s*:/.test(authorText)) {
    addDiag(report, src, {
      code: 'contract/control-unbound', severity: 'warning', index: controls[0].index,
      message: `页面有 ${controls.length} 个控件，但作者区找不到 Craft.bind / Craft.sim 的 state 声明`,
      evidence: { controls: controls.map(c => c.key) },
      supportedFixes: ['用 Craft.bind(容器, {state: {...}, onChange}) 声明状态', '或 Craft.sim.define(id, {state: {...}})']
    });
    return;
  }

  const keys = extractStateKeys(authorText);
  if (!keys.size) {
    addDiag(report, src, {
      code: 'contract/control-unbound', severity: 'info', index: controls[0].index,
      message: 'state 声明存在但无法静态解析出键名，跳过绑定检查',
      evidence: { controls: controls.map(c => c.key) },
      supportedFixes: ['把 state 写成对象字面量，便于静态检查']
    });
    return;
  }

  for (const c of controls) {
    if (keys.has(c.key)) continue;
    addDiag(report, src, {
      code: 'contract/control-unbound', severity: 'warning', index: c.index,
      message: `控件键 "${c.key}" 不在 state 里`,
      evidence: { key: c.key, stateKeys: [...keys] },
      supportedFixes: [`在 state 里加上 ${c.key}`, '或把 data-craft-control 改成已有的键名']
    });
  }
}

function ruleDomBudget(report, src) {
  const count = (src.match(/<(?:path|rect|circle|line|polygon|polyline|text)\b/gi) || []).length;
  if (count > DOM_NODE_WARN) {
    addDiag(report, src, {
      code: 'perf/dom-node-budget', severity: 'warning', index: 0,
      message: `内联 SVG 元素约 ${count} 个，超过 ${DOM_NODE_WARN} 的预警线`,
      evidence: { count, limit: DOM_NODE_WARN },
      supportedFixes: ['聚合数据', '改用热力图表达密度', '抽样展示']
    });
  }
}

/**
 * 产物必须携带当前版本的运行时。
 * 同时抓住两件事：示例/产物过期，以及有人手改了 data-craft-owned 区块。
 */
function ruleRuntimeFreshness(report, src, regions) {
  const templatePath = path.join(SKILL_ROOT, 'assets', 'template.html');
  if (!fs.existsSync(templatePath)) return;
  const template = fs.readFileSync(templatePath, 'utf8');
  const expected = splitRegions(template).filter(r => r.kind === 'owned');
  const actual = regions.filter(r => r.kind === 'owned');
  if (!expected.length) return;

  if (actual.length !== expected.length) {
    addDiag(report, src, {
      code: 'artifact/runtime-stale', severity: 'error', index: 0,
      message: `产物有 ${actual.length} 个模板区块，当前模板有 ${expected.length} 个 —— 产物不是从当前模板生成的`,
      evidence: { found: actual.length, expected: expected.length },
      supportedFixes: ['重新从 assets/template.html 复制一份再填槽', '不要删除或手改 data-craft-owned 区块']
    });
    return;
  }

  for (let i = 0; i < expected.length; i++) {
    if (actual[i].body === expected[i].body) continue;
    const at = actual[i].bodyStart;
    addDiag(report, src, {
      code: 'artifact/runtime-stale', severity: 'error', index: at,
      message: `第 ${i + 1} 个 <${actual[i].tag} data-craft-owned> 区块与当前模板不一致`,
      evidence: {
        tag: actual[i].tag,
        hint: '运行时的行为以 assets/template.html 为准；手改它会让产物与文档描述脱节'
      },
      supportedFixes: [
        '从当前 assets/template.html 重新生成产物',
        '需要改运行时行为就改模板，不要只改产物'
      ]
    });
  }
}


/* ── 图解模型规则 ─────────────────────────────────────── */

/** 汉字按 1、拉丁按 0.5 计长度 —— 与 Craft.measure 的口径一致 */
function labelLen(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.codePointAt(0) > 0x2e80 ? 1 : 0.5;
  return n;
}

function collectDiagramModels(src, regions) {
  const out = [];
  /* 模型块：<script type="application/json" data-craft-data="..."> */
  for (const r of regions) {
    if (r.kind !== 'json') continue;
    try { out.push({ key: r.dataKey, data: JSON.parse(r.body), index: r.bodyStart }); }
    catch (_) { /* 解析失败由 data/json-invalid 报 */ }
  }
  return out;
}

function diagramContainers(src) {
  const out = [];
  const re = /<[a-zA-Z][^>]*\bdata-craft-diagram\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[0];
    out.push({
      index: m.index,
      subtype: m[1],
      modelKey: (tag.match(/data-craft-model\s*=\s*["']([^"']*)["']/i) || [])[1] || null,
      label: (tag.match(/data-craft-diagram-label\s*=\s*["']([^"']*)["']/i) || [])[1] || null
    });
  }
  return out;
}

function ruleDiagramModel(report, src, regions) {
  const containers = diagramContainers(src);
  const models = collectDiagramModels(src, regions);
  if (!containers.length) return models;

  for (const c of containers) {
    if (!DIAGRAM_SUBTYPES.includes(c.subtype)) {
      addDiag(report, src, {
        code: 'contract/diagram-subtype', severity: 'error', index: c.index,
        message: `data-craft-diagram="${c.subtype}" 不是支持的子类型`,
        evidence: { found: c.subtype, allowed: DIAGRAM_SUBTYPES },
        supportedFixes: [`改为 ${DIAGRAM_SUBTYPES.join(' | ')} 之一`]
      });
      continue;
    }
    if (!c.label) {
      addDiag(report, src, {
        code: 'a11y/diagram-name', severity: 'warning', index: c.index,
        message: '图解容器没有 data-craft-diagram-label，屏幕阅读器读不到图的用途',
        supportedFixes: ['加 data-craft-diagram-label="这张图在讲什么"']
      });
    }
    if (!c.modelKey) continue;

    const entry = models.find(m => m.key === c.modelKey);
    if (!entry) continue;      // 缺模型块由 data/json-missing 报
    const model = entry.data || {};
    const at = entry.index;
    const kind = model.kind || c.subtype;

    /* 必需字段 */
    const nodes = (model.nodes || model.steps || model.events || model.participants || []).slice();
    /* lifecycle 的终态是单独一段，但同样是节点，必须一起校验 */
    if (Array.isArray(model.outcomes)) {
      for (const o of model.outcomes) {
        if (o && o.id != null) nodes.push(Object.assign({}, o, { type: o.type || 'terminal' }));
      }
    }
    const edges = model.edges || model.transitions || model.flows || model.messages || [];
    const required = SUBTYPE_REQUIRES[c.subtype] || [];
    const missing = required.filter(f => !Array.isArray(model[f]) || !model[f].length);
    if (missing.length) {
      addDiag(report, src, {
        code: 'model/schema', severity: 'error', index: at,
        message: `${c.subtype} 缺少必需字段：${missing.join('、')}`,
        evidence: { subtype: c.subtype, missing },
        supportedFixes: [`补上 ${missing.join('、')}`]
      });
    }
    if (!nodes.length) {
      addDiag(report, src, {
        code: 'model/schema', severity: 'error', index: at,
        message: `${c.subtype} 没有任何节点`,
        supportedFixes: ['至少给出 2 个节点']
      });
    }

    /* id 唯一性 + 悬空边 */
    const ids = new Set();
    for (const n of nodes) {
      const id = n && n.id != null ? String(n.id) : null;
      if (!id) {
        addDiag(report, src, {
          code: 'model/schema', severity: 'error', index: at,
          message: '有节点缺少 id',
          evidence: { node: JSON.stringify(n).slice(0, 60) },
          supportedFixes: ['给每个节点一个唯一 id']
        });
        continue;
      }
      if (ids.has(id)) {
        addDiag(report, src, {
          code: 'model/duplicate-id', severity: 'error', index: at,
          message: `节点 id 重复：${id}`,
          evidence: { id },
          supportedFixes: ['改成唯一 id —— 重复 id 会让布局与交互都错乱']
        });
      }
      ids.add(id);
    }
    for (const e of edges) {
      if (!e) continue;
      const from = e.from != null ? String(e.from) : null;
      const to = e.to != null ? String(e.to) : null;
      if (from && !ids.has(from)) {
        addDiag(report, src, {
          code: 'model/dangling-edge', severity: 'error', index: at,
          message: `边的 from="${from}" 指向不存在的节点`,
          evidence: { from, available: [...ids].slice(0, 12) },
          supportedFixes: ['改成已存在的节点 id', '或补上这个节点']
        });
      }
      if (to && !ids.has(to)) {
        addDiag(report, src, {
          code: 'model/dangling-edge', severity: 'error', index: at,
          message: `边的 to="${to}" 指向不存在的节点`,
          evidence: { to, available: [...ids].slice(0, 12) },
          supportedFixes: ['改成已存在的节点 id', '或补上这个节点']
        });
      }
      if (from && to && from === to && c.subtype !== 'lifecycle') {
        addDiag(report, src, {
          code: 'model/self-loop', severity: 'warning', index: at,
          message: `节点 ${from} 有一条指向自己的边`,
          supportedFixes: ['删掉自环', '或确认这是有意为之（状态机的重试是允许的）']
        });
      }
    }

    /* 标签长度 —— 自动布局变丑的头号原因，且是运行时唯一修不了的 */
    for (const n of nodes) {
      if (!n || n.label == null) continue;
      const len = labelLen(n.label);
      if (len > LABEL_MAX.node) {
        addDiag(report, src, {
          code: 'model/label-budget', severity: 'warning', index: at,
          message: `节点 "${n.id}" 的标签有 ${len.toFixed(1)} 字，超过建议上限 ${LABEL_MAX.node}`,
          evidence: { id: n.id, label: n.label, length: +len.toFixed(1), limit: LABEL_MAX.node },
          supportedFixes: ['把标签缩短到 18 个汉字以内', '把细节移到 sublabel 或图注里']
        });
      }
      if (n.sublabel != null && labelLen(n.sublabel) > LABEL_MAX.sublabel) {
        addDiag(report, src, {
          code: 'model/label-budget', severity: 'warning', index: at,
          message: `节点 "${n.id}" 的副标题过长（${labelLen(n.sublabel).toFixed(1)} 字）`,
          evidence: { id: n.id, limit: LABEL_MAX.sublabel },
          supportedFixes: ['副标题控制在 24 字以内']
        });
      }
      if (n.kind && NODE_KINDS[c.subtype] && !NODE_KINDS[c.subtype].includes(n.kind)) {
        addDiag(report, src, {
          code: 'model/schema', severity: 'warning', index: at,
          message: `节点 "${n.id}" 的 kind="${n.kind}" 不属于 ${c.subtype}`,
          evidence: { id: n.id, kind: n.kind, allowed: NODE_KINDS[c.subtype] },
          supportedFixes: [`改为 ${NODE_KINDS[c.subtype].join(' | ')}`]
        });
      }
    }
    const labeled = edges.filter(e => e && e.label != null && String(e.label).trim()).length;
    /* 时序图的消息标签、状态机的转移标签都是主体内容，不适用密度限制 */
    if (!['sequence', 'lifecycle'].includes(c.subtype) &&
        edges.length >= 4 && labeled / edges.length > 0.6) {
      addDiag(report, src, {
        code: 'model/edge-label-density', severity: 'warning', index: at,
        message: `${labeled}/${edges.length} 条边带标签，超过六成时标签必然互相压叠`,
        evidence: { labeled, total: edges.length },
        supportedFixes: ['只给最关键的几条边留标签', '把其余关系写进图注']
      });
    }
    for (const e of edges) {
      if (e && e.label != null && labelLen(e.label) > LABEL_MAX.edge) {
        addDiag(report, src, {
          code: 'model/label-budget', severity: 'warning', index: at,
          message: `边的标签 "${e.label}" 过长（${labelLen(e.label).toFixed(1)} 字）`,
          evidence: { label: e.label, limit: LABEL_MAX.edge },
          supportedFixes: ['边标签控制在 12 字以内']
        });
      }
    }

    /* 规模 */
    if (nodes.length > MODEL_NODE_WARN) {
      addDiag(report, src, {
        code: 'model/node-budget', severity: 'warning', index: at,
        message: `模型有 ${nodes.length} 个节点，超过 ${MODEL_NODE_WARN} 的建议上限`,
        evidence: { nodes: nodes.length, limit: MODEL_NODE_WARN },
        supportedFixes: ['拆成多张图', '把次要节点收进分组或折叠']
      });
    }
    if (edges.length > MODEL_EDGE_WARN) {
      addDiag(report, src, {
        code: 'model/node-budget', severity: 'warning', index: at,
        message: `模型有 ${edges.length} 条边，超过 ${MODEL_EDGE_WARN} 的建议上限`,
        evidence: { edges: edges.length, limit: MODEL_EDGE_WARN },
        supportedFixes: ['砍掉低价值的关系', '拆图']
      });
    }

    /* 孤立节点 / 不可达 */
    const touched = new Set();
    for (const e of edges) {
      if (!e) continue;
      if (e.from != null) touched.add(String(e.from));
      if (e.to != null) touched.add(String(e.to));
    }
    for (const n of nodes) {
      if (!n || n.id == null) continue;
      const id = String(n.id);
      if (!touched.has(id) && !n.group && c.subtype !== 'freeform') {
        addDiag(report, src, {
          code: 'model/orphan-node', severity: 'warning', index: at,
          message: `节点 "${id}" 没有任何连接，也没归入分组`,
          evidence: { id },
          supportedFixes: ['给它加一条边', '或归入某个分组', '或删掉它']
        });
      }
    }

    /* DAG 成环（架构/流程/数据流不该有环；有环时布局会断环并画成虚线） */
    if (['architecture', 'workflow', 'dataflow'].includes(c.subtype)) {
      const succ = {};
      for (const id of ids) succ[id] = [];
      for (const e of edges) {
        if (!e || e.from == null || e.to == null) continue;
        if (e.kind === 'retry') continue;      // 显式声明的回退路径是有意的
        if (succ[String(e.from)]) succ[String(e.from)].push(String(e.to));
      }
      const color = {}, cycle = [];
      const visit = (start) => {
        const stack = [{ id: start, i: 0 }];
        color[start] = 1;
        while (stack.length) {
          const top = stack[stack.length - 1];
          const list = succ[top.id] || [];
          if (top.i >= list.length) { color[top.id] = 2; stack.pop(); continue; }
          const nx = list[top.i++];
          if (color[nx] === 1) { cycle.push(top.id + ' → ' + nx); }
          else if (!color[nx]) { color[nx] = 1; stack.push({ id: nx, i: 0 }); }
        }
      };
      for (const id of [...ids].sort()) if (!color[id]) visit(id);
      if (cycle.length) {
        addDiag(report, src, {
          code: 'model/cycle-in-dag', severity: 'warning', index: at,
          message: `${c.subtype} 里存在 ${cycle.length} 条回边，布局会断环并把它们画成虚线`,
          evidence: { cycles: cycle.slice(0, 5) },
          supportedFixes: ['确认这些回边是有意的', '若有意的可改用 lifecycle 子类型表达状态机']
        });
      }
    }

    /* sequence：消息两端必须是已声明的参与者 */
    if (c.subtype === 'sequence') {
      const parts = new Set((model.participants || []).map(p => p && p.id != null ? String(p.id) : ''));
      for (const msg of (model.messages || [])) {
        if (!msg) continue;
        for (const end of ['from', 'to']) {
          const v = msg[end] != null ? String(msg[end]) : null;
          if (v && !parts.has(v)) {
            addDiag(report, src, {
              code: 'model/sequence-order', severity: 'error', index: at,
              message: `消息的 ${end}="${v}" 不是已声明的参与者`,
              evidence: { end, value: v, participants: [...parts] },
              supportedFixes: ['把该 id 加进 participants', '或改成已有的参与者 id']
            });
          }
        }
      }
    }

    /* lifecycle：failure 必须能回到某个非终态，否则是个死胡同 */
    if (c.subtype === 'lifecycle') {
      const evs = model.events || [];
      const byId = {};
      for (const e of evs) if (e && e.id != null) byId[String(e.id)] = e;
      for (const e of evs) {
        if (!e || e.type !== 'failure') continue;
        const id = String(e.id);
        const back = (model.transitions || []).filter(t =>
          t && String(t.from) === id && byId[String(t.to)] && byId[String(t.to)].type !== 'terminal');
        if (!back.length) {
          addDiag(report, src, {
            code: 'model/lifecycle-terminal', severity: 'error', index: at,
            message: `可恢复状态 "${id}" 没有任何回到非终态的转移，读者会以为流程卡死了`,
            evidence: { state: id },
            supportedFixes: ['加一条从该状态回到活跃状态的转移', '若它本就是终态，把 type 改成 terminal']
          });
        }
      }
    }

    /* 视图引用的节点必须存在 */
    for (const v of (model.views || [])) {
      if (!v || !Array.isArray(v.focus)) continue;
      for (const f of v.focus) {
        if (!ids.has(String(f))) {
          addDiag(report, src, {
            code: 'deck/deeplink-target', severity: 'error', index: at,
            message: `视图 "${v.id}" 聚焦的节点 "${f}" 不存在`,
            evidence: { view: v.id, focus: String(f) },
            supportedFixes: ['改成已存在的节点 id', '或补上该节点']
          });
        }
      }
    }

    /* 作者指定 viewBox 只当裁剪，不会自动适配 */
    if (Array.isArray(model.viewBox) && model.viewBox.length >= 4) {
      addDiag(report, src, {
        code: 'model/viewbox-fit', severity: 'warning', index: at,
        message: 'meta.viewBox 是裁剪框，不会缩放内容去适配 —— 布局算出的尺寸可能被切掉',
        evidence: { viewBox: model.viewBox },
        supportedFixes: ['删掉 viewBox 让运行时按内容自适应']
      });
    }

    /* ── 跨引用 ──────────────────────────────────────────────
       各子类型的模型形状不同：workflow 是 lanes/steps，dataflow 是 stages/nodes，
       lifecycle 是 phases/events，sequence 是 participants/messages，
       只有 architecture/dataflow 有 nodes+groups。
       运行时的回退是静默的（找不到就落到第 0 项 / 不画分组），图会悄悄画错，
       所以这里一律按 error 报，而不是 warning。 */
    const refChecks = [
      { field: 'lane', owner: 'steps', table: 'lanes', code: 'model/unknown-lane', what: '泳道' },
      { field: 'stage', owner: 'nodes', table: 'stages', code: 'model/unknown-stage', what: '阶段' },
      { field: 'phase', owner: 'events', table: 'phases', code: 'model/unknown-phase', what: '相位' },
      { field: 'group', owner: 'nodes', table: 'groups', code: 'model/unknown-group', what: '分组' }
    ];
    for (const rc of refChecks) {
      const table = model[rc.table];
      if (!Array.isArray(table) || !table.length) continue;
      const known = new Set(table.map(t => (t && t.id != null) ? String(t.id) : '').filter(Boolean));
      for (const item of (model[rc.owner] || [])) {
        if (!item || item[rc.field] == null) continue;
        const v = String(item[rc.field]);
        if (known.has(v)) continue;
        addDiag(report, src, {
          code: rc.code, severity: 'error', index: at,
          message: `${rc.owner} "${item.id}" 的 ${rc.field}="${v}" 不是已声明的${rc.what}`,
          evidence: { [rc.field]: v, available: [...known].slice(0, 12) },
          supportedFixes: [`把 "${v}" 加进 ${rc.table}`, `或改成已有的${rc.what} id`]
        });
      }
    }

    /* sequence 的 blocks[].from/to 是消息下标，越界会被静默丢弃 */
    if (Array.isArray(model.blocks) && model.blocks.length) {
      const msgCount = (model.messages || []).length;
      for (const b of model.blocks) {
        if (!b) continue;
        for (const end of ['from', 'to']) {
          const v = b[end];
          if (v == null) continue;
          if (!Number.isInteger(v) || v < 0 || v >= msgCount) {
            addDiag(report, src, {
              code: 'model/block-range', severity: 'error', index: at,
              message: `blocks 的 ${end}=${JSON.stringify(v)} 不是有效的消息下标（共 ${msgCount} 条消息）`,
              evidence: { block: b.kind || b.id || null, [end]: v, messages: msgCount },
              supportedFixes: [`改成 0..${Math.max(0, msgCount - 1)} 之间的整数`]
            });
          }
        }
      }
    }

    /* direction 拼错会被 normDirection 静默当成 TB */
    if (model.direction != null && !DIRECTIONS.includes(String(model.direction))) {
      addDiag(report, src, {
        code: 'model/direction-invalid', severity: 'error', index: at,
        message: `direction="${model.direction}" 不是支持的取值，会被静默当成 TB`,
        evidence: { found: String(model.direction), allowed: DIRECTIONS },
        supportedFixes: [`改为 ${DIRECTIONS.join(' | ')} 之一`]
      });
    }
  }
  return models;
}

/* ── 布局沙箱：在 Node 里跑真正的布局引擎 ─────────────── */

/* makeLayoutSandbox 已抽到 scripts/sandbox.mjs —— 测试要用同一份实现。
   它的契约没变：Craft 对象 / null（无 owned 区块）/ {__error}（运行时依赖了 DOM）。 */

function ruleLayoutGeometry(report, src, models) {
  if (!models.length) return;
  const craft = makeLayoutSandbox(src);
  /* 有图解模型却拿不到运行时 —— 几何断言根本无法执行。
     这里以前是静默 return，产物照样 0 error 通过，等于门禁失效。 */
  if (!craft) {
    addDiag(report, src, {
      code: 'layout/runtime-missing', severity: 'error', index: 0,
      message: '产物里有图解模型，却找不到可执行的 Craft 运行时，几何断言一条都没跑',
      supportedFixes: ['确认 assets/template.html 的 data-craft-owned 区块还在', '重新生成产物']
    });
    return;
  }
  if (craft.__error) {
    addDiag(report, src, {
      code: 'layout/sandbox-failed', severity: 'error', index: 0,
      message: '无法在 Node 里执行布局引擎，几何断言已跳过：' + craft.__error,
      supportedFixes: ['确认 data-craft-owned 区块没有被手改过']
    });
    return;
  }

  for (const entry of models) {
    const raw = entry.data;
    if (!raw || typeof raw !== 'object') continue;
    const at = entry.index;
    let scene;
    try {
      scene = craft.layout.run(craft.model.fromJSON(raw, raw.kind));
    } catch (err) {
      addDiag(report, src, {
        code: 'layout/sandbox-failed', severity: 'error', index: at,
        message: '布局引擎在模型上抛错：' + String(err && err.message || err),
        evidence: { modelKey: entry.key },
        supportedFixes: ['检查模型的 from/to 与字段类型']
      });
      continue;
    }
    if (!scene || !scene.nodes.length) continue;

    let problems = [];
    /* 断言本身抛错时必须报出来 —— 吞掉异常等于把「不知道」说成「没问题」 */
    try {
      problems = craft.route.assertScene(scene) || [];
    } catch (err) {
      addDiag(report, src, {
        code: 'layout/assert-failed', severity: 'error', index: at,
        message: '几何断言自身抛错，无法判断布局是否合格：' + String(err && err.message || err),
        evidence: { modelKey: entry.key },
        supportedFixes: ['确认 route.assertScene 没有被改动过', '检查模型字段类型是否正确']
      });
    }

    /* 每个诊断码只报一次，避免刷屏。严重度与文案由 assertScene 决定 ——
       它比这里更清楚每条几何缺陷的性质。 */
    const seen = {};
    for (const p of problems) {
      if (seen[p.code]) continue;
      seen[p.code] = true;
      addDiag(report, src, {
        code: p.code, severity: p.severity || 'error', index: at,
        message: p.message || `布局几何不合格：${p.subject}`,
        evidence: { modelKey: entry.key, subject: p.subject },
        supportedFixes: p.fixes || [
          '这是自动布局算出来的几何，说明模型的拓扑有歧义',
          '试着减少同层节点数、缩短标签、或显式给出分组'
        ]
      });
    }

    /* 路由器自己承认失败的次数 —— 自动布局质量最好的单一信号。
       质量清单要求它为 0，所以这里是 error，不是 warning。 */
    const degraded = scene.stats.degradedRoutes || 0;
    if (degraded > 0) {
      const subjects = scene.edges.filter(e => e.degraded)
        .map(e => `${e.from} → ${e.to}`).slice(0, 8);
      addDiag(report, src, {
        code: 'layout/degraded-route', severity: 'error', index: at,
        message: `${degraded}/${scene.edges.length} 条边没找到满足全部约束的路由，已降级处理`,
        evidence: { degraded, total: scene.edges.length, crossings: scene.stats.crossings, edges: subjects },
        supportedFixes: ['减少跨层连接', '给节点加分组让它们靠近', '缩短边标签']
      });
    }

    /* 交叉数预算。
       注意两个不同的量：stats.crossings 是分层交叉（只有 architecture 会算，
       其余五种策略恒为 0），stats.routeCrossings 是最终路由之间的实质交叉（每种都有）。
       以前这里只看前者，于是这条规则在五种策略上等于不存在。取两者较大值。 */
    const layerCrossings = scene.stats.crossings || 0;
    const routeCrossings = scene.stats.routeCrossings || 0;
    const crossings = Math.max(layerCrossings, routeCrossings);
    if (scene.edges.length >= 6 && crossings > scene.edges.length * 0.35) {
      addDiag(report, src, {
        code: 'layout/crossing-budget', severity: 'warning', index: at,
        message: `边交叉 ${crossings} 次，超过边数的 35%，读起来会很乱`,
        evidence: { crossings, layerCrossings, routeCrossings, edges: scene.edges.length },
        supportedFixes: ['调整节点顺序（用 nodes[].order）', '拆成两张图']
      });
    }

    /* 确定性：跑两次必须逐字节相同 */
    try {
      const again = craft.layout.run(craft.model.fromJSON(raw, raw.kind));
      if (JSON.stringify(again) !== JSON.stringify(scene)) {
        addDiag(report, src, {
          code: 'layout/deterministic', severity: 'error', index: at,
          message: '同一模型两次布局结果不一致 —— 存在非确定性来源',
          evidence: { modelKey: entry.key },
          supportedFixes: ['布局必须可复现：检查是否用了 Math.random 或未排序的遍历']
        });
      }
    } catch (_) {}
  }
}

/* ── 运行时体积占比 ───────────────────────────────────── */

function ruleRuntimeShare(report, src, regions) {
  const total = Buffer.byteLength(src, 'utf8');
  const owned = regions.filter(r => r.kind === 'owned')
    .reduce((n, r) => n + Buffer.byteLength(r.full, 'utf8'), 0);
  /* 运行时是固定成本：小产物里它占大头是正常的，只有产物确实偏大时才值得提醒 */
  if (!total || total < SIZE_WARN * 0.8) return;
  if (owned / total < RUNTIME_SHARE_WARN) return;
  addDiag(report, src, {
    code: 'artifact/runtime-budget', severity: 'warning', index: 0,
    message: `运行时占产物体积的 ${(owned / total * 100).toFixed(0)}%（${(owned / 1024).toFixed(0)}KB / ${(total / 1024).toFixed(0)}KB），作者内容的余量不多了`,
    evidence: { runtimeBytes: owned, totalBytes: total },
    supportedFixes: ['这是固定成本，无法压缩', '把内联数据降采样以留出余量']
  });
}

function ruleMirror(report) {
  for (const dir of MIRROR_DIRS) {
    const mirrorRoot = path.join(SKILL_ROOT, dir);
    if (!fs.existsSync(mirrorRoot)) {
      addDiag(report, '', {
        code: 'mirror/stale', severity: 'error', index: 0,
        message: `镜像目录 ${dir} 不存在`,
        evidence: { dir },
        supportedFixes: ['运行 node scripts/sync.mjs 生成镜像']
      });
      continue;
    }
    for (const rel of MIRROR_FILES) {
      const a = path.join(SKILL_ROOT, rel);
      const b = path.join(mirrorRoot, rel);
      if (!fs.existsSync(a)) continue;
      if (!fs.existsSync(b)) {
        addDiag(report, '', {
          code: 'mirror/stale', severity: 'error', index: 0,
          message: `镜像 ${dir} 缺少 ${rel}`,
          evidence: { dir, file: rel },
          supportedFixes: ['运行 node scripts/sync.mjs']
        });
        continue;
      }
      if (fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) {
        addDiag(report, '', {
          code: 'mirror/stale', severity: 'error', index: 0,
          message: `镜像与根目录不一致：${dir}/${rel}`,
          evidence: { dir, file: rel },
          supportedFixes: ['运行 node scripts/sync.mjs']
        });
      }
    }
  }
}

/* ── 文档覆盖：失败表必须覆盖 checker 能报出的每一个诊断码 ── */

/** 从 route.assertScene 的函数体里扫出它会报的诊断码。
    这几个码由运行时产生、check.mjs 只是转发 —— 以前这里手维护一张清单，
    结果就是加了新规则却忘了登记（正是这条规则要防的事）。现在直接从运行时读。 */
function runtimeDiagCodes() {
  const p = path.join(SKILL_ROOT, 'assets/template.html');
  if (!fs.existsSync(p)) return [];
  const src = fs.readFileSync(p, 'utf8');
  const at = src.indexOf('route.assertScene = function');
  if (at < 0) return [];
  const end = src.indexOf('\n};', at);
  const body = src.slice(at, end < 0 ? src.length : end);
  return [...new Set([...body.matchAll(/code:\s*'([a-z0-9-]+\/[a-z0-9-]+)'/g)].map(m => m[1]))];
}

/** 从 check.mjs 自己的源码里扫出所有能报出的诊断码 —— 手维护的清单同样会漂移。
    命名空间含数字（a11y、v2 之类），字符类必须带上 0-9。 */
function emittedCodes() {
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const codes = new Set(runtimeDiagCodes());
  for (const m of self.matchAll(/code:\s*'([a-z0-9-]+\/[a-z0-9-]+)'/g)) codes.add(m[1]);
  return [...codes].sort();
}

function documentedCodes() {
  const p = path.join(SKILL_ROOT, 'references/authoring-contract.md');
  if (!fs.existsSync(p)) return null;
  const codes = new Set();
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/^\|\s*`([a-z0-9-]+\/[a-z0-9-]+)`\s*\|/gm)) codes.add(m[1]);
  return codes;
}

/** CLAUDE.md 要求「改了 check.mjs 的规则就必须同步更新 authoring-contract.md」。
    这里把那句话从注释变成门禁 —— 漏一个码就报错。 */
function ruleDocCoverage(report) {
  const documented = documentedCodes();
  if (!documented) return;
  const missing = emittedCodes().filter(c => !documented.has(c));
  if (!missing.length) return;
  addDiag(report, '', {
    code: 'docs/diagnostic-undocumented', severity: 'error', index: 0,
    message: `references/authoring-contract.md 的失败表漏了 ${missing.length} 个诊断码：${missing.join('、')}`,
    evidence: { missing, total: emittedCodes().length },
    supportedFixes: ['在 references/authoring-contract.md 的「失败 → 修复」表里补上这些码']
  });
}

/** check.mjs 的 DIAGRAM_SUBTYPES / NODE_KINDS 是运行时 DIAGRAM_KINDS / NODE_KIND_SETS
    的手抄副本。手抄必然漂移，所以直接拿运行时当真源比对 —— 静态表只是兜底。 */
function ruleEnumConsistency(report) {
  const p = path.join(SKILL_ROOT, 'assets/template.html');
  if (!fs.existsSync(p)) return;
  const craft = makeLayoutSandbox(fs.readFileSync(p, 'utf8'));
  if (!craft || craft.__error || !craft.model) return;

  const runtimeKinds = (craft.model.KINDS || []).slice().sort();
  const staticKinds = DIAGRAM_SUBTYPES.slice().sort();
  if (runtimeKinds.join(',') !== staticKinds.join(',')) {
    addDiag(report, '', {
      code: 'docs/enum-drift', severity: 'error', index: 0,
      message: 'check.mjs 的子类型表与运行时不一致',
      evidence: { check: staticKinds, runtime: runtimeKinds },
      supportedFixes: ['把 check.mjs 的 DIAGRAM_SUBTYPES 改成与 assets/template.html 的 DIAGRAM_KINDS 一致']
    });
    return;
  }
  for (const kind of staticKinds) {
    const runtimeNodeKinds = (craft.model.nodeKinds(kind) || []).slice().sort();
    const staticNodeKinds = (NODE_KINDS[kind] || []).slice().sort();
    if (runtimeNodeKinds.join(',') === staticNodeKinds.join(',')) continue;
    addDiag(report, '', {
      code: 'docs/enum-drift', severity: 'error', index: 0,
      message: `check.mjs 里 ${kind} 的节点种类与运行时不一致`,
      evidence: { subtype: kind, check: staticNodeKinds, runtime: runtimeNodeKinds },
      supportedFixes: [`把 check.mjs 的 NODE_KINDS.${kind} 改成与运行时的 NODE_KIND_SETS.${kind} 一致`]
    });
  }
}

/* ── 回执与冻结 ───────────────────────────────────────── */

/* 交付契约里「冻结」这一步以前只是散文：没有任何东西记录「这个产物是在什么状态下通过校验的」。
   这里补上最小的真话机制 —— 产物与模型的哈希、一份可选的冻结回执。
   刻意不做暂存目录 + 原子 rename + 版本化信封那一套：check.mjs 从不写产物，
   没有「交付失败毁掉上一个好版本」的风险，那套仪式解决的是这里不存在的问题。 */

function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

function receiptPath(file) { return file + '.receipt.json'; }

/** 产物里所有 JSON 模型块的联合哈希 —— 模型变了但产物字节没变的情况也要能发现 */
function modelHash(src) {
  const parts = [...src.matchAll(
    /<script[^>]*type="application\/json"[^>]*data-craft-data="([^"]*)"[^>]*>([\s\S]*?)<\/script>/g
  )].map(m => m[1] + '\u0000' + m[2]);
  return parts.length ? sha256(parts.join('\u0001')) : null;
}

/** 已有回执且哈希对不上 → 说明冻结之后又被改过，校验结论已经作废 */
function ruleReceipt(report, src, file) {
  const p = receiptPath(file);
  if (!fs.existsSync(p)) return;
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {
    addDiag(report, '', {
      code: 'receipt/unreadable', severity: 'warning', index: 0,
      message: '回执文件无法解析，冻结状态未知',
      evidence: { receipt: p },
      supportedFixes: ['删掉它重新冻结：node scripts/check.mjs <产物> --freeze']
    });
    return;
  }
  const now = sha256(src);
  if (prev.sha256 === now) {
    report.frozen = { since: prev.frozenAt || null, ok: true };
    return;
  }
  addDiag(report, '', {
    code: 'receipt/artifact-modified', severity: 'warning', index: 0,
    message: '产物在冻结之后被修改过 —— 之前那次「通过」已经不适用于当前内容',
    evidence: { receipt: p, frozenSha256: prev.sha256, currentSha256: now, frozenAt: prev.frozenAt || null },
    supportedFixes: ['重新校验并重新冻结：node scripts/check.mjs <产物> --freeze']
  });
}

function writeReceipt(report, src, file) {
  const p = receiptPath(file);
  const payload = {
    file: path.basename(file),
    sha256: sha256(src),
    modelSha256: modelHash(src),
    bytes: Buffer.byteLength(src, 'utf8'),
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    frozenAt: new Date().toISOString()
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n');
  return p;
}

/* ── 主流程 ───────────────────────────────────────────── */

function checkFile(file, opts) {
  const src = fs.readFileSync(file, 'utf8');
  const report = makeReport(file);
  const regions = splitRegions(src);

  ruleSize(report, src);
  ruleSentinels(report, src);
  ruleExternalRefs(report, src, regions);
  ruleHtmlShell(report, src);
  ruleThemeSupport(report, src);
  ruleHardcodedColors(report, src, regions);
  ruleContrast(report, src, regions);
  ruleReducedMotion(report, src, regions);
  ruleLabels(report, src);
  const dataCtx = ruleData(report, src, regions);
  ruleTypeConsistency(report, src, regions, ruleType(report, src));
  ruleChartContract(report, src, dataCtx, regions);
  ruleStepSequence(report, src);
  ruleControlBinding(report, src, regions);
  ruleDomBudget(report, src);
  ruleRuntimeFreshness(report, src, regions);
  const diagramModels = ruleDiagramModel(report, src, regions);
  ruleLayoutGeometry(report, src, diagramModels);
  ruleRuntimeShare(report, src, regions);
  if (opts.mirror) { ruleMirror(report); ruleDocCoverage(report); ruleEnumConsistency(report); }
  if (!opts.mirror) ruleReceipt(report, src, file);

  /* 回执：产物与模型的哈希。机器可以据此确认「报告说的就是这份文件」。 */
  report.artifact = { sha256: sha256(src), bytes: Buffer.byteLength(src, 'utf8') };
  const mh = modelHash(src);
  if (mh) report.model = { sha256: mh };

  report.ok = report.summary.errors === 0;
  return report;
}

function printHuman(report) {
  const { diagnostics, summary, file } = report;
  if (!diagnostics.length) {
    console.log(`✓ ${file} — 0 error，0 warning`);
    return;
  }
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = diagnostics.slice().sort((a, b) => order[a.severity] - order[b.severity]);
  for (const d of sorted) {
    const at = d.subject.line ? `${file}:${d.subject.line}:${d.subject.col}` : file;
    console.log(`${at}: ${d.severity} ${d.code} — ${d.message}`);
    if (d.subject.snippet) console.log(`    ${d.subject.snippet}`);
    for (const fix of d.supportedFixes || []) console.log(`    → ${fix}`);
  }
  console.log('');
  console.log(`${summary.errors} error，${summary.warnings} warning`);
  if (summary.errors === 0) console.log('通过（无 error）。warning 不阻断交付，但值得看一眼。');
}

function usage() {
  console.log(`用法：node scripts/check.mjs <产物.html> [选项]

选项：
  --freeze   干净通过后在产物旁写 <产物>.receipt.json（记录产物与模型的哈希）
  --json     以 JSON 输出完整回执（给机器读）
  --mirror   额外校验 .agents/skills/craft 镜像是否与根目录一致
  --help     显示本帮助

退出码：
  0  零 error（warning 允许）
  1  ≥1 error
  2  用法错误或文件不可读

本命令只读，从不修改产物，也从不自动修复。`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { usage(); process.exit(0); }
  const opts = {
    json: argv.includes('--json'),
    mirror: argv.includes('--mirror'),
    freeze: argv.includes('--freeze')
  };
  const file = argv.find(a => !a.startsWith('-'));
  if (!file) {
    console.error('错误：缺少产物路径\n');
    usage();
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`错误：文件不存在 — ${file}`);
    process.exit(2);
  }
  let report;
  try {
    report = checkFile(file, opts);
  } catch (err) {
    console.error(`错误：读取或解析失败 — ${err.message}`);
    process.exit(2);
  }
  /* 冻结：只在干净通过时写回执。带着 error 冻结等于给坏产物盖章。 */
  if (opts.freeze) {
    if (report.summary.errors > 0) {
      report.freeze = { status: 'refused', reason: '有 error，拒绝冻结' };
      if (!opts.json) console.error('⊘ 有 error，拒绝冻结 —— 冻结只对干净通过的产物生效。');
    } else {
      const p = writeReceipt(report, fs.readFileSync(file, 'utf8'), file);
      report.freeze = { status: 'frozen', receipt: p };
      if (!opts.json) console.log(`✓ 已冻结 ${path.basename(p)}（${report.artifact.sha256.slice(0, 16)}…）`);
    }
  }

  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  process.exit(report.summary.errors > 0 ? 1 : 0);
}

main();
