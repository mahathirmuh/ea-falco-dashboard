require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { getProcessingResults } = require('./python_integration');
const ImageProcessor = require('./imageProcessor');
const JobManager = require('./jobManager');
const database = require('./database');
const { registerJobToVault, previewJobToVault, registerCsvPathToVault, previewCsvPathToVault, updateCsvPathToVault, previewUpdateCsvPathToVault, updateCsvRowToVault, updateProfileToVault } = require('./vaultRegistrar');
const sql = require('mssql');
const { photoExists } = require('./vaultRegistrar');
const imageProcessor = new ImageProcessor();
let jobManager; // Will be initialized after database connection

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['http://localhost:5173', 'http://localhost:4173'] 
        : true,
    credentials: true
}));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../uploads');
const outputDir = path.join(__dirname, '../output');
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Keep original filename with timestamp prefix
        const timestamp = Date.now();
        cb(null, `${timestamp}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        // Accept images, Excel, and CSV files
        const allowedTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed`), false);
        }
    }
});

// Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'ID Card Processing Backend',
        version: '1.0.0'
    });
});

// File upload endpoint
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }

        const { processingMode = 'images_and_excel' } = req.body;
        
        // Validate processing mode
        if (!['images_only', 'images_and_excel'].includes(processingMode)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid processing mode. Must be "images_only" or "images_and_excel"'
            });
        }

        // Create a unique session folder for this upload so subsequent processing only handles these files
        const sessionId = crypto.randomUUID();
        const sessionUploadDir = path.join(uploadDir, sessionId);
        await fs.ensureDir(sessionUploadDir);

        // Move just the newly uploaded files into the session folder
        const uploadedFiles = [];
        for (const file of req.files) {
            const newPath = path.join(sessionUploadDir, file.filename);
            await fs.move(file.path, newPath, { overwrite: true });
            uploadedFiles.push({
                originalName: file.originalname,
                filename: file.filename,
                path: newPath,
                size: file.size,
                mimetype: file.mimetype
            });
        }

        res.json({
            success: true,
            message: 'Files uploaded successfully',
            files: uploadedFiles,
            processingMode: processingMode,
            uploadPath: sessionUploadDir,
            sessionId: sessionId
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'File upload failed',
            details: error.message
        });
    }
});

// Process ID cards endpoint
app.post('/api/process', async (req, res) => {
    try {
        const { inputPath, radiusPercentage = 15, processingMode = 'images_and_excel' } = req.body;
        
        if (!inputPath) {
            return res.status(400).json({
                success: false,
                error: 'Input path is required'
            });
        }

        // Get list of files to process
        const files = await fs.readdir(inputPath);
        const relevantFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.xlsx', '.xls'].includes(ext);
        });

        // Create job
        const job = await jobManager.createJob(processingMode, radiusPercentage, relevantFiles);
        
        // Create unique output directory for this processing session
        const sessionOutputDir = path.join(outputDir, job.id);
        
        console.log(`Starting ID card processing for job ${job.id}...`);
        console.log(`Input: ${inputPath}`);
        console.log(`Output: ${sessionOutputDir}`);
        console.log(`Mode: ${processingMode}`);
        console.log(`Radius percentage: ${radiusPercentage}`);

        // Update job status to processing
        await jobManager.updateJobStatus(job.id, 'PROCESSING', { outputPath: sessionOutputDir });

        // Determine processing options based on mode
        const options = {
            radiusPercentage: parseInt(radiusPercentage),
            processImages: processingMode === 'images_only' || processingMode === 'images_and_excel',
            processExcel: processingMode === 'images_and_excel'
        };

        // Process asynchronously to avoid blocking
        setImmediate(async () => {
            try {
                // Use Node.js image processor instead of Python script
                const result = await imageProcessor.processIDCards(inputPath, sessionOutputDir, options);
                
                // Update job with results
                if (result.success) {
                    await jobManager.updateJobStatus(job.id, 'COMPLETED', {
                        processedFiles: relevantFiles.length
                    });
                } else {
                    await jobManager.updateJobStatus(job.id, 'FAILED');
                }
            } catch (error) {
                console.error(`Job ${job.id} processing error:`, error);
                await jobManager.updateJobStatus(job.id, 'FAILED');
            }
        });

        // Return job information immediately
        res.json({
            success: true,
            message: 'Processing job started',
            jobId: job.id,
            sessionId: job.id, // For backward compatibility
            outputPath: sessionOutputDir,
            job: {
                id: job.id,
                type: job.type,
                status: job.status,
                createdAt: job.createdAt,
                totalFiles: job.totalFiles,
                radiusPercentage: job.radiusPercentage
            }
        });

    } catch (error) {
        console.error('Processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Processing failed',
            details: error.message
        });
    }
});

