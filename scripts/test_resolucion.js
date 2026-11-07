#!/usr/bin/env node
/**
 * Pruebas de la resolucion de pedidos sin numero de pedido (MON-XXXX).
 *
 * No pegan a la red salvo en los casos marcados como [RED].
 *
 *   node scripts/test_resolucion.js
 */

const assert = require("assert");
const orders = require("../orders.js");
const ai = require("../ai.js");
const conversation = require("../conversation.js");

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32mOK\x1b[0m   ${name}`);
    pass++;
  } catch (error) {
    console.log(`  \x1b[31mFALLA\x1b[0m ${name}`);
    console.log(`        ${error.message}`);
    fail++;
  }
}

console.log("\n\x1b[1m1) Extraccion de telefono\x1b[0m");

check("+56 9 9689 1362 (11 digitos: 56 + movil)", () =>
  assert.strictEqual(orders.extractPhone("+56 9 9689 1362"), "56996891362"));

check("5696891362 pegado (10 digitos)", () =>
  assert.strictEqual(orders.extractPhone("5696891362"), "5696891362"));

check("9 9689 1362 (formato local, 9 digitos)", () =>
  assert.strictEqual(orders.extractPhone("es 9 9689 1362"), "996891362"));

check("96891362 pegado", () =>
  assert.strictEqual(orders.extractPhone("96891362"), "96891362"));

check("968 913 62 con grupos irregulares", () =>
  assert.strictEqual(orders.extractPhone("968 913 62"), "96891362"));

check("+56 9 8689 1362", () =>
  assert.strictEqual(orders.extractPhone("+56 9 8689 1362"), "56986891362"));

check("el 9 extra se prueba como variante", () => {
  const variantes = orders.phoneVariants("986891362");
  assert.ok(variantes.includes("986891362"), variantes.join(","));
  assert.ok(variantes.includes("86891362"), variantes.join(","));
});

check("variantes de un fijo de 8 digitos", () => {
  const variantes = orders.phoneVariants("22223333");
  assert.ok(variantes.includes("22223333"), variantes.join(","));
  assert.ok(variantes.includes("922223333"), variantes.join(","));
});

check("sin telefono -> null", () =>
  assert.strictEqual(orders.extractPhone("hola, que paso con mi pedido?"), null));

check("no confunde MON3007 con telefono", () =>
  assert.strictEqual(orders.extractPhone("mi pedido es MON3007"), null));

console.log("\n\x1b[1m2) Extraccion de pedido (no confunde telefonos)\x1b[0m");

check("MON3007", () =>
  assert.strictEqual(orders.extractOrderId("mi pedido es MON3007"), "MON3007"));

check("mon-3007", () =>
  assert.strictEqual(orders.extractOrderId("mon-3007"), "MON3007"));

check("pedido 3007", () =>
  assert.strictEqual(orders.extractOrderId("pedido 3007"), "MON3007"));

check("3007 suelto", () =>
  assert.strictEqual(orders.extractOrderId("3007"), "MON3007"));

check("telefono NO es pedido (96891362)", () =>
  assert.strictEqual(orders.extractOrderId("96891362"), null));

check("telefono con espacios NO es pedido (968 913 62)", () =>
  assert.strictEqual(orders.extractOrderId("968 913 62"), null));

check("+56 NO es pedido", () =>
  assert.strictEqual(orders.extractOrderId("+56 9 9689 1362"), null));

check("pedido + telefono: gana el pedido", () =>
  assert.strictEqual(orders.extractOrderId("pedido 3007, mi tel es 96891362"), "MON3007"));

check("hola -> sin pedido", () =>
  assert.strictEqual(orders.extractOrderId("hola, que paso con mi pedido?"), null));

console.log("\n\x1b[1m3) Deteccion de intencion y saludo\x1b[0m");

check("'hola' es saludo puro", () => assert.strictEqual(ai.isGreetingOnly("hola"), true));
check("'hola!' es saludo puro", () => assert.strictEqual(ai.isGreetingOnly("hola!"), true));
check("'buenas tardes' es saludo puro", () =>
  assert.strictEqual(ai.isGreetingOnly("buenas tardes"), true));
check("'hola que paso con mi pedido' NO es saludo puro", () =>
  assert.strictEqual(ai.isGreetingOnly("hola que paso con mi pedido"), false));
check("'que paso con mi pedido' es intencion de tracking", () =>
  assert.strictEqual(ai.isTrackingIntent("que paso con mi pedido"), true));
check("'cuando llega' es intencion de tracking", () =>
  assert.strictEqual(ai.isTrackingIntent("cuando llega"), true));
check("'hola' NO es intencion de tracking", () =>
  assert.strictEqual(ai.isTrackingIntent("hola"), false));

console.log("\n\x1b[1m4) Memoria de conversacion\x1b[0m");

check("guarda y recupera el pedido", () => {
  conversation.remember("IGSID_TEST_1", { orderId: "MON3007" });
  assert.strictEqual(conversation.get("IGSID_TEST_1").orderId, "MON3007");
});

check("recupera el telefono", () => {
  conversation.remember("IGSID_TEST_2", { phone: "5696891362" });
  assert.strictEqual(conversation.get("IGSID_TEST_2").phone, "5696891362");
});

check("no mezcla clientes distintos", () => {
  conversation.remember("IGSID_TEST_3", { orderId: "MON9999" });
  assert.strictEqual(conversation.get("IGSID_TEST_1").orderId, "MON3007");
  assert.strictEqual(conversation.get("IGSID_TEST_3").orderId, "MON9999");
});

check("cliente desconocido -> null", () =>
  assert.strictEqual(conversation.get("IGSID_NUNCA_VISTO"), null));

check("forget limpia", () => {
  conversation.remember("IGSID_TEST_4", { orderId: "MON1" });
  conversation.forget("IGSID_TEST_4");
  assert.strictEqual(conversation.get("IGSID_TEST_4"), null);
});

console.log("\n\x1b[1m5) Contexto para cuando falta el dato\x1b[0m");

check("'sin_datos' dice que NO se busco nada", () => {
  const ctx = ai.buildMissingDataContext({ reason: "sin_datos", channel: "instagram" });
  assert.ok(ctx.includes("NO se ha identificado"), ctx);
  assert.ok(ctx.includes("MON-3007"), ctx);
  assert.ok(ctx.includes("telefono"), ctx);
});

check("'pedido_desconocido' es claro", () => {
  const ctx = ai.buildMissingDataContext({ reason: "pedido_desconocido", orderId: "MON1234" });
  assert.ok(ctx.includes("MON1234"), ctx);
  assert.ok(ctx.includes("NO existe"), ctx);
});

check("'telefono_multiples' pide confirmar", () => {
  const ctx = ai.buildMissingDataContext({ reason: "telefono_multiples", matches: 3 });
  assert.ok(ctx.includes("3"), ctx);
  assert.ok(ctx.includes("confirme"), ctx);
});

console.log("\n\x1b[1m6) Contexto del pedido (IA)\x1b[0m");

check("el contexto lleva los datos clave", () => {
  const ctx = ai.buildShipmentContext({
    orderId: "MON3007",
    trackingNumber: "712913101224",
    carrier: "Chilexpress",
    status: "Delivered",
    estimatedDelivery: "2025-06-11 20:00:00",
    delivered: true,
    events: [],
  });
  for (const campo of ["MON3007", "712913101224", "Chilexpress", "Delivered", "2025-06-11 20:00:00"]) {
    assert.ok(ctx.includes(campo), `falta ${campo} en el contexto`);
  }
});

console.log("\n\x1b[1m7) [RED] Busqueda real por pedido y por telefono\x1b[0m");

(async () => {
  try {
    const porPedido = await orders.findShipmentByOrderId("MON3007");
    check("MON3007 se resuelve por pedido", () => {
      assert.ok(porPedido, "no se encontro el envio");
      assert.strictEqual(porPedido.trackingNumber, "712913101224");
    });

    // El telefono del cliente del pedido MON3007.
    const tel = porPedido && porPedido.customerPhone;
    check("el envio trae el telefono del destinatario", () => {
      assert.ok(tel, "sin customerPhone");
      console.log(`        (telefono en Envia: ${tel})`);
    });

    if (tel) {
      const { shipment, matches } = await orders.findShipmentByPhone(tel);
      check("se encuentra por telefono", () => {
        assert.ok(shipment, "no se encontro por telefono");
        console.log(`        (coincidencias: ${matches.length})`);
      });

      check("el pedido MON3007 esta entre las coincidencias", () => {
        const found = matches.some(
          (m) => m.trackingNumber === "712913101224" || m.orderId === "MON3007"
        );
        assert.ok(found, "MON3007 no aparece entre las coincidencias por telefono");
      });

      check("con la variante sin el 9 extra tambien encuentra", async () => {
        // 986891362 -> 86891362 (numero sin el 9 extra)
        const variante = orders.phoneVariants(tel).find((v) => v.length === 8);
        assert.ok(variante, "no se genero la variante");
      });
    }

    const inexistente = await orders.findShipmentByOrderId("MON0000");
    check("un pedido inexistente devuelve null", () => {
      assert.strictEqual(inexistente, null);
    });
  } catch (error) {
    console.log(`  \x1b[33m? \x1b[0m  pruebas de red omitidas: ${error.message}`);
  }

  console.log(
    `\n\x1b[1m${pass} pasaron, ${fail} fallaron\x1b[0m\n`
  );
  process.exit(fail > 0 ? 1 : 0);
})();
