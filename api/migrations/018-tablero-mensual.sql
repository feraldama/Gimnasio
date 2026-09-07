-- Migracion 018: Tablero mensual de administracion.
--
-- Aplicar con: node api/scripts/migrate.js
--
-- CONTEXTO
-- Hoy la administracion no tiene un lugar donde ver el resultado del negocio.
-- Los reportes existentes son por linea (gimnasio / cancha / cantina), cada
-- uno en su pantalla y su periodo, y no hay ninguno de egresos: el registro
-- diario de caja es un listado paginado sin totales. Nadie puede responder
-- "cuanto facturamos y cuanto gastamos este mes" sin sumar a mano.
--
-- METAS
-- Solo existian dos metas y ninguna servia como senal de gestion:
--   * GIMNASIO_CAPACIDAD_MENSUAL: el reporte divide suscripciones por una
--     "capacidad de clases" — mezcla unidades, y ademas cuenta altas nuevas
--     junto con renovaciones.
--   * CANCHA_META_DIARIA: una sola cifra plana para todos los dias, cuando
--     las propias bandas tarifarias valen el doble el fin de semana. Los dias
--     de semana incumplen siempre y los fines de semana sobrecumplen siempre.
--
-- Estas claves nuevas son metas de INGRESO COBRADO POR MES y por linea de
-- negocio, que es lo que se puede comparar contra el resultado. La meta total
-- no se guarda: se deriva sumando las tres, para que no pueda contradecirlas.
--
-- Valor 0 significa "sin meta definida" y el tablero muestra "—" en lugar de
-- un cumplimiento enganoso.
--
-- Idempotente.

BEGIN;

INSERT INTO configuracion (configclave, configvalor, configdescripcion, configtipo)
VALUES
  ('META_MENSUAL_GIMNASIO', '0',
   'Meta de ingreso COBRADO por mes del gimnasio, en guaranies. 0 = sin meta.',
   'NUMERO'),
  ('META_MENSUAL_CANCHA', '0',
   'Meta de ingreso COBRADO por mes de cancha, en guaranies. 0 = sin meta.',
   'NUMERO'),
  ('META_MENSUAL_CANTINA', '0',
   'Meta de ingreso COBRADO por mes de cantina, en guaranies. 0 = sin meta.',
   'NUMERO')
ON CONFLICT (configclave) DO NOTHING;

-- Menu del tablero + permiso al perfil ADMINISTRADOR (PerfilId=1).
-- Es un recurso aparte de REPORTES a proposito: muestra el resultado del
-- negocio y los egresos, que no todo perfil con acceso a reportes
-- operativos deberia ver.
INSERT INTO menu (MenuId, MenuNombre) VALUES ('TABLEROMENSUAL', 'TABLEROMENSUAL')
ON CONFLICT (menuid) DO NOTHING;

INSERT INTO perfilmenu (PerfilId, MenuId, puedeCrear, puedeEditar, puedeEliminar, puedeLeer)
VALUES (1, 'TABLEROMENSUAL', 1, 1, 1, 1)
ON CONFLICT (perfilid, menuid) DO UPDATE SET
  puedecrear    = EXCLUDED.puedecrear,
  puedeeditar   = EXCLUDED.puedeeditar,
  puedeeliminar = EXCLUDED.puedeeliminar,
  puedeleer     = EXCLUDED.puedeleer;

COMMIT;
