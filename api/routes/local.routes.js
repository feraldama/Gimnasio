const express = require("express");
const router = express.Router();
const localController = require("../controllers/local.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;
const { LECTORES_LOCAL } = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/search",
  requireAnyPerm(LECTORES_LOCAL, "leer"),
  localController.searchLocales
);
router.get("/", requireAnyPerm(LECTORES_LOCAL, "leer"), localController.getAllLocales);
router.get(
  "/:id",
  requireAnyPerm(LECTORES_LOCAL, "leer"),
  localController.getLocalById
);
router.post("/", requirePerm("LOCALES", "crear"), localController.createLocal);
router.put("/:id", requirePerm("LOCALES", "editar"), localController.updateLocal);
router.delete(
  "/:id",
  requirePerm("LOCALES", "eliminar"),
  localController.deleteLocal
);

module.exports = router;
