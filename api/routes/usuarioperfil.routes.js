const express = require("express");
const router = express.Router();
const usuarioPerfilController = require("../controllers/usuarioperfil.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

// Los perfiles de un usuario se asignan desde la pantalla de Usuarios, que
// gatea con usePermiso("USUARIOS", ...) — así que el recurso es USUARIOS.
//
// Sin este candado cualquier usuario logueado podía hacer
// `POST /api/usuarioperfil` y ASIGNARSE EL PERFIL DE ADMINISTRADOR.
//
// Las escrituras aceptan crear|editar porque `UsersPage.handleSubmit` borra y
// recrea las filas de perfiles tanto al crear como al editar un usuario.
router.use(authMiddleware);

router.get(
  "/usuario/:usuarioId",
  requirePerm("USUARIOS", "leer"),
  usuarioPerfilController.getByUsuario
);
router.post(
  "/",
  requirePerm("USUARIOS", ["crear", "editar"]),
  usuarioPerfilController.create
);
router.delete(
  "/:usuarioId/:perfilId",
  requirePerm("USUARIOS", ["crear", "editar"]),
  usuarioPerfilController.delete
);

module.exports = router;
