const express = require("express");
const router = express.Router();
const usuarioController = require("../controllers/usuario.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { loginLimiter, loginIpLimiter } = require("../middlewares/rateLimit");

// Rutas públicas (no requieren autenticación). El login lleva dos limitadores
// de intentos fallidos: techo por IP (contra rociado de contraseñas) y luego
// por IP+usuario (contra diccionario sobre una cuenta). Ver
// middlewares/rateLimit.js.
router.post("/login", loginIpLimiter, loginLimiter, usuarioController.login);

// A partir de acá: token + permiso sobre USUARIOS. Antes alcanzaba con estar
// logueado, así que cualquier usuario podía crear/editar/borrar usuarios —
// incluido el flag UsuarioIsAdmin — por curl, aunque la UI le escondiera la
// pantalla. La pantalla de Usuarios gatea con usePermiso("USUARIOS", ...),
// esto lo espeja en el backend.
router.use(authMiddleware);

router.get(
  "/search",
  requirePerm("USUARIOS", "leer"),
  usuarioController.searchUsuarios
);
router.get("/", requirePerm("USUARIOS", "leer"), usuarioController.getAllUsuarios);
router.get(
  "/:id",
  requirePerm("USUARIOS", "leer"),
  usuarioController.getUsuarioById
);
router.post("/", requirePerm("USUARIOS", "crear"), usuarioController.createUsuario);
router.put(
  "/:id",
  requirePerm("USUARIOS", "editar"),
  usuarioController.updateUsuario
);
router.delete(
  "/:id",
  requirePerm("USUARIOS", "eliminar"),
  usuarioController.deleteUsuario
);

module.exports = router;
