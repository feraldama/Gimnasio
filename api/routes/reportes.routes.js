const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/reportes.controller");
const authMiddleware = require("../middlewares/auth");

router.get("/gimnasio/ocupacion", authMiddleware, ctrl.gimnasioOcupacion);
router.get("/cancha/diario", authMiddleware, ctrl.canchaDiario);
router.get("/cantina/diario", authMiddleware, ctrl.cantinaDiario);

module.exports = router;
