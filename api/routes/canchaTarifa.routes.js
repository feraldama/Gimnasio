const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaTarifa.controller");
const authMiddleware = require("../middlewares/auth");

router.get("/cancha/:canchaId", authMiddleware, ctrl.listByCancha);
router.get("/:id", authMiddleware, ctrl.getById);
router.post("/", authMiddleware, ctrl.create);
router.post("/sugerir-monto", authMiddleware, ctrl.sugerirMonto);
router.put("/:id", authMiddleware, ctrl.update);
router.delete("/:id", authMiddleware, ctrl.remove);

module.exports = router;
