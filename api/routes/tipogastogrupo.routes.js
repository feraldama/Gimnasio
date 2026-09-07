const express = require("express");
const router = express.Router();
const tipogastoGrupoController = require("../controllers/tipogastogrupo.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const { LECTORES_TIPOGASTO } = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/",
  requireAnyPerm(LECTORES_TIPOGASTO, "leer"),
  tipogastoGrupoController.getAll
);
router.get(
  "/by-tipo/:tipoGastoId",
  requireAnyPerm(LECTORES_TIPOGASTO, "leer"),
  tipogastoGrupoController.getByTipoGastoId
);
router.get(
  "/:id",
  requireAnyPerm(LECTORES_TIPOGASTO, "leer"),
  tipogastoGrupoController.getById
);
router.post(
  "/",
  requirePerm("TIPOSGASTO", "crear"),
  tipogastoGrupoController.create
);
router.put(
  "/:tipoGastoId/:grupoId",
  requirePerm("TIPOSGASTO", "editar"),
  tipogastoGrupoController.update
);
router.delete(
  "/:tipoGastoId/:grupoId",
  requirePerm("TIPOSGASTO", "eliminar"),
  tipogastoGrupoController.delete
);

module.exports = router;
