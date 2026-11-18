-- Migracion 025: el número de venta sale de la secuencia, no de MAX+1.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- confirmarVentaTx (models/ventaTx.js) calculaba el VentaId como
-- MAX(VentaId)+1, copiado del sistema GeneXus. Con eso, al anular la última
-- venta (Corrección de caja, Modificaciones → Ventas) la venta siguiente
-- recibía EL MISMO número: dos ventas distintas con el mismo "Venta N°" en
-- tickets, movimientos de caja e historial de correcciones. Además dos cajeros
-- confirmando a la vez podían calcular el mismo id.
--
-- La columna ya tenía default nextval('venta_ventaid_seq'), pero como el POS
-- no lo usaba, la secuencia quedó atrás del MAX. Acá se asegura que la
-- secuencia exista, sea el default y quede por encima del último id usado.
-- Una secuencia nunca devuelve un número dos veces (aunque la transacción se
-- deshaga), así que puede haber saltos pero nunca repetidos.
--
-- Idempotente.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS venta_ventaid_seq;
ALTER SEQUENCE venta_ventaid_seq OWNED BY venta.ventaid;
ALTER TABLE venta ALTER COLUMN ventaid SET DEFAULT nextval('venta_ventaid_seq');

-- Por encima del mayor id usado, también los de movimientos de caja y
-- correcciones de ventas ya anuladas (su número no se debe volver a usar).
SELECT setval(
  'venta_ventaid_seq',
  GREATEST(
    (SELECT COALESCE(MAX(ventaid), 0) FROM venta),
    (SELECT COALESCE(MAX(ventaid), 0) FROM registrodiariocaja),
    (SELECT COALESCE(MAX(correccioncajaentidadid), 0) FROM correccioncaja
      WHERE correccioncajaentidad = 'VENTA'),
    (SELECT last_value FROM venta_ventaid_seq),
    1
  )
);

COMMIT;
