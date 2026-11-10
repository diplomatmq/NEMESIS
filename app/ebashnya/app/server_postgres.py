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
    
    # Import our PostgreSQL adapter
    from db_adapter import get_db, db_lock
    
    # Create a module-level db instance
    db = get_db()
    
    # Patch the sqlite3 module so imports of sqlite3 get our adapter
    import sys
    
    class SQLite3Module:
        """Mock sqlite3 module that returns our PostgreSQL adapter."""
        def connect(self, *args, **kwargs):
            return db
    
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
    # Import server after patching
    import server
