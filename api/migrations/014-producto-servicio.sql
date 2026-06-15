-- Migracion 014: Productos "servicio" (Cancha y Pelota) con precio editable.
--
-- Necesidad: el cajero de cantina cobra el alquiler de la cancha y el prestamo
-- de la pelota. El monto varia por cliente, asi que NO hay precio fijo: el
-- cajero ingresa el importe cada vez que agrega el producto al carrito.
--
-- Decisiones de modelado:
--   - Flag `productoservicio` (1/0) en producto. Cuando vale 1, el producto:
--       * en el POS muestra precio editable (sin precio sugerido), y
--       * NO descuenta/repone stock al vender, devolver o eliminar la venta
--         (una cancha no tiene inventario; la pelota es un alquiler).
--   - Cancha y Pelota se dan de alta como productos NUEVOS (el ProductoId lo
--     asigna la sequence). Los IDs 1 y 2 ya estaban ocupados por productos
--     reales, asi que el ID literal no se fuerza: el comportamiento lo gobierna
--     el flag, no el numero.
--   - LocalId = 0 => producto universal, visible para todos los locales/cajeros
--     (el POS lista los productos del local del usuario + los de LocalId 0).
--   - productoprecioventa = 0 a proposito: sin precio sugerido. El backend de
--     venta ya toma el precio por renglon del payload, no del catalogo.
--   - El INSERT es idempotente por nombre+flag para que correr la migracion dos
--     veces no duplique los servicios.
--
-- Aplicar con: node api/scripts/run-migration.js 014-producto-servicio.sql

BEGIN;

ALTER TABLE producto
  ADD COLUMN IF NOT EXISTS productoservicio SMALLINT NOT NULL DEFAULT 0;

INSERT INTO producto (productocodigo, productonombre, productoprecioventa, productoservicio, localid)
SELECT 0, 'CANCHA', 0, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM producto WHERE productonombre = 'CANCHA' AND productoservicio = 1
);

INSERT INTO producto (productocodigo, productonombre, productoprecioventa, productoservicio, localid)
SELECT 0, 'PELOTA', 0, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM producto WHERE productonombre = 'PELOTA' AND productoservicio = 1
);

COMMIT;
