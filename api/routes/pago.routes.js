const express = require("express");
const router = express.Router();
const pagoController = require("../controllers/pago.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

// authMiddleware ya está aplicado globalmente con `router.use`. Cada route
// arriba agrega `requirePerm("PAGOS", accion)` con la acción que corresponde
// al método HTTP. Reporte de cobranza tiene su propio recurso.
router.use(authMiddleware);

router.get("/search", requirePerm("PAGOS", "leer"), pagoController.searchPagos);
router.get(
  "/reporte",
  requirePerm("REPORTECOBRANZA", "leer"),
  pagoController.getReporte
);
router.get(
  "/cliente/:clienteId",
  requirePerm("PAGOS", "leer"),
  pagoController.getByClienteId
);
router.get("/", requirePerm("PAGOS", "leer"), pagoController.getAll);
router.get("/:id", requirePerm("PAGOS", "leer"), pagoController.getById);
router.post("/lote", requirePerm("PAGOS", "crear"), pagoController.createLote);
router.post("/", requirePerm("PAGOS", "crear"), pagoController.create);
router.put("/:id", requirePerm("PAGOS", "editar"), pagoController.update);
router.delete("/:id", requirePerm("PAGOS", "eliminar"), pagoController.delete);

module.exports = router;
