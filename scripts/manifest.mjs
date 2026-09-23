#!/usr/bin/env node
/**
 * 技能的派生清单 —— check.mjs 与 sync.mjs 的唯一事实源。
 *
 * 这两件事以前在两边各写了一份，必然漂移：
 *   - MIRROR_FILES：要镜像到 .agents/ 与 .claude/ 的文件
 *   - 示例类型：examples/<类型>/ 的列表
 *
 * 现在改为「自动发现」而不是「手维护清单」：
 *   - 镜像文件 = 根目录的固定几份 + references/ 下的全部 .md
 *   - 示例类型 = examples/ 下所有带 slots/ 的目录
 *
 * 这样新增一个参考文档或一个示例，不需要改任何脚本。
 */

import fs from 'node:fs';
import path from 'node:path';

/* 两个镜像位置：agentskills.io 约定（.agents）与 Claude Code 约定（.claude） */
export const MIRRORS = ['.agents/skills/craft', '.claude/skills/craft'];

/* 根目录必须镜像的文件 */
const ROOT_MIRROR_FILES = ['SKILL.md', 'README.md', 'REFERENCES.md', 'CLAUDE.md', '.gitignore'];

/** 要镜像的文件清单（相对技能根目录，按路径排序，保证确定性）。 */
export function mirrorFiles(root) {
  const out = ROOT_MIRROR_FILES.filter(rel => fs.existsSync(path.join(root, rel)));
  const refDir = path.join(root, 'references');
  if (fs.existsSync(refDir)) {
    for (const name of fs.readdirSync(refDir).sort()) {
      if (name.endsWith('.md')) out.push('references/' + name);
    }
  }
  return out;
}

/** examples/ 下所有带 slots/ 的目录名（即需要由 sync.mjs 重新组装的示例）。 */
export function exampleTypes(root) {
  const dir = path.join(root, 'examples');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'slots')))
    .map(e => e.name)
    .sort();
}
