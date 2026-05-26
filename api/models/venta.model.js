const db = require("../config/db");

/**
 * Normaliza VentaFecha para que siempre incluya fecha y hora.
 * - Si no se proporciona valor: usa fecha/hora actual
 * - Si es solo fecha (YYYY-MM-DD): usa esa fecha con la hora actual del momento del registro
 * - Si es datetime completo: lo usa tal cual
 */
/**
 * Construye la cláusula WHERE para filtros de ventas.
 * Saldo = Total - VentaEntrega. `VentaEntrega` ya acumula TODOS los pagos
 * (entrega inicial + cobros posteriores vía `recibir`, que la incrementa en
 * cada abono), así que NO se vuelve a restar SUM(VentaCreditoPagoMonto) —
 * hacerlo descontaría los pagos dos veces. `ventacreditopago` es solo historial.
 * - Pendiente (P): solo aplica a ventas CR con Saldo > 0
 * - Completado (C): no-CR siempre, o CR con Saldo <= 0
 */
function buildVentaFiltersWhere(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.tipo) {
    conditions.push("v.VentaTipo = ?");
    params.push(filters.tipo);
  }
  if (filters.almacenId) {
    conditions.push("v.AlmacenId = ?");
    params.push(Number(filters.almacenId));
  }
  if (filters.fechaDesde) {
    conditions.push("DATE(v.VentaFecha) >= ?");
    params.push(filters.fechaDesde);
  }
  if (filters.fechaHasta) {
    conditions.push("DATE(v.VentaFecha) <= ?");
    params.push(filters.fechaHasta);
  }
  if (filters.estado === "P") {
    conditions.push(
      "v.VentaTipo = 'CR' AND (v.Total - COALESCE(v.VentaEntrega, 0)) > 0"
    );
  } else if (filters.estado === "C") {
    conditions.push(
      "(v.VentaTipo <> 'CR' OR (v.Total - COALESCE(v.VentaEntrega, 0)) <= 0)"
    );
  }

  const whereSql = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  return { whereSql, params };
}

function normalizeVentaFecha(value) {
  if (!value) return new Date();
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const now = new Date();
    const [y, m, d] = str.split("-").map(Number);
    return new Date(
      y,
      m - 1,
      d,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );
  }
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? new Date() : d;
}

