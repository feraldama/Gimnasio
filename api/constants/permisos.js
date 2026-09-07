// Catálogo central de los grupos de recursos usados en los routers.
//
// Cada "recurso" es un `menu.MenuId` y espeja el `usePermiso("RECURSO", ...)`
// del frontend. La razón de que existan GRUPOS y no un recurso por router es
// que muchas LECTURAS son compartidas entre pantallas: el catálogo de
// productos lo leen el POS, Inventario, Compras, Combos y los reportes, no
// sólo la pantalla de Productos. Si cada router exigiera su recurso propio, un
// cajero con NUEVAVENTA se quedaría sin poder vender.
//
// Estas listas viven acá y no repetidas en cada archivo de rutas para que
// agregar una pantalla nueva sea un solo cambio y no una cacería. Si un
// recurso listado no existe en la tabla `menu`, el chequeo de arranque
// (middlewares/permission.js → verificarRecursosEnBD) lo avisa en el log:
// un MenuId mal escrito no falla, simplemente niega el permiso para siempre a
// todo perfil que no sea admin, y eso es dificilísimo de diagnosticar.

// Pantallas que operan la cantina/stock y necesitan leer el catálogo, los
// almacenes y los locales.
const LECTORES_CATALOGO = [
  "PRODUCTOS",
  "NUEVAVENTA",
  "VENTAS",
  "NUEVACOMPRA",
  "COMPRAS",
  "INVENTARIO",
  "COMBOS",
  "REPORTES",
];

// Igual que arriba pero sin los reportes: quien elige un almacén está
// operando, no reportando.
const LECTORES_ALMACEN = [
  "ALMACENES",
  "PRODUCTOS",
  "INVENTARIO",
  "NUEVAVENTA",
  "VENTAS",
  "COMPRAS",
  "NUEVACOMPRA",
];

// El combo de locales aparece en el form de Usuarios además de los flujos de
// cantina.
const LECTORES_LOCAL = [
  "LOCALES",
  "USUARIOS",
  "PRODUCTOS",
  "INVENTARIO",
  "NUEVAVENTA",
  "VENTAS",
  "COMPRAS",
  "NUEVACOMPRA",
];

// Reportes de stock / movimientos / más vendidos.
const LECTORES_REPORTE_STOCK = ["REPORTES", "INVENTARIO", "PRODUCTOS"];

// Gráficos del dashboard de reportes.
const LECTORES_REPORTE_GRAFICO = ["REPORTESGRAFICOS", "REPORTES"];

// Combos: el POS los lista para vender.
const LECTORES_COMBO = ["COMBOS", "NUEVAVENTA", "VENTAS"];

// Cajas: las lista casi todo flujo que mueve dinero.
const LECTORES_CAJA = [
  "CAJAS",
  "APERTURACAJA",
  "REGISTRODIARIOCAJA",
  "NUEVAVENTA",
  "VENTAS",
  "COMPRAS",
  "NUEVACOMPRA",
  "COBROCREDITO",
  "PAGOS",
  "SUSCRIPCIONES",
];

// `PUT /caja/:id/monto` lo dispara PagoModal, que se abre desde el Dashboard,
// el POS, Suscripciones y Pagos: acreditar el cobro en la caja es parte de
// registrar el pago.
const AJUSTAN_CAJA_MONTO = [
  "CAJAS",
  "APERTURACAJA",
  "REGISTRODIARIOCAJA",
  "NUEVAVENTA",
  "COBROCREDITO",
  "PAGOS",
  "SUSCRIPCIONES",
];

// Tipos de gasto y sus grupos: se eligen desde el registro diario de caja y
// el modal de pagos, no sólo desde su pantalla de administración.
const LECTORES_TIPOGASTO = ["TIPOSGASTO", "REGISTRODIARIOCAJA", "PAGOS"];

// Proveedores no tiene menú propio: se administran desde Compras.
const PROVEEDORES = ["COMPRAS", "NUEVACOMPRA"];

// Detalle de venta.
const LECTORES_VENTA_DETALLE = ["VENTAS", "NUEVAVENTA", "REPORTES"];
const ESCRITORES_VENTA_DETALLE = ["NUEVAVENTA", "VENTAS"];

// Créditos de venta: se leen desde Ventas, el cobro de créditos y la vista de
// clientes con deuda.
const LECTORES_VENTA_CREDITO = [
  "VENTAS",
  "NUEVAVENTA",
  "COBROCREDITO",
  "CLIENTESCONDEUDA",
];
const ESCRITORES_VENTA_CREDITO = ["NUEVAVENTA", "VENTAS", "COBROCREDITO"];

// Administración: el catálogo de perfiles lo lee la pantalla de Usuarios
// (checkboxes de asignación) y el de menús la grilla de Perfiles.
const LECTORES_PERFIL = ["PERFILES", "USUARIOS"];
const LECTORES_MENU = ["MENUS", "PERFILES"];

// La ficha del alumno (FichaAlumnoPage) muestra datos del cliente, sus
// suscripciones, sus pagos y sus asistencias, pero se gatea en el frontend con
// usePermiso("FICHAALUMNO", "leer"). Sin FICHAALUMNO en estas listas, un perfil
// pensado como "profesor: sólo consultar la ficha" abría la pantalla y recibía
// cuatro 403 sin explicación.
//
// Ojo: FICHAALUMNO habilita SOLO los endpoints por-cliente (`/cliente/:id`),
// nunca los listados completos. Un profesor puede consultar la ficha de un
// alumno sin poder listar toda la cartera de clientes, todos los pagos ni toda
// la planilla de asistencias.
const LECTORES_FICHA_CLIENTE = ["CLIENTES", "FICHAALUMNO"];
const LECTORES_FICHA_SUSCRIPCION = ["SUSCRIPCIONES", "FICHAALUMNO"];
const LECTORES_FICHA_PAGO = ["PAGOS", "FICHAALUMNO"];
const LECTORES_FICHA_ASISTENCIA = ["ASISTENCIA", "FICHAALUMNO"];

// El calendario de Cancha lee claves de configuración (horario operativo).
const LECTORES_CONFIGURACION = ["CONFIGURACION", "CANCHA"];

module.exports = {
  LECTORES_CATALOGO,
  LECTORES_ALMACEN,
  LECTORES_LOCAL,
  LECTORES_REPORTE_STOCK,
  LECTORES_REPORTE_GRAFICO,
  LECTORES_COMBO,
  LECTORES_CAJA,
  AJUSTAN_CAJA_MONTO,
  LECTORES_TIPOGASTO,
  PROVEEDORES,
  LECTORES_VENTA_DETALLE,
  ESCRITORES_VENTA_DETALLE,
  LECTORES_VENTA_CREDITO,
  ESCRITORES_VENTA_CREDITO,
  LECTORES_PERFIL,
  LECTORES_MENU,
  LECTORES_CONFIGURACION,
  LECTORES_FICHA_CLIENTE,
  LECTORES_FICHA_SUSCRIPCION,
  LECTORES_FICHA_PAGO,
  LECTORES_FICHA_ASISTENCIA,
};
