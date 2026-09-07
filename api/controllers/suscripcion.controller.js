const Suscripcion = require("../models/suscripcion.model");
const { sendError } = require("../utils/errors");

exports.getAll = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  const sortBy = req.query.sortBy || "SuscripcionId";
  const sortOrder = req.query.sortOrder || "ASC";
  const filters = {
    estado: req.query.estado || undefined,
    pago: req.query.pago || undefined,
  };
  try {
    const result = await Suscripcion.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder,
      filters
    );
    res.json({
      data: result.suscripciones,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    sendError(res, error, 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const suscripcion = await Suscripcion.getById(req.params.id);
    if (!suscripcion) {
      return res.status(404).json({ message: "Suscripción no encontrada" });
    }
    res.json(suscripcion);
  } catch (error) {
    sendError(res, error, 500);
  }
};

exports.create = async (req, res) => {
  try {
    const suscripcion = await Suscripcion.create(req.body);
    res
      .status(201)
      .json({ message: "Suscripción creada exitosamente", data: suscripcion });
  } catch (error) {
    sendError(res, error, 400);
  }
};

exports.update = async (req, res) => {
  try {
    const suscripcion = await Suscripcion.update(req.params.id, req.body);
    if (!suscripcion) {
      return res.status(404).json({ message: "Suscripción no encontrada" });
    }
    res.json({
      message: "Suscripción actualizada exitosamente",
      data: suscripcion,
    });
  } catch (error) {
    sendError(res, error, 400);
  }
};

exports.delete = async (req, res) => {
  try {
    const success = await Suscripcion.delete(req.params.id);
    if (!success) {
      return res.status(404).json({ message: "Suscripción no encontrada" });
    }
    res.json({ message: "Suscripción eliminada exitosamente" });
  } catch (error) {
    if (
      error &&
      error.message &&
      error.message.includes("a foreign key constraint fails")
    ) {
      return res.status(400).json({
        message:
          "No se puede eliminar la suscripción porque tiene registros asociados.",
      });
    }
    sendError(res, error, 500);
  }
};

exports.searchSuscripciones = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "SuscripcionId";
    const sortOrder = req.query.sortOrder || "ASC";
    const filters = {
      estado: req.query.estado || undefined,
      pago: req.query.pago || undefined,
    };

    if (!searchTerm || searchTerm.trim() === "") {
      return res
        .status(400)
        .json({ error: "El término de búsqueda no puede estar vacío" });
    }

    const result = await Suscripcion.searchSuscripciones(
      searchTerm,
      limit,
      offset,
      sortBy,
      sortOrder,
      filters
    );

    res.json({
      data: result.suscripciones,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al buscar suscripciones" });
  }
};

exports.getAllSinPaginacion = async (req, res) => {
  try {
    const suscripciones = await Suscripcion.getAll();
    res.json({ data: suscripciones });
  } catch (error) {
    sendError(res, error, 500);
  }
};

exports.getByClienteId = async (req, res) => {
  try {
    const suscripciones = await Suscripcion.getByClienteId(req.params.clienteId);
    res.json({ data: suscripciones });
  } catch (error) {
    sendError(res, error, 500);
  }
};

// Lista de trabajo de vencimientos. Ver el comentario de
// `Suscripcion.getProximasAVencer` para qué entra y por qué.
exports.getProximasAVencer = async (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 30;
    const limitParam = req.query.limit;
    const limit =
      limitParam !== undefined && limitParam !== ""
        ? parseInt(limitParam)
        : null;
    // Umbral de clases restantes para que un plan por CLASES entre en la
    // lista. Default 2: con dos clases o menos, el socio se queda sin acceso
    // esta semana.
    const clasesMinParam = parseInt(req.query.clasesMin, 10);
    const clasesMin = Number.isFinite(clasesMinParam) && clasesMinParam >= 0
      ? clasesMinParam
      : 2;
    // Cuántos días de vencidos siguen en la lista. Default 7 para no cambiar
    // el widget del Dashboard; la pantalla de vencimientos pide 30, porque el
    // socio que venció hace dos semanas es el llamado más recuperable.
    const dvParam = parseInt(req.query.diasVencidos, 10);
    const diasVencidos =
      Number.isFinite(dvParam) && dvParam >= 0 ? dvParam : 7;
    const suscripciones = await Suscripcion.getProximasAVencer(
      dias,
      limit,
      clasesMin,
      diasVencidos
    );
    res.json({ data: suscripciones, dias, clasesMin, diasVencidos });
  } catch (error) {
    sendError(res, error, 500);
  }
};