const Venta = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.query("SELECT * FROM venta", (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        `SELECT v.*, 
          c.ClienteNombre, c.ClienteApellido,
          a.AlmacenNombre,
          u.UsuarioNombre
        FROM venta v
        LEFT JOIN clientes c ON v.ClienteId = c.ClienteId
        LEFT JOIN almacen a ON v.AlmacenId = a.AlmacenId
        LEFT JOIN usuario u ON v.VentaUsuario = u.UsuarioId
        WHERE v.VentaId = ?`,
        [id],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.length > 0 ? results[0] : null);
        }
      );
    });
  },

  create: (data) => {
    return new Promise((resolve, reject) => {
      const query = `INSERT INTO venta (
        VentaFecha,
        ClienteId,
        AlmacenId,
        VentaTipo,
        VentaPagoTipo,
        VentaCantidadProductos,
        VentaUsuario,
        Total,
        VentaEntrega
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      const values = [
        normalizeVentaFecha(data.VentaFecha),
        data.ClienteId,
        data.AlmacenId,
        data.VentaTipo,
        data.VentaPagoTipo,
        data.VentaCantidadProductos,
        data.VentaUsuario,
        data.Total,
        data.VentaEntrega,
      ];

      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        Venta.getById(result.insertId)
          .then((venta) => resolve(venta))
          .catch((error) => reject(error));
      });
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      const query = `UPDATE venta SET 
        VentaFecha = ?,
        ClienteId = ?,
        AlmacenId = ?,
        VentaTipo = ?,
        VentaPagoTipo = ?,
        VentaCantidadProductos = ?,
        VentaUsuario = ?,
        Total = ?,
        VentaEntrega = ?
        WHERE VentaId = ?`;

      const values = [
        normalizeVentaFecha(data.VentaFecha),
        data.ClienteId,
        data.AlmacenId,
        data.VentaTipo,
        data.VentaPagoTipo,
        data.VentaCantidadProductos,
        data.VentaUsuario,
        data.Total,
        data.VentaEntrega,
        id,
      ];

      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) return resolve(null);
        Venta.getById(id)
          .then((venta) => resolve(venta))
          .catch((error) => reject(error));
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      // Primero eliminar registros asociados en orden correcto
      const deleteQueries = [
        // 1. Eliminar pagos de crédito (ventacreditopago)
        "DELETE vcp FROM ventacreditopago vcp INNER JOIN ventacredito vc ON vcp.VentaCreditoId = vc.VentaCreditoId WHERE vc.VentaId = ?",
        // 2. Eliminar registros de crédito (ventacredito)
        "DELETE FROM ventacredito WHERE VentaId = ?",
        // 3. Eliminar productos de la venta (ventaproducto)
        "DELETE FROM ventaproducto WHERE VentaId = ?",
        // 4. Finalmente eliminar la venta
        "DELETE FROM venta WHERE VentaId = ?",
      ];

      // Ejecutar las consultas en secuencia
      const executeQueries = async () => {
        try {
          for (const query of deleteQueries) {
            await new Promise((resolveQuery, rejectQuery) => {
              db.query(query, [id], (err, result) => {
                if (err) return rejectQuery(err);
                resolveQuery(result);
              });
            });
          }
          resolve(true);
        } catch (error) {
          reject(error);
        }
      };

      executeQueries();
    });
  },

  getAllPaginated: (
    limit,
    offset,
    sortBy = "VentaId",
    sortOrder = "ASC",
    filters = {}
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "VentaId",
        "VentaFecha",
        "ClienteId",
        "AlmacenId",
        "VentaTipo",
        "VentaPagoTipo",
        "VentaCantidadProductos",
        "VentaUsuario",
        "Total",
        "VentaEntrega",
      ];

      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : "VentaId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      const { whereSql, params: filterParams } = buildVentaFiltersWhere(filters);

      const query = `
        SELECT v.*,
          c.ClienteNombre, c.ClienteApellido,
          a.AlmacenNombre,
          u.UsuarioNombre
        FROM venta v
        LEFT JOIN clientes c ON v.ClienteId = c.ClienteId
        LEFT JOIN almacen a ON v.AlmacenId = a.AlmacenId
        LEFT JOIN usuario u ON v.VentaUsuario = u.UsuarioId
        ${whereSql}
        ORDER BY v.${sortField} ${order}
        LIMIT ? OFFSET ?`;

      db.query(query, [...filterParams, limit, offset], (err, results) => {
        if (err) return reject(err);

        const countQuery = `
          SELECT COUNT(*) as total
          FROM venta v
          ${whereSql}`;

        db.query(countQuery, filterParams, (err, countResult) => {
          if (err) return reject(err);

          resolve({
            ventas: results,
            total: countResult[0].total,
          });
        });
      });
    });
  },

  searchVentas: (
    term,
    limit,
    offset,
    sortBy = "VentaId",
    sortOrder = "ASC",
    filters = {}
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "VentaId",
        "VentaFecha",
        "ClienteId",
        "AlmacenId",
        "VentaTipo",
        "VentaPagoTipo",
        "VentaCantidadProductos",
        "VentaUsuario",
        "Total",
        "VentaEntrega",
      ];

      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : "VentaId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      // Mapear términos comunes a códigos de tipo de venta
      let tipoVentaSearch = term.toLowerCase();
      switch (tipoVentaSearch) {
        case "contado":
          tipoVentaSearch = "CO";
          break;
        case "credito":
        case "crédito":
          tipoVentaSearch = "CR";
          break;
        case "pos":
          tipoVentaSearch = "PO";
          break;
        case "transfer":
        case "transferencia":
          tipoVentaSearch = "TR";
          break;
        default:
          // Si no es ninguno de los tipos conocidos, mantener el término original
          break;
      }

      const { whereSql: filtersWhereSql, params: filterParams } =
        buildVentaFiltersWhere(filters);
      // filtersWhereSql viene con "WHERE ..." o "" — para AND-combinar con la
      // búsqueda convertimos a cláusula AND y quitamos el prefijo.
      const filtersAndClause = filtersWhereSql
        ? ` AND ${filtersWhereSql.replace(/^WHERE\s+/, "")}`
        : "";

      const searchQuery = `
        SELECT v.*,
          c.ClienteNombre, c.ClienteApellido,
          a.AlmacenNombre,
          u.UsuarioNombre
        FROM venta v
        LEFT JOIN clientes c ON v.ClienteId = c.ClienteId
        LEFT JOIN almacen a ON v.AlmacenId = a.AlmacenId
        LEFT JOIN usuario u ON v.VentaUsuario = u.UsuarioId
        WHERE (
          CAST(v.VentaId AS CHAR) = ?
          OR to_char(v.VentaFecha, 'YYYY-MM-DD HH24:MI:SS') LIKE ?
          OR LOWER(CONCAT(COALESCE(c.ClienteNombre, ''), ' ', COALESCE(c.ClienteApellido, ''))) LIKE LOWER(?)
          OR LOWER(COALESCE(a.AlmacenNombre, '')) LIKE LOWER(?)
          OR v.VentaTipo = ?
          OR LOWER(
            CASE v.VentaTipo
              WHEN 'CO' THEN 'contado'
              WHEN 'CR' THEN 'credito'
              WHEN 'PO' THEN 'pos'
              WHEN 'TR' THEN 'transfer'
            END
          ) LIKE LOWER(?)
          OR LOWER(v.VentaPagoTipo) LIKE LOWER(?)
          OR CAST(v.VentaCantidadProductos AS CHAR) = ?
          OR LOWER(COALESCE(u.UsuarioNombre, '')) LIKE LOWER(?)
          OR CAST(v.Total AS CHAR) = ?
          OR LOWER(COALESCE(CAST(v.VentaEntrega AS CHAR), '')) LIKE LOWER(?)
        )${filtersAndClause}
        ORDER BY v.${sortField} ${order}
        LIMIT ? OFFSET ?
      `;

      // Para búsqueda exacta de números
      const exactValue = term;
      // Para búsqueda parcial de texto
      const likeValue = `%${term}%`;

      const searchParams = [
        exactValue, // VentaId
        likeValue, // VentaFecha
        likeValue, // Cliente nombre completo
        likeValue, // AlmacenNombre
        tipoVentaSearch, // VentaTipo (código exacto)
        likeValue, // VentaTipo (nombre descriptivo)
        likeValue, // VentaPagoTipo
        exactValue, // VentaCantidadProductos
        likeValue, // UsuarioNombre
        exactValue, // Total
        likeValue, // VentaEntrega
      ];

      const values = [...searchParams, ...filterParams, limit, offset];

      db.query(searchQuery, values, (err, results) => {
        if (err) {
          console.error("Error en la consulta de búsqueda:", err);
          return reject(err);
        }

        const countQuery = `
          SELECT COUNT(*) as total
          FROM venta v
          LEFT JOIN clientes c ON v.ClienteId = c.ClienteId
          LEFT JOIN almacen a ON v.AlmacenId = a.AlmacenId
          LEFT JOIN usuario u ON v.VentaUsuario = u.UsuarioId
          WHERE (
            CAST(v.VentaId AS CHAR) = ?
            OR to_char(v.VentaFecha, 'YYYY-MM-DD HH24:MI:SS') LIKE ?
            OR LOWER(CONCAT(COALESCE(c.ClienteNombre, ''), ' ', COALESCE(c.ClienteApellido, ''))) LIKE LOWER(?)
            OR LOWER(COALESCE(a.AlmacenNombre, '')) LIKE LOWER(?)
            OR v.VentaTipo = ?
            OR LOWER(
              CASE v.VentaTipo
                WHEN 'CO' THEN 'contado'
                WHEN 'CR' THEN 'credito'
                WHEN 'PO' THEN 'pos'
                WHEN 'TR' THEN 'transfer'
              END
            ) LIKE LOWER(?)
            OR LOWER(v.VentaPagoTipo) LIKE LOWER(?)
            OR CAST(v.VentaCantidadProductos AS CHAR) = ?
            OR LOWER(COALESCE(u.UsuarioNombre, '')) LIKE LOWER(?)
            OR CAST(v.Total AS CHAR) = ?
            OR LOWER(COALESCE(CAST(v.VentaEntrega AS CHAR), '')) LIKE LOWER(?)
          )${filtersAndClause}
        `;

        const countValues = [...searchParams, ...filterParams];

        db.query(countQuery, countValues, (err, countResult) => {
          if (err) {
            console.error("Error en la consulta de conteo:", err);
            return reject(err);
          }
          resolve({
            ventas: results,
            total: countResult[0]?.total || 0,
          });
        });
      });
    });
  },

  // Obtener ventas pendientes por cliente
  getVentasPendientesPorCliente: (clienteId, localId) => {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT 
          v.VentaId,
          v.VentaFecha,
          CAST(v.Total AS DECIMAL(10,2)) as Total,
          CAST(COALESCE(v.VentaEntrega, 0) AS DECIMAL(10,2)) as VentaEntrega,
          CAST((v.Total - COALESCE(v.VentaEntrega, 0)) AS DECIMAL(10,2)) as Saldo
        FROM venta v
        JOIN usuario u ON v.VentaUsuario = u.UsuarioId
        WHERE v.ClienteId = ?
        AND v.VentaTipo = 'CR'
        AND (v.Total - COALESCE(v.VentaEntrega, 0)) > 0
      `;

      const params = [clienteId];

      // Si se proporciona localId, filtrar por el local del usuario que realizó la venta
      if (localId) {
        query += ` AND u.LocalId = ?`;
        params.push(localId);
      }

      // El filtro de saldo va en WHERE con la expresión cruda (no el alias):
      // el adapter auto-quota `AS "Saldo"` y PG lowercasea una referencia
      // `Saldo` sin comillas en HAVING → "no existe la columna saldo". Además
      // HAVING sin GROUP BY sobre una columna no agregada es inválido en PG.
      query += ` ORDER BY v.VentaFecha ASC`;

      db.query(query, params, (err, results) => {
        if (err) {
          console.error("Error en getVentasPendientesPorCliente:", err);
          return reject(err);
        }
        // Convertir explícitamente los valores a número
        const processedResults = results.map((row) => ({
          ...row,
          Total: Number(row.Total),
          VentaEntrega: Number(row.VentaEntrega),
          Saldo: Number(row.Saldo),
        }));
        resolve(processedResults);
      });
    });
  },

  // Obtener deudas pendientes agrupadas por cliente
  getDeudasPendientesPorCliente: () => {
    return new Promise((resolve, reject) => {
      // HAVING/ORDER BY no pueden referenciar el alias PascalCase porque el
      // adapter lo auto-quota (AS "Saldo") y PG lowercasea las referencias
      // unquoted → "no existe la columna saldo". Repetimos la expresión.
      const query = `
        SELECT
          c.ClienteId,
          CONCAT(TRIM(c.ClienteNombre), ' ', TRIM(c.ClienteApellido)) AS Cliente,
          SUM(v.Total) AS TotalVentas,
          SUM(COALESCE(v.VentaEntrega,0)) AS TotalEntregado,
          SUM(v.Total - COALESCE(v.VentaEntrega,0)) AS Saldo
        FROM venta v
        JOIN clientes c ON v.ClienteId = c.ClienteId
        WHERE v.VentaTipo = 'CR'
        GROUP BY c.ClienteId, c.ClienteNombre, c.ClienteApellido
        HAVING SUM(v.Total - COALESCE(v.VentaEntrega,0)) > 0
        ORDER BY CONCAT(TRIM(c.ClienteNombre), ' ', TRIM(c.ClienteApellido))
      `;
      db.query(query, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  },

  // Obtener reporte de ventas por cliente y rango de fechas
  // Si clienteId es "TODOS", devuelve ventas de todos los clientes
  getReporteVentasPorCliente: (clienteId, fechaDesde, fechaHasta) => {
    return new Promise((resolve, reject) => {
      const esTodos = String(clienteId).toUpperCase() === "TODOS";

      const ejecutarVentas = (cliente) => {
        const ventasQuery = `
          SELECT 
            v.*,
            c.ClienteNombre,
            c.ClienteApellido,
            c.ClienteRUC,
            a.AlmacenNombre,
            u.UsuarioNombre,
            v.VentaUsuario AS UsuarioId
          FROM venta v
          LEFT JOIN clientes c ON v.ClienteId = c.ClienteId
          LEFT JOIN almacen a ON v.AlmacenId = a.AlmacenId
          LEFT JOIN usuario u ON v.VentaUsuario = u.UsuarioId
          WHERE DATE(v.VentaFecha) BETWEEN ? AND ?
          ${esTodos ? "" : "AND v.ClienteId = ?"}
          ORDER BY v.VentaFecha ASC, v.VentaId ASC
        `;

        const ventasParams = esTodos ? [fechaDesde, fechaHasta] : [fechaDesde, fechaHasta, clienteId];

        db.query(ventasQuery, ventasParams, (err, ventasResults) => {
          if (err) return reject(err);

          // Sin ventas: devolver vacío sin más queries.
          if (ventasResults.length === 0) {
            return resolve({
              cliente: {
                ClienteId: cliente.ClienteId,
                ClienteNombre: cliente.ClienteNombre,
                ClienteApellido: cliente.ClienteApellido,
                ClienteRUC: cliente.ClienteRUC,
              },
              fechaDesde,
              fechaHasta,
              ventas: ventasResults.map((v) => ({
                ...v,
                SaldoPendiente: 0,
                Pagos: [],
              })),
            });
          }

          // IDs de ventas a crédito (único set que va a tener ventacredito).
          const creditoVentaIds = ventasResults
            .filter((v) => v.VentaTipo === "CR")
            .map((v) => v.VentaId);

          const finalize = (creditosByVentaId, pagosByCreditoId) => {
            const ventasConDetalle = ventasResults.map((venta) => {
              const base = { ...venta, SaldoPendiente: 0, Pagos: [] };
              if (venta.VentaTipo !== "CR") return base;

              const total = Number(venta.Total) || 0;
              const entrega = Number(venta.VentaEntrega) || 0;
              base.SaldoPendiente = total - entrega;

              const credito = creditosByVentaId.get(venta.VentaId);
              if (credito) {
                base.Pagos = pagosByCreditoId.get(credito.VentaCreditoId) || [];
              }
              return base;
            });

            resolve({
              cliente: {
                ClienteId: cliente.ClienteId,
                ClienteNombre: cliente.ClienteNombre,
                ClienteApellido: cliente.ClienteApellido,
                ClienteRUC: cliente.ClienteRUC,
              },
              fechaDesde,
              fechaHasta,
              ventas: ventasConDetalle,
            });
          };

          // Sin ventas a crédito: no hacen falta las otras 2 queries.
          if (creditoVentaIds.length === 0) {
            return finalize(new Map(), new Map());
          }

          // Query #2: todos los ventacredito del set en una sola tirada.
          // Placeholders explícitos (un `?` por id): el adaptador PG traduce
          // `?` posicionalmente a `$N` y NO expande arrays como mysql2, así que
          // `IN (?)` con un array rompería.
          const creditoVentaPlaceholders = creditoVentaIds.map(() => "?").join(", ");
          db.query(
            `SELECT * FROM ventacredito WHERE VentaId IN (${creditoVentaPlaceholders})`,
            creditoVentaIds,
            (err, creditosResults) => {
              if (err) return reject(err);

              const creditosByVentaId = new Map(
                creditosResults.map((c) => [c.VentaId, c])
              );
              const creditoIds = creditosResults.map((c) => c.VentaCreditoId);

              if (creditoIds.length === 0) {
                return finalize(creditosByVentaId, new Map());
              }

              // Query #3: todos los pagos del set, ordenados y agrupados en memoria.
              const creditoPlaceholders = creditoIds.map(() => "?").join(", ");
              db.query(
                `SELECT * FROM ventacreditopago
                 WHERE VentaCreditoId IN (${creditoPlaceholders})
                 ORDER BY VentaCreditoPagoFecha ASC, VentaCreditoPagoId ASC`,
                creditoIds,
                (err, pagosResults) => {
                  if (err) return reject(err);

                  const pagosByCreditoId = new Map();
                  for (const pago of pagosResults) {
                    const arr = pagosByCreditoId.get(pago.VentaCreditoId);
                    if (arr) arr.push(pago);
                    else pagosByCreditoId.set(pago.VentaCreditoId, [pago]);
                  }

                  finalize(creditosByVentaId, pagosByCreditoId);
                }
              );
            }
          );
        });
      };

      if (esTodos) {
        ejecutarVentas({
          ClienteId: 0,
          ClienteNombre: "TODOS",
          ClienteApellido: "",
          ClienteRUC: "",
        });
      } else {
        const clienteQuery = "SELECT * FROM clientes WHERE ClienteId = ?";
        db.query(clienteQuery, [clienteId], (err, clienteResults) => {
          if (err) return reject(err);
          if (clienteResults.length === 0) {
            return reject(new Error("Cliente no encontrado"));
          }
          ejecutarVentas(clienteResults[0]);
        });
      }
    });
  },
};

module.exports = Venta;
