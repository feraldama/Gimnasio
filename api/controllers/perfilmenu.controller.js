const PerfilMenu = require("../models/perfilmenu.model");
const { sendError } = require("../utils/errors");

exports.getByPerfil = async (req, res) => {
  try {
    const permisos = await PerfilMenu.getByPerfil(req.params.perfilId);
    res.json(permisos);
  } catch (err) {
    sendError(res, err, 500);
  }
};

exports.getPermisosByUsuarioId = async (req, res) => {
  try {
    const permisos = await PerfilMenu.getPermisosByUsuarioId(
      req.params.usuarioId
    );
    res.json(permisos);
  } catch (err) {
    sendError(res, err, 500);
  }
};

exports.create = async (req, res) => {
  try {
    const permiso = await PerfilMenu.create(req.body);
    res.status(201).json(permiso);
  } catch (err) {
    sendError(res, err, 500);
  }
};

exports.update = async (req, res) => {
  try {
    await PerfilMenu.update(req.params.perfilId, req.params.menuId, req.body);
    res.json({ message: "Permiso actualizado" });
  } catch (err) {
    sendError(res, err, 500);
  }
};

exports.delete = async (req, res) => {
  try {
    await PerfilMenu.delete(req.params.perfilId, req.params.menuId);
    res.json({ message: "Permiso eliminado" });
  } catch (err) {
    sendError(res, err, 500);
  }
};
