const express = require("express");
const router = express.Router();
const productoController = require("../controllers/producto.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const {
  LECTORES_CATALOGO,
  LECTORES_REPORTE_STOCK,
} = require("../constants/permisos");

// Ruta pública: imagen binaria del producto. Sin auth para que los tags img
// la puedan cargar directamente sin header Authorization.
router.get("/:id/imagen", productoController.getImagen);

router.use(authMiddleware);

router.get(
  "/",
  requireAnyPerm(LECTORES_CATALOGO, "leer"),
  productoController.getAllProductos
);
router.get(
  "/all",
  requireAnyPerm(LECTORES_CATALOGO, "leer"),
  productoController.getAllProductosSinPaginacion
);
router.get(
  "/reporte-stock",
  requireAnyPerm(LECTORES_REPORTE_STOCK, "leer"),
  productoController.getReporteStock
);
router.get(
  "/reporte-movimientos",
  requireAnyPerm(LECTORES_REPORTE_STOCK, "leer"),
  productoController.getReporteMovimientos
);
router.get(
  "/reporte-mas-vendidos",
  requireAnyPerm(LECTORES_REPORTE_STOCK, "leer"),
  productoController.getReporteMasVendidos
);
router.get(
  "/search",
  requireAnyPerm(LECTORES_CATALOGO, "leer"),
  productoController.searchProductos
);
router.get(
  "/:id",
  requireAnyPerm(LECTORES_CATALOGO, "leer"),
  productoController.getProductoById
);
router.post(
  "/",
  requirePerm("PRODUCTOS", "crear"),
  productoController.createProducto
);
router.put(
  "/:id",
  requirePerm("PRODUCTOS", "editar"),
  productoController.updateProducto
);
router.delete(
  "/:id",
  requirePerm("PRODUCTOS", "eliminar"),
  productoController.deleteProducto
);

module.exports = router;
