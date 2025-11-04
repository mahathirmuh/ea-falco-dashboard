const sql = require('mssql');
require('dotenv').config();

// Database configuration
const config = {
    user: process.env.DATADB_USER,
    password: process.env.DATADB_PASSWORD,
    server: process.env.DATADB_SERVER,
    database: process.env.DATADB_NAME,
    port: parseInt(process.env.DATADB_PORT) || 1433,
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

class Database {
    constructor() {
        this.pool = null;
        this.connected = false;
    }

    async connect() {
        try {
            if (!this.connected) {
                console.log('Connecting to SQL Server...');
                this.pool = await sql.connect(config);
                this.connected = true;
                console.log('Connected to SQL Server successfully');
            }
            return this.pool;
        } catch (err) {
            console.error('Database connection error:', err);
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
            
            // Add parameters to the request
            Object.keys(params).forEach(key => {
                request.input(key, params[key]);
            });

            const result = await request.query(queryString);
            return result;
        } catch (err) {
            console.error('Database query error:', err);
            throw err;
        }
    }

    async execute(procedureName, params = {}) {
        try {
            await this.connect();
            const request = this.pool.request();
            
            // Add parameters to the request
            Object.keys(params).forEach(key => {
                request.input(key, params[key]);
            });

            const result = await request.execute(procedureName);
            return result;
        } catch (err) {
            console.error('Database procedure execution error:', err);
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