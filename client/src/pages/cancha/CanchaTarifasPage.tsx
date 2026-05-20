import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import {
  getCanchasActivas,
  getTarifasByCancha,
  createTarifa,
  updateTarifa,
  deleteTarifa,
  type Cancha,
  type CanchaTarifa,
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
import { formatMiles } from "../../utils/utils";

const DIAS = [
  { sigla: "L", label: "Lun" },
  { sigla: "M", label: "Mar" },
  { sigla: "X", label: "Mié" },
  { sigla: "J", label: "Jue" },
  { sigla: "V", label: "Vie" },
  { sigla: "S", label: "Sáb" },
  { sigla: "D", label: "Dom" },
];

// Convierte "L,M,X,J,V" → ["L","M","X","J","V"].
function parseDias(csv: string): string[] {
  return (csv || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function formatDias(dias: string): string {
  const set = new Set(parseDias(dias));
  const seleccionados = DIAS.filter((d) => set.has(d.sigla)).map((d) => d.label);
  if (seleccionados.length === 7) return "Todos los días";
  if (seleccionados.length === 5 && !set.has("S") && !set.has("D"))
    return "Lun a Vie";
  if (seleccionados.length === 2 && set.has("S") && set.has("D"))
    return "Sáb y Dom";
  return seleccionados.join(", ") || "—";
}

// Quita los segundos de un TIME "HH:MM:SS" → "HH:MM".
function hhmm(t: string): string {
  if (!t) return "";
  return t.length >= 5 ? t.substring(0, 5) : t;
}

interface FormState {
  CanchaTarifaId: number;
  CanchaId: number;
  CanchaTarifaNombre: string;
  CanchaTarifaDiasSemana: string;
  CanchaTarifaHoraDesde: string;
  CanchaTarifaHoraHasta: string;
  CanchaTarifaPrecio: number;
  CanchaTarifaPrioridad: number;
  CanchaTarifaActiva: number;
}

const emptyForm = (canchaId: number): FormState => ({
  CanchaTarifaId: 0,
  CanchaId: canchaId,
  CanchaTarifaNombre: "",
  CanchaTarifaDiasSemana: "L,M,X,J,V,S,D",
  CanchaTarifaHoraDesde: "06:00",
  CanchaTarifaHoraHasta: "23:00",
  CanchaTarifaPrecio: 0,
  CanchaTarifaPrioridad: 0,
  CanchaTarifaActiva: 1,
});

export default function CanchaTarifasPage() {
  const puedeLeer = usePermiso("CANCHATARIFA", "leer");
  const puedeCrear = usePermiso("CANCHATARIFA", "crear");
  const puedeEditar = usePermiso("CANCHATARIFA", "editar");
  const puedeEliminar = usePermiso("CANCHATARIFA", "eliminar");

  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [canchaId, setCanchaId] = useState<number>(0);
  const [tarifas, setTarifas] = useState<CanchaTarifa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(0));
  const [saving, setSaving] = useState(false);

  // Cargar canchas una sola vez.
  useEffect(() => {
    if (!puedeLeer) return;
    (async () => {
      try {
        const r = await getCanchasActivas();
        setCanchas(r.data);
        if (r.data.length > 0) setCanchaId(r.data[0].CanchaId);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Error al cargar canchas");
      } finally {
        setLoading(false);
      }
    })();
  }, [puedeLeer]);

  // Recargar tarifas cuando cambia la cancha seleccionada.
  const fetchTarifas = useCallback(async (id: number) => {
    if (!id) {
      setTarifas([]);
      return;
    }
    try {
      const r = await getTarifasByCancha(id);
      setTarifas(r.data);
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "Error al cargar tarifas",
      });
    }
  }, []);

  useEffect(() => {
    if (canchaId) fetchTarifas(canchaId);
  }, [canchaId, fetchTarifas]);

  const handleNew = () => {
    setForm(emptyForm(canchaId));
    setModalOpen(true);
  };

  const handleEdit = (t: CanchaTarifa) => {
    setForm({
      CanchaTarifaId: t.CanchaTarifaId,
      CanchaId: t.CanchaId,
      CanchaTarifaNombre: t.CanchaTarifaNombre,
      CanchaTarifaDiasSemana: t.CanchaTarifaDiasSemana,
      CanchaTarifaHoraDesde: hhmm(t.CanchaTarifaHoraDesde),
      CanchaTarifaHoraHasta: hhmm(t.CanchaTarifaHoraHasta),
      CanchaTarifaPrecio: t.CanchaTarifaPrecio,
      CanchaTarifaPrioridad: t.CanchaTarifaPrioridad,
      CanchaTarifaActiva: t.CanchaTarifaActiva,
    });
    setModalOpen(true);
  };

  const handleToggleActiva = async (t: CanchaTarifa) => {
    try {
      await updateTarifa(t.CanchaTarifaId, {
        CanchaTarifaActiva: t.CanchaTarifaActiva === 1 ? 0 : 1,
      });
      fetchTarifas(canchaId);
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo actualizar",
      });
    }
  };

  const handleDelete = async (t: CanchaTarifa) => {
    const r = await Swal.fire({
      title: `¿Eliminar tarifa "${t.CanchaTarifaNombre || "sin nombre"}"?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#dc2626",
    });
    if (!r.isConfirmed) return;
    try {
      await deleteTarifa(t.CanchaTarifaId);
      fetchTarifas(canchaId);
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo eliminar",
      });
    }
  };

  const toggleDia = (sigla: string) => {
    const set = new Set(parseDias(form.CanchaTarifaDiasSemana));
    if (set.has(sigla)) set.delete(sigla);
    else set.add(sigla);
    // Mantener el orden L,M,X,J,V,S,D
    const csv = DIAS.filter((d) => set.has(d.sigla))
      .map((d) => d.sigla)
      .join(",");
    setForm({ ...form, CanchaTarifaDiasSemana: csv });
  };

  const setDiasShortcut = (kind: "todos" | "habiles" | "finde") => {
    const map = {
      todos: "L,M,X,J,V,S,D",
      habiles: "L,M,X,J,V",
      finde: "S,D",
    };
    setForm({ ...form, CanchaTarifaDiasSemana: map[kind] });
  };

  const handleSubmit = async () => {
    if (!parseDias(form.CanchaTarifaDiasSemana).length) {
      Swal.fire({ icon: "warning", title: "Seleccioná al menos un día" });
      return;
    }
    if (form.CanchaTarifaHoraHasta <= form.CanchaTarifaHoraDesde) {
      Swal.fire({
        icon: "warning",
        title: "La hora 'hasta' debe ser posterior a 'desde'",
      });
      return;
    }
    try {
      setSaving(true);
      if (form.CanchaTarifaId) {
        await updateTarifa(form.CanchaTarifaId, form);
      } else {
        await createTarifa(form);
      }
      setModalOpen(false);
      fetchTarifas(canchaId);
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

  if (!puedeLeer) return <PermissionDenied resource="las tarifas de canchas" />;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  if (canchas.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader title="Tarifas por banda horaria" />
          <div className="text-center text-gray-500 py-6">
            No hay canchas activas. Andá a{" "}
            <a href="/canchas" className="text-blue-600 underline">
              Catálogo
            </a>{" "}
            para agregar una.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Card>
        <CardHeader
          title="Tarifas por banda horaria"
          description="Definí precios diferentes según día y hora. El sistema sugiere el monto al crear reservas en base a estas bandas; si ninguna matchea usa la tarifa flat de la cancha."
          actions={
            puedeCrear && (
              <Button
                variant="primary"
                onClick={handleNew}
                className="cursor-pointer"
                disabled={!canchaId}
              >
                Nueva banda
              </Button>
            )
          }
        />

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Cancha</label>
          <select
            className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
            value={canchaId}
            onChange={(e) => setCanchaId(Number(e.target.value))}
          >
            {canchas.map((c) => (
              <option key={c.CanchaId} value={c.CanchaId}>
                {c.CanchaNombre}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Días</th>
                <th className="px-3 py-2 text-left">Horario</th>
                <th className="px-3 py-2 text-right">Precio/h</th>
                <th className="px-3 py-2 text-center">Prioridad</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tarifas.map((t) => (
                <tr key={t.CanchaTarifaId}>
                  <td className="px-3 py-2 font-medium">
                    {t.CanchaTarifaNombre || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {formatDias(t.CanchaTarifaDiasSemana)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {hhmm(t.CanchaTarifaHoraDesde)} —{" "}
                    {hhmm(t.CanchaTarifaHoraHasta)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    Gs. {formatMiles(t.CanchaTarifaPrecio)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {t.CanchaTarifaPrioridad}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge
                      tone={t.CanchaTarifaActiva === 1 ? "success" : "neutral"}
                    >
                      {t.CanchaTarifaActiva === 1 ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    {puedeEditar && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(t)}
                          className="cursor-pointer"
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            t.CanchaTarifaActiva === 1 ? "warning" : "success"
                          }
                          onClick={() => handleToggleActiva(t)}
                          className="cursor-pointer"
                        >
                          {t.CanchaTarifaActiva === 1 ? "Desactivar" : "Activar"}
                        </Button>
                      </>
                    )}
                    {puedeEliminar && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDelete(t)}
                        className="cursor-pointer"
                      >
                        Eliminar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {tarifas.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-gray-500"
                  >
                    No hay tarifas definidas para esta cancha. Sin bandas, las
                    reservas usarán la tarifa flat de la cancha como fallback.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">
              {form.CanchaTarifaId ? "Editar banda" : "Nueva banda"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Nombre de la banda
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Ej. HORA PICO NOCTURNA"
                  value={form.CanchaTarifaNombre}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaTarifaNombre: e.target.value.toUpperCase(),
                    })
                  }
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-2">
                  Días de la semana
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {DIAS.map((d) => {
                    const activo = parseDias(form.CanchaTarifaDiasSemana).includes(
                      d.sigla
                    );
                    return (
                      <button
                        key={d.sigla}
                        type="button"
                        onClick={() => toggleDia(d.sigla)}
                        className={`px-3 py-1.5 text-sm rounded-md border cursor-pointer transition-colors ${
                          activo
                            ? "bg-blue-600 text-white border-blue-700"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDiasShortcut("todos")}
                    className="text-blue-600 hover:underline cursor-pointer"
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiasShortcut("habiles")}
                    className="text-blue-600 hover:underline cursor-pointer"
                  >
                    Lun-Vie
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiasShortcut("finde")}
                    className="text-blue-600 hover:underline cursor-pointer"
                  >
                    Sáb-Dom
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Desde
                  </label>
                  <input
                    type="time"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                    value={form.CanchaTarifaHoraDesde}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        CanchaTarifaHoraDesde: e.target.value,
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
                    value={form.CanchaTarifaHoraHasta}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        CanchaTarifaHoraHasta: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Precio por hora (Gs.)
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md tabular-nums"
                  value={form.CanchaTarifaPrecio}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaTarifaPrecio: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Prioridad
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md tabular-nums"
                    value={form.CanchaTarifaPrioridad}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        CanchaTarifaPrioridad: Number(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    Mayor número gana si dos bandas se solapan.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Estado
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer"
                    value={form.CanchaTarifaActiva}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        CanchaTarifaActiva: Number(e.target.value),
                      })
                    }
                  >
                    <option value={1}>Activa</option>
                    <option value={0}>Inactiva</option>
                  </select>
                </div>
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