// Get processing results endpoint
app.get('/api/results/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const sessionOutputDir = path.join(outputDir, sessionId);
        
        const results = await getProcessingResults(sessionOutputDir);
        
        res.json({
            success: true,
            sessionId: sessionId,
            results: results
        });

    } catch (error) {
        console.error('Results retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve processing results',
            details: error.message
        });
    }
});

// Download processed file endpoint
app.get('/api/download/:sessionId/:filename', (req, res) => {
    try {
        const { sessionId, filename } = req.params;
        const filePath = path.join(outputDir, sessionId, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Download error:', err);
                res.status(500).json({
                    success: false,
                    error: 'File download failed'
                });
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: 'File download failed',
            details: error.message
        });
    }
});

// Download ZIP of job output (frontend expects /api/process/download/:id)
app.get('/api/process/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sessionOutputDir = path.join(outputDir, id);

        if (!await fs.pathExists(sessionOutputDir)) {
            return res.status(404).json({
                success: false,
                error: 'Job output not found'
            });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=job-${id}-results.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            res.status(500).end();
        });

        archive.pipe(res);
        archive.directory(sessionOutputDir, false);
        await archive.finalize();
    } catch (error) {
        console.error('ZIP download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate ZIP',
            details: error.message
        });
    }
});

// Get all jobs endpoint
// Get all jobs endpoint
app.get('/api/jobs', async (req, res) => {
    try {
        const jobs = await jobManager.getAllJobs();
        const stats = await jobManager.getJobStats();
        console.log(`[HTTP] /api/jobs -> jobs=${jobs.length} stats=${JSON.stringify(stats)}`);
        
        res.json({
            success: true,
            jobs: jobs,
            statistics: stats
        });
    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch jobs',
            details: error.message
        });
    }
});

// Get specific job by ID endpoint
app.get('/api/jobs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const job = await jobManager.getJob(id);
        
        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }
        
        res.json({
            success: true,
            job: job
        });
    } catch (error) {
        console.error('Error fetching job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch job',
            details: error.message
        });
    }
});

// Update job status endpoint
app.patch('/api/jobs/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, progress, result, error } = req.body;
        
        const job = await jobManager.getJob(id);
        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }
        
        let updateSuccess = true;
        
        if (status) {
            updateSuccess = await jobManager.updateJobStatus(id, status);
        }
        
        if (progress !== undefined) {
            updateSuccess = await jobManager.updateJobProgress(id, progress.processedFiles, progress.totalFiles);
        }
        
        if (!updateSuccess) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update job'
            });
        }
        
        const updatedJob = await jobManager.getJob(id);
        
        res.json({
            success: true,
            job: updatedJob
        });
    } catch (error) {
        console.error('Error updating job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update job',
            details: error.message
        });
    }
});

// Delete job endpoint
app.delete('/api/jobs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await jobManager.deleteJob(id);
        
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Job deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete job',
            details: error.message
        });
    }
});

// Register Vault cards for a completed job
// Body: { jobId, endpointBaseUrl? }
app.post('/api/vault/register', async (req, res) => {
    try {
        const { jobId, endpointBaseUrl, dryRun, overrides } = req.body || {};
        if (!jobId) {
            return res.status(400).json({ success: false, error: 'jobId is required' });
        }
        // Confirm job exists
        const job = await jobManager.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        const sessionOutputDir = path.join(outputDir, jobId);
        const endpoint = endpointBaseUrl || process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        if (dryRun) {
            const preview = await previewJobToVault({ jobId, outputDir: sessionOutputDir });
            return res.json({ success: true, ...preview, endpointBaseUrl: endpoint });
        }
        const result = await registerJobToVault({ jobId, outputDir: sessionOutputDir, endpointBaseUrl: endpoint, overrides });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error registering Vault cards:', error);
        res.status(500).json({ success: false, error: 'Failed to register Vault cards', details: error.message });
    }
});

// Preview Vault registration from a direct CSV path
app.post('/api/vault/preview-csv', async (req, res) => {
    try {
        const { csvPath } = req.body || {};
        if (!csvPath) {
            return res.status(400).json({ success: false, error: 'csvPath is required' });
        }
        const preview = previewCsvPathToVault({ csvPath });
        const endpoint = process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        res.json({ success: true, ...preview, endpointBaseUrl: endpoint });
    } catch (error) {
        console.error('Error previewing CSV for Vault:', error);
        res.status(500).json({ success: false, error: 'Failed to preview CSV', details: error.message });
    }
});

