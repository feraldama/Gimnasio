-- Migracion 010: Registrar el menu REPORTECOBRANZA y otros menus que faltaban.
--
-- `ReporteCobranzaPage.tsx` (y otras pantallas) consultan permisos via
-- `usePermiso("REPORTECOBRANZA", "leer")`. Como el menu no existia en BD,
-- todo perfil que no fuera admin (admin pasa por el bypass `UsuarioIsAdmin`)
-- veia un PermissionDenied permanente.
--
-- Aprovechamos para registrar tambien los menus que se asocian a pantallas
-- ya en uso pero que tampoco estaban en `menu`/`perfilmenu`:
--   REPORTECOBRANZA -> /reporte-cobranza
--   COBROCREDITO    -> /credito-pagos (ventas + creditos cancha)
--   CANCHATARIFA    -> /cancha/tarifas (admin de bandas de precio)
--
-- Idempotente: ON CONFLICT DO NOTHING / DO UPDATE.

BEGIN;

INSERT INTO menu (MenuId, MenuNombre) VALUES
  ('REPORTECOBRANZA', 'REPORTECOBRANZA'),
  ('COBROCREDITO',    'COBROCREDITO'),
  ('CANCHATARIFA',    'CANCHATARIFA')
ON CONFLICT (menuid) DO NOTHING;

-- Admin (PerfilId=1) recibe todos los permisos por defecto. Los otros perfiles
-- se administran desde la pantalla de perfiles segun el rol (ej: el operador
-- de mostrador deberia poder leer REPORTECOBRANZA pero no eliminar pagos).
INSERT INTO perfilmenu (PerfilId, MenuId, puedeCrear, puedeEditar, puedeEliminar, puedeLeer)
VALUES
  (1, 'REPORTECOBRANZA', 1, 1, 1, 1),
  (1, 'COBROCREDITO',    1, 1, 1, 1),
  (1, 'CANCHATARIFA',    1, 1, 1, 1)
ON CONFLICT (perfilid, menuid) DO UPDATE SET
  puedecrear    = EXCLUDED.puedecrear,
  puedeeditar   = EXCLUDED.puedeeditar,
  puedeeliminar = EXCLUDED.puedeeliminar,
  puedeleer     = EXCLUDED.puedeleer;

COMMIT;
