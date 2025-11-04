const sql = require('mssql');

// Database configuration
const config = {
    user: 'sa',
    password: 'Bl4ck3y34dmin',
    server: '10.60.10.47',
    database: 'VaultIDCardProcessor',
    port: 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function exploreProcessingBatches() {
    try {
        console.log('Connecting to SQL Server...');
        await sql.connect(config);
        console.log('Connected successfully!');

        // Get detailed information about ProcessingBatches table
        console.log('\n=== PROCESSING BATCHES TABLE DETAILS ===');
        
        const columnsResult = await sql.query(`
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION,
                NUMERIC_SCALE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'ProcessingBatches'
            ORDER BY ORDINAL_POSITION
        `);
        
        console.log('ProcessingBatches Columns:');
        columnsResult.recordset.forEach(col => {
            const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
            const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
            const precision = col.NUMERIC_PRECISION ? `(${col.NUMERIC_PRECISION}${col.NUMERIC_SCALE ? ',' + col.NUMERIC_SCALE : ''})` : '';
            const defaultVal = col.COLUMN_DEFAULT ? ` DEFAULT ${col.COLUMN_DEFAULT}` : '';
            console.log(`  ${col.COLUMN_NAME}: ${col.DATA_TYPE}${length}${precision} ${nullable}${defaultVal}`);
        });

        // Get sample data from ProcessingBatches
        console.log('\n=== PROCESSING BATCHES SAMPLE DATA ===');
        const sampleResult = await sql.query(`SELECT TOP 5 * FROM ProcessingBatches ORDER BY CreatedAt DESC`);
        
        if (sampleResult.recordset.length > 0) {
            console.log('Sample ProcessingBatches data:');
            sampleResult.recordset.forEach((row, index) => {
                console.log(`\nBatch ${index + 1}:`);
                Object.keys(row).forEach(key => {
                    console.log(`  ${key}: ${row[key]}`);
                });
            });
        } else {
            console.log('No ProcessingBatches data found');
        }

        // Check related tables (Employees, FileUploads)
        console.log('\n=== RELATED TABLES ===');
        
        // Employees table structure
        console.log('\nEmployees table columns:');
        const empColumnsResult = await sql.query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Employees'
            ORDER BY ORDINAL_POSITION
        `);
        empColumnsResult.recordset.forEach(col => {
            const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
            console.log(`  ${col.COLUMN_NAME}: ${col.DATA_TYPE} ${nullable}`);
        });

        // FileUploads table structure
        console.log('\nFileUploads table columns:');
        const fileColumnsResult = await sql.query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'FileUploads'
            ORDER BY ORDINAL_POSITION
        `);
        fileColumnsResult.recordset.forEach(col => {
            const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
            console.log(`  ${col.COLUMN_NAME}: ${col.DATA_TYPE} ${nullable}`);
        });

        // Check for foreign key relationships
        console.log('\n=== FOREIGN KEY RELATIONSHIPS ===');
        const fkResult = await sql.query(`
            SELECT 
                fk.name AS ForeignKey,
                tp.name AS ParentTable,
                cp.name AS ParentColumn,
                tr.name AS ReferencedTable,
                cr.name AS ReferencedColumn
            FROM sys.foreign_keys fk
            INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
            INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
            INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
            INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id
            INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id
            WHERE tp.name IN ('ProcessingBatches', 'Employees', 'FileUploads')
            OR tr.name IN ('ProcessingBatches', 'Employees', 'FileUploads')
        `);
        
        if (fkResult.recordset.length > 0) {
            fkResult.recordset.forEach(fk => {
                console.log(`${fk.ParentTable}.${fk.ParentColumn} -> ${fk.ReferencedTable}.${fk.ReferencedColumn}`);
            });
        } else {
            console.log('No foreign key relationships found for these tables');
        }

    } catch (err) {
        console.error('Database error:', err);
    } finally {
        await sql.close();
        console.log('\nDatabase connection closed.');
    }
}

// Run the detailed exploration
exploreProcessingBatches();