// Register Vault cards from a direct CSV path
app.post('/api/vault/register-csv', async (req, res) => {
    try {
        const { csvPath, endpointBaseUrl, overrides } = req.body || {};
        if (!csvPath) {
            return res.status(400).json({ success: false, error: 'csvPath is required' });
        }
        const endpoint = endpointBaseUrl || process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        const result = await registerCsvPathToVault({ csvPath, endpointBaseUrl: endpoint, overrides });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error registering Vault cards from CSV:', error);
        res.status(500).json({ success: false, error: 'Failed to register Vault cards from CSV', details: error.message });
    }
});

// Preview Vault update from a direct CSV/Excel path
app.post('/api/vault/preview-update-csv', async (req, res) => {
    try {
        const { csvPath } = req.body || {};
        if (!csvPath) {
            return res.status(400).json({ success: false, error: 'csvPath is required' });
        }
        const preview = previewUpdateCsvPathToVault({ csvPath });
        const endpoint = process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        res.json({ success: true, ...preview, endpointBaseUrl: endpoint });
    } catch (error) {
        console.error('Error previewing UpdateCard CSV:', error);
        res.status(500).json({ success: false, error: 'Failed to preview UpdateCard CSV', details: error.message });
    }
});

// Update existing Vault cards from a direct CSV/Excel path
app.post('/api/vault/update-csv', async (req, res) => {
    try {
        const { csvPath, endpointBaseUrl, overrides } = req.body || {};
        if (!csvPath) {
            return res.status(400).json({ success: false, error: 'csvPath is required' });
        }
        const endpoint = endpointBaseUrl || process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        const result = await updateCsvPathToVault({ csvPath, endpointBaseUrl: endpoint, overrides });
        const success = (Array.isArray(result.errors) ? result.errors.length : 0) === 0;
        res.json({ success, ...result });
    } catch (error) {
        console.error('Error updating Vault cards from CSV:', error);
        res.status(500).json({ success: false, error: 'Failed to update Vault cards from CSV', details: error.message });
    }
});

// Update a single row (by index) from a direct CSV/Excel path
app.post('/api/vault/update-csv-row', async (req, res) => {
    try {
        const { csvPath, index, endpointBaseUrl, override } = req.body || {};
        if (csvPath === undefined || csvPath === null || String(csvPath).trim() === '') {
            return res.status(400).json({ success: false, error: 'csvPath is required' });
        }
        if (typeof index !== 'number' || index < 0) {
            return res.status(400).json({ success: false, error: 'index must be a non-negative number' });
        }
        const endpoint = endpointBaseUrl || process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        const result = await updateCsvRowToVault({ csvPath, index, endpointBaseUrl: endpoint, override });
        const success = (Array.isArray(result.errors) ? result.errors.length : 0) === 0;
        const rowStatus = result.rowStatus || {
            ok: success,
            code: result.details && result.details[0] ? result.details[0].respCode : undefined,
            message: result.details && result.details[0] ? result.details[0].respMessage : undefined,
        };
        res.json({ success, requestId: result.requestId, rowStatus, ...result });
    } catch (error) {
        console.error('Error updating single Vault card from CSV:', error);
        res.status(500).json({ success: false, error: 'Failed to update single Vault card from CSV', details: error.message });
    }
});

// Download Excel template for UpdateCard
app.get('/api/vault/template/update-card.xlsx', async (req, res) => {
    try {
        // Define the template columns based on user-provided schema
        const headers = [
            // Identity & employment
            'CARD NO', 'NAME', 'COMPANY', 'STAFF ID', 'STATUS', 'DIVISION', 'DEPARTMENT', 'SECTION', 'TITLE', 'POSITION', 'GENDER',
            'KTP/PASPORT NO', 'PLACE OF BIRTH', 'DATE OF BIRTH', 'ADDRESS', 'PHONE NO', 'DATE OF HIRE', 'POINT OF HIRE', 'RACE',
            'DATE OF MCU', 'WORK PERIOD START', 'WORK PERIOD END', 'MCU RESULTS', 'CARD STATUS',
            // Access controls (new columns)
            'ACCESS LEVEL', 'FACE ACCESS LEVEL', 'LIFT ACCESS LEVEL', 'MESSHALL', 'VEHICLE NO'
        ];
        const wsData = [headers];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, 'UpdateCardTemplate');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="UpdateCardTemplate.xlsx"');
        return res.send(buf);
    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ success: false, error: 'Failed to generate template', details: error.message });
    }
});

