import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { recibirPagoCredito } from "../../services/venta.service";
import { usePermiso } from "../../hooks/usePermiso";
import { PermissionDenied } from "../../components/common/ui";
import Swal from "sweetalert2";
import { getAllClientesSinPaginacion } from "../../services/clientes.service";
import { formatCurrency, formatMiles, formatDateLocal } from "../../utils/utils";
import { getVentasPendientesPorCliente } from "../../services/venta.service";
import { useAuth } from "../../contexts/useAuth";
import { getEstadoAperturaPorUsuario } from "../../services/registrodiariocaja.service";
import { getCajaById } from "../../services/cajas.service";
import ClienteModal from "../../components/common/ClienteModal";
import type { Cliente } from "../../components/common/ClienteFormModal";
import {
  getCreditosPendientesPorCliente,
  cobrarCreditoCancha,
  type CanchaCredito,
} from "../../services/canchaCredito.service";

interface VentaPendiente {
  VentaId: number;
  VentaFecha: string;
  Total: number;
  VentaEntrega: number;
  Saldo: number;
}

import type { Caja } from "../../types";

const TIPOS_PAGO = [
  { value: "CO", label: "Contado" },
  { value: "CR", label: "Crédito" },
  { value: "PO", label: "POS" },
  { value: "TR", label: "Transfer" },
];

