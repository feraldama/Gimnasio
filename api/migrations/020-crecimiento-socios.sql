-- Migracion 020: ventana de gracia para el reporte de crecimiento de socios.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- CONTEXTO
-- El reporte de altas / renovaciones / bajas necesita decidir cuando un socio
-- cuyo plan vencio "se fue". Sin una ventana de gracia, alguien que vence el
-- 30 de septiembre y renueva el 3 de octubre figuraria como baja de
-- septiembre, que no es lo que paso.
--
-- La gracia es la cantidad de dias posteriores al vencimiento dentro de los
-- cuales una nueva suscripcion todavia cuenta como RENOVACION. Absorbe el
-- desfase normal entre que vence el plan y el socio pasa a pagar.
--
-- 15 dias es un default conservador para un gimnasio con planes mensuales.
-- Subirla hace ver mas retencion y menos bajas; bajarla, lo contrario. Es una
-- decision del negocio, por eso es configurable y no una constante.
--
-- Idempotente.

BEGIN;

INSERT INTO configuracion (configclave, configvalor, configdescripcion, configtipo)
VALUES
  ('RETENCION_DIAS_GRACIA', '15',
   'Dias despues del vencimiento en que una nueva suscripcion todavia cuenta como renovacion y no como baja. Afecta el reporte de crecimiento de socios.',
   'NUMERO')
ON CONFLICT (configclave) DO NOTHING;

COMMIT;
