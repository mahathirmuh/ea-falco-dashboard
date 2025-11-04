require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs-extra');
const { getProcessingResults } = require('./python_integration');
const ImageProcessor = require('./imageProcessor');
const JobManager = require('./jobManager');
const database = require('./database');
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
        // Accept images and Excel files
        const allowedTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

        const uploadedFiles = req.files.map(file => ({
            originalName: file.originalname,
            filename: file.filename,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype
        }));

        res.json({
            success: true,
            message: 'Files uploaded successfully',
            files: uploadedFiles,
            processingMode: processingMode,
            uploadPath: uploadDir
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

// Get all jobs endpoint
// Get all jobs endpoint
app.get('/api/jobs', async (req, res) => {
    try {
        const jobs = await jobManager.getAllJobs();
        const stats = await jobManager.getJobStats();
        
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

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

// Initialize database connection and start server
async function startServer() {
    try {
        // Initialize database connection
        await database.connect();
        console.log('✅ Database connected successfully');
        
        // Initialize JobManager after database connection
        jobManager = new JobManager();
        console.log('✅ JobManager initialized');
        
        // Start server
        app.listen(PORT, () => {
            console.log(`🚀 ID Card Processing Backend running on port ${PORT}`);
            console.log(`📁 Upload directory: ${uploadDir}`);
            console.log(`📁 Output directory: ${outputDir}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: ${process.env.DATADB_SERVER}:${process.env.DATADB_PORT}/${process.env.DATADB_NAME}`);
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