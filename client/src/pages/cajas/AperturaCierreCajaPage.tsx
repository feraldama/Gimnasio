import { useEffect, useState } from "react";
import { getCajas } from "../../services/cajas.service";
import ActionButton from "../../components/common/Button/ActionButton";
import { LoadingState, PermissionDenied } from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import {
  aperturaCierreCaja,
  getEstadoAperturaPorUsuario,
  getTurnoActual,
} from "../../services/registrodiariocaja.service";
import { useAuth } from "../../contexts/useAuth";
import Swal from "sweetalert2";
import { formatMiles } from "../../utils/utils";
import { useNavigate, useLocation } from "react-router-dom";
import { fechaHoraTicket, generarTicketCierrePDF } from "../../utils/ticketCierreCaja";
import { perteneceAlTurno } from "../../utils/cierreCaja";

import type { Caja } from "../../types";

interface RegistroDiarioCaja {
  RegistroDiarioCajaId: number;
  CajaId: number;
  UsuarioId: string;
  RegistroDiarioCajaFecha: string;
  RegistroDiarioCajaMonto: number;
  TipoGastoId: number;
  TipoGastoGrupoId: number;
  RegistroDiarioCajaDetalle?: string;
  AperturaRef?: number | null;
}

export default function AperturaCierreCajaPage() {
  const [tipo, setTipo] = useState<"0" | "1">("0");
  const [tipoDisabled, setTipoDisabled] = useState(false);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cajaId, setCajaId] = useState<string | number>("");
  const [monto, setMonto] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [cajaDisabled, setCajaDisabled] = useState(false);
  const [registrosCaja, setRegistrosCaja] = useState<RegistroDiarioCaja[]>([]);
  const [descargarPDF, setDescargarPDF] = useState(false);
  const [operacionCompletada, setOperacionCompletada] = useState(false);

  useEffect(() => {
    const fetchCajas = async () => {
      try {
        setLoading(true);
        const data = await getCajas(1, 100);
        setCajas(data.data);
        // No establecer caja por defecto, el usuario debe seleccionar
      } catch {
        setError("Error al cargar cajas");
      } finally {
        setLoading(false);
      }
    };
    fetchCajas();
  }, []);

  useEffect(() => {
    // Lógica para detectar si el usuario tiene una caja aperturada
    const checkCajaAperturada = async () => {
      if (!user) return;
      try {
        const data = await getEstadoAperturaPorUsuario(user.id);
        // Si apertura > cierre, forzar cierre y deshabilitar el select de tipo y de caja
        if (data.aperturaId > data.cierreId) {
          setTipo("1"); // Cierre
          setTipoDisabled(true);
          setCajaDisabled(true); // Solo puede cerrar la caja que tiene abierta
          if (data.cajaId) setCajaId(data.cajaId);
        } else {
          // No tiene ninguna caja abierta, forzar apertura y deshabilitar solo el select de tipo
          setTipo("0");
          setTipoDisabled(true);
          setCajaDisabled(false); // Puede elegir la caja que desee
        }
      } catch {
        // Si hay error, no forzar nada
      }
    };
    checkCajaAperturada();
  }, [user, location.pathname]);

  useEffect(() => {
    if (error) {
      Swal.fire({
        icon: "warning",
        title: "Aviso",
        text: error,
        confirmButtonColor: "#2563eb",
      });
      setError(null);
    }
  }, [error]);

  // Obtener registros de la caja al cerrar
  const fetchRegistrosCaja = async () => {
    try {
      // Sólo los registros del turno del usuario en esta caja
      const data = await getTurnoActual(cajaId);
      setRegistrosCaja(data.data);
    } catch (error) {
      console.error("Error al cargar registros:", error);
      setRegistrosCaja([]);
    }
  };

  // Función para generar el PDF
  async function generarResumenCierrePDF(
    registrosPasados?: RegistroDiarioCaja[]
  ) {
    if (!user || !cajaId) return;

    // Usar registros pasados como parámetro o cargar nuevos si no se proporcionan
    let registrosParaUsar = registrosPasados || registrosCaja;

    if (registrosParaUsar.length === 0) {
      try {
        const data = await getTurnoActual(cajaId);
        registrosParaUsar = data.data;

        if (registrosParaUsar.length === 0) {
          Swal.fire({
            icon: "warning",
            title: "No hay registros",
            text: "No se han cargado los registros de caja. Intente descargar el PDF manualmente.",
            confirmButtonColor: "#2563eb",
          });
          return;
        }
      } catch (error) {
        console.error("Error al cargar registros para PDF:", error);
        Swal.fire({
          icon: "warning",
          title: "Error al cargar registros",
          text: "No se pudieron cargar los registros de caja.",
          confirmButtonColor: "#2563eb",
        });
        return;
      }
    }

    const cajaDescripcion =
      cajas.find((c) => c.CajaId == cajaId)?.CajaDescripcion || "";

    // --- Nueva lógica: buscar última apertura y cierre del usuario ---
    const registros = registrosParaUsar.filter((r) => r.UsuarioId == user.id);

    // Buscar la última apertura del usuario (ordenar por ID descendente y tomar el primero)
    const aperturas = registros
      .filter((reg) => reg.TipoGastoId === 2 && reg.TipoGastoGrupoId === 2)
      .sort((a, b) => b.RegistroDiarioCajaId - a.RegistroDiarioCajaId);

    const aperturaReg = aperturas[0];
    if (!aperturaReg) {
      Swal.fire({
        icon: "warning",
        title: "No se encontró apertura",
        text: "No se encontró una apertura de caja para este usuario. Los registros pueden estar en proceso de carga.",
        confirmButtonColor: "#2563eb",
      });
      return;
    }

    // Buscar el último cierre del usuario (ordenar por ID descendente y tomar el primero)
    const cierres = registros
      .filter((reg) => reg.TipoGastoId === 1 && reg.TipoGastoGrupoId === 2)
      .sort((a, b) => b.RegistroDiarioCajaId - a.RegistroDiarioCajaId);

    const cierreReg = cierres[0];
    if (!cierreReg) {
      Swal.fire({
        icon: "warning",
        title: "No se encontró cierre",
        text: "No se encontró un cierre de caja para este usuario.",
        confirmButtonColor: "#2563eb",
      });
      return;
    }

    // Verificar que el cierre sea posterior a la apertura
    if (cierreReg.RegistroDiarioCajaId <= aperturaReg.RegistroDiarioCajaId) {
      Swal.fire({
        icon: "warning",
        title: "Error en registros",
        text: "El cierre debe ser posterior a la apertura. Verifique los registros.",
        confirmButtonColor: "#2563eb",
      });
      return;
    }

    // Movimientos del turno. Misma regla que el reporte: los que cargó una
    // corrección después del cierre llevan AperturaRef y también cuentan.
    const registrosFiltrados = registrosParaUsar.filter(
      (reg) =>
        reg.UsuarioId == user.id &&
        perteneceAlTurno(
          reg,
          aperturaReg.RegistroDiarioCajaId,
          cierreReg.RegistroDiarioCajaId
        )
    );
    // Fecha y hora del cierre, no las de ahora: si el cajero vuelve a
    // descargar el ticket más tarde tiene que salir igual.
    const { fecha, hora } = fechaHoraTicket(
      new Date(cierreReg.RegistroDiarioCajaFecha)
    );
    await generarTicketCierrePDF({
      fecha,
      hora,
      usuario: user.nombre,
      caja: cajaDescripcion,
      apertura: aperturaReg.RegistroDiarioCajaMonto,
      cierre: cierreReg.RegistroDiarioCajaMonto,
      registros: registrosFiltrados,
    });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    setOperacionCompletada(true); // Deshabilitar el botón inmediatamente
    try {
      const result = await aperturaCierreCaja({
        apertura: tipo === "0" ? 0 : 1,
        CajaId: cajaId,
        Monto: monto,
      });
      if (tipo === "0") {
        await Swal.fire({
          icon: "success",
          title: "Apertura exitosa",
          text: result.message || "La caja se aperturó correctamente",
          confirmButtonText: "Ir a ventas",
          confirmButtonColor: "#2563eb",
        });
        navigate("/ventas");
      } else {
        setSuccess(result.message || "Operación realizada correctamente");
        await fetchRegistrosCaja();
        setDescargarPDF(true);
        // Descarga automática del PDF después de cargar registros
        setTimeout(async () => {
          await generarResumenCierrePDF();
        }, 2000); // Reducir el delay inicial
      }
    } catch (err) {
      setError(
        (err as { message?: string })?.message || "Error en la operación"
      );
      setOperacionCompletada(false); // Rehabilitar el botón si hay error
    } finally {
      setSubmitting(false);
    }
  };

  const puedeLeer = usePermiso("APERTURACAJA", "leer");
  if (!puedeLeer) return <PermissionDenied resource="la apertura/cierre de caja" />;
  if (loading) return <LoadingState message="Cargando cajas..." />;

  return (
    <div className="container mx-auto px-4 max-w-xl">
      <h1 className="text-2xl font-medium mb-6">Apertura/Cierre de Caja</h1>
      {user && (
        <div className="mb-4 p-3 bg-gray-100 rounded text-gray-700">
          <span className="font-semibold">Usuario:</span> {user.nombre} (
          {user.id})
          {tipoDisabled && cajaId && (
            <span className="ml-2 text-sm text-gray-600">
              | Caja:{" "}
              {cajas.find((c) => c.CajaId == cajaId)?.CajaDescripcion || ""}
            </span>
          )}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow p-6 space-y-6"
      >
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-gray-900">
              Tipo de operación
            </label>
            <select
              className={`bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${
                tipoDisabled ? "bg-gray-200 text-gray-500" : ""
              }`}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "0" | "1")}
              required
              disabled={tipoDisabled}
            >
              <option value="0">Apertura</option>
              <option value="1">Cierre</option>
            </select>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-gray-900">
              Caja
            </label>
            <select
              className={`bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 ${
                cajaDisabled ? "bg-gray-200 text-gray-500" : ""
              }`}
              value={cajaId}
              onChange={(e) => setCajaId(e.target.value)}
              required
              disabled={cajaDisabled}
            >
              <option value="">Seleccione una caja</option>
              {cajas.map((caja) => (
                <option key={caja.CajaId} value={caja.CajaId}>
                  {caja.CajaDescripcion}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-gray-900">
              {tipo === "1" ? "Monto de cierre" : "Monto de apertura"}
            </label>
            <input
              type="text"
              inputMode="numeric"
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
              value={monto ? formatMiles(monto) : ""}
              onChange={(e) => {
                const raw = e.target.value
                  .replace(/\./g, "")
                  .replace(/\s/g, "");
                const num = Number(raw);
                if (!isNaN(num)) setMonto(num);
              }}
              min={0}
              required
            />
          </div>
        </div>
        <div className="flex justify-end">
          <ActionButton
            onClick={handleSubmit}
            label="CONFIRMAR"
            disabled={submitting || operacionCompletada}
          />
        </div>
        {success && (
          <div className="text-green-600 text-center font-medium mt-2">
            {success}
          </div>
        )}
      </form>
      {success && tipo === "1" && descargarPDF && (
        <div className="flex justify-center mt-4">
          <ActionButton
            label="Descargar Resumen PDF"
            onClick={() => generarResumenCierrePDF()}
          />
        </div>
      )}
    </div>
  );
}
