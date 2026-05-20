const Cancha = require("../models/cancha.model");
const { sendError } = require("../utils/errors");

exports.getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "CanchaId";
    const sortOrder = req.query.sortOrder || "ASC";
    const { canchas, total } = await Cancha.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder
    );
    res.json({
      data: canchas,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error("Error en getAll cancha:", error);
    sendError(res, error, 500);
  }
};

exports.getActivas = async (req, res) => {
  try {
    const canchas = await Cancha.getActivas();
    res.json({ data: canchas });
  } catch (error) {
    sendError(res, error, 500);
  }
};

exports.search = async (req, res) => {
  try {
    const { q: term } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    if (!term || term.trim() === "")
      return res
        .status(400)
        .json({ error: "El termino de busqueda no puede estar vacio" });
    const { canchas, total } = await Cancha.search(term, limit, offset);
    res.json({
      data: canchas,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
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
    const c = await Cancha.getById(req.params.id);
    if (!c) return res.status(404).json({ message: "Cancha no encontrada" });
    res.json(c);
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.create = async (req, res) => {
  try {
    if (!req.body.CanchaNombre)
      return res
        .status(400)
        .json({ success: false, message: "CanchaNombre es requerido" });
    const c = await Cancha.create(req.body);
    res.status(201).json({ success: true, data: c });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.update = async (req, res) => {
  try {
    const c = await Cancha.update(req.params.id, req.body);
    if (!c) return res.status(404).json({ message: "Cancha no encontrada" });
    res.json({ success: true, data: c });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.remove = async (req, res) => {
  try {
    // Si la cancha tiene reservas asociadas, bloqueamos el delete con 409 y
    // mandamos la cuenta para que el frontend ofrezca desactivar como
    // alternativa (no perder historial de reservas).
    const reservasCount = await Cancha.countReservas(req.params.id);
    if (reservasCount > 0) {
      return res.status(409).json({
        success: false,
        code: "TIENE_RESERVAS",
        message: `La cancha tiene ${reservasCount} reserva${
          reservasCount === 1 ? "" : "s"
        } asociada${reservasCount === 1 ? "" : "s"}. No se puede eliminar.`,
        reservasCount,
      });
    }
    const ok = await Cancha.delete(req.params.id);
    if (!ok) return res.status(404).json({ message: "Cancha no encontrada" });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e, 500);
  }
};
