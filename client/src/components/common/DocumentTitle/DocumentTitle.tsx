import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Mapeo de paths estáticos → título de pestaña.
const ROUTE_TITLES: Record<string, string> = {
  "/login": "Iniciar sesión",
  "/dashboard": "Dashboard",
  "/ventas": "Ventas",
  "/compras": "Compras",
  "/inventario": "Inventario",
  "/users": "Usuarios",
  "/movements/summary": "Registro Diario Caja",
  "/movements/cajas": "Cajas",
  "/movements/tiposgasto": "Tipos de gasto",
  "/customers": "Clientes",
  "/apertura-cierre-caja": "Apertura y cierre de caja",
  "/locales": "Locales",
  "/almacenes": "Almacenes",
  "/combos": "Combos",
  "/perfiles": "Perfiles",
  "/menus": "Menús",
  "/products": "Productos",
  "/modifications/ventas": "Modificaciones de ventas",
  "/modifications/compras": "Modificaciones de compras",
  "/credito-pagos": "Crédito y pagos",
  "/clientes-con-deuda": "Clientes con deuda",
  "/cancha/bloqueos": "Bloqueos de cancha",
  "/planes": "Planes",
  "/suscripciones": "Suscripciones",
  "/pagos": "Pagos",
  "/reportes": "Reportes",
  "/facturas": "Facturas",
  "/asistencia": "Asistencia",
  "/kiosko-asistencia": "Kiosko de asistencia",
  "/reporte-cobranza": "Reporte de cobranza",
  "/configuracion": "Configuración",
  "/cancha": "Cancha — Reservas",
  "/canchas": "Cancha — Catálogo",
  "/cancha/calendario": "Cancha — Calendario",
  "/cancha/tarifas": "Cancha — Tarifas",
  "/reportes-graficos": "Reportes gráficos",
};

// Patrones para rutas dinámicas. Se evalúan en orden si no hubo match exacto.
const DYNAMIC_TITLES: Array<{ pattern: RegExp; title: string }> = [
  // /historial-gimnasio quedó como redirect a /ficha. Mientras dura el flash
  // del redirect, mostramos el mismo título para no parpadear.
  { pattern: /^\/clientes\/[^/]+\/historial-gimnasio$/, title: "Ficha del alumno" },
  { pattern: /^\/clientes\/[^/]+\/ficha$/, title: "Ficha del alumno" },
];

function resolveTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  for (const d of DYNAMIC_TITLES) {
    if (d.pattern.test(pathname)) return d.title;
  }
  return "Página no encontrada";
}

function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = resolveTitle(pathname);
  }, [pathname]);

  return null;
}

export default DocumentTitle;
