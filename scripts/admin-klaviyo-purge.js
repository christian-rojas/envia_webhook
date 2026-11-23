/**
 * Acota la lista de perfiles de Klaviyo al limite del plan gratis (250
 * perfiles activos).
 *
 *   node scripts/admin-klaviyo-purge.js            -> dry-run (solo informe)
 *   node scripts/admin-klaviyo-purge.js --aplicar   -> suprime los sobrantes
 *
 * POR QUE SUPRIMIR Y NO BORRAR:
 * la API de Klaviyo no tiene DELETE /api/profiles/{id}/ (da 405). Ademas, la
 * documentacion dice que "suppressed email profiles do not count toward your
 * email plan's active profile limit", o sea que suprimir ES la forma de que
 * dejen de contar. Y es reversible (Klaviyo tiene bulk_unsuppress_profiles).
 *
 * REGLA (la que se pidio): se conservan los 250 perfiles mas recientes
 * (created descendente) y se suprime el resto, empezando por el mas antiguo.
 * El invariante que importa: despues de purgar, todos los que quedan fuera
 * de los 250 mas recientes estan suprimidos, asi que los activos siempre
 * caben en el limite.
 *
 * MODOS:
 *   --modo suprimir  (default) deja de contar para el limite y es reversible
 *   --modo borrar    manda el job de privacidad de datos (irreversible)
 *
 * EXTRAS:
 *   --limite N        cambia el tope (default 250)
 *   --orden updated   ordena por la ultima vez que cambio el perfil
 *   --proteger-con-pedidos  nunca suprime un perfil que tenga pedidos
 *   --segmento ID     suprime TODOS los miembros de un segmento con un solo
 *                     job (la via oficial masiva: el segmento se define en el
 *                     panel de Klaviyo y aca se dispara)
 */
require("dotenv").config();

const klaviyo = require("../klaviyo.js");

const arg = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : null;
};
const flag = (nombre) => process.argv.includes(nombre);

(async () => {
  if (!klaviyo.activo()) {
    console.log("  ERROR: falta KLAVIYO_PRIVATE_KEY en el .env");
    return;
  }
  const segmento = arg("--segmento");
  if (segmento) {
    console.log("  suprimiendo todos los miembros del segmento " + segmento + "...");
    const r = await klaviyo.suprimirSegmento(segmento, arg("--tipo-segmento") || "segment");
    console.log("  job -> " + r.status + " " + JSON.stringify(r.j).slice(0, 240));
    return;
  }
  const opciones = {
    limite: arg("--limite") ? Number(arg("--limite")) : undefined,
    orden: arg("--orden") || undefined,
    protegerConPedidos: flag("--proteger-con-pedidos"),
    modo: arg("--modo") || "suprimir",
    aplicar: flag("--aplicar"),
  };
  console.log("  opciones: " + JSON.stringify(opciones));
  const informe = await klaviyo.purgar(opciones);
  console.log("\n  === informe ===");
  console.log("  " + JSON.stringify({
    total: informe.total,
    limite: informe.limite,
    sobreElLimite: informe.sobreElLimite,
    aSuprimir: informe.aSuprimir.length,
    spam: informe.spam,
    clientes: informe.clientes,
    quedan: informe.quedan,
    error: informe.error,
  }, null, 1));
})();
