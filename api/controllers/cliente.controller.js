const Cliente = require("../models/cliente.model");
const db = require("../config/db");
const { sendError } = require("../utils/errors");

function extractClienteFilters(query) {
  const allowedTipos = ["MI", "MA"];
  const filters = {};
  if (query.tipo && allowedTipos.includes(query.tipo))
    filters.tipo = query.tipo;
  return filters;
}

// getAllClientes
exports.getAllClientes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "ClienteId";
    const sortOrder = req.query.sortOrder || "ASC";
    const filters = extractClienteFilters(req.query);

    const { clientes, total } = await Cliente.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder,
      filters,
    );

    res.json({
      data: clientes,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

// searchClientes
exports.searchClientes = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "ClienteId";
    const sortOrder = req.query.sortOrder || "ASC";
    if (!searchTerm || searchTerm.trim() === "") {
      return res
        .status(400)
        .json({ error: "El término de búsqueda no puede estar vacío" });
    }

    const filters = extractClienteFilters(req.query);

    const { clientes, total } = await Cliente.search(
      searchTerm,
      limit,
      offset,
      sortBy,
      sortOrder,
      filters,
    );

    res.json({
      data: clientes,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error("Error en searchClientes:", error);
    res.status(500).json({ error: "Error al buscar clientes" });
  }
};

exports.getClienteById = async (req, res) => {
  try {
    const cliente = await Cliente.getById(req.params.id);
    if (!cliente) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }
    res.json(cliente);
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

exports.createCliente = async (req, res) => {
  try {
    // Validación de campos requeridos
    if (!req.body.ClienteNombre) {
      return res.status(400).json({
        success: false,
        message: `El campo ClienteNombre es requerido`,
      });
    }
    // Normalizar ClienteFechaNacimiento: vacío/undefined -> null (DATE acepta null si la columna lo permite)
    const fechaNac = req.body.ClienteFechaNacimiento;
    const ClienteFechaNacimiento =
      fechaNac && String(fechaNac).trim() !== ""
        ? String(fechaNac).trim()
        : null;
    // Crear el nuevo cliente
    const nuevoCliente = await Cliente.create({
      ClienteRUC: req.body.ClienteRUC || "",
      ClienteNombre: req.body.ClienteNombre,
      ClienteApellido: req.body.ClienteApellido || null,
      ClienteDireccion: req.body.ClienteDireccion || null,
      ClienteTelefono: req.body.ClienteTelefono || null,
      ClienteTipo: req.body.ClienteTipo,
      ClienteFechaNacimiento,
      UsuarioId: req.body.UsuarioId ? String(req.body.UsuarioId).trim() : "",
    });
    res.status(201).json({
      success: true,
      data: nuevoCliente,
      message: "Cliente creado exitosamente",
    });
  } catch (error) {
    console.error("Error al crear cliente:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear cliente",
    });
  }
};

exports.updateCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const clienteData = req.body;
    if (!clienteData.ClienteNombre) {
      return res.status(400).json({
        success: false,
        message: "ClienteNombre es un campo requerido",
      });
    }
    const updatedCliente = await Cliente.update(id, clienteData);
    if (!updatedCliente) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }
    res.json({
      success: true,
      data: updatedCliente,
      message: "Cliente actualizado exitosamente",
    });
  } catch (error) {
    console.error("Error al actualizar cliente:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar cliente",
    });
  }
};

exports.deleteCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Cliente.delete(id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }
    res.json({
      success: true,
      message: "Cliente eliminado exitosamente",
    });
  } catch (error) {
    console.error(error);
    if (
      error &&
      error.message &&
      error.message.includes("a foreign key constraint fails")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "No se puede eliminar el cliente porque tiene movimientos asociados.",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error al eliminar cliente",
    });
  }
};

