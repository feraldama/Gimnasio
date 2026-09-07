const RegistroDiarioCaja = require("../models/registrodiariocaja.model");
const { sendError } = require("../utils/errors");
const {
  evaluarAperturaCierre,
  esSolicitudDeApertura,
} = require("../utils/cajaApertura");
const db = require("../config/db");

function extractRegistroFilters(query) {
  const filters = {};
  if (query.cajaId !== undefined && query.cajaId !== "")
    filters.cajaId = query.cajaId;
  if (query.tipoGastoId !== undefined && query.tipoGastoId !== "")
    filters.tipoGastoId = query.tipoGastoId;
  if (query.fechaDesde) filters.fechaDesde = query.fechaDesde;
  if (query.fechaHasta) filters.fechaHasta = query.fechaHasta;
  if (query.montoMin !== undefined && query.montoMin !== "")
    filters.montoMin = query.montoMin;
  if (query.montoMax !== undefined && query.montoMax !== "")
    filters.montoMax = query.montoMax;
  return filters;
}

// Obtener todos los registros con paginación
exports.getAll = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  const sortBy = req.query.sortBy || "RegistroDiarioCajaFecha";
  const sortOrder = req.query.sortOrder || "DESC";
  const filters = extractRegistroFilters(req.query);
  try {
    const result = await RegistroDiarioCaja.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder,
      filters
    );
    res.json(result);
  } catch (error) {
    console.error("Error al obtener registros:", error);
    sendError(res, error, 500);
  }
};

// Buscar registros
exports.search = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "RegistroDiarioCajaFecha";
    const sortOrder = req.query.sortOrder || "DESC";

    if (!searchTerm || searchTerm.trim() === "") {
      return res
        .status(400)
        .json({ error: "El término de búsqueda no puede estar vacío" });
    }

    const filters = extractRegistroFilters(req.query);

    const result = await RegistroDiarioCaja.search(
      searchTerm,
      limit,
      offset,
      sortBy,
      sortOrder,
      filters
    );

    res.json(result);
  } catch (error) {
    console.error("Error en búsqueda de registros:", error);
    res.status(500).json({ error: "Error al buscar registros" });
  }
};

// Obtener registros por rango de fechas (para reportes de cierre)
// Usa solo la parte DATE para evitar desfases por zona horaria; incluye un día antes y después del rango
exports.getByDateRange = async (req, res) => {
  try {
    const fechaDesde = req.query.fechaDesde;
    const fechaHasta = req.query.fechaHasta;
    const limit = parseInt(req.query.limit) || 10000;
    if (!fechaDesde || !fechaHasta) {
      return res.status(400).json({
        message: "Se requieren los parámetros fechaDesde y fechaHasta (YYYY-MM-DD)",
      });
    }
    const desde = new Date(fechaDesde + "T00:00:00");
    desde.setDate(desde.getDate() - 1);
    const hasta = new Date(fechaHasta + "T00:00:00");
    hasta.setDate(hasta.getDate() + 1);
    const fechaDesdeStr =
      desde.getFullYear() +
      "-" +
      String(desde.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(desde.getDate()).padStart(2, "0");
    const fechaHastaStr =
      hasta.getFullYear() +
      "-" +
      String(hasta.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(hasta.getDate()).padStart(2, "0");
    const data = await RegistroDiarioCaja.getByDateRange(
      fechaDesdeStr,
      fechaHastaStr,
      limit
    );
    res.json({ data });
  } catch (error) {
    console.error("Error al obtener registros por rango:", error);
    sendError(res, error, 500);
  }
};

// Obtener un registro por ID
exports.getById = async (req, res) => {
  try {
    const registro = await RegistroDiarioCaja.getById(req.params.id);
    if (!registro) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }
    res.json(registro);
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};

// Crear un nuevo registro
exports.create = async (req, res) => {
  try {
    const registro = await RegistroDiarioCaja.create({
      ...req.body,
      UsuarioId: req.user.id, // Asumiendo que tienes el usuario en req.user
    });
    res.status(201).json({
      message: "Registro creado exitosamente",
      data: registro,
    });
  } catch (error) {
    console.error(error);
    sendError(res, error, 400);
  }
};

// Actualizar un registro
exports.update = async (req, res) => {
  try {
    const registro = await RegistroDiarioCaja.update(req.params.id, req.body);
    if (!registro) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }
    res.json({
      message: "Registro actualizado exitosamente",
      data: registro,
    });
  } catch (error) {
    console.error(error);
    sendError(res, error, 400);
  }
};

// Eliminar un registro
exports.delete = async (req, res) => {
  try {
    const success = await RegistroDiarioCaja.delete(req.params.id);
    if (!success) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }
    res.json({ message: "Registro eliminado exitosamente" });
  } catch (error) {
    console.error(error);
    if (
      error &&
      error.message &&
      error.message.includes("a foreign key constraint fails")
    ) {
      return res.status(400).json({
        message:
          "No se puede eliminar el registro porque tiene movimientos asociados.",
      });
    }
    sendError(res, error, 500);
  }
};

exports.aperturaCierreCaja = async (req, res) => {
  try {
    const { apertura, CajaId, Monto } = req.body;
    const UsuarioId = req.user?.id || req.body.UsuarioId;
    if (
      !CajaId ||
      typeof apertura === "undefined" ||
      typeof Monto === "undefined" ||
      !UsuarioId
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Faltan datos requeridos" });
    }

    // Convención heredada: `apertura === 0` significa APERTURA.
    const esApertura = esSolicitudDeApertura(apertura);

    // El estado de la caja se deduce comparando los ids de la última apertura
    // y el último cierre (ver utils/cajaApertura.js).
    const aperturaReg = await RegistroDiarioCaja.getUltimaApertura(CajaId);
    const cierreReg = await RegistroDiarioCaja.getUltimoCierre(CajaId);
    const { permitido, error } = evaluarAperturaCierre({
      esApertura,
      aperturaId: aperturaReg ? aperturaReg.RegistroDiarioCajaId : 0,
      cierreId: cierreReg ? cierreReg.RegistroDiarioCajaId : 0,
    });
    if (!permitido) {
      return res.status(400).json({ success: false, message: error });
    }

    const [caja] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM Caja WHERE CajaId = ?",
        [CajaId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });

    // Registro + movimiento del monto en una sola transacción. Ver el
    // comentario de `aperturaCierreTransaccional`: hacerlo en dos pasos
    // sueltos podía dejar el cajón en cero sin registro de cierre.
    await RegistroDiarioCaja.aperturaCierreTransaccional({
      esApertura,
      cajaId: CajaId,
      monto: Monto,
      usuarioId: UsuarioId,
      cajaDescripcion: caja ? caja.CajaDescripcion : "",
    });

    return res.json({
      success: true,
      message: esApertura
        ? "Apertura realizada correctamente"
        : "Cierre realizado correctamente",
    });
  } catch (error) {
    console.error("Error en apertura/cierre de caja:", error);
    res.status(500).json({
      success: false,
      message: "Error en el servidor",
    });
  }
};

// Nuevo endpoint para saber si el usuario tiene caja aperturada
exports.estadoAperturaPorUsuario = async (req, res) => {
  try {
    const usuarioId = req.query.usuarioId;
    if (!usuarioId) {
      return res.status(400).json({ message: "Falta el parámetro usuarioId" });
    }
    const estado = await RegistroDiarioCaja.getEstadoAperturaPorUsuario(
      usuarioId
    );
    res.json(estado);
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
  }
};