const CreditoPagosPage = () => {
  const puedeLeerPagos = usePermiso("COBROCREDITO", "leer");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<string>("");
  const [clienteSeleccionado, setClienteSeleccionado] =
    useState<Cliente | null>(null);
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [ventasPendientes, setVentasPendientes] = useState<VentaPendiente[]>(
    []
  );
  const [creditosCancha, setCreditosCancha] = useState<CanchaCredito[]>([]);
  const [tipoPago, setTipoPago] = useState<string>("CO");
  const [montoPago, setMontoPago] = useState<number>(0);
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [totalDeuda, setTotalDeuda] = useState<number>(0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cajaAperturada, setCajaAperturada] = useState<Caja | null>(null);

  useEffect(() => {
    const fetchCaja = async () => {
      if (!user?.id) return;
      try {
        const estado = await getEstadoAperturaPorUsuario(user.id);
        if (estado.cajaId && estado.aperturaId > estado.cierreId) {
          const caja = await getCajaById(estado.cajaId);
          setCajaAperturada(caja);
        } else {
          Swal.fire({
            icon: "warning",
            title: "Caja no aperturada",
            text: "Debes aperturar una caja antes de registrar un pago.",
            confirmButtonColor: "#2563eb",
          }).then(() => {
            navigate("/apertura-cierre-caja");
          });
          setCajaAperturada(null);
        }
      } catch {
        setCajaAperturada(null);
      }
    };
    fetchCaja();
  }, [user, navigate]);

  useEffect(() => {
    const cargarClientes = async () => {
      try {
        const response = await getAllClientesSinPaginacion();
        setClientes(response.data || []);
      } catch (error) {
        console.error("Error al cargar clientes:", error);
      }
    };

    cargarClientes();
  }, []);

  const handleClienteChange = async (clienteId: string) => {
    setSelectedCliente(clienteId);
    setVentasPendientes([]);
    setCreditosCancha([]);
    setTotalDeuda(0);

    if (!clienteId) {
      return;
    }

    try {
      // Cargamos en paralelo deudas de ventas (cantina) y deudas de canchas
      // — ambas se muestran en la misma vista para que el usuario vea todo
      // lo que el cliente debe en un solo lugar.
      // allSettled (no all): si UNO de los endpoints falla, igual mostramos lo
      // que el otro devolvió. Con Promise.all un solo error ocultaba ambas
      // tablas a la vez.
      const localId = user?.LocalId;
      const [resVentasR, resCanchaR] = await Promise.allSettled([
        getVentasPendientesPorCliente(Number(clienteId), localId),
        getCreditosPendientesPorCliente(Number(clienteId)),
      ]);

      if (resVentasR.status === "rejected") {
        console.error("Error al cargar ventas pendientes:", resVentasR.reason);
      }
      if (resCanchaR.status === "rejected") {
        console.error("Error al cargar créditos de cancha:", resCanchaR.reason);
      }

      const ventasPendientes =
        resVentasR.status === "fulfilled" ? resVentasR.value.data || [] : [];
      const creditosCanchaList =
        resCanchaR.status === "fulfilled" ? resCanchaR.value.data || [] : [];

      const deudaVentas = ventasPendientes.reduce(
        (sum: number, venta: VentaPendiente) => sum + Number(venta.Saldo),
        0
      );
      const deudaCancha = creditosCanchaList.reduce(
        (sum: number, c: CanchaCredito) => sum + Number(c.CanchaCreditoSaldo),
        0
      );

      setVentasPendientes(ventasPendientes);
      setCreditosCancha(creditosCanchaList);
      setTotalDeuda(deudaVentas + deudaCancha);
    } catch (error) {
      console.error("Error al cargar deudas del cliente:", error);
    }
  };

  // Cobrar uno de los créditos de cancha. Por simplicidad usamos un Swal con
  // los métodos disponibles (sin CR — no se puede pagar deuda con deuda).
  const handleCobrarCreditoCancha = async (credito: CanchaCredito) => {
    const saldoActual = Number(credito.CanchaCreditoSaldo) || 0;
    const { value: formValues } = await Swal.fire<{
      tipo: "CO" | "PO" | "VO" | "TR";
      monto: number;
    }>({
      title: `Cobrar crédito reserva #${credito.CanchaReservaId}`,
      html: `
        <div style="text-align:left;font-size:14px">
          <p>Saldo pendiente: <strong>Gs. ${formatMiles(saldoActual)}</strong></p>
          <label style="display:block;margin-top:12px;font-size:12px;color:#6b7280">Método</label>
          <select id="swal-tipo" class="swal2-select" style="margin:4px 0">
            <option value="CO">Contado</option>
            <option value="PO">POS</option>
            <option value="VO">Voucher</option>
            <option value="TR">Transferencia</option>
          </select>
          <label style="display:block;margin-top:8px;font-size:12px;color:#6b7280">Monto a cobrar</label>
          <input id="swal-monto" class="swal2-input" type="text" inputmode="numeric"
            value="${formatMiles(saldoActual)}" style="margin:4px 0;text-align:right" />
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Cobrar",
      confirmButtonColor: "#16a34a",
      cancelButtonText: "Cancelar",
      focusConfirm: false,
      preConfirm: () => {
        const tipoEl = document.getElementById("swal-tipo") as HTMLSelectElement;
        const montoEl = document.getElementById("swal-monto") as HTMLInputElement;
        const tipo = tipoEl?.value as "CO" | "PO" | "VO" | "TR";
        const raw = (montoEl?.value || "").replace(/\./g, "").replace(/\s/g, "");
        const monto = Number(raw);
        if (!Number.isFinite(monto) || monto <= 0) {
          Swal.showValidationMessage("Ingresá un monto mayor a 0");
          return false;
        }
        if (monto > saldoActual) {
          Swal.showValidationMessage(
            `El monto supera el saldo pendiente (Gs. ${formatMiles(saldoActual)})`
          );
          return false;
        }
        return { tipo, monto };
      },
    });
    if (!formValues) return;
    try {
      await cobrarCreditoCancha(credito.CanchaCreditoId, [
        { tipo: formValues.tipo, monto: formValues.monto },
      ]);
      await Swal.fire({
        icon: "success",
        title: "Cobro registrado",
        text: `Se aplicó Gs. ${formatMiles(formValues.monto)} al crédito.`,
        timer: 1800,
        showConfirmButton: false,
      });
      // Recargar la lista del cliente
      handleClienteChange(selectedCliente);
    } catch (e) {
      const err = e as { message?: string; code?: string };
      Swal.fire({
        icon: "error",
        title: err.code === "SIN_CAJA" ? "Sin caja abierta" : "No se pudo cobrar",
        text: err.message || "Error al cobrar el crédito",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCliente) {
      Swal.fire("Error", "Seleccione un cliente.", "error");
      return;
    }
    if (montoPago <= 0) {
      Swal.fire("Error", "Ingrese un monto a cobrar", "error");
      return;
    }
    if (montoPago > totalDeuda) {
      Swal.fire(
        "Error",
        "El monto a cobrar no puede ser mayor al saldo total",
        "error"
      );
      return;
    }
    if (!cajaAperturada) {
      Swal.fire("Error", "No hay una caja aperturada.", "error");
      return;
    }

    try {
      await recibirPagoCredito({
        Tipo: "V",
        ClienteId: Number(selectedCliente),
        MontoRecibido: montoPago,
        CajaId: Number(cajaAperturada.CajaId),
        UsuarioId: String(user?.id ?? ""),
        Fecha: fecha,
        VentaPagoTipo: tipoPago as "CO" | "PO" | "TR",
      });

      let timerInterval: ReturnType<typeof setInterval>;
      Swal.fire({
        title: "Pago cargado con éxito!",
        html: "Actualizando en <b></b> segundos.",
        timer: 2000,
        timerProgressBar: true,
        width: "90%",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
          const popup = Swal.getPopup();
          if (popup) {
            const timer = popup.querySelector("b");
            if (timer) {
              timerInterval = setInterval(() => {
                const timerLeft = Swal.getTimerLeft();
                const secondsLeft = timerLeft ? Math.ceil(timerLeft / 1000) : 0;
                timer.textContent = `${secondsLeft}`;
              }, 100);
            }
          }
        },
        willClose: () => {
          clearInterval(timerInterval);
        },
      }).then((result) => {
        if (result.dismiss === Swal.DismissReason.timer) {
          handleClienteChange(selectedCliente);
          setMontoPago(0);
        }
      });
    } catch (error) {
      console.error("Error al procesar el pago:", error);
      Swal.fire("Error", "Hubo un problema al procesar el pago.", "error");
    }
  };

  if (!puedeLeerPagos)
    return <PermissionDenied resource="el cobro de créditos" />;

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-medium mb-3">Cobro de Créditos</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Formulario de pago */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cliente
              </label>
              <div className="flex gap-2 items-stretch">
                <button
                  type="button"
                  onClick={() => setShowClienteModal(true)}
                  className="flex-1 px-3 h-10 border border-gray-300 rounded-md text-left text-sm bg-white hover:bg-gray-50 cursor-pointer transition-colors flex items-center justify-between"
                  title="Abrir buscador de clientes"
                >
                  {clienteSeleccionado ? (
                    <span className="font-medium text-gray-900">
                      {clienteSeleccionado.ClienteNombre}{" "}
                      {clienteSeleccionado.ClienteApellido ?? ""}
                      {clienteSeleccionado.ClienteRUC ? (
                        <span className="ml-2 text-xs text-gray-500 tabular-nums">
                          {clienteSeleccionado.ClienteRUC}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      — Seleccionar cliente —{" "}
                      <span className="text-blue-600 underline">
                        Buscar cliente
                      </span>
                    </span>
                  )}
                </button>
                {clienteSeleccionado && (
                  <button
                    type="button"
                    onClick={() => {
                      setClienteSeleccionado(null);
                      handleClienteChange("");
                    }}
                    className="px-3 h-10 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
                    title="Quitar cliente"
                  >
                    Quitar
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Fecha
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="mt-1 block w-full h-10 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Tipo de Pago
              </label>
              <select
                value={tipoPago}
                onChange={(e) => setTipoPago(e.target.value)}
                className="mt-1 block w-full h-10 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              >
                {TIPOS_PAGO.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Monto a Cobrar
              </label>
              <input
                type="text"
                value={montoPago ? formatMiles(montoPago) : ""}
                onChange={(e) => {
                  const raw = e.target.value
                    .replace(/\./g, "")
                    .replace(/\s/g, "");
                  const num = Number(raw);
                  if (!isNaN(num)) setMontoPago(num);
                }}
                className="mt-1 block w-full h-10 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                placeholder="0"
              />
            </div>

            <div className="pt-4 border-t">
              <p className="text-lg font-semibold text-gray-700">
                Total Deuda: {formatCurrency(totalDeuda)}
              </p>
            </div>

            <button
              type="submit"
              className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              CARGAR PAGO
            </button>
          </form>
        </div>

        {/* Modal de búsqueda de cliente con filtros (mismo que Suscripciones/Cancha) */}
        <ClienteModal
          show={showClienteModal}
          onClose={() => setShowClienteModal(false)}
          clientes={clientes}
          onSelect={(c) => {
            const id =
              typeof c.ClienteId === "number" ? c.ClienteId : Number(c.ClienteId);
            if (!Number.isFinite(id)) {
              setShowClienteModal(false);
              return;
            }
            setClienteSeleccionado(c);
            handleClienteChange(String(id));
            setShowClienteModal(false);
          }}
        />

        {/* Deudas del cliente: tabla de ventas + tabla de créditos de cancha */}
        <div className="space-y-4">
          {/* Tabla de ventas pendientes (cantina) */}
          <div className="bg-white p-6 rounded-lg shadow-md overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
              Ventas pendientes (cantina)
            </h2>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Venta Id
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Entrega
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {ventasPendientes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-4 text-center text-sm text-gray-400"
                    >
                      Sin ventas pendientes.
                    </td>
                  </tr>
                ) : (
                  ventasPendientes.map((venta) => (
                    <tr key={venta.VentaId}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {venta.VentaId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDateLocal(venta.VentaFecha)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatCurrency(venta.Total)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatCurrency(venta.VentaEntrega)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatCurrency(venta.Saldo)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Tabla de créditos de cancha. Cada fila tiene su botón "Cobrar"
              porque el cobro de cancha funciona por reserva (no acumulado). */}
          <div className="bg-white p-6 rounded-lg shadow-md overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
              Créditos de cancha
            </h2>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reserva
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Monto
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Saldo
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {creditosCancha.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-4 text-center text-sm text-gray-400"
                    >
                      Sin créditos de cancha pendientes.
                    </td>
                  </tr>
                ) : (
                  creditosCancha.map((c) => (
                    <tr key={c.CanchaCreditoId}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        #{c.CanchaReservaId}
                        {c.CanchaNombre && (
                          <span className="ml-2 text-xs text-gray-500">
                            {c.CanchaNombre}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {c.CanchaReservaFecha
                          ? formatDateLocal(c.CanchaReservaFecha)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right tabular-nums">
                        {formatCurrency(c.CanchaCreditoMonto)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-red-600 text-right tabular-nums">
                        {formatCurrency(c.CanchaCreditoSaldo)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() => handleCobrarCreditoCancha(c)}
                          className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 cursor-pointer"
                        >
                          Cobrar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreditoPagosPage;
