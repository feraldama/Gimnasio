-- Migracion 004: Registrar el menu del kiosko de auto-registro de asistencia.
--
-- Pantalla nueva: /kiosko-asistencia (full-screen, sin Layout).
-- Frontend usa usePermiso("KIOSKOASISTENCIA", "leer") para decidir si mostrar
-- el boton "Modo kiosko" dentro de AsistenciaPage.
--
-- Permisos por defecto al perfil ADMINISTRADOR (PerfilId=1) y al perfil
-- GIMNASIO (PerfilId=4), ya que ambos suelen operar la tablet de entrada.

BEGIN;

INSERT INTO menu (MenuId, MenuNombre) VALUES
  ('KIOSKOASISTENCIA', 'KIOSKOASISTENCIA')
ON CONFLICT (menuid) DO NOTHING;

INSERT INTO perfilmenu (PerfilId, MenuId, puedeCrear, puedeEditar, puedeEliminar, puedeLeer)
VALUES
  (1, 'KIOSKOASISTENCIA', 1, 1, 1, 1),
  (4, 'KIOSKOASISTENCIA', 1, 1, 1, 1)
ON CONFLICT (perfilid, menuid) DO UPDATE SET
  puedecrear    = EXCLUDED.puedecrear,
  puedeeditar   = EXCLUDED.puedeeditar,
  puedeeliminar = EXCLUDED.puedeeliminar,
  puedeleer     = EXCLUDED.puedeleer;

COMMIT;
