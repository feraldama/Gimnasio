const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/configuracion.controller");
const authMiddleware = require("../middlewares/auth");

router.get("/", authMiddleware, ctrl.getAll);
router.get("/:clave", authMiddleware, ctrl.getByClave);
router.post("/", authMiddleware, ctrl.upsert);
router.put("/:clave", authMiddleware, ctrl.update);
router.delete("/:clave", authMiddleware, ctrl.remove);

module.exports = router;
