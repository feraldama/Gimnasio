import { useEffect, useMemo, useState } from "react";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import Swal from "sweetalert2";
import { Button } from "../common/ui";
import {
  cobrarReserva,
  type CanchaReserva,
  type PagoTipoCodigo,
} from "../../services/cancha.service";
import { formatMiles } from "../../utils/utils";

interface Props {
  open: boolean;
  reserva: CanchaReserva | null;
  onClose: () => void;
  onCobrado: () => void;
}

// Orden alineado con api/constants/pagoTipos.js. El label y color identifican
// cada método de un vistazo en el modal.
const METODOS: { codigo: PagoTipoCodigo; label: string; hint: string }[] = [
  { codigo: "CO", label: "Contado", hint: "Suma a la caja" },
  { codigo: "PO", label: "POS", hint: "Tarjeta de crédito/débito" },
  { codigo: "VO", label: "Voucher", hint: "Vale, cortesía o gift card" },
  { codigo: "TR", label: "Transferencia", hint: "Banco / billetera digital" },
  { codigo: "CR", label: "Crédito", hint: "El cliente queda debiendo" },
];

type Distribucion = Record<PagoTipoCodigo, number>;

const zero = (): Distribucion => ({ CO: 0, PO: 0, VO: 0, TR: 0, CR: 0 });

