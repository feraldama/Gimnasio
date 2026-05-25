const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/cancha.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.get("/", authMiddleware, requirePerm("CANCHA", "leer"), ctrl.getAll);
router.get(
  "/activas",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.getActivas
);
router.get(
  "/search",
  authMiddleware,
  requirePerm("CANCHA", "leer"),
  ctrl.search
);
router.get("/:id", authMiddleware, requirePerm("CANCHA", "leer"), ctrl.getById);
router.post("/", authMiddleware, requirePerm("CANCHA", "crear"), ctrl.create);
router.put("/:id", authMiddleware, requirePerm("CANCHA", "editar"), ctrl.update);
router.delete(
  "/:id",
  authMiddleware,
  requirePerm("CANCHA", "eliminar"),
  ctrl.remove
);

module.exports = router;
