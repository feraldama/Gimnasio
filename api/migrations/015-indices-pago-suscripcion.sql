-- Migracion 015: Indices para acelerar el modulo de gimnasio.
--
-- Motivacion:
--   - Los listados de suscripciones calculan el total pagado por suscripcion.
--     Antes se hacia con un subquery `GROUP BY SuscripcionId` que agregaba TODA
--     la tabla `pago` en cada listado paginado. Ahora se usa un LATERAL
--     correlacionado por suscripcion (ver suscripcion.model.js), que con este
--     indice resuelve cada total con un index scan en vez de un seq scan.
--   - La validacion de cobro (pago.controller validarCobroSuscripcion) tambien
--     hace SUM(PagoMonto) WHERE SuscripcionId = ?, que usa este indice.
--   - El indice sobre suscripcion(ClienteId) acelera los joins suscripcion->
--     cliente y el GROUP BY ClienteId de getProximasAVencer.
--
-- Aplicar con: node api/scripts/run-migration.js 015-indices-pago-suscripcion.sql

BEGIN;

CREATE INDEX IF NOT EXISTS idx_pago_suscripcion
  ON pago (SuscripcionId);

CREATE INDEX IF NOT EXISTS idx_suscripcion_cliente
  ON suscripcion (ClienteId);

COMMIT;
