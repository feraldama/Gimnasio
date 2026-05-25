const express = require("express");
const router = express.Router();
const registroDiarioCajaController = require("../controllers/registrodiariocaja.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

router.get(
  "/",
  requirePerm("REGISTRODIARIOCAJA", "leer"),
  registroDiarioCajaController.getAll
);
router.get(
  "/search",
  requirePerm("REGISTRODIARIOCAJA", "leer"),
  registroDiarioCajaController.search
);
// estado-apertura es lookup que usan varias pantallas (cobro, ventas, etc.)
// para chequear si hay caja abierta del usuario actual — no requiere permiso
// sobre RegistroDiarioCaja, solo autenticación.
router.get("/estado-apertura", registroDiarioCajaController.estadoAperturaPorUsuario);
router.get(
  "/rango",
  requirePerm("REGISTRODIARIOCAJA", "leer"),
  registroDiarioCajaController.getByDateRange
);
router.get(
  "/:id",
  requirePerm("REGISTRODIARIOCAJA", "leer"),
  registroDiarioCajaController.getById
);
router.post(
  "/",
  requirePerm("REGISTRODIARIOCAJA", "crear"),
  registroDiarioCajaController.create
);
// Apertura/cierre de caja es el flow del operador, recurso APERTURACAJA.
router.post(
  "/apertura-cierre",
  requirePerm("APERTURACAJA", "leer"),
  registroDiarioCajaController.aperturaCierreCaja
);
router.put(
  "/:id",
  requirePerm("REGISTRODIARIOCAJA", "editar"),
  registroDiarioCajaController.update
);
router.delete(
  "/:id",
  requirePerm("REGISTRODIARIOCAJA", "eliminar"),
  registroDiarioCajaController.delete
);

module.exports = router;
