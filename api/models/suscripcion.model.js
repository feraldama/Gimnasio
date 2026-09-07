const db = require("../config/db");
const { todayLocalISO, addDaysLocal } = require("../utils/dateUtils");
const { escapeLike } = require("../utils/sql");
const { calcularEstadoPorFechas } = require("../utils/suscripcionEstado");

/**
 * Recalcula el estado de VIGENCIA al vuelo a partir de las fechas, en lugar de
 * confiar en la columna `SuscripcionEstado` (que se congela al crear/editar y
 * no refleja el paso del tiempo). Preserva los estados MANUALES C (Cancelada)
 * y S (Suspendida), que no dependen de fechas. Así los listados/reportes que
 * pasan por el modelo siempre devuelven A/V/F correctos para "hoy".
 */
function conEstadoVigente(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => {
    if (!r || r.SuscripcionEstado === "C" || r.SuscripcionEstado === "S") {
      return r;
    }
    return {
      ...r,
      SuscripcionEstado: calcularEstadoPorFechas(
        r.SuscripcionFechaInicio,
        r.SuscripcionFechaFin
      ),
    };
  });
}

/**
 * Construye condiciones WHERE para filtrar suscripciones en el backend (en vez
 * de filtrar la página visible en el cliente, que daba resultados engañosos).
 *   - filters.estado: 'A' | 'V' | 'F' | 'C' | 'S' (vigencia calculada por fechas;
 *     C/S son manuales). Requiere alias `s` de suscripcion.
 *   - filters.pago: 'PAGADA' | 'PENDIENTE'. Requiere alias `p` (plan) y el join
 *     LATERAL `pg` con `pg.totalpagado`.
 * Devuelve { conds: string[], params: any[] } para intercalar en la query.
 */
function buildSuscripcionFilters(filters = {}) {
  const conds = [];
  const params = [];
  const estado = filters.estado;
  if (estado === "C" || estado === "S") {
    conds.push("s.SuscripcionEstado = ?");
    params.push(estado);
  } else if (estado === "A") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(?) BETWEEN DATE(s.SuscripcionFechaInicio) AND DATE(s.SuscripcionFechaFin)"
    );
    params.push(todayLocalISO());
  } else if (estado === "V") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(s.SuscripcionFechaFin) < DATE(?)"
    );
    params.push(todayLocalISO());
  } else if (estado === "F") {
    conds.push(
      "s.SuscripcionEstado NOT IN ('C','S') AND DATE(s.SuscripcionFechaInicio) > DATE(?)"
    );
    params.push(todayLocalISO());
  }
  const pago = filters.pago;
  if (pago === "PAGADA") {
    conds.push("(COALESCE(p.PlanPrecio,0) = 0 OR pg.totalpagado >= p.PlanPrecio)");
  } else if (pago === "PENDIENTE") {
    conds.push("(COALESCE(p.PlanPrecio,0) > 0 AND pg.totalpagado < p.PlanPrecio)");
  }
  return { conds, params };
}

