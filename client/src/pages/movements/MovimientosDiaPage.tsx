import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlassIcon,
  ShoppingCartIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
  StatCard,
  TextInput,
} from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import {
  getMovimientosDia,
  type MovimientoPago,
  type MovimientoVenta,
  type MovimientosDia,
} from "../../services/movimientosDia.service";
import { getPagoTipoLabel } from "../../constants/pagoTipos";
import { formatDateLocal, formatMiles, todayLocalISO } from "../../utils/utils";

/**
 * "¿Ya se cargó?" — ventas y cobros de gimnasio del día, de todos los turnos
 * del local.
 *
 * El error más común en el mostrador es no saber si algo ya se cargó (el
 * Monster que se vendió a la mañana) y terminar duplicándolo u olvidándolo.
 * Esta pantalla es de solo consulta: el cajero busca el producto o el socio
 * y ve si está, quién lo cargó, a qué hora y con qué medio.
 *
 * El alcance lo fija el backend (hoy + local propio para cajeros).
 */

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

// Grupos de `registrodiariocaja` → medio de cobro (api/constants/pagoTipos.js).
const MEDIO_POR_GRUPO: Record<number, { label: string; tone: Tone }> = {
  1: { label: "Efectivo", tone: "success" },
  3: { label: "Efectivo", tone: "success" },
  4: { label: "POS", tone: "info" },
  5: { label: "Voucher", tone: "neutral" },
  6: { label: "Transferencia", tone: "brand" },
};

const TONO_PAGO: Record<string, Tone> = {
  CO: "success",
  PO: "info",
  VO: "neutral",
  TR: "brand",
  CR: "warning",
};

/** Minúsculas y sin tildes, para que "credito" encuentre "Crédito". */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const nombreCliente = (n?: string | null, a?: string | null) =>
  [n, a].filter((x) => x && String(x).trim()).join(" ").trim();

const hora = (fecha: string) => {
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
};

function textoVenta(v: MovimientoVenta) {
  return normalizar(
    [
      `#${v.VentaId}`,
      String(v.VentaId),
      nombreCliente(v.ClienteNombre, v.ClienteApellido),
      v.UsuarioNombre || v.VentaUsuario,
      ...v.Items.map((i) => i.ProductoNombre || ""),
      ...v.Movimientos.map((m) => MEDIO_POR_GRUPO[m.TipoGastoGrupoId]?.label || ""),
    ].join(" ")
  );
}

function textoPago(p: MovimientoPago) {
  return normalizar(
    [
      `#${p.PagoId}`,
      String(p.PagoId),
      nombreCliente(p.ClienteNombre, p.ClienteApellido),
      p.PlanNombre || "",
      p.UsuarioNombre || p.PagoUsuarioId,
      getPagoTipoLabel(p.PagoTipo),
    ].join(" ")
  );
}

/** Medios con que se cobró una venta, sumando por medio. */
function mediosVenta(v: MovimientoVenta) {
  const porMedio = new Map<string, { tone: Tone; monto: number }>();
  for (const m of v.Movimientos) {
    const medio = MEDIO_POR_GRUPO[m.TipoGastoGrupoId] || {
      label: "Otro",
      tone: "neutral" as Tone,
    };
    const prev = porMedio.get(medio.label);
    porMedio.set(medio.label, {
      tone: medio.tone,
      monto: (prev?.monto || 0) + Number(m.RegistroDiarioCajaMonto || 0),
    });
  }
  const saldo = Number(v.Total || 0) - Number(v.VentaEntrega || 0);
  if (v.VentaTipo === "CR" && saldo > 0) {
    porMedio.set("A crédito", { tone: "warning", monto: saldo });
  }
  return [...porMedio.entries()].map(([label, x]) => ({ label, ...x }));
}

