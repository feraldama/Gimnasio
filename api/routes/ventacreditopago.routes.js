const express = require("express");
const router = express.Router();
const ventaCreditoPagoController = require("../controllers/ventacreditopago.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

// "recibir" es el flujo de cobro de crédito de la cantina (pantalla
// /credito-pagos). Por consistencia con el cobro de crédito de cancha,
// usa el recurso COBROCREDITO.
router.post(
  "/recibir",
  requirePerm("COBROCREDITO", "crear"),
  ventaCreditoPagoController.recibir
);

router.get(
  "/search",
  requirePerm("VENTAS", "leer"),
  ventaCreditoPagoController.searchPagos
);
router.get("/", requirePerm("VENTAS", "leer"), ventaCreditoPagoController.getAll);
router.get(
  "/paginated",
  requirePerm("VENTAS", "leer"),
  ventaCreditoPagoController.getAllPaginated
);
router.get(
  "/credito/:ventaCreditoId",
  requirePerm("VENTAS", "leer"),
  ventaCreditoPagoController.getByVentaCreditoId
);
router.get(
  "/:ventaCreditoId/:pagoId",
  requirePerm("VENTAS", "leer"),
  ventaCreditoPagoController.getById
);
router.post("/", requirePerm("VENTAS", "crear"), ventaCreditoPagoController.create);
router.put(
  "/:ventaCreditoId/:pagoId",
  requirePerm("VENTAS", "editar"),
  ventaCreditoPagoController.update
);
router.delete(
  "/:ventaCreditoId/:pagoId",
  requirePerm("VENTAS", "eliminar"),
  ventaCreditoPagoController.delete
);

module.exports = router;
