/**
 * Tests del flujo determinista del bot (flow.js).
 *
 *   node scripts/test_flujo.js
 *
 * Sin red: se simulan los hilos y los pedidos.
 */

const flow = require("../flow.js");

const OUR = "17841408417156397";
const CLIENTE = "2746101999184243";

let pasaron = 0;
let fallaron = 0;

/**
 * @param {string} nombre Nombre del test.
 * @param {boolean} ok Resultado.
 * @param {string} [detalle] Detalle del fallo.
 */
function check(nombre, ok, detalle) {
  if (ok) {
    pasaron++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallaron++;
    console.log(`  FALLA ${nombre}${detalle ? " -> " + detalle : ""}`);
  }
}

/**
 * Crea un mensaje de hilo.
 *
 * @param {object} p { from, text, at }
 * @returns {object} Mensaje.
 */
function msg({ from, text, at }) {
  return {
    id: "m" + Math.random().toString(36).slice(2, 8),
    from: { id: from, username: from === OUR ? "mondano.cl" : "cliente" },
    message: text,
    created_time: at || new Date().toISOString(),
  };
}

/**
 * Crea un envio de ejemplo.
 *
 * @param {object} p Estado y extras.
 * @returns {object} Envio.
 */
function envio({ status, tracking = "712913101224", carrier = "Chilexpress" }) {
  return {
    status,
    currentStatus: status,
    trackingNumber: tracking,
    carrier,
    delivered: /delivered/i.test(status),
    deliveredAt: null,
    trackUrl: "https://envia.com/track/712913101224",
    events: [],
  };
}

/** Hilo vacio. */
const HILO_VACIO = flow.analizarHilo([]);

/**
 * Corre el flujo con un hilo y un pedido dados.
 *
 * @param {object} p { text, mensajes, resolved, fabNotes, customerId }
 * @returns {object} Decision.
 */
function correr({ text, mensajes = [], resolved, fabNotes = {}, customerId = CLIENTE }) {
  const analisis = flow.analizarHilo(mensajes);
  const decision = flow.decidir({
    text,
    customerId,
    analisis,
    resolved,
    fabNotes,
  });
  return { decision, analisis };
}

console.log("\n== Deteccion de mensajes ==");

check(
  "un mensaje con el saludo es del bot",
  flow.esMensajeDelBot("Hola, gracias por comunicarte con nosotros. Tu pedido MON1 va en camino.")
);
check(
  "un mensaje humano NO es del bot",
  !flow.esMensajeDelBot("Hola, te escribo para confirmar la entrega")
);
check(
  "el mensaje de derivacion es del bot",
  flow.esMensajeDelBot(flow.TEXTO_ASESOR)
);
check(
  "el mensaje de estado se reconoce",
  flow.pidioNumero("Hola, gracias por comunicarte con nosotros. Estado de tu pedido MON4722: en camino.") === false &&
    !!flow.parseEstado("Hola, gracias por comunicarte con nosotros. Estado de tu pedido MON4722: en camino.")
);

console.log("\n== 1) Pedir el numero de pedido ==");

