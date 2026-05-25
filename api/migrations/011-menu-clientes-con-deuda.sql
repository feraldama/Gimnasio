-- Migracion 011: Registrar el menu CLIENTESCONDEUDA.
--
-- Vista consolidada que el cobrador usa para llamar/cobrar proactivamente
-- (gimnasio + cantina crédito + cancha crédito unificados). Es un recurso
-- aparte de CLIENTES porque un perfil de cobranza puede necesitar esta
-- vista sin tener acceso completo al CRM (crear/editar/borrar clientes).
--
-- Idempotente: ON CONFLICT DO NOTHING / DO UPDATE.

BEGIN;

INSERT INTO menu (MenuId, MenuNombre) VALUES
  ('CLIENTESCONDEUDA', 'CLIENTESCONDEUDA')
ON CONFLICT (menuid) DO NOTHING;

INSERT INTO perfilmenu (PerfilId, MenuId, puedeCrear, puedeEditar, puedeEliminar, puedeLeer)
VALUES
  (1, 'CLIENTESCONDEUDA', 1, 1, 1, 1)
ON CONFLICT (perfilid, menuid) DO UPDATE SET
  puedecrear    = EXCLUDED.puedecrear,
  puedeeditar   = EXCLUDED.puedeeditar,
  puedeeliminar = EXCLUDED.puedeeliminar,
  puedeleer     = EXCLUDED.puedeleer;

COMMIT;
