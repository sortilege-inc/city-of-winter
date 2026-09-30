#!/usr/bin/env python3
"""Local dev server for the play surface: http.server, but never cached.

Plain `python3 -m http.server` lets the browser keep old ES modules, so an
edited table.js can silently not load. This sends no-store on everything.

  usage: python3 web/serve.py [port]      (default 8731)
"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
handler = functools.partial(NoCache, directory=os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