let r = correr({
  text: "hola, donde esta mi pedido?",
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check("pide el numero cuando no hay pedido", r.decision.accion === "pedir", r.decision.accion);
check(
  "el mensaje pide el numero en formato MON3007",
  /formato MON3007/.test(r.decision.texto || ""),
  r.decision.texto
);

console.log("\n== 1b) No preguntar si no es del pedido ==");

r = correr({
  text: "hola",
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check(
  "un saludo solo no pide numero",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

r = correr({
  text: "cuanto cuesta el poleron azul?",
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check(
  "una pregunta de productos no pide numero",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

r = correr({
  text: "compre un poleron y no me ha llegado",
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check(
  "una pregunta de pedido si pide numero",
  r.decision.accion === "pedir",
  r.decision.accion + " / " + r.decision.motivo
);

console.log("\n== 2) No repetir el pedido (el 'bombardeo') ==");

const hiloPidiendo = [
  msg({ from: CLIENTE, text: "hola, donde esta mi pedido?" }),
  msg({
    from: OUR,
    text: "Hola, gracias por comunicarte con nosotros. Para revisar tu pedido, ¿me das el número de pedido (formato MON3007)?",
  }),
];

r = correr({
  text: "es que no lo tengo a mano",
  mensajes: hiloPidiendo,
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check(
  "no vuelve a pedir el numero",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

console.log("\n== 3) Decir donde esta el pedido ==");

r = correr({
  text: "MON4722",
  resolved: {
    shipment: envio({ status: "In transit" }),
    orderId: "MON4722",
    reason: "pedido",
  },
});
check("responde el estado", r.decision.accion === "estado", r.decision.accion);
check(
  "el mensaje lleva el estado y el seguimiento",
  /Estado de tu pedido MON4722: en camino/.test(r.decision.texto || "") &&
    /712913101224/.test(r.decision.texto || ""),
  r.decision.texto
);

console.log("\n== 4) No repetir el mismo estado ==");

const hiloConEstado = [
  msg({ from: CLIENTE, text: "MON4722" }),
  msg({
    from: OUR,
    text: "Hola, gracias por comunicarte con nosotros. Estado de tu pedido MON4722: en camino.\nNúmero de seguimiento: 712913101224",
  }),
];

r = correr({
  text: "y ahora? sigue igual?",
  mensajes: hiloConEstado,
  resolved: {
    shipment: envio({ status: "In transit" }),
    orderId: "MON4722",
    reason: "pedido",
  },
});
check(
  "no repite el estado si no cambio",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

console.log("\n== 5) Si el estado cambia, vuelve a avisar ==");

r = correr({
  text: "y ahora?",
  mensajes: hiloConEstado,
  resolved: {
    shipment: envio({ status: "Out for delivery" }),
    orderId: "MON4722",
    reason: "pedido",
  },
});
check(
  "avisa el cambio de estado",
  r.decision.accion === "estado" && /en reparto/.test(r.decision.texto || ""),
  r.decision.accion + " / " + r.decision.texto
);

console.log("\n== 6) Un asesor humano esta hablando ==");

const hiloConAsesor = [
  msg({ from: CLIENTE, text: "MON4722" }),
  msg({ from: OUR, text: "Hola, gracias por comunicarte con nosotros. Estado de tu pedido MON4722: en camino." }),
  msg({ from: OUR, text: "Hola te hablo de Mondano, te confirmo que el pedido va en camino" }),
];

r = correr({
  text: "hola?",
  mensajes: hiloConAsesor,
  resolved: {
    shipment: envio({ status: "In transit" }),
    orderId: "MON4722",
    reason: "pedido",
  },
});
check(
  "el bot se calla si hay un asesor",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);
check(
  "el analisis detecta al asesor",
  r.analisis.hayAsesor === true && r.analisis.asesorActivo === true
);

console.log("\n== 7) Pedir un asesor ==");

r = correr({
  text: "quiero hablar con un asesor por favor",
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check("deriva al asesor", r.decision.accion === "asesor", r.decision.accion);

const hiloDerivado = [
  msg({ from: CLIENTE, text: "quiero hablar con un asesor" }),
  msg({ from: OUR, text: flow.TEXTO_ASESOR }),
];
r = correr({
  text: "hola de nuevo",
  mensajes: hiloDerivado,
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check(
  "no deriva dos veces",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

console.log("\n== 8) El caso real que se estaba bombardedeando ==");

// El bot ofrecio un asesor, el cliente dijo "Si" y el bot le volvio a
// mandar el mismo estado. Ahora: una sola respuesta.
const hiloReal = [
  msg({ from: CLIENTE, text: "hola, mi pedido MON4722" }),
  msg({
    from: OUR,
    text: "Hola, gracias por comunicarte con nosotros. Estado de tu pedido MON4722: en confección.\nEstamos revisando la información, nos comunicaremos contigo en breve.",
  }),
  msg({ from: CLIENTE, text: "Sí" }),
];

r = correr({
  text: "Sí",
  mensajes: hiloReal,
  resolved: {
    shipment: null,
    orderId: "MON4722",
    reason: "pedido_sin_envio",
  },
});
check(
  "no repite la respuesta al 'Si'",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

console.log("\n== 9) Pedido sin envio ==");

r = correr({
  text: "mi pedido MON4722",
  resolved: {
    shipment: null,
    orderId: "MON4722",
    reason: "pedido_sin_envio",
  },
});
check("responde el estado sin envio", r.decision.accion === "estado", r.decision.accion);
check(
  "dice la frase obligatoria sin seguimiento",
  /Estamos revisando la información, nos comunicaremos contigo en breve/.test(
    r.decision.texto || ""
  ),
  r.decision.texto
);

console.log("\n== 10) Pedido que no existe ==");

r = correr({
  text: "MON9999",
  resolved: { shipment: null, orderId: "MON9999", reason: "pedido_no_encontrado" },
});
check(
  "pide revisar el numero",
  r.decision.accion === "pedir" && /No encontramos el pedido MON9999/.test(r.decision.texto || ""),
  r.decision.accion + " / " + r.decision.texto
);

console.log("\n== 11) Estados ==");

check(
  "sin envio -> en confección",
  flow.describirEstado(null, {}).slug === "en confección"
);
check(
  "preparado en Shopify -> preparado",
  flow.describirEstado(null, { prepared: true }).slug === "preparado"
);
check(
  "Created CON etiqueta -> preparado (no se contradice con el seguimiento)",
  flow.describirEstado(envio({ status: "Created" }), {}).slug === "preparado"
);
check(
  "Picked up -> en camino",
  flow.describirEstado(envio({ status: "Picked up" }), {}).slug === "en camino"
);
check(
  "Delivered -> entregado",
  flow.describirEstado(envio({ status: "Delivered" }), {}).slug === "entregado"
);
check(
  "Returned -> problema",
  flow.describirEstado(envio({ status: "Returned" }), {}).problema === true
);

console.log("\n== 12) El mensaje no se contradice ==");

r = correr({
  text: "mi pedido MON4697",
  resolved: {
    shipment: envio({ status: "Created", tracking: "713162050215" }),
    orderId: "MON4697",
    reason: "pedido",
  },
});
check(
  "con etiqueta dice 'preparado' (no 'en confección' + seguimiento)",
  /Estado de tu pedido MON4697: preparado/.test(r.decision.texto || ""),
  r.decision.texto
);

r = correr({
  text: "mi pedido MON4687",
  resolved: {
    shipment: null,
    orderId: "MON4687",
    reason: "pedido_sin_envio",
  },
});
check(
  "sin etiqueta dice 'en confección' y la frase de revisar",
  /Estado de tu pedido MON4687: en confección/.test(r.decision.texto || "") &&
    /Estamos revisando la información, nos comunicaremos contigo en breve/.test(
      r.decision.texto || ""
    ),
  r.decision.texto
);

console.log("\n== 13) Si el cliente insiste (toggle FEATURE_REPETIR_ESTADO) ==");

const hiloInsistencia = [
  msg({ from: CLIENTE, text: "hola, mi pedido MON4712" }),
  msg({
    from: OUR,
    text: "Hola, gracias por comunicarte con nosotros. Estado de tu pedido MON4712: en confección.",
  }),
  msg({ from: CLIENTE, text: "Cuánto demora ?" }),
];

r = correr({
  text: "Cuánto demora ?",
  mensajes: hiloInsistencia,
  resolved: {
    shipment: null,
    orderId: "MON4712",
    reason: "pedido_sin_envio",
  },
});
check(
  "por defecto se calla (toggle apagado)",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);

process.env.FEATURE_REPETIR_ESTADO = "1";
r = correr({
  text: "Cuánto demora ?",
  mensajes: hiloInsistencia,
  resolved: {
    shipment: null,
    orderId: "MON4712",
    reason: "pedido_sin_envio",
  },
});
check(
  "con el toggle, repite el estado UNA vez",
  r.decision.accion === "estado",
  r.decision.accion + " / " + r.decision.motivo
);

r = correr({
  text: "Cuánto demora ?",
  mensajes: [
    ...hiloInsistencia,
    msg({ from: CLIENTE, text: "Cuánto demora?" }),
  ],
  resolved: {
    shipment: null,
    orderId: "MON4712",
    reason: "pedido_sin_envio",
  },
});
check(
  "si insiste mas de una vez, se calla igual",
  r.decision.accion === "silencio",
  r.decision.accion + " / " + r.decision.motivo
);
delete process.env.FEATURE_REPETIR_ESTADO;

console.log("\n== 14) No saludar dos veces ==");

// El caso que reporto el cliente: el bot saluda al pedir el numero y
// despues vuelve a saludar al darle el estado. Con el codigo en la mano, la
// respuesta es SOLO el estado.
r = correr({
  text: "MON4724",
  resolved: {
    shipment: null,
    orderId: "MON4724",
    reason: "pedido_sin_envio",
  },
});
check(
  "el mensaje de estado NO vuelve a saludar",
  !/gracias por comunicarte/i.test(r.decision.texto || ""),
  r.decision.texto
);
check(
  "el mensaje de estado empieza con el estado",
  /^Estado de tu pedido MON4724:/.test(r.decision.texto || ""),
  r.decision.texto
);
check(
  "ese mensaje sigue reconociendose como del bot",
  flow.esMensajeDelBot(r.decision.texto || "") === true
);
check(
  "y se puede parsear el estado",
  (flow.parseEstado(r.decision.texto || "") || {}).orderId === "MON4724"
);

r = correr({
  text: "hola, donde esta mi pedido?",
  resolved: { shipment: null, orderId: null, reason: "sin_datos" },
});
check(
  "el mensaje que PIDE el numero si saluda (una sola vez)",
  /gracias por comunicarte/i.test(r.decision.texto || ""),
  r.decision.texto
);

console.log(
  `\n${pasaron} pasaron, ${fallaron} fallaron\n`
);
process.exit(fallaron ? 1 : 0);
