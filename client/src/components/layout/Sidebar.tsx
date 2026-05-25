import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import {
  XMarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HomeIcon,
  KeyIcon,
  UsersIcon,
  PencilSquareIcon,
  BanknotesIcon,
  RectangleGroupIcon,
  WrenchIcon,
  LockClosedIcon,
  ChartBarIcon,
  ShoppingCartIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { Link, useLocation } from "react-router-dom";
import type { Dispatch, SetStateAction } from "react";

interface NavigationChild {
  name: string;
  href: string;
  children?: NavigationChild[];
}

interface NavigationItem extends NavigationChild {
  icon?: React.ReactNode;
}

// Reorganización del sidebar por centros de negocio (Gimnasio / Cancha /
// Cantina) + secciones transversales (Reportes, Caja, Modificaciones,
// Administración). Refleja el modelo mental del cliente (whiteboard) y
// reduce de 16 a 11 items top-level.
//
// Las acciones de uso diario (Asistencia, Apertura/Cierre de Caja) quedan
// como accesos directos al tope para no requerir un click extra.
const navigation: NavigationItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: <HomeIcon className="h-7 w-6" />,
  },
  {
    name: "Asistencia",
    href: "/asistencia",
    icon: <KeyIcon className="h-7 w-6" />,
  },
  {
    name: "Apertura/Cierre de Caja",
    href: "/apertura-cierre-caja",
    icon: <LockClosedIcon className="h-7 w-6" />,
  },
  {
    name: "Gimnasio",
    href: "/gimnasio",
    icon: <DocumentTextIcon className="h-7 w-6" />,
    children: [
      { name: "Suscripciones", href: "/suscripciones" },
      { name: "Pagos", href: "/pagos" },
      { name: "Planes", href: "/planes" },
      { name: "Cobro de Créditos", href: "/credito-pagos" },
      { name: "Reporte de Cobranza", href: "/reporte-cobranza" },
    ],
  },
  {
    name: "Cancha",
    href: "/cancha",
    icon: <RectangleGroupIcon className="h-7 w-6" />,
    children: [
      { name: "Calendario", href: "/cancha/calendario" },
      { name: "Reservas", href: "/cancha" },
      { name: "Catálogo", href: "/canchas" },
      { name: "Tarifas", href: "/cancha/tarifas" },
      { name: "Bloqueos", href: "/cancha/bloqueos" },
    ],
  },
  {
    name: "Cantina",
    href: "/cantina",
    icon: <ShoppingCartIcon className="h-7 w-6" />,
    children: [
      { name: "Ventas (POS)", href: "/ventas" },
      { name: "Compras", href: "/compras" },
      { name: "Productos", href: "/products" },
      { name: "Combos", href: "/combos" },
      { name: "Almacenes", href: "/almacenes" },
      { name: "Inventario", href: "/inventario" },
    ],
  },
  {
    name: "Clientes",
    href: "/customers",
    icon: <UsersIcon className="h-7 w-6" />,
  },
  {
    name: "Reportes",
    href: "/reportes-section",
    icon: <ChartBarIcon className="h-7 w-6" />,
    children: [
      { name: "Reportes gráficos", href: "/reportes-graficos" },
      { name: "Reporte clásico", href: "/reportes" },
    ],
  },
  {
    name: "Caja",
    href: "/caja",
    icon: <BanknotesIcon className="h-7 w-6" />,
    children: [
      { name: "Registro Diario Caja", href: "/movements/summary" },
      { name: "Clientes con deuda", href: "/clientes-con-deuda" },
      { name: "Cajas", href: "/movements/cajas" },
      { name: "Tipos de Gasto", href: "/movements/tiposgasto" },
    ],
  },
  {
    name: "Modificaciones",
    href: "/modifications",
    icon: <PencilSquareIcon className="h-7 w-6" />,
    children: [
      { name: "Ventas", href: "/modifications/ventas" },
      { name: "Compras", href: "/modifications/compras" },
      { name: "Facturas", href: "/facturas" },
    ],
  },
  {
    name: "Administración",
    href: "/admin",
    icon: <WrenchIcon className="h-7 w-6" />,
    children: [
      { name: "Configuración", href: "/configuracion" },
      { name: "Locales", href: "/locales" },
      { name: "Usuarios", href: "/users" },
      { name: "Perfiles", href: "/perfiles" },
      { name: "Menús", href: "/menus" },
    ],
  },
];

