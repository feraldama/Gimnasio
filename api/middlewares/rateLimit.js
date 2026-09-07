// Limitadores de tasa.
//
// El login no tenía ningún freno: se podían tirar miles de intentos por
// segundo contra `POST /api/usuarios/login` y bcrypt no alcanza como defensa
// cuando el atacante prueba contraseñas comunes contra muchos usuarios.
//
// Decisiones para no romper la operación del gimnasio:
//   - La clave del limitador es IP + usuario, no sólo IP. Los puestos del
//     gimnasio pueden salir por una misma IP (NAT); con clave sólo por IP, un
//     puesto equivocándose de contraseña dejaría afuera a todo el mostrador.
//   - Sólo cuentan los intentos FALLIDOS (`skipSuccessfulRequests`), así que
//     alguien que entra bien todo el día nunca se topa con el límite.
//   - El límite es holgado para un humano (10 intentos fallidos cada 15 min)
//     pero corta en seco la fuerza bruta.
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const VENTANA_MIN = parseInt(process.env.LOGIN_RATE_WINDOW_MIN, 10) || 15;
const MAX_INTENTOS = parseInt(process.env.LOGIN_RATE_MAX, 10) || 10;

const loginLimiter = rateLimit({
  windowMs: VENTANA_MIN * 60 * 1000,
  limit: MAX_INTENTOS,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // `ipKeyGenerator` normaliza IPv6 (requerido por express-rate-limit v7+ al
  // construir claves propias). El campo `email` del body es en realidad el
  // UsuarioId con el que se loguea.
  keyGenerator: (req) => {
    const usuario = String(req.body?.email || "").trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}|${usuario}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: "DEMASIADOS_INTENTOS",
      message:
        `Demasiados intentos fallidos. Esperá ${VENTANA_MIN} minutos o ` +
        "contactá al administrador.",
    });
  },
});

// Segundo limitador, por IP sola y con techo más alto.
//
// Por qué hacen falta los dos: `loginLimiter` cuenta por IP+usuario, así que
// frena el ataque de diccionario contra UNA cuenta sin que un puesto que se
// equivoca deje afuera al resto del mostrador. Pero deja pasar el "password
// spraying": probar una contraseña común (123456, la del año) contra MUCHOS
// usuarios distintos, 10 intentos por cuenta y a otra. Este segundo limitador
// pone el techo global por IP, alto para no molestar al uso normal (el
// gimnasio entero puede salir por una sola IP) pero muy por debajo de lo que
// necesita un ataque de rociado.
const loginIpLimiter = rateLimit({
  windowMs: VENTANA_MIN * 60 * 1000,
  limit: parseInt(process.env.LOGIN_RATE_MAX_IP, 10) || 100,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: "DEMASIADOS_INTENTOS",
      message:
        `Demasiados intentos fallidos desde esta red. Esperá ${VENTANA_MIN} ` +
        "minutos o contactá al administrador.",
    });
  },
});

module.exports = { loginLimiter, loginIpLimiter };
