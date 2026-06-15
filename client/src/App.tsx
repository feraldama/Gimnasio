import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./contexts/AuthContext";
import PrivateRoute from "./components/common/PrivateRoute";
import Layout from "./components/layout/Layout";
import DocumentTitle from "./components/common/DocumentTitle";
// Login y NotFound se cargan eager: el primero es la pantalla de entrada (evita
// un parpadeo en el arranque) y el segundo es el catch-all (muy liviano).
import Login from "./pages/auth/Login/Login";
import NotFound from "./pages/NotFound";

// Páginas cargadas bajo demanda (code-splitting por ruta). Antes todas se
// importaban eager y caían en el bundle inicial (~1.45 MB); ahora cada página
// es su propio chunk que se descarga sólo al navegar a ella.
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const UsersPage = lazy(() => import("./pages/users/UsersPage"));
const MovementsPage = lazy(() => import("./pages/movements/MovementsPage"));
const CajasPage = lazy(() => import("./pages/cajas/CajasPage"));
const TiposGastoPage = lazy(() => import("./pages/tipogasto/TiposGastoPage"));
const CustomersPage = lazy(() => import("./pages/customers/CustomersPage"));
const AperturaCierreCajaPage = lazy(
  () => import("./pages/cajas/AperturaCierreCajaPage")
);
const Sales = lazy(() => import("./pages/dashboard/Sales"));
const LocalesPage = lazy(() => import("./pages/locales/LocalesPage"));
const AlmacenesPage = lazy(() => import("./pages/almacenes/AlmacenesPage"));
const CombosPage = lazy(() => import("./pages/combos/CombosPage"));
const PerfilesPage = lazy(() => import("./pages/perfiles/PerfilesPage"));
const MenusPage = lazy(() => import("./pages/menus/MenusPage"));
const ProductsPage = lazy(() => import("./pages/products/ProductsPage"));
const VentasPage = lazy(() => import("./pages/ventas/VentasPage"));
const CreditoPagosPage = lazy(() => import("./pages/ventas/CreditoPagosPage"));
const ClientesConDeudaPage = lazy(
  () => import("./pages/ventas/ClientesConDeudaPage")
);
const ReportesPage = lazy(() => import("./pages/dashboard/ReportesPage"));
const FacturasPage = lazy(() => import("./pages/facturas/FacturasPage"));
const Compras = lazy(() => import("./pages/compras/Compras"));
const ComprasPage = lazy(() => import("./pages/compras/ComprasPage"));
const Inventario = lazy(() => import("./pages/inventario/Inventario"));
const SuscripcionesPage = lazy(
  () => import("./pages/suscripciones/SuscripcionesPage")
);
const PlanesPage = lazy(() => import("./pages/planes/PlanesPage"));
const PagosPage = lazy(() => import("./pages/pagos/PagosPage"));
const ReporteCobranzaPage = lazy(
  () => import("./pages/pagos/ReporteCobranzaPage")
);
const AsistenciaPage = lazy(() => import("./pages/asistencia/AsistenciaPage"));
const ConfiguracionPage = lazy(
  () => import("./pages/configuracion/ConfiguracionPage")
);
const CanchaPage = lazy(() => import("./pages/cancha/CanchaPage"));
const CanchasAdminPage = lazy(() => import("./pages/cancha/CanchasAdminPage"));
const CanchaCalendarioPage = lazy(
  () => import("./pages/cancha/CanchaCalendarioPage")
);
const CanchaTarifasPage = lazy(
  () => import("./pages/cancha/CanchaTarifasPage")
);
const CanchaBloqueosPage = lazy(
  () => import("./pages/cancha/CanchaBloqueosPage")
);
const ReportesGraficosPage = lazy(
  () => import("./pages/dashboard/ReportesGraficosPage")
);
const FichaAlumnoPage = lazy(() => import("./pages/customers/FichaAlumnoPage"));
const KioskoAsistenciaPage = lazy(
  () => import("./pages/asistencia/KioskoAsistenciaPage")
);

