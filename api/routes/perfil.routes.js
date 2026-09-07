const express = require("express");
const router = express.Router();
const perfilController = require("../controllers/perfil.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;

router.use(authMiddleware);

// El catálogo de perfiles también lo lee la pantalla de Usuarios (checkboxes
// de asignación), así que la lectura acepta PERFILES o USUARIOS.
router.get(
  "/",
  requireAnyPerm(["PERFILES", "USUARIOS"], "leer"),
  perfilController.getAll
);
router.get(
  "/:id",
  requireAnyPerm(["PERFILES", "USUARIOS"], "leer"),
  perfilController.getById
);
router.post("/", requirePerm("PERFILES", "crear"), perfilController.create);
router.put("/:id", requirePerm("PERFILES", "editar"), perfilController.update);
router.delete(
  "/:id",
  requirePerm("PERFILES", "eliminar"),
  perfilController.delete
);

module.exports = router;
