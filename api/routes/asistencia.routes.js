const express = require("express");
const router = express.Router();
const asistenciaController = require("../controllers/asistencia.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

router.get(
  "/estado/:clienteId",
  requirePerm("ASISTENCIA", "leer"),
  asistenciaController.estadoAcceso
);
router.get(
  "/ranking",
  requirePerm("ASISTENCIA", "leer"),
  asistenciaController.ranking
);
router.get(
  "/cliente/:clienteId",
  requirePerm("ASISTENCIA", "leer"),
  asistenciaController.porCliente
);
router.get("/", requirePerm("ASISTENCIA", "leer"), asistenciaController.listar);
router.post(
  "/",
  requirePerm("ASISTENCIA", "crear"),
  asistenciaController.registrar
);
// Kiosko es la pantalla pública del lector de CI. Usa su propio recurso
// KIOSKOASISTENCIA porque debería poder operar con un perfil mínimo
// (sólo registrar entradas, sin acceso al resto del sistema).
router.post(
  "/kiosko",
  requirePerm("KIOSKOASISTENCIA", "leer"),
  asistenciaController.kiosko
);

module.exports = router;
