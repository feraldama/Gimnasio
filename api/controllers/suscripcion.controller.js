const Suscripcion = require("../models/suscripcion.model");

exports.getAll = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  const sortBy = req.query.sortBy || "SuscripcionId";
  const sortOrder = req.query.sortOrder || "ASC";
  try {
    const result = await Suscripcion.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const suscripcion = await Suscripcion.create(req.body);
    res
      .status(201)
      .json({ message: "Suscripción creada exitosamente", data: suscripcion });
  } catch (error) {
    res.status(400).json({ message: error.message });
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
    res.status(400).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
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
      sortOrder
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
    res.status(500).json({ message: error.message });
  }
};

exports.getByClienteId = async (req, res) => {
  try {
    const suscripciones = await Suscripcion.getByClienteId(req.params.clienteId);
    res.json({ data: suscripciones });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getProximasAVencer = async (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 30;
    const limitParam = req.query.limit;
    const limit =
      limitParam !== undefined && limitParam !== ""
        ? parseInt(limitParam)
        : null;
    const suscripciones = await Suscripcion.getProximasAVencer(dias, limit);
    res.json({ data: suscripciones });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
