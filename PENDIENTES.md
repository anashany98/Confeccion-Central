# Pendientes y límites conocidos

No quedan hallazgos bloqueantes o críticos conocidos sin documentar. Los siguientes elementos no impiden el piloto controlado, pero deben planificarse.

## Prioridad media

1. **Migración de datos del prototipo anterior.** La revisión Alembic incluida crea el esquema normalizado desde cero. No existe un conversor genérico para bases antiguas con JSON porque no se recibió un conjunto de datos real representativo. Antes de actualizar una instalación previa se debe exportar, ensayar la conversión en copia y validar los recuentos.
2. **Ciclo explícito borrador/revisada/aprobada.** La versión actual crea una orden ya `sent` y bloquea el trabajo en una transacción. El snapshot y la autorización son seguros, pero los estados previos de preparación y doble aprobación recomendados todavía no son entidades independientes.
3. **Incidencias del operario.** La pantalla permite ver, imprimir, recibir y finalizar; aún no existe el formulario estructurado “Informar de un problema”.
4. **Documentos adjuntos.** Existe el modelo y sus restricciones, pero no hay API, almacenamiento de objetos ni interfaz de subida.
5. **Prioridad manual.** “Siguiente orden” usa la orden pendiente más antigua. No existe campo de prioridad o fecha límite editable.
6. **Pruebas de componentes UI.** Hay pruebas estáticas y E2E manual automatizado sobre el navegador integrado, pero no una suite mantenible de componentes ni Playwright CLI en CI.
7. **Prueba física de impresión.** Se verificaron plantilla, CSS A4, invocación del diálogo y API de impresión/reimpresión. La impresora, driver, márgenes físicos y vista previa de Edge/Chrome deben aceptarse en el PC real de corte.
8. **Observabilidad.** Hay request ID y logs de aplicación, pero faltan métricas, alertas, exportación central de logs y panel operativo.

## Prioridad baja o mejora

- Separar `app/main.py` en routers/servicios/repositorios y dividir `index.html`/`central.js` en módulos.
- Añadir limpieza programada de intentos de acceso antiguos y política formal de retención de auditoría.
- Añadir una ubicación externa concreta para backups y una alarma de copia ausente.
- Probar carga sostenida con miles de habitaciones y múltiples oficinas simultáneas.
- Añadir soporte offline de solo lectura si el negocio lo aprueba; hoy la PWA requiere conexión para datos y evita cachear información sensible.
- Validar accesibilidad con lectores de pantalla y contraste mediante herramienta automática en CI.
- Automatizar generación de PDF de regresión visual para las cuatro familias de impresión.

## Decisión de salida

La aplicación puede pasar a un piloto con datos nuevos si se despliega mediante las instrucciones, se cambia toda credencial de ejemplo, se usa HTTPS y se realiza la prueba de aceptación en el puesto físico. No se recomienda convertir directamente una base anterior sin el ensayo de migración indicado.
