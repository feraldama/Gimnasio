import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PhoneIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  PermissionDenied,
  StatCard,
  Badge,
} from "../../components/common/ui";
import { usePermiso } from "../../hooks/usePermiso";
import {
  getSuscripcionesProximasAVencer,
  type SuscripcionPorVencer,
} from "../../services/suscripciones.service";
import { formatMiles, todayLocalISO } from "../../utils/utils";

/**
 * Lista de trabajo de vencimientos: a quién llamar hoy para que renueve.
 *
 * En un gimnasio el cobro y la retención son lo mismo, porque el acceso es
 * prepago — el kiosko bloquea la entrada cuando la suscripción no está
 * vigente. Así que esta pantalla es la herramienta de cobranza del mostrador.
 *
 * El dato que cambia la conversación es "días sin venir":
 *   viene seguido y se le venció   → se olvidó, alcanza un recordatorio
 *   no viene desde semanas         → ya se fue, hay que recuperarlo
 * Sin eso las dos filas se ven iguales y se tratan igual.
 */

const MOTIVOS: Record<string, { label: string; tone: "danger" | "warning" | "info" }> = {
  VENCIDA: { label: "Vencida", tone: "danger" },
  VENCE: { label: "Por vencer", tone: "warning" },
  CLASES: { label: "Sin clases", tone: "info" },
};

const diasHasta = (fechaFin: string): number => {
  if (!fechaFin) return 0;
  const [ah, mh, dh] = todayLocalISO().split("-").map(Number);
  const [af, mf, df] = fechaFin.split("T")[0].split("-").map(Number);
  const hoy = new Date(ah, mh - 1, dh);
  const fin = new Date(af, mf - 1, df);
  return Math.round((fin.getTime() - hoy.getTime()) / 86400000);
};

/** Link a WhatsApp con el prefijo de Paraguay y un mensaje inicial. */
function linkWhatsApp(telefono: string, nombre: string, dias: number) {
  const limpio = String(telefono || "").replace(/\D/g, "");
  if (!limpio) return null;
  // 0981... → 595981...
  const internacional = limpio.startsWith("0")
    ? `595${limpio.slice(1)}`
    : limpio.startsWith("595")
      ? limpio
      : `595${limpio}`;
  const saludo = nombre ? ` ${nombre}` : "";
  const texto =
    dias < 0
      ? `Hola${saludo}, te escribimos del gimnasio: tu plan venció hace ${Math.abs(dias)} día(s). ¿Querés renovarlo?`
      : `Hola${saludo}, te escribimos del gimnasio: tu plan vence en ${dias} día(s). ¿Querés renovarlo?`;
  return `https://wa.me/${internacional}?text=${encodeURIComponent(texto)}`;
}

/** Semáforo de riesgo según hace cuánto no viene. */
function RiesgoAsistencia({ dias }: { dias: number | null | undefined }) {
  if (dias === null || dias === undefined) {
    return (
      <span className="text-xs text-text-subtle" title="Nunca registró una asistencia">
        nunca vino
      </span>
    );
  }
  const tono =
    dias <= 7
      ? "text-success-700"
      : dias <= 21
        ? "text-warning-700"
        : "text-danger-700";
  const detalle =
    dias <= 7
      ? "viene seguido: probablemente sólo se olvidó de pagar"
      : dias <= 21
        ? "hace semanas que no viene"
        : "hace más de tres semanas que no viene: riesgo real de baja";
  return (
    <span className={`font-num text-xs ${tono}`} title={detalle}>
      {dias === 0 ? "vino hoy" : `hace ${dias} d`}
    </span>
  );
}

