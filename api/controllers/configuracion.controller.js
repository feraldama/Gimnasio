const Configuracion = require("../models/configuracion.model");
const { sendError } = require("../utils/errors");

exports.getAll = async (req, res) => {
  try {
    const rows = await Configuracion.getAll();
    res.json({ data: rows });
  } catch (error) {
    console.error("Error al listar configuracion:", error);
    sendError(res, error, 500);
  }
};

exports.getByClave = async (req, res) => {
  try {
    const row = await Configuracion.getByClave(req.params.clave);
    if (!row) {
      return res.status(404).json({ message: "Configuracion no encontrada" });
    }
    res.json(row);
  } catch (error) {
    console.error("Error al obtener configuracion:", error);
    sendError(res, error, 500);
  }
};

exports.upsert = async (req, res) => {
  try {
    if (!req.body.ConfigClave) {
      return res
        .status(400)
        .json({ success: false, message: "ConfigClave es requerido" });
    }
    const row = await Configuracion.upsert(req.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Error al guardar configuracion:", error);
    sendError(res, error, 500);
  }
};

exports.update = async (req, res) => {
  try {
    const row = await Configuracion.update(req.params.clave, req.body);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Configuracion no encontrada",
      });
    }
    res.json({ success: true, data: row });
  } catch (error) {
    console.error("Error al actualizar configuracion:", error);
    sendError(res, error, 500);
  }
};

exports.remove = async (req, res) => {
  try {
    const deleted = await Configuracion.delete(req.params.clave);
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Configuracion no encontrada" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error al eliminar configuracion:", error);
    sendError(res, error, 500);
  }
};
