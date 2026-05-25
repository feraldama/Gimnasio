const express = require("express");
const router = express.Router();
const ventaController = require("../controllers/venta.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

// Listados / lectura
router.get(
  "/pendientes/:clienteId",
  requirePerm("VENTAS", "leer"),
  ventaController.getVentasPendientesPorCliente
);
router.get(
  "/pendientes",
  requirePerm("VENTAS", "leer"),
  ventaController.getDeudasPendientesPorCliente
);
router.get(
  "/reporte",
  requirePerm("VENTAS", "leer"),
  ventaController.getReporteVentasPorCliente
);
router.get("/search", requirePerm("VENTAS", "leer"), ventaController.searchVentas);
router.get("/", requirePerm("VENTAS", "leer"), ventaController.getAll);
router.get(
  "/paginated",
  requirePerm("VENTAS", "leer"),
  ventaController.getAllPaginated
);
router.get("/:id", requirePerm("VENTAS", "leer"), ventaController.getById);

// Operaciones del POS: confirmar = crear venta nueva; devolución = revierte
// (semánticamente "eliminar" la venta original aunque se haga vía endpoint
// dedicado).
router.post(
  "/confirmar",
  requirePerm("NUEVAVENTA", "leer"),
  ventaController.confirmar
);
router.post(
  "/devolucion",
  requirePerm("VENTAS", "eliminar"),
  ventaController.devolucion
);

// CRUD genérico (poco usado, lo dejamos por compat)
router.post("/", requirePerm("VENTAS", "crear"), ventaController.create);
router.put("/:id", requirePerm("VENTAS", "editar"), ventaController.update);
router.delete("/:id", requirePerm("VENTAS", "eliminar"), ventaController.delete);

module.exports = router;
