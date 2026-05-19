const db = require("../config/db");
const { escapeLike } = require("../utils/sql");

// Postgres almacena flags como SMALLINT (0/1). El frontend envia booleanos
// JS (true/false), que pg rechaza con "la sintaxis de entrada no es valida
// para tipo smallint: «true»". Normalizamos antes de cada write.
const toInt01 = (v) => (v === true || v === 1 || v === "1" ? 1 : 0);

const Plan = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM plan", (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM plan WHERE PlanId = ?", [id], (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? results[0] : null);
      });
    });
  },

  create: (planData) => {
    return new Promise((resolve, reject) => {
      const query = `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanPermiteClases, PlanActivo, PlanModalidad, PlanCantidadClases) VALUES (?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        planData.PlanNombre,
        planData.PlanDuracion,
        planData.PlanPrecio,
        toInt01(planData.PlanPermiteClases),
        toInt01(planData.PlanActivo),
        planData.PlanModalidad || "MENSUAL",
        planData.PlanCantidadClases ?? 0,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        // Obtener el plan recién creado
        Plan.getById(result.insertId)
          .then((plan) => resolve(plan))
          .catch((error) => reject(error));
      });
    });
  },

  update: (id, planData) => {
    return new Promise((resolve, reject) => {
      const query = `UPDATE plan SET PlanNombre = ?, PlanDuracion = ?, PlanPrecio = ?, PlanPermiteClases = ?, PlanActivo = ?, PlanModalidad = ?, PlanCantidadClases = ? WHERE PlanId = ?`;
      const values = [
        planData.PlanNombre,
        planData.PlanDuracion,
        planData.PlanPrecio,
        toInt01(planData.PlanPermiteClases),
        toInt01(planData.PlanActivo),
        planData.PlanModalidad || "MENSUAL",
        planData.PlanCantidadClases ?? 0,
        id,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) return resolve(null);
        Plan.getById(id)
          .then((plan) => resolve(plan))
          .catch((error) => reject(error));
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query("DELETE FROM plan WHERE PlanId = ?", [id], (err, result) => {
        if (err) return reject(err);
        resolve(result.affectedRows > 0);
      });
    });
  },

  getAllPaginated: (limit, offset, sortBy = "PlanId", sortOrder = "ASC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "PlanId",
        "PlanNombre",
        "PlanDuracion",
        "PlanPrecio",
        "PlanPermiteClases",
        "PlanActivo",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : "PlanId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      db.query(
        `SELECT * FROM plan ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, results) => {
          if (err) return reject(err);

          db.query("SELECT COUNT(*) as total FROM plan", (err, countResult) => {
            if (err) return reject(err);

            resolve({
              planes: results,
              total: countResult[0].total,
            });
          });
        }
      );
    });
  },

  searchPlanes: (term, limit, offset, sortBy = "PlanId", sortOrder = "ASC") => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "PlanId",
        "PlanNombre",
        "PlanDuracion",
        "PlanPrecio",
        "PlanPermiteClases",
        "PlanActivo",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : "PlanId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const searchQuery = `
        SELECT * FROM plan
        WHERE PlanNombre LIKE ?
        OR CAST(PlanDuracion AS CHAR) LIKE ?
        OR CAST(PlanPrecio AS CHAR) LIKE ?
        ORDER BY ${sortField} ${order}
        LIMIT ? OFFSET ?
      `;
      const searchValue = `%${escapeLike(term)}%`;

      db.query(
        searchQuery,
        [searchValue, searchValue, searchValue, limit, offset],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total FROM plan
            WHERE PlanNombre LIKE ?
            OR CAST(PlanDuracion AS CHAR) LIKE ?
            OR CAST(PlanPrecio AS CHAR) LIKE ?
          `;
          db.query(
            countQuery,
            [searchValue, searchValue, searchValue],
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                planes: results,
                total: countResult[0]?.total || 0,
              });
            }
          );
        }
      );
    });
  },
};

module.exports = Plan;
