const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaTarifa.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.get(
  "/cancha/:canchaId",
  authMiddleware,
  requirePerm("CANCHATARIFA", "leer"),
  ctrl.listByCancha
);
router.get(
  "/:id",
  authMiddleware,
  requirePerm("CANCHATARIFA", "leer"),
  ctrl.getById
);
router.post(
  "/",
  authMiddleware,
  requirePerm("CANCHATARIFA", "crear"),
  ctrl.create
);
// "sugerir-monto" lo invoca el modal de Reserva — un operador que sólo
// puede crear reservas (CANCHA:crear) debería poder usarlo aunque no tenga
// acceso a Tarifas. Por eso usamos el recurso CANCHA en lugar de CANCHATARIFA.
router.post(
  "/sugerir-monto",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.sugerirMonto
);
router.put(
  "/:id",
  authMiddleware,
  requirePerm("CANCHATARIFA", "editar"),
  ctrl.update
);
router.delete(
  "/:id",
  authMiddleware,
  requirePerm("CANCHATARIFA", "eliminar"),
  ctrl.remove
);

module.exports = router;
