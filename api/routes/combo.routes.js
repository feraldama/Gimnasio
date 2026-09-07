const express = require("express");
const router = express.Router();
const comboController = require("../controllers/combo.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const { LECTORES_COMBO } = require("../constants/permisos");

router.use(authMiddleware);

router.get("/", requireAnyPerm(LECTORES_COMBO, "leer"), comboController.getAll);
router.get(
  "/search",
  requireAnyPerm(LECTORES_COMBO, "leer"),
  comboController.searchCombos
);
router.get(
  "/paginated",
  requireAnyPerm(LECTORES_COMBO, "leer"),
  comboController.getAllPaginated
);
router.get("/:id", requireAnyPerm(LECTORES_COMBO, "leer"), comboController.getById);
router.post("/", requirePerm("COMBOS", "crear"), comboController.create);
router.put("/:id", requirePerm("COMBOS", "editar"), comboController.update);
router.delete("/:id", requirePerm("COMBOS", "eliminar"), comboController.delete);

module.exports = router;
