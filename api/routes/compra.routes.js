const express = require("express");
const router = express.Router();
const compraController = require("../controllers/compra.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.get(
  "/",
  authMiddleware,
  requirePerm("COMPRAS", "leer"),
  compraController.getAllCompras
);
router.get(
  "/all",
  authMiddleware,
  requirePerm("COMPRAS", "leer"),
  compraController.getAllComprasSinPaginacion
);
router.get(
  "/search",
  authMiddleware,
  requirePerm("COMPRAS", "leer"),
  compraController.searchCompras
);
// Pantalla "Nueva compra" usa su propio recurso (NUEVACOMPRA en frontend).
router.post(
  "/confirmar",
  authMiddleware,
  requirePerm("NUEVACOMPRA", "leer"),
  compraController.confirmar
);
router.get(
  "/:id",
  authMiddleware,
  requirePerm("COMPRAS", "leer"),
  compraController.getCompraById
);
router.get(
  "/:id/productos",
  authMiddleware,
  requirePerm("COMPRAS", "leer"),
  compraController.getProductosByCompraId
);
router.post(
  "/",
  authMiddleware,
  requirePerm("COMPRAS", "crear"),
  compraController.createCompra
);
router.put(
  "/:id",
  authMiddleware,
  requirePerm("COMPRAS", "editar"),
  compraController.updateCompra
);
router.delete(
  "/:id",
  authMiddleware,
  requirePerm("COMPRAS", "eliminar"),
  compraController.deleteCompra
);

module.exports = router;
