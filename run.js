#!/usr/bin/env node
/**
 * QASL WEB3 LIVE SERVER
 * run.js — Punto de entrada
 *
 * Uso:
 *   node run.js mi-dapp.har
 *   node run.js                  (toma el primer .har en /input)
 *   npm run demo                 (corre el HAR de demostración)
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parseHAR }       = require('./src/web3-parser');
const { generateReport } = require('./src/report-generator');

// ─── COLORES DE CONSOLA ───────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  purple: '\x1b[35m'
};

function log(color, prefix, msg) {
  console.log(`${color}${prefix}${C.reset} ${msg}`);
}

// ─── BANNER ───────────────────────────────────────────────────────────────────
function printBanner() {
  console.log('');
  console.log(`${C.cyan}${C.bold}  ██████╗  █████╗ ███████╗██╗      ██╗    ██╗██████╗ ${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ██╔═══██╗██╔══██╗██╔════╝██║      ██║    ██║╚════██╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ██║   ██║███████║███████╗██║      ██║ █╗ ██║ █████╔╝${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ██║▄▄ ██║██╔══██║╚════██║██║      ██║███╗██║ ╚═══██╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ╚██████╔╝██║  ██║███████║███████╗ ╚███╔███╔╝██████╔╝${C.reset}`);
  console.log(`${C.cyan}${C.bold}   ╚══▀▀═╝ ╚═╝  ╚═╝╚══════╝╚══════╝  ╚══╝╚══╝ ╚═════╝ ${C.reset}`);
  console.log('');
  console.log(`${C.purple}  QASL WEB3 SENTINEL${C.reset}`);
  console.log(`${C.dim}  Web3 Integration Observability · JSON-RPC analysis from HAR evidence${C.reset}`);
  console.log(`${C.dim}  Elyer Gregorio Maldonado · SDET / QA Automation${C.reset}`);
  console.log('');
  console.log(`${C.dim}  ${'─'.repeat(54)}${C.reset}`);
  console.log('');
}

// ─── ENCONTRAR ARCHIVO HAR ────────────────────────────────────────────────────
function resolveHarFile(arg) {
  if (arg) {
    const inInput = path.join(__dirname, 'input', arg);
    if (fs.existsSync(inInput)) return inInput;
    if (fs.existsSync(arg)) return path.resolve(arg);
    throw new Error(`No se encontró el archivo HAR: ${arg}`);
  }

  const inputDir = path.join(__dirname, 'input');
  if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });

  const harFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.har'));
  if (harFiles.length === 0) {
    throw new Error(`No hay archivos .har en ${inputDir}\nCopiá tu .har ahí y volvé a correr.`);
  }
  if (harFiles.length > 1) {
    console.log(`${C.yellow}  [WARN]${C.reset} Hay ${harFiles.length} .har en /input — usando: ${harFiles[0]}`);
    console.log(`${C.dim}  Tip: indicá el archivo explícitamente → node run.js <archivo.har>${C.reset}\n`);
  }
  return path.join(inputDir, harFiles[0]);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  const arg = process.argv[2];
  let harPath;

  try {
    harPath = resolveHarFile(arg);
  } catch (err) {
    log(C.red, '  [ERROR]', err.message);
    console.log(`\n${C.dim}  Uso: node run.js <archivo.har>${C.reset}`);
    console.log(`${C.dim}  Demo: npm run demo${C.reset}\n`);
    process.exit(1);
  }

  const harFilename = path.basename(harPath);
  log(C.cyan, '  [HAR]', `Leyendo: ${harFilename}`);
  log(C.cyan, '  [PARSE]', 'Analizando tráfico dApp / JSON-RPC...');

  let parsed;
  try {
    parsed = parseHAR(fs.readFileSync(harPath, 'utf8'));
  } catch (err) {
    log(C.red, '  [ERROR]', `Error al parsear el HAR: ${err.message}`);
    process.exit(1);
  }

  const { meta, methods, providers, integrations, ghostErrors, alerts } = parsed;

  // ── RESUMEN EN CONSOLA ─────────────────────────────────────────────────────
  const healthColor = meta.healthScore >= 80 ? C.green : meta.healthScore >= 50 ? C.yellow : C.red;
  console.log('');
  console.log(`${C.bold}  Resumen del análisis Web3${C.reset}`);
  console.log(`${C.dim}  ${'─'.repeat(44)}${C.reset}`);
  console.log(`  Health Score          ${healthColor}${C.bold}${meta.healthScore}/100${C.reset}`);
  console.log(`  Requests HTTP         ${C.bold}${meta.totalRequests}${C.reset}`);
  console.log(`  Llamadas JSON-RPC     ${C.cyan}${meta.totalRpcCalls}${C.reset} ${C.dim}(${meta.batchRequests} batch)${C.reset}`);
  console.log(`  Métodos RPC           ${C.cyan}${meta.rpcMethodCount}${C.reset}`);
  console.log(`  Proveedores RPC       ${C.purple}${meta.providerCount}${C.reset}`);
  console.log(`  Chains detectadas     ${C.yellow}${meta.chains.join(', ') || 'ninguna'}${C.reset}`);
  console.log(`  Errores fantasma      ${meta.ghostErrorCount > 0 ? C.red : C.green}${meta.ghostErrorCount}${C.reset} ${C.dim}(HTTP 200 + error JSON-RPC)${C.reset}`);
  console.log(`  Errores HTTP          ${meta.httpErrorCount > 0 ? C.red : C.dim}${meta.httpErrorCount}${C.reset}`);
  console.log(`  Latencia avg / p95    ${C.dim}${meta.avgTiming}ms / ${meta.p95Timing}ms${C.reset}`);
  console.log('');

  // Métodos top
  if (methods.length > 0) {
    console.log(`${C.bold}  Métodos JSON-RPC más llamados${C.reset}`);
    for (const m of methods.slice(0, 8)) {
      const err = m.errorCount > 0 ? ` ${C.red}(${m.errorCount} err)${C.reset}` : '';
      console.log(`  ${C.cyan}■${C.reset} ${C.bold}${m.method}${C.reset} · ${m.count} llamadas · p95 ${m.p95Ms}ms${err}`);
    }
    console.log('');
  }

  // Errores fantasma — el diferenciador
  if (ghostErrors.length > 0) {
    console.log(`${C.red}${C.bold}  Errores fantasma detectados${C.reset} ${C.dim}(pasarían en verde en Postman)${C.reset}`);
    for (const g of ghostErrors) {
      console.log(`  ${C.red}✗${C.reset} ${g.method}${g.selector ? ` → ${g.selector}` : ''} ${C.dim}en ${g.provider}${C.reset}`);
    console.log(`    ${C.dim}HTTP ${g.httpStatus} pero: ${g.rpcError}${C.reset}`);
    }
    console.log('');
  }

  // Integraciones
  if (integrations.length > 0) {
    console.log(`${C.bold}  Mapa de integraciones dApp${C.reset}`);
    for (const i of integrations) {
      console.log(`  ${C.green}${i.from}${C.reset} ${C.dim}→${C.reset} ${C.purple}${i.to}${C.reset} ${C.dim}[${i.category}] · ${i.requestCount} req · avg ${i.avgMs}ms${C.reset}`);
    }
    console.log('');
  }

  // Alertas
  if (alerts.length > 0) {
    console.log(`${C.bold}  Alertas (${alerts.length})${C.reset}`);
    const sevColor = { CRITICAL: C.red, ERROR: C.red, WARNING: C.yellow, INFO: C.cyan };
    for (const a of alerts) {
      console.log(`  ${sevColor[a.severity]}[${a.severity}]${C.reset} ${a.title}`);
    }
    console.log('');
  }

  // ── SALIDAS ────────────────────────────────────────────────────────────────
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  log(C.cyan, '  [REPORT]', 'Generando informe HTML...');
  const { outputPath, filename } = generateReport(parsed, harFilename, reportsDir);
  log(C.green, '  [DONE]', `Reporte: reports/${filename}`);

  const base = harFilename.replace(/\.har$/i, '');
  const jsonPath = path.join(reportsDir, `web3-data-${base}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: harFilename,
    ...parsed
  }, null, 2), 'utf8');
  log(C.green, '  [DONE]', `Datos JSON: reports/web3-data-${base}.json`);

  console.log('');
  console.log(`${C.dim}  ${'─'.repeat(54)}${C.reset}`);
  console.log(`${C.cyan}  Abrí el reporte en tu browser:${C.reset}`);
  console.log(`  ${C.bold}${outputPath}${C.reset}`);
  console.log('');
}

main().catch(err => {
  console.error(`\n${C.red}  [FATAL] ${err.message}${C.reset}\n`);
  process.exit(1);
});
