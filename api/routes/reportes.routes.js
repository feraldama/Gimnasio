const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/reportes.controller");
const authMiddleware = require("../middlewares/auth");
const { requireAnyPerm } = require("../middlewares/permission");
const {
  LECTORES_REPORTE_GRAFICO,
  LECTORES_REPORTE_SUSCRIPCIONES,
} = require("../constants/permisos");

router.use(authMiddleware);

router.get(
  "/gimnasio/ocupacion",
  requireAnyPerm(LECTORES_REPORTE_GRAFICO, "leer"),
  ctrl.gimnasioOcupacion
);
router.get(
  "/gimnasio/suscripciones-vigentes",
  requireAnyPerm(LECTORES_REPORTE_SUSCRIPCIONES, "leer"),
  ctrl.gimnasioSuscripcionesVigentes
);
router.get(
  "/cancha/diario",
  requireAnyPerm(LECTORES_REPORTE_GRAFICO, "leer"),
  ctrl.canchaDiario
);
router.get(
  "/cancha/desglose",
  requireAnyPerm(LECTORES_REPORTE_GRAFICO, "leer"),
  ctrl.canchaDesglose
);
router.get(
  "/cancha/heatmap",
  requireAnyPerm(LECTORES_REPORTE_GRAFICO, "leer"),
  ctrl.canchaHeatmap
);
router.get(
  "/cantina/diario",
  requireAnyPerm(LECTORES_REPORTE_GRAFICO, "leer"),
  ctrl.cantinaDiario
);
// Reporte consolidado "Resumen por local" de la pantalla de Reportes.
router.get(
  "/resumen-local",
  requireAnyPerm(["REPORTES"], "leer"),
  ctrl.resumenLocal
);
// Los KPIs del Dashboard quedan sólo detrás de autenticación a propósito: el
// Dashboard no tiene menú propio y es la landing de todo usuario logueado
// (sólo gatea el botón de cobro con PAGOS/crear). Meterle un requirePerm acá
// dejaría el home en blanco para los perfiles no admin.
router.get("/dashboard/gimnasio-kpis", ctrl.dashboardGimnasioKpis);

module.exports = router;
