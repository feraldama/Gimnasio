const RegistroDiarioCaja = require("../models/registrodiariocaja.model");
const Correccion = require("../models/correccionCaja.model");
const { contexto } = require("../utils/contextoCorreccion");
const { validarMotivo } = require("../utils/correccionCaja");
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

// Editar / eliminar un movimiento. En un turno ya cerrado pide motivo y
// permiso de supervisor (CORRECCIONCAJA), y queda en el historial de
// correcciones; los movimientos de ventas y cobros van por Corrección de caja.
// Reglas en utils/correccionCaja.js (validarCambioRegistro).
async function enTransaccion(fn) {
  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

function motivoDe(req) {
  const crudo = req.body?.motivo;
  if (crudo == null || String(crudo).trim() === "") return { motivo: null };
  return validarMotivo(crudo);
}

function responderErrorCambio(res, error) {
  if (error?.status) {
    return res
      .status(error.status)
      .json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  console.error(error);
  return sendError(res, error, 500);
}

// Actualizar un registro
exports.update = async (req, res) => {
  const m = motivoDe(req);
  if (m.error) return res.status(400).json({ message: m.error });
  try {
    const r = await enTransaccion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      return Correccion.editarRegistroTx(conn, {
        registroId: Number(req.params.id),
        body: req.body || {},
        motivo: m.motivo,
        usuarioId: req.user.id,
        autorizar: ctx.autorizar,
      });
    });
    res.json({
      message: "Registro actualizado exitosamente",
      data: r.registro,
      correccionId: r.correccionId,
    });
  } catch (error) {
    responderErrorCambio(res, error);
  }
};

// Eliminar un registro
exports.delete = async (req, res) => {
  const m = motivoDe(req);
  if (m.error) return res.status(400).json({ message: m.error });
  try {
    const r = await enTransaccion(async (conn) => {
      const ctx = await contexto(conn, req.user);
      return Correccion.eliminarRegistroTx(conn, {
        registroId: Number(req.params.id),
        motivo: m.motivo,
        usuarioId: req.user.id,
        autorizar: ctx.autorizar,
      });
    });
    res.json({ message: "Registro eliminado exitosamente", correccionId: r.correccionId });
  } catch (error) {
    responderErrorCambio(res, error);
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

// Registros del turno actual del usuario logueado (para el resumen de cierre).
// El usuario sale del token, no del query: así no se puede leer el turno ajeno.
exports.turnoActual = async (req, res) => {
  try {
    const cajaId = req.query.cajaId;
    if (!cajaId) {
      return res.status(400).json({ message: "Falta el parámetro cajaId" });
    }
    const data = await RegistroDiarioCaja.getTurnoActualUsuario(
      req.user.id,
      cajaId
    );
    res.json({ data });
  } catch (error) {
    console.error(error);
    sendError(res, error, 500);
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
