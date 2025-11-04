const sql = require('mssql');

// Database configuration
const config = {
    user: 'sa',
    password: 'Bl4ck3y34dmin',
    server: '10.60.10.47',
    database: 'VaultIDCardProcessor',
    port: 1433,
    options: {
        encrypt: false, // Use this if you're on Azure
        trustServerCertificate: true // Use this if you're using self-signed certificates
    }
};

async function exploreDatabase() {
    try {
        console.log('Connecting to SQL Server...');
        await sql.connect(config);
        console.log('Connected successfully!');

        // Get all tables in the database
        console.log('\n=== DATABASE TABLES ===');
        const tablesResult = await sql.query(`
            SELECT TABLE_NAME, TABLE_TYPE 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `);
        
        console.log('Tables found:');
        tablesResult.recordset.forEach(table => {
            console.log(`- ${table.TABLE_NAME}`);
        });

        // For each table, get its structure
        for (const table of tablesResult.recordset) {
            console.log(`\n=== TABLE: ${table.TABLE_NAME} ===`);
            
            // Get column information
            const columnsResult = await sql.query(`
                SELECT 
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    COLUMN_DEFAULT,
                    CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = '${table.TABLE_NAME}'
                ORDER BY ORDINAL_POSITION
            `);
            
            console.log('Columns:');
            columnsResult.recordset.forEach(col => {
                const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
                const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
                const defaultVal = col.COLUMN_DEFAULT ? ` DEFAULT ${col.COLUMN_DEFAULT}` : '';
                console.log(`  ${col.COLUMN_NAME}: ${col.DATA_TYPE}${length} ${nullable}${defaultVal}`);
            });

            // Get sample data (first 3 rows)
            try {
                const sampleResult = await sql.query(`SELECT TOP 3 * FROM [${table.TABLE_NAME}]`);
                if (sampleResult.recordset.length > 0) {
                    console.log('Sample data:');
                    sampleResult.recordset.forEach((row, index) => {
                        console.log(`  Row ${index + 1}:`, JSON.stringify(row, null, 2));
                    });
                } else {
                    console.log('  No data found');
                }
            } catch (err) {
                console.log('  Error reading sample data:', err.message);
            }
        }

        // Check for any existing job-related tables
        console.log('\n=== SEARCHING FOR JOB-RELATED TABLES ===');
        const jobTablesResult = await sql.query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            AND (TABLE_NAME LIKE '%job%' OR TABLE_NAME LIKE '%process%' OR TABLE_NAME LIKE '%task%')
            ORDER BY TABLE_NAME
        `);
        
        if (jobTablesResult.recordset.length > 0) {
            console.log('Job-related tables found:');
            jobTablesResult.recordset.forEach(table => {
                console.log(`- ${table.TABLE_NAME}`);
            });
        } else {
            console.log('No job-related tables found');
        }

    } catch (err) {
        console.error('Database connection error:', err);
    } finally {
        await sql.close();
        console.log('\nDatabase connection closed.');
    }
}

// Run the exploration
exploreDatabase();