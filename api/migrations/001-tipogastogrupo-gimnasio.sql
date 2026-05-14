-- Migración: agregar grupos de ingreso para el módulo gimnasio.
--
-- Contexto: el código asignaba TipoGastoGrupoId=6 a pagos por transferencia,
-- pero el grupo (TipoGastoId=2, TipoGastoGrupoId=6) NO existía en `tipogastogrupo`.
-- Resultado: cada pago por transferencia generaba un movimiento con un grupo
-- inconsistente (las FKs son por columna individual, no compuesta, así que MySQL
-- no rechazaba el INSERT, pero el JOIN del reporte de caja traía datos vacíos).
--
-- Esta migración:
--   - Agrega (2, 5, 'DESCUENTO')      → reservado para futura funcionalidad de descuentos en cobros.
--   - Agrega (2, 6, 'TRANSFERENCIA')  → arregla el mapeo de pagos TR de gimnasio.
--
-- Después de aplicar esta migración, el mapping en api/constants/pagoTipos.js
-- queda correcto sin cambios:
--   CO → 1 (VENTA)
--   PO → 4 (VENTA POS)
--   TR → 6 (TRANSFERENCIA)  ← ahora válido
--
-- Ejecutar EN CADA BASE QUE USE EL MÓDULO GIMNASIO:
--   USE technow;   SOURCE 001-tipogastogrupo-gimnasio.sql;
--   USE winners;   SOURCE 001-tipogastogrupo-gimnasio.sql;
--   USE decorpar;  SOURCE 001-tipogastogrupo-gimnasio.sql;
--   (saltar las que no apliquen)

INSERT INTO tipogastogrupo (TipoGastoId, TipoGastoGrupoId, TipoGastoGrupoDescripcion)
VALUES
  (2, 5, 'DESCUENTO'),
  (2, 6, 'TRANSFERENCIA');
