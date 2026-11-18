const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/movimientosDia.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

// Consulta de ventas y cobros del día (solo lectura). El alcance (hoy + local
// propio, salvo admin) lo fija el controlador.
router.get("/", requirePerm("MOVIMIENTOSDIA", "leer"), ctrl.getDelDia);

module.exports = router;
