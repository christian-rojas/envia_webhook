/**
 * Agente de IA para respuestas automaticas de WhatsApp.
 *
 * Usa x.ai (API compatible con OpenAI) para responder preguntas de tracking
 * de pedidos. La IA recibe como contexto el estado real del envio (obtenido
 * de la API de Envia) y NO debe inventar datos.
 *
 * Reglas de negocio implementadas aqui:
 *  - La IA solo responde sobre datos que aparecen en el contexto entregado.
 *  - Si la IA no sabe, indica que va a escalar a un humano.
 *  - Se detecta la intencion de hablar con una persona y se escala de inmediato.
 */

const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
const XAI_MODEL = process.env.XAI_MODEL || "grok-4.7";

/**
 * Palabras que indican que el cliente quiere hablar con una persona.
 * El regex es deliberadamente amplio: ante la duda, escalar es mejor que
 * responder mal.
 */
const HUMAN_INTENT_PATTERNS = [
  /\bhablar con (alguien|una persona|un humano|un asesor)\b/i,
  /\bhablar con (alguien|una persona|un humano|un asesor)\b/i,
  /\bcon un (humano|asesor|agente|operador)\b/i,
  /\bpersona (real|humana)\b/i,
  /\bhablar con (alguien|un agente)\b/i,
  /\bescalar\b/i,
  /\bqueja\b/i,
  /\breclamo\b/i,
  /\bproblema (con|grave)\b/i,
  /\bno (me )?(sirve|sirven|funciona)\b/i,
  /\bquiero (cancelar|devolver|reembolsar)\b/i,
  /\bhumano\b/i,
  /\bagente\b/i,
];

/**
 * Detecta si el mensaje pide intervención humana.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function wantsHuman(text) {
  if (!text) return false;
  return HUMAN_INTENT_PATTERNS.some((re) => re.test(text));
}

/**
 * Palabras que indican que el cliente pregunta por un pedido o su envio.
 * Se usan para distinguir "hola" de "que paso con mi pedido?".
 */
const TRACKING_INTENT_PATTERNS = [
  /\bmi (pedido|orden|compra|envio|entrega)\b/i,
  /\b(pedido|orden|compra|envio|entrega)\b/i,
  /\b(donde|cuando|que)\s+(esta|llega|llegara|llego|llegó|pasó)\b/i,
  /\b(llego|llegó|recibí|recibio|me llego)\b/i,
  /\bseguimiento\b/i,
  /\btracking\b/i,
  /\bnumero de (pedido|seguimiento)\b/i,
  /\bestado\b/i,
  /\b(aun no|todavia no) me (llega|llegó)\b/i,
];

/**
 * Saludo puro: no contiene ninguna peticion.
 */
const GREETING_ONLY_PATTERNS = [
  /^\s*(hola|holi|holis|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|hello|que tal|que onda|saludos)\b[\s!.,¿?]*$/i,
];

/**
 * Detecta si el mensaje pregunta por el estado de un pedido.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function isTrackingIntent(text) {
  if (!text) return false;
  return TRACKING_INTENT_PATTERNS.some((re) => re.test(text));
}

/**
 * Detecta si el mensaje es solo un saludo (sin peticion).
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function isGreetingOnly(text) {
  if (!text) return false;
  return GREETING_ONLY_PATTERNS.some((re) => re.test(text));
}

/**
 * Contexto para cuando NO se pudo identificar el pedido.
 *
 * Distingue entre "no lo buscamos" y "lo buscamos y no existe", porque la
 * respuesta al cliente es muy distinta en cada caso.
 *
 * @param {object} params
 * @param {string} [params.reason] Motivo por el que no se pudo resolver.
 * @param {string} [params.orderId] Pedido que dio el cliente.
 * @param {number} [params.matches] Cuantos envios coinciden con el telefono.
 * @param {string} [params.channel] 'instagram' | 'whatsapp'
 * @param {boolean} [params.greeting] El mensaje fue solo un saludo.
 * @returns {string}
 */
