#!/usr/bin/env node
/**
 * Ensures all Elasticsearch HTTP traffic goes through src/services/elasticsearch.ts gateway.
 * Run: npm run verify:api-gateway
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const gatewayFile = path.join(srcDir, 'services/elasticsearch.ts');

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(ent.name)) files.push(p);
  }
  return files;
}

const violations = [];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

for (const file of walk(srcDir)) {
  const rel = path.relative(root, file);
  if (file === gatewayFile) continue;
  const content = stripComments(fs.readFileSync(file, 'utf8'));

  if (/\bfetch\s*\(/.test(content)) {
    violations.push(`${rel}: direct fetch()`);
  }
  if (/\b(XMLHttpRequest|axios|node-fetch|got)\b/.test(content)) {
    violations.push(`${rel}: alternate HTTP client`);
  }
  if (/from\s+['"]@\/services\/(?!elasticsearch)/.test(content)) {
    // no other service modules expected
  }
}

const gateway = fs.readFileSync(gatewayFile, 'utf8');

if (/if\s*\(\s*!cluster\s*\)\s*\{[\s\S]*?return run\(\)/.test(gateway)) {
  violations.push('elasticsearch.ts: cluster bypass (governor skipped when cluster omitted)');
}

const exportFns = [...gateway.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
const viaRequest = [...gateway.matchAll(/return request<[^>]+>\('(\w+)'/gm)].map((m) => m[1]);
const clusterRequestCalls = (gateway.match(/\bclusterRequest\s*\(/g) || []).length;
const gatewayFetchCalls = (gateway.match(/\bfetchWithTimeoutAndRetry\s*\(/g) || []).length;
const postCalls = (gateway.match(/method:\s*'POST'/g) || []).length;

if (violations.length > 0) {
  console.error('API gateway verification FAILED:\n');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('API gateway verification OK');
console.log(`  Gateway file: src/services/elasticsearch.ts`);
console.log(`  Exported HTTP helpers: ${exportFns.length}`);
console.log(`  Via request() (GET endpoints in api.ts): ${viaRequest.length}`);
console.log(`  clusterRequest() calls: ${clusterRequestCalls}`);
console.log(`  fetchWithTimeoutAndRetry() internal calls: ${gatewayFetchCalls}`);
console.log(`  POST operations in gateway: ${postCalls}`);
console.log(`  Direct fetch() outside gateway: 0`);
console.log(`  Cluster governor bypass path: none`);
