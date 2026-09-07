const express = require("express");
const router = express.Router();
const cajaController = require("../controllers/caja.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const {
  AJUSTAN_CAJA_MONTO,
  LECTORES_CAJA,
} = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/search",
  requireAnyPerm(LECTORES_CAJA, "leer"),
  cajaController.searchCajas
);
router.get("/", requireAnyPerm(LECTORES_CAJA, "leer"), cajaController.getAll);
router.put(
  "/:id/monto",
  requireAnyPerm(AJUSTAN_CAJA_MONTO, ["crear", "editar"]),
  cajaController.updateMonto
);
router.get("/:id", requireAnyPerm(LECTORES_CAJA, "leer"), cajaController.getById);
router.post("/", requirePerm("CAJAS", "crear"), cajaController.create);
router.put("/:id", requirePerm("CAJAS", "editar"), cajaController.update);
router.delete("/:id", requirePerm("CAJAS", "eliminar"), cajaController.delete);

module.exports = router;
