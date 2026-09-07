const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/tablero.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

// Recurso propio (no REPORTES): el tablero muestra egresos y el resultado del
// negocio, que no todo perfil con acceso a reportes operativos debería ver.
// El menú se registra en la migración 018.
router.get(
  "/mensual",
  requirePerm("TABLEROMENSUAL", "leer"),
  ctrl.tableroMensual
);
router.get(
  "/crecimiento",
  requirePerm("TABLEROMENSUAL", "leer"),
  ctrl.crecimientoSocios
);

module.exports = router;