// Redirect 301-style para la URL legacy /clientes/:id/historial-gimnasio →
// /clientes/:id/ficha. Mantenemos la ruta para no romper bookmarks ni links
// generados por reportes/PDFs viejos.
function NavigateToFicha() {
  const { id } = useParams();
  return <Navigate to={`/clientes/${id}/ficha`} replace />;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen text-gray-400">
      Cargando…
    </div>
  );
}

function App() {
  return (
    <Router>
      <DocumentTitle />
      <AuthProvider>
        {/* Suspense externo: cubre las rutas sin Layout (Login eager no suspende).
            Las rutas con Layout tienen su propio Suspense alrededor del Outlet,
            así la navbar/sidebar no parpadean al navegar. */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Redirige la raíz / a /login */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />

            {/* Rutas sin Layout (Sales, Compras e Inventario) */}
            <Route
              path="/ventas"
              element={
                <PrivateRoute>
                  <Sales />
                </PrivateRoute>
              }
            />
            <Route
              path="/compras"
              element={
                <PrivateRoute>
                  <Compras />
                </PrivateRoute>
              }
            />
            <Route
              path="/inventario"
              element={
                <PrivateRoute>
                  <Inventario />
                </PrivateRoute>
              }
            />
            <Route
              path="/kiosko-asistencia"
              element={
                <PrivateRoute>
                  <KioskoAsistenciaPage />
                </PrivateRoute>
              }
            />

            {/* Rutas privadas (con Layout que incluye Navbar) */}
            <Route
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              {/* Agrega aquí más rutas protegidas */}
              <Route path="/users" element={<UsersPage />} />
              <Route path="/movements/summary" element={<MovementsPage />} />
              <Route path="/movements/cajas" element={<CajasPage />} />
              <Route
                path="/movements/tiposgasto"
                element={<TiposGastoPage />}
              />
              <Route path="/customers" element={<CustomersPage />} />
              <Route
                path="/apertura-cierre-caja"
                element={<AperturaCierreCajaPage />}
              />
              <Route path="/locales" element={<LocalesPage />} />
              <Route path="/almacenes" element={<AlmacenesPage />} />
              <Route path="/combos" element={<CombosPage />} />
              <Route path="/perfiles" element={<PerfilesPage />} />
              <Route path="/menus" element={<MenusPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/modifications/ventas" element={<VentasPage />} />
              <Route path="/modifications/compras" element={<ComprasPage />} />
              <Route path="/credito-pagos" element={<CreditoPagosPage />} />
              <Route
                path="/clientes-con-deuda"
                element={<ClientesConDeudaPage />}
              />
              <Route path="/reportes" element={<ReportesPage />} />
              <Route path="/facturas" element={<FacturasPage />} />
              <Route path="/planes" element={<PlanesPage />} />
              <Route path="/suscripciones" element={<SuscripcionesPage />} />
              <Route path="/pagos" element={<PagosPage />} />
              <Route
                path="/reporte-cobranza"
                element={<ReporteCobranzaPage />}
              />
              {/* Compat: redirige a la ficha completa, que ya muestra todo lo
                  que mostraba HistorialClientePage y más (asistencias, deuda). */}
              <Route
                path="/clientes/:id/historial-gimnasio"
                element={<NavigateToFicha />}
              />
              <Route path="/asistencia" element={<AsistenciaPage />} />
              <Route path="/configuracion" element={<ConfiguracionPage />} />
              <Route path="/cancha" element={<CanchaPage />} />
              <Route path="/canchas" element={<CanchasAdminPage />} />
              <Route
                path="/cancha/calendario"
                element={<CanchaCalendarioPage />}
              />
              <Route path="/cancha/tarifas" element={<CanchaTarifasPage />} />
              <Route path="/cancha/bloqueos" element={<CanchaBloqueosPage />} />
              <Route
                path="/reportes-graficos"
                element={<ReportesGraficosPage />}
              />
              <Route path="/clientes/:id/ficha" element={<FichaAlumnoPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

export default App;
