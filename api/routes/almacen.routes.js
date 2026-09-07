const express = require("express");
const router = express.Router();
const almacenController = require("../controllers/almacen.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const { LECTORES_ALMACEN } = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/search",
  requireAnyPerm(LECTORES_ALMACEN, "leer"),
  almacenController.searchAlmacenes
);
router.get("/", requireAnyPerm(LECTORES_ALMACEN, "leer"), almacenController.getAll);
router.get("/:id", requireAnyPerm(LECTORES_ALMACEN, "leer"), almacenController.getById);
router.post("/", requirePerm("ALMACENES", "crear"), almacenController.create);
router.put("/:id", requirePerm("ALMACENES", "editar"), almacenController.update);
router.delete(
  "/:id",
  requirePerm("ALMACENES", "eliminar"),
  almacenController.delete
);

module.exports = router;
