const Plan = require("../models/plan.model");

// Reglas mínimas de coherencia para los campos del plan según su modalidad.
// Sin estas validaciones, una mala carga (OPEN con duración 0, CLASES con
// cupo 0) genera suscripciones que vencen el mismo día o no permiten ingresar.
// Devuelve un mensaje de error o null si todo está OK.
function validarPlan(body) {
  const modalidad = body.PlanModalidad || "MENSUAL";
  const duracion = Number(body.PlanDuracion);
  const precio = Number(body.PlanPrecio);
  const cupo = Number(body.PlanCantidadClases);

  if (modalidad === "MENSUAL" || modalidad === "OPEN") {
    if (!Number.isFinite(duracion) || duracion <= 0) {
      return `Para modalidad ${modalidad === "OPEN" ? "Pase libre" : "Mensual"} la duración debe ser mayor a cero (en días).`;
    }
  }
  if (modalidad === "CLASES") {
    if (!Number.isFinite(cupo) || cupo <= 0) {
      return "Para modalidad por clases, la cantidad de clases (cupo) debe ser mayor a cero.";
    }
    if (!Number.isFinite(duracion) || duracion <= 0) {
      return "Para modalidad por clases, la duración (en días) debe ser mayor a cero.";
    }
  }
  // El precio puede ser 0 (cortesía, demo) salvo que sea negativo.
  if (Number.isFinite(precio) && precio < 0) {
    return "El precio no puede ser negativo.";
  }
  return null;
}

exports.getAll = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  const sortBy = req.query.sortBy || "PlanId";
  const sortOrder = req.query.sortOrder || "ASC";
  try {
    const result = await Plan.getAllPaginated(limit, offset, sortBy, sortOrder);
    res.json({
      data: result.planes,
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
    const plan = await Plan.getById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: "Plan no encontrado" });
    }
    res.json(plan);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const error = validarPlan(req.body);
    if (error) return res.status(400).json({ message: error });
    const plan = await Plan.create(req.body);
    res.status(201).json({ message: "Plan creado exitosamente", data: plan });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const error = validarPlan(req.body);
    if (error) return res.status(400).json({ message: error });
    const plan = await Plan.update(req.params.id, req.body);
    if (!plan) {
      return res.status(404).json({ message: "Plan no encontrado" });
    }
    res.json({ message: "Plan actualizado exitosamente", data: plan });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const success = await Plan.delete(req.params.id);
    if (!success) {
      return res.status(404).json({ message: "Plan no encontrado" });
    }
    res.json({ message: "Plan eliminado exitosamente" });
  } catch (error) {
    if (
      error &&
      error.message &&
      error.message.includes("a foreign key constraint fails")
    ) {
      return res.status(400).json({
        message:
          "No se puede eliminar el plan porque tiene registros asociados.",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.searchPlanes = async (req, res) => {
  try {
    const { q: searchTerm } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "PlanId";
    const sortOrder = req.query.sortOrder || "ASC";

    if (!searchTerm || searchTerm.trim() === "") {
      return res
        .status(400)
        .json({ error: "El término de búsqueda no puede estar vacío" });
    }

    const result = await Plan.searchPlanes(
      searchTerm,
      limit,
      offset,
      sortBy,
      sortOrder
    );

    res.json({
      data: result.planes,
      pagination: {
        totalItems: result.total,
        totalPages: Math.ceil(result.total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Error al buscar planes" });
  }
};
