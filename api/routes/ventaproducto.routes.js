const express = require("express");
const router = express.Router();
const ventaProductoController = require("../controllers/ventaproducto.controller");
const authMiddleware = require("../middlewares/auth");
const { requireAnyPerm } = require("../middlewares/permission");
const {
  ESCRITORES_VENTA_DETALLE,
  LECTORES_VENTA_DETALLE,
} = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/search",
  requireAnyPerm(LECTORES_VENTA_DETALLE, "leer"),
  ventaProductoController.searchVentaProductos
);
router.get(
  "/",
  requireAnyPerm(LECTORES_VENTA_DETALLE, "leer"),
  ventaProductoController.getAll
);
router.get(
  "/paginated",
  requireAnyPerm(LECTORES_VENTA_DETALLE, "leer"),
  ventaProductoController.getAllPaginated
);
router.get(
  "/venta/:ventaId",
  requireAnyPerm(LECTORES_VENTA_DETALLE, "leer"),
  ventaProductoController.getByVentaId
);
router.get(
  "/:ventaId/:productoId",
  requireAnyPerm(LECTORES_VENTA_DETALLE, "leer"),
  ventaProductoController.getById
);
router.post(
  "/",
  requireAnyPerm(ESCRITORES_VENTA_DETALLE, "crear"),
  ventaProductoController.create
);
router.put(
  "/:ventaId/:productoId",
  requireAnyPerm(ESCRITORES_VENTA_DETALLE, "editar"),
  ventaProductoController.update
);
router.delete(
  "/:ventaId/:productoId",
  requireAnyPerm(ESCRITORES_VENTA_DETALLE, "eliminar"),
  ventaProductoController.delete
);

module.exports = router;
