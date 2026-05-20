-- Migracion 008: venta.ventausuario de VARCHAR(12) a VARCHAR(25).
--
-- Problema: la columna `venta.ventausuario` quedo en VARCHAR(12) pero la
-- referencia natural es `usuario.usuarioid` (VARCHAR(25)). Hoy existe ya
-- un usuario "administrador" (13 chars) que no puede registrar ventas
-- porque el INSERT en venta revienta con error 22001.
--
-- Idempotente: ALTER COLUMN TYPE no falla si ya esta en VARCHAR(25)+ — pero
-- ponemos un guard con information_schema para no correrlo dos veces.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'venta'
      AND column_name = 'ventausuario'
      AND character_maximum_length < 25
  ) THEN
    ALTER TABLE venta
      ALTER COLUMN ventausuario TYPE VARCHAR(25);
  END IF;
END $$;

COMMIT;
