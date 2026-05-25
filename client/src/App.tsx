import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./contexts/AuthContext";
import Login from "./pages/auth/Login/Login";
import Dashboard from "./pages/dashboard/Dashboard";
import PrivateRoute from "./components/common/PrivateRoute";
import Layout from "./components/layout/Layout";
import NotFound from "./pages/NotFound";
import UsersPage from "./pages/users/UsersPage";
import MovementsPage from "./pages/movements/MovementsPage";
import CajasPage from "./pages/cajas/CajasPage";
import TiposGastoPage from "./pages/tipogasto/TiposGastoPage";
import CustomersPage from "./pages/customers/CustomersPage";
import AperturaCierreCajaPage from "./pages/cajas/AperturaCierreCajaPage";
import Sales from "./pages/dashboard/Sales";
import LocalesPage from "./pages/locales/LocalesPage";
import AlmacenesPage from "./pages/almacenes/AlmacenesPage";
import CombosPage from "./pages/combos/CombosPage";
import PerfilesPage from "./pages/perfiles/PerfilesPage";
import MenusPage from "./pages/menus/MenusPage";
import ProductsPage from "./pages/products/ProductsPage";
import VentasPage from "./pages/ventas/VentasPage";
import CreditoPagosPage from "./pages/ventas/CreditoPagosPage";
import ClientesConDeudaPage from "./pages/ventas/ClientesConDeudaPage";
import ReportesPage from "./pages/dashboard/ReportesPage";
import FacturasPage from "./pages/facturas/FacturasPage";
import Compras from "./pages/compras/Compras";
import ComprasPage from "./pages/compras/ComprasPage";
import Inventario from "./pages/inventario/Inventario";
import DocumentTitle from "./components/common/DocumentTitle";
import SuscripcionesPage from "./pages/suscripciones/SuscripcionesPage";
import PlanesPage from "./pages/planes/PlanesPage";
import PagosPage from "./pages/pagos/PagosPage";
import ReporteCobranzaPage from "./pages/pagos/ReporteCobranzaPage";
// HistorialClientePage fue deprecado a favor de FichaAlumnoPage (más completa).
// La ruta vieja sigue respondiendo con un redirect — ver más abajo.
import AsistenciaPage from "./pages/asistencia/AsistenciaPage";
import ConfiguracionPage from "./pages/configuracion/ConfiguracionPage";
import CanchaPage from "./pages/cancha/CanchaPage";
import CanchasAdminPage from "./pages/cancha/CanchasAdminPage";
import CanchaCalendarioPage from "./pages/cancha/CanchaCalendarioPage";
import CanchaTarifasPage from "./pages/cancha/CanchaTarifasPage";
import CanchaBloqueosPage from "./pages/cancha/CanchaBloqueosPage";
import ReportesGraficosPage from "./pages/dashboard/ReportesGraficosPage";
import FichaAlumnoPage from "./pages/customers/FichaAlumnoPage";
import KioskoAsistenciaPage from "./pages/asistencia/KioskoAsistenciaPage";

// Redirect 301-style para la URL legacy /clientes/:id/historial-gimnasio →
// /clientes/:id/ficha. Mantenemos la ruta para no romper bookmarks ni links
// generados por reportes/PDFs viejos.
function NavigateToFicha() {
  const { id } = useParams();
  return <Navigate to={`/clientes/${id}/ficha`} replace />;
}

function App() {
  return (
    <Router>
      <DocumentTitle />
      <AuthProvider>
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
            <Route path="/movements/summary" element={<MovementsPage />} />;
            <Route path="/movements/cajas" element={<CajasPage />} />;
            <Route path="/movements/tiposgasto" element={<TiposGastoPage />} />;
            <Route path="/customers" element={<CustomersPage />} />;
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
            <Route
              path="/cancha/bloqueos"
              element={<CanchaBloqueosPage />}
            />
            <Route
              path="/reportes-graficos"
              element={<ReportesGraficosPage />}
            />
            <Route
              path="/clientes/:id/ficha"
              element={<FichaAlumnoPage />}
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
