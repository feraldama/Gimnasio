import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Button,
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
} from "../../components/common/ui";
import {
  listBloqueos,
  createBloqueo,
  deleteBloqueo,
  type CanchaBloqueo,
} from "../../services/canchaBloqueo.service";
import {
  getCanchasActivas,
  type Cancha,
} from "../../services/cancha.service";
import { addDaysLocal, formatDateLocal, todayLocalISO } from "../../utils/utils";

// Pantalla de administración de bloqueos. Lista los bloqueos en un rango de
// fechas (default: hoy → +30 días) y permite crear / borrar. Si una reserva
// intenta caer sobre un bloqueo, el backend rechaza con 409 BLOQUEO_HORARIO.

interface FormState {
  CanchaId: string; // "" = todas las canchas
  CanchaBloqueoFecha: string;
  todoElDia: boolean;
  CanchaBloqueoHoraDesde: string;
  CanchaBloqueoHoraHasta: string;
  CanchaBloqueoMotivo: string;
}

const emptyForm = (): FormState => ({
  CanchaId: "",
  CanchaBloqueoFecha: todayLocalISO(),
  todoElDia: true,
  CanchaBloqueoHoraDesde: "08:00",
  CanchaBloqueoHoraHasta: "18:00",
  CanchaBloqueoMotivo: "",
});

const hhmm = (t?: string | null) =>
  t ? String(t).slice(0, 5) : "";

export default function CanchaBloqueosPage() {
  const puedeLeer = usePermiso("CANCHA", "leer");
  const puedeCrear = usePermiso("CANCHA", "crear");
  const puedeEliminar = usePermiso("CANCHA", "eliminar");

  const [bloqueos, setBloqueos] = useState<CanchaBloqueo[]>([]);
  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [desde, setDesde] = useState(todayLocalISO());
  const [hasta, setHasta] = useState(addDaysLocal(todayLocalISO(), 30));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await listBloqueos(desde, hasta);
      setBloqueos(r.data);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Error al cargar bloqueos"
      );
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    if (!puedeLeer) return;
    fetchData();
  }, [puedeLeer, fetchData]);

  useEffect(() => {
    if (!puedeLeer) return;
    getCanchasActivas()
      .then((r) => setCanchas(r.data))
      .catch(() => {
        /* silencioso; el form muestra "Todas" igual */
      });
  }, [puedeLeer]);

  const handleNew = () => {
    setForm(emptyForm());
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.CanchaBloqueoFecha) {
      Swal.fire({ icon: "warning", title: "Fecha requerida" });
      return;
    }
    if (!form.todoElDia) {
      if (!form.CanchaBloqueoHoraDesde || !form.CanchaBloqueoHoraHasta) {
        Swal.fire({
          icon: "warning",
          title: "Horario incompleto",
          text: "Indicá hora desde y hasta, o marcá 'todo el día'.",
        });
        return;
      }
      if (form.CanchaBloqueoHoraHasta <= form.CanchaBloqueoHoraDesde) {
        Swal.fire({
          icon: "warning",
          title: "Horario inválido",
          text: "La hora hasta debe ser posterior a desde.",
        });
        return;
      }
    }
    try {
      setSaving(true);
      await createBloqueo({
        CanchaId: form.CanchaId ? Number(form.CanchaId) : null,
        CanchaBloqueoFecha: form.CanchaBloqueoFecha,
        CanchaBloqueoHoraDesde: form.todoElDia
          ? null
          : `${form.CanchaBloqueoHoraDesde}:00`,
        CanchaBloqueoHoraHasta: form.todoElDia
          ? null
          : `${form.CanchaBloqueoHoraHasta}:00`,
        CanchaBloqueoMotivo: form.CanchaBloqueoMotivo,
      });
      setModalOpen(false);
      fetchData();
    } catch (e: unknown) {
      const err = e as { message?: string };
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err.message || "No se pudo crear el bloqueo",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b: CanchaBloqueo) => {
    const r = await Swal.fire({
      title: "¿Eliminar bloqueo?",
      text: b.CanchaBloqueoMotivo || "Sin motivo",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#dc2626",
    });
    if (!r.isConfirmed) return;
    try {
      await deleteBloqueo(b.CanchaBloqueoId);
      fetchData();
    } catch (e: unknown) {
      const err = e as { message?: string };
      Swal.fire({ icon: "error", title: "Error", text: err.message });
    }
  };

  if (!puedeLeer)
    return <PermissionDenied resource="los bloqueos de cancha" />;

  return (
    <div className="p-4 sm:p-6">
      <Card>
        <CardHeader
          title="Bloqueos de cancha"
          description="Marcá períodos en que una cancha (o todas) no pueden ser reservadas: mantenimiento, feriado, evento privado, lluvia."
          actions={
            puedeCrear && (
              <Button
                variant="primary"
                onClick={handleNew}
                className="cursor-pointer inline-flex items-center gap-1.5"
              >
                <PlusIcon className="w-4 h-4" />
                Nuevo bloqueo
              </Button>
            )
          }
        />

        {/* Filtro de rango */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm cursor-pointer"
            />
          </div>
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cancha</th>
                  <th className="px-3 py-2 text-left">Horario</th>
                  <th className="px-3 py-2 text-left">Motivo</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {bloqueos.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      Sin bloqueos en el rango seleccionado.
                    </td>
                  </tr>
                ) : (
                  bloqueos.map((b) => (
                    <tr key={b.CanchaBloqueoId} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        {formatDateLocal(b.CanchaBloqueoFecha)}
                      </td>
                      <td className="px-3 py-2">
                        {b.CanchaId == null ? (
                          <span className="italic text-gray-700">
                            Todas las canchas
                          </span>
                        ) : (
                          b.CanchaNombre || `Cancha #${b.CanchaId}`
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {b.CanchaBloqueoHoraDesde && b.CanchaBloqueoHoraHasta
                          ? `${hhmm(b.CanchaBloqueoHoraDesde)} — ${hhmm(b.CanchaBloqueoHoraHasta)}`
                          : "Todo el día"}
                      </td>
                      <td className="px-3 py-2">
                        {b.CanchaBloqueoMotivo || (
                          <span className="text-gray-400">Sin motivo</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {puedeEliminar && (
                          <button
                            type="button"
                            onClick={() => handleDelete(b)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded cursor-pointer"
                            title="Eliminar bloqueo"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold mb-4">Nuevo bloqueo</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Cancha
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                  value={form.CanchaId}
                  onChange={(e) =>
                    setForm({ ...form, CanchaId: e.target.value })
                  }
                >
                  <option value="">Todas las canchas</option>
                  {canchas.map((c) => (
                    <option key={c.CanchaId} value={c.CanchaId}>
                      {c.CanchaNombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Fecha
                </label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                  value={form.CanchaBloqueoFecha}
                  onChange={(e) =>
                    setForm({ ...form, CanchaBloqueoFecha: e.target.value })
                  }
                />
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.todoElDia}
                  onChange={(e) =>
                    setForm({ ...form, todoElDia: e.target.checked })
                  }
                />
                Todo el día
              </label>

              {!form.todoElDia && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Desde
                    </label>
                    <input
                      type="time"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                      value={form.CanchaBloqueoHoraDesde}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          CanchaBloqueoHoraDesde: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Hasta
                    </label>
                    <input
                      type="time"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                      value={form.CanchaBloqueoHoraHasta}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          CanchaBloqueoHoraHasta: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Motivo
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Mantenimiento, feriado, evento privado..."
                  maxLength={100}
                  value={form.CanchaBloqueoMotivo}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaBloqueoMotivo: e.target.value,
                    })
                  }
                />
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
