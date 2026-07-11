/**
 * QASL WEB3 LIVE SERVER
 * report-generator.js — Informe HTML ejecutivo del análisis Web3
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEVERITY_COLORS = {
  CRITICAL: '#ff4d6d',
  ERROR:    '#ff8c42',
  WARNING:  '#ffd166',
  INFO:     '#4cc9f0'
};

const CATEGORY_LABELS = {
  'rpc':          'Proveedor RPC',
  'indexer':      'Indexer',
  'wallet':       'Wallet Infra',
  'price-api':    'API de precios',
  'explorer':     'Block Explorer',
  'security':     'Seguridad Web3',
  'identity':     'Identidad',
  'dapp':         'dApp',
  'dapp-backend': 'Backend dApp',
  'analytics':    'Analytics',
  'cdn':          'CDN / Edge',
  'other':        'Otro'
};

function healthColor(score) {
  if (score >= 80) return '#2dd4a7';
  if (score >= 50) return '#ffd166';
  return '#ff4d6d';
}

function generateReport(parsed, harFilename, reportsDir) {
  const { meta, methods, providers, systems, integrations, selectors, ghostErrors, alerts, requests } = parsed;

  const kpi = (value, label, color = '#e8ecf1') => `
    <div class="kpi">
      <div class="kpi-value" style="color:${color}">${esc(value)}</div>
      <div class="kpi-label">${esc(label)}</div>
    </div>`;

  const methodRows = methods.map(m => `
    <tr>
      <td><code>${esc(m.method)}</code></td>
      <td class="num">${m.count}</td>
      <td class="num" style="color:${m.errorCount > 0 ? SEVERITY_COLORS.CRITICAL : '#5b6472'}">${m.errorCount}</td>
      <td class="num">${m.avgMs} ms</td>
      <td class="num">${m.p50Ms} ms</td>
      <td class="num" style="color:${m.p95Ms > 1500 ? SEVERITY_COLORS.WARNING : 'inherit'}">${m.p95Ms} ms</td>
      <td>${esc(m.providers.join(', ') || '—')}</td>
    </tr>`).join('');

  const providerRows = providers.map(p => `
    <tr>
      <td><strong>${esc(p.label)}</strong><br><span class="dim">${esc(p.hostname)}</span></td>
      <td class="num">${p.callCount}</td>
      <td class="num" style="color:${p.errorCount > 0 ? SEVERITY_COLORS.CRITICAL : '#5b6472'}">${p.errorCount}</td>
      <td class="num">${p.avgMs} ms</td>
      <td class="num">${p.p95Ms} ms</td>
    </tr>`).join('');

  const integrationRows = integrations.map(i => `
    <tr>
      <td>${esc(i.from)}</td>
      <td class="arrow">→</td>
      <td><strong>${esc(i.to)}</strong><br><span class="dim">${esc(i.toHostname)}</span></td>
      <td><span class="tag tag-${esc(i.category)}">${esc(CATEGORY_LABELS[i.category] || i.category)}</span></td>
      <td class="num">${i.requestCount}</td>
      <td class="num" style="color:${i.errorCount > 0 ? SEVERITY_COLORS.CRITICAL : '#5b6472'}">${i.errorCount}</td>
      <td class="num">${i.avgMs} ms</td>
    </tr>`).join('');

  const selectorRows = selectors.map(s => `
    <tr><td><code>${esc(s.fn)}</code></td><td class="num">${s.count}</td></tr>`).join('');

  const alertItems = alerts.map(a => `
    <div class="alert" style="border-left-color:${SEVERITY_COLORS[a.severity]}">
      <div class="alert-head">
        <span class="sev" style="background:${SEVERITY_COLORS[a.severity]}22;color:${SEVERITY_COLORS[a.severity]}">${a.severity}</span>
        <strong>${esc(a.title)}</strong>
      </div>
      <div class="alert-detail">${esc(a.detail)}</div>
      <div class="alert-evidence dim">Evidencia: ${esc(a.evidence)}</div>
    </div>`).join('');

  const ghostRows = ghostErrors.map(g => `
    <tr>
      <td><code>${esc(g.method)}</code>${g.selector ? `<br><span class="dim">${esc(g.selector)}</span>` : ''}</td>
      <td>${esc(g.provider)}</td>
      <td class="num" style="color:#2dd4a7">HTTP ${g.httpStatus}</td>
      <td style="color:${SEVERITY_COLORS.CRITICAL}">${esc(g.rpcError)}</td>
    </tr>`).join('');

  const requestRows = requests.map(r => {
    const statusText = r.status > 0 ? r.status : 'WS/—';
    const statusColor = r.status >= 400 ? SEVERITY_COLORS.CRITICAL
      : r.status <= 0 ? '#5b6472'
      : r.rpcErrors.length > 0 ? SEVERITY_COLORS.WARNING : '#2dd4a7';
    return `
    <tr>
      <td><span class="tag tag-${esc(r.category)}">${esc(CATEGORY_LABELS[r.category] || r.category)}</span></td>
      <td class="url-cell" title="${esc(r.url)}">${esc(r.url)}</td>
      <td>${esc(r.httpMethod)}</td>
      <td class="num" style="color:${statusColor}">${statusText}</td>
      <td class="num">${r.timing} ms</td>
      <td>${r.rpcMethods.length ? `<code>${esc(r.rpcMethods.join(', '))}</code>` : '—'}</td>
      <td style="color:${r.rpcErrors.length ? SEVERITY_COLORS.CRITICAL : '#5b6472'}">${r.rpcErrors.length ? esc(r.rpcErrors.join(' · ')) : '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QASL WEB3 · ${esc(harFilename)}</title>
<style>
  :root { color-scheme: dark; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI', system-ui, sans-serif; background:#0d1117; color:#e8ecf1; padding:32px; }
  .container { max-width:1200px; margin:0 auto; }
  header { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;
           border-bottom:1px solid #21262d; padding-bottom:24px; margin-bottom:28px; }
  h1 { font-size:1.5rem; letter-spacing:0.5px; }
  h1 span { color:#4cc9f0; }
  .subtitle { color:#8b949e; font-size:0.9rem; margin-top:4px; }
  .health { text-align:center; }
  .health-score { font-size:2.6rem; font-weight:700; }
  .health-label { color:#8b949e; font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; }
  h2 { font-size:1.05rem; margin:32px 0 14px; color:#c9d1d9; text-transform:uppercase; letter-spacing:1px;
       border-left:3px solid #4cc9f0; padding-left:10px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; }
  .kpi { background:#161b22; border:1px solid #21262d; border-radius:10px; padding:16px; text-align:center; }
  .kpi-value { font-size:1.6rem; font-weight:700; }
  .kpi-label { color:#8b949e; font-size:0.75rem; margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; }
  table { width:100%; border-collapse:collapse; background:#161b22; border:1px solid #21262d;
          border-radius:10px; overflow:hidden; font-size:0.85rem; }
  th { background:#1c2129; color:#8b949e; text-align:left; padding:10px 12px; font-size:0.72rem;
       text-transform:uppercase; letter-spacing:0.5px; }
  td { padding:9px 12px; border-top:1px solid #21262d; vertical-align:top; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.arrow { color:#4cc9f0; font-weight:700; }
  code { background:#21262d; padding:2px 6px; border-radius:4px; font-size:0.82rem; color:#79c0ff; }
  .dim { color:#5b6472; font-size:0.78rem; }
  .url-cell { max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tag { display:inline-block; padding:2px 8px; border-radius:20px; font-size:0.7rem; font-weight:600;
         text-transform:uppercase; letter-spacing:0.5px; }
  .tag-rpc       { background:#4cc9f022; color:#4cc9f0; }
  .tag-indexer   { background:#b388ff22; color:#b388ff; }
  .tag-wallet    { background:#ffd16622; color:#ffd166; }
  .tag-price-api { background:#2dd4a722; color:#2dd4a7; }
  .tag-explorer  { background:#ff8c4222; color:#ff8c42; }
  .tag-security  { background:#ff4d6d22; color:#ff4d6d; }
  .tag-identity  { background:#f0f6fc22; color:#f0f6fc; }
  .tag-dapp-backend { background:#0d948822; color:#2dd4a7; }
  .tag-analytics { background:#6e768122; color:#9ea7b3; }
  .tag-cdn       { background:#57606a22; color:#8b949e; }
  .tag-other     { background:#5b647222; color:#8b949e; }
  .alert { background:#161b22; border:1px solid #21262d; border-left:4px solid; border-radius:8px;
           padding:14px 16px; margin-bottom:10px; }
  .alert-head { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  .sev { padding:2px 9px; border-radius:20px; font-size:0.68rem; font-weight:700; letter-spacing:0.5px; }
  .alert-detail { font-size:0.85rem; color:#c9d1d9; }
  .alert-evidence { margin-top:5px; word-break:break-all; }
  .empty { color:#5b6472; padding:18px; text-align:center; background:#161b22;
           border:1px dashed #21262d; border-radius:10px; font-size:0.85rem; }
  footer { margin-top:40px; padding-top:16px; border-top:1px solid #21262d; color:#5b6472;
           font-size:0.78rem; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
</style>
</head>
<body>
<div class="container">

  <header>
    <div>
      <h1>QASL <span>WEB3</span> SENTINEL</h1>
      <div class="subtitle">Análisis de tráfico dApp · ${esc(harFilename)} · ${new Date().toLocaleString('es-AR')}</div>
      <div class="subtitle">Chains: ${esc(meta.chains.join(' · ') || 'no detectadas')} · Frontend: ${esc(meta.pageHost)}</div>
    </div>
    <div class="health">
      <div class="health-score" style="color:${healthColor(meta.healthScore)}">${meta.healthScore}</div>
      <div class="health-label">Health Score</div>
    </div>
  </header>

  <section class="kpis">
    ${kpi(meta.totalRequests, 'Requests HTTP')}
    ${kpi(meta.totalRpcCalls, 'Llamadas JSON-RPC', '#4cc9f0')}
    ${kpi(meta.rpcMethodCount, 'Métodos RPC distintos', '#79c0ff')}
    ${kpi(meta.providerCount, 'Proveedores RPC', '#b388ff')}
    ${kpi(meta.ghostErrorCount, 'Errores fantasma', meta.ghostErrorCount > 0 ? '#ff4d6d' : '#2dd4a7')}
    ${kpi(meta.httpErrorCount, 'Errores HTTP', meta.httpErrorCount > 0 ? '#ff8c42' : '#2dd4a7')}
    ${kpi(meta.avgTiming + ' ms', 'Latencia promedio', '#ffd166')}
    ${kpi(meta.p95Timing + ' ms', 'Latencia p95', '#ffd166')}
  </section>

  <h2>Alertas</h2>
  ${alerts.length ? alertItems : '<div class="empty">Sin alertas — la sesión capturada se ve saludable.</div>'}

  ${ghostErrors.length ? `
  <h2>Errores fantasma (HTTP 200 + error JSON-RPC)</h2>
  <p class="dim" style="margin-bottom:10px">Estas llamadas pasarían en verde en cualquier validación basada solo en status HTTP.</p>
  <table>
    <thead><tr><th>Método / función</th><th>Proveedor</th><th>Status HTTP</th><th>Error JSON-RPC</th></tr></thead>
    <tbody>${ghostRows}</tbody>
  </table>` : ''}

  <h2>Métodos JSON-RPC</h2>
  ${methods.length ? `
  <table>
    <thead><tr><th>Método</th><th>Llamadas</th><th>Errores</th><th>Avg</th><th>p50</th><th>p95</th><th>Proveedores</th></tr></thead>
    <tbody>${methodRows}</tbody>
  </table>` : '<div class="empty">No se detectaron llamadas JSON-RPC en este HAR.</div>'}

  ${selectors.length ? `
  <h2>Funciones de contrato decodificadas (eth_call)</h2>
  <table>
    <thead><tr><th>Función</th><th>Llamadas</th></tr></thead>
    <tbody>${selectorRows}</tbody>
  </table>` : ''}

  <h2>Proveedores RPC</h2>
  ${providers.length ? `
  <table>
    <thead><tr><th>Proveedor</th><th>Llamadas RPC</th><th>Errores</th><th>Avg</th><th>p95</th></tr></thead>
    <tbody>${providerRows}</tbody>
  </table>` : '<div class="empty">Sin proveedores RPC detectados.</div>'}

  <h2>Mapa de integraciones</h2>
  ${integrations.length ? `
  <table>
    <thead><tr><th>Origen</th><th></th><th>Destino</th><th>Categoría</th><th>Requests</th><th>Errores</th><th>Avg</th></tr></thead>
    <tbody>${integrationRows}</tbody>
  </table>` : '<div class="empty">Sin integraciones Web3 detectadas.</div>'}

  <h2>Evidencia · Requests</h2>
  <table>
    <thead><tr><th>Categoría</th><th>URL</th><th>Método</th><th>Status</th><th>Tiempo</th><th>JSON-RPC</th><th>Error RPC</th></tr></thead>
    <tbody>${requestRows}</tbody>
  </table>

  <footer>
    <span>QASL WEB3 SENTINEL · Web3 integration observability from HAR evidence</span>
    <span>Elyer Gregorio Maldonado · QA Automation / SDET</span>
  </footer>

</div>
</body>
</html>`;

  const base = harFilename.replace(/\.har$/i, '');
  const filename = `web3-report-${base}.html`;
  const outputPath = path.join(reportsDir, filename);
  fs.writeFileSync(outputPath, html, 'utf8');
  return { outputPath, filename };
}

module.exports = { generateReport };
