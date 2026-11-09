/**
 * Utilidades de cancelacion de peticiones HTTP.
 *
 * Se usan para que un trabajo abandonado (por ejemplo, una busqueda de pedido
 * que ya supero su tiempo maximo) NO siga consuming la funcion de Vercel:
 * sin abort real, la peticion HTTP subyacente sigue viva, mantiene el event
 * loop ocupado y la funcion no puede hibernar hasta que Vercel la mata.
 */

/**
 * Combina varias senales de aborto en una sola.
 *
 * @param {...(AbortSignal|undefined|null)} signals Senales a combinar.
 * @returns {AbortSignal|undefined} Senal combinada, o undefined si no hay ninguna.
 */
function combineSignals(...signals) {
  const list = signals.filter(Boolean);

  if (!list.length) return undefined;
  if (list.length === 1) return list[0];

  // Node 20.3+ / Vercel Node 22: combinacion nativa.
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);

  // Fallback para runtimes sin AbortSignal.any.
  const controller = new AbortController();
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

module.exports = { combineSignals };
