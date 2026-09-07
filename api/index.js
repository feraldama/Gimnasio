require("dotenv").config();

// Cortar el arranque si falta configuración crítica (ver config/env.js). Va
// antes de todo lo demás para que el error se vea en el boot y no como un
// "no puedo entrar" inexplicable media hora después.
require("./config/env").validarEnv();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// Importar rutas
const usuarioRoutes = require("./routes/usuario.routes");
const registroDiarioCajaRoutes = require("./routes/registrodiariocaja.routes");
const cajaRoutes = require("./routes/caja.routes");
const tipoGastoRoutes = require("./routes/tipogasto.routes");
const clienteRoutes = require("./routes/cliente.routes");
const tipogastoGrupoRoutes = require("./routes/tipogastogrupo.routes");
const productoRoutes = require("./routes/producto.routes");
const localRoutes = require("./routes/local.routes");
const almacenRoutes = require("./routes/almacen.routes");
const comboRoutes = require("./routes/combo.routes");
const perfilRoutes = require("./routes/perfil.routes");
const menuRoutes = require("./routes/menu.routes");
const perfilMenuRoutes = require("./routes/perfilmenu.routes");
const usuarioPerfilRoutes = require("./routes/usuarioperfil.routes");
const ventaProductoRoutes = require("./routes/ventaproducto.routes");
const ventaRoutes = require("./routes/venta.routes");
const ventaCreditoRoutes = require("./routes/ventacredito.routes");
const ventaCreditoPagoRoutes = require("./routes/ventacreditopago.routes");
const facturaRoutes = require("./routes/factura.routes");
const compraRoutes = require("./routes/compra.routes");
const proveedorRoutes = require("./routes/proveedor.routes");
const planRoutes = require("./routes/plan.routes");
const suscripcionRoutes = require("./routes/suscripcion.routes");
const pagoRoutes = require("./routes/pago.routes");
const asistenciaRoutes = require("./routes/asistencia.routes");
const configuracionRoutes = require("./routes/configuracion.routes");
const canchaRoutes = require("./routes/cancha.routes");
const canchaReservaRoutes = require("./routes/canchaReserva.routes");
const canchaTarifaRoutes = require("./routes/canchaTarifa.routes");
const canchaCreditoRoutes = require("./routes/canchaCredito.routes");
const canchaBloqueoRoutes = require("./routes/canchaBloqueo.routes");
const reportesRoutes = require("./routes/reportes.routes");
const tableroRoutes = require("./routes/tablero.routes");
// const productoRoutes = require("./routes/producto.routes"); // Ejemplo adicional

const app = express();

