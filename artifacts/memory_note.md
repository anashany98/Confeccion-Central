# UTF-8 mojibake masivo en index.html - Cómo se metió y cómo se arregla

## El problema

`app/static/index.html` quedó con **doble y triple encoding** después de que
varias rondas de `Edit`/`Write` reescribieran secciones con chars acentuados
y emojis. El flujo fue:

1. Archivo original UTF-8 OK: `ó` = `C3 B3` (2 bytes)
2. Algún `Edit` lo leyó como **cp1252** (Windows) en lugar de UTF-8
3. Lo guardó de nuevo en UTF-8: `ó` (C3 B3) → `Ã` (C3 83) + `³` (C2 B3) = `Ã³`
4. Para emojis: `🗑` (F0 9F 9D 91) → triple encoding con bytes de control sueltos

Síntomas en pantalla: `ConfecciÃ³n Central`, `ProducciÃ³n`, iconos del sidebar
como `â†¶` (↶ mal visto), emojis como `ðŸ—‘` (🗑 mal visto).

## Cómo se diagnostica

```python
# Bytes "sanos" en archivo UTF-8:
#   ó = C3 B3
# Bytes con DOBLE encoding:
#   ó → Ã³ = C3 83 C2 B3
# Bytes con TRIPLE encoding (iconos del sidebar):
#   ↶ (21 B6) = E2 86 B6 → â†¶ = C3 A2 E2 80 A0 C2 B6
# Bytes con triple encoding de emojis (bytes 0x80-0x9F son controles sueltos):
#   🗑 (1F5D1) = F0 9F 9D 91 → ðŸ—‘ = C3 B0 C5 B8 E2 80 94 E2 80 98
```

## Cómo se arregla (lo que funcionó en este proyecto)

Tres pasadas, todas idempotentes:

1. **Doble encoding** — buscar pares `ÃX`, `ÂX`, `â€X` y mapear al original.
2. **Triple encoding** — buscar grupos de 2-3 chars Latin-1 supplement que
   empiezan por `â` (U+00E2), invertir la cadena (cp1252 → UTF-8 → char).
3. **Emojis rotos** — buscar los bytes específicos que quedaron como
   `C3 B0 C5 B8 ...` (resultado del triple-encoding de emojis) y mapear a mano.

## El script de fix (artifacts/fix_mojibake_v2.py)

`artifacts/fix_mojibake_v2.py` arregla los pasos 1 y 2. El paso 3 (emojis) hay
que hacerlo a mano porque el byte 0x9F no es cp1252 válido y rompe la
automatización. Patrones específicos a buscar:
- `c3b0c5b8e28094e28098` → `F0 9F 9D 91` (🗑, wastebasket, 2 ocurrencias)
- `c3b0c5b8c28fc2a2` → `F0 9F 8F AD` (🏭, factory)
- `c3b0c5b8e2809cc2a5` → `F0 9F 93 A5` (📥, inbox tray)
- `c3b0c5b8e28098c281` → `F0 9F 91 81` (👁, eye)

## ⚠️ Trampa crítica: rebuild del container

`docker-compose.yml` no tiene un `volumes: ./app/static:/app/app/static` para
el servicio `app`. Los estáticos se **copian al build** del image. Después de
editar `index.html`, hay que:

```bash
docker compose build app
docker compose up -d app
```

Si no, el container sigue sirviendo la versión vieja con mojibake aunque
el archivo en disco esté bien.

## ⚠️ Trampa crítica 2: Service Worker cachea

`app/static/sw.js` con `network-first` para estáticos. Pero si el navegador ya
tiene la versión vieja en el cache del SW, va a la red, recibe la nueva, la
sirve y la cachea. La nueva versión del HTML registra el SW nuevo. Mientras
el SW viejo sigue activo, sirve HTML viejo.

Para evitar el ciclo: bump `CACHE = "confeccion-central-v2.0.X"` en `sw.js`
cada vez que cambies los estáticos, y considerar `serviceWorkers: 'block'`
en Playwright para tests E2E.

## Lección

- **Siempre rebuild del container después de cambiar estáticos** (no hay
  volumen montado).
- **Bump versión del SW** (`v2.0.1` → `v2.0.2`) tras cada cambio de assets.
- **En Windows, los `Edit`/`Write` pueden corromper el encoding** si la
  tool lee mal el BOM o el charset. Escribir SIEMPRE explícitamente en UTF-8.
