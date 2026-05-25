const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaReserva.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.get("/", authMiddleware, requirePerm("CANCHA", "leer"), ctrl.getAll);
router.get(
  "/search",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.search
);
router.get(
  "/by-fecha",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.getByFecha
);
router.get(
  "/by-rango",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.getByRango
);
router.get("/:id", authMiddleware, requirePerm("CANCHA", "leer"), ctrl.getById);
router.post("/", authMiddleware, requirePerm("CANCHA", "crear"), ctrl.create);
// Reserva recurrente: genera N reservas semanales con el mismo horario.
// Mismo permiso que crear individual.
router.post(
  "/recurrente",
  authMiddleware,
  requirePerm("CANCHA", "crear"),
  ctrl.crearRecurrente
);
// Listar y cancelar serie completa. Cancelar marca como X las R; las P quedan
// (anularlas requiere anular-cobro individual).
router.get(
  "/serie/:serieId",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.listarSerie
);
router.post(
  "/serie/:serieId/cancelar",
  authMiddleware,
  requirePerm("CANCHA", "eliminar"),
  ctrl.cancelarSerie
);
// Cobrar = registrar un cobro contra la reserva; mismo permiso que cobrar
// suscripciones (PAGOS:crear) parece menos natural — usamos CANCHA:editar
// porque cobrar muta la reserva (estado → P, monto, deuda).
router.post(
  "/:id/cobrar",
  authMiddleware,
  requirePerm("CANCHA", "editar"),
  ctrl.cobrar
);
// Anular cobro requiere "eliminar" porque es la operación de reversión
// (borra movimientos en caja + crédito asociado). Si querés que el operador
// que cobra también pueda anular, sus permisos deberían incluir "eliminar".
router.post(
  "/:id/anular-cobro",
  authMiddleware,
  requirePerm("CANCHA", "eliminar"),
  ctrl.anularCobro
);
router.put("/:id", authMiddleware, requirePerm("CANCHA", "editar"), ctrl.update);
router.delete(
  "/:id",
  authMiddleware,
  requirePerm("CANCHA", "eliminar"),
  ctrl.remove
);

module.exports = router;
