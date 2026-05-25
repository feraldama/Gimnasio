const express = require("express");
const router = express.Router();
const suscripcionController = require("../controllers/suscripcion.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

router.get(
  "/search",
  requirePerm("SUSCRIPCIONES", "leer"),
  suscripcionController.searchSuscripciones
);
router.get(
  "/proximas-a-vencer",
  requirePerm("SUSCRIPCIONES", "leer"),
  suscripcionController.getProximasAVencer
);
router.get(
  "/sin-paginacion",
  requirePerm("SUSCRIPCIONES", "leer"),
  suscripcionController.getAllSinPaginacion
);
router.get(
  "/cliente/:clienteId",
  requirePerm("SUSCRIPCIONES", "leer"),
  suscripcionController.getByClienteId
);
router.get("/", requirePerm("SUSCRIPCIONES", "leer"), suscripcionController.getAll);
router.get("/:id", requirePerm("SUSCRIPCIONES", "leer"), suscripcionController.getById);
router.post("/", requirePerm("SUSCRIPCIONES", "crear"), suscripcionController.create);
router.put("/:id", requirePerm("SUSCRIPCIONES", "editar"), suscripcionController.update);
router.delete(
  "/:id",
  requirePerm("SUSCRIPCIONES", "eliminar"),
  suscripcionController.delete
);

module.exports = router;
