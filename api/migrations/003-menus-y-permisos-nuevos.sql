-- Migracion 003: Registrar menus de las nuevas pantallas y darles permiso al
-- perfil ADMINISTRADOR (PerfilId=1).
--
-- Pantallas agregadas en esta tanda:
--   CONFIGURACION   -> /configuracion        (Ajustes generales)
--   CANCHA          -> /cancha               (Canchas y reservas)
--   REPORTESGRAFICOS-> /reportes-graficos    (3 graficos del cliente)
--   FICHAALUMNO     -> /clientes/:id/ficha   (Ficha completa de alumno)
--
-- Idempotente: ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO menu (MenuId, MenuNombre) VALUES
  ('CONFIGURACION',     'CONFIGURACION'),
  ('CANCHA',            'CANCHA'),
  ('REPORTESGRAFICOS',  'REPORTESGRAFICOS'),
  ('FICHAALUMNO',       'FICHAALUMNO')
ON CONFLICT (menuid) DO NOTHING;

-- Admin (perfilid=1) recibe permiso completo. Otros perfiles se asignan a
-- mano desde la pantalla de perfiles.
INSERT INTO perfilmenu (PerfilId, MenuId, puedeCrear, puedeEditar, puedeEliminar, puedeLeer)
VALUES
  (1, 'CONFIGURACION',    1, 1, 1, 1),
  (1, 'CANCHA',           1, 1, 1, 1),
  (1, 'REPORTESGRAFICOS', 1, 1, 1, 1),
  (1, 'FICHAALUMNO',      1, 1, 1, 1)
ON CONFLICT (perfilid, menuid) DO UPDATE SET
  puedecrear    = EXCLUDED.puedecrear,
  puedeeditar   = EXCLUDED.puedeeditar,
  puedeeliminar = EXCLUDED.puedeeliminar,
  puedeleer     = EXCLUDED.puedeleer;

COMMIT;
