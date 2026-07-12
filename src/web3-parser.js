/**
 * QASL WEB3 SENTINEL
 * web3-parser.js — Motor de análisis de tráfico dApp desde archivos HAR
 *
 * Qué hace distinto a un parser HTTP clásico:
 *   - Abre el body de cada request/response y extrae llamadas JSON-RPC
 *     (simples y batch), método por método.
 *   - Detecta "errores fantasma": HTTP 200 con error JSON-RPC en el body.
 *   - Decodifica selectores de función en eth_call (balanceOf, approve...).
 *   - Calcula latencia avg / p50 / p95 por método RPC y por proveedor.
 *   - Separa lecturas de escrituras on-chain y rastrea el ciclo de vida
 *     de transacciones (send → polls de receipt → confirmación).
 *   - Atribuye actividad por blockchain (eth_chainId + hostname del proveedor).
 *   - Extrae gas price y estimaciones de gas de las respuestas.
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const {
  classifyHost,
  looksLikeJsonRpc,
  chainLabel,
  inferChainFromHost,
  decodeSelector,
  describeRpcError
} = require('./rpc-detector');

// Métodos que ESCRIBEN en la blockchain (cuestan gas, requieren firma)
const WRITE_METHODS = new Set(['eth_sendRawTransaction', 'eth_sendTransaction']);

// Métodos cuyo result crudo nos interesa conservar (gas, tx lifecycle, chain)
const RESULT_WHITELIST = new Set([
  'eth_chainId', 'eth_gasPrice', 'eth_estimateGas',
  'eth_sendRawTransaction', 'eth_getTransactionReceipt'
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

function round(n) { return Math.round(n * 10) / 10; }

// ─── EXTRACCIÓN JSON-RPC ─────────────────────────────────────────────────────

function extractRpcCalls(entry) {
  const postText = entry.request?.postData?.text;
  if (!looksLikeJsonRpc(postText)) return [];

  const reqBody = safeJsonParse(postText);
  if (!reqBody) return [];

  const respText = entry.response?.content?.text;
  const respBody = respText ? safeJsonParse(respText) : null;

  const reqCalls  = Array.isArray(reqBody) ? reqBody : [reqBody];
  const respById  = new Map();

  if (respBody) {
    const respItems = Array.isArray(respBody) ? respBody : [respBody];
    for (const r of respItems) {
      if (r && r.id !== undefined) respById.set(String(r.id), r);
    }
  }

  const calls = [];
  for (const c of reqCalls) {
    if (!c || typeof c.method !== 'string') continue;

    const resp = respById.get(String(c.id)) ||
                 (reqCalls.length === 1 && respBody && !Array.isArray(respBody) ? respBody : null);

    let selector = null;
    if (c.method === 'eth_call' && Array.isArray(c.params) && c.params[0]?.data) {
      selector = decodeSelector(c.params[0].data);
    }

    let chainHint = null;
    if (c.method === 'eth_chainId' && resp?.result) {
      chainHint = chainLabel(resp.result);
    }

    let error = null;
    if (resp?.error) {
      error = {
        code: resp.error.code,
        message: resp.error.message || '',
        description: describeRpcError(resp.error.code, resp.error.message)
      };
    }

    calls.push({
      method: c.method,
      id: c.id,
      selector,
      chainHint,
      error,
      isBatch: reqCalls.length > 1,
      resultSize: resp?.result !== undefined ? JSON.stringify(resp.result).length : 0,
      resultValue: RESULT_WHITELIST.has(c.method) && resp?.result !== undefined ? resp.result : undefined,
      txParam: c.method === 'eth_getTransactionReceipt' && Array.isArray(c.params) ? c.params[0] : undefined
    });
  }
  return calls;
}

// ─── PARSER PRINCIPAL ────────────────────────────────────────────────────────

function parseHAR(harContent) {
  const har = typeof harContent === 'string' ? safeJsonParse(harContent) : harContent;
  if (!har?.log?.entries) throw new Error('El archivo no es un HAR 1.2 válido (falta log.entries).');

  const entries = har.log.entries;

  const requests   = [];
  const systems    = new Map();
  const methods    = new Map();
  const providers  = new Map();
  const chains     = new Set();
  const selectors  = new Map();
  const alerts     = [];
  const ghostErrors = [];

  let totalRpcCalls = 0;
  let batchRequests = 0;
  let pageHost = null;

  // Web3-nativo: lecturas vs escrituras, gas, multi-chain, ciclo de vida de tx
  let readCalls = 0;
  let writeCalls = 0;
  let gasPriceGwei = null;
  const gasEstimates = [];
  const chainByHost = new Map();
  const chainActivity = new Map();
  const txs = new Map();

  const firstDoc = entries.find(e => e.request?.url && (e._resourceType === 'document' || e.response?.content?.mimeType?.includes('html')));
  if (firstDoc) {
    try { pageHost = new URL(firstDoc.request.url).hostname; } catch { /* noop */ }
  }

  for (const entry of entries) {
    let url;
    try { url = new URL(entry.request.url); } catch { continue; }

    const hostname = url.hostname;
    const status   = entry.response?.status ?? 0;
    const timing   = Math.max(0, Math.round(entry.time || 0));
    const method   = entry.request?.method || 'GET';
    const postText = entry.request?.postData?.text;
    const isJsonRpc = looksLikeJsonRpc(postText);

    const cls = classifyHost(hostname, { isJsonRpc, pageHost });

    if (!systems.has(hostname)) {
      systems.set(hostname, {
        hostname, label: cls.label, category: cls.category,
        requestCount: 0, errorCount: 0, rpcCallCount: 0, timings: []
      });
    }
    const sys = systems.get(hostname);
    sys.requestCount++;
    sys.timings.push(timing);
    if (status >= 400) sys.errorCount++;

    const rpcCalls = extractRpcCalls(entry);
    const entryRpcErrors = [];

    if (rpcCalls.length > 0) {
      totalRpcCalls += rpcCalls.length;
      sys.rpcCallCount += rpcCalls.length;
      if (rpcCalls.length > 1 || rpcCalls[0]?.isBatch) batchRequests++;

      if (cls.category === 'rpc') {
        if (!providers.has(cls.label)) {
          providers.set(cls.label, { label: cls.label, hostname, callCount: 0, errorCount: 0, timings: [] });
        }
        const prov = providers.get(cls.label);
        prov.callCount += rpcCalls.length;
        prov.timings.push(timing);
      }

      const entryEpoch = Date.parse(entry.startedDateTime) || Date.now();

      for (const call of rpcCalls) {
        if (!methods.has(call.method)) {
          methods.set(call.method, { method: call.method, count: 0, errorCount: 0, timings: [], providers: new Set() });
        }
        const m = methods.get(call.method);
        m.count++;
        m.timings.push(timing);
        if (cls.category === 'rpc') m.providers.add(cls.label);

        if (call.chainHint) chains.add(call.chainHint);
        if (call.selector) selectors.set(call.selector, (selectors.get(call.selector) || 0) + 1);

        // ── Lecturas vs escrituras on-chain ──
        if (WRITE_METHODS.has(call.method)) writeCalls++; else readCalls++;

        // ── Atribución multi-chain (subdominio del host o eth_chainId visto) ──
        if (call.chainHint) chainByHost.set(hostname, call.chainHint);
        const callChain = inferChainFromHost(hostname) || chainByHost.get(hostname);
        if (callChain) chains.add(callChain);
        if (cls.category === 'rpc') {
          const key = callChain || 'Red no identificada';
          if (!chainActivity.has(key)) chainActivity.set(key, { rpcCalls: 0, hosts: new Set() });
          const ca = chainActivity.get(key);
          ca.rpcCalls++;
          ca.hosts.add(hostname);
        }

        // ── Gas ──
        if (call.method === 'eth_gasPrice' && typeof call.resultValue === 'string') {
          const wei = parseInt(call.resultValue, 16);
          if (!Number.isNaN(wei)) gasPriceGwei = round(wei / 1e9);
        }
        if (call.method === 'eth_estimateGas' && typeof call.resultValue === 'string') {
          const units = parseInt(call.resultValue, 16);
          if (!Number.isNaN(units)) gasEstimates.push(units);
        }

        // ── Ciclo de vida de transacciones ──
        if (WRITE_METHODS.has(call.method) && typeof call.resultValue === 'string' && call.resultValue.startsWith('0x')) {
          txs.set(call.resultValue, {
            hash: call.resultValue, sentAt: entryEpoch, polls: 0,
            timeToReceiptMs: null, status: 'pending'
          });
        }
        if (call.method === 'eth_getTransactionReceipt' && call.txParam && txs.has(call.txParam)) {
          const tx = txs.get(call.txParam);
          tx.polls++;
          if (call.resultValue && tx.timeToReceiptMs === null) {
            tx.timeToReceiptMs = Math.max(0, entryEpoch + timing - tx.sentAt);
            tx.status = call.resultValue.status === '0x1' ? 'success'
              : call.resultValue.status === '0x0' ? 'reverted' : 'confirmed';
          }
        }

        if (call.error) {
          m.errorCount++;
          entryRpcErrors.push(call);
          if (cls.category === 'rpc') providers.get(cls.label).errorCount++;

          if (status >= 200 && status < 300) {
            ghostErrors.push({
              hostname,
              provider: cls.label,
              method: call.method,
              selector: call.selector,
              httpStatus: status,
              rpcError: call.error.description,
              url: url.origin + url.pathname
            });
          }
        }
      }
    }

    requests.push({
      url: url.origin + url.pathname,
      hostname,
      category: cls.category,
      label: cls.label,
      httpMethod: method,
      status,
      timing,
      isJsonRpc,
      t: entry.startedDateTime || null,
      rpcMethods: rpcCalls.map(c => c.method),
      rpcErrors: entryRpcErrors.map(c => c.error.description),
      selectors: rpcCalls.map(c => c.selector).filter(Boolean)
    });
  }

  // ─── AGREGACIONES ──────────────────────────────────────────────────────────

  const methodStats = [...methods.values()].map(m => {
    const sorted = [...m.timings].sort((a, b) => a - b);
    return {
      method: m.method,
      count: m.count,
      errorCount: m.errorCount,
      avgMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      providers: [...m.providers]
    };
  }).sort((a, b) => b.count - a.count);

  const providerStats = [...providers.values()].map(p => {
    const sorted = [...p.timings].sort((a, b) => a - b);
    return {
      label: p.label,
      hostname: p.hostname,
      callCount: p.callCount,
      errorCount: p.errorCount,
      avgMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      p95Ms: percentile(sorted, 95)
    };
  }).sort((a, b) => b.callCount - a.callCount);

  const systemStats = [...systems.values()].map(s => {
    const sorted = [...s.timings].sort((a, b) => a - b);
    return {
      hostname: s.hostname,
      label: s.label,
      category: s.category,
      requestCount: s.requestCount,
      errorCount: s.errorCount,
      rpcCallCount: s.rpcCallCount,
      avgMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
    };
  }).sort((a, b) => b.requestCount - a.requestCount);

  // Mapa de integraciones agrupado por etiqueta (subdominios = UNA integración)
  const from = pageHost || 'dApp Frontend';
  const integrationGroups = new Map();
  for (const s of systemStats) {
    if (s.category === 'other' || s.hostname === pageHost) continue;
    const key = `${s.label}|${s.category}`;
    if (!integrationGroups.has(key)) {
      integrationGroups.set(key, {
        from, to: s.label, category: s.category,
        hostnames: [], requestCount: 0, errorCount: 0, _timeWeighted: 0
      });
    }
    const g = integrationGroups.get(key);
    g.hostnames.push(s.hostname);
    g.requestCount += s.requestCount;
    g.errorCount += s.errorCount;
    g._timeWeighted += s.avgMs * s.requestCount;
  }
  const integrations = [...integrationGroups.values()].map(g => ({
    from: g.from,
    to: g.to,
    toHostname: g.hostnames.join(', '),
    category: g.category,
    requestCount: g.requestCount,
    errorCount: g.errorCount,
    avgMs: round(g._timeWeighted / g.requestCount)
  })).sort((a, b) => b.requestCount - a.requestCount);

  // ─── ALERTAS ───────────────────────────────────────────────────────────────

  for (const g of ghostErrors) {
    alerts.push({
      severity: 'CRITICAL',
      type: 'GHOST_ERROR',
      title: `Error fantasma: HTTP ${g.httpStatus} pero JSON-RPC falló`,
      detail: `${g.method}${g.selector ? ` → ${g.selector}` : ''} en ${g.provider}: ${g.rpcError}`,
      evidence: g.url
    });
  }

  for (const m of methodStats) {
    if (m.p95Ms > 1500 && m.count >= 2) {
      alerts.push({
        severity: 'WARNING',
        type: 'SLOW_RPC_METHOD',
        title: `Método RPC lento: ${m.method}`,
        detail: `p95 = ${m.p95Ms}ms sobre ${m.count} llamadas (${m.providers.join(', ') || 'proveedor desconocido'})`,
        evidence: m.method
      });
    }
  }

  if (providerStats.length > 1) {
    alerts.push({
      severity: 'INFO',
      type: 'MULTI_PROVIDER',
      title: `${providerStats.length} proveedores RPC en la misma sesión`,
      detail: `${providerStats.map(p => p.label).join(', ')} — revisar consistencia de respuestas y estrategia de fallback.`,
      evidence: providerStats.map(p => p.hostname).join(', ')
    });
  }

  if (chains.size > 1) {
    alerts.push({
      severity: 'INFO',
      type: 'MULTI_CHAIN',
      title: `Sesión multi-chain: ${[...chains].join(' + ')}`,
      detail: 'La dApp consultó más de una red en la misma sesión.',
      evidence: [...chains].join(', ')
    });
  }

  const rateLimited = requests.filter(r => r.status === 429);
  if (rateLimited.length > 0) {
    alerts.push({
      severity: 'ERROR',
      type: 'RATE_LIMIT',
      title: `Rate limiting detectado (${rateLimited.length} × HTTP 429)`,
      detail: `Hosts afectados: ${[...new Set(rateLimited.map(r => r.hostname))].join(', ')}`,
      evidence: rateLimited[0].url
    });
  }

  const httpErrors = requests.filter(r => r.status >= 400 && r.status !== 429);
  if (httpErrors.length > 0) {
    alerts.push({
      severity: 'ERROR',
      type: 'HTTP_ERRORS',
      title: `${httpErrors.length} errores HTTP (4xx/5xx)`,
      detail: [...new Set(httpErrors.map(r => `${r.status} en ${r.hostname}`))].join(' · '),
      evidence: httpErrors[0].url
    });
  }

  const severityOrder = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ─── HEALTH SCORE ──────────────────────────────────────────────────────────

  let health = 100;
  health -= ghostErrors.length * 15;
  health -= httpErrors.length * 5;
  health -= alerts.filter(a => a.type === 'SLOW_RPC_METHOD').length * 5;
  health -= rateLimited.length * 10;
  health = Math.max(0, health);

  // Desglose transparente del score: de dónde sale cada punto
  const slowCount = alerts.filter(a => a.type === 'SLOW_RPC_METHOD').length;
  const healthBreakdown = [{ concepto: 'Puntaje base', puntos: 100 }];
  if (ghostErrors.length) healthBreakdown.push({ concepto: `Errores fantasma (${ghostErrors.length} × −15)`, puntos: -15 * ghostErrors.length });
  if (httpErrors.length) healthBreakdown.push({ concepto: `Errores HTTP (${httpErrors.length} × −5)`, puntos: -5 * httpErrors.length });
  if (rateLimited.length) healthBreakdown.push({ concepto: `Rate limiting (${rateLimited.length} × −10)`, puntos: -10 * rateLimited.length });
  if (slowCount) healthBreakdown.push({ concepto: `Métodos RPC lentos (${slowCount} × −5)`, puntos: -5 * slowCount });
  const rawSum = healthBreakdown.reduce((a, b) => a + b.puntos, 0);
  if (rawSum !== health) healthBreakdown.push({ concepto: 'Piso mínimo (0)', puntos: health - rawSum });

  // ─── META ──────────────────────────────────────────────────────────────────

  const allTimings = requests.map(r => r.timing).sort((a, b) => a - b);
  const meta = {
    totalRequests: requests.length,
    totalRpcCalls,
    batchRequests,
    ghostErrorCount: ghostErrors.length,
    httpErrorCount: httpErrors.length + rateLimited.length,
    rpcMethodCount: methodStats.length,
    providerCount: providerStats.length,
    systemsCount: systemStats.length,
    integrationsCount: integrations.length,
    chains: [...chains],
    avgTiming: allTimings.length ? round(allTimings.reduce((a, b) => a + b, 0) / allTimings.length) : 0,
    p95Timing: percentile(allTimings, 95),
    healthScore: health,
    pageHost: from,
    readCalls,
    writeCalls,
    gasPriceGwei,
    avgGasEstimate: gasEstimates.length
      ? Math.round(gasEstimates.reduce((a, b) => a + b, 0) / gasEstimates.length)
      : null,
    transactionCount: txs.size
  };

  return {
    meta,
    methods: methodStats,
    providers: providerStats,
    systems: systemStats,
    integrations,
    healthBreakdown,
    selectors: [...selectors.entries()]
      .map(([fn, count]) => ({ fn, count }))
      .sort((a, b) => b.count - a.count),
    chainActivity: [...chainActivity.entries()]
      .map(([chain, c]) => ({ chain, rpcCalls: c.rpcCalls, hosts: [...c.hosts] }))
      .sort((a, b) => b.rpcCalls - a.rpcCalls),
    transactions: [...txs.values()],
    ghostErrors,
    alerts,
    requests
  };
}

// ─── EXPORTS ───
module.exports = { parseHAR, extractRpcCalls };
