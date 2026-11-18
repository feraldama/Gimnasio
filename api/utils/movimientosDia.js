// Alcance de la consulta "Ventas y cobros del día" (movimientosDia.controller).
//
//   - Usuarios comunes: SOLO hoy y SOLO su local. No es una puerta al
//     historial: para eso están los reportes.
//   - Admin (isAdmin === 'S'): puede elegir `fecha` y `localId`.
//   - Usuario con LocalId 0 ("TODOS"): ve todos los locales o filtra por
//     `localId`, pero sigue limitado a hoy.
const { todayLocalISO } = require("./dateUtils");

const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {object} user  payload del JWT (isAdmin, LocalId)
 * @param {object} query req.query (fecha?, localId?)
 * @param {string} [hoy] fecha local de hoy (inyectable para tests)
 * @returns {{fecha: string, localId: number|null, puedeElegirFecha: boolean}
 *          | {error: string}}  localId null = todos los locales
 */
function resolverAlcance(user, query = {}, hoy = todayLocalISO()) {
  const esAdmin = user?.isAdmin === "S";
  const localUsuario = Number(user?.LocalId) || 0;

  let fecha = hoy;
  if (esAdmin && query.fecha) {
    if (!RE_FECHA_ISO.test(String(query.fecha))) {
      return { error: "Fecha inválida (formato YYYY-MM-DD)" };
    }
    fecha = String(query.fecha);
  }

  let localId = localUsuario || null;
  if ((esAdmin || localUsuario === 0) && query.localId) {
    const n = Number(query.localId);
    localId = Number.isInteger(n) && n > 0 ? n : null;
  }

  return { fecha, localId, puedeElegirFecha: esAdmin };
}

module.exports = { resolverAlcance };
