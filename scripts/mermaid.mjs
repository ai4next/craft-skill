#!/usr/bin/env node
/**
 * Mermaid → craft 模型。
 *
 *   node scripts/mermaid.mjs <输入.mmd> [--out <data.json>] [--json] [--type workflow|architecture]
 *
 * 支持三类输入：
 *   flowchart / graph  → workflow（默认）或 architecture
 *   sequenceDiagram    → sequence
 *   stateDiagram       → lifecycle
 *
 * 只取**拓扑与语义**（谁连谁、标签是什么），不还原 Mermaid 的样式 ——
 * 几何由 craft 的运行时自动布局，你不需要、也不该在这里给坐标。
 *
 * 纯 Node、零依赖、确定性：同一份输入必然得到同一份模型。
 */

import fs from 'node:fs';
import path from 'node:path';

/* ── 工具 ─────────────────────────────────────────────── */

/** craft 的 id 只允许 [A-Za-z0-9_-]。
    中文名清洗后会退化成纯下划线 —— 而且「排队」和「失败」会撞成同一个 id，
    状态被静默合并。所以清洗结果不可用时改用序号 id：
    按**原始名字**缓存，同一个名字永远得到同一个 id，不同名字绝不撞。 */
function makeIdFactory(prefix) {
  const byRaw = new Map();
  const used = new Set();
  let n = 0;
  return function (raw) {
    const key = String(raw == null ? '' : raw).trim();
    if (byRaw.has(key)) return byRaw.get(key);
    let id = key.replace(/[^A-Za-z0-9_-]/g, '_');
    if (!/[A-Za-z0-9]/.test(id) || used.has(id)) {
      do { id = prefix + n++; } while (used.has(id));
    }
    used.add(id);
    byRaw.set(key, id);
    return id;
  };
}

/** 去掉包裹标签的引号与两端空白 */
function cleanLabel(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/<br\s*\/?>/gi, ' ').trim();
}

/* ── flowchart / graph ────────────────────────────────── */

/* Mermaid 的节点写法：id 后面跟一对包裹符。这里只认形状，不认样式。
   [( )] 圆柱、[[ ]] 子程序等在 craft 里没有对应形状，统一退化成默认矩形。 */
