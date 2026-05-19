const express = require("express");
const router = express.Router();
const asistenciaController = require("../controllers/asistencia.controller");
const authMiddleware = require("../middlewares/auth");

router.use(authMiddleware);

router.get(
  "/estado/:clienteId",
  authMiddleware,
  asistenciaController.estadoAcceso
);
router.get("/ranking", authMiddleware, asistenciaController.ranking);
router.get(
  "/cliente/:clienteId",
  authMiddleware,
  asistenciaController.porCliente
);
router.get("/", authMiddleware, asistenciaController.listar);
router.post("/", authMiddleware, asistenciaController.registrar);
router.post("/kiosko", authMiddleware, asistenciaController.kiosko);

module.exports = router;
