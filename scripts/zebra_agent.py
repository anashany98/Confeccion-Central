#!/usr/bin/env python3
"""Agente local de impresion Zebra: recibe el ZPL de la app y lo envia a la
impresora por red (puerto 9100). Permite imprimir con un clic desde el navegador.

Uso:
    python scripts/zebra_agent.py <IP_DE_LA_ZEBRA> [puerto_http]

Ejemplo:
    python scripts/zebra_agent.py 192.168.1.50

La app (vista Etiquetas -> boton «Enviar a Zebra») manda el ZPL a
http://127.0.0.1:8765 y este agente lo reenvia en bruto (raw) a la impresora.
Deja el agente corriendo en el PC del taller; puedes iniciarlo al arrancar
Windows con un acceso directo en Inicio.

Seguridad: el agente solo acepta peticiones cuyo header Origin coincida con la
variable ZEBRA_ALLOWED_ORIGIN (p. ej. ZEBRA_ALLOWED_ORIGIN=https://confeccion.example.com).
Sin esa variable solo acepta origenes locales (http://localhost / http://127.0.0.1),
util en desarrollo. Asi, una web cualquiera abierta en el PC del taller no puede
disparar impresiones no deseadas (drive-by printing).

(Nota: el texto de esta ayuda usa solo ASCII para que se vea bien en la
consola de Windows.)
"""

from __future__ import annotations

import os
import socket
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PRINTER_IP = sys.argv[1] if len(sys.argv) > 1 else None
HTTP_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
ALLOWED_ORIGIN = os.getenv("ZEBRA_ALLOWED_ORIGIN", "").strip().rstrip("/")


def send_zpl(zpl: str) -> None:
    data = zpl.encode("utf-8")
    with socket.create_connection((PRINTER_IP, 9100), timeout=10) as sock:
        sock.sendall(data)


def _origin_allowed(origin: str) -> bool:
    if not origin or origin == "null":
        return False
    if ALLOWED_ORIGIN:
        return origin.rstrip("/") == ALLOWED_ORIGIN
    # Sin configuracion, solo origenes locales (desarrollo).
    return origin.startswith(("http://localhost:", "http://127.0.0.1:", "http://[::1]:"))


class Handler(BaseHTTPRequestHandler):
    def _cors(self, origin: str) -> None:
        # Reenviamos el origen verificado (nunca '*') para que el navegador
        # pueda leer la respuesta solo desde origenes autorizados.
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _reject(self, code: int, message: str) -> None:
        body = message.encode("utf-8", "replace")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # preflight CORS
        origin = self.headers.get("Origin", "")
        if not _origin_allowed(origin):
            self._reject(403, "Origen no autorizado")
            return
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        origin = self.headers.get("Origin", "")
        if not _origin_allowed(origin):
            hint = (
                "Origen no autorizado. Configura ZEBRA_ALLOWED_ORIGIN="
                "https://tu-dominio (recibido: " + (origin or "<sin Origin>") + ")"
            )
            self._reject(403, hint)
            return
        length = int(self.headers.get("Content-Length", 0))
        zpl = self.rfile.read(length).decode("utf-8", "replace")
        try:
            send_zpl(zpl)
            body = f"ok:{len(zpl)} bytes a {PRINTER_IP}".encode("utf-8", "replace")
            self.send_response(200)
        except OSError as exc:
            body = str(exc).encode("utf-8", "replace")
            self.send_response(502)
        self._cors(origin)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # silencio en consola
        pass


if __name__ == "__main__":
    if not PRINTER_IP:
        print(__doc__)
        sys.exit(2)
    print(f"Agente Zebra activo: impresora {PRINTER_IP}:9100 | HTTP en 127.0.0.1:{HTTP_PORT}")
    if ALLOWED_ORIGIN:
        print(f"Origen autorizado: {ALLOWED_ORIGIN}")
    else:
        print(
            "AVISO: ZEBRA_ALLOWED_ORIGIN no está definido; solo se aceptan orígenes "
            "locales (http://localhost / http://127.0.0.1). Para producción defínela "
            "con el dominio HTTPS de la app."
        )
    HTTPServer(("127.0.0.1", HTTP_PORT), Handler).serve_forever()