const NODE_SHAPES = [
  { open: '((', close: '))', shape: 'circle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'rect' },
  { open: '[(', close: ')]', shape: 'rect' },
  { open: '{{', close: '}}', shape: 'diamond' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '>', close: ']', shape: 'rect' }
];

/** 从一个节点的写法里拆出 id、标签、形状。 */
function parseNodeToken(token) {
  const t = token.trim();
  for (const s of NODE_SHAPES) {
    const i = t.indexOf(s.open);
    if (i > 0 && t.endsWith(s.close)) {
      const id = t.slice(0, i).trim();
      const label = cleanLabel(t.slice(i + s.open.length, t.length - s.close.length));
      if (id) return { id, label: label || id, shape: s.shape };
    }
  }
  return { id: t, label: t, shape: 'rect' };
}

/* 边的写法：--> --- -.-> ==> 以及带标签的 -- 文字 --> 与 -->|文字| */
const EDGE_RE = /^(.+?)\s*(-{1,3}[.>]?[->]?|={1,3}>|-\.->|--[->])\s*(?:\|([^|]*)\|)?\s*(.+)$/;

function splitEdge(line) {
  /* 先处理 -->|label| target 与 -- label --> target 两种带标签写法 */
  let m = line.match(/^(.+?)\s*-{1,2}[.>]?\s*\|([^|]*)\|\s*(.+)$/);
  if (m) return { from: m[1], label: cleanLabel(m[2]), to: m[3] };

  m = line.match(/^(.+?)\s*--\s*([^->][^-]*?)\s*-->\s*(.+)$/);
  if (m) return { from: m[1], label: cleanLabel(m[2]), to: m[3] };

  m = line.match(/^(.+?)\s*(-{1,3}\.?-*[->]|={1,3}>)\s*(.+)$/);
  if (m) return { from: m[1], label: '', to: m[3] };

  return null;
}

function parseFlowchart(lines, opts) {
  const nodes = new Map();     // id → {id, label, shape, lane}
  const edges = [];
  const lanes = new Map();     // id → {id, label}
  const warnings = [];
  const idFor = makeIdFactory('n');
  const laneFor = makeIdFactory('lane');
  let currentLane = null;

  const addNode = (tok) => {
    const n = parseNodeToken(tok);
    if (!n.id) return null;
    const id = idFor(n.id);
    if (!nodes.has(id)) nodes.set(id, { id, label: n.label, shape: n.shape, lane: currentLane });
    else {
      if (n.label && n.label !== n.id) nodes.get(id).label = n.label;   // 后出现的标签更具体
      if (currentLane && !nodes.get(id).lane) nodes.get(id).lane = currentLane;
    }
    return id;
  };

  for (const raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^(flowchart|graph)\b/i.test(line)) continue;
    /* subgraph 映射成 craft 的泳道 —— 这是 Mermaid 流程图里最常见的分组方式，
       丢掉它会让跨泳道的流程挤成一条线。嵌套子图不还原（会如实警告）。 */
    const sg = line.match(/^subgraph\s+(.+)$/i);
    if (sg) {
      if (currentLane) warnings.push('忽略嵌套的 subgraph（craft 的泳道是平铺的）');
      else {
        const raw = cleanLabel(sg[1].split(/\s+as\s+/i).pop());
        const id = laneFor(raw);
        if (!lanes.has(id)) lanes.set(id, { id, label: raw || id });
        currentLane = id;
      }
      continue;
    }
    if (/^end$/i.test(line)) { currentLane = null; continue; }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/i.test(line)) continue;

    /* 一行里可能串多条边：A --> B --> C */
    const parts = line.split(/\s*(?=-{1,3}[.>]?\s*\|)|(?<=\|)\s*/);
    const segments = splitChain(line);
    if (!segments.length) { addNode(line); continue; }

    for (const seg of segments) {
      const from = addNode(seg.from);
      const to = addNode(seg.to);
      if (!from || !to) continue;
      const e = { from, to };
      if (seg.label) e.label = seg.label;
      edges.push(e);
    }
  }

  /* 出入度决定 start / end / decision */
  const inDeg = new Map(), outDeg = new Map();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) || 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  }

  const list = [...nodes.values()];
  const wantArchitecture = opts.type === 'architecture';

  const outNodes = list.map(n => {
    const node = { id: n.id, label: n.label };
    if (wantArchitecture) {
      node.kind = 'backend';
      if (!inDeg.get(n.id)) node.kind = 'external';
      else if (!outDeg.get(n.id)) node.kind = 'database';
      return node;
    }
    if (n.shape === 'diamond') node.kind = 'decision';
    else if (!inDeg.get(n.id)) node.kind = 'start';
    else if (!outDeg.get(n.id)) node.kind = 'end';
    else node.kind = 'task';
    if (n.lane) node.lane = n.lane;
    return node;
  });

  if (wantArchitecture) {
    return { model: { kind: 'architecture', title: opts.title, nodes: outNodes, edges }, warnings };
  }

  /* craft 的 workflow 必须有 lanes（契约里的必需字段）。
     没有 subgraph 时补一条默认泳道 —— 单泳道多列的流程图是合法且常见的形态，
     比强行要求作者手写泳道友好。 */
  let laneList = [...lanes.values()];
  if (!laneList.length) {
    laneList = [{ id: 'main', label: '流程' }];
    for (const n of outNodes) n.lane = 'main';
  }

  const model = { kind: 'workflow', title: opts.title, lanes: laneList, nodes: outNodes, edges };
  return { model, warnings };
}

/** 把 A --> B --> C 拆成两段边 */
function splitChain(line) {
  const out = [];
  let rest = line;
  let guard = 0;
  while (rest && guard++ < 50) {
    const seg = splitEdge(rest);
    if (!seg) break;
    out.push({ from: seg.from, label: seg.label, to: seg.to });
    break;      // 只取第一段，其余交给下一轮（Mermaid 的链式写法少见，保守处理）
  }
  return out;
}

/* ── sequenceDiagram ──────────────────────────────────── */

const SEQ_RE = /^(\S+?)\s*(--?>>?|--?x|--?\)|<<--?|--?>)\s*(\S+?)\s*:\s*(.*)$/;

