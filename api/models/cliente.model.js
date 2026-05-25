const db = require("../config/db");
const { calcularDV } = require("../utils/rucDv");
const { escapeLike } = require("../utils/sql");

// Calcula el DV automaticamente cuando la CI es estrictamente numerica.
// Si la CI esta vacia o trae caracteres no numericos (placeholders tipo
// "SIN RUC"), dejamos el DV vacio para no inventar datos. El usuario solo
// carga la CI; este helper mantiene la columna `ClienteDV` sincronizada.
function dvParaRUC(ruc) {
  const limpio = String(ruc ?? "").trim();
  if (!limpio) return "";
  if (!/^\d+$/.test(limpio)) return "";
  return String(calcularDV(limpio));
}

function buildClienteFiltersWhere(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.tipo) {
    conditions.push("ClienteTipo = ?");
    params.push(filters.tipo);
  }

  return { conditions, params };
}

const Cliente = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM clientes", (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM clientes WHERE ClienteId = ?",
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
    sortBy = "ClienteId",
    sortOrder = "ASC",
    filters = {}
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "ClienteId",
        "ClienteRUC",
        "ClienteNombre",
        "ClienteApellido",
        "ClienteDireccion",
        "ClienteTelefono",
        "ClienteTipo",
        "UsuarioId",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "ClienteId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const { conditions, params: filterParams } =
        buildClienteFiltersWhere(filters);
      const whereSql = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      db.query(
        `SELECT * FROM clientes ${whereSql} ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `SELECT COUNT(*) as total FROM clientes ${whereSql}`;

          db.query(countQuery, filterParams, (err, countResult) => {
            if (err) return reject(err);

            resolve({
              clientes: results,
              total: countResult[0].total,
            });
          });
        }
      );
    });
  },

  search: (
    term,
    limit,
    offset,
    sortBy = "ClienteId",
    sortOrder = "ASC",
    filters = {}
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "ClienteId",
        "ClienteRUC",
        "ClienteNombre",
        "ClienteApellido",
        "ClienteDireccion",
        "ClienteTelefono",
        "ClienteTipo",
        "UsuarioId",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "ClienteId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const { conditions: filterConditions, params: filterParams } =
        buildClienteFiltersWhere(filters);
      const filtersAndClause = filterConditions.length
        ? ` AND ${filterConditions.join(" AND ")}`
        : "";

      const searchQuery = `
        SELECT * FROM clientes
        WHERE (CONCAT(ClienteNombre, ' ', ClienteApellido) LIKE ?
          OR ClienteRUC LIKE ?
          OR ClienteId LIKE ?)${filtersAndClause}
        ORDER BY ${sortField} ${order}
        LIMIT ? OFFSET ?
      `;
      // escapeLike: un término con `%` o `_` rompía el filtro al hacer pasar
      // todo el resultset. Otros models (plan, pago, suscripcion) lo usan.
      const searchValue = `%${escapeLike(term)}%`;
      const searchParams = [searchValue, searchValue, searchValue];

      db.query(
        searchQuery,
        [...searchParams, ...filterParams, limit, offset],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total FROM clientes
            WHERE (CONCAT(ClienteNombre, ' ', ClienteApellido) LIKE ?
              OR ClienteRUC LIKE ?
              OR ClienteId LIKE ?)${filtersAndClause}
          `;

          db.query(
            countQuery,
            [...searchParams, ...filterParams],
            (err, countResult) => {
              if (err) return reject(err);

              resolve({
                clientes: results,
                total: countResult[0]?.total || 0,
              });
            }
          );
        }
      );
    });
  },

  create: (clienteData) => {
    return new Promise((resolve, reject) => {
      const ruc = clienteData.ClienteRUC || "";
      const dv = dvParaRUC(ruc);
      const query = `
        INSERT INTO clientes (
          ClienteRUC,
          ClienteDV,
          ClienteNombre,
          ClienteApellido,
          ClienteDireccion,
          ClienteTelefono,
          ClienteTipo,
          UsuarioId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        ruc,
        dv,
        clienteData.ClienteNombre,
        clienteData.ClienteApellido || "",
        clienteData.ClienteDireccion || "",
        clienteData.ClienteTelefono || "",
        clienteData.ClienteTipo || "",
        clienteData.UsuarioId ? String(clienteData.UsuarioId).trim() : "",
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        resolve({ ...clienteData, ClienteDV: dv, ClienteId: result.insertId });
      });
    });
  },

  update: (id, clienteData) => {
    return new Promise((resolve, reject) => {
      let updateFields = [];
      let values = [];
      const camposActualizables = [
        "ClienteRUC",
        "ClienteNombre",
        "ClienteApellido",
        "ClienteDireccion",
        "ClienteTelefono",
        "ClienteTipo",
        "UsuarioId",
      ];
      camposActualizables.forEach((campo) => {
        if (clienteData[campo] !== undefined) {
          updateFields.push(`${campo} = ?`);
          // Aplicar trim solo al UsuarioId si es string
          if (campo === "UsuarioId" && typeof clienteData[campo] === "string") {
            values.push(clienteData[campo].trim());
          } else {
            values.push(clienteData[campo]);
          }
        }
      });
      // Si actualizan el RUC, recalculamos el DV. Si pasaron explicitamente
      // un ClienteDV se respeta (caso raro: ediciones manuales de personas
      // juridicas con DV peculiar); sino tomamos el calculado.
      if (clienteData.ClienteRUC !== undefined && clienteData.ClienteDV === undefined) {
        updateFields.push("ClienteDV = ?");
        values.push(dvParaRUC(clienteData.ClienteRUC));
      } else if (clienteData.ClienteDV !== undefined) {
        updateFields.push("ClienteDV = ?");
        values.push(String(clienteData.ClienteDV));
      }
      if (updateFields.length === 0) {
        return resolve(null);
      }
      values.push(id);
      const query = `
        UPDATE clientes 
        SET ${updateFields.join(", ")}
        WHERE ClienteId = ?
      `;
      db.query(query, values, async (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) {
          return resolve(null);
        }
        db.query(
          "SELECT * FROM clientes WHERE ClienteId = ?",
          [id],
          (err, results) => {
            if (err) return reject(err);
            resolve(results.length > 0 ? results[0] : null);
          }
        );
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM clientes WHERE ClienteId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        }
      );
    });
  },
};

module.exports = Cliente;
