#!/usr/bin/env node
/**
 * Servidor MCP de facturación SRI (Ecuador) sobre la API Cobra /v1 — transporte STDIO.
 * Para correr local en Claude Desktop / Cursor / Claude Code, una llave por proceso.
 * (El transporte HTTP remoto multi-tenant vive en http.js.)
 *
 * Env: COBRA_API_KEY (requerida, X-API-Key del tenant) · COBRA_API_URL (opcional).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, DEFAULT_API_URL } from './tools.js';

const apiKey = process.env.COBRA_API_KEY;
if (!apiKey) {
  console.error('[cobra-mcp] Falta COBRA_API_KEY (X-API-Key del tenant). Aborta.');
  process.exit(1);
}
const apiUrl = process.env.COBRA_API_URL || DEFAULT_API_URL;

const server = buildServer({ apiKey, apiUrl });
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[cobra-mcp] stdio listo · API ${apiUrl}`);
