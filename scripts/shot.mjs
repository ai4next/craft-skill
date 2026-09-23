#!/usr/bin/env node
/**
 * 无头浏览器截图回执。
 *
 *   node scripts/shot.mjs <产物.html> [--json] [--out <目录>]
 *
 * 对产物拍明暗两张截图，写 PNG + JSON 回执，供人（或模型）肉眼复核。
 *
 * 退出码：
 *   0  截图成功
 *   1  截图失败（浏览器报错 / 文件不可读）
 *   2  **跳过** —— 找不到浏览器。跳过永远不等于通过。
 *
 * 本命令只读产物，从不修改它。截图是证据，不是自动美化声明 ——
 * 回执里的 visualReview 永远是 "pending"，得真的看过图才能说通过。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WIDTH = 1280;
const HEIGHT = 800;
const THEMES = ['light', 'dark'];
/* 给页面脚本留出运行时间（数据解析、图表挂载、字体回退） */
const VIRTUAL_TIME_BUDGET = 2500;

const CANDIDATES = [
  process.env.CRAFT_CHROME,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];

/* 在页面里量一下浮层（工具条 / 缩略图 / 导览栏）与节点框的实际重叠面积。
   check.mjs 是静态检查，看不见这类「渲染之后才知道」的遮挡 ——
   实测曾出现缩略图压住右下角节点、工具条压住右上角节点各约 25% 面积的情况。

   必须测**多个视口**：遮挡与视口高度强相关，只在 1280×800 下测会漏掉
   （同一个产物在 800 高下 0px²、在 900 高下 2350px²）。

   把结果写进 document.title，再用 --dump-dom 读回来。 */
const OVERLAP_VIEWPORTS = [[1280, 800], [1440, 900]];

const OVERLAP_PROBE = `<script>
addEventListener('load', function () { setTimeout(function () {
  try {
    var vis = function (el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(el).opacity) > 0.05;
    };
    var chrome = [].slice.call(document.querySelectorAll(
      '.craft-toolbar, .craft-minimap, .craft-guide-rail, .craft-deck')).filter(vis);
    var nodes = [].slice.call(document.querySelectorAll('.craft-node'));
    var out = [];
    chrome.forEach(function (c) {
      var cr = c.getBoundingClientRect(), worst = 0, who = null;
      nodes.forEach(function (n) {
        var nr = n.getBoundingClientRect();
        var ox = Math.max(0, Math.min(cr.right, nr.right) - Math.max(cr.left, nr.left));
        var oy = Math.max(0, Math.min(cr.bottom, nr.bottom) - Math.max(cr.top, nr.top));
        if (ox * oy > worst) {
          worst = ox * oy;
          who = n.getAttribute('data-craft-node') ||
                (n.textContent || '').trim().slice(0, 12) || null;
        }
      });
      out.push({ chrome: c.className.split(' ')[0], overlapPx: Math.round(worst), node: who });
    });
    document.title = 'CRAFT-OVERLAP' + JSON.stringify(out);
  } catch (e) { document.title = 'CRAFT-OVERLAP[]'; }
}, 700); });
</script>`;

/** 在给定视口下量一次浮层遮挡。探测失败返回 null —— 探不到不等于没有遮挡。 */
function overlapAt(browser, abs, w, h) {
  const tmp = path.join(os.tmpdir(), `craft-probe-${process.pid}-${w}x${h}.html`);
  try {
    const html = fs.readFileSync(abs, 'utf8').replace('</body>', OVERLAP_PROBE + '</body>');
    fs.writeFileSync(tmp, html);
    const r = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--virtual-time-budget=3000', '--dump-dom', `--window-size=${w},${h}`,
      pathToFileURL(tmp).href
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 28 });
    const m = (r.stdout || '').match(/CRAFT-OVERLAP(\[[\s\S]*?\])<\/title>/);
    return m ? JSON.parse(m[1]) : null;
  } catch (_) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

/** 逐视口量浮层遮挡，汇总成一份证据。 */
function measureOverlap(browser, abs) {
  const measurements = [];
  for (const [w, h] of OVERLAP_VIEWPORTS) {
    const at = overlapAt(browser, abs, w, h);
    if (!at) return null;                       // 有一个视口探不到就整体如实说不知道
    for (const o of at) measurements.push({ viewport: `${w}x${h}`, ...o });
  }
  return measurements;
}

