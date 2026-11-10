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
        # Handle PRAGMA table_info - convert to PostgreSQL
        if query.strip().startswith('PRAGMA table_info('):
            # Extract table name from PRAGMA table_info(table_name)
            import re
            match = re.match(r'PRAGMA table_info\((\w+)\)', query.strip())
            if match:
                table_name = match.group(1)
                prefixed_table = f'app_{table_name}'
                # Simple PostgreSQL query - just return column names
                pg_query = f"""
                    SELECT 
                        ordinal_position - 1 as cid,
                        column_name as name,
                        data_type as type,
                        CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END as notnull,
                        column_default as dflt_value,
                        0 as pk
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = '{prefixed_table}'
                    ORDER BY ordinal_position
                """
                return pg_query
        
        # This is a simple approach - for production, consider using proper SQL parsing
        # Common table names from the original SQLite schema
        tables = [
            'players', 'act', 'fight_log', 'ref_hits', 'raids', 'raid_hits',
            'saves', 'raid_events', 'raid_tries_c', 'raid_stats', 'raid_chats',
            'kv', 'raid_tries', 'duels', 'quests', 'star_ledger', 'gr_lobby', 
            'nft_drops', 'activity'
        ]
        
        result = query
        for table in tables:
            # Replace table names with app_ prefix
            # Handle various SQL contexts including CREATE INDEX
            replacements = [
                (f'FROM {table} ', f'FROM app_{table} '),
                (f'FROM {table}\n', f'FROM app_{table}\n'),
                (f'JOIN {table} ', f'JOIN app_{table} '),
                (f'INTO {table} ', f'INTO app_{table} '),
                (f'INTO {table}(', f'INTO app_{table}('),
                (f'UPDATE {table} ', f'UPDATE app_{table} '),
                (f'TABLE {table} ', f'TABLE app_{table} '),
                (f'TABLE {table}(', f'TABLE app_{table}('),
                (f'ON {table}(', f'ON app_{table}('),  # CREATE INDEX ON table(column)
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
        except psycopg2.errors.UndefinedTable as e:
            # Table doesn't exist yet - return empty result for PRAGMA queries
            conn.rollback()
            log.info(f"Table doesn't exist yet (expected on first run): {e}")
            # Return empty cursor for PRAGMA table_info when table doesn't exist
            return PostgreSQLCursor(cursor, conn)
        except psycopg2.errors.DuplicateColumn as e:
            # Column already exists - rollback and continue
            conn.rollback()
            log.info(f"Column already exists (expected): {e}")
            return PostgreSQLCursor(cursor, conn)
        except psycopg2.errors.DuplicateTable as e:
            # Table already exists - rollback and continue
            conn.rollback()
            log.info(f"Table already exists (expected): {e}")
            return PostgreSQLCursor(cursor, conn)
        except Exception as e:
            conn.rollback()
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
        """Fetch one row as tuple (SQLite compatibility)."""
        row = self._cursor.fetchone()
        if row is None:
            return None
        # Convert dict to tuple for SQLite compatibility
        if isinstance(row, dict):
            return tuple(row.values())
        return row
    
    def fetchall(self):
        """Fetch all rows as list of tuples."""
        rows = self._cursor.fetchall()
        # Convert dicts to tuples for SQLite compatibility
        if rows and isinstance(rows[0], dict):
            return [tuple(row.values()) for row in rows]
        return rows
    
    def __iter__(self):
        """Make cursor iterable, yielding tuples."""
        for row in self._cursor:
            if isinstance(row, dict):
                yield tuple(row.values())
            else:
                yield row


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