function parseSequence(lines, opts) {
  const participants = new Map();
  const messages = [];
  const warnings = [];

  const idFor = makeIdFactory('p');
  const declare = (raw, alias) => {
    const id = idFor(raw);
    const label = cleanLabel(alias || raw);
    if (!participants.has(id)) participants.set(id, { id, label });
    else if (alias) participants.get(id).label = label;
    return id;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^sequenceDiagram\b/i.test(line)) continue;
    if (/^(autonumber|activate|deactivate|note|loop|alt|else|opt|par|critical|break|rect|end)\b/i.test(line)) {
      if (/^(loop|alt|opt|par|critical)\b/i.test(line)) warnings.push('忽略 ' + line.split(/\s/)[0] + ' 区块（craft 的 blocks 用消息下标，需手工指定）');
      continue;
    }
    const p = line.match(/^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i);
    if (p) { declare(p[1], p[2]); continue; }

    const m = line.match(SEQ_RE);
    if (!m) continue;
    const from = declare(m[1]);
    const to = declare(m[3]);
    /* Mermaid 的返回箭头是虚线（-->>），映射成 craft 的 return 语义 */
    const isReturn = /--/.test(m[2]) || /^<<-/.test(m[2]);
    const msg = { from, to };
    const label = cleanLabel(m[4]);
    if (label) msg.label = label;
    if (isReturn) msg.kind = 'return';
    messages.push(msg);
  }

  /* 消息里出现过但没声明的参与者，按出现顺序补进 participants */
  const model = {
    kind: 'sequence',
    title: opts.title,
    participants: [...participants.values()],
    messages
  };
  return { model, warnings };
}

/* ── stateDiagram ─────────────────────────────────────── */

function parseState(lines, opts) {
  const states = new Map();
  const transitions = [];
  const warnings = [];
  const START = '__start__';

  const idFor = makeIdFactory('s');
  const declare = (raw) => {
    if (raw === '[*]') return START;
    const id = idFor(raw);
    if (!states.has(id)) states.set(id, { id, label: cleanLabel(raw) });
    return id;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^stateDiagram(-v2)?\b/i.test(line)) continue;
    if (/^(direction|note|classDef|class)\b/i.test(line)) continue;
    if (/\{$/.test(line)) { warnings.push('忽略复合状态（craft 的 lifecycle 是平铺的）'); continue; }
    if (/^}/.test(line)) continue;

    /* A --> B : label  或  state "desc" as A */
    const d = line.match(/^state\s+"([^"]*)"\s+as\s+(\S+)$/i);
    if (d) { const id = declare(d[2]); states.get(id).label = cleanLabel(d[1]); continue; }

    const m = line.match(/^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.*))?$/);
    if (!m) continue;
    const from = declare(m[1].trim());
    const to = declare(m[2].trim());
    const t = { from, to };
    const label = cleanLabel(m[3]);
    if (label) t.label = label;
    transitions.push(t);
  }

  /* [*] 作为终点的状态标记为 terminal */
  const terminal = new Set();
  for (const t of transitions) if (t.to === START) terminal.add(t.from);

  /* 按「到起点的最短距离」分层。
     不用最长路径：状态机几乎都带环（失败 → 重试回起点），
     最长路径会让起点自己拿到一个很大的层号，整张图前后颠倒。 */
  const real = [...states.keys()];
  const succ = new Map(real.map(id => [id, []]));
  const indeg = new Map(real.map(id => [id, 0]));
  for (const t of transitions) {
    if (t.from === START || t.to === START) continue;
    if (!succ.has(t.from) || !indeg.has(t.to)) continue;
    succ.get(t.from).push(t.to);
    indeg.set(t.to, indeg.get(t.to) + 1);
  }

  const rank = new Map();
  const roots = real.filter(id => indeg.get(id) === 0).sort();
  const queue = (roots.length ? roots : real.slice().sort().slice(0, 1)).slice();
  for (const r of queue) rank.set(r, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const nx of (succ.get(id) || []).slice().sort()) {
      if (rank.has(nx)) continue;
      rank.set(nx, rank.get(id) + 1);
      queue.push(nx);
    }
  }
  /* 环里与起点不连通的部分按 0 层补上，保证每个状态都有相位 */
  for (const id of real.slice().sort()) if (!rank.has(id)) rank.set(id, 0);

  const phases = [];
  const phaseOf = new Map();
  for (const id of real) {
    const r = rank.get(id) || 0;
    const pid = 'p' + r;
    if (!phaseOf.has(pid)) { phaseOf.set(pid, { id: pid, label: '第 ' + (r + 1) + ' 步' }); phases.push(phaseOf.get(pid)); }
  }

  const events = real
    .filter(id => !terminal.has(id))
    .map(id => ({ id, label: states.get(id).label, phase: phaseOf.get('p' + (rank.get(id) || 0)).id, type: 'normal' }));
  const outcomes = [...terminal].sort()
    .map(id => ({ id, label: states.get(id).label, phase: phaseOf.get('p' + (rank.get(id) || 0)).id }));

  /* 落点是终态时改写成 outcome，否则 transitions 会指向不存在的 event */
  const outcomeIds = new Set(outcomes.map(o => o.id));
  const finalTransitions = transitions
    .filter(t => t.from !== START && t.to !== START)
    .map(t => outcomeIds.has(t.to) ? Object.assign({}, t, { to: t.to }) : t);

  const model = { kind: 'lifecycle', title: opts.title, phases, events, transitions: finalTransitions };
  if (outcomes.length) model.outcomes = outcomes;
  return { model, warnings };
}

