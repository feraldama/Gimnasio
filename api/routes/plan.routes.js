const express = require("express");
const router = express.Router();
const planController = require("../controllers/plan.controller");
const authMiddleware = require("../middlewares/auth");

// Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware);

// Rutas para Plan
router.get("/search", authMiddleware, planController.searchPlanes);
router.get("/", authMiddleware, planController.getAll);
router.get("/:id", authMiddleware, planController.getById);
router.post("/", authMiddleware, planController.create);
router.put("/:id", authMiddleware, planController.update);
router.delete("/:id", authMiddleware, planController.delete);

module.exports = router;
