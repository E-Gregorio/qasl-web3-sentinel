/**
 * QASL WEB3 SENTINEL
 * har-recorder.js — Grabador HAR para cualquier BrowserContext de Playwright
 *
 * ¿Por qué existe? Playwright soporta recordHar nativo, pero herramientas
 * como Dappwright crean su propio contexto persistente (necesario para
 * extensiones como MetaMask) y no siempre exponen esa opción. Este módulo
 * se engancha a CUALQUIER contexto ya creado y produce un HAR 1.2 con
 * bodies incluidos — exactamente lo que el motor Sentinel necesita.
 *
 * Uso:
 *   const { attachHarRecorder } = require('./src/har-recorder');
 *   const recorder = attachHarRecorder(context);
 *   ... (navegar, interactuar) ...
 *   await recorder.save('input/mi-sesion.har');
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TEXTUAL_MIME = /json|text|javascript|xml|html|urlencoded|graphql/i;

function attachHarRecorder(context, { maxBodyBytes = 500000 } = {}) {
  const entries = [];
  const startTimes = new Map();
  const pending = [];

  context.on('request', (req) => {
    startTimes.set(req, Date.now());
  });

  context.on('requestfailed', (req) => {
    const started = startTimes.get(req) || Date.now();
    entries.push(buildEntry(req, null, '', Date.now() - started));
  });

  context.on('response', (resp) => {
    const req = resp.request();
    const started = startTimes.get(req) || Date.now();
    const elapsed = Date.now() - started;

    // Capturar el body de forma asíncrona sin bloquear la navegación
    const p = (async () => {
      let bodyText = '';
      let mime = '';
      try {
        mime = (resp.headers()['content-type'] || '').split(';')[0];
        if (TEXTUAL_MIME.test(mime)) {
          const body = await resp.body();
          if (body && body.length <= maxBodyBytes) {
            bodyText = body.toString('utf8');
          }
        }
      } catch { /* body no disponible (redirect, stream cerrado) — seguimos */ }
      entries.push(buildEntry(req, resp, bodyText, elapsed, mime));
    })();
    pending.push(p.catch(() => {}));
  });

  function buildEntry(req, resp, bodyText, elapsed, mime = '') {
    let postText = null;
    try { postText = req.postData(); } catch { /* noop */ }

    return {
      startedDateTime: new Date(startTimes.get(req) || Date.now()).toISOString(),
      time: Math.max(0, elapsed),
      request: {
        method: req.method(),
        url: req.url(),
        httpVersion: 'HTTP/2',
        headers: [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: postText ? postText.length : 0,
        ...(postText ? { postData: { mimeType: 'application/json', text: postText } } : {})
      },
      response: {
        status: resp ? resp.status() : 0,
        statusText: resp ? resp.statusText() : 'FAILED',
        httpVersion: 'HTTP/2',
        headers: [],
        cookies: [],
        content: {
          size: bodyText.length,
          mimeType: mime || 'application/octet-stream',
          text: bodyText
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: bodyText.length
      },
      cache: {},
      timings: { send: 0, wait: Math.max(0, elapsed), receive: 0 },
      _resourceType: req.resourceType ? req.resourceType() : undefined
    };
  }

  return {
    /** Cantidad de entradas capturadas hasta ahora */
    count: () => entries.length,

    /** Espera los bodies pendientes y escribe el HAR */
    async save(filePath) {
      await Promise.allSettled(pending);
      entries.sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));
      const har = {
        log: {
          version: '1.2',
          creator: { name: 'QASL Web3 Sentinel · har-recorder', version: '1.0' },
          pages: [],
          entries
        }
      };
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(har, null, 2), 'utf8');
      return { entries: entries.length, path: filePath };
    }
  };
}

module.exports = { attachHarRecorder };
