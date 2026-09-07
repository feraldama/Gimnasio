const express = require("express");
const router = express.Router();
const ventaCreditoController = require("../controllers/ventacredito.controller");
const authMiddleware = require("../middlewares/auth");
const { requireAnyPerm } = require("../middlewares/permission");
const {
  ESCRITORES_VENTA_CREDITO,
  LECTORES_VENTA_CREDITO,
} = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/search",
  requireAnyPerm(LECTORES_VENTA_CREDITO, "leer"),
  ventaCreditoController.searchVentaCreditos
);
router.get("/", requireAnyPerm(LECTORES_VENTA_CREDITO, "leer"), ventaCreditoController.getAll);
router.get(
  "/paginated",
  requireAnyPerm(LECTORES_VENTA_CREDITO, "leer"),
  ventaCreditoController.getAllPaginated
);
router.get(
  "/venta/:ventaId",
  requireAnyPerm(LECTORES_VENTA_CREDITO, "leer"),
  ventaCreditoController.getByVentaId
);
router.get(
  "/:id",
  requireAnyPerm(LECTORES_VENTA_CREDITO, "leer"),
  ventaCreditoController.getById
);
router.post(
  "/",
  requireAnyPerm(ESCRITORES_VENTA_CREDITO, "crear"),
  ventaCreditoController.create
);
router.put(
  "/:id",
  requireAnyPerm(ESCRITORES_VENTA_CREDITO, "editar"),
  ventaCreditoController.update
);
router.delete(
  "/:id",
  requireAnyPerm(ESCRITORES_VENTA_CREDITO, "eliminar"),
  ventaCreditoController.delete
);

module.exports = router;
