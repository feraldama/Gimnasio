# Tests de la API

Sin dependencias: usa el runner incorporado de Node (`node:test`).

## Correr

```bash
pnpm test          # sólo lo que no necesita base (rápido, seguro)
pnpm run test:db   # además los tests de integración
```

`pnpm test` no toca la base: los tests que la necesitan se saltean solos y
avisan por qué. Es lo que conviene poner en un hook de pre-commit o en CI.

## Estructura

| Archivo | Qué protege |
|---|---|
| `suscripcionEstado.test.js` | vigencia de la suscripción (A/V/F), rango inclusivo, estados manuales C/S |
| `dateUtils.test.js` | fechas locales; fija el reloj a las 22:00 para el bug de GMT-3 |
| `rucDv.test.js` | dígito verificador del RUC (va en la factura legal) |
| `permission.test.js` | middleware de permisos, con la base simulada |
| `utils.test.js` | escape de LIKE, sigla del día para tarifas, métodos que mueven el cajón |
| `cajaApertura.test.js` | regla de apertura/cierre de caja (no reabrir, no recerrar) |
| `integration/asistenciaCupo.test.js` | descuento de cupo de clases y su atomicidad |
| `integration/canchaTarifa.test.js` | qué precio se cobra en cada banda horaria |
| `integration/cajaAperturaCierre.test.js` | que el registro contable y el movimiento del monto sean atómicos |
| `integration/rucDv.datos.test.js` | cruza el DV contra los clientes importados (sólo lee) |
| `integration/suscripcionesVigentes.test.js` | qué cuenta el reporte por rango: solapamiento, bordes inclusivos, suscripciones vs socios |

## Por qué los unitarios no tocan la base

`config/db.js` abre el pool de Postgres al cargarse y lo mantiene vivo 60
segundos (`idleTimeoutMillis`). Un test que lo requiera, aunque no consulte
nada, deja el proceso colgado ese tiempo. Los unitarios inyectan un doble del
módulo en `require.cache` **antes** de cargar el código a probar:

```js
const rutaDb = require.resolve("../config/db");
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true,
                          exports: { query: miStub } };
```

Los de integración sí usan el pool real y lo cierran con `db.end()` en el hook
`after`, siempre (incluso si la limpieza falla).

## Los tests de integración escriben en la base

Crean sus datos con nombres `TEST-*` y los borran al terminar, ordenando los
DELETE según las llaves foráneas. Aun así: **apuntar `DB_NAME` a una copia**,
no a la base de producción.

Si una corrida se interrumpe a la mitad pueden quedar filas. Para limpiarlas:

```sql
DELETE FROM asistencia  WHERE ClienteId IN (SELECT ClienteId FROM clientes WHERE ClienteNombre LIKE 'TEST-%');
DELETE FROM suscripcion WHERE ClienteId IN (SELECT ClienteId FROM clientes WHERE ClienteNombre LIKE 'TEST-%');
DELETE FROM clientes    WHERE ClienteNombre LIKE 'TEST-%';
DELETE FROM plan        WHERE PlanNombre    LIKE 'TEST-%';
DELETE FROM cancha_tarifa WHERE CanchaId IN (SELECT CanchaId FROM cancha WHERE CanchaNombre LIKE 'TEST-%');
DELETE FROM cancha      WHERE CanchaNombre  LIKE 'TEST-%';
```

## Qué falta cubrir

- Descuento de stock en la venta (`utils/stockOps.js`).
- Creación de suscripción con pago (transacción de `pago.controller`).
- Reservas de cancha: solapamiento con bloqueos y con otras reservas.
