import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import {
  getReservas,
  searchReservas,
  createReserva,
  updateReserva,
  deleteReserva,
  getCanchasActivas,
  type Cancha,
  type CanchaReserva,
} from "../../services/cancha.service";
import { getAllClientesSinPaginacion } from "../../services/clientes.service";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Button,
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
  TextInput,
  Badge,
} from "../../components/common/ui";
import Pagination from "../../components/common/Pagination";
import { formatMiles } from "../../utils/utils";

interface ClienteOpt {
  ClienteId: number;
  ClienteNombre: string;
  ClienteApellido?: string;
}

interface PaginationMeta {
  totalItems: number;
  totalPages: number;
}

const ESTADO_LABELS: Record<string, { label: string; tone: "neutral" | "success" | "danger" | "warning" }> = {
  R: { label: "Reservada", tone: "warning" },
  P: { label: "Pagada", tone: "success" },
  X: { label: "Cancelada", tone: "danger" },
};

const emptyForm = () => ({
  CanchaReservaId: 0,
  CanchaId: 0,
  ClienteId: null as number | null,
  CanchaReservaCliente: "",
  CanchaReservaFecha: new Date().toISOString().slice(0, 10),
  CanchaReservaHoraInicio: "",
  CanchaReservaHoraFin: "",
  CanchaReservaMonto: 0,
  CanchaReservaEstado: "R",
  CanchaReservaObservacion: "",
});

function dtLocal(fecha: string, hora: string): string {
  // Construye un timestamp local "YYYY-MM-DD HH:MM:SS" para el backend.
  if (!fecha || !hora) return "";
  const h = hora.length === 5 ? hora + ":00" : hora;
  return `${fecha} ${h}`;
}

