const Venta = require("../models/venta.model");
const { sendError } = require("../utils/errors");
const db = require("../config/db");
const { confirmarVentaTx } = require("../models/ventaTx");
const { anularVentaTx } = require("../models/correccionCaja.model");
const { sumarUnidades } = require("../utils/stockOps");

// Acepta "YYYY-MM-DD" o "YYYY-MM-DDTHH:MM:SS" (ISO con o sin hora) o
// "DD/MM/YY" / "DD/MM/YYYY" (formato GeneXus). Preserva la hora si viene.
function parseFecha(s) {
  if (!s) return null;
  // ISO con o sin componente horario; PG acepta ambos en columnas TIMESTAMP.
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?/.test(s)) {
    return s.replace("T", " ").slice(0, 19);
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    let [, d, mo, y, hh = "00", mm = "00", ss = "00"] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo}-${d} ${hh}:${mm}:${ss}`;
  }
  throw new Error(`Fecha inválida: ${s}`);
}

exports.getAll = async (req, res) => {
  try {
    const ventas = await Venta.getAll();
    res.json(ventas);
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

function extractVentaFilters(query) {
  const allowedTipos = ["CO", "CR", "PO", "TR"];
  const allowedEstados = ["P", "C"];
  const filters = {};
  if (query.tipo && allowedTipos.includes(query.tipo)) filters.tipo = query.tipo;
  if (query.almacenId) filters.almacenId = query.almacenId;
  if (query.fechaDesde) filters.fechaDesde = query.fechaDesde;
  if (query.fechaHasta) filters.fechaHasta = query.fechaHasta;
  if (query.estado && allowedEstados.includes(query.estado))
    filters.estado = query.estado;
  return filters;
}

exports.getAllPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "VentaId";
    const sortOrder = req.query.sortOrder || "ASC";
    const filters = extractVentaFilters(req.query);

    const result = await Venta.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder,
      filters
    );

    res.json({
      data: result.ventas,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const venta = await Venta.getById(req.params.id);
    if (!venta) {
      return res.status(404).json({ message: "Venta no encontrada" });
    }
    res.json(venta);
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

exports.create = async (req, res) => {
  try {
    const venta = await Venta.create(req.body);
    res.status(201).json({
      message: "Venta creada exitosamente",
      data: venta,
    });
  } catch (error) {
    console.error(error);
    sendError(res, error, 400);
  }
};

exports.update = async (req, res) => {
  try {
    const venta = await Venta.update(req.params.id, req.body);
    if (!venta) {
      return res.status(404).json({ message: "Venta no encontrada" });
    }
    res.json({
      message: "Venta actualizada exitosamente",
      data: venta,
    });
  } catch (error) {
    console.error(error);
    sendError(res, error, 400);
  }
};

// DELETE de venta: replica PBorrarRegistoDiarioWS con &regla=1 (revierte los
// movimientos de caja, restituye stock y borra la venta y sus hijos) en una
// transacción. La lógica vive en models/correccionCaja.model.js, compartida
// con la pantalla de corrección de caja:
//   - Los movimientos se borran del turno donde están, no se compensan en la
//     caja de hoy.
//   - El efectivo sólo se descuenta de Caja.CajaMonto si ese turno sigue
//     abierto. Antes se descontaba siempre: anular una venta de ayer le
//     restaba plata a la caja abierta hoy.
// Queda registrada en `correccioncaja`.
exports.delete = async (req, res) => {
  const ventaId = parseInt(req.params.id, 10);
  if (!ventaId) {
    return res.status(400).json({ message: "VentaId inválido" });
  }

  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();
    await anularVentaTx(conn, {
      ventaId,
      motivo: "Anulación desde Ventas",
      usuarioId: req.user?.id || "",
    });
    await conn.commit();
    return res.json({ success: true, message: "Venta eliminada exitosamente" });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rbErr) {
      console.error("Rollback falló:", rbErr);
    }
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Error al eliminar venta:", error);
    sendError(res, error, 500);
  } finally {
    conn.release();
  }
};

exports.searchVentas = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "VentaId";
    const sortOrder = req.query.sortOrder || "ASC";

    if (!searchTerm || searchTerm.trim() === "") {
      return res.status(400).json({
        error: "El término de búsqueda no puede estar vacío",
      });
    }

    const filters = extractVentaFilters(req.query);

    const result = await Venta.searchVentas(
      searchTerm,
      limit,
      offset,
      sortBy,
      sortOrder,
      filters
    );

    res.json({
      data: result.ventas,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al buscar ventas" });
  }
};

// Obtener ventas pendientes por cliente
exports.getVentasPendientesPorCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const { localId } = req.query;

    if (!clienteId) {
      return res.status(400).json({
        success: false,
        message: "El ID del cliente es requerido",
      });
    }

    const ventas = await Venta.getVentasPendientesPorCliente(
      clienteId,
      localId
    );
    res.json({
      success: true,
      data: ventas,
    });
  } catch (error) {
    console.error("Error al obtener ventas pendientes:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener ventas pendientes",
    });
  }
};

// Obtener deudas pendientes agrupadas por cliente
exports.getDeudasPendientesPorCliente = async (req, res) => {
  try {
    const deudas = await Venta.getDeudasPendientesPorCliente();
    res.json({ success: true, data: deudas });
  } catch (error) {
    console.error("Error al obtener deudas pendientes por cliente:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener deudas pendientes por cliente",
    });
  }
};

// Confirma una venta de forma atómica: cabecera + items + descuento de stock
// (general y por almacén) + movimientos de caja + actualización del monto de
// caja + ventacredito/ventacreditopago si hubo cobro a cuenta corriente.
// Replica PVentaConfirmarWS de GeneXus.
exports.confirmar = async (req, res) => {
  const {
    VentaFecha: fechaIn,
    AlmacenOrigenId,
    ClienteId,
    CajaId,
    UsuarioId,
    VentaNroFactura = 0,
    VentaTimbrado = 0,
    VentaNroPOS = "0",
    VentaPagoTipo,
    Pagos = {},
    Productos = [],
  } = req.body || {};

  // Todos los montos de pago caen en columnas BIGINT (Total, VentaEntrega,
  // RegistroDiarioCajaMonto, CajaMonto, VentaCreditoPagoMonto). PG no trunca
  // decimales en BIGINT — redondeo en el borde.
  const efectivo = Math.round(Number(Pagos.Efectivo) || 0);
  const banco = Math.round(Number(Pagos.Banco) || 0);
  const cuentaCliente = Math.round(Number(Pagos.CuentaCliente) || 0);
  const voucher = Math.round(Number(Pagos.Voucher) || 0);
  const transferencia = Math.round(Number(Pagos.Transferencia) || 0);

  if (!Array.isArray(Productos) || Productos.length === 0) {
    return res.status(400).json({ message: "Se requiere al menos un producto" });
  }
  if (!AlmacenOrigenId || !ClienteId || !CajaId || !UsuarioId) {
    return res
      .status(400)
      .json({ message: "Faltan AlmacenOrigenId, ClienteId, CajaId o UsuarioId" });
  }

  let ventaFecha;
  try {
    ventaFecha = parseFecha(fechaIn);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
  if (!ventaFecha) ventaFecha = new Date().toISOString().slice(0, 10);

  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    const r = await confirmarVentaTx(conn, {
      ventaFecha,
      AlmacenOrigenId,
      ClienteId,
      CajaId,
      UsuarioId,
      VentaNroFactura,
      VentaTimbrado,
      VentaNroPOS,
      VentaPagoTipo,
      efectivo,
      banco,
      cuentaCliente,
      voucher,
      transferencia,
      Productos,
    });
    const ultorden = r.VentaId;
    const ventaTipo = r.VentaTipo;
    const total = r.Total;
    const ventaEntrega = r.VentaEntrega;

    await conn.commit();
    return res.status(201).json({
      success: true,
      message: "Venta confirmada exitosamente",
      data: {
        VentaId: ultorden,
        VentaTipo: ventaTipo,
        Total: total,
        VentaEntrega: ventaEntrega,
      },
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rbErr) {
      console.error("Rollback falló:", rbErr);
    }
    console.error("Error confirmando venta:", err);
    return res.status(400).json({
      success: false,
      message: err && err.message ? err.message : "Error confirmando venta",
    });
  } finally {
    conn.release();
  }
};

// Devolución de productos: restituye stock al almacén y descuenta el total
// devuelto de la caja. Replica PDevolucionWS. No crea un registro de venta
// nuevo ni anula la original — es una entrada de mercadería + egreso de caja.
exports.devolucion = async (req, res) => {
  const {
    VentaFecha: fechaIn,
    AlmacenOrigenId,
    CajaId,
    UsuarioId,
    Total2,
    Productos = [],
  } = req.body || {};

  if (!Array.isArray(Productos) || Productos.length === 0) {
    return res.status(400).json({ message: "Se requiere al menos un producto" });
  }
  if (!AlmacenOrigenId || !CajaId || !UsuarioId) {
    return res
      .status(400)
      .json({ message: "Faltan AlmacenOrigenId, CajaId o UsuarioId" });
  }
  const total = Number(Total2) || 0;
  if (total <= 0) {
    return res.status(400).json({ message: "Total2 debe ser mayor a cero" });
  }

  let ventaFecha;
  try {
    ventaFecha = parseFecha(fechaIn);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
  if (!ventaFecha) ventaFecha = new Date().toISOString().slice(0, 10);

  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    for (const p of Productos) {
      const productoId = p.ProductoId;
      const cantidad = Number(p.VentaProductoCantidad);
      const unidad = p.ProductoUnidad === "U" ? "U" : "C";

      const [prodRows] = await conn.query(
        `SELECT ProductoCantidadCaja, ProductoStock, ProductoStockUnitario, ProductoServicio
         FROM producto WHERE ProductoId = ?`,
        [productoId]
      );
      if (!prodRows.length) {
        throw new Error(`Producto ${productoId} no encontrado`);
      }
      const prod = prodRows[0];
      const cantidadCaja = Number(prod.ProductoCantidadCaja);

      // Productos servicio no llevan inventario: no se repone stock.
      if (Number(prod.ProductoServicio) === 1) {
        continue;
      }

      if (unidad === "U") {
        const nProd = sumarUnidades(
          prod.ProductoStock,
          prod.ProductoStockUnitario,
          cantidad,
          cantidadCaja
        );
        await conn.query(
          `UPDATE producto SET ProductoStock = ?, ProductoStockUnitario = ?
           WHERE ProductoId = ?`,
          [nProd.stock, nProd.stockUnitario, productoId]
        );

        const [paRows] = await conn.query(
          `SELECT ProductoAlmacenStock, ProductoAlmacenStockUnitario
           FROM productoalmacen WHERE ProductoId = ? AND AlmacenId = ?`,
          [productoId, AlmacenOrigenId]
        );
        if (!paRows.length) {
          throw new Error(
            `Producto ${productoId} no tiene registro en almacén ${AlmacenOrigenId}`
          );
        }
        const nPa = sumarUnidades(
          paRows[0].ProductoAlmacenStock,
          paRows[0].ProductoAlmacenStockUnitario,
          cantidad,
          cantidadCaja
        );
        await conn.query(
          `UPDATE productoalmacen
           SET ProductoAlmacenStock = ?, ProductoAlmacenStockUnitario = ?
           WHERE ProductoId = ? AND AlmacenId = ?`,
          [nPa.stock, nPa.stockUnitario, productoId, AlmacenOrigenId]
        );
      } else {
        await conn.query(
          `UPDATE producto SET ProductoStock = ProductoStock + ? WHERE ProductoId = ?`,
          [cantidad, productoId]
        );
        await conn.query(
          `UPDATE productoalmacen
           SET ProductoAlmacenStock = ProductoAlmacenStock + ?
           WHERE ProductoId = ? AND AlmacenId = ?`,
          [cantidad, productoId, AlmacenOrigenId]
        );
      }
    }

    // Egreso de caja: TipoGastoId=1, TipoGastoGrupoId=9 (devolución), detalle
    // fijo 'Devolución de producto' (sin número de venta, igual que GeneXus).
    await conn.query(
      `INSERT INTO registrodiariocaja (
         CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId,
         RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId
       ) VALUES (?, ?, 1, 9, 'Devolución de producto', ?, ?)`,
      [CajaId, ventaFecha, total, UsuarioId]
    );

    await conn.query(
      `UPDATE caja SET CajaMonto = CajaMonto - ? WHERE CajaId = ?`,
      [total, CajaId]
    );

    await conn.commit();
    return res.status(201).json({
      success: true,
      message: "Devolución realizada exitosamente",
      data: { Total: total },
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rbErr) {
      console.error("Rollback falló:", rbErr);
    }
    console.error("Error en devolución:", err);
    return res.status(400).json({
      success: false,
      message: err && err.message ? err.message : "Error en devolución",
    });
  } finally {
    conn.release();
  }
};

// Obtener reporte de ventas por cliente y rango de fechas
// clienteId puede ser un ID numérico o "TODOS" para todas las ventas
exports.getReporteVentasPorCliente = async (req, res) => {
  try {
    const { clienteId, fechaDesde, fechaHasta } = req.query;

    const esTodos = String(clienteId).toUpperCase() === "TODOS";
    const esClienteValido = !isNaN(Number(clienteId)) && Number(clienteId) > 0;
    if (!clienteId || (!esTodos && !esClienteValido)) {
      return res.status(400).json({
        success: false,
        message: "Seleccione un cliente o TODOS",
      });
    }

    if (!fechaDesde || !fechaHasta) {
      return res.status(400).json({
        success: false,
        message: "Las fechas desde y hasta son requeridas",
      });
    }

    const reporte = await Venta.getReporteVentasPorCliente(
      clienteId,
      fechaDesde,
      fechaHasta
    );

    res.json({
      success: true,
      data: reporte,
    });
  } catch (error) {
    console.error("Error al obtener reporte de ventas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener reporte de ventas",
    });
  }
};
