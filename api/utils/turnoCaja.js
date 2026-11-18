// A qué turno de caja pertenece un movimiento.
//
// No hay entidad "turno": cada apertura (TipoGastoId 2 / grupo 2) y cada cierre
// (TipoGastoId 1 / grupo 2) deja una fila en `registrodiariocaja`, y el turno
// es lo que queda entre las dos, por id, para la misma caja y el mismo usuario
// (ver utils/cajaApertura.js).
//
// Excepción (migración 023): un movimiento cargado por una corrección en un
// turno ya cerrado tiene id mayor que el cierre, así que lleva `AperturaRef` =
// id de la apertura de su turno. Si tiene AperturaRef pertenece a ESE turno y
// a ningún otro. La misma regla está en client/src/utils/cierreCaja.ts.
const {
  TIPO_GASTO_APERTURA,
  TIPO_GASTO_CIERRE,
  TIPO_GASTO_GRUPO_CAJA,
} = require("./cajaApertura");

/**
 * @param {{RegistroDiarioCajaId:number, AperturaRef?:number|null}} r
 * @param {number} aperturaId
 * @param {number|null} cierreId  null/Infinity = turno abierto
 */
function perteneceAlTurno(r, aperturaId, cierreId) {
  if (r.AperturaRef != null) return Number(r.AperturaRef) === Number(aperturaId);
  const hasta = cierreId == null ? Infinity : Number(cierreId);
  const id = Number(r.RegistroDiarioCajaId);
  return id >= Number(aperturaId) && id <= hasta;
}

/**
 * Turno al que pertenece un movimiento. Corre en la conexión del caller (puede
 * estar dentro de una transacción).
 *
 * @returns {Promise<{
 *   aperturaId: number|null,
 *   cierreId: number|null,
 *   abierto: boolean,
 *   fueraDeTurno: boolean,   // no cae dentro de ningún turno
 *   cajaId: number, usuarioId: string,
 *   cierreFecha: Date|string|null,
 * }>}
 */
async function turnoDeMovimiento(conn, reg) {
  const cajaId = reg.CajaId;
  const usuarioId = reg.UsuarioId;

  let aperturaId = reg.AperturaRef != null ? Number(reg.AperturaRef) : null;
  if (aperturaId == null) {
    const [ap] = await conn.query(
      `SELECT MAX(RegistroDiarioCajaId) AS id FROM registrodiariocaja
       WHERE CajaId = ? AND UsuarioId = ? AND TipoGastoId = ? AND TipoGastoGrupoId = ?
         AND RegistroDiarioCajaId <= ?`,
      [cajaId, usuarioId, TIPO_GASTO_APERTURA, TIPO_GASTO_GRUPO_CAJA, reg.RegistroDiarioCajaId]
    );
    aperturaId = ap[0]?.id != null ? Number(ap[0].id) : null;
  }
  if (aperturaId == null) {
    return {
      aperturaId: null,
      cierreId: null,
      abierto: false,
      fueraDeTurno: true,
      cajaId,
      usuarioId,
      cierreFecha: null,
    };
  }

  const cierre = await cierreDeApertura(conn, aperturaId, cajaId, usuarioId);
  const cierreId = cierre ? cierre.RegistroDiarioCajaId : null;
  // Movimiento posterior al cierre sin AperturaRef: se cargó con la caja ya
  // cerrada y no es de ningún turno.
  const fueraDeTurno =
    reg.AperturaRef == null &&
    cierreId != null &&
    Number(reg.RegistroDiarioCajaId) > cierreId;

  return {
    aperturaId,
    cierreId,
    abierto: cierreId == null,
    fueraDeTurno,
    cajaId,
    usuarioId,
    cierreFecha: cierre ? cierre.RegistroDiarioCajaFecha : null,
  };
}

/** Primer cierre posterior a la apertura, misma caja y usuario (o null). */
async function cierreDeApertura(conn, aperturaId, cajaId, usuarioId) {
  const [rows] = await conn.query(
    `SELECT RegistroDiarioCajaId, RegistroDiarioCajaFecha, RegistroDiarioCajaMonto
     FROM registrodiariocaja
     WHERE CajaId = ? AND UsuarioId = ? AND TipoGastoId = ? AND TipoGastoGrupoId = ?
       AND RegistroDiarioCajaId > ?
     ORDER BY RegistroDiarioCajaId ASC LIMIT 1`,
    [cajaId, usuarioId, TIPO_GASTO_CIERRE, TIPO_GASTO_GRUPO_CAJA, aperturaId]
  );
  return rows[0] || null;
}