export default function MovimientosDiaPage() {
  const puedeLeer = usePermiso("MOVIMIENTOSDIA", "leer");
  const [data, setData] = useState<MovimientosDia | null>(null);
  const [fecha, setFecha] = useState(todayLocalISO());
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!puedeLeer) return;
    setLoading(true);
    setError(null);
    try {
      // Si el usuario no puede elegir fecha el backend ignora el parámetro.
      setData(await getMovimientosDia({ fecha }));
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || "Error al cargar los movimientos");
    } finally {
      setLoading(false);
    }
  }, [fecha, puedeLeer]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const termino = normalizar(busqueda.trim());

  const ventas = useMemo(
    () =>
      (data?.ventas || []).filter((v) => !termino || textoVenta(v).includes(termino)),
    [data, termino]
  );
  const pagos = useMemo(
    () =>
      (data?.pagos || []).filter((p) => !termino || textoPago(p).includes(termino)),
    [data, termino]
  );

  const resumen = useMemo(() => {
    const vs = data?.ventas || [];
    const ps = data?.pagos || [];
    const ventasSinCaja = vs.filter(
      (v) => Number(v.VentaEntrega) > 0 && v.Movimientos.length === 0
    ).length;
    const pagosSinCaja = ps.filter((p) => !p.CajaId).length;
    return {
      ventas: vs.length,
      totalVentas: vs.reduce((s, v) => s + Number(v.Total || 0), 0),
      pagos: ps.length,
      totalPagos: ps.reduce((s, p) => s + Number(p.PagoMonto || 0), 0),
      sinCaja: ventasSinCaja + pagosSinCaja,
    };
  }, [data]);

  if (!puedeLeer)
    return <PermissionDenied resource="las ventas y cobros del día" />;

  const esHoy = (data?.fecha || fecha) === todayLocalISO();
  const tituloFecha = esHoy ? "hoy" : formatDateLocal(data?.fecha || fecha);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-strong">
            Ventas y cobros de {tituloFecha}
          </h1>
          <p className="text-sm text-text-muted">
            Antes de cargar algo, buscalo acá: muestra lo cargado en todos los
            turnos del local.
          </p>
        </div>
        <div className="flex items-end gap-3">
          {data?.puedeElegirFecha && (
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Fecha
              <input
                type="date"
                value={fecha}
                max={todayLocalISO()}
                onChange={(e) => e.target.value && setFecha(e.target.value)}
                className="mt-1 block rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
              />
            </label>
          )}
          <Button
            variant="secondary"
            onClick={cargar}
            disabled={loading}
            leftIcon={ArrowPathIcon}
          >
            Actualizar
          </Button>
        </div>
      </div>

      <TextInput
        autoFocus
        leftIcon={MagnifyingGlassIcon}
        placeholder="Buscar producto, socio, cliente, usuario o N°… (ej.: monster)"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        aria-label="Buscar en las ventas y cobros del día"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Ventas de cantina"
          value={resumen.ventas}
          icon={ShoppingCartIcon}
          tone="brand"
          hint={`Gs. ${formatMiles(resumen.totalVentas)}`}
        />
        <StatCard
          label="Cobros de gimnasio"
          value={resumen.pagos}
          icon={BanknotesIcon}
          tone="success"
          hint={`Gs. ${formatMiles(resumen.totalPagos)}`}
        />
        <StatCard
          label="Sin movimiento de caja"
          value={resumen.sinCaja}
          icon={ExclamationTriangleIcon}
          tone={resumen.sinCaja > 0 ? "danger" : "neutral"}
          hint="Cobrados con la caja cerrada: no figuran en ningún cierre"
        />
      </div>

      {loading && !data && <LoadingState message="Cargando movimientos…" />}
      {!loading && error && <ErrorState message={error} onRetry={cargar} />}

      {data && !error && (
        <>
          <TablaVentas ventas={ventas} total={data.ventas.length} buscando={!!termino} />
          <TablaPagos pagos={pagos} total={data.pagos.length} buscando={!!termino} />
        </>
      )}
    </div>
  );
}

