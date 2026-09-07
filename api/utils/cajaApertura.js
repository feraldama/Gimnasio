// Regla que decide si una apertura o un cierre de caja está permitido.
//
// Estaba escrita dentro de `aperturaCierreCaja` en el controlador, mezclada
// con las consultas y las escrituras, así que no había forma de probarla. La
// lógica es la misma, sólo movida acá.
//
// Cómo se detecta el estado de la caja: no hay una columna "abierta/cerrada".
// Cada apertura y cada cierre deja una fila en `registrodiariocaja`
// (TipoGastoId 2 = apertura, 1 = cierre, ambas con TipoGastoGrupoId 2), y el
// estado se deduce comparando los ids de la última apertura y el último
// cierre. Si el id del cierre es mayor, la caja está cerrada.
//
// Se usan ids y no fechas porque `RegistroDiarioCajaFecha` puede repetirse al
// segundo y el id es estrictamente creciente.

// TipoGastoId con el que se marcan las filas de apertura y cierre.
const TIPO_GASTO_CIERRE = 1;
const TIPO_GASTO_APERTURA = 2;
const TIPO_GASTO_GRUPO_CAJA = 2;

/**
 * @param {object} p
 * @param {boolean} p.esApertura  true = se quiere abrir; false = cerrar.
 * @param {number} p.aperturaId   id de la última apertura (0 si nunca hubo).
 * @param {number} p.cierreId     id del último cierre (0 si nunca hubo).
 * @returns {{permitido: boolean, error: string}}
 */
function evaluarAperturaCierre({ esApertura, aperturaId, cierreId }) {
  const ultimaApertura = Number(aperturaId) || 0;
  const ultimoCierre = Number(cierreId) || 0;

  if (esApertura) {
    // Se puede abrir si nunca se abrió, o si el último movimiento fue un cierre.
    if (ultimaApertura === 0 || ultimoCierre > ultimaApertura) {
      return { permitido: true, error: "" };
    }
    return {
      permitido: false,
      error: "CAJA ABIERTA - DEBE REALIZAR EL CIERRE",
    };
  }

  // Se puede cerrar sólo si hay una apertura posterior al último cierre.
  if (ultimoCierre < ultimaApertura) {
    return { permitido: true, error: "" };
  }
  return {
    permitido: false,
    error: "CAJA CERRADA - DEBE REALIZAR LA APERTURA",
  };
}

/**
 * Interpreta el flag `apertura` del body. Ojo con la convención heredada:
 * `apertura === 0` significa APERTURA y cualquier otro valor significa CIERRE.
 * El nombre invita a leerlo al revés, así que queda encapsulado acá.
 */
function esSolicitudDeApertura(apertura) {
  return Number(apertura) === 0;
}

module.exports = {
  evaluarAperturaCierre,
  esSolicitudDeApertura,
  TIPO_GASTO_APERTURA,
  TIPO_GASTO_CIERRE,
  TIPO_GASTO_GRUPO_CAJA,
};
