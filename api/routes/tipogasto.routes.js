const express = require("express");
const router = express.Router();
const tipogastoController = require("../controllers/tipogasto.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const { LECTORES_TIPOGASTO } = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/search",
  requireAnyPerm(LECTORES_TIPOGASTO, "leer"),
  tipogastoController.searchTipoGastos
);
router.get("/", requireAnyPerm(LECTORES_TIPOGASTO, "leer"), tipogastoController.getAll);
router.get(
  "/paginated",
  requireAnyPerm(LECTORES_TIPOGASTO, "leer"),
  tipogastoController.getAllPaginated
);
router.get(
  "/:id",
  requireAnyPerm(LECTORES_TIPOGASTO, "leer"),
  tipogastoController.getById
);
router.post("/", requirePerm("TIPOSGASTO", "crear"), tipogastoController.create);
router.put(
  "/:id",
  requirePerm("TIPOSGASTO", "editar"),
  tipogastoController.update
);
router.delete(
  "/:id",
  requirePerm("TIPOSGASTO", "eliminar"),
  tipogastoController.delete
);

module.exports = router;
