const db = require("../config/db");
const { normalizeRegistroFecha } = require("../utils/registroFecha");
const {
  TIPO_GASTO_APERTURA,
  TIPO_GASTO_CIERRE,
  TIPO_GASTO_GRUPO_CAJA,
} = require("../utils/cajaApertura");
const {
  SQL_DESDE_CON_APERTURAS,
  registrosDelTurno,
} = require("../utils/turnoCaja");
const { esperadoDelTurno } = require("../utils/ticketCierre");

/**
 * Guarda en la fila del cierre el efectivo esperado y la diferencia de ese
 * momento (migración 026). La reimpresión del ticket los usa para mostrar el
 * sobrante/faltante "Al cerrar" aunque después se corrija el turno. Misma
 * regla que el ticket del cajero (client/src/utils/cajaOrigen.ts).
 */
async function guardarEsperadoCierre(conn, { cierreId, cajaId, usuarioId, declarado }) {
  const [ap] = await conn.query(
    `SELECT RegistroDiarioCajaId, RegistroDiarioCajaMonto FROM registrodiariocaja
     WHERE CajaId = ? AND UsuarioId = ? AND TipoGastoId = ? AND TipoGastoGrupoId = ?
       AND RegistroDiarioCajaId < ?
     ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
    [cajaId, usuarioId, TIPO_GASTO_APERTURA, TIPO_GASTO_GRUPO_CAJA, cierreId]
  );
  if (!ap.length) return;
  const registros = await registrosDelTurno(conn, {
    aperturaId: ap[0].RegistroDiarioCajaId,
    cierreId,
    cajaId,
    usuarioId,
  });
  const esperado = esperadoDelTurno(registros, ap[0].RegistroDiarioCajaMonto);
  await conn.query(
    `UPDATE registrodiariocaja SET EsperadoCierre = ?, DiferenciaCierre = ?
     WHERE RegistroDiarioCajaId = ?`,
    [esperado, esperado - (Number(declarado) || 0), cierreId]
  );
}

/**
 * Normaliza RegistroDiarioCajaFecha para que siempre incluya fecha y hora.
 * - Si no se proporciona valor: usa fecha/hora actual
 * - Si es solo fecha (YYYY-MM-DD): usa esa fecha con la hora actual del momento del registro
 * - Si es datetime completo: lo usa tal cual
 */
/**
 * Construye la cláusula WHERE para filtros de registros diarios de caja.
 * - cajaId (FK Caja)
 * - tipoGastoId (FK TipoGasto)
 * - rango de fechas sobre RegistroDiarioCajaFecha
 * - rango de monto sobre RegistroDiarioCajaMonto
 */
function buildRegistroFiltersWhere(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.cajaId != null && filters.cajaId !== "") {
    conditions.push("r.CajaId = ?");
    params.push(Number(filters.cajaId));
  }
  if (filters.tipoGastoId != null && filters.tipoGastoId !== "") {
    conditions.push("r.TipoGastoId = ?");
    params.push(Number(filters.tipoGastoId));
  }
  if (filters.fechaDesde) {
    conditions.push("DATE(r.RegistroDiarioCajaFecha) >= ?");
    params.push(filters.fechaDesde);
  }
  if (filters.fechaHasta) {
    conditions.push("DATE(r.RegistroDiarioCajaFecha) <= ?");
    params.push(filters.fechaHasta);
  }
  if (filters.montoMin != null && filters.montoMin !== "") {
    conditions.push("r.RegistroDiarioCajaMonto >= ?");
    params.push(Number(filters.montoMin));
  }
  if (filters.montoMax != null && filters.montoMax !== "") {
    conditions.push("r.RegistroDiarioCajaMonto <= ?");
    params.push(Number(filters.montoMax));
  }

  return { conditions, params };
}


const RegistroDiarioCaja = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM registrodiariocaja", (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM registrodiariocaja WHERE RegistroDiarioCajaId = ?",
        [id],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  getAllPaginated: (
    limit,
    offset,
    sortBy = "RegistroDiarioCajaId",
    sortOrder = "DESC",
    filters = {}
  ) => {
    return new Promise((resolve, reject) => {
      // Sanitiza sortOrder y sortBy para evitar SQL Injection
      const allowedSortFields = [
        "RegistroDiarioCajaId",
        "RegistroDiarioCajaFecha",
        "RegistroDiarioCajaMonto",
        "RegistroDiarioCajaDetalle",
        "TipoGastoId",
        "TipoGastoGrupoId",
        "UsuarioId",
        "CajaId",
      ];
      const allowedSortOrders = ["ASC", "DESC"];

      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "RegistroDiarioCajaFecha";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "DESC";

      const { conditions, params: filterParams } =
        buildRegistroFiltersWhere(filters);
      const whereSql = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const query = `
        SELECT r.*,
          c.CajaDescripcion,
          t.TipoGastoDescripcion,
          tg.TipoGastoGrupoDescripcion
        FROM registrodiariocaja r
        LEFT JOIN Caja c ON r.CajaId = c.CajaId
        LEFT JOIN TipoGasto t ON r.TipoGastoId = t.TipoGastoId
        LEFT JOIN tipogastogrupo tg ON r.TipoGastoId = tg.TipoGastoId AND r.TipoGastoGrupoId = tg.TipoGastoGrupoId
        ${whereSql}
        ORDER BY r.${sortField} ${order}
        LIMIT ? OFFSET ?
      `;

      db.query(query, [...filterParams, limit, offset], (err, results) => {
        if (err) return reject(err);

        const countQuery = `
          SELECT COUNT(*) as total FROM registrodiariocaja r
          ${whereSql}`;

        db.query(countQuery, filterParams, (err, countResult) => {
          if (err) return reject(err);

          resolve({
            data: results,
            pagination: {
              totalItems: countResult[0].total,
              totalPages: Math.ceil(countResult[0].total / limit),
              currentPage: Math.floor(offset / limit) + 1,
              itemsPerPage: limit,
            },
          });
        });
      });
    });
  },

  search: async (
    term,
    limit,
    offset,
    sortBy = "RegistroDiarioCajaFecha",
    sortOrder = "DESC",
    filters = {}
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "RegistroDiarioCajaId",
        "RegistroDiarioCajaFecha",
        "RegistroDiarioCajaMonto",
        "RegistroDiarioCajaDetalle",
        "TipoGastoId",
        "TipoGastoGrupoId",
        "UsuarioId",
        "CajaId",
      ];
      const allowedSortOrders = ["ASC", "DESC"];

      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "RegistroDiarioCajaFecha";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "DESC";

      const { conditions: filterConditions, params: filterParams } =
        buildRegistroFiltersWhere(filters);
      const filtersAndClause = filterConditions.length
        ? ` AND ${filterConditions.join(" AND ")}`
        : "";

      const searchQuery = `
        SELECT r.*,
          c.CajaDescripcion,
          t.TipoGastoDescripcion,
          tg.TipoGastoGrupoDescripcion
        FROM registrodiariocaja r
        LEFT JOIN Caja c ON r.CajaId = c.CajaId
        LEFT JOIN TipoGasto t ON r.TipoGastoId = t.TipoGastoId
        LEFT JOIN tipogastogrupo tg ON r.TipoGastoId = tg.TipoGastoId AND r.TipoGastoGrupoId = tg.TipoGastoGrupoId
        WHERE (r.RegistroDiarioCajaDetalle LIKE ?
          OR CAST(r.UsuarioId AS CHAR) LIKE ?
          OR CAST(r.CajaId AS CHAR) LIKE ?
          OR CAST(r.TipoGastoId AS CHAR) LIKE ?
          OR CAST(r.TipoGastoGrupoId AS CHAR) LIKE ?
          OR CAST(r.RegistroDiarioCajaMonto AS CHAR) LIKE ?
          OR TO_CHAR(r.RegistroDiarioCajaFecha, 'DD/MM/YYYY HH24:MI:SS') LIKE ?)${filtersAndClause}
        ORDER BY r.${sortField} ${order}
        LIMIT ? OFFSET ?
      `;
      const searchValue = `%${term}%`;
      const searchParams = [
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
      ];

      db.query(
        searchQuery,
        [...searchParams, ...filterParams, limit, offset],
        (err, results) => {
          if (err) {
            console.error("Error en la consulta de búsqueda:", err);
            return reject(err);
          }

          const countQuery = `
            SELECT COUNT(*) as total FROM registrodiariocaja r
            WHERE (r.RegistroDiarioCajaDetalle LIKE ?
              OR CAST(r.UsuarioId AS CHAR) LIKE ?
              OR CAST(r.CajaId AS CHAR) LIKE ?
              OR CAST(r.TipoGastoId AS CHAR) LIKE ?
              OR CAST(r.TipoGastoGrupoId AS CHAR) LIKE ?
              OR CAST(r.RegistroDiarioCajaMonto AS CHAR) LIKE ?
              OR TO_CHAR(r.RegistroDiarioCajaFecha, 'DD/MM/YYYY HH24:MI:SS') LIKE ?)${filtersAndClause}
          `;

          db.query(
            countQuery,
            [...searchParams, ...filterParams],
            (err, countResult) => {
              if (err) {
                console.error("Error en la consulta de conteo:", err);
                return reject(err);
              }

              const total = countResult[0]?.total || 0;

              resolve({
                data: results,
                pagination: {
                  totalItems: total,
                  totalPages: Math.ceil(total / limit),
                  currentPage: Math.floor(offset / limit) + 1,
                  itemsPerPage: limit,
                },
              });
            }
          );
        }
      );
    });
  },

  create: (registroData) => {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO registrodiariocaja (
          CajaId,
          RegistroDiarioCajaFecha,
          TipoGastoId,
          TipoGastoGrupoId,
          RegistroDiarioCajaDetalle,
          RegistroDiarioCajaMonto,
          UsuarioId
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        registroData.CajaId,
        normalizeRegistroFecha(registroData.RegistroDiarioCajaFecha),
        registroData.TipoGastoId,
        registroData.TipoGastoGrupoId,
        registroData.RegistroDiarioCajaDetalle,
        registroData.RegistroDiarioCajaMonto,
        registroData.UsuarioId,
      ];

      db.query(query, values, (err, result) => {
        if (err) return reject(err);

        // Obtener el registro recién creado
        RegistroDiarioCaja.getById(result.insertId)
          .then((registro) => resolve(registro))
          .catch((error) => reject(error));
      });
    });
  },

  // Editar y borrar movimientos: models/correccionCaja.model.js
  // (editarRegistroTx / eliminarRegistroTx), con las reglas de turno cerrado.

  /**
   * Ejecuta la apertura o el cierre de caja en UNA transacción.
   *
   * Antes esto vivía en el controlador como dos operaciones sueltas y sin
   * transacción, y el orden del cierre era peligroso: primero
   * `UPDATE Caja SET CajaMonto = 0` y después el INSERT del registro. Si el
   * INSERT fallaba, el cajón quedaba en cero SIN registro de cierre — y como
   * el estado de la caja se deduce de la existencia de ese registro (ver
   * utils/cajaApertura.js), el sistema seguía diciendo "CAJA ABIERTA" con el
   * monto ya borrado. La plata desaparecía del sistema sin rastro.
   *
   * Es el mismo arreglo que ya se le hizo a `asistencia.registrar`.
   *
   * @param {object} p
   * @param {boolean} p.esApertura
   * @param {number|string} p.cajaId
   * @param {number} p.monto
   * @param {string} p.usuarioId
   * @param {string} p.cajaDescripcion  para el detalle del registro
   */
  aperturaCierreTransaccional: async ({
    esApertura,
    cajaId,
    monto,
    usuarioId,
    cajaDescripcion,
  }) => {
    const conn = await db.promise().getConnection();
    try {
      await conn.beginTransaction();

      // Bloquea la caja hasta el commit: una corrección del turno abierto
      // (models/correccionCaja.model.js, bloquearCajas) espera a que termine
      // el cierre y recién ahí ve el turno cerrado. Sin esto podía sumar su
      // ajuste al cajón después de ponerlo en 0.
      await conn.query("SELECT CajaId FROM caja WHERE CajaId = ? FOR UPDATE", [
        cajaId,
      ]);

      // El registro va primero en las dos ramas: es el rastro contable y lo
      // que define el estado de la caja.
      const [ins] = await conn.query(
        `INSERT INTO registrodiariocaja (
           CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
           RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          cajaId,
          normalizeRegistroFecha(null),
          esApertura ? TIPO_GASTO_APERTURA : TIPO_GASTO_CIERRE,
          TIPO_GASTO_GRUPO_CAJA,
          `${esApertura ? "APERTURA" : "CIERRE"} ${cajaDescripcion || ""}`.trim(),
          monto,
          usuarioId,
        ]
      );

      if (esApertura) {
        await conn.query(
          "UPDATE Caja SET CajaMonto = CajaMonto + ? WHERE CajaId = ?",
          [monto, cajaId]
        );
      } else {
        await conn.query("UPDATE Caja SET CajaMonto = 0 WHERE CajaId = ?", [
          cajaId,
        ]);
        await guardarEsperadoCierre(conn, {
          cierreId: ins.insertId,
          cajaId,
          usuarioId,
          declarado: monto,
        });
      }

      await conn.commit();
      return { registroId: ins.insertId };
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  },

  getUltimaApertura: (cajaId) => {
    return new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM registrodiariocaja WHERE CajaId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2 ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
        [cajaId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  getUltimoCierre: (cajaId) => {
    return new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM registrodiariocaja WHERE CajaId = ? AND TipoGastoId = 1 AND TipoGastoGrupoId = 2 ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
        [cajaId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  getByDateRange: (fechaDesdeStr, fechaHastaStr, limit = 10000) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT r.*,
          c.CajaDescripcion,
          c.LocalId,
          t.TipoGastoDescripcion,
          tg.TipoGastoGrupoDescripcion
        FROM registrodiariocaja r
        LEFT JOIN Caja c ON r.CajaId = c.CajaId
        LEFT JOIN TipoGasto t ON r.TipoGastoId = t.TipoGastoId
        LEFT JOIN tipogastogrupo tg ON r.TipoGastoId = tg.TipoGastoId AND r.TipoGastoGrupoId = tg.TipoGastoGrupoId
        WHERE DATE(r.RegistroDiarioCajaFecha) >= ${SQL_DESDE_CON_APERTURAS}
          AND DATE(r.RegistroDiarioCajaFecha) <= DATE(?)
        ORDER BY r.RegistroDiarioCajaId ASC
        LIMIT ?
      `;
      // El inicio se adelanta hasta la apertura de los turnos que cierran en
      // el rango (utils/turnoCaja.js): si no, un turno abierto varios días
      // queda fuera del reporte de cierre.
      const params = [
        fechaDesdeStr,
        fechaDesdeStr,
        fechaHastaStr,
        fechaDesdeStr,
        fechaHastaStr,
        limit,
      ];
      db.query(query, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  },

  getEstadoAperturaPorUsuario: (usuarioId) => {
    return new Promise((resolve, reject) => {
      // Buscar la última apertura del usuario
      db.query(
        `SELECT RegistroDiarioCajaId, CajaId FROM registrodiariocaja WHERE UsuarioId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2 ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
        [usuarioId],
        (err, aperturas) => {
          if (err) return reject(err);
          const apertura = aperturas[0] || {
            RegistroDiarioCajaId: 0,
            CajaId: null,
          };
          // Buscar la última cierre del usuario
          db.query(
            `SELECT RegistroDiarioCajaId FROM registrodiariocaja WHERE UsuarioId = ? AND TipoGastoId = 1 AND TipoGastoGrupoId = 2 ORDER BY RegistroDiarioCajaId DESC LIMIT 1`,
            [usuarioId],
            (err, cierres) => {
              if (err) return reject(err);
              const cierre = cierres[0] || { RegistroDiarioCajaId: 0 };
              resolve({
                aperturaId: apertura.RegistroDiarioCajaId || 0,
                cierreId: cierre.RegistroDiarioCajaId || 0,
                cajaId: apertura.CajaId || null,
              });
            }
          );
        }
      );
    });
  },

  // Registros del último turno del usuario en la caja: desde su última
  // apertura en adelante (incluye el cierre si ya lo hizo). Es lo que necesita
  // el resumen de cierre, sin exponer el libro de caja de otros usuarios.
  getTurnoActualUsuario: (usuarioId, cajaId) => {
    return new Promise((resolve, reject) => {
      db.query(
        // Movimientos con AperturaRef pertenecen al turno que indican (una
        // corrección cargada en un turno cerrado), no al rango de ids: ver
        // utils/turnoCaja.js.
        `WITH ap AS (
           SELECT COALESCE(MAX(RegistroDiarioCajaId), 0) AS id FROM registrodiariocaja
           WHERE UsuarioId = ? AND CajaId = ? AND TipoGastoId = 2 AND TipoGastoGrupoId = 2
         )
         SELECT r.* FROM registrodiariocaja r, ap
         WHERE r.UsuarioId = ? AND r.CajaId = ?
           AND ((r.AperturaRef IS NULL AND r.RegistroDiarioCajaId >= ap.id)
                OR r.AperturaRef = ap.id)
         ORDER BY r.RegistroDiarioCajaId DESC`,
        [usuarioId, cajaId, usuarioId, cajaId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });
  },
};

module.exports = RegistroDiarioCaja;