/** Fila de apertura por id (o null si el id no es una apertura). */
async function getApertura(conn, aperturaId) {
  const [rows] = await conn.query(
    `SELECT r.*, c.CajaDescripcion, c.LocalId, u.UsuarioNombre
     FROM registrodiariocaja r
     LEFT JOIN caja c ON c.CajaId = r.CajaId
     LEFT JOIN usuario u ON u.UsuarioId = r.UsuarioId
     WHERE r.RegistroDiarioCajaId = ? AND r.TipoGastoId = ? AND r.TipoGastoGrupoId = ?`,
    [aperturaId, TIPO_GASTO_APERTURA, TIPO_GASTO_GRUPO_CAJA]
  );
  return rows[0] || null;
}

/** Turno completo a partir de su apertura. */
async function turnoDeApertura(conn, aperturaId) {
  const apertura = await getApertura(conn, aperturaId);
  if (!apertura) return null;
  const cierre = await cierreDeApertura(
    conn,
    apertura.RegistroDiarioCajaId,
    apertura.CajaId,
    apertura.UsuarioId
  );
  return {
    aperturaId: apertura.RegistroDiarioCajaId,
    cierreId: cierre ? cierre.RegistroDiarioCajaId : null,
    abierto: !cierre,
    fueraDeTurno: false,
    cajaId: apertura.CajaId,
    usuarioId: apertura.UsuarioId,
    cierreFecha: cierre ? cierre.RegistroDiarioCajaFecha : null,
    apertura,
    cierre,
  };
}

// Tope de id para "turno abierto" en un BETWEEN: la columna es integer.
const ID_MAX = 2147483647;

/**
 * Movimientos actuales de un turno (incluye su apertura y su cierre), con la
 * descripción y el local de la caja.
 * @param {{aperturaId:number, cierreId:number|null, cajaId:number, usuarioId:string}} turno
 */
async function registrosDelTurno(conn, turno) {
  const [candidatos] = await conn.query(
    `SELECT r.*, c.CajaDescripcion, c.LocalId
     FROM registrodiariocaja r
     LEFT JOIN caja c ON c.CajaId = r.CajaId
     WHERE r.CajaId = ? AND r.UsuarioId = ?
       AND (r.AperturaRef = ? OR (r.AperturaRef IS NULL AND r.RegistroDiarioCajaId >= ?
            AND r.RegistroDiarioCajaId <= ?))
     ORDER BY r.RegistroDiarioCajaId ASC`,
    [
      turno.cajaId,
      turno.usuarioId,
      turno.aperturaId,
      turno.aperturaId,
      turno.cierreId ?? ID_MAX,
    ]
  );
  return candidatos.filter((r) =>
    perteneceAlTurno(r, turno.aperturaId, turno.cierreId)
  );
}

/**
 * Expresión SQL (DATE) con el inicio real de un rango de movimientos para
 * armar los cierres de [desde, hasta]: el menor entre `desde` y el día de la
 * apertura de cada turno que cerró en el rango. Sin esto, un turno que quedó
 * abierto varios días aparece sin apertura y los reportes lo descartan.
 * Parámetros, en orden: desde, desde, hasta (fechas 'YYYY-MM-DD').
 */
const SQL_DESDE_CON_APERTURAS = `LEAST(DATE(?), COALESCE((
    SELECT MIN(DATE(a.RegistroDiarioCajaFecha))
    FROM registrodiariocaja c
    JOIN LATERAL (
      SELECT MAX(a2.RegistroDiarioCajaId) AS ap_id FROM registrodiariocaja a2
      WHERE a2.CajaId = c.CajaId AND a2.UsuarioId = c.UsuarioId
        AND a2.TipoGastoId = 2 AND a2.TipoGastoGrupoId = 2
        AND a2.RegistroDiarioCajaId < c.RegistroDiarioCajaId
    ) ap ON TRUE
    JOIN registrodiariocaja a ON a.RegistroDiarioCajaId = ap.ap_id
    WHERE c.TipoGastoId = 1 AND c.TipoGastoGrupoId = 2
      AND DATE(c.RegistroDiarioCajaFecha) BETWEEN DATE(?) AND DATE(?)
  ), DATE(?)))`;

module.exports = {
  SQL_DESDE_CON_APERTURAS,
  perteneceAlTurno,
  registrosDelTurno,
  turnoDeMovimiento,
  turnoDeApertura,
  cierreDeApertura,
  getApertura,
};
