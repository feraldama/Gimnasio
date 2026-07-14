-- Migracion 016: Agregar columna de sexo al cliente.
--
-- Contexto: la importacion de clientes del sistema anterior (CSV) trae el
-- sexo del cliente (f/m), dato que la tabla `clientes` no contemplaba. Se
-- agrega una columna para no perder ese dato en la carga.
--
-- Valores esperados: 'f' | 'm' | '' (vacio cuando no se conoce).
--
-- Idempotente.

BEGIN;

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS clientesexo VARCHAR(1) NOT NULL DEFAULT '';

COMMIT;