export default function VencimientosPage() {
  const puedeLeer = usePermiso("SUSCRIPCIONES", "leer");
  const [dias, setDias] = useState(15);
  const [motivoFiltro, setMotivoFiltro] = useState<string>("TODOS");
  const [soloConDeuda, setSoloConDeuda] = useState(false);
  const [items, setItems] = useState<SuscripcionPorVencer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!puedeLeer) return;
    setLoading(true);
    setError(null);
    try {
      // 30 días de vencidos hacia atrás: el socio que venció hace dos
      // semanas y dejó de venir es el llamado más recuperable. Con la ventana
      // por defecto (7 días) quedaba invisible.
      const resp = await getSuscripcionesProximasAVencer(
        dias,
        undefined,
        2,
        30
      );
      setItems(resp.data || []);
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || "Error al cargar la lista");
    } finally {
      setLoading(false);
    }
  }, [dias, puedeLeer]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtrados = useMemo(() => {
    return items.filter((i) => {
      if (motivoFiltro !== "TODOS" && i.Motivo !== motivoFiltro) return false;
      if (soloConDeuda && Number(i.SaldoPendiente || 0) <= 0) return false;
      return true;
    });
  }, [items, motivoFiltro, soloConDeuda]);

  const resumen = useMemo(() => {
    const vencidas = items.filter((i) => i.Motivo === "VENCIDA").length;
    const porVencer = items.filter((i) => i.Motivo === "VENCE").length;
    const sinClases = items.filter((i) => i.Motivo === "CLASES").length;
    const aCobrar = items.reduce(
      (s, i) => s + Number(i.SaldoPendiente || 0),
      0
    );
    const sinTelefono = items.filter(
      (i) => !String(i.ClienteTelefono || "").trim()
    ).length;
    return { vencidas, porVencer, sinClases, aCobrar, sinTelefono };
  }, [items]);

  if (!puedeLeer) return <PermissionDenied resource="los vencimientos" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-strong">
          Vencimientos — lista de llamados
        </h1>
        <p className="text-sm text-text-muted">
          A quién contactar para que renueve. El acceso del gimnasio es
          prepago, así que cobrar y retener son lo mismo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ya vencidas"
          value={resumen.vencidas}
          icon={ExclamationTriangleIcon}
          tone="danger"
          hint="No pueden entrar hasta que renueven"
        />
        <StatCard
          label="Por vencer"
          value={resumen.porVencer}
          tone="warning"
          hint={`En los próximos ${dias} días`}
        />
        <StatCard
          label="Sin clases"
          value={resumen.sinClases}
          tone="info"
          hint="Planes por clases con el cupo casi agotado"
        />
        <StatCard
          label="A cobrar"
          value={`Gs. ${formatMiles(resumen.aCobrar)}`}
          tone="brand"
          hint="Saldo pendiente de los planes de la lista"
        />
      </div>

      <Card padding="none">
        <div className="flex flex-wrap items-end justify-between gap-4 p-5">
          <CardHeader
            title={`${filtrados.length} de ${items.length} en la lista`}
            description={
              resumen.sinTelefono > 0
                ? `${resumen.sinTelefono} sin teléfono cargado: no se les puede escribir.`
                : "Ordenada por urgencia: primero las que ya vencieron."
            }
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Ventana
              <select
                value={dias}
                onChange={(e) => setDias(Number(e.target.value))}
                className="mt-1 block rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
              >
                {[7, 15, 30, 60].map((d) => (
                  <option key={d} value={d}>
                    {d} días
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Motivo
              <select
                value={motivoFiltro}
                onChange={(e) => setMotivoFiltro(e.target.value)}
                className="mt-1 block rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
              >
                <option value="TODOS">Todos</option>
                <option value="VENCIDA">Ya vencidas</option>
                <option value="VENCE">Por vencer</option>
                <option value="CLASES">Sin clases</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-text">
              <input
                type="checkbox"
                checked={soloConDeuda}
                onChange={(e) => setSoloConDeuda(e.target.checked)}
                className="h-4 w-4 rounded border-border text-brand-700 focus:ring-brand-700"
              />
              Sólo con saldo
            </label>
          </div>
        </div>

        {loading && <LoadingState message="Cargando lista…" />}
        {!loading && error && <ErrorState message={error} onRetry={cargar} />}
        {!loading && !error && filtrados.length === 0 && (
          <EmptyState
            title="No hay nada que reclamar"
            description="Ningún socio vence en la ventana elegida con los filtros aplicados."
          />
        )}

        {!loading && !error && filtrados.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border bg-surface-sunken text-left text-xs uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2 font-semibold">Socio</th>
                  <th className="px-4 py-2 font-semibold">Plan</th>
                  <th className="px-4 py-2 font-semibold">Motivo</th>
                  <th className="px-4 py-2 text-right font-semibold">Vence</th>
                  <th className="px-4 py-2 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-2 font-semibold">Última visita</th>
                  <th className="px-4 py-2 font-semibold">Contacto</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((i) => {
                  const d = diasHasta(i.SuscripcionFechaFin);
                  const nombre = [i.ClienteNombre, i.ClienteApellido]
                    .filter(Boolean)
                    .join(" ");
                  const motivo = MOTIVOS[i.Motivo || "VENCE"];
                  const wa = linkWhatsApp(
                    String(i.ClienteTelefono || ""),
                    String(i.ClienteNombre || ""),
                    d
                  );
                  return (
                    <tr
                      key={i.SuscripcionId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2">
                        <span className="font-medium text-text">{nombre}</span>
                      </td>
                      <td className="px-4 py-2 text-text-muted">
                        {i.PlanNombre}
                        {i.Motivo === "CLASES" && (
                          <span className="ml-1 font-num text-xs text-info-700">
                            ({i.SuscripcionClasesRestantes} clase
                            {Number(i.SuscripcionClasesRestantes) === 1 ? "" : "s"})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={motivo.tone}>{motivo.label}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-num text-text">
                        {d < 0 ? `hace ${Math.abs(d)} d` : `en ${d} d`}
                      </td>
                      <td className="px-4 py-2 text-right font-num">
                        {Number(i.SaldoPendiente || 0) > 0 ? (
                          <span className="text-warning-700">
                            {formatMiles(Number(i.SaldoPendiente))}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <RiesgoAsistencia dias={i.DiasSinVenir} />
                      </td>
                      <td className="px-4 py-2">
                        {wa ? (
                          <div className="flex items-center gap-3">
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                            >
                              <ChatBubbleLeftRightIcon className="h-4 w-4" />
                              WhatsApp
                            </a>
                            <a
                              href={`tel:${i.ClienteTelefono}`}
                              className="inline-flex items-center gap-1 text-text-muted hover:text-text"
                              title={String(i.ClienteTelefono)}
                            >
                              <PhoneIcon className="h-4 w-4" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-xs text-text-subtle">
                            sin teléfono
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
