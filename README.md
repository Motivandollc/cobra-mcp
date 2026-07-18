# cobra-mcp — Servidor MCP de facturación electrónica SRI (Ecuador)

> **El primer MCP de facturación electrónica del SRI de Ecuador.** Factura al SRI hablándole
> a tu agente de IA. · 🌐 [facturacobra.com/mcp](https://facturacobra.com/mcp) · 📘 [Docs / OpenAPI](https://facturacobra.com/api/v1/docs) · 📇 En el [registro oficial MCP](https://registry.modelcontextprotocol.io) como `com.facturacobra/cobra`.

Expone la facturación de Cobra (factura, nota de crédito, nota de débito, retención) como
herramientas MCP para agentes de IA (Claude Desktop, Cursor, Claude Code). Es un cliente
**apátrida** de la API Cobra `/v1`: no tiene base de datos ni ve tu certificado `.p12` — la
API hace todo el trabajo fiscal (firma, transmisión al SRI, validación, idempotencia).

**¿Solo quieres usarlo? No necesitas clonar nada.** Cobra corre un servidor MCP remoto en
`https://facturacobra.com/mcp`. Genera una llave en facturacobra.com → Config → Desarrolladores
y conéctate (ver [Remoto](#remoto-http-multi-tenant--sin-instalar-nada)). Este repo es para
quien quiera self-hostear el bridge stdio o inspeccionar/contribuir.

## Instalar

```bash
cd cobra-mcp && npm install
```

## Configurar (Claude Desktop / Cursor)

Agrega a tu `claude_desktop_config.json` (o el equivalente de tu cliente):

```json
{
  "mcpServers": {
    "cobra": {
      "command": "node",
      "args": ["/ruta/a/cobra-mcp/index.js"],
      "env": {
        "COBRA_API_KEY": "mfact_xxxxxxxx_...",
        "COBRA_API_URL": "https://facturacobra.com/api/v1"
      }
    }
  }
}
```

- `COBRA_API_KEY` (requerida): tu llave de Cobra. **Usa una llave sandbox (ambiente=1) para
  probar**: nunca emite un comprobante fiscal real. Genera llaves con scopes `read`, `emit`,
  `annul`, `contacts:write`, `products:write`.
- `COBRA_API_URL` (opcional): default `https://facturacobra.com/api/v1`.

## Herramientas

`whoami` · `consultar_ruc` · `emitir_factura` · `emitir_documento` (factura/NC/ND/retención) ·
`consultar_estado` · `listar_documentos` · `anular_documento` · `crear_contacto` · `crear_producto`.

Ejemplo de uso desde el agente: *"factura $10 de consultoría a consumidor final"* →
`emitir_factura`. La idempotencia es automática: reintentar con los mismos datos no duplica.

Contrato completo de la API: https://facturacobra.com/api/v1/docs

## Remoto (HTTP, multi-tenant) — sin instalar nada

También hay un transporte HTTP (`http.js`) para hostear UNA instancia que atiende a todos
los tenants: la llave viaja por request en `Authorization: Bearer mfact_...`. Los clientes
MCP que soportan servidores remotos se conectan así:

```json
{
  "mcpServers": {
    "cobra": {
      "url": "https://facturacobra.com/mcp",
      "headers": { "Authorization": "Bearer mfact_xxxxxxxx_..." }
    }
  }
}
```

Correr el server HTTP: `MCP_PORT=4201 COBRA_API_URL=http://127.0.0.1:4099/api/v1 node http.js`
(detrás de nginx/TLS). Es stateless: cada `POST /mcp` es autocontenido. Salud: `GET /health`.
