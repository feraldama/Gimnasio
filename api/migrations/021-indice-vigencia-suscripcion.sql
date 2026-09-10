-- Migracion 021: indice de vigencia para el reporte de suscripciones vigentes.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- CONTEXTO
-- El reporte por rango de fechas (reportes.controller ->
-- gimnasioSuscripcionesVigentes) arma una serie con generate_series y hace un
-- LEFT JOIN contra `suscripcion` POR CADA FECHA generada. Un rango de tres
-- meses son 92 pasadas sobre la tabla. Sin indice, 92 seq scans.
--
-- POR QUE ES UN INDICE DE EXPRESION Y NO SOBRE LAS COLUMNAS
-- Todo el modulo filtra con `DATE(SuscripcionFechaInicio)` en vez de la
-- columna pelada. El wrapper es historico (viene del dialecto MySQL) y hoy es
-- un no-op, porque ambas columnas ya son `date`. Pero para el planificador
-- `DATE(col)` es una expresion, no una columna: un btree comun sobre
-- `suscripcionfechafin` NO se usaria y el indice quedaria de adorno. El indice
-- tiene que espejar el predicado tal cual se escribe.
--
-- El orden de las columnas es fin-primero a proposito: el filtro de la lista
-- de vencimientos y el de este reporte arrancan por la fecha de fin, que es la
-- mas selectiva (las suscripciones vencidas se acumulan hacia atras, las que
-- terminan en una ventana dada son pocas).
--
-- VOLUMEN AL MOMENTO DE ESCRIBIRLO: la tabla tiene decenas de filas, asi que
-- esto todavia no cambia nada medible. Va ahora por el mismo motivo que los
-- indices de la migracion 017: para no tener que acordarse cuando el gimnasio
-- lleve dos anios operando y la tabla tenga miles de suscripciones.
--
-- Idempotente.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_suscripcion_vigencia
  ON suscripcion ((DATE(suscripcionfechafin)), (DATE(suscripcionfechainicio)));

COMMIT;