// Photo existence check for preview edits
app.post('/api/vault/photo-check', async (req, res) => {
    try {
        const { jobId, rows } = req.body || {};
        if (!jobId || !Array.isArray(rows)) {
            return res.status(400).json({ success: false, error: 'jobId and rows[] are required' });
        }
        const job = await jobManager.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        const sessionOutputDir = path.join(outputDir, jobId);
        const results = rows.map(({ index, cardNo, staffNo }) => ({
            index,
            cardNo,
            hasPhoto: photoExists(sessionOutputDir, (cardNo || '').trim(), (staffNo || '').trim())
        }));
        res.json({ success: true, results });
    } catch (error) {
        console.error('Error checking photos:', error);
        res.status(500).json({ success: false, error: 'Failed to check photos', details: error.message });
    }
});

// Photo existence check for CSV preview
app.post('/api/vault/photo-check-csv', async (req, res) => {
    try {
        const { csvPath, rows } = req.body || {};
        if (!csvPath || !Array.isArray(rows)) {
            return res.status(400).json({ success: false, error: 'csvPath and rows[] are required' });
        }
        const sessionOutputDir = path.dirname(csvPath);
        const results = rows.map(({ index, cardNo, staffNo }) => ({
            index,
            cardNo,
            hasPhoto: photoExists(sessionOutputDir, (cardNo || '').trim(), (staffNo || '').trim())
        }));
        res.json({ success: true, results });
    } catch (error) {
        console.error('Error checking photos (CSV):', error);
        res.status(500).json({ success: false, error: 'Failed to check photos for CSV', details: error.message });
    }
});

