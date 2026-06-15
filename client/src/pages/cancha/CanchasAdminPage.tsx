import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import Swal from "sweetalert2";
import {
  getCanchas,
  createCancha,
  updateCancha,
  deleteCancha,
  type Cancha,
} from "../../services/cancha.service";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Button,
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
  Badge,
} from "../../components/common/ui";
import Pagination from "../../components/common/Pagination";
import { formatMiles } from "../../utils/utils";

interface PaginationMeta {
  totalItems: number;
  totalPages: number;
}

const emptyForm = (): Cancha => ({
  CanchaId: 0,
  CanchaNombre: "",
  CanchaTarifaHora: 0,
  CanchaActiva: 1,
});

export default function CanchasAdminPage() {
  const puedeLeer = usePermiso("CANCHA", "leer");
  const puedeCrear = usePermiso("CANCHA", "crear");
  const puedeEditar = usePermiso("CANCHA", "editar");
  const puedeEliminar = usePermiso("CANCHA", "eliminar");

  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    totalItems: 0,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);

  // Accesibilidad del modal: cerrar con Escape + atrapar el foco.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalOpen, dialogRef);
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);
  const [form, setForm] = useState<Cancha>(emptyForm());
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await getCanchas(page, itemsPerPage);
      setCanchas(r.data);
      setPagination(r.pagination);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar canchas");
    } finally {
      setLoading(false);
    }
  }, [page, itemsPerPage]);

  useEffect(() => {
    if (!puedeLeer) return;
    fetchData();
  }, [puedeLeer, fetchData]);

  const handleNew = () => {
    setForm(emptyForm());
    setModalOpen(true);
  };

  const handleEdit = (c: Cancha) => {
    setForm({ ...c });
    setModalOpen(true);
  };

  const handleToggleActiva = async (c: Cancha) => {
    try {
      await updateCancha(c.CanchaId, {
        ...c,
        CanchaActiva: c.CanchaActiva === 1 ? 0 : 1,
      });
      fetchData();
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo cambiar el estado",
      });
    }
  };

  const handleDelete = async (c: Cancha) => {
    const r = await Swal.fire({
      title: `¿Eliminar "${c.CanchaNombre}"?`,
      text: "Si la cancha tiene reservas asociadas no se podrá eliminar.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#dc2626",
    });
    if (!r.isConfirmed) return;
    try {
      await deleteCancha(c.CanchaId);
      fetchData();
    } catch (e: unknown) {
      // Si el backend devolvio 409 TIENE_RESERVAS, ofrecemos desactivar en
      // lugar de mostrar solo un error.
      const err = e as { code?: string; reservasCount?: number; message?: string };
      if (err?.code === "TIENE_RESERVAS") {
        const alt = await Swal.fire({
          icon: "info",
          title: "No se puede eliminar",
          html: `La cancha tiene <strong>${err.reservasCount}</strong> reserva${
            err.reservasCount === 1 ? "" : "s"
          } asociada${err.reservasCount === 1 ? "" : "s"}.<br/>¿Querés desactivarla en su lugar?`,
          showCancelButton: true,
          confirmButtonText: "Desactivar",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "#d97706",
        });
        if (alt.isConfirmed && c.CanchaActiva === 1) {
          try {
            await updateCancha(c.CanchaId, { ...c, CanchaActiva: 0 });
            fetchData();
            Swal.fire({
              icon: "success",
              title: "Cancha desactivada",
              timer: 1500,
              showConfirmButton: false,
            });
          } catch (e2: unknown) {
            Swal.fire({
              icon: "error",
              title: "Error",
              text: e2 instanceof Error ? e2.message : "No se pudo desactivar",
            });
          }
        }
        return;
      }
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err?.message || "No se pudo eliminar",
      });
    }
  };

  const handleSubmit = async () => {
    if (!form.CanchaNombre.trim()) {
      Swal.fire({ icon: "warning", title: "El nombre es requerido" });
      return;
    }
    try {
      setSaving(true);
      if (form.CanchaId) {
        await updateCancha(form.CanchaId, form);
      } else {
        await createCancha(form);
      }
      setModalOpen(false);
      fetchData();
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo guardar",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!puedeLeer) return <PermissionDenied resource="el catálogo de canchas" />;

  return (
    <div className="p-4 sm:p-6">
      <Card>
        <CardHeader
          title="Canchas — Catálogo"
          description="Alta y mantenimiento de las canchas físicas del local. La tarifa por hora se usa como sugerencia al crear reservas."
          actions={
            puedeCrear && (
              <Button
                variant="primary"
                onClick={handleNew}
                className="cursor-pointer"
              >
                Nueva cancha
              </Button>
            )
          }
        />

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-3 py-2 text-right">Tarifa por hora</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {canchas.map((c) => (
                  <tr key={c.CanchaId}>
                    <td className="px-3 py-2 tabular-nums">{c.CanchaId}</td>
                    <td className="px-3 py-2 font-medium">{c.CanchaNombre}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      Gs. {formatMiles(c.CanchaTarifaHora || 0)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge tone={c.CanchaActiva === 1 ? "success" : "neutral"}>
                        {c.CanchaActiva === 1 ? "Activa" : "Inactiva"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      {puedeEditar && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(c)}
                            className="cursor-pointer"
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant={c.CanchaActiva === 1 ? "warning" : "success"}
                            onClick={() => handleToggleActiva(c)}
                            className="cursor-pointer"
                            title={
                              c.CanchaActiva === 1
                                ? "Desactivar para que no aparezca en el selector de reservas"
                                : "Reactivar para volver a aceptar reservas"
                            }
                          >
                            {c.CanchaActiva === 1 ? "Desactivar" : "Activar"}
                          </Button>
                        </>
                      )}
                      {puedeEliminar && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(c)}
                          className="cursor-pointer"
                        >
                          Eliminar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {canchas.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      No hay canchas registradas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-4">
              <Pagination
                currentPage={page}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={(n) => {
                  setItemsPerPage(n);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}
      </Card>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancha-modal-title"
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
          >
            <h2 id="cancha-modal-title" className="text-lg font-semibold mb-4">
              {form.CanchaId ? "Editar cancha" : "Nueva cancha"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Nombre
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  value={form.CanchaNombre}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaNombre: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="Ej. CANCHA PRINCIPAL"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Tarifa por hora (Gs.)
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:outline-none tabular-nums"
                  value={form.CanchaTarifaHora}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaTarifaHora: Number(e.target.value) || 0,
                    })
                  }
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Valor sugerido al crear una reserva. Se puede sobreescribir
                  manualmente.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Estado
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                  value={form.CanchaActiva}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaActiva: Number(e.target.value),
                    })
                  }
                >
                  <option value={1}>Activa</option>
                  <option value={0}>Inactiva</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="secondary"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={saving}
                className="cursor-pointer"
              >
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
