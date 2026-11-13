/**
 * Flujo determinista del bot de Instagram.
 *
 * POR QUE EXISTE
 * ---------------
 * La version anterior del bot usaba la IA para contestar todo, y eso
 * provocaba lo que el usuario denomino "bombardeo":
 *
 *   - El bot ofrecia "iquieres que te pase con un asesor?", el cliente
 *     contestaba "Si", y el bot tomaba ese "Si" como una nueva pregunta y
 *     volvia a mandar el mismo estado. Y otra vez. Y otra vez.
 *   - Cada mensaje nuevo del cliente re-triggeraba una respuesta completa,
 *     aunque el bot ya habia contestado lo mismo.
 *   - Cuando un asesor humano estaba hablando con el cliente, el bot se
 *     metia en medio y contestaba en paralelo.
 *
 * QUE HACE ESTE MODULO
 * --------------------
 * El bot hace SOLO dos cosas, y cada una con un criterio claro de "una vez":
 *
 *   1) PEDIR EL NUMERO DE PEDIDO  (cuando no lo tiene)
 *   2) DECIR DONDE ESTA EL PEDIDO  (cuando ya lo tiene)
 *
 * En cualquier otro caso se queda mudo. Y se calla siempre que detecte que
 * un asesor humano esta hablando con ese cliente.
 *
 * COMO SE SABE QUE YA SE RESPONDIO
 * ---------------------------------
 * No hay base de datos de estado: la fuente de verdad es el HISTORIAL de la
 * conversacion (Graph API). Los mensajes que envia el bot tienen una marca
 * recognizable, asi que se pueden distinguir de los que escribe un asesor
 * humano (que escribe desde la misma cuenta de Instagram).
 *
 *   - "Hola, gracias por comunicarte con nosotros..."  -> mensaje del bot
 *   - "Estado de tu pedido MON4722: en camino."          -> mensaje del bot
 *   - "Te paso con un asesor de Mondano..."              -> mensaje del bot
 *   - cualquier otro mensaje de nuestra cuenta           -> ASESOR HUMANO
 *
 * Ademas hay una cache en memoria (por si la Graph API va lenta y todavia
 * no muestra el ultimo mensaje que mandamos).
 */

/** Nuestra cuenta de Instagram (la del bot y la de los asesores). */
const NUESTRO_ID = process.env.META_INSTAGRAM_ACCOUNT_ID || "17841408417156397";

/** Saludo fijo: marca inconfundible de un mensaje enviado por el bot. */
const SALUDO = "Hola, gracias por comunicarte con nosotros";

/** Marca de los mensajes del bot que PIDEN el numero de pedido. */
const MARCA_PEDIR = "formato mon3007";

/** Marca de los mensajes del bot que dan el ESTADO de un pedido. */
const MARCA_ESTADO = "estado de tu pedido mon";

/** Texto que el bot usa para derivar a un asesor. */
const TEXTO_ASESOR =
  "Te paso con un asesor de Mondano que te va a ayudar. " +
  "Puedes contactarnos también al +56 9 9689 1362 o por contacto@mondano.cl";

/** Frase obligatoria cuando el pedido aun no tiene numero de seguimiento. */
const FRASE_SIN_SEGUIMIENTO =
  "Estamos revisando la información, nos comunicaremos contigo en breve.";

/**
 * Cuanto tiempo se recuerda en memoria lo que ya se le respondio a cada
 * cliente. Es una red de seguridad para cuando la Graph API va lenta y el
 * ultimo mensaje del bot todavia no aparece en el historial.
 */
