#!/usr/bin/env node
/**
 * QASL WEB3 SENTINEL
 * verify-engine.js — Regression gate for the analysis engine
 *
 * Runs after `node run.js demo-dapp.har` in CI. The demo HAR is a
 * deterministic fixture, so the engine MUST always produce the same
 * detections. If any assertion fails, the engine has regressed and
 * the pipeline goes red.
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'reports', 'web3-data-demo-dapp.json');

if (!fs.existsSync(dataPath)) {
  console.error('✗ reports/web3-data-demo-dapp.json not found — run `node run.js demo-dapp.har` first.');
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const checks = [];
let failed = 0;

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  checks.push({ label, actual, expected, ok });
  if (!ok) failed++;
}

function assertTrue(label, cond, detail) {
  checks.push({ label, actual: detail ?? cond, expected: 'true', ok: !!cond });
  if (!cond) failed++;
}

// ─── CORE DETECTIONS (deterministic on the demo fixture) ─────────────────────

assertEq('Ghost errors detected (HTTP 200 + JSON-RPC error)', d.meta.ghostErrorCount, 2);
assertEq('Total JSON-RPC calls extracted',                    d.meta.totalRpcCalls, 17);
assertEq('Batch requests detected',                           d.meta.batchRequests, 1);
assertEq('RPC providers identified',                          d.meta.providerCount, 2);
assertEq('Health score computed',                             d.meta.healthScore, 55);
assertEq('Distinct RPC methods',                              d.meta.rpcMethodCount, 9);

assertTrue('Chain detected via eth_chainId',
  d.meta.chains.includes('Ethereum Mainnet'), d.meta.chains.join(','));

assertTrue('Ghost error #1: reverted eth_call decoded to allowance()',
  d.ghostErrors.some(g => g.method === 'eth_call' && String(g.selector).includes('allowance')));

assertTrue('Ghost error #2: JSON-RPC rate limit (-32005) surfaced',
  d.ghostErrors.some(g => g.method === 'eth_getLogs' && g.rpcError.toLowerCase().includes('rate limit')));

assertTrue('Slow RPC method alert raised (eth_getLogs p95 > 1500ms)',
  d.alerts.some(a => a.type === 'SLOW_RPC_METHOD' && a.title.includes('eth_getLogs')));

assertTrue('HTTP 429 rate limiting alert raised',
  d.alerts.some(a => a.type === 'RATE_LIMIT'));

assertTrue('Contract function selectors decoded (balanceOf present)',
  d.selectors.some(s => s.fn.includes('balanceOf')));

assertTrue('Integration map built (>= 6 integrations)',
  d.integrations.length >= 6, d.integrations.length);

assertTrue('WebSocket/streaming infra classified (wallet category present)',
  d.integrations.some(i => i.category === 'wallet'));

// ─── RESULTS ─────────────────────────────────────────────────────────────────

console.log('\nQASL WEB3 SENTINEL · Engine regression gate\n' + '─'.repeat(60));
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.label}` + (c.ok ? '' : `  → expected ${c.expected}, got ${c.actual}`));
}
console.log('─'.repeat(60));
console.log(`${checks.length - failed}/${checks.length} checks passed\n`);

if (failed > 0) {
  console.error(`✗ ENGINE REGRESSION: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('✓ Engine behavior verified — safe to ship.');
