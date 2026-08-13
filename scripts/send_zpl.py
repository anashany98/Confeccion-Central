#!/usr/bin/env python3
"""Envía un archivo ZPL (.prn) a una impresora Zebra por red (puerto 9100).

Uso:
    python scripts/send_zpl.py <IP_DE_LA_ZEBRA> <archivo.prn>

Ejemplo:
    python scripts/send_zpl.py 192.168.1.50 etiquetas.prn

(Nota: en la consola de Windows el símbolo de flecha se escribe como ->.)

El archivo .prn se genera desde la app (botón «ZPL Zebra» en la vista de
Etiquetas -> Descargar .prn). El contenido se manda en bruto (raw) a la
impresora; la propia Zebra lo interpreta como ZPL.
"""

from __future__ import annotations

import socket
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    ip, path = sys.argv[1], sys.argv[2]
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as exc:
        print(f"No se pudo leer {path}: {exc}")
        return 1
    try:
        with socket.create_connection((ip, 9100), timeout=10) as sock:
            sock.sendall(data)
    except OSError as exc:
        print(f"No se pudo conectar con {ip}:9100 — revisa la IP de la impresora: {exc}")
        return 1
    print(f"Enviados {len(data)} bytes a {ip}:9100")
    return 0


if __name__ == "__main__":
    sys.exit(main())