const CACHE_TTL_MS = Number(process.env.FLOW_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

/**
 * Si un asesor humano escribio hace menos de esto, se considera que sigue
 * trabajando con ese cliente y el bot no interviene.
 */
const VIGENCIA_ASESOR_MS = Number(
  process.env.FLOW_VIGENCIA_ASESOR_MS || 48 * 60 * 60 * 1000
);

// ---------------------------------------------------------------------------
// Normalizacion y deteccion de mensajes
// ---------------------------------------------------------------------------

/**
 * Normaliza texto para comparar: minusculas, sin tildes, sin signos de
 * puntuacion y sin espacios de mas.
 *
 * @param {string} texto Texto.
 * @returns {string}
 */
function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza para buscar marcas, y ADEMAS quita los guiones.
 *
 * El bot viejo escribia "MON-3007" y el nuevo "MON3007": sin quitar el
 * guion, un mensaje nuestro queda como si fuera de otra persona.
 *
 * @param {string} texto Texto.
 * @returns {string}
 */
function normalizarMarca(texto) {
  return normalizar(texto).replace(/-/g, "");
}

/**
 * El texto es el mensaje de derivacion a un asesor (lo mando el bot).
 *
 * @param {string} texto Texto.
 * @returns {boolean}
 */
function esPlantillaAsesor(texto) {
  return normalizar(texto).startsWith("te paso con un asesor de mondano");
}

/**
 * El texto es un mensaje del BOT (no lo escribio un asesor humano).
 *
 * Se reconocen varias marcas, porque la version con IA escribia mensajes
 * con distinta forma (no todos empezaban con el saludo). Cuantas mas marcas
 * se reconocen, menos riesgo de confundir un mensaje del bot con uno de una
 * persona (y viceversa).
 *
 * @param {string} texto Texto.
 * @returns {boolean}
 */
function esMensajeDelBot(texto) {
  const n = normalizarMarca(texto);
  if (!n) return false;
  if (n.startsWith("hola gracias por comunicarte con nosotros")) return true;
  if (esPlantillaAsesor(texto)) return true;
  if (n.includes(MARCA_ESTADO)) return true;
  if (n.includes(MARCA_PEDIR)) return true;
  return BOT_MARKERS.some((re) => re.test(n));
}

/**
 * Otras marcas que solo usa el bot (o que el bot si o si escribe).
 *
 * Se comparan contra el texto NORMALIZADO (minusculas y sin tildes).
 */
const BOT_MARKERS = [
  /gracias por comunicarte/,
  /n[uú]mero de seguimiento/,
  /transportista/,
  /chilexpress|starken|blue express|correos chile/,
  /en confecci[oó]n/,
  /en el taller/,
  /esta preparado|ya esta listo/,
  /p[aá]same el n[uú]mero|pasame tu n[uú]mero|me das el n[uú]mero/,
  /gracias por la espera/,
  /te cuento|te informo/,
];

/**
 * El texto es el bot pidiendo el numero de pedido.
 *
 * El marcador "formato MON3007" sirve tanto para las plantillas nuevas como
 * para las que mandaba la version con IA, asi que los hilos viejos tambien
 * se respetan.
 *
 * @param {string} texto Texto.
 * @returns {boolean}
 */
function pidioNumero(texto) {
  return normalizarMarca(texto).includes(MARCA_PEDIR);
}

/**
 * Extrae el pedido y el estado de un mensaje de estado del bot.
 *
 * Formato: "Estado de tu pedido MON4722: en camino."
 *
 * @param {string} texto Texto.
 * @returns {{orderId: string, slug: string}|null}
 */
function parseEstado(texto) {
  const m = String(texto || "").match(
    /Estado de tu pedido\s+(MON[\s-]?\d+)\s*:\s*([^.\n]+)/i
  );
  if (!m) return null;
  return {
    orderId: m[1].toUpperCase().replace(/[\s-]/g, ""),
    slug: normalizar(m[2]).trim(),
  };
}

// ---------------------------------------------------------------------------
// Lectura del hilo
// ---------------------------------------------------------------------------

/**
 * Analiza el historial de un hilo y deduce que se le puede decir al cliente.
 *
 * @param {Array} messages Mensajes del hilo (crudos de la Graph API).
 * @param {object} [options]
 * @param {string} [options.ourId] Id de nuestra cuenta.
 * @param {number} [options.now] Momento actual (para pruebas).
 * @returns {object} Analisis del hilo.
 */
function analizarHilo(messages, { ourId = NUESTRO_ID, now = Date.now() } = {}) {
  const info = {
    /** Hay un mensaje que escribio una persona (no el bot). */
    hayAsesor: false,
    /** Fecha del ultimo mensaje de un asesor. */
    tAsesor: null,
    /** Fecha del ultimo mensaje del cliente. */
    tCliente: null,
    /** El bot ya le pidio el numero de pedido. */
    pidioNumero: false,
    /** El bot ya lo derivo a un asesor. */
    handoff: false,
    /** Estados ya comunicados: { MON4722: "en camino" }. */
    estados: {},
  };

  const lista = [...(messages || [])].sort((a, b) =>
    String(a.created_time || "").localeCompare(String(b.created_time || ""))
  );

  for (const m of lista) {
    const texto = String(m.message || "");
    const nuestro = String(m.from?.id || "") === String(ourId);
    const t = Date.parse(m.created_time || "") || null;

    if (!nuestro) {
      if (t) info.tCliente = Math.max(info.tCliente || 0, t);
      continue;
    }

    if (pidioNumero(texto)) {
      info.pidioNumero = true;
      continue;
    }
    const estado = parseEstado(texto);
    if (estado) {
      info.estados[estado.orderId] = estado.slug;
      continue;
    }
    if (esPlantillaAsesor(texto)) {
      info.handoff = true;
      continue;
    }

    // Cualquier otro mensaje de nuestra cuenta lo escribio una persona.
    // Solo cuentan los recientes: un mensaje viejo no deja al bot mudo
    // para siempre (p. ej. el mensaje de prueba de hace un mes).
    if (!t || now - t < VIGENCIA_ASESOR_MS) {
      info.hayAsesor = true;
      info.tAsesor = Math.max(info.tAsesor || 0, t || 0);
    }
  }

  // El asesor sigue a cargo si hablo DESPUES del ultimo mensaje del
  // cliente (el cliente esta esperando al asesor) o si escribio hace poco.
  info.asesorActivo =
    info.hayAsesor &&
    ((info.tAsesor && info.tCliente && info.tAsesor >= info.tCliente) ||
      (info.tAsesor && now - info.tAsesor < VIGENCIA_ASESOR_MS));

  return info;
}

// ---------------------------------------------------------------------------
// Cache en memoria (red de seguridad)
// ---------------------------------------------------------------------------

/** @type {Map<string, {at: number, pidioNumero: boolean, handoff: boolean, estados: object}>} */
const cache = new Map();

/**
 * Lee lo que se le respondio a un cliente.
 *
 * @param {string} key Id del cliente.
 * @returns {object} Estado cacheado (vacio si no hay).
 */
function leerCache(key) {
  const guardado = cache.get(key);
  if (!guardado) {
    return { pidioNumero: false, handoff: false, estados: {}, orderId: null };
  }
  if (Date.now() - guardado.at > CACHE_TTL_MS) {
    cache.delete(key);
    return { pidioNumero: false, handoff: false, estados: {}, orderId: null };
  }
  return guardado;
}

/**
 * Guarda lo que se le respondio a un cliente.
 *
 * @param {string} key Id del cliente.
 * @param {object} patch Campos a guardar.
 * @returns {void}
 */
function guardarCache(key, patch) {
  const anterior = leerCache(key);
  cache.set(key, {
    at: Date.now(),
    pidioNumero: anterior.pidioNumero || !!patch.pidioNumero,
    handoff: anterior.handoff || !!patch.handoff,
    estados: { ...anterior.estados, ...(patch.estados || {}) },
    orderId: patch.orderId || anterior.orderId || null,
  });
}

// ---------------------------------------------------------------------------
// Descripcion del estado del pedido
// ---------------------------------------------------------------------------

/**
 * Calcula el estado del pedido en palabras y su "slug" (palabra clave que
 * se usa para saber si ya se le dijo lo mismo).
 *
 * @param {object|null} shipment Envio normalizado (puede ser null).
 * @param {object} [fabNotes] Notas del taller ({ prepared }).
 * @returns {{slug: string, texto: string, problema: boolean}}
 */
function describirEstado(shipment, fabNotes = {}) {
  const s = String(
    (shipment && (shipment.status || shipment.currentStatus)) || ""
  ).toLowerCase();

  if (shipment && shipment.delivered) {
    return { slug: "entregado", texto: "fue entregado", problema: false };
  }
  if (/delivered|entregado/.test(s)) {
    return { slug: "entregado", texto: "fue entregado", problema: false };
  }
  if (/out for delivery|out_for_delivery|en reparto/.test(s)) {
    return { slug: "en reparto", texto: "está en reparto", problema: false };
  }
  if (/picked up|in transit|shipped|despachado|recolectado/.test(s)) {
    return { slug: "en camino", texto: "va en camino", problema: false };
  }
  if (/returned|lost|damaged|on hold|exception|redirection/.test(s)) {
    return {
      slug: "problema",
      texto: "tiene un problema con el envío",
      problema: true,
    };
  }

  // El paquete todavia no salio. Si ya tiene etiqueta esta PREPARADO
  // (esperando que la transportista lo retire); si no tiene etiqueta,
  // sigue en el taller.
  //
  // OJO: decir "en confección" y al mismo tiempo mostrar el numero de
  // seguimiento se contradice. Con etiqueta, es "preparado".
  if (shipment && shipment.trackingNumber) {
    return {
      slug: "preparado",
      texto: "ya está preparado y esperando que la transportista lo retire",
      problema: false,
    };
  }
  if (fabNotes && fabNotes.prepared) {
    return {
      slug: "preparado",
      texto: "ya está preparado y esperando que la transportista lo retire",
      problema: false,
    };
  }
  return {
    slug: "en confección",
    texto: "está en confección, en el taller",
    problema: false,
  };
}

/**
 * Arma el mensaje de estado del pedido.
 *
 * @param {object} params
 * @param {string} params.orderId Numero de pedido.
 * @param {object|null} params.shipment Envio normalizado.
 * @param {object} [params.fabNotes] Notas del taller.
 * @returns {string} Mensaje para el cliente.
 */
function plantillaEstado({ orderId, shipment, fabNotes = {} }) {
  const estado = describirEstado(shipment, fabNotes);
  const lineas = [];

  lineas.push(`${SALUDO}. Estado de tu pedido ${orderId}: ${estado.slug}.`);

  // La frase del estado, con la fecha cuando el pedido ya fue entregado.
  if (estado.slug === "entregado" && shipment && shipment.deliveredAt) {
    const fecha = new Date(shipment.deliveredAt);
    if (!Number.isNaN(fecha.getTime())) {
      const texto = fecha.toLocaleDateString("es-CL", {
        day: "numeric",
        month: "long",
      });
      lineas.push(`Tu pedido fue entregado el ${texto}.`);
    } else {
      lineas.push("Tu pedido fue entregado.");
    }
  } else if (estado.slug === "en camino" && shipment && shipment.carrier) {
    lineas.push(`Tu pedido va en camino con ${shipment.carrier}.`);
  } else {
    lineas.push(`Tu pedido ${estado.texto}.`);
  }

  if (shipment && shipment.trackingNumber) {
    lineas.push(`Número de seguimiento: ${shipment.trackingNumber}`);
    if (shipment.carrier) lineas.push(`Transportista: ${shipment.carrier}`);
    if (shipment.trackUrl) lineas.push(`Puedes seguirlo aquí: ${shipment.trackUrl}`);
  } else if (estado.slug === "en confección") {
    // Todavia no hay numero de seguimiento: hay que decirlo textual.
    lineas.push(FRASE_SIN_SEGUIMIENTO);
  }

  return lineas.join("\n");
}

/**
 * Plantillas para pedir el numero de pedido.
 *
 * Hay varias porque Instagram penaliza los envios con TEXTO IDENTICO a
 * varios clientes seguidos (el cron de la bandeja mandaba la misma frase a
 * 5 personas). Se elige una segun el cliente, de forma estable: si vuelve
 * a tocarle, le toca la misma.
 *
 * Todas contienen "formato MON3007", que es la marca que permite saber que
 * ya se le pregunto (tambien la usan los mensajes del bot viejo).
 */
const PLANTILLAS_PEDIR = [
  "Para revisar tu pedido, ¿me das el número de pedido (formato MON3007)?",
  "¿Me pasas el número de tu pedido (formato MON3007) para revisarlo?",
  "Necesito el número de tu pedido (formato MON3007) para contarte cómo va.",
  "¿Cuál es el número de tu pedido? Va en formato MON3007.",
];

/**
 * Plantilla para pedir el numero de pedido.
 *
 * @param {string} [orderId] Pedido que no se encontro (opcional).
 * @param {string} [clienteId] Id del cliente (para variar la frase).
 * @returns {string} Mensaje para el cliente.
 */
function plantillaPedirNumero(orderId, clienteId) {
  if (orderId) {
    return (
      `${SALUDO}. No encontramos el pedido ${orderId}. ` +
      "Revisa el número, debe tener el formato MON3007 (por ejemplo MON3007)."
    );
  }

  let indice = 0;
  if (clienteId) {
    let suma = 0;
    for (const caracter of String(clienteId)) suma += caracter.charCodeAt(0);
    indice = suma % PLANTILLAS_PEDIR.length;
  }

  return `${SALUDO}. ${PLANTILLAS_PEDIR[indice]}`;
}

// ---------------------------------------------------------------------------
// Deteccion de intencion (sin IA)
// ---------------------------------------------------------------------------

/**
 * El cliente pide hablar con una persona.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function pideAsesor(text) {
  const t = normalizar(text);
  return [
    /\bhablar con (alguien|una persona|un humano|un asesor|una asesora)\b/,
    /\bcon un (humano|asesor|agente|operador)\b/,
    /\bquiero (un|una) (asesor|humano|asesora)\b/,
    /\bpersona (real|humana)\b/,
    /\bescalar\b/,
    /\bqueja\b/,
    /\breclamo\b/,
  ].some((re) => re.test(t));
}

/**
 * El mensaje trata sobre un pedido (no es un saludo, ni un comentario, ni
 * una pregunta de productos).
 *
 * Si el bot no tiene ningun pedido y el cliente no esta preguntando por uno,
 * no se le pide un numero de pedido: se queda mudo.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function sobrePedido(text) {
  const t = normalizar(text);
  if (!t) return false;
  if (/\bmon[\s-]?\d{3,}\b/.test(t)) return true;
  return [
    /\bpedido/,
    /\borden(es)?\b/,
    /\bcompra/,
    /\bcompre\b/,
    /\bcomprar\b/,
    /\benvio/,
    /\bentrega/,
    /\bpaquete/,
    /\blleg[oó]\b/,
    /\bllega/,
    /\bllegada\b/,
    /\bseguimiento\b/,
    /\btracking\b/,
    /\brastreo\b/,
    /\bn[uú]mero de pedido\b/,
    /\bdonde esta\b/,
    /\bd[oó]nde lo tengo\b/,
    /\brecib/,
    /\bcuanto (tiempo|falta)/,
  ].some((re) => re.test(t));
}

/**
 * El cliente tiene un problema con el pedido que NO es de seguimiento
 * (cambio, devolucion, prenda danada). Eso lo resuelve una persona.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function problemaConPedido(text) {
  const t = normalizar(text);
  return [
    /\b(cambio|cambiar|cambio de talla|devolucion|devolver|reembolso|reembolsar)\b/,
    /\b(garantia|garantizado)\b/,
    /\b(danad[oa]|danio|roto|rota|descosid[oa]|mal estado|mal stitched)\b/,
  ].some((re) => re.test(t));
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * Decide que responderle al cliente.
 *
 * @param {object} params
 * @param {string} params.text Texto del cliente.
 * @param {string} params.customerId Id del cliente (para la cache).
 * @param {object} params.analisis Analisis del hilo (analizarHilo).
 * @param {object} [params.resolved] Resultado de resolver el pedido.
 * @param {object} [params.fabNotes] Notas del taller.
 * @returns {{accion: string, texto: string|null, motivo: string}}
 */
function decidir({
  text,
  customerId,
  analisis,
  resolved = {},
  fabNotes = {},
}) {
  const cacheado = customerId ? leerCache(customerId) : { pidioNumero: false, handoff: false, estados: {} };

  const pidioNumero = analisis.pidioNumero || cacheado.pidioNumero;
  const handoff = analisis.handoff || cacheado.handoff;
  const estados = { ...cacheado.estados, ...(analisis.estados || {}) };

  // 1) Un asesor esta hablando con este cliente: el bot se calla.
  if (analisis.asesorActivo) {
    return {
      accion: "silencio",
      texto: null,
      motivo: "un asesor esta hablando con el cliente",
    };
  }

  // 2) Ya lo derivamos a un asesor: el bot no vuelve a interferir.
  if (handoff) {
    return {
      accion: "silencio",
      texto: null,
      motivo: "ya lo derivamos a un asesor",
    };
  }

  // 3) Pide una persona o tiene un problema con el pedido: se deriva.
  if (pideAsesor(text) || problemaConPedido(text)) {
    return { accion: "asesor", texto: TEXTO_ASESOR, motivo: "pide un asesor" };
  }

  const orderId = resolved.orderId || null;

  // 3) No hay pedido: se pide el numero (una sola vez), pero solo si el
  //    cliente esta preguntando por un pedido. Si pregunta otra cosa
  //    (un producto, un saludo, un comentario), el bot se calla.
  if (!orderId) {
    if (pidioNumero) {
      return {
        accion: "silencio",
        texto: null,
        motivo: "ya le pedimos el numero de pedido",
      };
    }
    if (!sobrePedido(text)) {
      return {
        accion: "silencio",
        texto: null,
        motivo: "no pregunta por un pedido",
      };
    }
    return {
      accion: "pedir",
      texto: plantillaPedirNumero(null, customerId),
      motivo: "no hay numero de pedido",
    };
  }

  // 4) Hay pedido pero no existe (o no se pudo verificar).
  if (resolved.reason === "pedido_no_encontrado") {
    if (pidioNumero) {
      return {
        accion: "silencio",
        texto: null,
        motivo: "ya le pedimos el numero de pedido",
      };
    }
    return {
      accion: "pedir",
      texto: plantillaPedirNumero(orderId),
      motivo: "el pedido no existe",
    };
  }

  if (resolved.reason === "sin_verificar") {
    if (handoff) {
      return {
        accion: "silencio",
        texto: null,
        motivo: "ya lo derivamos a un asesor",
      };
    }
    return {
      accion: "asesor",
      texto: TEXTO_ASESOR,
      motivo: "no se pudo verificar el envio",
    };
  }

  // 5) Hay pedido: se dice donde esta (una vez por estado).
  const estado = describirEstado(resolved.shipment, fabNotes);

  if (estado.problema) {
    if (handoff) {
      return {
        accion: "silencio",
        texto: null,
        motivo: "ya lo derivamos a un asesor",
      };
    }
    return {
      accion: "asesor",
      texto: TEXTO_ASESOR,
      motivo: "el envio tiene un problema",
    };
  }

  const previo = estados[orderId];
  if (previo && normalizar(previo) === normalizar(estado.slug)) {
    return {
      accion: "silencio",
      texto: null,
      motivo: `ya le dijimos que esta "${estado.slug}"`,
    };
  }

  return {
    accion: "estado",
    texto: plantillaEstado({
      orderId,
      shipment: resolved.shipment,
      fabNotes,
    }),
    motivo: `estado: ${estado.slug}`,
  };
}

/**
 * Guarda en la cache que se le respondio esto al cliente.
 *
 * @param {string} customerId Id del cliente.
 * @param {string} accion Accion que se ejecuto.
 * @param {string} [orderId] Pedido concernée.
 * @param {string} [slug] Estado comunicado.
 * @returns {void}
 */
function registrar(customerId, accion, orderId, slug) {
  if (!customerId) return;
  if (accion === "pedir") {
    guardarCache(customerId, { pidioNumero: true });
  } else if (accion === "asesor") {
    guardarCache(customerId, { handoff: true });
  } else if (accion === "estado" && orderId && slug) {
    guardarCache(customerId, { estados: { [orderId]: slug }, orderId });
  }
}

module.exports = {
  NUESTRO_ID,
  SALUDO,
  MARCA_PEDIR,
  MARCA_ESTADO,
  TEXTO_ASESOR,
  FRASE_SIN_SEGUIMIENTO,
  CACHE_TTL_MS,
  VIGENCIA_ASESOR_MS,
  normalizar,
  esMensajeDelBot,
  esPlantillaAsesor,
  pidioNumero,
  parseEstado,
  analizarHilo,
  describirEstado,
  plantillaEstado,
  plantillaPedirNumero,
  PLANTILLAS_PEDIR,
  pideAsesor,
  sobrePedido,
  problemaConPedido,
  decidir,
  registrar,
  leerCache,
  guardarCache,
};
