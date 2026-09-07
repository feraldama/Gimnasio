const express = require("express");
const router = express.Router();
const menuController = require("../controllers/menu.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;

router.use(authMiddleware);

// El catálogo de menús lo lee también la grilla de permisos de Perfiles.
router.get(
  "/",
  requireAnyPerm(["MENUS", "PERFILES"], "leer"),
  menuController.getAll
);
router.get(
  "/:id",
  requireAnyPerm(["MENUS", "PERFILES"], "leer"),
  menuController.getById
);
router.post("/", requirePerm("MENUS", "crear"), menuController.create);
router.put("/:id", requirePerm("MENUS", "editar"), menuController.update);
router.delete("/:id", requirePerm("MENUS", "eliminar"), menuController.delete);

module.exports = router;
