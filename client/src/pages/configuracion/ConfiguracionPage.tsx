import { useEffect, useState } from "react";
import {
  getConfiguraciones,
  updateConfiguracion,
  type ConfiguracionItem,
} from "../../services/configuracion.service";
import { usePermiso } from "../../hooks/usePermiso";
import {
  Button,
  Card,
  CardHeader,
  LoadingState,
  ErrorState,
  PermissionDenied,
} from "../../components/common/ui";
import Swal from "sweetalert2";

export default function ConfiguracionPage() {
  const puedeLeer = usePermiso("CONFIGURACION", "leer");
  const puedeEditar = usePermiso("CONFIGURACION", "editar");

  const [items, setItems] = useState<ConfiguracionItem[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await getConfiguraciones();
        setItems(r.data);
        const map: Record<string, string> = {};
        for (const it of r.data) map[it.ConfigClave] = it.ConfigValor;
        setValores(map);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Error al cargar configuracion");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleChange = (clave: string, valor: string) => {
    setValores((v) => ({ ...v, [clave]: valor }));
  };

  const handleSave = async (item: ConfiguracionItem) => {
    try {
      setSaving(item.ConfigClave);
      await updateConfiguracion(item.ConfigClave, {
        ConfigValor: valores[item.ConfigClave] ?? "",
      });
      Swal.fire({
        icon: "success",
        title: "Guardado",
        timer: 1200,
        showConfirmButton: false,
      });
    } catch (e: unknown) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "No se pudo guardar",
      });
    } finally {
      setSaving(null);
    }
  };

  if (!puedeLeer) return <PermissionDenied />;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Configuracion</h1>
      <p className="text-sm text-gray-500 mb-6">
        Parametros generales utilizados por los reportes y modulos del sistema.
      </p>

      <div className="space-y-4">
        {items.map((it) => (
          <Card key={it.ConfigClave}>
            <CardHeader title={it.ConfigClave} description={it.ConfigDescripcion} />
            <div className="flex items-end gap-3 pt-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  Valor ({it.ConfigTipo})
                </label>
                <input
                  type={it.ConfigTipo === "NUMERO" || it.ConfigTipo === "MONTO" ? "number" : "text"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  value={valores[it.ConfigClave] ?? ""}
                  onChange={(e) => handleChange(it.ConfigClave, e.target.value)}
                  disabled={!puedeEditar}
                />
              </div>
              <Button
                onClick={() => handleSave(it)}
                disabled={!puedeEditar || saving === it.ConfigClave}
                variant="primary"
              >
                {saving === it.ConfigClave ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
