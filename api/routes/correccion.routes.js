const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/correccion.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

// Lectura: cualquier flag de CORRECCIONCAJA. Qué turnos ve cada uno lo decide
// el controlador (cajero: los propios; supervisor: todos).
const LEER = requirePerm("CORRECCIONCAJA", ["leer", "editar", "eliminar"]);
// Escritura: "editar" (turno propio abierto) o "eliminar" (supervisor). El
// controlador evalúa cuál aplica según el turno del movimiento.
const CORREGIR = requirePerm("CORRECCIONCAJA", ["editar", "eliminar"]);

router.get("/turnos", LEER, ctrl.getTurnos);
router.get("/turno/:aperturaId", LEER, ctrl.getTurno);
router.post("/movimiento/:id/medio", CORREGIR, ctrl.cambiarMedio);
router.post("/venta/:id/anular", CORREGIR, ctrl.anularVenta);
router.post("/turno/:aperturaId/venta", CORREGIR, ctrl.cargarVenta);

module.exports = router;