function formatHora(ts?: string): string {
  if (!ts) return "—";
  // Convertimos a Date para que getHours/getMinutes apliquen la zona horaria
  // del navegador. Si usamos regex sobre el ISO el valor sale en UTC.
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    const m = ts.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : ts;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export default function CanchaPage() {
  const puedeLeer = usePermiso("CANCHA", "leer");
  const puedeCrear = usePermiso("CANCHA", "crear");
  const puedeEditar = usePermiso("CANCHA", "editar");
  const puedeEliminar = usePermiso("CANCHA", "eliminar");

  const [reservas, setReservas] = useState<CanchaReserva[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    totalItems: 0,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [clientes, setClientes] = useState<ClienteOpt[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const r = appliedSearch
        ? await searchReservas(appliedSearch, page, itemsPerPage)
        : await getReservas(page, itemsPerPage);
      setReservas(r.data);
      setPagination(r.pagination);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar reservas");
    } finally {
      setLoading(false);
    }
  }, [page, itemsPerPage, appliedSearch]);

  useEffect(() => {
    if (!puedeLeer) return;
    fetchData();
  }, [puedeLeer, fetchData]);

  useEffect(() => {
    if (!puedeLeer) return;
    (async () => {
      try {
        const [cR, clR] = await Promise.all([
          getCanchasActivas(),
          getAllClientesSinPaginacion(),
        ]);
        setCanchas(cR.data);
        setClientes(clR);
      } catch {
        /* silenciar; los selects quedaran vacios y se muestra error general si reservas fallan */
      }
    })();
  }, [puedeLeer]);

  const handleNew = () => {
    setForm({
      ...emptyForm(),
      CanchaId: canchas[0]?.CanchaId ?? 0,
    });
    setModalOpen(true);
  };

  const handleEdit = (r: CanchaReserva) => {
    setForm({
      CanchaReservaId: r.CanchaReservaId,
      CanchaId: r.CanchaId,
      ClienteId: r.ClienteId ?? null,
      CanchaReservaCliente: r.CanchaReservaCliente || "",
      CanchaReservaFecha: r.CanchaReservaFecha?.slice(0, 10) || "",
      CanchaReservaHoraInicio: formatHora(r.CanchaReservaHoraInicio),
      CanchaReservaHoraFin: formatHora(r.CanchaReservaHoraFin),
      CanchaReservaMonto: r.CanchaReservaMonto || 0,
      CanchaReservaEstado: r.CanchaReservaEstado || "R",
      CanchaReservaObservacion: r.CanchaReservaObservacion || "",
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    const c = await Swal.fire({
      title: "¿Eliminar reserva?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
    });
    if (!c.isConfirmed) return;
    try {
      await deleteReserva(id);
      fetchData();
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo eliminar",
      });
    }
  };

  const handleSubmit = async () => {
    if (!form.CanchaId) {
      Swal.fire({ icon: "warning", title: "Falta cancha" });
      return;
    }
    if (!form.CanchaReservaHoraInicio || !form.CanchaReservaHoraFin) {
      Swal.fire({ icon: "warning", title: "Faltan horarios" });
      return;
    }
    const payload = {
      CanchaId: form.CanchaId,
      ClienteId: form.ClienteId,
      CanchaReservaCliente: form.CanchaReservaCliente,
      CanchaReservaFecha: form.CanchaReservaFecha,
      CanchaReservaHoraInicio: dtLocal(
        form.CanchaReservaFecha,
        form.CanchaReservaHoraInicio
      ),
      CanchaReservaHoraFin: dtLocal(
        form.CanchaReservaFecha,
        form.CanchaReservaHoraFin
      ),
      CanchaReservaMonto: Number(form.CanchaReservaMonto) || 0,
      CanchaReservaEstado: form.CanchaReservaEstado,
      CanchaReservaObservacion: form.CanchaReservaObservacion,
    };
    try {
      if (form.CanchaReservaId) {
        await updateReserva(form.CanchaReservaId, payload);
      } else {
        await createReserva(payload);
      }
      setModalOpen(false);
      fetchData();
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo guardar",
      });
    }
  };

  const canchaNombreById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of canchas) m.set(c.CanchaId, c.CanchaNombre);
    return m;
  }, [canchas]);

  if (!puedeLeer) return <PermissionDenied />;

  return (
    <div className="p-6">
      <Card>
        <CardHeader
          title="Cancha — Reservas"
          description="Registro de reservas de cancha. Las reservas en estado 'Pagada' alimentan el reporte diario."
          actions={
            puedeCrear && (
              <Button variant="primary" onClick={handleNew}>
                Nueva reserva
              </Button>
            )
          }
        />

        <div className="flex gap-2 mb-4">
          <TextInput
            placeholder="Buscar por cliente o cancha..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setAppliedSearch(searchTerm);
                setPage(1);
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              setAppliedSearch(searchTerm);
              setPage(1);
            }}
          >
            Buscar
          </Button>
          {appliedSearch && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchTerm("");
                setAppliedSearch("");
                setPage(1);
              }}
            >
              Limpiar
            </Button>
          )}
        </div>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cancha</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Horario</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {reservas.map((r) => {
                  const estado = ESTADO_LABELS[r.CanchaReservaEstado] || ESTADO_LABELS.R;
                  return (
                    <tr key={r.CanchaReservaId}>
                      <td className="px-3 py-2">
                        {r.CanchaReservaFecha?.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        {r.CanchaNombre || canchaNombreById.get(r.CanchaId) || `Cancha ${r.CanchaId}`}
                      </td>
                      <td className="px-3 py-2">
                        {r.ClienteNombre
                          ? `${r.ClienteNombre} ${r.ClienteApellido ?? ""}`.trim()
                          : r.CanchaReservaCliente || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {formatHora(r.CanchaReservaHoraInicio)} — {formatHora(r.CanchaReservaHoraFin)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        Gs. {formatMiles(r.CanchaReservaMonto)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge tone={estado.tone}>{estado.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right space-x-2">
                        {puedeEditar && (
                          <Button size="sm" variant="outline" onClick={() => handleEdit(r)}>
                            Editar
                          </Button>
                        )}
                        {puedeEliminar && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDelete(r.CanchaReservaId)}
                          >
                            Eliminar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {reservas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      Sin reservas registradas.
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
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6">
            <h2 className="text-lg font-semibold mb-4">
              {form.CanchaReservaId ? "Editar reserva" : "Nueva reserva"}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Cancha</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaId}
                  onChange={(e) =>
                    setForm({ ...form, CanchaId: Number(e.target.value) })
                  }
                >
                  <option value={0}>— Seleccionar —</option>
                  {canchas.map((c) => (
                    <option key={c.CanchaId} value={c.CanchaId}>
                      {c.CanchaNombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Cliente (opcional)
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.ClienteId ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      ClienteId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">— Invitado / externo —</option>
                  {clientes.map((c) => (
                    <option key={c.ClienteId} value={c.ClienteId}>
                      {c.ClienteNombre} {c.ClienteApellido ?? ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Nombre (si es invitado)
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaCliente}
                  onChange={(e) =>
                    setForm({ ...form, CanchaReservaCliente: e.target.value })
                  }
                  disabled={!!form.ClienteId}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaFecha}
                  onChange={(e) =>
                    setForm({ ...form, CanchaReservaFecha: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Estado</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaEstado}
                  onChange={(e) =>
                    setForm({ ...form, CanchaReservaEstado: e.target.value })
                  }
                >
                  <option value="R">Reservada</option>
                  <option value="P">Pagada</option>
                  <option value="X">Cancelada</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Hora inicio
                </label>
                <input
                  type="time"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaHoraInicio}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaReservaHoraInicio: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Hora fin
                </label>
                <input
                  type="time"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaHoraFin}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaReservaHoraFin: e.target.value,
                    })
                  }
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Monto (Gs.)
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaMonto}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaReservaMonto: Number(e.target.value),
                    })
                  }
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Observación
                </label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={form.CanchaReservaObservacion}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      CanchaReservaObservacion: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={handleSubmit}>
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
