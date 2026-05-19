const db = require("../config/db");
const { todayLocalISO, addDaysLocal } = require("../utils/dateUtils");
const { escapeLike } = require("../utils/sql");
const { calcularEstadoPorFechas } = require("../utils/suscripcionEstado");

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
        LEFT JOIN (
          SELECT SuscripcionId, SUM(PagoMonto) as totalpagado
          FROM pago GROUP BY SuscripcionId
        ) pg ON pg.SuscripcionId = s.SuscripcionId
      `;
      db.query(query, (err, results) => {
        if (err) reject(err);
        resolve(results);
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
        resolve(results.length > 0 ? results[0] : null);
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
      const query = `UPDATE suscripcion SET ClienteId = ?, PlanId = ?, SuscripcionFechaInicio = ?, SuscripcionFechaFin = ?, SuscripcionEstado = ? WHERE SuscripcionId = ?`;
      const values = [
        suscripcionData.ClienteId,
        suscripcionData.PlanId,
        suscripcionData.SuscripcionFechaInicio,
        suscripcionData.SuscripcionFechaFin,
        estado,
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
        LEFT JOIN (
          SELECT SuscripcionId, SUM(PagoMonto) as totalpagado
          FROM pago GROUP BY SuscripcionId
        ) pg ON pg.SuscripcionId = s.SuscripcionId
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;

      db.query(query, [limit, offset], (err, results) => {
        if (err) return reject(err);

        db.query(
          "SELECT COUNT(*) as total FROM suscripcion",
          (err, countResult) => {
            if (err) return reject(err);

            resolve({
              suscripciones: results,
              total: countResult[0].total,
            });
          },
        );
      });
    });
  },

  searchSuscripciones: (
    term,
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
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
        LEFT JOIN (
          SELECT SuscripcionId, SUM(PagoMonto) as totalpagado
          FROM pago GROUP BY SuscripcionId
        ) pg ON pg.SuscripcionId = s.SuscripcionId
        WHERE c.ClienteNombre LIKE ?
        OR c.ClienteApellido LIKE ?
        OR p.PlanNombre LIKE ?
        OR CAST(s.SuscripcionId AS CHAR) LIKE ?
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;
      const searchValue = `%${escapeLike(term)}%`;

      db.query(
        searchQuery,
        [searchValue, searchValue, searchValue, searchValue, limit, offset],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total 
            FROM suscripcion s
            LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
            LEFT JOIN plan p ON s.PlanId = p.PlanId
            WHERE c.ClienteNombre LIKE ?
            OR c.ClienteApellido LIKE ?
            OR p.PlanNombre LIKE ?
            OR CAST(s.SuscripcionId AS CHAR) LIKE ?
          `;
          db.query(
            countQuery,
            [searchValue, searchValue, searchValue, searchValue],
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                suscripciones: results,
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
        LEFT JOIN (
          SELECT SuscripcionId, SUM(PagoMonto) as totalpagado
          FROM pago GROUP BY SuscripcionId
        ) pg ON pg.SuscripcionId = s.SuscripcionId
        WHERE s.ClienteId = ?
        ORDER BY s.SuscripcionFechaInicio DESC
      `;
      db.query(query, [clienteId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
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
          SELECT ClienteId, MAX(SuscripcionFechaFin) as maxfechafin
          FROM suscripcion
          WHERE SuscripcionFechaFin IS NOT NULL
          GROUP BY ClienteId
        ) latest ON s.ClienteId = latest.ClienteId AND s.SuscripcionFechaFin = latest.maxfechafin
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN (
          SELECT SuscripcionId, SUM(PagoMonto) as totalpagado
          FROM pago GROUP BY SuscripcionId
        ) pg ON pg.SuscripcionId = s.SuscripcionId
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
        resolve(results);
      });
    });
  },
};

module.exports = Suscripcion;
