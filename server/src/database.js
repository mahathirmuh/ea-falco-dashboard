const sql = require('mssql');
require('dotenv').config();

// Application database configuration (VaultIDCardProcessor)
// Use APPDB_* so DataDBEnt (DATADB_*) can be reserved for routes that need the original vault DB
const config = {
    user: process.env.APPDB_USER || process.env.DATADB_USER,
    password: process.env.APPDB_PASSWORD || process.env.DATADB_PASSWORD,
    server: process.env.APPDB_SERVER || process.env.DATADB_SERVER,
    database: process.env.APPDB_NAME || process.env.DATADB_NAME,
    port: parseInt(process.env.APPDB_PORT || process.env.DATADB_PORT) || 1433,
    options: {
        encrypt: false, // Set to true if using Azure
        trustServerCertificate: true, // Use for self-signed certificates
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

const configSource = {
    user: process.env.APPDB_USER ? 'APPDB_USER' : (process.env.DATADB_USER ? 'DATADB_USER' : 'unset'),
    password: process.env.APPDB_PASSWORD ? 'APPDB_PASSWORD' : (process.env.DATADB_PASSWORD ? 'DATADB_PASSWORD' : 'unset'),
    server: process.env.APPDB_SERVER ? 'APPDB_SERVER' : (process.env.DATADB_SERVER ? 'DATADB_SERVER' : 'unset'),
    database: process.env.APPDB_NAME ? 'APPDB_NAME' : (process.env.DATADB_NAME ? 'DATADB_NAME' : 'unset'),
    port: process.env.APPDB_PORT ? 'APPDB_PORT' : (process.env.DATADB_PORT ? 'DATADB_PORT' : 'unset')
};

class Database {
    constructor() {
        this.pool = null;
        this.connected = false;
    }

    async connect() {
        try {
            if (!this.connected) {
                const masked = (v) => (v ? String(v).replace(/./g, '*').slice(0, 6) : '');
                console.log('[AppDB] Connecting to SQL Server...');
                console.log(`[AppDB] Resolved config: server=${config.server} db=${config.database} port=${config.port} user=${config.user} (sources: server=${configSource.server}, db=${configSource.database}, user=${configSource.user}, port=${configSource.port})`);
                this.pool = await sql.connect(config);
                this.connected = true;
                console.log('[AppDB] Connected to SQL Server successfully');
            }
            return this.pool;
        } catch (err) {
            console.error('[AppDB] Database connection error:', err);
            throw err;
        }
    }

    async disconnect() {
        try {
            if (this.connected && this.pool) {
                await this.pool.close();
                this.connected = false;
                console.log('Disconnected from SQL Server');
            }
        } catch (err) {
            console.error('Database disconnection error:', err);
        }
    }

    async query(queryString, params = {}) {
        try {
            await this.connect();
            const request = this.pool.request();
            const qid = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const paramKeys = Object.keys(params);
            // Add parameters to the request
            paramKeys.forEach(key => {
                request.input(key, params[key]);
            });
            console.log(`[AppDB] QUERY START id=${qid} len=${queryString?.length || 0} params=${paramKeys.join(', ')}`);
            const result = await request.query(queryString);
            const rows = result?.recordset?.length || 0;
            const affected = Array.isArray(result?.rowsAffected) ? result.rowsAffected.join(',') : 'unknown';
            console.log(`[AppDB] QUERY DONE id=${qid} rows=${rows} rowsAffected=${affected}`);
            return result;
        } catch (err) {
            console.error('[AppDB] QUERY ERROR:', err?.message || err);
            console.error('[AppDB] QUERY ERROR detail:', {
                queryPreview: String(queryString || '').slice(0, 200),
                params
            });
            throw err;
        }
    }

    async execute(procedureName, params = {}) {
        try {
            await this.connect();
            const request = this.pool.request();
            const pid = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const paramKeys = Object.keys(params);
            // Add parameters to the request
            paramKeys.forEach(key => {
                request.input(key, params[key]);
            });
            console.log(`[AppDB] EXEC START id=${pid} proc=${procedureName} params=${paramKeys.join(', ')}`);
            const result = await request.execute(procedureName);
            const rows = result?.recordset?.length || 0;
            console.log(`[AppDB] EXEC DONE id=${pid} rows=${rows}`);
            return result;
        } catch (err) {
            console.error('[AppDB] EXEC ERROR:', err?.message || err);
            console.error('[AppDB] EXEC ERROR detail:', { procedureName, params });
            throw err;
        }
    }

    // Helper method to get SQL data types
    getSqlType(value) {
        if (typeof value === 'string') return sql.NVarChar;
        if (typeof value === 'number') return Number.isInteger(value) ? sql.Int : sql.Float;
        if (typeof value === 'boolean') return sql.Bit;
        if (value instanceof Date) return sql.DateTime2;
        return sql.NVarChar; // Default fallback
    }
}

// Create singleton instance
const database = new Database();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await database.disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    await database.disconnect();
    process.exit(0);
});

module.exports = database;