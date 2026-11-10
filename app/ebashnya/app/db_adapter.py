#!/usr/bin/env python3
"""Database adapter for Emberspire mini app.
Provides a SQLite-like interface but uses PostgreSQL with 'app_' prefixed tables.
This allows the mini app to share the same database as the main bot without conflicts.
"""

import os
import psycopg2
import psycopg2.extras
import threading
import logging
from contextlib import contextmanager

log = logging.getLogger("emberspire.db")

class PostgreSQLAdapter:
    """
    Adapter that provides SQLite-like interface for PostgreSQL.
    All table names are automatically prefixed with 'app_' to avoid conflicts.
    """
    
    def __init__(self):
        self.connection_params = {
            'host': os.environ.get('DB_HOST', 'localhost'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME', 'nemesis_game'),
            'user': os.environ.get('DB_USER', 'postgres'),
            'password': os.environ.get('DB_PASSWORD', ''),
        }
        self._local = threading.local()
        self._lock = threading.Lock()
        log.info(f"PostgreSQL adapter initialized: {self.connection_params['host']}:{self.connection_params['port']}/{self.connection_params['database']}")
    
    def _get_connection(self):
        """Get or create thread-local connection."""
        if not hasattr(self._local, 'conn') or self._local.conn.closed:
            self._local.conn = psycopg2.connect(**self.connection_params)
            self._local.conn.autocommit = False  # Manual transaction control
        return self._local.conn
    
    def _prefix_table(self, query):
        """Add 'app_' prefix to table names in CREATE/INSERT/UPDATE/DELETE/SELECT statements."""
        # This is a simple approach - for production, consider using proper SQL parsing
        # Common table names from the original SQLite schema
        tables = [
            'players', 'act', 'fight_log', 'ref_hits', 'raids', 'raid_hits',
            'saves', 'raid_events', 'raid_tries_c', 'raid_stats', 'raid_chats',
            'kv', 'raid_tries', 'duels', 'quests', 'star_ledger'
        ]
        
        result = query
        for table in tables:
            # Replace table names with app_ prefix
            # Handle various SQL contexts
            replacements = [
                (f'FROM {table} ', f'FROM app_{table} '),
                (f'FROM {table}\n', f'FROM app_{table}\n'),
                (f'JOIN {table} ', f'JOIN app_{table} '),
                (f'INTO {table} ', f'INTO app_{table} '),
                (f'INTO {table}(', f'INTO app_{table}('),
                (f'UPDATE {table} ', f'UPDATE app_{table} '),
                (f'TABLE {table} ', f'TABLE app_{table} '),
                (f'TABLE {table}(', f'TABLE app_{table}('),
            ]
            for old, new in replacements:
                result = result.replace(old, new)
        
        # Convert SQLite syntax to PostgreSQL
        # REAL -> DOUBLE PRECISION or TIMESTAMP
        result = result.replace('REAL DEFAULT 0', 'DOUBLE PRECISION DEFAULT 0')
        result = result.replace('REAL', 'TIMESTAMP')
        
        return result
    
    def execute(self, query, params=None):
        """Execute a query with automatic table prefixing."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Add table prefix
        prefixed_query = self._prefix_table(query)
        
        # Convert ? placeholders to %s for PostgreSQL
        pg_query = prefixed_query.replace('?', '%s')
        
        try:
            if params:
                cursor.execute(pg_query, params)
            else:
                cursor.execute(pg_query)
            return PostgreSQLCursor(cursor, conn)
        except Exception as e:
            log.error(f"Query failed: {pg_query[:200]}")
            log.error(f"Params: {params}")
            log.error(f"Error: {e}")
            raise
    
    def commit(self):
        """Commit the current transaction."""
        conn = self._get_connection()
        conn.commit()
    
    def rollback(self):
        """Rollback the current transaction."""
        conn = self._get_connection()
        conn.rollback()
    
    def close(self):
        """Close the connection."""
        if hasattr(self._local, 'conn') and not self._local.conn.closed:
            self._local.conn.close()


class PostgreSQLCursor:
    """Wrapper to provide SQLite-like cursor interface."""
    
    def __init__(self, cursor, connection):
        self._cursor = cursor
        self._connection = connection
        self.rowcount = cursor.rowcount
    
    def fetchone(self):
        """Fetch one row."""
        row = self._cursor.fetchone()
        if row is None:
            return None
        # Convert dict to tuple for SQLite compatibility
        # But keep it as dict for easier access
        return row
    
    def fetchall(self):
        """Fetch all rows."""
        return self._cursor.fetchall()
    
    def __iter__(self):
        """Make cursor iterable."""
        return iter(self._cursor)


# Global database instance
db = None
db_lock = threading.Lock()


def init_db():
    """Initialize the database connection."""
    global db
    if db is None:
        db = PostgreSQLAdapter()
    return db


def get_db():
    """Get the database instance."""
    global db
    if db is None:
        init_db()
    return db


# For backward compatibility with existing code that expects sqlite3 interface
def connect(*args, **kwargs):
    """Compatibility function that returns our adapter."""
    return get_db()
