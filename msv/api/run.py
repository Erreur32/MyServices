#!/usr/bin/env python3
"""Entry point of the image: `python3 -m msv.api.run`. Starts the scheduler and the background loops (server.py), then the web server (api.py)."""
from __future__ import annotations

import sys
import threading

from msv.api import api, server
from msv.core import live_events


def main() -> int:
    import uvicorn

    server.start()
    threading.Thread(target=live_events.watch, args=(api.stream_sources(),), daemon=True, name="events").start()   # page event stream
    if api.AUTH and not api.store().has_users():
        server.log(f"aucun compte : ouvrir la page pour créer le compte admin (pendant {api.SETUP_WINDOW // 60} min ; "
                   "au-delà, redémarrer le conteneur)")
    uvicorn.run(api.app, host="0.0.0.0", port=server.PORT, log_level="warning", access_log=False, server_header=False,  # NOSONAR S8392: inside the container; MYSERVICES_ALLOW limits who may connect
                proxy_headers=False)  # IP du client telle que vue (contrôle MYSERVICES_ALLOW), jamais X-Forwarded-For
    return 0


if __name__ == "__main__":
    sys.exit(main())
