#!/usr/bin/env node
/**
 * 报告校验命令行 —— 给 pipeline 和 CI 用。
 *
 *     node contracts/bin/validate-report.mjs report.json [schema.json]
 *
 * 退出码：0 通过，1 有问题，2 用法错误。
 * 输出：每个问题一行，格式 `<路径> :: <说明>`，便于直接 grep。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSemantics, validate } from '../validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error('用法: validate-report.mjs <report.json> [schema.json]');
  process.exit(2);
}

const [reportPath, schemaPath] = process.argv.slice(2);
if (!reportPath) usage();

const schemaFile = schemaPath ?? join(here, '..', 'report.schema.json');

let report;
let schema;
try {
  report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
} catch (err) {
  console.error(`读取报告失败: ${err.message}`);
  process.exit(2);
}
try {
  schema = JSON.parse(readFileSync(resolve(schemaFile), 'utf8'));
} catch (err) {
  console.error(`读取契约失败: ${err.message}`);
  process.exit(2);
}

const structural = validate(schema, report);
const semantic = checkSemantics(report);
const total = structural.length + semantic.length;

if (total === 0) {
  const events = Array.isArray(report.events) ? report.events.length : 0;
  const scope = `${report.params?.format} / ${report.params?.age_group}`;
  console.log(`✓ 报告合法（${scope}，${events} 个事件，契约 v${report.schema_version}）`);
  process.exit(0);
}

for (const issue of structural) {
  console.log(`结构 ${issue.path} :: ${issue.message}`);
}
for (const issue of semantic) {
  console.log(`语义[${issue.rule}] ${issue.path} :: ${issue.message}`);
}
console.error(`\n✗ 共 ${total} 个问题（结构 ${structural.length}，语义 ${semantic.length}）`);
process.exit(1);
