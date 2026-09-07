-- Migracion 017: indices del modulo de gimnasio + unicidad de cedula.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- CONTEXTO (medido sobre la base al 2026-09-07): clientes 823 filas,
-- asistencia 0, pago 0, suscripcion 0, venta 1. O sea el sistema todavia no
-- arranco a operar. A este volumen los seq scans no molestan; estos indices
-- son para que no haya que acordarse de ellos cuando la asistencia empiece a
-- crecer a ~100 filas por dia.
--
-- 1) clientes.ClienteRUC
--    El kiosko de asistencia resuelve la cedula tipeada con
--    `SELECT ClienteId FROM clientes WHERE ClienteRUC = ? LIMIT 1`
--    (asistencia.model.js -> buscarPorRUC) en CADA check-in.
--
--    Ademas del indice va una restriccion de UNICIDAD, que es lo importante:
--    ese `LIMIT 1` hace que, si dos clientes comparten cedula, el kiosko
--    registre la asistencia del PRIMERO que devuelva la base — silenciosamente
--    y quizas del socio equivocado. Hoy no hay duplicados (verificado), asi
--    que se puede cerrar la puerta antes de que entre el problema.
--
--    El indice unico es PARCIAL a proposito: 117 de los 823 clientes tienen
--    ClienteRUC = '' (cadena vacia, no NULL). Un UNIQUE comun fallaria al
--    crearse por esos 117 duplicados de ''. Excluyendolos, la unicidad rige
--    solo entre los clientes que efectivamente tienen cedula cargada, y se
--    puede seguir dando de alta clientes sin CI (los 117 no podrian usar el
--    kiosko hasta que se les complete el dato).
--
-- 2) asistencia
--    `AsistenciaFecha` la filtran el listado diario y los KPIs del dashboard;
--    `(ClienteId, AsistenciaFecha)` la ficha del alumno y el chequeo de "ya
--    entro hoy".
--
-- 3) venta.VentaFecha y pago.PagoFecha
--    Los reportes y los KPIs agrupan por fecha (cobrado hoy, cantina diario).

BEGIN;

-- 1) Cedula: busqueda del kiosko + unicidad entre quienes tienen CI.
CREATE INDEX IF NOT EXISTS idx_clientes_ruc
  ON clientes (clienteruc);

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_ruc_no_vacio
  ON clientes (clienteruc)
  WHERE clienteruc IS NOT NULL AND TRIM(clienteruc) <> '';

-- 2) Asistencia.
CREATE INDEX IF NOT EXISTS idx_asistencia_fecha
  ON asistencia (asistenciafecha);

CREATE INDEX IF NOT EXISTS idx_asistencia_cliente_fecha
  ON asistencia (clienteid, asistenciafecha);

-- 3) Fechas de venta y pago para reportes/KPIs.
CREATE INDEX IF NOT EXISTS idx_venta_fecha
  ON venta (ventafecha);

CREATE INDEX IF NOT EXISTS idx_pago_fecha
  ON pago (pagofecha);

COMMIT;
