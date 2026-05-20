const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaCredito.controller");
const authMiddleware = require("../middlewares/auth");

// Lista créditos pendientes (saldo > 0) de un cliente.
router.get("/cliente/:clienteId", authMiddleware, ctrl.listarPendientesPorCliente);

// Cobra contra un crédito de cancha existente. Body: { pagos: [{tipo, monto}] }.
router.post("/:id/cobrar", authMiddleware, ctrl.cobrarCredito);

module.exports = router;
