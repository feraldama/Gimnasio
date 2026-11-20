// Día de trabajo ("día operativo") para los reportes.
//
// Hay noches que abren a las 15:00 y cierran a las 02:00 del día siguiente.
// Lo registrado antes de la hora de corte (DIA_OPERATIVO_HORA_CORTE) cuenta
// para el día anterior, así una noche no queda partida en dos días.
//
// Sólo aplica a columnas TIMESTAMP (venta, compra, registrodiariocaja). Las
// columnas DATE (pago.PagoFecha, ventacreditopago) no tienen hora y siguen
// por día calendario.
//
// La misma regla, del lado del cliente, está en client/src/utils/cierreCaja.ts
// (diaOperativoStr).
const Configuracion = require("../models/configuracion.model");

const CLAVE_HORA_CORTE = "DIA_OPERATIVO_HORA_CORTE";
const HORA_CORTE_DEFAULT = 5;
const HORA_CORTE_MAX = 12;

/** Normaliza a un entero 0..12; cualquier otra cosa vuelve al default. */
function normalizarHoraCorte(valor) {
  // Vacío no es 0: Number("") y Number(null) dan 0 y apagarían el corte.
  if (valor == null || String(valor).trim() === "") return HORA_CORTE_DEFAULT;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > HORA_CORTE_MAX) {
    return HORA_CORTE_DEFAULT;
  }
  return n;
}

/** Hora de corte vigente. Se lee en cada request para que un cambio en
 *  Configuración impacte sin reiniciar. */
async function obtenerHoraCorte() {
  const row = await Configuracion.getByClave(CLAVE_HORA_CORTE);
  return normalizarHoraCorte(row ? row.ConfigValor : null);
}

/**
 * Expresión SQL con el día de trabajo de una columna TIMESTAMP.
 * `horaCorte` se interpola (no va como parámetro) porque es parte de un
 * INTERVAL; por eso se normaliza a entero acá.
 *
 * @param {string} columna  ej. "v.VentaFecha"
 * @param {number} horaCorte
 */
function sqlDiaOperativo(columna, horaCorte) {
  const h = normalizarHoraCorte(horaCorte);
  if (h === 0) return `DATE(${columna})`;
  // 00:00:00 exacto = "sin hora": hay movimientos que se guardan sólo con la
  // fecha (compras; cobros de suscripción anteriores al fix en
  // pago.controller). Correrlos al día anterior los sacaría de su día, así
  // que quedan en su fecha. Un movimiento real a las 00:00:00.000000 es
  // prácticamente imposible (NOW() tiene microsegundos).
  return `(CASE WHEN ${columna}::time = '00:00:00'
               THEN DATE(${columna})
               ELSE DATE(${columna} - INTERVAL '${h} hours') END)`;
}

/**
 * Día de trabajo de un pago de suscripción. `pago.PagoFecha` es DATE (sin
 * hora), así que la hora se toma del movimiento de caja del cobro, vinculado
 * por `registrodiariocaja.PagoId` (migración 023). Si el pago no tiene
 * movimiento (cobros anteriores a ese vínculo) queda su PagoFecha.
 * Con corte 0 es PagoFecha, como antes.
 *
 * @param {string} alias  alias de la tabla pago en la consulta, ej. "p"
 * @param {number} horaCorte
 */
function sqlDiaOperativoPago(alias, horaCorte) {
  const h = normalizarHoraCorte(horaCorte);
  if (h === 0) return `${alias}.PagoFecha`;
  return `COALESCE((
    SELECT ${sqlDiaOperativo("rdp.RegistroDiarioCajaFecha", h)}
      FROM registrodiariocaja rdp
     WHERE rdp.PagoId = ${alias}.PagoId AND rdp.TipoGastoId = 2
     ORDER BY rdp.RegistroDiarioCajaId
     LIMIT 1
  ), ${alias}.PagoFecha)`;
}

/**
 * Valida el valor que se quiere guardar en Configuración. Devuelve un mensaje
 * de error, o null si es válido. A diferencia de normalizarHoraCorte (que al
 * leer cae al default en silencio), al guardar se rechaza.
 */
function validarHoraCorte(valor) {
  const texto = String(valor ?? "").trim();
  if (!/^\d{1,2}$/.test(texto) || Number(texto) > HORA_CORTE_MAX) {
    return `La hora de corte debe ser un número entero entre 0 y ${HORA_CORTE_MAX} (0 = día calendario).`;
  }
  return null;
}

module.exports = {
  CLAVE_HORA_CORTE,
  HORA_CORTE_DEFAULT,
  HORA_CORTE_MAX,
  normalizarHoraCorte,
  obtenerHoraCorte,
  sqlDiaOperativo,
  sqlDiaOperativoPago,
  validarHoraCorte,
};
