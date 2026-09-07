// Validación de variables de entorno al arrancar.
//
// Sin esto, un `.env` incompleto no rompe en el boot sino mucho después y de
// forma confusa: si falta JWT_SECRET, `jwt.sign` tira en el login (500 "Error
// interno") y `jwt.verify` tira en cada request (401 "Token inválido o
// expirado"), así que el síntoma que se ve es "no puedo entrar, la contraseña
// está mal" — nada que apunte a la causa real. Mejor no arrancar y decirlo.
//
// Las variables de DB no van acá a propósito: `config/db.js` tiene defaults
// razonables para desarrollo local (localhost/postgres).

const LARGO_MINIMO_SECRET = 32;

function validarEnv({ exitOnError = true, log = console } = {}) {
  const errores = [];
  const avisos = [];

  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    errores.push(
      "JWT_SECRET no está definida. Es la clave con la que se firman los tokens: " +
        "sin ella no se puede iniciar sesión. Definila en api/.env."
    );
  } else if (secret.trim().length < LARGO_MINIMO_SECRET) {
    avisos.push(
      `JWT_SECRET tiene ${secret.trim().length} caracteres; se recomiendan al ` +
        `menos ${LARGO_MINIMO_SECRET} para que no sea adivinable por fuerza bruta.`
    );
  }

  for (const aviso of avisos) log.warn(`⚠  Configuración: ${aviso}`);

  if (errores.length) {
    log.error("✖ No se puede arrancar por problemas de configuración:");
    for (const e of errores) log.error(`  - ${e}`);
    if (exitOnError) process.exit(1);
  }

  return { errores, avisos };
}

module.exports = { validarEnv, LARGO_MINIMO_SECRET };