// List CardDB users with optional filters for search and limit
app.get('/api/vault/carddb', async (req, res) => {
    const { q, search, limit, server: dbServer, dbName, dbUser, dbPass, dbPort } = req.query;
    const sTerm = (search || q || '').toString().trim();
    const topN = Math.max(1, Math.min(1000, parseInt((limit || '200').toString(), 10) || 200));
    try {
        // Use dedicated CARDDB_* env vars for CardDB (user retrieval) and keep DATADB_* for app DB
        const config = {
            user: (dbUser || process.env.CARDDB_USER || process.env.DATADB_USER),
            password: (dbPass || process.env.CARDDB_PASSWORD || process.env.DATADB_PASSWORD),
            server: (dbServer || process.env.CARDDB_SERVER || process.env.DATADB_SERVER),
            database: (dbName || process.env.CARDDB_NAME || process.env.DATADB_NAME || 'DataDBEnt'),
            port: (dbPort ? parseInt(dbPort, 10) : (parseInt(process.env.CARDDB_PORT, 10) || parseInt(process.env.DATADB_PORT, 10) || 1433)),
            options: { trustServerCertificate: true, enableArithAbort: true, encrypt: false },
            pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
        };
        // Log resolved connection (mask sensitive values)
        console.log(`[CardDB] Connecting server=${config.server} db=${config.database} user=${config.user} port=${config.port}`);
        await sql.connect(config);
        const request = new sql.Request();
        request.input('topN', sql.Int, topN);
        const envTbl = (() => {
            const schema = (process.env.CARDDB_SCHEMA || '').trim();
            const name = (process.env.CARDDB_TABLE || '').trim();
            if (schema && name) return `${schema}.${name}`;
            if (name) return name;
            return null;
        })();
        // Hard-code to carddb; ignore client-provided table. Allow env override for schema-qualified name.
        const baseTbl = (envTbl || 'carddb');
        const activeFilter = "([Del_State] = 0 OR [Del_State] = 'false')";
        const bracketize = (name) => name.split('.').map(part => `[${part}]`).join('.');
        const parseSchemaTable = (name) => {
            const parts = String(name).split('.');
            if (parts.length === 2) return { schema: parts[0], table: parts[1] };
            return { schema: null, table: parts[0] };
        };
        const getColumns = async (tblName) => {
            const { schema, table } = parseSchemaTable(tblName);
            const where = schema
                ? `TABLE_SCHEMA = @schema AND TABLE_NAME = @table`
                : `TABLE_NAME = @table`;
            const req = new sql.Request();
            if (schema) req.input('schema', sql.NVarChar, schema);
            req.input('table', sql.NVarChar, table);
            const rs = await req.query(`SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ${where}`);
            const cols = new Set();
            let resolvedSchema = schema;
            for (const r of (rs.recordset || [])) {
                cols.add(r.COLUMN_NAME);
                resolvedSchema = resolvedSchema || r.TABLE_SCHEMA;
            }
            return { schema: resolvedSchema, table, columns: cols };
        };
        const buildQuery = async (tblName) => {
            const info = await getColumns(tblName);
            if (!info.schema) {
                // schema not found, treat as missing table
                throw new Error(`Table not found: ${tblName}`);
            }
            const qualified = bracketize(`${info.schema}.${info.table}`);
            const hasDel = info.columns.has('Del_State');
            const searchable = ['Name','CardNo','cardno','StaffNo','staffno'].filter(c => info.columns.has(c));
            const whereTerms = [];
            if (sTerm && searchable.length > 0) {
                request.input('pattern', sql.NVarChar, `%${sTerm}%`);
                // Cast to NVARCHAR to avoid type conversion errors on numeric/date columns
                const likeParts = searchable.map(c => `CAST([${c}] AS NVARCHAR(4000)) LIKE @pattern`);
                whereTerms.push(`(${likeParts.join(' OR ')})`);
            }
            if (hasDel) whereTerms.push(activeFilter);
            const where = whereTerms.length > 0 ? `WHERE ${whereTerms.join(' AND ')}` : '';
            return `SELECT TOP (@topN) * FROM ${qualified} ${where}`;
        };

        let result;
        try {
            const query = await buildQuery(baseTbl);
            result = await request.query(query);
        } catch (primaryErr) {
            // Fallback attempts: common casing or dbo-qualified table name
            const tryQuery = async (tblName) => {
                const altQuery = await buildQuery(tblName);
                return request.query(altQuery);
            };
            const candidatesRaw = [baseTbl, envTbl, 'carddb', 'CardDB', 'dbo.carddb', 'dbo.CardDB'];
            const candidates = Array.from(new Set(candidatesRaw.filter(Boolean)));
            console.log(`[CardDB] Fallback candidates: ${candidates.join(', ')}`);
            let ok = false;
            for (const c of candidates) {
                try {
                    result = await tryQuery(c);
                    console.log(`[CardDB] Fallback succeeded with table=${c}`);
                    ok = true;
                    break;
                } catch (e) {
                    // continue
                }
            }
            if (!ok) {
                // Discover likely tables by columns or name
                try {
                    const discover = await request.query(`
                        SELECT DISTINCT TOP 30 t.TABLE_SCHEMA, t.TABLE_NAME
                        FROM INFORMATION_SCHEMA.TABLES t
                        WHERE t.TABLE_TYPE = 'BASE TABLE'
                        AND (
                            t.TABLE_NAME LIKE '%card%' OR t.TABLE_NAME LIKE '%Card%'
                            OR EXISTS (
                                SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS c
                                WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                                AND c.COLUMN_NAME IN ('CardNo','cardno','StaffNo','staffno','Name','NAME')
                            )
                        )
                    `);
                    const list = (discover.recordset || []).map(r => `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`);
                    console.log(`[CardDB] Discovery candidates: ${list.join(', ')}`);
                    for (const dn of list) {
                        try {
                            result = await tryQuery(dn);
                            console.log(`[CardDB] Discovery succeeded with table=${dn}`);
                            ok = true;
                            break;
                        } catch (e) {
                            // continue
                        }
                    }
                } catch (discErr) {
                    // ignore discovery errors
                }
            }
            if (!ok || !result) {
                // Throw the last error for clarity, not the initial carddb error
                throw new Error(primaryErr && primaryErr.message ? primaryErr.message : 'CardDB query failed');
            }
        }
        const rows = result && result.recordset ? result.recordset : [];
        res.json({ success: true, count: rows.length, rows });
    } catch (error) {
        console.error('Error fetching CardDB list:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch CardDB list', details: error.message });
    } finally {
        try { await sql.close(); } catch {}
    }
});