interface NavItemProps {
  item: NavigationItem;
  level?: number;
  onNavigate?: () => void;
}

// Recorre el árbol y devuelve todos los hrefs de descendientes leaf.
function descendantHrefs(item: NavigationChild): string[] {
  if (!item.children || item.children.length === 0) return [item.href];
  return item.children.flatMap((c) => descendantHrefs(c));
}

function NavItem({ item, level = 0, onNavigate }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === item.href;
  // Para items con hijos: el grupo se abre si la ruta actual coincide con
  // cualquiera de sus descendientes leaf. El highlight visual del padre se
  // omite (el hijo activo ya lo marca y el grupo expandido indica el contexto).
  const grupoTieneActivo =
    item.children && descendantHrefs(item).includes(location.pathname);

  if (item.children) {
    return (
      <Disclosure as="div" defaultOpen={grupoTieneActivo}>
        {({ open }) => (
          <>
            <DisclosureButton
              className="flex items-center w-full px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white rounded-md cursor-pointer"
              style={{ paddingLeft: `${level * 12 + 12}px` }}
            >
              {level === 0 && <span className="mr-3 text-lg">{item.icon}</span>}
              <span className="flex-1 text-left">{item.name}</span>
              {open ? (
                <ChevronDownIcon className="h-4 w-4" />
              ) : (
                <ChevronRightIcon className="h-4 w-4" />
              )}
            </DisclosureButton>
            <DisclosurePanel as="ul" className="space-y-1">
              {item.children &&
                item.children.map((child) => (
                  <li key={child.name}>
                    <NavItem
                      item={child}
                      level={level + 1}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
            </DisclosurePanel>
          </>
        )}
      </Disclosure>
    );
  }

  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      className={`relative flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
        isActive
          ? "bg-gray-700/60 text-white"
          : "text-gray-300 hover:bg-gray-700 hover:text-white"
      }`}
      style={{ paddingLeft: `${level * 12 + (level === 0 ? 12 : 24)}px` }}
    >
      {/* Barrita lateral naranja para señalar el item activo (acento de marca). */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-orange-500"
        />
      )}
      {level === 0 && <span className="mr-3 text-lg">{item.icon}</span>}
      {item.name}
    </Link>
  );
}

interface SidebarProps {
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
}

export default function Sidebar({ mobileOpen, setMobileOpen }: SidebarProps) {
  return (
    <>
      {/* Mobile sidebar */}
      <div className="lg:hidden">
        <div
          className={`fixed inset-0 z-40 bg-gray-600 bg-opacity-75 transition-opacity ${
            mobileOpen ? "block" : "hidden"
          }`}
          onClick={() => setMobileOpen(false)}
        />

        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 transform ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          } transition-transform lg:relative lg:translate-x-0`}
        >
          <div className="flex h-full flex-col bg-gray-800">
            <div className="flex h-16 shrink-0 items-center justify-between px-4 bg-gray-900">
              <div className="flex items-center gap-2">
                <span
                  className="text-white font-bold tracking-wide text-sm"
                  style={{
                    fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
                    letterSpacing: "0.05em",
                  }}
                >
                  GIMNASIO <span className="text-orange-400">&</span> CANCHA
                </span>
              </div>
              <button
                type="button"
                className="rounded-md text-gray-300 hover:text-white focus:outline-none cursor-pointer"
                onClick={() => setMobileOpen(false)}
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <nav className="px-2 py-4 space-y-1">
                {navigation.map((item) => (
                  <NavItem
                    key={item.name}
                    item={item}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop sidebar (siempre visible) */}
      <div
        className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:flex lg:flex-col bg-sidebar"
        style={{
          top: "64px",
          height: "calc(100vh - 64px)",
          // background: "#0F172A",
        }}
      >
        <div className="flex-1 overflow-y-auto">
          <nav className="px-2 py-4 space-y-1">
            {navigation.map((item) => (
              <NavItem key={item.name} item={item} />
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
