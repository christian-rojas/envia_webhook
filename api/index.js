/**
 * Punto de entrada de la funcion serverless.
 *
 * Vercel solo aplica `maxDuration` a las funciones que viven dentro del
 * directorio `api/` y se configuran en `vercel.json` -> `functions`. La app
 * real (rutas, webhooks, middlewares) sigue en `index.js` en la raiz.
 */
const app = require("../index.js");

module.exports = app;
