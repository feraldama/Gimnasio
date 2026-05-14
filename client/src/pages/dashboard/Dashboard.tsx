import { useEffect, useState, type ComponentType } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  UserGroupIcon,
  UserPlusIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  DocumentChartBarIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "../../contexts/useAuth";
import {
  Button,
  Card,
  CardHeader,
  StatCard,
  TextInput,
} from "../../components/common/ui";
import { getSuscripcionesProximasAVencer } from "../../services/suscripciones.service";
import { formatDateLocal, todayLocalISO } from "../../utils/utils";

interface QuickAccessProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  to?: string;
  active?: boolean;
}

function QuickAccess({
  icon: Icon,
  title,
  description,
  to,
  active = false,
}: QuickAccessProps) {
  const wrapper = "flex items-center gap-3 px-5 py-4 transition-colors min-w-0";

  const state = active
    ? "bg-brand-50"
    : to
    ? "hover:bg-surface-muted cursor-pointer"
    : "opacity-60";

  const iconBox = active
    ? "bg-brand-100 text-brand-700"
    : "bg-surface-muted text-text-muted";

  const titleColor = active ? "text-brand-700" : "text-text";

  const content = (
    <>
      <span
        className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${iconBox}`}
      >
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-medium truncate ${titleColor}`}>{title}</p>
        <p className="text-xs text-text-muted truncate">{description}</p>
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`${wrapper} ${state} no-underline`}>
        {content}
      </Link>
    );
  }

  return <div className={`${wrapper} ${state}`}>{content}</div>;
}

interface SuscripcionProximaVencer {
  SuscripcionId: number;
  ClienteId: number;
  ClienteNombre?: string;
  ClienteApellido?: string;
  PlanNombre?: string;
  SuscripcionFechaFin: string;
  EstadoPago?: string;
}

const diasHastaVencimiento = (fechaFin: string): number => {
  if (!fechaFin) return 0;
  const hoy = todayLocalISO();
  const fin = fechaFin.split("T")[0];
  // Construir Dates en zona local (no UTC) para que la diferencia en días sea correcta
  const [yh, mh, dh] = hoy.split("-").map(Number);
  const [yf, mf, df] = fin.split("-").map(Number);
  const hoyDate = new Date(yh, mh - 1, dh);
  const finDate = new Date(yf, mf - 1, df);
  return Math.round((finDate.getTime() - hoyDate.getTime()) / (1000 * 60 * 60 * 24));
};

function ProximasAVencer() {
  const [items, setItems] = useState<SuscripcionProximaVencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSuscripcionesProximasAVencer(15, 10)
      .then((resp) => {
        if (!cancelled) setItems(resp.data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Error al cargar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card padding="none">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-md bg-amber-100 text-amber-700">
            <ClockIcon className="w-5 h-5" />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-text">
              Suscripciones próximas a vencer
            </h3>
            <p className="text-sm text-text-muted">
              Vencen en los próximos 15 días (o ya vencieron hace menos de una semana)
            </p>
          </div>
        </div>
        <Link
          to="/suscripciones"
          className="text-sm text-blue-600 hover:underline whitespace-nowrap"
        >
          Ver todas
        </Link>
      </div>
      <div className="border-t border-border overflow-x-auto">
        {loading ? (
          <div className="p-5 text-sm text-text-muted">Cargando...</div>
        ) : error ? (
          <div className="p-5 text-sm text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-text-muted">
            No hay suscripciones próximas a vencer
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Cliente</th>
                <th className="px-4 py-2 text-left">Plan</th>
                <th className="px-4 py-2 text-left">Vence</th>
                <th className="px-4 py-2 text-left">Días</th>
                <th className="px-4 py-2 text-left">Pago</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((s) => {
                const dias = diasHastaVencimiento(s.SuscripcionFechaFin);
                const diasLabel =
                  dias < 0
                    ? `Vencida hace ${-dias} d`
                    : dias === 0
                    ? "Hoy"
                    : `En ${dias} d`;
                const diasColor =
                  dias < 0
                    ? "text-red-600 font-semibold"
                    : dias <= 3
                    ? "text-amber-600 font-semibold"
                    : "text-text";
                return (
                  <tr key={s.SuscripcionId} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link
                        to={`/clientes/${s.ClienteId}/historial-gimnasio`}
                        className="text-blue-600 hover:underline"
                      >
                        {`${s.ClienteNombre || ""} ${s.ClienteApellido || ""}`.trim() || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{s.PlanNombre || "—"}</td>
                    <td className="px-4 py-2">
                      {formatDateLocal(s.SuscripcionFechaFin)}
                    </td>
                    <td className={`px-4 py-2 ${diasColor}`}>{diasLabel}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          s.EstadoPago === "PAGADA"
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {s.EstadoPago || "PENDIENTE"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">
            Panel de Control
          </h1>
          {user && (
            <p className="text-sm text-text-muted mt-1">
              Hola,{" "}
              <span className="font-medium text-text">{user.nombre}</span>. Este
              es tu panel de administración.
            </p>
          )}
        </div>
        <Button leftIcon={PlusIcon} onClick={() => navigate("/ventas")}>
          Nueva venta
        </Button>
      </header>

      {/* KPIs */}
      <section
        aria-label="Resumen de métricas"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <StatCard
          label="Usuarios totales"
          value="25"
          tone="brand"
          icon={UserGroupIcon}
        />
        <StatCard
          label="Nuevos hoy"
          value="3"
          tone="warning"
          icon={UserPlusIcon}
          trend={{ direction: "up", label: "+3 vs ayer" }}
        />
        <StatCard
          label="Activos"
          value="18"
          tone="success"
          icon={CheckCircleIcon}
          hint="72% del total"
        />
        <StatCard
          label="Administradores"
          value="4"
          tone="info"
          icon={ShieldCheckIcon}
        />
      </section>

      {/* Suscripciones próximas a vencer (gimnasio) */}
      <ProximasAVencer />

      {/* Búsqueda */}
      <Card>
        <CardHeader
          title="Búsqueda rápida"
          description="Encontrá usuarios, ventas o productos en todo el sistema"
        />
        <form
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"
        >
          <TextInput
            leftIcon={MagnifyingGlassIcon}
            placeholder="Buscar en el sistema..."
            size="lg"
            aria-label="Buscar en el sistema"
          />
          <Button type="submit" size="lg">
            Buscar
          </Button>
        </form>
      </Card>

      {/* Acceso rápido */}
      <Card padding="none">
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-lg font-semibold text-text">Acceso rápido</h3>
          <p className="mt-0.5 text-sm text-text-muted">
            Secciones principales del sistema
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border border-t border-border">
          <QuickAccess
            icon={ChartBarIcon}
            title="Resumen"
            description="Vista general del sistema"
            active
          />
          <QuickAccess
            icon={UserGroupIcon}
            title="Usuarios"
            description="Gestión de usuarios del sistema"
            to="/users"
          />
          <QuickAccess
            icon={DocumentChartBarIcon}
            title="Reportes"
            description="Generación de reportes"
            to="/reportes"
          />
          <QuickAccess
            icon={Cog6ToothIcon}
            title="Configuración"
            description="Ajustes del sistema"
          />
        </div>
      </Card>
    </div>
  );
}

export default Dashboard;
