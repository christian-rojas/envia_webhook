/**
 * Feature toggles del bot.
 *
 * Cada funcionalidad se puede encender y apagar sin tocar el codigo, con
 * una variable de entorno en Vercel:
 *
 *   FEATURE_WHATSAPP=0            apaga WhatsApp (solo Instagram)
 *   FEATURE_INSTAGRAM=1            apaga Instagram (solo WhatsApp)
 *   FEATURE_MANUFACTURING=0        no cuenta el proceso de fabricacion
 *   FEATURE_PRODUCT_INFO=0         no busca productos del catalogo
 *   FEATURE_CONVERSATION_HISTORY=0 no lee el historial de la conversacion
 *
 * Los valores admitidos son 1/0, true/false, on/off, si/no, yes/no.
 * Si no se define la variable, aplica el valor por defecto.
 */

/**
 * Normaliza el valor de una variable de entorno a booleano.
 *
 * @param {string|undefined} value Valor crudo.
 * @param {boolean} porDefecto Valor si no esta definida.
 * @returns {boolean}
 */
function toBool(value, porDefecto) {
  if (value === undefined || value === null || value === "") return porDefecto;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "on", "yes", "si", "sí"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return porDefecto;
}

/** Definicion de cada flag: valor por defecto y para que sirve. */
const DEFINICIONES = {
  // WhatsApp queda apagado mientras se resuelve la parte de permisos de Meta.
  whatsapp: { porDefecto: false, desc: "Responder por WhatsApp" },
  instagram: { porDefecto: true, desc: "Responder por Instagram" },
  // El proceso de manufactura (notas del taller en Shopify).
  manufacturing: { porDefecto: true, desc: "Contar el proceso de fabricacion" },
  // Informacion de productos del catalogo (precio, tallas, tabla de medidas).
  productInfo: { porDefecto: true, desc: "Info de productos del catalogo" },
  // Historial de la conversacion (para no repetir ni pedir el pedido de nuevo).
  conversationHistory: {
    porDefecto: true,
    desc: "Leer el historial de la conversacion",
  },
  // Politica de cambios y devoluciones + guia de tallas.
  storePolicies: { porDefecto: true, desc: "Politicas y guias de la tienda" },
};

/**
 * Estado actual de todos los flags.
 *
 * @returns {Object<string, boolean>}
 */
function flags() {
  const out = {};
  for (const [nombre, def] of Object.entries(DEFINICIONES)) {
    out[nombre] = toBool(process.env[`FEATURE_${nombre.toUpperCase()}`], def.porDefecto);
  }
  return out;
}

/**
 * Indica si una funcionalidad esta encendida.
 *
 * @param {string} nombre Nombre del flag.
 * @returns {boolean}
 */
function isEnabled(nombre) {
  const def = DEFINICIONES[nombre];
  if (!def) return false;
  return toBool(
    process.env[`FEATURE_${nombre.toUpperCase()}`],
    def.porDefecto
  );
}

/**
 * Descripcion de los flags para el endpoint /health.
 *
 * @returns {Object<string, object>}
 */
function describe() {
  const estado = flags();
  const out = {};
  for (const [nombre, def] of Object.entries(DEFINICIONES)) {
    out[nombre] = { activo: estado[nombre], desc: def.desc };
  }
  return out;
}

module.exports = { flags, isEnabled, describe, toBool, DEFINICIONES };