function buildMissingDataContext({ reason, orderId, matches, channel, greeting } = {}) {
  const lines = [];

  if (greeting) {
    lines.push(
      `El cliente solo saluda. Saluda de vuelta y PIDE DIRECTAMENTE el dato ` +
        `que falta (no preguntes "en que puedo ayudarte" sin decir que ` +
        `datos necesitas).`
    );
  }

  switch (reason) {
    case "pedido_desconocido":
      lines.push(
        `Se busca el pedido ${orderId} pero NO existe en la base de datos. ` +
          `Pide al cliente que revise el numero de pedido (formato MON-3007).`
      );
      break;

    case "telefono_multiples":
      lines.push(
        `Ese telefono tiene ${matches} pedidos/envios. ` +
          `Pide al cliente que confirme CUAL pedido (numero MON-XXXX) quiere consultar.`
      );
      break;

    case "telefono_sin_match":
      lines.push(
        `Se busca un envio asociado al telefono del cliente pero no hay ninguno. ` +
          `Pide el numero de pedido (formato MON-3007) para poder verificarlo.`
      );
      break;

    case "pedido_sin_match_telefono":
      lines.push(
        `El pedido ${orderId} fue encontrado, pero el telefono del remitente no ` +
          `coincide con el del destinatario del envio.`
      );
      break;

    default:
      lines.push(
        `Todavia NO se ha identificado ningun pedido del cliente. ` +
          `No se ha buscado nada todavia: falta un dato.`
      );
      break;
  }

  if (channel === "instagram") {
    // En Instagram no se conoce el telefono del cliente, asi que se ofrecen
    // las dos vias: el numero de pedido o el telefono de compra.
    lines.push(
      `Pide el numero de pedido (formato MON-3007) y Ofrece como alternativa ` +
        `el telefono con el que hizo la compra. Elige una, no insistas con ambas.`
    );
  } else {
    // En WhatsApp ya se conoce el telefono del cliente: solo falta el pedido.
    lines.push(`Pide el numero de pedido (formato MON-3007).`);
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `Eres el asistente de WhatsApp de Mondano, una marca chilena de moda urbana.

Tu unica funcion es responder preguntas sobre el estado y la fecha de entrega de un pedido.

REGLAS ESTRICTAS:
1. Responde SOLO con informacion presente en el CONTEXTO DEL PEDIDO que se te entrega.
2. Si el contexto no contiene la respuesta, NO inventes ni estimes. Di que no tienes esa informacion y que un asesor te ayudara.
3. Se breve y friendly, como un chat. Usa "tú". Maximo 3 frases.
4. Si el pedido NO fue encontrado, pide el numero de pedido (formato MON-XXXX) y ofrece pasar con un asesor.
5. Si el cliente saluda sin pedir informacion, responde con un saludo corto y preguntale como puedes ayudarte.
6. Nunca prometas fechas que no esten en el contexto.
7. Nunca inventes politicas de la tienda (plazos de envio, costos, formas de pago) que no esten en el contexto.
8. Cuando el contexto indique que falta un dato para identificar el pedido, pide el numero de pedido (formato MON-XXXX). Si el contexto indica que puedes ofrecer el telefono de compra como alternativa, ofrecelo en la misma frase, sin pedir los dos datos por separado.
9. Si el contexto indica que el cliente tiene varios pedidos, pidele que confirme cual.

FORMATO DE RESPUESTA: solo el texto que se envia por WhatsApp. Sin prefijo, sin comillas, sin markdown.`;

/**
 * Construye el contexto del pedido a partir de los datos de envio.
 *
 * @param {object} shipment Datos del envio y tracking.
 * @returns {string} Contexto en texto plano para el prompt.
 */
function buildShipmentContext(shipment) {
  if (!shipment) return "No se encontro ningun pedido asociado a este numero de telefono.";

  const lines = [];
  lines.push(`Numero de pedido: ${shipment.orderId || "desconocido"}`);
  if (shipment.trackingNumber) lines.push(`Numero de seguimiento: ${shipment.trackingNumber}`);
  if (shipment.carrier) lines.push(`Transportista: ${shipment.carrier}`);
  if (shipment.service) lines.push(`Servicio: ${shipment.service}`);

  if (shipment.events && shipment.events.length > 0) {
    lines.push("Ultimos eventos del envio:");
    for (const ev of shipment.events) {
      const when = ev.date ? ev.date : "";
      const where = ev.city ? ` en ${ev.city}` : "";
      lines.push(`- ${when}${where}: ${ev.description || ev.status || ""}`);
    }
  }

  if (shipment.estimatedDelivery) {
    lines.push(`Fecha estimada de entrega: ${shipment.estimatedDelivery}`);
  }
  if (shipment.currentStatus || shipment.status) {
    lines.push(`Estado actual: ${shipment.currentStatus || shipment.status}`);
  }
  if (shipment.delivered) {
    lines.push("El pedido fue entregado.");
  }

  return lines.join("\n");
}

/**
 * Genera la respuesta del agente con x.ai.
 *
 * @param {object} params
 * @param {string} params.userText Mensaje del cliente.
 * @param {string} params.context Contexto del pedido.
 * @param {string} [params.apiKey] Clave de x.ai.
 * @param {string} [params.model] Modelo a usar.
 * @returns {Promise<{ok: boolean, reply: string, error?: string}>}
 */
async function generateReply({ userText, context, apiKey, model }) {
  const key = apiKey || process.env.XAI_API_KEY;
  const modelId = model || XAI_MODEL;

  if (!key || key === "PENDIENTE" || !key.trim()) {
    return { ok: false, reply: "", error: "XAI_API_KEY no configurado (placeholder o vacio)" };
  }

  const prompt = `CONTEXTO DEL PEDIDO:\n${context || "(sin contexto)"}\n\n---\nMENSAJE DEL CLIENTE:\n${userText}`;

  try {
    const response = await fetch(`${XAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        store: false,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      return { ok: false, reply: "", error: detail };
    }

    // La Responses API devuelve output_text o el array output con items de tipo message.
    let text = "";
    if (typeof data.output_text === "string" && data.output_text) {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "output_text" && part.text) text += part.text;
          }
        }
      }
    }

    if (!text) {
      return { ok: false, reply: "", error: "La IA no devolvio texto" };
    }

    return { ok: true, reply: text.trim() };
  } catch (error) {
    return { ok: false, reply: "", error: error.message };
  }
}

module.exports = {
  XAI_MODEL,
  SYSTEM_PROMPT,
  wantsHuman,
  isTrackingIntent,
  isGreetingOnly,
  buildShipmentContext,
  buildMissingDataContext,
  generateReply,
};
