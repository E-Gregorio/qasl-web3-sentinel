#!/usr/bin/env node
/**
 * QASL WEB3 LIVE SERVER
 * grafana-api.js — API de datos para el dashboard Grafana
 *
 * HTTP nativo de Node (cero dependencias).
 * Sirve SIEMPRE el último reports/web3-data-*.json generado por run.js,
 * así el dashboard es 100% dinámico: nuevo scan → nuevo dato, sin tocar nada.
 *
 * Endpoints: /health /api/sources /api/meta /api/methods /api/providers
 *            /api/integrations /api/alerts /api/ghost-errors /api/selectors
 *            /api/categories /api/endpoints /api/requests
 *   Todos aceptan ?source=web3-data-<nombre>.json para un scan específico.
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '7392', 10);
const REPORTS_DIR = process.env.REPORTS_DIR || path.join(__dirname, '..', 'reports');

const CATEGORY_LABELS = {
  'rpc':          'Proveedor RPC',
  'indexer':      'Indexer',
  'wallet':       'Wallet Infra',
  'price-api':    'API de precios',
  'explorer':     'Block Explorer',
  'security':     'Seguridad Web3',
  'identity':     'Identidad',
  'dapp':         'dApp Frontend',
  'dapp-backend': 'Backend dApp',
  'analytics':    'Analytics',
  'cdn':          'CDN / Edge',
  'other':        'Otro'
};

// ─── CARGA DE DATOS (siempre fresco, nada cacheado) ──────────────────────────

function listSources() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs.readdirSync(REPORTS_DIR)
    .filter(f => f.startsWith('web3-data-') && f.endsWith('.json'))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function loadData(sourceParam) {
  const sources = listSources();
  if (sources.length === 0) return null;

  let file = sources[0].file; // el más reciente
  if (sourceParam) {
    const wanted = sources.find(s => s.file === sourceParam || s.file === `web3-data-${sourceParam}.json`);
    if (wanted) file = wanted.file;
  }
  try {
    return { file, data: JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8')) };
  } catch {
    return null;
  }
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

const routes = {
  '/health': () => ({ status: 'ok', service: 'qasl-web3-api', reports: listSources().length }),

  '/api/sources': () => listSources().map(s => ({
    file: s.file,
    scannedAt: new Date(s.mtime).toISOString()
  })),

  '/api/meta': (d) => {
    const m = d.data.meta;
    return [{
      ...m,
      chainsLabel: m.chains.join(' · ') || 'sin detectar',
      source: d.data.source || d.file,
      generatedAt: d.data.generatedAt || null
    }];
  },

  '/api/methods': (d) => d.data.methods.map(m => ({
    metodo: m.method,
    llamadas: m.count,
    errores: m.errorCount,
    avg_ms: m.avgMs,
    p50_ms: m.p50Ms,
    p95_ms: m.p95Ms,
    proveedores: m.providers.join(', ') || '—'
  })),

  '/api/providers': (d) => d.data.providers.map(p => ({
    proveedor: p.label,
    hostname: p.hostname,
    llamadas_rpc: p.callCount,
    errores: p.errorCount,
    avg_ms: p.avgMs,
    p95_ms: p.p95Ms
  })),

  '/api/integrations': (d) => d.data.integrations.map(i => ({
    origen: i.from,
    destino: i.to,
    hostname: i.toHostname,
    categoria: CATEGORY_LABELS[i.category] || i.category,
    requests: i.requestCount,
    errores: i.errorCount,
    avg_ms: i.avgMs
  })),

  '/api/alerts': (d) => d.data.alerts.map(a => ({
    severidad: a.severity,
    tipo: a.type,
    alerta: a.title,
    detalle: a.detail,
    evidencia: a.evidence
  })),

  '/api/ghost-errors': (d) => d.data.ghostErrors.map(g => ({
    metodo: g.method,
    funcion: g.selector || '—',
    proveedor: g.provider,
    http_status: g.httpStatus,
    error_jsonrpc: g.rpcError,
    url: g.url
  })),

  '/api/selectors': (d) => d.data.selectors.map(s => ({
    funcion: s.fn,
    llamadas: s.count
  })),

  '/api/categories': (d) => {
    const counts = {};
    for (const r of d.data.requests) {
      const label = CATEGORY_LABELS[r.category] || r.category;
      counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([categoria, requests]) => ({ categoria, requests }))
      .sort((a, b) => b.requests - a.requests);
  },

  '/api/health-breakdown': (d) => (d.data.healthBreakdown || []).map(b => ({
    concepto: b.concepto,
    puntos: b.puntos
  })),

  '/api/gate': () => {
    try {
      const g = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, 'gate-result.json'), 'utf8'));
      return [{
        estado: g.status,
        checks: `${g.passed}/${g.total}`,
        fecha: g.ranAt,
        fallos: (g.failedChecks || []).join(' \u00b7 ') || '\u2014'
      }];
    } catch {
      return [{ estado: 'SIN DATOS', checks: '\u2014', fecha: '\u2014', fallos: 'ejecut\u00e1 node scripts/verify-engine.js' }];
    }
  },

  '/api/history': () => listSources()
    .slice(0, 30)
    .map(s => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, s.file), 'utf8'));
        return {
          scan: (data.source || s.file).replace('web3-data-', '').replace('.json', '').replace('.har', ''),
          fecha: new Date(s.mtime).toISOString().slice(0, 16).replace('T', ' '),
          health: data.meta.healthScore,
          ghost_errors: data.meta.ghostErrorCount,
          errores_http: data.meta.httpErrorCount,
          p95_ms: data.meta.p95Timing,
          llamadas_rpc: data.meta.totalRpcCalls
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .reverse(),

  '/api/timeline': (d) => d.data.requests
    .filter((r, i) => i === 0 || r.isJsonRpc || r.status >= 400 || (r.rpcErrors && r.rpcErrors.length))
    .slice(0, 150)
    .map((r, i) => ({
      hora: r.t ? String(r.t).slice(11, 23) : '\u2014',
      evento: (r.rpcMethods && r.rpcMethods.length) ? r.rpcMethods.join(', ') : (i === 0 ? 'Carga de la dApp' : `${r.httpMethod} ${r.status}`),
      destino: r.label,
      estado: (r.rpcErrors && r.rpcErrors.length) ? 'ERROR RPC' : (r.status >= 400 ? `HTTP ${r.status}` : 'OK'),
      detalle: (r.rpcErrors && r.rpcErrors.length) ? r.rpcErrors.join(' \u00b7 ') : '\u2014'
    })),

  '/api/chains': (d) => (d.data.chainActivity || []).map(c => ({
    blockchain: c.chain,
    llamadas_rpc: c.rpcCalls,
    hosts: c.hosts.join(', ')
  })),

  '/api/transactions': (d) => (d.data.transactions || []).map(t => ({
    tx_hash: t.hash.slice(0, 10) + '…' + t.hash.slice(-6),
    estado: t.status === 'success' ? 'CONFIRMADA' : t.status === 'reverted' ? 'REVERTIDA' : t.status.toUpperCase(),
    polls_receipt: t.polls,
    confirmacion_ms: t.timeToReceiptMs ?? '—'
  })),

  '/api/wallet-infra': (d) => d.data.systems
    .filter(s => s.category === 'wallet')
    .map(s => ({
      servicio: s.label,
      hostname: s.hostname,
      requests: s.requestCount,
      errores: s.errorCount,
      avg_ms: s.avgMs
    }))
    .sort((a, b) => b.requests - a.requests),

  '/api/endpoints': (d) => {
    // Agrupa la evidencia por endpoint (URL + método HTTP) dentro de cada integración
    const groups = new Map();
    for (const r of d.data.requests) {
      const key = `${r.url}|${r.httpMethod}`;
      if (!groups.has(key)) {
        groups.set(key, {
          integracion: r.label,
          categoria: CATEGORY_LABELS[r.category] || r.category,
          endpoint: r.url,
          metodo_http: r.httpMethod,
          requests: 0,
          errores: 0,
          statuses: new Set(),
          rpcMethods: new Set(),
          rpcErrors: new Set(),
          timings: []
        });
      }
      const g = groups.get(key);
      g.requests++;
      g.statuses.add(r.status > 0 ? r.status : 'WS');
      g.timings.push(r.timing);
      if (r.status >= 400) g.errores++;
      for (const m of r.rpcMethods) g.rpcMethods.add(m);
      for (const e of r.rpcErrors) { g.rpcErrors.add(e); g.errores++; }
    }
    return [...groups.values()].map(g => {
      const sorted = [...g.timings].sort((a, b) => a - b);
      return {
        integracion: g.integracion,
        categoria: g.categoria,
        endpoint: g.endpoint,
        metodo_http: g.metodo_http,
        metodos_rpc: [...g.rpcMethods].join(', ') || '—',
        requests: g.requests,
        status: [...g.statuses].sort().join(', '),
        errores: g.errores,
        respuesta: g.errores > 0 ? 'CON ERRORES' : 'OK',
        detalle_error: [...g.rpcErrors].join(' · ') || '—',
        avg_ms: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        max_ms: sorted[sorted.length - 1]
      };
    }).sort((a, b) => b.errores - a.errores || b.requests - a.requests);
  },

  '/api/requests': (d) => d.data.requests.map(r => ({
    categoria: CATEGORY_LABELS[r.category] || r.category,
    sistema: r.label,
    url: r.url,
    metodo_http: r.httpMethod,
    status: r.status,
    tiempo_ms: r.timing,
    metodos_rpc: r.rpcMethods.join(', ') || '—',
    error_rpc: r.rpcErrors.join(' · ') || '—'
  }))
};

// ─── SERVIDOR ───

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = routes[url.pathname];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!route) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Ruta no encontrada', rutas: Object.keys(routes) }));
    return;
  }

  if (url.pathname === '/health' || url.pathname === '/api/sources') {
    res.writeHead(200);
    res.end(JSON.stringify(route(), null, 2));
    return;
  }

  const d = loadData(url.searchParams.get('source'));
  if (!d) {
    res.writeHead(200);
    res.end(JSON.stringify([]));
    return;
  }

  try {
    res.writeHead(200);
    res.end(JSON.stringify(route(d), null, 2));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  QASL WEB3 SENTINEL \u00b7 API de datos`);
  console.log(`  Escuchando en http://localhost:${PORT}`);
  console.log(`  Reports dir: ${REPORTS_DIR} (${listSources().length} scans disponibles)`);
  console.log(`  Rutas: ${Object.keys(routes).join(', ')}\n`);
});