// Update a single card directly from database (DataDBEnt) using card number
// Body: { cardNo, endpointBaseUrl?, dbServer?, dbName?, dbUser?, dbPass?, dbPort?, overrides? }
app.post('/api/vault/update-card-db', async (req, res) => {
    try {
        const { cardNo, endpointBaseUrl, dbServer, dbName, dbUser, dbPass, dbPort, overrides } = req.body || {};
        const cn = String(cardNo || '').trim();
        if (!cn) {
            return res.status(400).json({ success: false, error: 'cardNo is required' });
        }
        // Resolve DB connection config using CARDDB_* (user retrieval) env group
        const config = {
            user: dbUser || process.env.CARDDB_USER || process.env.DATADB_USER,
            password: dbPass || process.env.CARDDB_PASSWORD || process.env.DATADB_PASSWORD,
            server: dbServer || process.env.CARDDB_SERVER || process.env.DATADB_SERVER,
            database: dbName || process.env.CARDDB_NAME || process.env.DATADB_NAME || 'DataDBEnt',
            port: (dbPort ? parseInt(dbPort) : (parseInt(process.env.CARDDB_PORT) || parseInt(process.env.DATADB_PORT) || 1433)),
            options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
            pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
        };

        // Connect and fetch card row
        await sql.connect(config);
        const request = new sql.Request();
        request.input('cardNo', sql.NVarChar(20), cn);
        // Try common table and column casings with schema-aware quoting
        const activeFilter = "([Del_State] = 0 OR [Del_State] = 'false')";
        const bracketize = (name) => name.split('.').map(part => `[${part}]`).join('.');
        const parseSchemaTable = (name) => {
            const parts = String(name).split('.');
            if (parts.length === 2) return { schema: parts[0], table: parts[1] };
            return { schema: null, table: parts[0] };
        };
        const getColumns = async (tblName) => {
            const { schema, table } = parseSchemaTable(tblName);
            const where = schema
                ? `TABLE_SCHEMA = @schema AND TABLE_NAME = @table`
                : `TABLE_NAME = @table`;
            const req = new sql.Request();
            if (schema) req.input('schema', sql.NVarChar, schema);
            req.input('table', sql.NVarChar, table);
            const rs = await req.query(`SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ${where}`);
            const cols = new Set();
            let resolvedSchema = schema;
            for (const r of (rs.recordset || [])) {
                cols.add(r.COLUMN_NAME);
                resolvedSchema = resolvedSchema || r.TABLE_SCHEMA;
            }
            return { schema: resolvedSchema, table, columns: cols };
        };
        const envTbl = (() => {
            const schema = (process.env.CARDDB_SCHEMA || '').trim();
            const name = (process.env.CARDDB_TABLE || '').trim();
            if (schema && name) return `${schema}.${name}`;
            if (name) return name;
            return null;
        })();
        const candidates = Array.from(new Set([envTbl, 'carddb', 'CardDB', 'dbo.carddb', 'dbo.CardDB'].filter(Boolean)));
        console.log(`[CardDB] update-card-db candidates: ${candidates.join(', ')}`);
        let result;
        for (const tbl of candidates) {
            try {
                const info = await getColumns(tbl);
                if (!info.schema) continue; // table not found
                const qualified = bracketize(`${info.schema}.${info.table}`);
                const hasCardNoLower = info.columns.has('cardno');
                const hasCardNo = info.columns.has('CardNo');
                const hasDel = info.columns.has('Del_State');
                if (!hasCardNoLower && !hasCardNo) continue; // no matching card number column
                const cardPred = [hasCardNoLower ? '[cardno] = @cardNo' : null, hasCardNo ? '[CardNo] = @cardNo' : null].filter(Boolean).join(' OR ');
                const whereParts = [ `(${cardPred})` ];
                if (hasDel) whereParts.push(activeFilter);
                const q = `SELECT TOP 1 * FROM ${qualified} WHERE ${whereParts.join(' AND ')}`;
                result = await request.query(q);
                if (result.recordset && result.recordset.length > 0) break;
            } catch (e) {
                // keep trying other candidates
            }
        }
        if (!result.recordset || result.recordset.length === 0) {
            return res.status(404).json({ success: false, error: `Card not found in carddb: ${cn}` });
        }
        const row = result.recordset[0] || {};

        // Build profile with clipping similar to script
        const max = { Name: 40, Department: 30, Company: 30, Title: 25, Position: 25, Address1: 50, Address2: 50, Email: 50, MobileNo: 20, VehicleNo: 20, StaffNo: 15 };
        const clip = (v, m) => { if (v === undefined || v === null) return ''; const s = String(v).trim(); return s.length > m ? s.slice(0, m) : s; };
        const normalizeExcelDate = (val) => {
            if (val === null || typeof val === 'undefined') return '';
            const s = String(val).trim();
            if (!s) return '';
            if (/^\d+(\.\d+)?$/.test(s)) {
                const serial = parseFloat(s);
                const ms = (serial - 25569) * 86400 * 1000;
                const d = new Date(ms);
                if (!isNaN(d.getTime())) {
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const day = d.getUTCDate();
                    const mon = months[d.getUTCMonth()];
                    const year = d.getUTCFullYear();
                    return `${day} ${mon} ${year}`;
                }
            }
            return s;
        };
        const profile = {
            CardNo: String(row.CardNo || row.cardno || row.CARDNO || cn).trim(),
            Name: clip(row.Name || row.NAME, max.Name),
            Department: clip(row.Department || row.DEPT || row.DepartmentName, max.Department),
            Company: clip(row.Company || row.COMPANY, max.Company),
            Title: clip(row.Title || row.TITLE, max.Title),
            Position: clip(row.Position || row.POSITION, max.Position),
            Gentle: String(row.Gentle || row.Gender || row.SEX || '').trim(),
            NRIC: String(row.NRIC || row.IdNo || '').trim(),
            Passport: String(row.Passport || '').trim(),
            Race: String(row.Race || '').trim(),
            DOB: normalizeExcelDate(row.DOB || row.BirthDate || ''),
            JoiningDate: normalizeExcelDate(row.JoiningDate || row.JoinDate || ''),
            ResignDate: normalizeExcelDate(row.ResignDate || row.ExitDate || ''),
            Address1: clip(row.Address1 || row.Address || '', max.Address1),
            Address2: clip(row.Address2 || '', max.Address2),
            Email: clip(row.Email || '', max.Email),
            MobileNo: clip(row.MobileNo || row.Phone || row.Contact || '', max.MobileNo),
            ActiveStatus: 'true',
            NonExpired: 'true',
            ExpiredDate: String(row.ExpiredDate || '').trim(),
            AccessLevel: String(row.AccessLevel || row.MESSHALL || row.Access || '00').trim(),
            FaceAccessLevel: String(row.FaceAccessLevel || '00').trim(),
            LiftAccessLevel: String(row.LiftAccessLevel || '00').trim(),
            VehicleNo: clip(row.VehicleNo || row.Vehicle || row.Remark || '', max.VehicleNo),
            Download: 'true',
            Photo: null,
            StaffNo: clip(row.StaffNo || row.StaffID || '', max.StaffNo),
        };

        // Apply overrides if provided
        const ov = overrides || {};
        const apply = (k, v) => { if (v !== undefined && v !== null && v !== '') profile[k] = String(v).trim(); };
        apply('AccessLevel', ov.accessLevel ?? ov.AccessLevel);
        apply('FaceAccessLevel', ov.faceLevel ?? ov.FaceAccessLevel);
        apply('LiftAccessLevel', ov.liftLevel ?? ov.LiftAccessLevel);
        apply('Department', ov.department ?? ov.Department);
        apply('Title', ov.title ?? ov.Title);
        apply('Position', ov.position ?? ov.Position);
        apply('Gentle', ov.gender ?? ov.Gender);
        apply('Passport', ov.passport ?? ov.Passport);
        apply('NRIC', ov.nric ?? ov.NRIC);
        apply('DOB', ov.dob ?? ov.DOB);
        apply('Address1', ov.address ?? ov.Address1);
        apply('Address2', ov.address2 ?? ov.Address2);
        apply('MobileNo', ov.phone ?? ov.MobileNo);
        apply('JoiningDate', ov.joinDate ?? ov.JoiningDate);
        apply('Race', ov.race ?? ov.Race);
        apply('VehicleNo', ov.vehicle ?? ov.VehicleNo);
        apply('ActiveStatus', (() => {
            const val = ov.active ?? ov.ActiveStatus ?? ov.cardStatus;
            if (val === undefined || val === null || val === '') return undefined;
            const s = String(val).trim().toLowerCase();
            if (s === 'true' || s === 'yes' || s === '1') return 'true';
            if (s === 'false' || s === 'no' || s === '0') return 'false';
            return String(val).trim();
        })());
        if (ov.messhall) {
            profile.VehicleNo = clip(ov.messhall, max.VehicleNo);
        }
        // Map messhall/vehicle values to standardized strings and clip safely
        if (profile.VehicleNo) {
            const v = String(profile.VehicleNo).toLowerCase();
            if (v.includes('makarti')) profile.VehicleNo = 'Makarti';
            else if (v.includes('labota')) profile.VehicleNo = 'Labota';
            else if (v.includes('local') || v.includes('no access')) profile.VehicleNo = 'NoAccess';
            profile.VehicleNo = String(profile.VehicleNo).slice(0, 15);
        }

        const endpoint = endpointBaseUrl || process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';
        const resp = await updateProfileToVault({ profile, endpointBaseUrl: endpoint, outputDir });
        const success = !!resp.ok;
        res.json({ success, code: resp.code, message: resp.message, requestId: resp.requestId, profile });
    } catch (error) {
        console.error('Error updating Vault card from DB:', error);
        res.status(500).json({ success: false, error: 'Failed to update Vault card from DB', details: error.message });
    } finally {
        try { await sql.close(); } catch {}
    }
});

