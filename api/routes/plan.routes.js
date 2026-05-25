const express = require("express");
const router = express.Router();
const planController = require("../controllers/plan.controller");
const authMiddleware = require("../middlewares/auth");
const requirePerm = require("../middlewares/permission");

router.use(authMiddleware);

router.get("/search", requirePerm("PLANES", "leer"), planController.searchPlanes);
router.get("/", requirePerm("PLANES", "leer"), planController.getAll);
router.get("/:id", requirePerm("PLANES", "leer"), planController.getById);
router.post("/", requirePerm("PLANES", "crear"), planController.create);
router.put("/:id", requirePerm("PLANES", "editar"), planController.update);
router.delete("/:id", requirePerm("PLANES", "eliminar"), planController.delete);

module.exports = router;
