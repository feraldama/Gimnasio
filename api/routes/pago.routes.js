const express = require("express");
const router = express.Router();
const pagoController = require("../controllers/pago.controller");
const authMiddleware = require("../middlewares/auth");

// Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware);

// Rutas para Pago
router.get("/search", authMiddleware, pagoController.searchPagos);
router.get("/reporte", authMiddleware, pagoController.getReporte);
router.get(
  "/cliente/:clienteId",
  authMiddleware,
  pagoController.getByClienteId
);
router.get("/", authMiddleware, pagoController.getAll);
router.get("/:id", authMiddleware, pagoController.getById);
router.post("/lote", authMiddleware, pagoController.createLote);
router.post("/", authMiddleware, pagoController.create);
router.put("/:id", authMiddleware, pagoController.update);
router.delete("/:id", authMiddleware, pagoController.delete);

module.exports = router;
