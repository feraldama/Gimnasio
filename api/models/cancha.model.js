const db = require("../config/db");
const { escapeLike } = require("../utils/sql");

const Cancha = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM cancha ORDER BY CanchaId",
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });
  },

  getActivas: () => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM cancha WHERE CanchaActiva = 1 ORDER BY CanchaNombre",
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM cancha WHERE CanchaId = ?",
        [id],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  getAllPaginated: (limit, offset, sortBy = "CanchaId", sortOrder = "ASC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "CanchaId",
        "CanchaNombre",
        "CanchaTarifaHora",
        "CanchaActiva",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "CanchaId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      db.query(
        `SELECT * FROM cancha ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, results) => {
          if (err) return reject(err);
          db.query(
            "SELECT COUNT(*) as total FROM cancha",
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                canchas: results,
                total: countResult[0].total,
              });
            }
          );
        }
      );
    });
  },

  search: (term, limit, offset, sortBy = "CanchaId", sortOrder = "ASC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "CanchaId",
        "CanchaNombre",
        "CanchaTarifaHora",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "CanchaId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const searchValue = `%${escapeLike(term)}%`;
      const sql = `
        SELECT * FROM cancha
        WHERE CanchaNombre LIKE ? OR CanchaId LIKE ?
        ORDER BY ${sortField} ${order}
        LIMIT ? OFFSET ?
      `;
      db.query(sql, [searchValue, searchValue, limit, offset], (err, rows) => {
        if (err) return reject(err);
        db.query(
          `SELECT COUNT(*) as total FROM cancha WHERE CanchaNombre LIKE ? OR CanchaId LIKE ?`,
          [searchValue, searchValue],
          (err, countResult) => {
            if (err) return reject(err);
            resolve({
              canchas: rows,
              total: countResult[0]?.total || 0,
            });
          }
        );
      });
    });
  },

  create: (data) => {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO cancha (CanchaNombre, CanchaTarifaHora, CanchaActiva)
        VALUES (?, ?, ?)
      `;
      const values = [
        data.CanchaNombre || "",
        data.CanchaTarifaHora ?? 0,
        data.CanchaActiva ?? 1,
      ];
      db.query(sql, values, (err, result) => {
        if (err) return reject(err);
        Cancha.getById(result.insertId)
          .then((r) => resolve(r))
          .catch(reject);
      });
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      const cols = ["CanchaNombre", "CanchaTarifaHora", "CanchaActiva"];
      cols.forEach((c) => {
        if (data[c] !== undefined) {
          fields.push(`${c} = ?`);
          values.push(data[c]);
        }
      });
      if (fields.length === 0) return resolve(null);
      values.push(id);
      db.query(
        `UPDATE cancha SET ${fields.join(", ")} WHERE CanchaId = ?`,
        values,
        async (err, result) => {
          if (err) return reject(err);
          if (result.affectedRows === 0) return resolve(null);
          const r = await Cancha.getById(id);
          resolve(r);
        }
      );
    });
  },

  // Cuenta las reservas asociadas a una cancha. El controlador la usa para
  // decidir si bloquear el DELETE y sugerir desactivacion en su lugar.
  countReservas: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT COUNT(*) AS total FROM cancha_reserva WHERE CanchaId = ?",
        [id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(Number(rows[0]?.total || 0));
        }
      );
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query("DELETE FROM cancha WHERE CanchaId = ?", [id], (err, result) => {
        if (err) return reject(err);
        resolve(result.affectedRows > 0);
      });
    });
  },
};

module.exports = Cancha;
