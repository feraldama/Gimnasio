const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/canchaReserva.controller");
const authMiddleware = require("../middlewares/auth");

router.get("/", authMiddleware, ctrl.getAll);
router.get("/search", authMiddleware, ctrl.search);
router.get("/by-fecha", authMiddleware, ctrl.getByFecha);
router.get("/:id", authMiddleware, ctrl.getById);
router.post("/", authMiddleware, ctrl.create);
router.put("/:id", authMiddleware, ctrl.update);
router.delete("/:id", authMiddleware, ctrl.remove);

module.exports = router;
