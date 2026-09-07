const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/configuracion.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;

router.use(authMiddleware);

// El calendario de Cancha lee claves de configuración (horario operativo),
// así que la lectura acepta CONFIGURACION o CANCHA. Las escrituras quedan
// sólo para la pantalla de Configuración.
router.get(
  "/",
  requireAnyPerm(["CONFIGURACION", "CANCHA"], "leer"),
  ctrl.getAll
);
router.get(
  "/:clave",
  requireAnyPerm(["CONFIGURACION", "CANCHA"], "leer"),
  ctrl.getByClave
);
router.post("/", requirePerm("CONFIGURACION", ["crear", "editar"]), ctrl.upsert);
router.put("/:clave", requirePerm("CONFIGURACION", "editar"), ctrl.update);
router.delete("/:clave", requirePerm("CONFIGURACION", "eliminar"), ctrl.remove);

module.exports = router;
