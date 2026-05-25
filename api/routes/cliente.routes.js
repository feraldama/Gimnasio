const express = require("express");
const router = express.Router();
const clienteController = require("../controllers/cliente.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.get(
  "/",
  authMiddleware,
  requirePerm("CLIENTES", "leer"),
  clienteController.getAllClientes
);
router.get(
  "/all",
  authMiddleware,
  requirePerm("CLIENTES", "leer"),
  clienteController.getAllClientesSinPaginacion
);
// Vista consolidada de deuda por cliente — vive en su propio recurso para
// que el operador de cobranzas pueda verla sin tener acceso completo al CRM.
router.get(
  "/con-deuda",
  authMiddleware,
  requirePerm("CLIENTESCONDEUDA", "leer"),
  clienteController.getClientesConDeuda
);
router.get(
  "/search",
  authMiddleware,
  requirePerm("CLIENTES", "leer"),
  clienteController.searchClientes
);
router.get(
  "/:id",
  authMiddleware,
  requirePerm("CLIENTES", "leer"),
  clienteController.getClienteById
);
router.post(
  "/",
  authMiddleware,
  requirePerm("CLIENTES", "crear"),
  clienteController.createCliente
);
router.put(
  "/:id",
  authMiddleware,
  requirePerm("CLIENTES", "editar"),
  clienteController.updateCliente
);
router.delete(
  "/:id",
  authMiddleware,
  requirePerm("CLIENTES", "eliminar"),
  clienteController.deleteCliente
);

module.exports = router;
