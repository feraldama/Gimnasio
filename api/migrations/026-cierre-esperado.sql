-- Migracion 026: el cierre de caja guarda el efectivo esperado y la diferencia
-- del momento del cierre.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- La reimpresión del ticket muestra el sobrante/faltante "Al cerrar" para
-- comparar con el ticket original. Sin estas columnas se reconstruía
-- deshaciendo el historial de correcciones, pero los movimientos de un turno
-- cerrado también se pueden cambiar por otros caminos (Registro Diario Caja,
-- borrado de compras) que no dejan rastro, y la reconstrucción daba mal.
-- Desde ahora el cierre (registrodiariocaja.model.aperturaCierreTransaccional)
-- guarda el dato en la misma transacción. Los cierres anteriores quedan en
-- NULL y siguen usando la reconstrucción (utils/ticketCierre.js).
--
-- Sólo tienen valor las filas de cierre (TipoGastoId 1 / grupo 2).
--   esperadocierre    apertura + ingresos en efectivo − egresos del turno
--   diferenciacierre  esperadocierre − monto declarado (> 0 faltante)
--
-- Idempotente.

BEGIN;

ALTER TABLE registrodiariocaja ADD COLUMN IF NOT EXISTS esperadocierre   bigint;
ALTER TABLE registrodiariocaja ADD COLUMN IF NOT EXISTS diferenciacierre bigint;

COMMIT;
