-- Migracion 007: Horario operativo de Cancha configurable.
--
-- Hasta ahora el horario de 06:00 a 23:00 estaba hardcodeado en el backend
-- (reportes.controller) y en el frontend (CanchaCalendarioPage). Lo movemos
-- a configuracion para que el cliente pueda ajustarlo desde la pantalla de
-- Ajustes sin tocar codigo.
--
-- Las dos claves son numericas (horas enteras, 0-23). El backend las lee con
-- Configuracion.getNumero y aplica los defaults si la clave no existe o no
-- es numerica.
--
-- Idempotente: ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO configuracion (configclave, configvalor, configdescripcion, configtipo)
VALUES
  ('CANCHA_HORA_INICIO', '6',  'Hora de apertura de cancha (0-23). Define los slots visibles en el calendario.', 'NUMERO'),
  ('CANCHA_HORA_FIN',    '23', 'Hora de cierre de cancha (1-24). Define los slots visibles en el calendario.', 'NUMERO')
ON CONFLICT (configclave) DO NOTHING;

COMMIT;
