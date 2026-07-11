/**
 * QASL WEB3 LIVE SERVER
 * rpc-detector.js — Clasificación de endpoints del ecosistema Web3
 *
 * Detecta:
 *   - Proveedores RPC (Infura, Alchemy, QuickNode, nodos públicos/propios)
 *   - Indexers (The Graph, Goldsky, subgraphs)
 *   - Infraestructura de wallets (MetaMask, WalletConnect, Rabby)
 *   - APIs de precios y datos de mercado (CoinGecko, DefiLlama...)
 *   - Exploradores de bloques (Etherscan y familia *scan)
 *   - Servicios de seguridad Web3 (Blockaid, Blowfish)
 *   - Backend propio de la dApp, analytics y CDN/edge
 *
 * Elyer Gregorio Maldonado
 */

'use strict';

// ─── PROVEEDORES RPC CONOCIDOS ────────────────────────────────────────────────

const RPC_PROVIDERS = [
  { pattern: /(^|\.)infura\.io$/i,            label: 'Infura' },
  { pattern: /(^|\.)alchemy\.com$/i,          label: 'Alchemy' },
  { pattern: /(^|\.)alchemyapi\.io$/i,        label: 'Alchemy' },
  { pattern: /(^|\.)quiknode\.pro$/i,         label: 'QuickNode' },
  { pattern: /(^|\.)quicknode\.com$/i,        label: 'QuickNode' },
  { pattern: /(^|\.)ankr\.com$/i,             label: 'Ankr' },
  { pattern: /(^|\.)llamarpc\.com$/i,         label: 'LlamaRPC' },
  { pattern: /(^|\.)publicnode\.com$/i,       label: 'PublicNode' },
  { pattern: /(^|\.)cloudflare-eth\.com$/i,   label: 'Cloudflare ETH' },
  { pattern: /(^|\.)polygon-rpc\.com$/i,      label: 'Polygon RPC' },
  { pattern: /(^|\.)arbitrum\.io$/i,          label: 'Arbitrum RPC' },
  { pattern: /(^|\.)optimism\.io$/i,          label: 'Optimism RPC' },
  { pattern: /(^|\.)base\.org$/i,             label: 'Base RPC' },
  { pattern: /(^|\.)binance\.org$/i,          label: 'BSC RPC' },
  { pattern: /(^|\.)avax\.network$/i,         label: 'Avalanche RPC' },
  { pattern: /(^|\.)drpc\.org$/i,             label: 'dRPC' },
  { pattern: /(^|\.)1rpc\.io$/i,              label: '1RPC' },
  { pattern: /(^|\.)blastapi\.io$/i,          label: 'Blast API' },
  { pattern: /(^|\.)chainstack\.com$/i,       label: 'Chainstack' },
  { pattern: /(^|\.)getblock\.io$/i,          label: 'GetBlock' },
  { pattern: /(^|\.)tenderly\.co$/i,          label: 'Tenderly' },
  { pattern: /(^|\.)moralis\.io$/i,           label: 'Moralis' },
  { pattern: /(^|\.)gateway\.fm$/i,           label: 'Gateway.fm' },
  { pattern: /^rpc\./i,                       label: 'Nodo RPC (genérico)' }
];

// ─── OTRAS CATEGORÍAS DEL ECOSISTEMA ─────────────────────────────────────────

