/**
 * Fábrica del servidor MCP de facturación Cobra. Registra las herramientas sobre un
 * McpServer, ligadas a un tenant concreto (apiKey) → sirve tanto para stdio (una llave por
 * proceso) como para HTTP remoto multi-tenant (una llave por request). Cliente APÁTRIDA:
 * sólo traduce llamadas a HTTP contra /v1; el trabajo fiscal (firma, SRI, validación,
 * idempotencia, scopes, ambiente) vive en la API.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import crypto from 'node:crypto';

export const DEFAULT_API_URL = 'https://facturacobra.com/api/v1';

const compradorShape = {
  comprador_tipo_id: z.string().optional().describe('Opcional: se DERIVA del identificador. 04=RUC, 05=cédula, 06=pasaporte, 07=consumidor final, 08=exterior.'),
  comprador_identificacion: z.string().optional(),
  comprador_razon_social: z.string().optional(),
  comprador_email: z.string().optional(),
  comprador_direccion: z.string().optional(),
};
const itemShape = z.object({
  descripcion: z.string(),
  cantidad: z.number(),
  precio_unitario: z.number().describe('Sin IVA.'),
  descuento: z.number().optional(),
  iva_codigo_porcentaje: z.string().optional().describe('4=15% (default), 0=0%, 5=5%, 6=no objeto, 7=exento.'),
  codigo_principal: z.string().optional(),
});
const retItemShape = z.object({
  codigo_impuesto: z.string().describe('1=Renta, 2=IVA, 6=ISD'),
  codigo_retencion: z.string().describe('p.ej. 312'),
  base_imponible: z.number(),
  porcentaje_retener: z.number().describe('Debe coincidir con la parametrización del SRI (312=2%).'),
  tipo_doc_sustento: z.string().describe('p.ej. 01'),
  numero_doc_sustento: z.string().describe('EEE-PPP-SSSSSSSSS (con guiones)'),
  fecha_emision_sustento: z.string().describe('YYYY-MM-DD'),
  sustento_iva_codigo: z.string().optional().describe('IVA del documento sustento (0=sin IVA, 4=15%).'),
});

/** Idempotency-key estable: la provista, o un hash del payload (reintento = misma key). */
function idem(provided, payload) {
  if (provided && String(provided).trim()) return String(provided).trim();
  return 'mcp-' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
}

/** Crea un McpServer con las herramientas ligadas a un tenant (apiKey). */
export function buildServer({ apiKey, apiUrl = DEFAULT_API_URL }) {
  const base = apiUrl.replace(/\/$/, '');
  async function call(method, path, body) {
    let res, data;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      return { content: [{ type: 'text', text: `Error de red llamando a Cobra: ${e.message}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: !res.ok };
  }

  const server = new McpServer({ name: 'cobra-mcp', version: '1.0.0' });

  server.registerTool('whoami', {
    title: 'Identidad y capacidades',
    description: 'Confirma el tenant, si estás en sandbox o producción, si la firma está activa, y los permisos de tu llave.',
    inputSchema: {},
  }, async () => call('GET', '/whoami'));

  server.registerTool('consultar_ruc', {
    title: 'Consultar RUC/cédula en el SRI',
    description: 'Trae la razón social y el estado de un contribuyente desde el padrón del SRI.',
    inputSchema: { identificacion: z.string().describe('Cédula (10) o RUC (13).') },
  }, async ({ identificacion }) => call('GET', `/sri-lookup/${encodeURIComponent(identificacion)}`));

  server.registerTool('emitir_factura', {
    title: 'Emitir factura (01) al SRI',
    description: 'Crea y emite una factura autorizada por el SRI. Totales/IVA server-side. Idempotente: reintentar con los mismos datos no duplica.',
    inputSchema: { ...compradorShape, items: z.array(itemShape), fecha_emision: z.string().optional(), idempotency_key: z.string().optional() },
  }, async (a) => call('POST', '/documents', { ...a, tipo_comprobante: '01', idempotency_key: idem(a.idempotency_key, { ...a, t: '01' }) }));

  server.registerTool('emitir_documento', {
    title: 'Emitir cualquier comprobante (factura, NC, ND o retención)',
    description: '01 factura, 04 nota de crédito, 05 nota de débito, 06 retención. Para 04/05 envía doc_modificado_*; para 06 envía retention_items y un sujeto retenido identificado.',
    inputSchema: {
      tipo_comprobante: z.enum(['01', '04', '05', '06']), ...compradorShape,
      items: z.array(itemShape).optional(), retention_items: z.array(retItemShape).optional(),
      doc_modificado_tipo: z.string().optional(), doc_modificado_numero: z.string().optional().describe('NC/ND: EEE-PPP-SSSSSSSSS con guiones.'),
      doc_modificado_fecha: z.string().optional(), doc_modificado_razon: z.string().optional(),
      periodo_fiscal: z.string().optional().describe('Retención: MM/YYYY.'), fecha_emision: z.string().optional(), idempotency_key: z.string().optional(),
    },
  }, async (a) => call('POST', '/documents', { ...a, idempotency_key: idem(a.idempotency_key, a) }));

  server.registerTool('consultar_estado', {
    title: 'Estado de autorización de un comprobante',
    description: 'Estado (authorized/rejected/…), número de autorización y mensajes del SRI.',
    inputSchema: { document_id: z.string().describe('id (uuid) del comprobante.') },
  }, async ({ document_id }) => call('GET', `/documents/${encodeURIComponent(document_id)}/status`));

  server.registerTool('listar_documentos', {
    title: 'Listar comprobantes emitidos',
    description: 'Lista los comprobantes del tenant con filtros por tipo, estado y rango de fechas.',
    inputSchema: { tipo: z.string().optional(), estado: z.string().optional(), desde: z.string().optional(), hasta: z.string().optional(), limit: z.number().optional() },
  }, async (a) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(a).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))).toString();
    return call('GET', `/documents${qs ? '?' + qs : ''}`);
  });

  server.registerTool('anular_documento', {
    title: 'Anular un comprobante (interno, ventana 7 días)',
    description: 'Marca el comprobante como anulado internamente. La anulación ante el SRI la hace el contribuyente en el portal. Fuera de la ventana, usa una nota de crédito.',
    inputSchema: { document_id: z.string(), reason: z.string().describe('Motivo de la anulación.') },
  }, async ({ document_id, reason }) => call('POST', `/documents/${encodeURIComponent(document_id)}/anular`, { reason }));

  server.registerTool('crear_contacto', {
    title: 'Crear/actualizar un contacto',
    description: 'Guarda un cliente/proveedor. El tipo de identificación se deriva.',
    inputSchema: { tipo_identificacion: z.string().optional(), identificacion: z.string(), razon_social: z.string(), email: z.string().optional(), telefono: z.string().optional(), direccion: z.string().optional() },
  }, async (a) => call('POST', '/contacts', a));

  server.registerTool('crear_producto', {
    title: 'Crear un producto',
    description: 'Da de alta un producto en el catálogo del tenant.',
    inputSchema: { descripcion: z.string(), precio_unitario: z.number().optional(), iva_codigo_porcentaje: z.string().optional(), codigo_principal: z.string().optional() },
  }, async (a) => call('POST', '/products', a));

  return server;
}