function TablaVentas({
  ventas,
  total,
  buscando,
}: {
  ventas: MovimientoVenta[];
  total: number;
  buscando: boolean;
}) {
  return (
    <Card padding="none">
      <div className="p-5">
        <CardHeader
          title={
            buscando
              ? `Cantina: ${ventas.length} de ${total} ventas coinciden`
              : `Cantina: ${total} ventas`
          }
          description="La más reciente primero."
        />
      </div>
      {ventas.length === 0 ? (
        <EmptyState
          title={buscando ? "No se encontró en las ventas" : "Todavía no hay ventas"}
          description={
            buscando
              ? "Ninguna venta del día coincide con la búsqueda."
              : "Las ventas aparecen acá apenas se confirman."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border bg-surface-sunken text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2 font-semibold">Hora</th>
                <th className="px-4 py-2 font-semibold">Productos</th>
                <th className="px-4 py-2 font-semibold">Cliente</th>
                <th className="px-4 py-2 font-semibold">Medio</th>
                <th className="px-4 py-2 font-semibold">Caja / usuario</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => {
                const medios = mediosVenta(v);
                const sinCaja =
                  Number(v.VentaEntrega) > 0 && v.Movimientos.length === 0;
                const caja = v.Movimientos[0]?.CajaDescripcion;
                return (
                  <tr key={v.VentaId} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2 font-num text-text">
                      {hora(v.VentaFecha)}
                      <div className="text-xs text-text-subtle">N° {v.VentaId}</div>
                    </td>
                    <td className="px-4 py-2">
                      <ul className="space-y-0.5">
                        {v.Items.map((it) => (
                          <li key={`${it.VentaId}-${it.ProductoId}-${it.VentaProductoPrecioTotal}`} className="text-text">
                            <span className="font-num font-semibold">
                              {it.VentaProductoCantidad}
                            </span>
                            {" × "}
                            {it.ProductoNombre || `Producto ${it.ProductoId}`}
                            {it.VentaProductoUnitario === "C" && (
                              <span className="text-text-subtle"> (caja)</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {nombreCliente(v.ClienteNombre, v.ClienteApellido) || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {medios.map((m) => (
                          <Badge
                            key={m.label}
                            tone={m.tone}
                            title={`Gs. ${formatMiles(m.monto)}`}
                          >
                            {m.label}
                            {medios.length > 1 && ` ${formatMiles(m.monto)}`}
                          </Badge>
                        ))}
                        {sinCaja && (
                          <Badge
                            tone="danger"
                            title="Se cobró con la caja cerrada: no figura en ningún cierre"
                          >
                            Sin caja
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      <div>{caja || "—"}</div>
                      <div className="text-xs text-text-subtle">
                        {v.UsuarioNombre || v.VentaUsuario}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-num font-semibold text-text">
                      {formatMiles(v.Total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TablaPagos({
  pagos,
  total,
  buscando,
}: {
  pagos: MovimientoPago[];
  total: number;
  buscando: boolean;
}) {
  return (
    <Card padding="none">
      <div className="p-5">
        <CardHeader
          title={
            buscando
              ? `Gimnasio: ${pagos.length} de ${total} cobros coinciden`
              : `Gimnasio: ${total} cobros`
          }
          description="El más reciente primero. Revisá el medio: es el error más común al cuadrar la caja."
        />
      </div>
      {pagos.length === 0 ? (
        <EmptyState
          title={buscando ? "No se encontró en los cobros" : "Todavía no hay cobros"}
          description={
            buscando
              ? "Ningún cobro del día coincide con la búsqueda."
              : "Los cobros de suscripciones aparecen acá apenas se registran."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border bg-surface-sunken text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2 font-semibold">N°</th>
                <th className="px-4 py-2 font-semibold">Socio</th>
                <th className="px-4 py-2 font-semibold">Plan</th>
                <th className="px-4 py-2 font-semibold">Medio</th>
                <th className="px-4 py-2 font-semibold">Caja / usuario</th>
                <th className="px-4 py-2 text-right font-semibold">Monto</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.PagoId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-num text-text-subtle">{p.PagoId}</td>
                  <td className="px-4 py-2 font-medium text-text">
                    {nombreCliente(p.ClienteNombre, p.ClienteApellido) || "—"}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{p.PlanNombre || "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={TONO_PAGO[p.PagoTipo] || "neutral"}>
                        {p.PagoTipo === "CO" ? "Efectivo" : getPagoTipoLabel(p.PagoTipo)}
                      </Badge>
                      {!p.CajaId && (
                        <Badge
                          tone="danger"
                          title="Se cobró con la caja cerrada o no se pudo vincular con su movimiento de caja"
                        >
                          Sin caja
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    <div>{p.CajaDescripcion || "—"}</div>
                    <div className="text-xs text-text-subtle">
                      {p.UsuarioNombre || p.PagoUsuarioId}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-num font-semibold text-text">
                    {formatMiles(p.PagoMonto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