function findBrowser() {
  for (const p of CANDIDATES) {
    if (!p) continue;
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  for (const name of PATH_NAMES) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

function usage() {
  console.log(`用法：node scripts/shot.mjs <产物.html> [选项]

选项：
  --json         以 JSON 输出回执
  --out <目录>   截图输出目录（默认与产物同目录）
  --help         显示本帮助

退出码：
  0  截图成功
  1  截图失败
  2  跳过（找不到浏览器）—— 跳过不等于通过

可用环境变量 CRAFT_CHROME / CHROME_PATH 指定浏览器可执行文件。`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { usage(); process.exit(0); }

  const json = argv.includes('--json');
  const outIdx = argv.indexOf('--out');
  const file = argv.find((a, i) => !a.startsWith('-') && argv[i - 1] !== '--out');

  if (!file) {
    console.error('错误：缺少产物路径\n');
    usage();
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`错误：文件不存在 — ${file}`);
    process.exit(2);
  }

  const abs = path.resolve(file);
  const outDir = outIdx >= 0 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : path.dirname(abs);
  const base = path.basename(abs, path.extname(abs));

  const browser = findBrowser();
  const receipt = {
    ok: false,
    file: abs,
    browser: browser || null,
    viewport: { width: WIDTH, height: HEIGHT },
    shots: [],
    visualReview: 'pending',
    note: '截图是证据，不是自动美化声明。必须真的看过图才能报告 visual_review: passed。'
  };

  if (!browser) {
    receipt.status = 'skipped';
    receipt.reason = '找不到 Chrome/Chromium';
    receipt.supportedFixes = [
      '安装 Chrome 或 Chromium',
      '设置 CRAFT_CHROME 指向浏览器可执行文件',
      '把 visual_review 如实报为 skipped —— 不要报成 passed'
    ];
    if (json) console.log(JSON.stringify(receipt, null, 2));
    else {
      console.log(`⊘ 跳过：找不到 Chrome/Chromium`);
      console.log('  截图未进行 —— 这不是通过，visual_review 应报为 skipped。');
      console.log('  设置 CRAFT_CHROME=/path/to/chrome 可指定浏览器。');
    }
    process.exit(2);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const failures = [];

  for (const theme of THEMES) {
    const shotPath = path.join(outDir, `${base}.${theme}.shot.png`);
    try { fs.unlinkSync(shotPath); } catch (_) {}

    const url = `${pathToFileURL(abs).href}?theme=${theme}`;
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--virtual-time-budget=${VIRTUAL_TIME_BUDGET}`,
      `--screenshot=${shotPath}`,
      url
    ];

    const r = spawnSync(browser, args, { encoding: 'utf8', timeout: 60000 });
    const produced = fs.existsSync(shotPath) && fs.statSync(shotPath).size > 0;

    if (produced) {
      receipt.shots.push({ theme, path: shotPath, bytes: fs.statSync(shotPath).size });
    } else {
      failures.push({
        theme,
        status: r.status,
        stderr: (r.stderr || '').trim().split('\n').slice(-3).join(' | ')
      });
    }
  }

  receipt.ok = failures.length === 0;
  receipt.status = receipt.ok ? 'captured' : 'failed';
  if (failures.length) receipt.failures = failures;

  /* 浮层遮挡：机器测量值，进回执。它不影响退出码 —— 这是证据，不是判决。 */
  const overlap = receipt.ok ? measureOverlap(browser, abs) : null;
  if (overlap) {
    const bad = overlap.filter(o => o.overlapPx > 0);
    receipt.chromeOverlap = {
      status: bad.length ? 'overlap' : 'clear',
      viewports: OVERLAP_VIEWPORTS.map(([w, h]) => `${w}x${h}`),
      measurements: overlap,
      note: '浮层（工具条/缩略图）与节点框的重叠面积，逐视口测量。>0 表示有遮挡，需要修布局或让浮层避让。'
    };
    if (bad.length) {
      receipt.chromeOverlap.supportedFixes = [
        '调整节点位置，避开右上角与右下角',
        '让浮层在内容靠边时自动避让或收起'
      ];
    }
  } else {
    receipt.chromeOverlap = { status: 'unknown', note: '浮层遮挡探测失败 —— 探测不到不等于没有遮挡' };
  }

  if (json) console.log(JSON.stringify(receipt, null, 2));
  else if (receipt.ok) {
    console.log(`✓ 已截图 ${receipt.shots.length} 张（${WIDTH}×${HEIGHT}，明/暗各一张）`);
    for (const s of receipt.shots) console.log(`  ${s.theme.padEnd(5)} ${s.path}  ${(s.bytes / 1024).toFixed(0)}KB`);
    if (receipt.chromeOverlap.status === 'clear') console.log('✓ 浮层无遮挡（工具条/缩略图都没压住节点）');
    else if (receipt.chromeOverlap.status === 'overlap') {
      console.log('✗ 浮层遮挡：');
      for (const o of receipt.chromeOverlap.measurements.filter(o => o.overlapPx > 0))
        console.log(`  ${o.chrome} 压住节点 ${o.node} ${o.overlapPx}px²`);
    } else console.log('⊘ 浮层遮挡未测到（探测失败）');
    console.log('');
    console.log('下一步：真的打开这些图看 —— 溢出、标签截断、对比度、双主题可读性。');
    console.log('visual_review 在你看过之前一律是 pending。');
  } else {
    console.error(`✗ 截图失败 ${failures.length}/${THEMES.length}`);
    for (const f of failures) console.error(`  ${f.theme}: 退出码 ${f.status} ${f.stderr || ''}`);
  }

  process.exit(receipt.ok ? 0 : 1);
}

main();