const WEB3_SERVICES = [
  // Indexers
  { pattern: /(^|\.)thegraph\.com$/i,           label: 'The Graph',        category: 'indexer' },
  { pattern: /(^|\.)goldsky\.com$/i,            label: 'Goldsky',          category: 'indexer' },
  { pattern: /subgraph/i,                       label: 'Subgraph',         category: 'indexer' },

  // Infraestructura de wallets
  { pattern: /(^|\.)walletconnect\.(com|org)$/i, label: 'WalletConnect',   category: 'wallet' },
  { pattern: /(^|\.)metamask\.io$/i,            label: 'MetaMask API',     category: 'wallet' },
  { pattern: /(^|\.)cx\.metamask\.io$/i,        label: 'MetaMask Services', category: 'wallet' },
  { pattern: /(^|\.)rabby\.io$/i,               label: 'Rabby',            category: 'wallet' },
  { pattern: /(^|\.)rainbow\.me$/i,             label: 'Rainbow',          category: 'wallet' },

  // Precios y datos de mercado
  { pattern: /(^|\.)coingecko\.com$/i,          label: 'CoinGecko',        category: 'price-api' },
  { pattern: /(^|\.)coinmarketcap\.com$/i,      label: 'CoinMarketCap',    category: 'price-api' },
  { pattern: /(^|\.)cryptocompare\.com$/i,      label: 'CryptoCompare',    category: 'price-api' },
  { pattern: /(^|\.)llama\.fi$/i,               label: 'DefiLlama',        category: 'price-api' },
  { pattern: /(^|\.)defillama\.com$/i,          label: 'DefiLlama',        category: 'price-api' },

  // Exploradores de bloques
  { pattern: /(^|\.)etherscan\.io$/i,           label: 'Etherscan',        category: 'explorer' },
  { pattern: /(^|\.)polygonscan\.com$/i,        label: 'Polygonscan',      category: 'explorer' },
  { pattern: /(^|\.)bscscan\.com$/i,            label: 'BscScan',          category: 'explorer' },
  { pattern: /(^|\.)arbiscan\.io$/i,            label: 'Arbiscan',         category: 'explorer' },
  { pattern: /(^|\.)basescan\.org$/i,           label: 'BaseScan',         category: 'explorer' },

  // Seguridad Web3
  { pattern: /(^|\.)blockaid\.io$/i,            label: 'Blockaid',         category: 'security' },
  { pattern: /(^|\.)blowfish\.xyz$/i,           label: 'Blowfish',         category: 'security' },

  // ENS / identidad
  { pattern: /(^|\.)ens\.domains$/i,            label: 'ENS',              category: 'identity' },

  // Analytics / telemetría (muy comunes en dApps)
  { pattern: /(^|\.)statsig\.com$/i,            label: 'Statsig',            category: 'analytics' },
  { pattern: /(^|\.)amplitude\.com$/i,          label: 'Amplitude',          category: 'analytics' },
  { pattern: /(^|\.)segment\.(io|com)$/i,       label: 'Segment',            category: 'analytics' },
  { pattern: /(^|\.)sentry\.io$/i,              label: 'Sentry',             category: 'analytics' },
  { pattern: /(^|\.)google-analytics\.com$/i,   label: 'Google Analytics',   category: 'analytics' },
  { pattern: /(^|\.)googletagmanager\.com$/i,   label: 'Google Tag Manager', category: 'analytics' },
  { pattern: /(^|\.)datadoghq\.com$/i,          label: 'Datadog RUM',        category: 'analytics' },

  // CDN / edge / challenges
  { pattern: /(^|\.)challenges\.cloudflare\.com$/i, label: 'Cloudflare Challenge', category: 'cdn' },
  { pattern: /(^|\.)cloudflareinsights\.com$/i, label: 'Cloudflare Insights', category: 'cdn' },
  { pattern: /(^|\.)cloudfront\.net$/i,         label: 'CloudFront',          category: 'cdn' },
  { pattern: /(^|\.)fastly\.net$/i,             label: 'Fastly',              category: 'cdn' },
  { pattern: /(^|\.)akamaized\.net$/i,          label: 'Akamai',              category: 'cdn' }
];

// ─── CHAIN IDs ────────────────────────────────────────────────────────────────

const CHAIN_IDS = {
  '0x1':      'Ethereum Mainnet',
  '0x89':     'Polygon',
  '0x38':     'BNB Smart Chain',
  '0xa4b1':   'Arbitrum One',
  '0xa':      'Optimism',
  '0x2105':   'Base',
  '0xa86a':   'Avalanche C-Chain',
  '0xaa36a7': 'Sepolia (testnet)',
  '0x5':      'Goerli (testnet)',
  '0x13881':  'Mumbai (testnet)',
  '0xe708':   'Linea',
  '0x144':    'zkSync Era'
};

function chainLabel(chainIdHex) {
  if (!chainIdHex) return null;
  const norm = String(chainIdHex).toLowerCase();
  return CHAIN_IDS[norm] || `Chain ${parseInt(norm, 16) || norm}`;
}

