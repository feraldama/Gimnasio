-- Migracion 027: hora de corte del día de trabajo para los reportes.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- Hay noches en que se abre a las 15:00 y se cierra a las 02:00 del día
-- siguiente. Con el día calendario, lo vendido después de medianoche caía en
-- el día siguiente y una noche quedaba partida en dos. Con esta clave, todo lo
-- registrado antes de la hora de corte cuenta para el día anterior (ver
-- api/utils/diaOperativo.js y client/src/utils/cierreCaja.ts).
--
-- 0 = día calendario (comportamiento anterior). Si la clave no existe el
-- backend usa 5.
--
-- Idempotente.

BEGIN;

INSERT INTO configuracion (configclave, configvalor, configdescripcion, configtipo)
VALUES
  ('DIA_OPERATIVO_HORA_CORTE', '5',
   'Hora (0 a 12) en que termina el día de trabajo en los reportes. Lo vendido antes de esa hora cuenta para el día anterior. 0 = día calendario.',
   'NUMERO')
ON CONFLICT (configclave) DO NOTHING;

COMMIT;
