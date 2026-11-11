#!/usr/bin/env python3
"""
Wrapper for server.py that uses PostgreSQL instead of SQLite.
This file patches the db connection before importing server.py
"""

import sys
import os

# Check if we should use PostgreSQL
USE_POSTGRES = os.environ.get('DB_HOST') and os.environ.get('DB_PASSWORD')

if USE_POSTGRES:
    print("🔌 Using PostgreSQL database")
    
    # Import psycopg2 for exception handling FIRST
    import psycopg2
    
    # Import our PostgreSQL adapter
    from db_adapter import get_db, db_lock
    
    # Create a module-level db instance
    db = get_db()
    
    # Patch the sqlite3 module BEFORE importing server.py
    # This is critical because server.py imports sqlite3 at module level
    class SQLite3Module:
        """Mock sqlite3 module that returns our PostgreSQL adapter."""
        def connect(self, *args, **kwargs):
            return db
        
        # Add exception classes for compatibility
        OperationalError = psycopg2.OperationalError
        IntegrityError = psycopg2.IntegrityError
        DatabaseError = psycopg2.DatabaseError
        Error = psycopg2.Error
    
    # CRITICAL: Patch sys.modules BEFORE importing server.py
    sys.modules['sqlite3'] = SQLite3Module()
    
    print(f"✅ PostgreSQL adapter loaded: {os.environ.get('DB_HOST')}:{os.environ.get('DB_PORT')}/{os.environ.get('DB_NAME')}")
else:
    print("📁 Using SQLite database")
    import sqlite3
    
    DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "emberspire.db"))
    print(f"✅ SQLite database: {DB_PATH}")

# Now import and run the original server
# The server.py will use our patched sqlite3 which returns PostgreSQL adapter
if __name__ == "__main__":
    # Set __name__ in server module to "__main__" so it runs the server
    import server
    # The import above will execute server.py's if __name__ == "__main__" block
    # But since we're importing it, __name__ will be "server", not "__main__"
    # So we need to manually trigger the main block
    
    # Just importing server.py will initialize everything but won't start the server
    # We need to run the server manually
    import threading
    import time
    from server import (
        bot_loop, reminder_loop, events_loop, housekeeping_loop,
        ac_loop, ac_scan, ac_digest_loop, ThreadingHTTPServer, Handler,
        BOT_TOKEN, PORT, PUBLIC, log
    )
    
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is not set (see emberspire.env.example)")
    
    if os.environ.get("EMBER_NO_BOT") != "1":
        threading.Thread(target=bot_loop, daemon=True).start()
        threading.Thread(target=reminder_loop, daemon=True).start()
        threading.Thread(target=events_loop, daemon=True).start()
    
    threading.Thread(target=housekeeping_loop, daemon=True).start()
    
    def _br_warm():
        import urllib.request
        time.sleep(2)
        paths = ["/"]
        public_a = os.path.join(PUBLIC, "a")
        if os.path.isdir(public_a):
            paths += ["/a/" + n for n in os.listdir(public_a) if n.endswith(".js")]
        for _ in range(2):
            for pth in paths:
                try:
                    urllib.request.urlopen(
                        urllib.request.Request(f"http://127.0.0.1:{PORT}{pth}", headers={"Accept-Encoding": "br"}),
                        timeout=90
                    ).read()
                except Exception as e:
                    log.info("brotli warm %s: %s", pth, e)
            time.sleep(15)
    
    threading.Thread(target=_br_warm, daemon=True).start()
    threading.Thread(target=ac_loop, daemon=True).start()
    threading.Thread(target=ac_scan, daemon=True).start()
    
    if os.environ.get("EMBER_NO_BOT") != "1":
        threading.Thread(target=ac_digest_loop, daemon=True).start()
    
    log.info("Emberspire on 0.0.0.0:%s, game folder %s", PORT, PUBLIC)
    # Listen on 0.0.0.0 instead of 127.0.0.1 for Docker
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