// ─── SELECTORES DE FUNCIONES (4 bytes) — ERC-20 / ERC-721 / comunes ──────────

const FUNCTION_SELECTORS = {
  '0x70a08231': 'balanceOf(address)',
  '0x095ea7b3': 'approve(address,uint256)',
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0xdd62ed3e': 'allowance(address,address)',
  '0x18160ddd': 'totalSupply()',
  '0x313ce567': 'decimals()',
  '0x95d89b41': 'symbol()',
  '0x06fdde03': 'name()',
  '0x01ffc9a7': 'supportsInterface(bytes4)',
  '0x6352211e': 'ownerOf(uint256)',
  '0x42842e0e': 'safeTransferFrom(address,address,uint256)',
  '0xc87b56dd': 'tokenURI(uint256)',
  '0x0902f1ac': 'getReserves()',
  '0xd0e30db0': 'deposit()',
  '0x2e1a7d4d': 'withdraw(uint256)',
  '0x022c0d9f': 'swap(uint256,uint256,address,bytes)',
  '0x38ed1739': 'swapExactTokensForTokens(...)',
  '0x7ff36ab5': 'swapExactETHForTokens(...)',
  '0x5ae401dc': 'multicall(uint256,bytes[])',
  '0xac9650d8': 'multicall(bytes[])',
  '0x252dba42': 'aggregate((address,bytes)[]) [Multicall]',
  '0x82ad56cb': 'aggregate3((address,bool,bytes)[]) [Multicall3]',
  '0xbce38bd7': 'tryAggregate(bool,(address,bytes)[]) [Multicall]',
  '0x4d2301cc': 'getEthBalance(address) [Multicall]'
};

function decodeSelector(data) {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  // Si el selector no está en la tabla, devolvemos el hex igual: es evidencia útil
  return FUNCTION_SELECTORS[selector] || selector;
}

// ─── CÓDIGOS DE ERROR JSON-RPC ────────────────────────────────────────────────

const JSONRPC_ERROR_CODES = {
  '-32700': 'Parse error',
  '-32600': 'Invalid request',
  '-32601': 'Method not found',
  '-32602': 'Invalid params',
  '-32603': 'Internal error',
  '-32000': 'Server error (execution reverted / genérico)',
  '-32005': 'Rate limit excedido'
};

function describeRpcError(code, message) {
  const known = JSONRPC_ERROR_CODES[String(code)];
  const base = known || `Error JSON-RPC ${code}`;
  return message ? `${base}: ${message}` : base;
}

// ─── CLASIFICADOR PRINCIPAL ──────────────────────────────────────────────────

function baseDomain(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean);
  return parts.slice(-2).join('.');
}

function classifyHost(hostname, { isJsonRpc = false, pageHost = null } = {}) {
  for (const p of RPC_PROVIDERS) {
    if (p.pattern.test(hostname)) return { category: 'rpc', label: p.label };
  }
  for (const s of WEB3_SERVICES) {
    if (s.pattern.test(hostname)) return { category: s.category, label: s.label };
  }
  // Si el body es JSON-RPC pero el host no es un proveedor conocido → nodo propio
  if (isJsonRpc) return { category: 'rpc', label: `Nodo RPC propio (${hostname})` };
  // Mismo dominio raíz que la dApp → backend propio de la dApp
  if (pageHost && hostname !== pageHost && baseDomain(hostname) === baseDomain(pageHost)) {
    return { category: 'dapp-backend', label: `Backend dApp (${hostname})` };
  }
  return { category: 'other', label: hostname };
}

/**
 * ¿El body de la request tiene forma de JSON-RPC 2.0?
 * Soporta llamadas simples y batch (array).
 */
function looksLikeJsonRpc(postDataText) {
  if (!postDataText || typeof postDataText !== 'string') return false;
  const t = postDataText.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  return t.includes('"jsonrpc"') && t.includes('"method"');
}

module.exports = {
  classifyHost,
  looksLikeJsonRpc,
  chainLabel,
  decodeSelector,
  describeRpcError,
  CHAIN_IDS,
  FUNCTION_SELECTORS
};
