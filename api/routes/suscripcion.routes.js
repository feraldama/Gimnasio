const express = require("express");
const router = express.Router();
const suscripcionController = require("../controllers/suscripcion.controller");
const authMiddleware = require("../middlewares/auth");

// Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware);

// Rutas para Suscripcion
router.get(
  "/search",
  authMiddleware,
  suscripcionController.searchSuscripciones
);
router.get(
  "/proximas-a-vencer",
  authMiddleware,
  suscripcionController.getProximasAVencer
);
router.get(
  "/sin-paginacion",
  authMiddleware,
  suscripcionController.getAllSinPaginacion
);
router.get(
  "/cliente/:clienteId",
  authMiddleware,
  suscripcionController.getByClienteId
);
router.get("/", authMiddleware, suscripcionController.getAll);
router.get("/:id", authMiddleware, suscripcionController.getById);
router.post("/", authMiddleware, suscripcionController.create);
router.put("/:id", authMiddleware, suscripcionController.update);
router.delete("/:id", authMiddleware, suscripcionController.delete);

module.exports = router;