// Obtener todos los clientes sin paginación
exports.getAllClientesSinPaginacion = async (req, res) => {
  try {
    const clientes = await Cliente.getAll();
    res.json({ data: clientes });
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

// Vista consolidada de deuda por cliente (gimnasio + cantina + cancha).
//
// Combina tres fuentes:
//   1. Suscripciones impagas: PlanPrecio - SUM(PagoMonto) > 0
//   2. Ventas a crédito sin liquidar: Total - VentaEntrega - SUM(PagoMonto) > 0
//   3. Créditos de cancha pendientes: cancha_credito.CanchaCreditoSaldo > 0
//
// Devuelve un cliente por fila, con los 3 subtotales y el total. Ordenado
// por total DESC para que el operador llame primero a los que más deben.
//
// Sin paginación porque típicamente son pocos clientes (≤100). Si crece se
// agrega después.
exports.getClientesConDeuda = async (_req, res) => {
  try {
    const sql = `
      WITH
      deuda_gym AS (
        SELECT s.ClienteId,
               SUM(GREATEST(COALESCE(p.PlanPrecio, 0) - COALESCE(pg.totalpagado, 0), 0)) AS saldo,
               COUNT(*) FILTER (
                 WHERE COALESCE(p.PlanPrecio, 0) > COALESCE(pg.totalpagado, 0)
               ) AS cant
        FROM suscripcion s
        LEFT JOIN plan p ON p.PlanId = s.PlanId
        LEFT JOIN (
          SELECT SuscripcionId, SUM(PagoMonto) AS totalpagado
          FROM pago
          GROUP BY SuscripcionId
        ) pg ON pg.SuscripcionId = s.SuscripcionId
        WHERE s.SuscripcionEstado NOT IN ('C')
          AND COALESCE(p.PlanPrecio, 0) > COALESCE(pg.totalpagado, 0)
        GROUP BY s.ClienteId
      ),
      deuda_ventas AS (
        -- Saldo = Total - VentaEntrega. VentaEntrega ya acumula todos los pagos
        -- (el flujo recibir la incrementa en cada cobro), así que NO se resta
        -- de nuevo SUM(ventacreditopago) — sería descontar los pagos dos veces.
        SELECT v.ClienteId,
               SUM(GREATEST(v.Total - COALESCE(v.VentaEntrega, 0), 0)) AS saldo,
               COUNT(*) AS cant
        FROM venta v
        WHERE v.VentaTipo = 'CR'
          AND v.Total - COALESCE(v.VentaEntrega, 0) > 0
        GROUP BY v.ClienteId
      ),
      deuda_cancha AS (
        SELECT ClienteId,
               SUM(CanchaCreditoSaldo) AS saldo,
               COUNT(*) AS cant
        FROM cancha_credito
        WHERE CanchaCreditoSaldo > 0
        GROUP BY ClienteId
      ),
      todas AS (
        SELECT ClienteId FROM deuda_gym
        UNION SELECT ClienteId FROM deuda_ventas
        UNION SELECT ClienteId FROM deuda_cancha
      )
      SELECT
        c.ClienteId,
        c.ClienteNombre,
        c.ClienteApellido,
        c.ClienteRUC,
        c.ClienteTelefono,
        COALESCE(dg.saldo, 0) AS saldo_gimnasio,
        COALESCE(dg.cant,  0) AS cant_gimnasio,
        COALESCE(dv.saldo, 0) AS saldo_ventas,
        COALESCE(dv.cant,  0) AS cant_ventas,
        COALESCE(dc.saldo, 0) AS saldo_cancha,
        COALESCE(dc.cant,  0) AS cant_cancha,
        COALESCE(dg.saldo, 0) + COALESCE(dv.saldo, 0) + COALESCE(dc.saldo, 0) AS saldo_total
      FROM todas t
      JOIN clientes c ON c.ClienteId = t.ClienteId
      LEFT JOIN deuda_gym    dg ON dg.ClienteId = t.ClienteId
      LEFT JOIN deuda_ventas dv ON dv.ClienteId = t.ClienteId
      LEFT JOIN deuda_cancha dc ON dc.ClienteId = t.ClienteId
      ORDER BY saldo_total DESC, c.ClienteNombre ASC
    `;
    const rowsRaw = await new Promise((resolve, reject) => {
      db.query(sql, [], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
    // Normalizar al camelCase que espera el frontend, y forzar Number (los
    // BIGINT/NUMERIC vienen como string para evitar pérdida de precisión).
    // Los aliases internos son snake_case porque el adapter PG auto-quota
    // sólo aliases PascalCase y eso choca con referencias unquoted como
    // `ORDER BY saldo_total` (el lowercaseado matchea, el quoted no).
    const rows = rowsRaw.map((r) => ({
      ClienteId: Number(r.ClienteId),
      ClienteNombre: r.ClienteNombre,
      ClienteApellido: r.ClienteApellido,
      ClienteRUC: r.ClienteRUC,
      ClienteTelefono: r.ClienteTelefono,
      saldoGimnasio: Number(r.saldo_gimnasio || 0),
      cantGimnasio: Number(r.cant_gimnasio || 0),
      saldoVentas: Number(r.saldo_ventas || 0),
      cantVentas: Number(r.cant_ventas || 0),
      saldoCancha: Number(r.saldo_cancha || 0),
      cantCancha: Number(r.cant_cancha || 0),
      saldoTotal: Number(r.saldo_total || 0),
    }));
    const totales = rows.reduce(
      (acc, r) => {
        acc.gimnasio += r.saldoGimnasio;
        acc.ventas += r.saldoVentas;
        acc.cancha += r.saldoCancha;
        acc.total += r.saldoTotal;
        return acc;
      },
      { gimnasio: 0, ventas: 0, cancha: 0, total: 0 }
    );
    res.json({ data: rows, totales, cantidadClientes: rows.length });
  } catch (e) {
    console.error("getClientesConDeuda:", e);
    sendError(res, e, 500);
  }
};
