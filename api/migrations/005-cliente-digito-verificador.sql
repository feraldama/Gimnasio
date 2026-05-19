-- Migracion 005: Separar el digito verificador (DV) del RUC.
--
-- Contexto: en Paraguay el RUC se compone de "CI-DV" donde el DV se calcula
-- algoritmicamente desde la CI (modulo 11 SET). Hasta ahora `ClienteRUC`
-- almacenaba la cadena completa (a veces con guion, a veces solo CI). El
-- requerimiento es:
--   1. Que el usuario solo cargue la CI.
--   2. El sistema calcula el DV automaticamente.
--   3. La impresion de facturas muestra CI-DV.
--
-- Esta migracion SOLO agrega la columna. El backfill (split de CI/DV cuando
-- viene con guion, calculo cuando viene sin guion) corre por un script Node
-- aparte porque requiere el algoritmo modulo 11:
--   node api/scripts/backfill-cliente-dv.js
--
-- Idempotente.

BEGIN;

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS clientedv VARCHAR(2) NOT NULL DEFAULT '';

COMMIT;
