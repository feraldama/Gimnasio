const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaCredito.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

// Cobro de créditos de cancha es parte del flujo COBROCREDITO (mismo recurso
// que cobranza de ventas de cantina, ya que viven en la misma pantalla).
router.get(
  "/cliente/:clienteId",
  authMiddleware,
  requirePerm("COBROCREDITO", "leer"),
  ctrl.listarPendientesPorCliente
);
router.post(
  "/:id/cobrar",
  authMiddleware,
  requirePerm("COBROCREDITO", "crear"),
  ctrl.cobrarCredito
);

module.exports = router;
