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
            'saves', 'raid_events', 'raid_tries_c', 'raid_tries_chat', 'raid_stats', 'raid_chats',
            'kv', 'raid_tries', 'duels', 'quests', 'star_ledger', 'gr_lobby', 
            'nft_drops', 'activity', 'gr_claims', 'sessions', 'ghost_offers', 'quest_claims',
            'duel_paid', 'ac_flags', 'ac_state', 'star_pay'
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
        
        # AUTOINCREMENT -> SERIAL (PostgreSQL auto-increment)
        result = result.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'SERIAL PRIMARY KEY')
        result = result.replace('AUTOINCREMENT', '')
        
        # INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING (PostgreSQL)
        if 'INSERT OR IGNORE INTO' in result:
            import re
            # Extract table name and first column (assumed to be primary key)
            match = re.search(r'INSERT OR IGNORE INTO\s+(\w+)\s*\(([^)]+)\)', result, re.IGNORECASE)
            if match:
                table_name = match.group(1)
                columns = [c.strip() for c in match.group(2).split(',')]
                
                # Special handling for tables with composite primary keys
                # Note: table names will already have app_ prefix when this runs
                composite_keys = {
                    'app_act': ['day', 'uid'],
                    'app_activity': ['day', 'uid'],
                    'app_ref_hits': ['inviter', 'visitor', 'day'],
                    'app_raid_hits': ['ci', 'week', 'uid'],
                    'app_raid_tries_c': ['uid', 'ci', 'day'],
                    'app_raid_tries_chat': ['uid', 'ci', 'day'],
                    'app_raid_tries': ['uid', 'day'],
                    'app_raid_stats': ['uid', 'ci'],
                    'app_quests': ['uid', 'day', 'quest_id'],
                    'app_gr_claims': ['uid', 'day', 'b'],
                    'app_quest_claims': ['uid', 'qid', 'period'],
                    'app_duel_paid': ['uid', 'day'],
                    'app_ghost_offers': ['uid', 'gid'],
                }
                
                # Check if this table has a composite key
                pk_cols = composite_keys.get(table_name)
                if pk_cols:
                    # Use composite key
                    pk_clause = ', '.join(pk_cols)
                else:
                    # Use first column as primary key
                    pk_clause = columns[0]
                
                result = result.replace('INSERT OR IGNORE INTO', 'INSERT INTO')
                # Add ON CONFLICT DO NOTHING at the end
                result = re.sub(r'(\))\s*$', f'\\1 ON CONFLICT ({pk_clause}) DO NOTHING', result)
        
        # INSERT OR REPLACE -> INSERT ... ON CONFLICT DO UPDATE (PostgreSQL upsert)
        # Simple replacement for common pattern: INSERT OR REPLACE INTO kv(k, v) VALUES
        if 'INSERT OR REPLACE INTO' in result:
            import re
            # Pattern: INSERT OR REPLACE INTO table(col1, col2) VALUES
            match = re.search(r'INSERT OR REPLACE INTO\s+(\w+)\s*\(([^)]+)\)', result, re.IGNORECASE)
            if match:
                table_name = match.group(1)
                columns = [c.strip() for c in match.group(2).split(',')]
                # Assume first column is primary key for ON CONFLICT
                pk_col = columns[0]
                # Build UPDATE SET clause
                if len(columns) > 1:
                    update_cols = ', '.join([f"{col} = EXCLUDED.{col}" for col in columns[1:]])
                    result = result.replace('INSERT OR REPLACE INTO', 'INSERT INTO')
                    # Add ON CONFLICT at the end (before any semicolon or end of string)
                    result = re.sub(r'(\))\s*$', f'\\1 ON CONFLICT ({pk_col}) DO UPDATE SET {update_cols}', result)
                else:
                    # Only one column, just do nothing on conflict
                    result = result.replace('INSERT OR REPLACE INTO', 'INSERT INTO')
                    result = re.sub(r'(\))\s*$', f'\\1 ON CONFLICT ({pk_col}) DO NOTHING', result)
        
        return result
    
    def execute(self, query, params=None):
        """Execute a query with automatic table prefixing."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Add table prefix
        prefixed_query = self._prefix_table(query)
        
        # Convert ? placeholders to %s for PostgreSQL
        pg_query = prefixed_query.replace('?', '%s')
        
        # Convert unix timestamp params to PostgreSQL timestamp
        # Check if query has timestamp columns
        if params:
            import re
            # Find all %s placeholders and their positions
            # Note: 'ts' removed from this list as it stores unix timestamps as BIGINT
            timestamp_cols = ['first_seen', 'updated', 'seen', 'done_at', 'fought', 'created',
                            'killed', 'ends', 'rest_at', 'reminded', 'wipe_at', 'last', 'req_ts', 'done_ts']
            
            # Check if any timestamp column is in the query
            has_timestamp = any(col in pg_query for col in timestamp_cols)
            
            if has_timestamp:
                # Convert numeric params that look like unix timestamps to to_timestamp()
                converted_params = []
                for p in params:
                    if isinstance(p, (int, float)) and p > 1000000000:  # Unix timestamp
                        # Keep as number, we'll use to_timestamp() in query
                        converted_params.append(p)
                    else:
                        converted_params.append(p)
                params = tuple(converted_params)
                
                # Replace VALUES(%s, %s, ...) to wrap timestamp params with to_timestamp()
                # For INSERT queries with timestamp columns
                if 'INSERT INTO' in pg_query:
                    # Find column names in INSERT
                    insert_match = re.search(r'INSERT INTO\s+\w+\s*\(([^)]+)\)', pg_query, re.IGNORECASE)
                    if insert_match:
                        columns = [c.strip() for c in insert_match.group(1).split(',')]
                        # Build new VALUES clause with to_timestamp() for timestamp columns
                        values_match = re.search(r'VALUES\s*\(([^)]+)\)', pg_query, re.IGNORECASE)
                        if values_match:
                            placeholders = values_match.group(1).split(',')
                            new_placeholders = []
                            for i, col in enumerate(columns):
                                if i < len(placeholders):
                                    placeholder = placeholders[i].strip()
                                    if col in timestamp_cols and placeholder == '%s':
                                        new_placeholders.append('to_timestamp(%s)')
                                    else:
                                        new_placeholders.append(placeholder)
                            new_values = 'VALUES(' + ', '.join(new_placeholders) + ')'
                            pg_query = re.sub(r'VALUES\s*\([^)]+\)', new_values, pg_query, flags=re.IGNORECASE)
                
                # For UPDATE queries
                if 'UPDATE' in pg_query:
                    for col in timestamp_cols:
                        # Replace: column = %s with: column = to_timestamp(%s)
                        pg_query = re.sub(f'{col}\s*=\s*%s', f'{col} = to_timestamp(%s)', pg_query)
                
                # For comparison operators in WHERE
                for col in timestamp_cols:
                    # Replace: column < %s with: column < to_timestamp(%s)
                    pg_query = re.sub(f'{col}\s*(<|>|<=|>=|=)\s*%s', f'{col} \\1 to_timestamp(%s)', pg_query)
        
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
    
    def executemany(self, query, params_list):
        """Execute a query multiple times with different parameters."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Add table prefix
        prefixed_query = self._prefix_table(query)
        
        # Convert ? placeholders to %s for PostgreSQL
        pg_query = prefixed_query.replace('?', '%s')
        
        try:
            cursor.executemany(pg_query, params_list)
            conn.commit()
            return PostgreSQLCursor(cursor, conn)
        except Exception as e:
            conn.rollback()
            log.error(f"Executemany failed: {pg_query[:200]}")
            log.error(f"Error: {e}")
            raise
    
    def executescript(self, script):
        """Execute multiple SQL statements (SQLite compatibility)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            # Split script by semicolons and execute each statement
            statements = [s.strip() for s in script.split(';') if s.strip()]
            for statement in statements:
                cursor.execute(statement)
            conn.commit()
        except Exception as e:
            conn.rollback()
            log.error(f"Executescript failed: {e}")
            raise
    
    def cursor(self):
        """Return a cursor object (SQLite compatibility)."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        return PostgreSQLCursor(cursor, conn)
    
    @property
    def row_factory(self):
        """SQLite row_factory compatibility (ignored)."""
        return None
    
    @row_factory.setter
    def row_factory(self, factory):
        """SQLite row_factory compatibility (ignored)."""
        pass
    
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
        self.lastrowid = None  # PostgreSQL doesn't have lastrowid like SQLite
    
    def execute(self, query, params=None):
        """Execute a query (for cursor.execute() calls)."""
        # This allows db.cursor().execute() pattern
        pg_query = query.replace('?', '%s')
        if params:
            self._cursor.execute(pg_query, params)
        else:
            self._cursor.execute(pg_query)
        self.rowcount = self._cursor.rowcount
        return self
    
    def executemany(self, query, params_list):
        """Execute many (for cursor.executemany() calls)."""
        pg_query = query.replace('?', '%s')
        self._cursor.executemany(pg_query, params_list)
        self.rowcount = self._cursor.rowcount
        return self
    
    def fetchone(self):
        """Fetch one row as tuple (SQLite compatibility)."""
        try:
            row = self._cursor.fetchone()
        except ValueError as e:
            # Handle timestamp conversion errors (e.g., year out of range)
            # This can happen if unix timestamps are stored as numbers
            if 'year' in str(e) and 'out of range' in str(e):
                log.warning(f"Timestamp conversion error (likely unix timestamp stored as number): {e}")
                # Try to fetch raw data without cursor conversion
                # Return None to avoid breaking the application
                return None
            raise
        
        if row is None:
            return None
        
        # Convert dict to tuple for SQLite compatibility
        if isinstance(row, dict):
            # Convert datetime objects back to unix timestamps
            import datetime
            converted_values = []
            for v in row.values():
                if isinstance(v, datetime.datetime):
                    # Convert to unix timestamp
                    converted_values.append(v.timestamp())
                else:
                    converted_values.append(v)
            return tuple(converted_values)
        return row
    
    def fetchall(self):
        """Fetch all rows as list of tuples."""
        rows = self._cursor.fetchall()
        # Convert dicts to tuples for SQLite compatibility
        if rows and isinstance(rows[0], dict):
            import datetime
            result = []
            for row in rows:
                converted_values = []
                for v in row.values():
                    if isinstance(v, datetime.datetime):
                        converted_values.append(v.timestamp())
                    else:
                        converted_values.append(v)
                result.append(tuple(converted_values))
            return result
        return rows
    
    def fetchmany(self, size=None):
        """Fetch many rows (SQLite compatibility)."""
        rows = self._cursor.fetchmany(size) if size else self._cursor.fetchmany()
        # Convert dicts to tuples
        if rows and isinstance(rows[0], dict):
            import datetime
            result = []
            for row in rows:
                converted_values = []
                for v in row.values():
                    if isinstance(v, datetime.datetime):
                        converted_values.append(v.timestamp())
                    else:
                        converted_values.append(v)
                result.append(tuple(converted_values))
            return result
        return rows
    
    def close(self):
        """Close the cursor."""
        self._cursor.close()
    
    def __iter__(self):
        """Make cursor iterable, yielding tuples."""
        import datetime
        for row in self._cursor:
            if isinstance(row, dict):
                converted_values = []
                for v in row.values():
                    if isinstance(v, datetime.datetime):
                        converted_values.append(v.timestamp())
                    else:
                        converted_values.append(v)
                yield tuple(converted_values)
            else:
                yield row
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        if exc_type is None:
            self._connection.commit()
        else:
            self._connection.rollback()
        return False


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
