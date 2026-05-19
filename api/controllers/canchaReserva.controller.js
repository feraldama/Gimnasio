const CanchaReserva = require("../models/canchaReserva.model");
const { sendError } = require("../utils/errors");

exports.getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "CanchaReservaFecha";
    const sortOrder = req.query.sortOrder || "DESC";
    const { reservas, total } = await CanchaReserva.getAllPaginated(
      limit,
      offset,
      sortBy,
      sortOrder
    );
    res.json({
      data: reservas,
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

exports.search = async (req, res) => {
  try {
    const { q: term } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    if (!term || term.trim() === "")
      return res
        .status(400)
        .json({ error: "El termino de busqueda no puede estar vacio" });
    const { reservas, total } = await CanchaReserva.search(term, limit, offset);
    res.json({
      data: reservas,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getByFecha = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha)
      return res.status(400).json({ error: "El parametro fecha es requerido" });
    const reservas = await CanchaReserva.getByFecha(fecha);
    res.json({ data: reservas });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const r = await CanchaReserva.getById(req.params.id);
    if (!r) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json(r);
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.create = async (req, res) => {
  try {
    const required = [
      "CanchaId",
      "CanchaReservaFecha",
      "CanchaReservaHoraInicio",
      "CanchaReservaHoraFin",
    ];
    for (const f of required) {
      if (req.body[f] === undefined || req.body[f] === null || req.body[f] === "")
        return res
          .status(400)
          .json({ success: false, message: `${f} es requerido` });
    }
    const reserva = await CanchaReserva.create({
      ...req.body,
      UsuarioId: req.body.UsuarioId || req.user?.UsuarioId || null,
    });
    res.status(201).json({ success: true, data: reserva });
  } catch (e) {
    console.error("Error al crear reserva cancha:", e);
    sendError(res, e, 500);
  }
};

exports.update = async (req, res) => {
  try {
    const r = await CanchaReserva.update(req.params.id, req.body);
    if (!r) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json({ success: true, data: r });
  } catch (e) {
    sendError(res, e, 500);
  }
};

exports.remove = async (req, res) => {
  try {
    const ok = await CanchaReserva.delete(req.params.id);
    if (!ok) return res.status(404).json({ message: "Reserva no encontrada" });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e, 500);
  }
};
