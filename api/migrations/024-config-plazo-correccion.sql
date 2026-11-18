-- Migracion 024: plazo para corregir turnos de caja cerrados.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- La pantalla "Corrección de caja" (correccion.controller) deja que un
-- supervisor corrija ventas y cobros de turnos ya cerrados. Para no reescribir
-- cierres viejos ya rendidos, sólo se permite hasta N días después del cierre.
-- Si la clave no existe el backend usa 7; se registra acá para que se pueda
-- cambiar desde Configuración.
--
-- Idempotente.

BEGIN;

INSERT INTO configuracion (configclave, configvalor, configdescripcion, configtipo)
VALUES
  ('CORRECCION_CAJA_DIAS', '7',
   'Días después del cierre en que un supervisor todavía puede corregir ventas y cobros de ese turno.',
   'NUMERO')
ON CONFLICT (configclave) DO NOTHING;

COMMIT;