// Retrieve registration logs for a job
app.get('/api/vault/logs/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });
        const sessionOutputDir = path.join(outputDir, jobId);
        if (!await fs.pathExists(sessionOutputDir)) {
            return res.status(404).json({ success: false, error: 'Job output not found' });
        }
        const textPath = path.join(sessionOutputDir, 'vault-registration.log');
        const jsonlPath = path.join(sessionOutputDir, 'vault-registration-log.jsonl');
        const textLog = (await fs.pathExists(textPath)) ? await fs.readFile(textPath, 'utf8') : '';
        const jsonlRaw = (await fs.pathExists(jsonlPath)) ? await fs.readFile(jsonlPath, 'utf8') : '';
        const jsonLog = [];
        for (const line of jsonlRaw.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try { jsonLog.push(JSON.parse(line)); } catch {}
        }
        res.json({ success: true, jobId, textLog, jsonLog });
    } catch (error) {
        console.error('Error retrieving logs:', error);
        res.status(500).json({ success: false, error: 'Failed to retrieve logs', details: error.message });
    }
});

// Cancel job endpoint
app.post('/api/process/cancel/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cancelled = await jobManager.cancelJob(id);
        
        if (!cancelled) {
            return res.status(404).json({
                success: false,
                error: 'Job not found or cannot be cancelled'
            });
        }
        
        res.json({
            success: true,
            message: 'Job cancelled successfully'
        });
    } catch (error) {
        console.error('Error cancelling job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cancel job',
            details: error.message
        });
    }
});

