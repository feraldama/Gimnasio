-- Migracion 019: grupo propio para la anulacion de cobro de cancha.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- PROBLEMA
-- Al anular el cobro de una reserva, `canchaReserva.controller` revertia los
-- movimientos escribiendo en registrodiariocaja con
-- TipoGastoId = 1 (EGRESOS) y TipoGastoGrupoId = 7.
--
-- Pero en la taxonomia de gastos el par (1, 7) ya significa otra cosa:
--
--   TipoGastoId 1 = EGRESOS
--     grupo 1 COMPRA          grupo 6 TALLER
--     grupo 2 CIERRE DE CAJA  grupo 7 LAVADERO   <-- colision
--     grupo 3 COMPRA CREDITO  grupo 8 VARIOS
--     grupo 4 COMBUSTIBLE     grupo 9 DEVOLUCION
--     grupo 5 COMISION
--
-- El 7 se eligio para que coincidiera con COBRO CANCHA, que es el grupo 7 pero
-- del lado de los INGRESOS (TipoGastoId = 2). Del lado de los egresos ese
-- numero ya estaba tomado por LAVADERO, asi que toda anulacion de cancha
-- aparecia etiquetada como un gasto de lavadero en cualquier reporte que
-- agrupe por categoria — incluido el listado de Registro Diario Caja.
--
-- Ademas una anulacion no es un gasto: es la reversion de un ingreso. Con su
-- propio grupo, el tablero mensual la puede netear contra el ingreso de cancha
-- en lugar de inflar los egresos.
--
-- MIGRACION DE DATOS: no hace falta. Al momento de esta migracion no existe
-- ninguna fila con (TipoGastoId=1, TipoGastoGrupoId=7) en la base, asi que no
-- hay historico ambiguo que corregir.
--
-- Idempotente.

BEGIN;

INSERT INTO tipogastogrupo (TipoGastoId, TipoGastoGrupoId, TipoGastoGrupoDescripcion)
VALUES (1, 10, 'ANULACION COBRO CANCHA')
ON CONFLICT (tipogastoid, tipogastogrupoid) DO NOTHING;

-- `tipogasto.TipoGastoCantGastos` lleva la cuenta de grupos por tipo y la
-- pantalla de Tipos de Gasto la muestra. Se recalcula para que no quede
-- desfasada con la fila nueva.
UPDATE tipogasto t
   SET TipoGastoCantGastos = (
     SELECT COUNT(*) FROM tipogastogrupo g WHERE g.TipoGastoId = t.TipoGastoId
   );

COMMIT;
