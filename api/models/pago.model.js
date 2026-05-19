const db = require("../config/db");
const { escapeLike } = require("../utils/sql");

const Pago = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM pago", (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*,
          c.ClienteId, c.ClienteNombre, c.ClienteApellido,
          u.UsuarioNombre, u.UsuarioApellido
        FROM pago p
        LEFT JOIN suscripcion s ON p.SuscripcionId = s.SuscripcionId
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN usuario u ON p.PagoUsuarioId = u.UsuarioId
        WHERE p.PagoId = ?
      `;
      db.query(query, [id], (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? results[0] : null);
      });
    });
  },

  create: (pagoData) => {
    return new Promise((resolve, reject) => {
      const query = `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId) VALUES (?, ?, ?, ?, ?)`;
      const values = [
        pagoData.SuscripcionId,
        pagoData.PagoMonto,
        pagoData.PagoTipo,
        pagoData.PagoFecha,
        pagoData.PagoUsuarioId,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        // Obtener el pago recién creado
        Pago.getById(result.insertId)
          .then((pago) => resolve(pago))
          .catch((error) => reject(error));
      });
    });
  },

  update: (id, pagoData) => {
    return new Promise((resolve, reject) => {
      const query = `UPDATE pago SET SuscripcionId = ?, PagoMonto = ?, PagoTipo = ?, PagoFecha = ?, PagoUsuarioId = ? WHERE PagoId = ?`;
      const values = [
        pagoData.SuscripcionId,
        pagoData.PagoMonto,
        pagoData.PagoTipo,
        pagoData.PagoFecha,
        pagoData.PagoUsuarioId,
        id,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) return resolve(null);
        Pago.getById(id)
          .then((pago) => resolve(pago))
          .catch((error) => reject(error));
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query("DELETE FROM pago WHERE PagoId = ?", [id], (err, result) => {
        if (err) return reject(err);
        resolve(result.affectedRows > 0);
      });
    });
  },

  getAllPaginated: (limit, offset, sortBy = "PagoId", sortOrder = "ASC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "PagoId",
        "SuscripcionId",
        "PagoMonto",
        "PagoTipo",
        "PagoFecha",
        "PagoUsuarioId",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : "PagoId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const query = `
        SELECT p.*,
          c.ClienteId, c.ClienteNombre, c.ClienteApellido,
          u.UsuarioNombre, u.UsuarioApellido
        FROM pago p
        LEFT JOIN suscripcion s ON p.SuscripcionId = s.SuscripcionId
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN usuario u ON p.PagoUsuarioId = u.UsuarioId
        ORDER BY ${sortField} ${order}
        LIMIT ? OFFSET ?
      `;

      db.query(query, [limit, offset], (err, results) => {
        if (err) return reject(err);

        db.query("SELECT COUNT(*) as total FROM pago", (err, countResult) => {
          if (err) return reject(err);

          resolve({
            pagos: results,
            total: countResult[0].total,
          });
        });
      });
    });
  },

  searchPagos: (term, limit, offset, sortBy = "PagoId", sortOrder = "ASC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "PagoId",
        "SuscripcionId",
        "PagoMonto",
        "PagoTipo",
        "PagoFecha",
        "PagoUsuarioId",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : "PagoId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const searchQuery = `
        SELECT p.*,
          c.ClienteId, c.ClienteNombre, c.ClienteApellido,
          u.UsuarioNombre, u.UsuarioApellido
        FROM pago p
        LEFT JOIN suscripcion s ON p.SuscripcionId = s.SuscripcionId
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN usuario u ON p.PagoUsuarioId = u.UsuarioId
        WHERE c.ClienteNombre LIKE ?
        OR c.ClienteApellido LIKE ?
        OR p.PagoTipo LIKE ?
        OR CAST(p.PagoMonto AS CHAR) LIKE ?
        OR CAST(p.PagoId AS CHAR) LIKE ?
        OR CAST(p.SuscripcionId AS CHAR) LIKE ?
        OR CONCAT(u.UsuarioNombre, ' ', u.UsuarioApellido) LIKE ?
        ORDER BY ${sortField} ${order}
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
          searchValue,
          searchValue,
          limit,
          offset,
        ],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total
            FROM pago p
            LEFT JOIN suscripcion s ON p.SuscripcionId = s.SuscripcionId
            LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
            LEFT JOIN usuario u ON p.PagoUsuarioId = u.UsuarioId
            WHERE c.ClienteNombre LIKE ?
            OR c.ClienteApellido LIKE ?
            OR p.PagoTipo LIKE ?
            OR CAST(p.PagoMonto AS CHAR) LIKE ?
            OR CAST(p.PagoId AS CHAR) LIKE ?
            OR CAST(p.SuscripcionId AS CHAR) LIKE ?
            OR CONCAT(u.UsuarioNombre, ' ', u.UsuarioApellido) LIKE ?
          `;
          db.query(
            countQuery,
            [
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              searchValue,
            ],
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                pagos: results,
                total: countResult[0]?.total || 0,
              });
            }
          );
        }
      );
    });
  },
};

Pago.getByClienteId = (clienteId) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT p.*,
        c.ClienteId, c.ClienteNombre, c.ClienteApellido,
        u.UsuarioNombre, u.UsuarioApellido,
        s.SuscripcionFechaInicio, s.SuscripcionFechaFin,
        pl.PlanNombre
      FROM pago p
      LEFT JOIN suscripcion s ON p.SuscripcionId = s.SuscripcionId
      LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
      LEFT JOIN plan pl ON s.PlanId = pl.PlanId
      LEFT JOIN usuario u ON p.PagoUsuarioId = u.UsuarioId
      WHERE s.ClienteId = ?
      ORDER BY p.PagoFecha DESC, p.PagoId DESC
    `;
    db.query(query, [clienteId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Reporte de cobranza agrupado por día/semana/mes.
// Devuelve por período: total Contado, POS, Transferencia, total general y cantidad.
Pago.getReporte = (fechaDesde, fechaHasta, agruparPor = "dia") => {
  return new Promise((resolve, reject) => {
    const agrupaciones = {
      dia: "TO_CHAR(p.PagoFecha, 'YYYY-MM-DD')",
      semana: "TO_CHAR(p.PagoFecha, 'IYYY-\"W\"IW')",
      mes: "TO_CHAR(p.PagoFecha, 'YYYY-MM')",
    };
    const groupExpr = agrupaciones[agruparPor] || agrupaciones.dia;

    const query = `
      SELECT
        ${groupExpr} AS periodo,
        COUNT(*) AS cantidad,
        SUM(CASE WHEN p.PagoTipo = 'CO' THEN p.PagoMonto ELSE 0 END) AS contado,
        SUM(CASE WHEN p.PagoTipo = 'PO' THEN p.PagoMonto ELSE 0 END) AS pos,
        SUM(CASE WHEN p.PagoTipo = 'TR' THEN p.PagoMonto ELSE 0 END) AS transferencia,
        SUM(p.PagoMonto) AS total
      FROM pago p
      WHERE DATE(p.PagoFecha) >= DATE(?) AND DATE(p.PagoFecha) <= DATE(?)
      GROUP BY ${groupExpr}
      ORDER BY periodo DESC
    `;

    db.query(query, [fechaDesde, fechaHasta], (err, results) => {
      if (err) return reject(err);
      // También devolvemos un acumulado global para mostrarlo en el header del reporte
      const totalGeneral = results.reduce(
        (acc, r) => {
          acc.contado += Number(r.contado || 0);
          acc.pos += Number(r.pos || 0);
          acc.transferencia += Number(r.transferencia || 0);
          acc.total += Number(r.total || 0);
          acc.cantidad += Number(r.cantidad || 0);
          return acc;
        },
        { contado: 0, pos: 0, transferencia: 0, total: 0, cantidad: 0 }
      );
      resolve({ filas: results, totales: totalGeneral });
    });
  });
};

module.exports = Pago;
