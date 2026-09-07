const express = require("express");
const router = express.Router();
const proveedorController = require("../controllers/proveedor.controller");
const authMiddleware = require("../middlewares/auth");
const { requireAnyPerm } = require("../middlewares/permission");
const { PROVEEDORES } = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/",
  requireAnyPerm(PROVEEDORES, "leer"),
  proveedorController.getAllProveedores
);
router.get(
  "/all",
  requireAnyPerm(PROVEEDORES, "leer"),
  proveedorController.getAllProveedoresSinPaginacion
);
router.get(
  "/search",
  requireAnyPerm(PROVEEDORES, "leer"),
  proveedorController.searchProveedores
);
router.get(
  "/:id",
  requireAnyPerm(PROVEEDORES, "leer"),
  proveedorController.getProveedorById
);
router.post(
  "/",
  requireAnyPerm(PROVEEDORES, "crear"),
  proveedorController.createProveedor
);
router.put(
  "/:id",
  requireAnyPerm(PROVEEDORES, "editar"),
  proveedorController.updateProveedor
);
router.delete(
  "/:id",
  requireAnyPerm(PROVEEDORES, "eliminar"),
  proveedorController.deleteProveedor
);

module.exports = router;