// List all processing sessions endpoint
app.get('/api/sessions', async (req, res) => {
    try {
        const sessions = [];
        
        if (await fs.pathExists(outputDir)) {
            const sessionDirs = await fs.readdir(outputDir);
            
            for (const sessionId of sessionDirs) {
                const sessionPath = path.join(outputDir, sessionId);
                const stats = await fs.stat(sessionPath);
                
                if (stats.isDirectory()) {
                    const results = await getProcessingResults(sessionPath);
                    sessions.push({
                        sessionId: sessionId,
                        created: stats.birthtime,
                        modified: stats.mtime,
                        fileCount: results.totalFiles || 0
                    });
                }
            }
        }
        
        // Sort by creation date (newest first)
        sessions.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({
            success: true,
            sessions: sessions
        });

    } catch (error) {
        console.error('Sessions retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve sessions',
            details: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 50MB.'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files. Maximum is 10 files.'
            });
        }
    }
    
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// 404 handler moved below download route
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

// Start server immediately, then attempt database connection asynchronously
async function startServer() {
    try {
        // Start server first so endpoints that don't require DB (e.g., template download) work
        app.listen(PORT, () => {
            console.log(`🚀 ID Card Processing Backend running on port ${PORT}`);
            console.log(`📁 Upload directory: ${uploadDir}`);
            console.log(`📁 Output directory: ${outputDir}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
            console.log(`💾 AppDB: ${process.env.APPDB_SERVER || '(unset)'}:${process.env.APPDB_PORT || '1433'}/${process.env.APPDB_NAME || '(unset)'}`);
            console.log(`💾 Vault DB (DATADB): ${process.env.DATADB_SERVER || '(unset)'}:${process.env.DATADB_PORT || '1433'}/${process.env.DATADB_NAME || '(unset)'}`);
        });

        // Attempt database connection without blocking server startup
        database.connect()
            .then(() => {
                console.log('✅ Database connected successfully');
                // Initialize JobManager after database connection
                jobManager = new JobManager();
                console.log('✅ JobManager initialized');
                // Quick sanity check: count ProcessingBatches
                database.query('SELECT COUNT(*) AS cnt FROM ProcessingBatches')
                    .then(r => {
                        const cnt = r?.recordset?.[0]?.cnt ?? 0;
                        console.log(`[AppDB] ProcessingBatches row count: ${cnt}`);
                    })
                    .catch(err => {
                        console.error('[AppDB] ProcessingBatches count failed:', err?.message || err);
                    });
            })
            .catch((error) => {
                console.error('⚠️ Database connection failed. Features that require DB will be unavailable until it connects:', error.message || error);
            });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await database.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    await database.disconnect();
    process.exit(0);
});

// Download ZIP of job output (frontend expects /api/process/download/:id)
app.get('/api/process/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sessionOutputDir = path.join(outputDir, id);

        if (!await fs.pathExists(sessionOutputDir)) {
            return res.status(404).json({
                success: false,
                error: 'Job output not found'
            });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=job-${id}-results.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            res.status(500).end();
        });

        archive.pipe(res);
        archive.directory(sessionOutputDir, false);
        await archive.finalize();
    } catch (error) {
        console.error('ZIP download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate ZIP',
            details: error.message
        });
    }
});