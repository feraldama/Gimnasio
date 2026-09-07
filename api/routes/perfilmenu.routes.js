const express = require("express");
const router = express.Router();
const perfilMenuController = require("../controllers/perfilmenu.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;

// La grilla de permisos de un perfil vive en la pantalla de Perfiles, que
// gatea con usePermiso("PERFILES", ...) — de ahí el recurso.
//
// Sin este candado cualquier usuario logueado podía hacer
// `PUT /api/perfilmenu/:perfilId/:menuId` y DARLE TODOS LOS FLAGS A SU PROPIO
// PERFIL, que es la misma escalada que por usuarioperfil.
//
// Las escrituras aceptan crear|editar porque `PerfilesPage` borra y recrea las
// filas al guardar la grilla.
router.use(authMiddleware);

router.get(
  "/perfil/:perfilId",
  requirePerm("PERFILES", "leer"),
  perfilMenuController.getByPerfil
);
// Los permisos efectivos de un usuario los devuelve el login; este endpoint
// queda para administración, así que pide PERFILES o USUARIOS.
router.get(
  "/usuario/:usuarioId",
  requireAnyPerm(["PERFILES", "USUARIOS"], "leer"),
  perfilMenuController.getPermisosByUsuarioId
);
router.post(
  "/",
  requirePerm("PERFILES", ["crear", "editar"]),
  perfilMenuController.create
);
router.put(
  "/:perfilId/:menuId",
  requirePerm("PERFILES", "editar"),
  perfilMenuController.update
);
router.delete(
  "/:perfilId/:menuId",
  requirePerm("PERFILES", ["crear", "editar"]),
  perfilMenuController.delete
);

module.exports = router;
