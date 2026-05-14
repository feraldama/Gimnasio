const Venta = require("../models/venta.model");
const { sendError } = require("../utils/errors");

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

exports.delete = async (req, res) => {
  try {
    const success = await Venta.delete(req.params.id);
    if (!success) {
      return res.status(404).json({ message: "Venta no encontrada" });
    }
    res.json({ message: "Venta eliminada exitosamente" });
  } catch (error) {
    console.error(error);
    if (
      error &&
      error.message &&
      error.message.includes("a foreign key constraint fails")
    ) {
      return res.status(400).json({
        message:
          "No se puede eliminar la venta porque tiene registros asociados.",
      });
    }
    sendError(res, error, 500);
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
