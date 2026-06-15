const db = require("../config/db");
const { todayLocalISO, addDaysLocal } = require("../utils/dateUtils");
const { escapeLike } = require("../utils/sql");
const { calcularEstadoPorFechas } = require("../utils/suscripcionEstado");

/**
 * Recalcula el estado de VIGENCIA al vuelo a partir de las fechas, en lugar de
 * confiar en la columna `SuscripcionEstado` (que se congela al crear/editar y
 * no refleja el paso del tiempo). Preserva los estados MANUALES C (Cancelada)
 * y S (Suspendida), que no dependen de fechas. Así los listados/reportes que
 * pasan por el modelo siempre devuelven A/V/F correctos para "hoy".
 */
function conEstadoVigente(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => {
    if (!r || r.SuscripcionEstado === "C" || r.SuscripcionEstado === "S") {
      return r;
    }
    return {
      ...r,
      SuscripcionEstado: calcularEstadoPorFechas(
        r.SuscripcionFechaInicio,
        r.SuscripcionFechaFin
      ),
    };
  });
}

/**
 * Construye condiciones WHERE para filtrar suscripciones en el backend (en vez
 * de filtrar la página visible en el cliente, que daba resultados engañosos).
 *   - filters.estado: 'A' | 'V' | 'F' | 'C' | 'S' (vigencia calculada por fechas;
 *     C/S son manuales). Requiere alias `s` de suscripcion.
 *   - filters.pago: 'PAGADA' | 'PENDIENTE'. Requiere alias `p` (plan) y el join
 *     LATERAL `pg` con `pg.totalpagado`.
 * Devuelve { conds: string[], params: any[] } para intercalar en la query.
 */
function buildSuscripcionFilters(filters = {}) {
  const conds = [];
  const params = [];
  const estado = filters.estado;
  if (estado === "C" || estado === "S") {
    conds.push("s.SuscripcionEstado = ?");
    params.push(estado);
  } else if (estado === "A") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(?) BETWEEN DATE(s.SuscripcionFechaInicio) AND DATE(s.SuscripcionFechaFin)"
    );
    params.push(todayLocalISO());
  } else if (estado === "V") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(s.SuscripcionFechaFin) < DATE(?)"
    );
    params.push(todayLocalISO());
  } else if (estado === "F") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(s.SuscripcionFechaInicio) > DATE(?)"
    );
    params.push(todayLocalISO());
  }
  const pago = filters.pago;
  if (pago === "PAGADA") {
    conds.push("(COALESCE(p.PlanPrecio,0) = 0 OR pg.totalpagado >= p.PlanPrecio)");
  } else if (pago === "PENDIENTE") {
    conds.push("(COALESCE(p.PlanPrecio,0) > 0 AND pg.totalpagado < p.PlanPrecio)");
  }
  return { conds, params };
}

