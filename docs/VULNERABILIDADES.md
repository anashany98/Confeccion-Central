# Vulnerabilidades y riesgos

## Corregidos

| Riesgo original | Severidad inicial | Mitigación |
|---|---|---|
| Snapshot controlado por cliente | BLOQUEANTE | snapshot autoritativo de base + ítems congelados |
| Trabajo editable tras aprobar | BLOQUEANTE | bloqueo servidor y HTTP 423 |
| Estados arbitrarios/reversibles | BLOQUEANTE | máquina de estados |
| Numeración concurrente | BLOQUEANTE | advisory lock PostgreSQL |
| Secretos de reserva/bootstrap automático | CRÍTICO | configuración obligatoria y CLI explícita |
| Sin CSRF ni límite de login | ALTO | token CSRF, intentos y bloqueo |
| Permisos agregados/solo UI | CRÍTICO | matriz granular y dependencias API |
| Costes expuestos a corte | ALTO | DTO allowlist |
| Datos empresariales en localStorage | ALTO | estado solo en memoria/API |
| Docker root/base vulnerable | ALTO | no-root, hardening y base fijada |
| Tablas automáticas sin migración | CRÍTICO | Alembic |

## Escaneos finales

- Bandit: sin hallazgos.
- pip-audit: sin CVE conocidas en dependencias Python fijadas.
- npm audit: 0 vulnerabilidades.
- Trivy imagen final: 0 HIGH/CRITICAL en OS y paquetes Python.
- Búsqueda de secretos: no se incluyen credenciales reales; `.env.example` contiene marcadores `REEMPLAZAR_...`.

## Riesgo residual

- `FORWARDED_ALLOW_IPS=*` es compatible con plataformas gestionadas pero debe restringirse al proxy conocido.
- Cookies requieren HTTPS en producción; HTTP solo se admite expresamente en desarrollo.
- CSP permite estilos inline por la arquitectura frontend actual; scripts externos no están permitidos.
- No existe segundo factor, SSO ni política de rotación automática.
- Los backups no se cifran por el script: el destino externo debe aportar cifrado y control de acceso.
- Una XSS futura seguiría pudiendo hacer acciones con la sesión, aunque no leer la cookie; CSP, escaping y CSRF reducen el riesgo.
- La auditoría se protege por permisos y ausencia de endpoints de edición, no mediante almacenamiento WORM.
