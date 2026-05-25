const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaBloqueo.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

// Bloqueos comparten el recurso CANCHA: quien admin canchas también admin
// los bloqueos. No agregamos un recurso aparte para no inflar la matriz
// de permisos.
router.use(authMiddleware);

router.get("/", requirePerm("CANCHA", "leer"), ctrl.listByRango);
router.get("/:id", requirePerm("CANCHA", "leer"), ctrl.getById);
router.post("/", requirePerm("CANCHA", "crear"), ctrl.create);
router.put("/:id", requirePerm("CANCHA", "editar"), ctrl.update);
router.delete("/:id", requirePerm("CANCHA", "eliminar"), ctrl.remove);

module.exports = router;
