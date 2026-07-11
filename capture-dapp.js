#!/usr/bin/env node
/**
 * QASL WEB3 LIVE SERVER
 * capture-dapp.js — Captura automatizada de tráfico dApp con Playwright
 *
 * Navega a una dApp, ejecuta un flujo de lectura (sin firma de wallet)
 * y graba TODO el tráfico en un .har con bodies incluidos, listo para
 * el motor de análisis.
 *
 * Uso:
 *   node capture-dapp.js                          → Uniswap (por defecto)
 *   node capture-dapp.js https://app.aave.com aave-session
 *   node capture-dapp.js <url> <nombre> --headless
 *
 * Requisitos (solo para captura, el motor sigue siendo cero deps):
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Pipeline completo:
 *   node capture-dapp.js  →  input/<nombre>.har  →  node run.js <nombre>.har
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const C = { reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', bold: '\x1b[1m', dim: '\x1b[2m' };
const log = (color, prefix, msg) => console.log(`${color}${prefix}${C.reset} ${msg}`);

// ─── ARGUMENTOS ───────────────────────────────────────────────────────────────

const args     = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags    = process.argv.slice(2).filter(a => a.startsWith('--'));
const targetUrl = args[0] || 'https://app.uniswap.org/';
const name      = (args[1] || new URL(targetUrl).hostname.replace(/^app\.|^www\./, '').split('.')[0] + '-session')
                  .replace(/[^a-z0-9-_]/gi, '-');
const headless  = flags.includes('--headless');

const inputDir = path.join(__dirname, 'input');
const harPath  = path.join(inputDir, `${name}.har`);

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    log(C.red, '[ERROR]', 'Playwright no está instalado.');
    console.log(`${C.dim}  Instalá con:  npm i -D playwright && npx playwright install chromium${C.reset}`);
    process.exit(1);
  }

  if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });

  console.log('');
  log(C.cyan, '[CAPTURE]', `dApp objetivo : ${targetUrl}`);
  log(C.cyan, '[CAPTURE]', `Salida HAR    : input/${name}.har`);
  log(C.cyan, '[CAPTURE]', `Modo          : ${headless ? 'headless' : 'navegador visible'}`);
  console.log('');

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // recordHar con content embebido: imprescindible para que el motor
    // pueda abrir los bodies JSON-RPC (métodos, errores fantasma, selectores)
    recordHar: { path: harPath, content: 'embed' },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Contador de tráfico JSON-RPC en vivo
  let rpcCount = 0;
  page.on('request', req => {
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      if (body.includes('"jsonrpc"') && body.includes('"method"')) {
        rpcCount++;
        const m = body.match(/"method"\s*:\s*"([^"]+)"/);
        log(C.dim, '  [RPC]', `${m ? m[1] : '?'} → ${new URL(req.url()).hostname}`);
      }
    }
  });

  try {
    log(C.cyan, '[NAV]', 'Cargando la dApp...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Dejar que la dApp inicialice: detección de red, precios, pools...
    log(C.cyan, '[FLOW]', 'Esperando inicialización (chainId, precios, pools)...');
    await page.waitForTimeout(8000);

    // Scroll para disparar cargas lazy
    log(C.cyan, '[FLOW]', 'Scroll para disparar cargas diferidas...');
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, -1200);

    // Intento suave de interacción (si existe un buscador/selector de token)
    log(C.cyan, '[FLOW]', 'Ventana de interacción manual: 20 segundos.');
    console.log(`${C.yellow}  → Si el navegador está visible, podés interactuar AHORA (cotizar un swap, abrir un pool, etc.)${C.reset}`);
    console.log(`${C.dim}    Todo lo que hagas queda grabado en el HAR. NO firmes transacciones reales.${C.reset}`);
    await page.waitForTimeout(20000);

    log(C.cyan, '[FLOW]', 'Espera final para respuestas pendientes...');
    await page.waitForTimeout(5000);
  } catch (err) {
    log(C.yellow, '[WARN]', `Navegación con incidencias: ${err.message}`);
    log(C.yellow, '[WARN]', 'Se guarda igual lo capturado hasta ahora.');
  }

  // Cerrar contexto = Playwright escribe el HAR
  await context.close();
  await browser.close();

  if (!fs.existsSync(harPath)) {
    log(C.red, '[ERROR]', 'No se generó el HAR.');
    process.exit(1);
  }

  const sizeMb = (fs.statSync(harPath).size / 1024 / 1024).toFixed(1);
  console.log('');
  log(C.green, '[DONE]', `HAR capturado: input/${name}.har (${sizeMb} MB)`);
  log(C.green, '[DONE]', `Llamadas JSON-RPC observadas en vivo: ${rpcCount}`);
  console.log('');
  console.log(`${C.bold}  Siguiente paso — analizar la captura:${C.reset}`);
  console.log(`${C.cyan}  node run.js ${name}.har${C.reset}`);
  console.log('');
}

main().catch(err => {
  console.error(`\n${C.red}[FATAL] ${err.message}${C.reset}\n`);
  process.exit(1);
});