export default function CobrarReservaModal({
  open,
  reserva,
  onClose,
  onCobrado,
}: Props) {
  // Al abrir, pre-cargamos el monto sugerido en CO. Es la operación más
  // común (cobro en efectivo del monto exacto) y reduce clicks.
  const [montos, setMontos] = useState<Distribucion>(zero);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (open && reserva) {
      setMontos({ ...zero(), CO: reserva.CanchaReservaMonto || 0 });
    } else if (!open) {
      setMontos(zero());
      setGuardando(false);
    }
  }, [open, reserva]);

  const total = useMemo(
    () => Object.values(montos).reduce((s, n) => s + (Number(n) || 0), 0),
    [montos]
  );

  if (!open || !reserva) return null;

  const clienteLabel =
    [reserva.ClienteNombre, reserva.ClienteApellido].filter(Boolean).join(" ").trim() ||
    reserva.CanchaReservaCliente ||
    "—";
  const sugerido = reserva.CanchaReservaMonto || 0;
  const diff = total - sugerido;
  // Invitado/externo: la reserva guarda sólo un nombre libre, sin vinculo a
  // tabla `clientes`. No podemos cobrarles a crédito porque no hay forma de
  // perseguir la deuda después (en /credito-pagos se busca por ClienteId).
  const esInvitado = !reserva.ClienteId;

  const setMonto = (codigo: PagoTipoCodigo, raw: string) => {
    const limpio = raw.replace(/\./g, "").replace(/\s/g, "");
    if (limpio === "") {
      setMontos((p) => ({ ...p, [codigo]: 0 }));
      return;
    }
    const n = Number(limpio);
    if (!isNaN(n)) setMontos((p) => ({ ...p, [codigo]: n }));
  };

  const handleSubmit = async () => {
    if (total <= 0) {
      Swal.fire({
        icon: "warning",
        title: "Sin monto",
        text: "Distribuí al menos un método de pago con monto mayor a 0.",
      });
      return;
    }
    if (esInvitado && (montos.CR || 0) > 0) {
      Swal.fire({
        icon: "warning",
        title: "Crédito no permitido",
        text:
          "La reserva es de un invitado/externo sin cliente registrado. " +
          "Para cobrar a crédito tenés que vincular un cliente desde el form de reserva.",
      });
      return;
    }
    const pagos = METODOS
      .filter((m) => (montos[m.codigo] || 0) > 0)
      .map((m) => ({ tipo: m.codigo, monto: montos[m.codigo], label: m.label }));
    try {
      setGuardando(true);
      const r = await cobrarReserva(
        reserva.CanchaReservaId,
        pagos.map((p) => ({ tipo: p.tipo, monto: p.monto }))
      );

      // Desglose por método: ayuda a confirmar visualmente que la
      // distribución llegó como se esperaba (ej. parte efectivo + parte
      // transferencia). Se queda abierto hasta que el usuario lo cierre.
      const filasDesglose = pagos
        .map(
          (p) =>
            `<tr>
              <td class="py-1 pr-4 text-gray-600">${p.label}</td>
              <td class="py-1 text-right font-medium tabular-nums">Gs. ${formatMiles(p.monto)}</td>
            </tr>`
        )
        .join("");

      await Swal.fire({
        icon: "success",
        title: "Cobro registrado",
        html: `
          <div class="text-sm text-left">
            <p class="mb-3"><strong>${clienteLabel}</strong> · Reserva #${reserva.CanchaReservaId}</p>
            <table class="w-full mb-3 border-t border-b border-gray-200">
              <thead>
                <tr class="text-xs uppercase text-gray-500">
                  <th class="py-1 pr-4 text-left font-medium">Método</th>
                  <th class="py-1 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                ${filasDesglose}
                <tr class="border-t border-gray-200">
                  <td class="py-1.5 pr-4 font-semibold">Total</td>
                  <td class="py-1.5 text-right font-semibold tabular-nums">Gs. ${formatMiles(r.cobro.totalPagado)}</td>
                </tr>
              </tbody>
            </table>
            ${
              r.cobro.efectivoSumadoACaja > 0
                ? `<p class="text-green-700">Efectivo sumado a caja: <strong>Gs. ${formatMiles(r.cobro.efectivoSumadoACaja)}</strong></p>`
                : "<p class='text-gray-500'>No ingresó efectivo al cajón (no es Contado).</p>"
            }
          </div>
        `,
        confirmButtonText: "Cerrar",
        confirmButtonColor: "#16a34a",
      });
      onCobrado();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      Swal.fire({
        icon: "error",
        title: err.code === "SIN_CAJA" ? "Sin caja abierta" : "No se pudo cobrar",
        text: err.message || "Error al cobrar la reserva",
      });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardando) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-md bg-green-100 text-green-700">
              <BanknotesIcon className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Cobrar reserva #{reserva.CanchaReservaId}
              </h2>
              <p className="text-xs text-gray-500">
                {clienteLabel} · Sugerido:{" "}
                <strong className="text-gray-700">Gs. {formatMiles(sugerido)}</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500">
            Distribuí el cobro entre los métodos. Sólo <strong>Contado</strong> suma
            al efectivo de la caja; el resto queda registrado pero no mueve el cajón.
          </p>

          {esInvitado && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
              <strong>Reserva de invitado/externo:</strong> no se puede cobrar a
              <strong> Crédito</strong> porque la deuda no quedaría asociada a
              ningún cliente registrado. Si necesitás dejar deuda, abrí el form de
              reserva y vinculá un cliente con el buscador.
            </div>
          )}

          <div className="space-y-2">
            {METODOS.map((m) => {
              const bloqueado = m.codigo === "CR" && esInvitado;
              return (
                <div
                  key={m.codigo}
                  className={`flex items-center gap-3 px-3 py-2 border rounded-md ${
                    bloqueado
                      ? "border-gray-200 bg-gray-50 opacity-60"
                      : "border-gray-200"
                  }`}
                  title={bloqueado ? "Deshabilitado: reserva sin cliente vinculado" : ""}
                >
                  <div className="w-32 sm:w-40">
                    <div className="text-sm font-medium text-gray-800">{m.label}</div>
                    <div className="text-[11px] text-gray-500">
                      {bloqueado ? "Requiere cliente vinculado" : m.hint}
                    </div>
                  </div>
                  <div className="flex-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={montos[m.codigo] ? formatMiles(montos[m.codigo]) : ""}
                      onChange={(e) => setMonto(m.codigo, e.target.value)}
                      disabled={bloqueado}
                      className={`w-full px-3 py-1.5 border border-gray-300 rounded-md text-right tabular-nums focus:ring-2 focus:ring-green-400 focus:outline-none ${
                        bloqueado ? "cursor-not-allowed bg-gray-100" : ""
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-md border border-gray-200">
            <span className="text-sm text-gray-700">Total a cobrar</span>
            <span className="text-base font-semibold tabular-nums">
              Gs. {formatMiles(total)}
            </span>
          </div>
          {sugerido > 0 && diff !== 0 && (
            <div
              className={`text-xs px-3 ${
                diff > 0 ? "text-amber-700" : "text-blue-700"
              }`}
            >
              {diff > 0
                ? `Hay Gs. ${formatMiles(diff)} de más respecto al monto sugerido (¿propina o vuelto?).`
                : `Faltan Gs. ${formatMiles(-diff)} respecto al monto sugerido.`}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={guardando}
            className="cursor-pointer"
          >
            Cancelar
          </Button>
          <Button
            variant="success"
            onClick={handleSubmit}
            disabled={guardando || total <= 0}
            className="cursor-pointer"
          >
            {guardando ? "Cobrando..." : "Confirmar cobro"}
          </Button>
        </div>
      </div>
    </div>
  );
}
