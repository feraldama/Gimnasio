-- Migracion 013: Agregar SerieId a cancha_reserva para trackear reservas
-- creadas como parte de una serie recurrente.
--
-- Cuando un cliente reserva "todos los lunes 19hs por 8 semanas", se generan
-- 8 reservas. SerieId las agrupa para que en el futuro se pueda:
--   - Listar todas las reservas de una serie
--   - Cancelar la serie completa de una
--   - Identificar visualmente en el calendario que son parte de una serie
--
-- NULL = reserva individual (no parte de una serie). Mantenemos
-- compatibilidad total con reservas pre-existentes.
--
-- Idempotente con IF NOT EXISTS.

BEGIN;

ALTER TABLE cancha_reserva
  ADD COLUMN IF NOT EXISTS canchareservaserieid INTEGER;

CREATE INDEX IF NOT EXISTS idx_cancha_reserva_serie
  ON cancha_reserva (canchareservaserieid)
  WHERE canchareservaserieid IS NOT NULL;

COMMIT;