const Suscripcion = {
  getAll: () => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
      `;
      db.query(query, (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*, 
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        WHERE s.SuscripcionId = ?
      `;
      db.query(query, [id], (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? conEstadoVigente(results)[0] : null);
      });
    });
  },

  create: (suscripcionData) => {
    return new Promise((resolve, reject) => {
      const estado =
        suscripcionData.SuscripcionEstado ||
        calcularEstadoPorFechas(
          suscripcionData.SuscripcionFechaInicio,
          suscripcionData.SuscripcionFechaFin
        );
      // Para modalidad CLASES inicializamos el cupo desde el plan asociado.
      // Para MENSUAL/OPEN queda en 0 (no se usa).
      db.query(
        "SELECT PlanModalidad, PlanCantidadClases FROM plan WHERE PlanId = ?",
        [suscripcionData.PlanId],
        (err, planRows) => {
          if (err) return reject(err);
          const modalidad = planRows[0]?.PlanModalidad || "MENSUAL";
          const cupoInicial =
            modalidad === "CLASES"
              ? Number(planRows[0]?.PlanCantidadClases || 0)
              : 0;
          const clasesRestantes =
            suscripcionData.SuscripcionClasesRestantes !== undefined
              ? Number(suscripcionData.SuscripcionClasesRestantes)
              : cupoInicial;
          const query = `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes) VALUES (?, ?, ?, ?, ?, ?)`;
          const values = [
            suscripcionData.ClienteId,
            suscripcionData.PlanId,
            suscripcionData.SuscripcionFechaInicio,
            suscripcionData.SuscripcionFechaFin,
            estado,
            clasesRestantes,
          ];
          db.query(query, values, (err2, result) => {
            if (err2) return reject(err2);
            Suscripcion.getById(result.insertId)
              .then((suscripcion) => resolve(suscripcion))
              .catch((error) => reject(error));
          });
        }
      );
    });
  },

  update: (id, suscripcionData) => {
    return new Promise((resolve, reject) => {
      // Si vino estado manual (CANCELADA/SUSPENDIDA) se respeta; si no, se recalcula.
      const estado =
        suscripcionData.SuscripcionEstado ||
        calcularEstadoPorFechas(
          suscripcionData.SuscripcionFechaInicio,
          suscripcionData.SuscripcionFechaFin
        );
      // SuscripcionClasesRestantes ahora es editable. Si llega `undefined`
      // (formularios que no lo manejan), usamos COALESCE en SQL para no
      // sobrescribir el cupo existente con NULL. Si llega un número, se
      // respeta (permite al operador corregir errores de carga).
      const clasesParam =
        suscripcionData.SuscripcionClasesRestantes === undefined
          ? null
          : Number(suscripcionData.SuscripcionClasesRestantes);
      const query = `
        UPDATE suscripcion
        SET ClienteId = ?,
            PlanId = ?,
            SuscripcionFechaInicio = ?,
            SuscripcionFechaFin = ?,
            SuscripcionEstado = ?,
            SuscripcionClasesRestantes = COALESCE(?, SuscripcionClasesRestantes)
        WHERE SuscripcionId = ?`;
      const values = [
        suscripcionData.ClienteId,
        suscripcionData.PlanId,
        suscripcionData.SuscripcionFechaInicio,
        suscripcionData.SuscripcionFechaFin,
        estado,
        clasesParam,
        id,
      ];
      db.query(query, values, (err, result) => {
        if (err) return reject(err);
        if (result.affectedRows === 0) return resolve(null);
        Suscripcion.getById(id)
          .then((suscripcion) => resolve(suscripcion))
          .catch((error) => reject(error));
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM suscripcion WHERE SuscripcionId = ?",
        [id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result.affectedRows > 0);
        },
      );
    });
  },

  getAllPaginated: (
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
    filters = {},
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "SuscripcionId",
        "ClienteId",
        "PlanId",
        "SuscripcionFechaInicio",
        "SuscripcionFechaFin",
        "ClienteNombre",
        "PlanNombre",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "SuscripcionId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      // Para ordenar por campos de tablas relacionadas, necesitamos usar alias
      let orderByField = sortField;
      if (sortField === "ClienteNombre") {
        orderByField = "c.ClienteNombre";
      } else if (sortField === "PlanNombre") {
        orderByField = "p.PlanNombre";
      } else {
        orderByField = `s.${sortField}`;
      }

      const { conds, params: filterParams } = buildSuscripcionFilters(filters);
      const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        ${whereSql}
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;

      db.query(query, [...filterParams, limit, offset], (err, results) => {
        if (err) return reject(err);

        // El COUNT debe replicar los joins que usan los filtros (plan para
        // PlanPrecio, LATERAL pago para totalpagado) y el mismo WHERE.
        const countQuery = `
          SELECT COUNT(*) as total
          FROM suscripcion s
          LEFT JOIN plan p ON s.PlanId = p.PlanId
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
            FROM pago WHERE SuscripcionId = s.SuscripcionId
          ) pg ON true
          ${whereSql}
        `;
        db.query(countQuery, filterParams, (err, countResult) => {
          if (err) return reject(err);

          resolve({
            suscripciones: conEstadoVigente(results),
            total: countResult[0].total,
          });
        });
      });
    });
  },

  searchSuscripciones: (
    term,
    limit,
    offset,
    sortBy = "SuscripcionId",
    sortOrder = "ASC",
    filters = {},
  ) => {
    return new Promise((resolve, reject) => {
      const allowedSortFields = [
        "SuscripcionId",
        "ClienteId",
        "PlanId",
        "SuscripcionFechaInicio",
        "SuscripcionFechaFin",
        "ClienteNombre",
        "PlanNombre",
      ];
      const allowedSortOrders = ["ASC", "DESC"];
      const sortField = allowedSortFields.includes(sortBy)
        ? sortBy
        : "SuscripcionId";
      const order = allowedSortOrders.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : "ASC";

      let orderByField = sortField;
      if (sortField === "ClienteNombre") {
        orderByField = "c.ClienteNombre";
      } else if (sortField === "PlanNombre") {
        orderByField = "p.PlanNombre";
      } else {
        orderByField = `s.${sortField}`;
      }

      const { conds, params: filterParams } = buildSuscripcionFilters(filters);
      const filterAnd = conds.length ? ` AND ${conds.join(" AND ")}` : "";

      // El operador de mostrador busca por cédula/RUC casi siempre. Agregamos
      // ClienteRUC al OR para evitar tener que ir a Clientes primero a buscar
      // por nombre + copiar el ID.
      const searchQuery = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE (
          c.ClienteNombre LIKE ?
          OR c.ClienteApellido LIKE ?
          OR c.ClienteRUC LIKE ?
          OR p.PlanNombre LIKE ?
          OR CAST(s.SuscripcionId AS CHAR) LIKE ?
        )${filterAnd}
        ORDER BY ${orderByField} ${order}
        LIMIT ? OFFSET ?
      `;
      const searchValue = `%${escapeLike(term)}%`;

      db.query(
        searchQuery,
        [
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          ...filterParams,
          limit,
          offset,
        ],
        (err, results) => {
          if (err) return reject(err);

          const countQuery = `
            SELECT COUNT(*) as total
            FROM suscripcion s
            LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
            LEFT JOIN plan p ON s.PlanId = p.PlanId
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
              FROM pago WHERE SuscripcionId = s.SuscripcionId
            ) pg ON true
            WHERE (
              c.ClienteNombre LIKE ?
              OR c.ClienteApellido LIKE ?
              OR c.ClienteRUC LIKE ?
              OR p.PlanNombre LIKE ?
              OR CAST(s.SuscripcionId AS CHAR) LIKE ?
            )${filterAnd}
          `;
          db.query(
            countQuery,
            [
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              searchValue,
              ...filterParams,
            ],
            (err, countResult) => {
              if (err) return reject(err);
              resolve({
                suscripciones: conEstadoVigente(results),
                total: countResult[0]?.total || 0,
              });
            },
          );
        },
      );
    });
  },

  getByClienteId: (clienteId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido,
          p.PlanNombre, p.PlanPrecio,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago,
          COALESCE(pg.totalpagado, 0) as TotalPagado
        FROM suscripcion s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        WHERE s.ClienteId = ?
        ORDER BY s.SuscripcionFechaInicio DESC
      `;
      db.query(query, [clienteId], (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },

  /**
   * Lista de trabajo de vencimientos: a quién hay que llamar para que renueve.
   *
   * En un gimnasio el cobro y la retención son lo mismo, porque el acceso es
   * prepago (ver `Asistencia.estadoAcceso`, que bloquea la entrada). Así que
   * esta lista es la herramienta de cobranza real, más que un reporte de
   * antigüedad de deuda.
   *
   * @param {number} dias          ventana hacia adelante (por vencer).
   * @param {number} limit         corte de filas (null = todas).
   * @param {number} clasesMin     umbral de clases restantes para que un plan
   *                               de modalidad CLASES entre en la lista.
   * @param {number} diasVencidos  ventana hacia atrás. Cuántos días de
   *                               vencidos siguen en la lista.
   *
   *                               El default es 7 por compatibilidad con el
   *                               widget del Dashboard, pero para una lista de
   *                               trabajo conviene 30: el socio que venció
   *                               hace dos semanas y dejó de venir es el
   *                               llamado de mayor valor, y con 7 días era
   *                               invisible. Más allá de ~30 días la
   *                               recuperación en un gimnasio es marginal.
   *
   * QUÉ RESUELVE, caso por caso:
   *
   *   * Socio con suscripciones SOLAPADAS o que ya renovó: no aparece. El
   *     INNER JOIN toma sólo la vigencia más lejana de cada cliente, así que
   *     alguien con un plan venciendo el viernes y otro corriendo hasta fin
   *     de mes no entra a la lista.
   *   * Canceladas y suspendidas: excluidas, y también del cálculo del MAX —
   *     si no, una cancelada con fecha lejana ganaba el MAX y el cliente
   *     desaparecía aunque tuviera una vigente venciendo en días.
   *   * Planes por CLASES: entran por cupo agotándose, no sólo por fecha. Un
   *     socio con 1 clase restante se queda sin acceso el próximo ingreso
   *     aunque su fecha fin esté lejos; antes era invisible en esta lista.
   *   * Pago parcial: se devuelve el SALDO en guaraníes, no sólo
   *     PAGADA/PENDIENTE, porque lo que se va a cobrar es ese número.
   *   * Última asistencia: es lo que cambia la conversación. El que viene
   *     todos los días y se le venció se olvidó (renovación casi segura); el
   *     que no viene desde tres semanas ya se fue. Sin ese dato las dos filas
   *     se ven iguales.
   */
  getProximasAVencer: (dias = 30, limit = null, clasesMin = 2, diasVencidos = 7) => {
    return new Promise((resolve, reject) => {
      // Rango basado en fecha local del servidor (no UTC).
      const hoyISO = todayLocalISO();
      const fechaDesdeFormateada = addDaysLocal(hoyISO, -Math.abs(diasVencidos));
      const fechaLimiteFormateada = addDaysLocal(hoyISO, dias);

      const hasLimit = limit != null && limit > 0;
      const baseSelect = `
        SELECT s.*,
          c.ClienteNombre, c.ClienteApellido, c.ClienteTelefono, c.ClienteRUC,
          p.PlanNombre, p.PlanPrecio, p.PlanModalidad, p.PlanCantidadClases,
          CASE
            WHEN COALESCE(p.PlanPrecio, 0) = 0 THEN 'PAGADA'
            WHEN COALESCE(pg.totalpagado, 0) >= p.PlanPrecio THEN 'PAGADA'
            ELSE 'PENDIENTE'
          END as EstadoPago,
          GREATEST(COALESCE(p.PlanPrecio, 0) - COALESCE(pg.totalpagado, 0), 0)
            AS SaldoPendiente,
          asi.ultima AS UltimaAsistencia,
          -- Días sin venir contra la fecha LOCAL del servidor, pasada por
          -- parámetro. Con CURRENT_DATE la cifra dependería de la zona
          -- horaria del motor de base: si la base corre en UTC, entre las
          -- 21:00 y las 23:59 locales CURRENT_DATE ya es mañana y el socio
          -- que vino hoy aparecería con un día de ausencia. Es el mismo
          -- motivo por el que existe utils/dateUtils.
          CASE
            WHEN asi.ultima IS NULL THEN NULL
            ELSE (DATE(?) - asi.ultima)
          END AS DiasSinVenir,
          -- Por qué está en la lista. Sirve para ordenar por urgencia y para
          -- que el mostrador sepa qué decir al llamar.
          CASE
            WHEN DATE(s.SuscripcionFechaFin) < DATE(?) THEN 'VENCIDA'
            WHEN p.PlanModalidad = 'CLASES'
                 AND COALESCE(s.SuscripcionClasesRestantes, 0) <= ?
                 AND DATE(s.SuscripcionFechaFin) > DATE(?)
              THEN 'CLASES'
            ELSE 'VENCE'
          END AS Motivo
        FROM (
          -- UNA fila por cliente: la de vigencia más lejana.
          --
          -- Antes esto era un INNER JOIN contra
          -- MAX(SuscripcionFechaFin) GROUP BY ClienteId, y emparejaba por
          -- igualdad de fecha. Si un cliente tenía DOS planes que terminaban
          -- el MISMO día, los dos empataban con el MAX y la persona salía
          -- DUPLICADA en la lista: dos llamadas para una sola conversación.
          -- DISTINCT ON con desempate por id garantiza una sola fila.
          --
          -- El filtro de canceladas/suspendidas va acá dentro a propósito: si
          -- se aplicara después, una cancelada con fecha lejana ganaría la
          -- selección y el cliente desaparecería del aviso aunque tuviera una
          -- vigente venciendo en días.
          --
          -- LIMITACIÓN: si el cliente tiene varios planes simultáneos, la fila
          -- muestra el saldo del más reciente, no la suma de todos. Para la
          -- lista de llamados alcanza (es una llamada); el detalle completo
          -- está en la ficha del socio.
          SELECT DISTINCT ON (ClienteId) *
          FROM suscripcion
          WHERE SuscripcionFechaFin IS NOT NULL
            AND SuscripcionEstado NOT IN ('C', 'S')
          ORDER BY ClienteId, SuscripcionFechaFin DESC, SuscripcionId DESC
        ) s
        LEFT JOIN clientes c ON s.ClienteId = c.ClienteId
        LEFT JOIN plan p ON s.PlanId = p.PlanId
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(PagoMonto), 0) as totalpagado
          FROM pago WHERE SuscripcionId = s.SuscripcionId
        ) pg ON true
        LEFT JOIN LATERAL (
          -- Última asistencia del cliente. Usa el índice
          -- idx_asistencia_cliente_fecha (migración 017).
          SELECT MAX(AsistenciaFecha) AS ultima
          FROM asistencia WHERE ClienteId = s.ClienteId
        ) asi ON true
        WHERE s.SuscripcionFechaFin IS NOT NULL
          AND s.SuscripcionEstado NOT IN ('C', 'S')
          AND (
            -- Por fecha: dentro de la ventana.
            (DATE(s.SuscripcionFechaFin) >= DATE(?)
             AND DATE(s.SuscripcionFechaFin) <= DATE(?))
            -- O por cupo: plan de clases a punto de agotarse, aunque la fecha
            -- de fin esté lejos.
            OR (p.PlanModalidad = 'CLASES'
                AND COALESCE(s.SuscripcionClasesRestantes, 0) <= ?
                AND DATE(s.SuscripcionFechaFin) >= DATE(?))
          )
        ORDER BY s.SuscripcionFechaFin ASC
      `;
      const query = hasLimit ? `${baseSelect} LIMIT ?` : baseSelect;

      // Orden de los placeholders: los dos del CASE Motivo, los dos del rango
      // de fechas, y los dos de la rama por clases.
      // Orden de los placeholders, en el orden en que aparecen en el SQL:
      //   1) DiasSinVenir      -> hoy
      //   2) Motivo VENCIDA    -> hoy
      //   3) Motivo CLASES     -> umbral de clases
      //   4) Motivo CLASES     -> límite de la ventana
      //   5,6) rango de fechas -> desde, hasta
      //   7) rama por clases   -> umbral
      //   8) rama por clases   -> hoy
      const params = [
        hoyISO,
        hoyISO,
        clasesMin,
        fechaLimiteFormateada,
        fechaDesdeFormateada,
        fechaLimiteFormateada,
        clasesMin,
        hoyISO,
      ];
      if (hasLimit) params.push(limit);

      db.query(query, params, (err, results) => {
        if (err) return reject(err);
        resolve(conEstadoVigente(results));
      });
    });
  },
};

module.exports = Suscripcion;
