#!/usr/bin/env node
/**
 * QASL WEB3 SENTINEL
 * capture-wallet-dapp.js — Flujo de wallet automatizado: MetaMask real + Dappwright
 *
 * Qué hace:
 *   1. Lanza Chromium con la extensión REAL de MetaMask (la descarga Dappwright)
 *   2. Importa una wallet de PRUEBA (seed pública de testing, SIN fondos)
 *   3. Navega a la dApp e intenta conectar la wallet automáticamente
 *   4. Te da una ventana manual para completar/explorar el flujo
 *   5. Graba TODO el tráfico en input/<nombre>.har → listo para node run.js
 *
 * Uso:
 *   node capture-wallet-dapp.js                                → Uniswap
 *   node capture-wallet-dapp.js https://app.aave.com aave-wallet
 *
 * Requisitos (una sola vez):
 *   npm i -D @tenkeylabs/dappwright
 *   (la primera ejecución descarga MetaMask — puede tardar 1-2 min)
 *
 * SEGURIDAD: la seed de abajo es la wallet de testing pública estándar
 * (Hardhat/Anvil). Es desechable y conocida por todo el mundo — NUNCA le
 * envíes fondos reales, y NUNCA pongas tu seed personal en código.
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

// Dappwright está pensado para Playwright Test, que define TEST_PARALLEL_INDEX.
// Al correr standalone la variable no existe y Dappwright espera eternamente
// a un "primary worker" fantasma. Nos declaramos worker principal:
process.env.TEST_PARALLEL_INDEX = process.env.TEST_PARALLEL_INDEX || '0';

const path = require('path');
const fs   = require('fs');
const { attachHarRecorder } = require('./src/har-recorder');

const C = { reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', bold: '\x1b[1m', dim: '\x1b[2m' };
const log = (color, prefix, msg) => console.log(`${color}${prefix}${C.reset} ${msg}`);

// Seed pública estándar de testing (Hardhat/Anvil) — desechable, sin fondos.
const TEST_SEED = 'test test test test test test test test test test test junk';

const args      = process.argv.slice(2).filter(a => !a.startsWith('--'));
const targetUrl = args[0] || 'https://app.uniswap.org/';
const name      = (args[1] || 'wallet-session').replace(/[^a-z0-9-_]/gi, '-');
const harPath   = path.join(__dirname, 'input', `${name}.har`);

async function main() {
  let dappwright;
  try {
    dappwright = require('@tenkeylabs/dappwright');
  } catch {
    log(C.red, '[ERROR]', 'Dappwright no está instalado.');
    console.log(`${C.dim}  Instalá con:  npm i -D @tenkeylabs/dappwright${C.reset}`);
    process.exit(1);
  }

  console.log('');
  log(C.cyan, '[WALLET]', 'Lanzando Chromium con MetaMask real (Dappwright)...');
  log(C.dim, '        ', 'La primera vez descarga la extensión — paciencia (1-2 min).');

  let wallet, page, context;
  try {
    const recommended = dappwright.MetaMaskWallet
      ? dappwright.MetaMaskWallet.recommendedVersion
      : undefined;

    [wallet, page, context] = await dappwright.bootstrap('', {
      wallet: 'metamask',
      version: recommended,
      seed: TEST_SEED,
      headless: false
    });
  } catch (err) {
    log(C.red, '[ERROR]', `No se pudo iniciar MetaMask: ${err.message}`);
    console.log(`${C.dim}  Tip: borrá la cache de dappwright (carpeta .dappwright o node_modules/.cache) y reintentá.${C.reset}`);
    process.exit(1);
  }

  log(C.green, '[WALLET]', 'MetaMask listo — wallet de prueba importada (sin fondos).');

  // ── Grabador HAR sobre el contexto de Dappwright ──
  const recorder = attachHarRecorder(context);

  // Contador JSON-RPC en vivo
  context.on('request', (req) => {
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      if (body.includes('"jsonrpc"') && body.includes('"method"')) {
        const m = body.match(/"method"\s*:\s*"([^"]+)"/);
        try {
          log(C.dim, '  [RPC]', `${m ? m[1] : '?'} → ${new URL(req.url()).hostname}`);
        } catch { /* noop */ }
      }
    }
  });

  // ── Navegar a la dApp ──
  console.log('');
  log(C.cyan, '[NAV]', `Abriendo ${targetUrl} ...`);
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
  } catch (err) {
    log(C.yellow, '[WARN]', `Carga con incidencias: ${err.message} — seguimos.`);
  }

  // ── Intento de conexión automática de wallet ──
  log(C.cyan, '[CONNECT]', 'Intentando conectar la wallet automáticamente...');
  let autoConnected = false;
  try {
    // 1. Botón "Connect" de la dApp (heurístico — cada dApp es distinta)
    const connectBtn = page.getByRole('button', { name: /connect/i }).first();
    await connectBtn.click({ timeout: 6000 });
    await page.waitForTimeout(2000);

    // 2. Elegir MetaMask en el modal de wallets (si aparece)
    try {
      await page.getByText(/metamask/i).first().click({ timeout: 5000 });
    } catch { /* algunas dApps conectan directo */ }
    await page.waitForTimeout(2000);

    // 3. Aprobar en el popup de MetaMask
    await wallet.approve();
    autoConnected = true;
    log(C.green, '[CONNECT]', 'Wallet conectada automáticamente ✓');
  } catch (err) {
    log(C.yellow, '[CONNECT]', `Conexión automática no completada (${err.message.split('\n')[0]}).`);
    log(C.yellow, '        ', 'No pasa nada: conectala a mano en la ventana que sigue.');
  }

  // ── Ventana de interacción manual ──
  console.log('');
  log(C.bold, '[MANUAL]', 'Ventana de interacción: 60 segundos.');
  console.log(`${C.yellow}  → ${autoConnected ? 'Explorá la dApp conectado: mirá balances, cotizá un swap (SIN confirmar).'
    : 'Conectá la wallet a mano: botón Connect → MetaMask → Approve. Después explorá.'}${C.reset}`);
  console.log(`${C.dim}    Todo queda grabado. La wallet es de prueba y no tiene fondos — no se puede perder nada.${C.reset}`);
  await page.waitForTimeout(60000);

  log(C.cyan, '[FLOW]', 'Espera final para respuestas pendientes...');
  await page.waitForTimeout(5000);

  // ── Guardar HAR y cerrar ──
  const result = await recorder.save(harPath);
  try { await context.close(); } catch { /* noop */ }

  const sizeMb = (fs.statSync(harPath).size / 1024 / 1024).toFixed(1);
  console.log('');
  log(C.green, '[DONE]', `HAR del flujo de wallet: input/${name}.har (${result.entries} requests, ${sizeMb} MB)`);