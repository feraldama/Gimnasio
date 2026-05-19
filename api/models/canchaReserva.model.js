const db = require("../config/db");
const { escapeLike } = require("../utils/sql");

const CanchaReserva = {
  // Lista con datos del cliente y cancha embebidos. Usado en la tabla principal
  // y como base del reporte diario.
  getAllPaginated: (limit, offset, sortBy = "CanchaReservaFecha", sortOrder = "DESC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "CanchaReservaId",
        "CanchaReservaFecha",
        "CanchaReservaMonto",
        "CanchaReservaEstado",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "CanchaReservaFecha";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "DESC";

      const sql = `
        SELECT r.*,
          ca.CanchaNombre,
          cl.ClienteNombre, cl.ClienteApellido
        FROM cancha_reserva r
        LEFT JOIN cancha ca ON r.CanchaId = ca.CanchaId
        LEFT JOIN clientes cl ON r.ClienteId = cl.ClienteId
        ORDER BY r.${sortField} ${order}, r.CanchaReservaHoraInicio DESC
        LIMIT ? OFFSET ?
      `;
      db.query(sql, [limit, offset], (err, rows) => {
        if (err) return reject(err);
        db.query(
          "SELECT COUNT(*) as total FROM cancha_reserva",
          (err, countResult) => {
            if (err) return reject(err);
            resolve({
              reservas: rows,
              total: countResult[0].total,
            });
          }
        );
      });
    });
  },

  getByFecha: (fechaIso) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT r.*, ca.CanchaNombre, cl.ClienteNombre, cl.ClienteApellido
        FROM cancha_reserva r
        LEFT JOIN cancha ca ON r.CanchaId = ca.CanchaId
        LEFT JOIN clientes cl ON r.ClienteId = cl.ClienteId
        WHERE r.CanchaReservaFecha = ?
        ORDER BY r.CanchaReservaHoraInicio ASC
      `;
      db.query(sql, [fechaIso], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT r.*, ca.CanchaNombre, cl.ClienteNombre, cl.ClienteApellido
        FROM cancha_reserva r
        LEFT JOIN cancha ca ON r.CanchaId = ca.CanchaId
        LEFT JOIN clientes cl ON r.ClienteId = cl.ClienteId
        WHERE r.CanchaReservaId = ?
      `;
      db.query(sql, [id], (err, rows) => {
        if (err) return reject(err);
        resolve(rows.length ? rows[0] : null);
      });
    });
  },

  search: (term, limit, offset) => {
    return new Promise((resolve, reject) => {
      const searchValue = `%${escapeLike(term)}%`;
      const sql = `
        SELECT r.*, ca.CanchaNombre, cl.ClienteNombre, cl.ClienteApellido
        FROM cancha_reserva r
        LEFT JOIN cancha ca ON r.CanchaId = ca.CanchaId
        LEFT JOIN clientes cl ON r.ClienteId = cl.ClienteId
        WHERE r.CanchaReservaCliente LIKE ?
           OR cl.ClienteNombre LIKE ?
           OR cl.ClienteApellido LIKE ?
           OR ca.CanchaNombre LIKE ?
        ORDER BY r.CanchaReservaFecha DESC, r.CanchaReservaHoraInicio DESC
        LIMIT ? OFFSET ?
      `;
      db.query(
        sql,
        [searchValue, searchValue, searchValue, searchValue, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          const countSql = `
            SELECT COUNT(*) as total
            FROM cancha_reserva r
            LEFT JOIN clientes cl ON r.ClienteId = cl.ClienteId
            LEFT JOIN cancha ca ON r.CanchaId = ca.CanchaId
            WHERE r.CanchaReservaCliente LIKE ?
               OR cl.ClienteNombre LIKE ?
               OR cl.ClienteApellido LIKE ?
               OR ca.CanchaNombre LIKE ?
          `;
          db.query(
            countSql,
            [searchValue, searchValue, searchValue, searchValue],
            (err, c) => {
              if (err) return reject(err);
              resolve({
                reservas: rows,
                total: c[0]?.total || 0,
              });
            }
          );
        }
      );
    });
  },

  create: (data) => {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO cancha_reserva (
          CanchaId, ClienteId, CanchaReservaCliente,
          CanchaReservaFecha, CanchaReservaHoraInicio, CanchaReservaHoraFin,
          CanchaReservaMonto, CanchaReservaEstado, CanchaReservaObservacion, UsuarioId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        data.CanchaId ?? 0,
        data.ClienteId ?? null,
        data.CanchaReservaCliente || "",
        data.CanchaReservaFecha,
        data.CanchaReservaHoraInicio,
        data.CanchaReservaHoraFin,
        data.CanchaReservaMonto ?? 0,
        data.CanchaReservaEstado || "R",
        data.CanchaReservaObservacion || "",
        data.UsuarioId || null,
      ];
      db.query(sql, values, (err, result) => {
        if (err) return reject(err);
        CanchaReserva.getById(result.insertId).then(resolve).catch(reject);
      });
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      const cols = [
        "CanchaId",
        "ClienteId",
        "CanchaReservaCliente",
        "CanchaReservaFecha",
        "CanchaReservaHoraInicio",
        "CanchaReservaHoraFin",
        "CanchaReservaMonto",
        "CanchaReservaEstado",
        "CanchaReservaObservacion",
      ];
      cols.forEach((c) => {
        if (data[c] !== undefined) {
          fields.push(`${c} = ?`);
          values.push(data[c]);
        }
      });
      if (fields.length === 0) return resolve(null);
      values.push(id);
      db.query(
        `UPDATE cancha_reserva SET ${fields.join(", ")} WHERE CanchaReservaId = ?`,
        values,
        async (err, result) => {
          if (err) return reject(err);
          if (result.affectedRows === 0) return resolve(null);
          const r = await CanchaReserva.getById(id);
          resolve(r);
        }
      );
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM cancha_reserva WHERE CanchaReservaId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        }
      );
    });
  },

  // Agrupa ingresos PAGADOS por dia del mes para el reporte diario de Cancha.
  // El backend usa esto y completa los dias faltantes con 0.
  ingresoPorDia: (anio, mes) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT EXTRACT(DAY FROM CanchaReservaFecha)::int AS dia,
               COALESCE(SUM(CanchaReservaMonto), 0)::bigint AS ingreso,
               COUNT(*)::int AS reservas
        FROM cancha_reserva
        WHERE EXTRACT(YEAR FROM CanchaReservaFecha)::int = ?
          AND EXTRACT(MONTH FROM CanchaReservaFecha)::int = ?
          AND CanchaReservaEstado = 'P'
        GROUP BY dia
        ORDER BY dia
      `;
      db.query(sql, [anio, mes], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },
};

module.exports = CanchaReserva;
