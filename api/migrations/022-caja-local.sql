-- Migracion 022: cada caja pertenece a un local.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- CONTEXTO
-- El negocio tiene dos locales (SALON y GIMNASIO) y el reporte "Resumen por
-- local" necesita saber de qué local es cada movimiento de caja
-- (`registrodiariocaja.CajaId`). La tabla `caja` no tenía ningún vínculo con
-- el local: sólo descripción y monto.
--
-- LocalId = 0 ("TODOS") significa "sin local": cajas administrativas como
-- CAJA ADMIN o COMPRAS, que no son de un local en particular.
--
-- ASIGNACION INICIAL
-- No se fijan ids a mano: a cada caja se le asigna el local de los usuarios
-- que la usaron, sólo si TODOS esos usuarios son del mismo local (y no son
-- admins con LocalId 0). Si una caja la usaron usuarios de locales distintos,
-- queda en 0 y se asigna desde la pantalla de Cajas.
--
-- Idempotente.

BEGIN;

ALTER TABLE caja ADD COLUMN IF NOT EXISTS localid integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'icaja_local'
  ) THEN
    ALTER TABLE caja
      ADD CONSTRAINT icaja_local FOREIGN KEY (localid) REFERENCES local (localid);
  END IF;
END $$;

UPDATE caja c
SET localid = x.localid
FROM (
  SELECT r.cajaid, MIN(u.localid) AS localid
  FROM registrodiariocaja r
  JOIN usuario u ON u.usuarioid = r.usuarioid
  WHERE u.localid <> 0
  GROUP BY r.cajaid
  HAVING COUNT(DISTINCT u.localid) = 1
) x
WHERE c.cajaid = x.cajaid
  AND c.localid = 0;

COMMIT;
