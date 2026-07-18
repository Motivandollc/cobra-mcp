#!/usr/bin/env node
/**
 * Servidor MCP de facturación SRI (Ecuador) — transporte HTTP remoto, MULTI-TENANT.
 *
 * A diferencia del stdio (una llave por proceso), aquí una sola instancia atiende a todos
 * los tenants: la llave viaja POR REQUEST en `Authorization: Bearer mfact_...` (o X-API-Key).
 * Modo STATELESS: cada POST /mcp es una petición JSON-RPC autocontenida → se construye un
 * server ligado a esa llave y se responde. Sigue siendo APÁTRIDA (sin BD, sin .p12).
 *
 * Se expone detrás de nginx en 127.0.0.1; el TLS y el dominio (mcp.facturacobra.com) los
 * pone el front. Env: MCP_PORT (default 4201), MCP_HOST (127.0.0.1), COBRA_API_URL.
 */
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, DEFAULT_API_URL } from './tools.js';

const PORT = Number(process.env.MCP_PORT || 4201);
const HOST = process.env.MCP_HOST || '127.0.0.1';
const API_URL = process.env.COBRA_API_URL || DEFAULT_API_URL;

const app = express();
app.use(express.json({ limit: '2mb' }));

function extractKey(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = req.headers['x-api-key'];
  return typeof x === 'string' ? x.trim() : '';
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cobra-mcp', transport: 'streamable-http' }));

app.post('/mcp', async (req, res) => {
  const key = extractKey(req);
  if (!key || !key.startsWith('mfact_')) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Falta la API key. Envía Authorization: Bearer mfact_... o X-API-Key.' }, id: null });
  }
  const server = buildServer({ apiKey: key, apiUrl: API_URL });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[cobra-mcp] error:', e?.message || e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno del servidor MCP.' }, id: null });
  }
});

// En modo stateless no hay sesiones SSE persistentes (server-initiated).
const noSession = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido (servidor stateless; usa POST /mcp).' }, id: null });
app.get('/mcp', noSession);
app.delete('/mcp', noSession);

app.listen(PORT, HOST, () => console.error(`[cobra-mcp] HTTP (multi-tenant) listo en ${HOST}:${PORT} · API ${API_URL}`));
