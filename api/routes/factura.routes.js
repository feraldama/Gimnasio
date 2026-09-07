const express = require("express");
const router = express.Router();
const facturaController = require("../controllers/factura.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

// Timbrados y rangos de facturación: sólo la pantalla de Facturas los consume
// (el POS recibe el timbrado ya resuelto en el registro de la venta).
router.use(authMiddleware);

router.get(
  "/",
  requirePerm("FACTURAS", "leer"),
  facturaController.getAllFacturas
);
router.get(
  "/all",
  requirePerm("FACTURAS", "leer"),
  facturaController.getAllFacturasSinPaginacion
);
router.get(
  "/search",
  requirePerm("FACTURAS", "leer"),
  facturaController.searchFacturas
);
// Rutas específicas antes de "/:id" para que no las capture el parámetro.
router.get(
  "/next-number",
  requirePerm("FACTURAS", "leer"),
  facturaController.getNextAvailableNumber
);
router.get(
  "/current/:numeroFactura",
  requirePerm("FACTURAS", "leer"),
  facturaController.getCurrentFactura
);
router.get(
  "/:id",
  requirePerm("FACTURAS", "leer"),
  facturaController.getFacturaById
);
router.post(
  "/",
  requirePerm("FACTURAS", "crear"),
  facturaController.createFactura
);
router.put(
  "/:id",
  requirePerm("FACTURAS", "editar"),
  facturaController.updateFactura
);
router.delete(
  "/:id",
  requirePerm("FACTURAS", "eliminar"),
  facturaController.deleteFactura
);

module.exports = router;