const Suscripcion = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
      `;
      db.query(query, (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*, 
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        WHERE s.SuscripcionId = ?
      `;
      db.query(query, [id], (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? conEstadoVigente(results)[0] : null);
      });
    });
  },

  create: (suscripcionData) => {
    return new Promise((resolve, reject) => {
      const estado =
        suscripcionData.SuscripcionEstado ||
        calcularEstadoPorFechas(
          suscripcionData.SuscripcionFechaInicio,
          suscripcionData.SuscripcionFechaFin
        );
      // Para modalidad CLASES inicializamos el cupo desde el plan asociado.
      // Para MENSUAL/OPEN queda en 0 (no se usa).
      db.query(
        "SELECT PlanModalidad, PlanCantidadClases FROM plan WHERE PlanId = ?",
        [suscripcionData.PlanId],
        (err, planRows) => {
          if (err) return reject(err);
          const modalidad = planRows[0]?.PlanModalidad || "MENSUAL";
          const cupoInicial =
            modalidad === "CLASES"
              ? Number(planRows[0]?.PlanCantidadClases || 0)
              : 0;
          const clasesRestantes =
            suscripcionData.SuscripcionClasesRestantes !== undefined
              ? Number(suscripcionData.SuscripcionClasesRestantes)
              : cupoInicial;
          const query = `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes) VALUES (?, ?, ?, ?, ?, ?)`;
          const values = [
            suscripcionData.ClienteId,
            suscripcionData.PlanId,
            suscripcionData.SuscripcionFechaInicio,
            suscripcionData.SuscripcionFechaFin,
            estado,
            clasesRestantes,
          ];
          db.query(query, values, (err2, result) => {
            if (err2) return reject(err2);
            Suscripcion.getById(result.insertId)
              .then((suscripcion) => resolve(suscripcion))
              .catch((error) => reject(error));
          });
        }
      );
    });
  },

  update: (id, suscripcionData) => {
    return new Promise((resolve, reject) => {
      // Si vino estado manual (CANCELADA/SUSPENDIDA) se respeta; si no, se recalcula.
      const estado =
        suscripcionData.SuscripcionEstado ||
        calcularEstadoPorFechas(
          suscripcionData.SuscripcionFechaInicio,
          suscripcionData.SuscripcionFechaFin
        );
      // SuscripcionClasesRestantes ahora es editable. Si llega `undefined`
      // (formularios que no lo manejan), usamos COALESCE en SQL para no
      // sobrescribir el cupo existente con NULL. Si llega un número, se
      // respeta (permite al operador corregir errores de carga).
      const clasesParam =
        suscripcionData.SuscripcionClasesRestantes === undefined
          ? null
          : Number(suscripcionData.SuscripcionClasesRestantes);
      const query = `
        UPDATE suscripcion
        SET ClienteId = ?,
            PlanId = ?,
            SuscripcionFechaInicio = ?,
            SuscripcionFechaFin = ?,
            SuscripcionEstado = ?,
            SuscripcionClasesRestantes = COALESCE(?, SuscripcionClasesRestantes)
        WHERE SuscripcionId = ?`;
      const values = [
        suscripcionData.ClienteId,
        suscripcionData.PlanId,
        suscripcionData.SuscripcionFechaInicio,
        suscripcionData.SuscripcionFechaFin,
        estado,
        clasesParam,
        id,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) return resolve(null);
        Suscripcion.getById(id)
          .then((suscripcion) => resolve(suscripcion))
          .catch((error) => reject(error));
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM suscripcion WHERE SuscripcionId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        },
      );
    });
  },

  getAllPaginated: (
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
    filters = {},
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "SuscripcionId",
        "ClienteId",
        "PlanId",
        "SuscripcionFechaInicio",
        "SuscripcionFechaFin",
        "ClienteNombre",
        "PlanNombre",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "SuscripcionId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      // Para ordenar por campos de tablas relacionadas, necesitamos usar alias
      let orderByField = sortField;
      if (sortField === "ClienteNombre") {
        orderByField = "c.ClienteNombre";
      } else if (sortField === "PlanNombre") {
        orderByField = "p.PlanNombre";
      } else {
        orderByField = `s.${sortField}`;
      }

      const { conds, params: filterParams } = buildSuscripcionFilters(filters);
      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        ${whereSql}
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;

      db.query(query, [...filterParams, limit, offset], (err, results) => {
        if (err) return reject(err);

        // El COUNT debe replicar los joins que usan los filtros (plan para
        // PlanPrecio, LATERAL pago para totalpagado) y el mismo WHERE.
        const countQuery = `
          SELECT COUNT(*) as total
          FROM suscripcion s
          LEFT JOIN plan p ON s.PlanId = p.PlanId
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
            FROM pago WHERE SuscripcionId = s.SuscripcionId
          ) pg ON true
          ${whereSql}
        `;
        db.query(countQuery, filterParams, (err, countResult) => {
          if (err) return reject(err);

          resolve({
            suscripciones: conEstadoVigente(results),
            total: countResult[0].total,
          });
        });
      });
    });
  },

  searchSuscripciones: (
    term,
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
    filters = {},
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "SuscripcionId",
        "ClienteId",
        "PlanId",
        "SuscripcionFechaInicio",
        "SuscripcionFechaFin",
        "ClienteNombre",
        "PlanNombre",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "SuscripcionId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      let orderByField = sortField;
      if (sortField === "ClienteNombre") {
        orderByField = "c.ClienteNombre";
      } else if (sortField === "PlanNombre") {
        orderByField = "p.PlanNombre";
      } else {
        orderByField = `s.${sortField}`;
      }

      const { conds, params: filterParams } = buildSuscripcionFilters(filters);
      const filterAnd = conds.length ? ` AND ${conds.join(" AND ")}` : "";

      // El operador de mostrador busca por cédula/RUC casi siempre. Agregamos
      // ClienteRUC al OR para evitar tener que ir a Clientes primero a buscar
      // por nombre + copiar el ID.
      const searchQuery = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE (
          c.ClienteNombre LIKE ?
          OR c.ClienteApellido LIKE ?
          OR c.ClienteRUC LIKE ?
          OR p.PlanNombre LIKE ?
          OR CAST(s.SuscripcionId AS CHAR) LIKE ?
        )${filterAnd}
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;
      const searchValue = `%${escapeLike(term)}%`;

      db.query(
        searchQuery,
        [
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          ...filterParams,
          limit,
          offset,
        ],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total
            FROM suscripcion s
            LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
            LEFT JOIN plan p ON s.PlanId = p.PlanId
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
              FROM pago WHERE SuscripcionId = s.SuscripcionId
            ) pg ON true
            WHERE (
              c.ClienteNombre LIKE ?
              OR c.ClienteApellido LIKE ?
              OR c.ClienteRUC LIKE ?
              OR p.PlanNombre LIKE ?
              OR CAST(s.SuscripcionId AS CHAR) LIKE ?
            )${filterAnd}
          `;
          db.query(
            countQuery,
            [
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              ...filterParams,
            ],
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                suscripciones: conEstadoVigente(results),
                total: countResult[0]?.total || 0,
              });
            },
          );
        },
      );
    });
  },

  getByClienteId: (clienteId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago,
          COALESCE(pg.totalpagado, 0) as TotalPagado
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE s.ClienteId = ?
        ORDER BY s.SuscripcionFechaInicio DESC
      `;
      db.query(query, [clienteId], (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  getProximasAVencer: (dias = 30, limit = null) => {
    return new Promise((resolve, reject) => {
      // Rango basado en fecha local del servidor (no UTC).
      const hoyISO = todayLocalISO();
      const fechaDesdeFormateada = addDaysLocal(hoyISO, -7);
      const fechaLimiteFormateada = addDaysLocal(hoyISO, dias);

      // Solo mostrar la suscripción más reciente por cliente (la de fecha fin más lejana).
      // Así, si RONY tiene Suscripcion 8 (vencida 2026-03-05) y Suscripcion 12 (activa 2026-04-08),
      // solo se considera la 12. Si la 12 no está en el rango (ej. dias=9), RONY no aparece.
      const hasLimit = limit != null && limit > 0;
      const baseSelect = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        INNER JOIN (
          -- La "vigencia más lejana" por cliente se calcula SOLO sobre
          -- suscripciones no canceladas/suspendidas. Si no, una suscripción
          -- cancelada con fecha fin lejana (o una futura cancelada) ganaba el
          -- MAX y el cliente desaparecía del aviso aunque tuviera una vigente
          -- venciendo en días.
          SELECT ClienteId, MAX(SuscripcionFechaFin) as maxfechafin
          FROM suscripcion
          WHERE SuscripcionFechaFin IS NOT NULL
            AND SuscripcionEstado NOT IN ('C', 'S')
          GROUP BY ClienteId
        ) latest ON s.ClienteId = latest.ClienteId AND s.SuscripcionFechaFin = latest.maxfechafin
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE s.SuscripcionFechaFin IS NOT NULL
          AND s.SuscripcionEstado NOT IN ('C', 'S')
          AND DATE(s.SuscripcionFechaFin) >= DATE(?)
          AND DATE(s.SuscripcionFechaFin) <= DATE(?)
        ORDER BY s.SuscripcionFechaFin ASC
      `;
      const query = hasLimit ? `${baseSelect} LIMIT ?` : baseSelect;

      const params = hasLimit
        ? [fechaDesdeFormateada, fechaLimiteFormateada, limit]
        : [fechaDesdeFormateada, fechaLimiteFormateada];

      db.query(query, params, (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },
};

module.exports = Suscripcion;