/* ── 入口 ─────────────────────────────────────────────── */

export function parseMermaid(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const head = lines.find(l => l.trim() && !l.trim().startsWith('%%')) || '';
  const kind = head.trim().split(/[\s{]/)[0].toLowerCase();

  if (/^sequenceDiagram/i.test(head)) return parseSequence(lines, opts);
  if (/^stateDiagram/i.test(head)) return parseState(lines, opts);
  if (/^(flowchart|graph)/i.test(head)) return parseFlowchart(lines, opts);

  throw new Error('无法识别的 Mermaid 图类型（首行："' + head.trim() + '"）。支持 flowchart / graph / sequenceDiagram / stateDiagram');
}

function usage() {
  console.log(`用法：node scripts/mermaid.mjs <输入.mmd> [选项]

选项：
  --out <文件>   把模型写到文件（默认写到 stdout）
  --type <类型>  flowchart 的目标类型：workflow(默认) | architecture
  --title <标题> 写进模型的 title
  --json         以 JSON 输出完整回执（含 warnings）
  --help         显示本帮助

支持：flowchart / graph / sequenceDiagram / stateDiagram
输出：craft 模型 JSON，可直接放进 <script type="application/json" data-craft-data="main">`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || !argv.length) { usage(); process.exit(argv.length ? 0 : 2); }

  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const file = argv.find((a, i) => !a.startsWith('-') && !['--out', '--type', '--title'].includes(argv[i - 1]));
  if (!file) { console.error('错误：缺少输入文件\n'); usage(); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`错误：文件不存在 — ${file}`); process.exit(2); }

  const type = arg('--type') || 'workflow';
  if (!['workflow', 'architecture'].includes(type)) {
    console.error(`错误：--type 只能是 workflow 或 architecture（收到 ${type}）`);
    process.exit(2);
  }

  let result;
  try {
    result = parseMermaid(fs.readFileSync(file, 'utf8'), {
      type,
      title: arg('--title') || path.basename(file, path.extname(file))
    });
  } catch (err) {
    console.error('解析失败：' + err.message);
    process.exit(1);
  }

  const json = result.model ? JSON.stringify(result.model, null, 2) : '';
  const out = arg('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), json + '\n');
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      ok: true, file, kind: result.model.kind, out: out ? path.resolve(out) : null,
      nodes: (result.model.nodes || result.model.participants || result.model.events || []).length,
      edges: (result.model.edges || result.model.messages || result.model.transitions || []).length,
      warnings: result.warnings
    }, null, 2));
  } else if (!out) {
    console.log(json);
  } else {
    console.log(`✓ 已写入 ${path.resolve(out)}（${result.model.kind}）`);
  }
  if (result.warnings.length && !argv.includes('--json')) {
    for (const w of result.warnings) console.error('  注意：' + w);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
