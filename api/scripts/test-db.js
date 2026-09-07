// Corre la suite completa INCLUYENDO los tests que necesitan base.
//
// Existe como script de Node y no como variable inline en package.json porque
// `RUN_DB_TESTS=1 node --test` no es portable: funciona en bash pero no en
// cmd/PowerShell, y no queríamos sumar una dependencia (cross-env) sólo para
// esto.
//
// Uso:  pnpm run test:db
//
// Los tests de integración crean sus propios datos (con nombres TEST-*) y los
// borran al terminar. Aun así conviene apuntar DB_NAME a una copia y no a la
// base de producción del gimnasio.
const { spawn } = require("child_process");
const path = require("path");

const hijo = spawn(process.execPath, ["--test"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, RUN_DB_TESTS: "1" },
  stdio: "inherit",
});

hijo.on("exit", (code) => process.exit(code ?? 1));