// Configuración de CORS
// Por defecto aceptamos la red local del POS. Para extender, definir
// ALLOWED_ORIGINS en .env como lista separada por comas, o "*" para abrir
// a todos los orígenes (útil solo en LAN cerrada).
const defaultOrigins = [
  "http://localhost:3006",
  "http://127.0.0.1:3006",
  "http://192.168.0.17:3006",
  "http://localhost:3008",
  "http://127.0.0.1:3008",
  "http://192.168.0.17:3008",
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigins = allowedOrigins.length ? allowedOrigins : defaultOrigins;
const allowAny = corsOrigins.includes("*");

const corsOptions = {
  origin: (origin, cb) => {
    // Permitir tools (curl, Postman, server-to-server) sin header Origin
    if (!origin) return cb(null, true);
    if (allowAny) return cb(null, true);
    if (corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} no permitido por CORS`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400, // 24 horas
};

// Si la API queda detrás de un reverse proxy (nginx, Cloudflare), Express ve
// la IP del proxy y no la del cliente: los limitadores de login meterían a
// TODOS los puestos en el mismo balde. Definir TRUST_PROXY en .env (ej. "1"
// para un proxy, o "loopback") sólo cuando realmente haya uno — activarlo sin
// proxy permite falsear la IP con el header X-Forwarded-For.
if (process.env.TRUST_PROXY) {
  const valor = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(valor) ? parseInt(valor, 10) : valor);
  console.log(`trust proxy activado: ${valor}`);
}

// Middlewares
// helmet pone las cabeceras de seguridad estándar. Una excepción importante:
// `crossOriginResourcePolicy` va en "cross-origin" porque el frontend corre en
// otro puerto y muestra las fotos de producto con <img src="…/api/productos/
// :id/imagen"> (ver client/src/utils/productImage.ts). Con el default
// "same-origin" el browser bloquearía esas imágenes en el POS, Compras e
// Inventario.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Rutas
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/registrodiariocaja", registroDiarioCajaRoutes);
app.use("/api/caja", cajaRoutes);
app.use("/api/tipogasto", tipoGastoRoutes);
app.use("/api/clientes", clienteRoutes);
app.use("/api/tipogastogrupo", tipogastoGrupoRoutes);
app.use("/api/productos", productoRoutes);
app.use("/api/locales", localRoutes);
app.use("/api/almacen", almacenRoutes);
app.use("/api/combo", comboRoutes);
app.use("/api/perfiles", perfilRoutes);
app.use("/api/menus", menuRoutes);
app.use("/api/perfilmenu", perfilMenuRoutes);
app.use("/api/usuarioperfil", usuarioPerfilRoutes);
app.use("/api/ventaproducto", ventaProductoRoutes);
app.use("/api/venta", ventaRoutes);
app.use("/api/ventacredito", ventaCreditoRoutes);
app.use("/api/ventacreditopago", ventaCreditoPagoRoutes);
app.use("/api/factura", facturaRoutes);
app.use("/api/compras", compraRoutes);
app.use("/api/proveedores", proveedorRoutes);
app.use("/api/planes", planRoutes);
app.use("/api/suscripciones", suscripcionRoutes);
app.use("/api/pagos", pagoRoutes);
app.use("/api/asistencia", asistenciaRoutes);
app.use("/api/configuracion", configuracionRoutes);
app.use("/api/canchas", canchaRoutes);
app.use("/api/cancha-reservas", canchaReservaRoutes);
app.use("/api/cancha-tarifas", canchaTarifaRoutes);
app.use("/api/cancha-creditos", canchaCreditoRoutes);
app.use("/api/cancha-bloqueos", canchaBloqueoRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/tablero", tableroRoutes);
// app.use("/api/productos", productoRoutes); // Ejemplo adicional

// Ruta de prueba
app.get("/", (req, res) => {
  res.send("API funcionando");
});

// 404 para rutas de API desconocidas. Sin esto, un endpoint mal escrito caía
// en el handler de errores o devolvía HTML, y el frontend mostraba un error
// genérico sin pista de que la URL no existe.
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    code: "NO_ENCONTRADO",
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// Manejo de errores. Loguea el detalle en el servidor y devuelve un mensaje
// genérico en JSON: el stack o el mensaje del driver de Postgres pueden
// exponer nombres de tabla y SQL. Los 4 argumentos son obligatorios para que
// Express lo reconozca como error handler.
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  // Si la respuesta ya empezó a escribirse no se puede cambiar el status:
  // hay que delegar al handler por defecto de Express, que cierra el socket.
  // Un `return` pelado acá dejaba la request colgada hasta el timeout.
  if (res.headersSent) return next(err);
  // CORS rechaza con un Error propio; conviene distinguirlo de un 500.
  if (err && /no permitido por CORS/.test(err.message || "")) {
    return res.status(403).json({
      success: false,
      code: "CORS_BLOQUEADO",
      message: "Origen no permitido.",
    });
  }
  res.status(500).json({
    success: false,
    code: "ERROR_INTERNO",
    message: "Error interno del servidor.",
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en puerto ${PORT}`);
  // Avisa si algún router pide permiso sobre un MenuId que no existe en la
  // tabla `menu` (un typo ahí niega el acceso para siempre a los perfiles no
  // admin, sin error visible). Sólo avisa: nunca corta el arranque.
  require("./middlewares/permission")
    .verificarRecursosEnBD()
    .catch((e) => console.error("Chequeo de recursos falló:", e.message));
});
