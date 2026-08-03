# Matriz de roles y permisos

La matriz canónica está en `app/permissions.py`. Los roles aportan valores iniciales; un administrador puede sustituirlos por permisos individuales. La API valida cada acción.

| Permiso | Administrador | Oficina inicial | Corte inicial |
|---|:---:|:---:|:---:|
| `jobs_view` Ver trabajos | Sí | Sí | No |
| `jobs_create` Crear trabajos | Sí | Sí | No |
| `jobs_edit` Editar trabajos | Sí | Sí | No |
| `jobs_delete` Eliminar trabajos | Sí | No | No |
| `jobs_restore` Restaurar trabajos | Sí | No | No |
| `excel_import` Importar Excel/CSV | Sí | Sí | No |
| `history_view` Consultar historial | Sí | Sí | No |
| `orders_view` Ver órdenes | Sí | Sí | Sí |
| `orders_create` Crear/enviar órdenes | Sí | Sí | No |
| `orders_approve` Reabrir/cancelar | Sí | No | No |
| `orders_print` Imprimir | Sí | No | Sí |
| `orders_receive` Confirmar recepción | Sí | No | Sí |
| `orders_complete` Finalizar corte | Sí | No | Sí |
| `users_manage` Administrar usuarios | Sí | No | No |
| `permissions_manage` Administrar permisos | Sí | No | No |

## Reglas adicionales

- `admin` siempre recibe todos los permisos aunque se envíe una lista individual.
- Una lista individual sustituye los permisos de rol, no se suma.
- Corte recibe DTOs sanitizados y no puede consultar trabajos ni escribir medidas.
- Reabrir/cancelar requiere motivo y `orders_approve`.
- Crear orden requiere `orders_create` y congela/envía en una sola transacción.
- Desactivar o cambiar contraseña revoca sesiones previas.
