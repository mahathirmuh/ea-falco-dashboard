const { randomUUID } = require('crypto');
const database = require('./database');
const sql = require('mssql');

class JobManager {
    constructor() {
        // No longer using in-memory storage
        console.log('JobManager initialized with SQL Server backend');
    }

    // Helper: parse radius from description e.g. "Processing job with 3 files (15% radius)"
    parseRadiusFromDescription(desc) {
        if (!desc || typeof desc !== 'string') return 50; // fallback
        const match = desc.match(/\((\d{1,3})%\s*radius\)/i);
        if (match && match[1]) {
            const val = parseInt(match[1], 10);
            if (!isNaN(val)) return val;
        }
        return 50; // default if not found
    }

    async createJob(type, radiusPercentage, files = [], userId = null) {
        try {
            const jobId = randomUUID();
            const createdAt = new Date();
            
            // Create a new ProcessingBatch record
            const query = `
                INSERT INTO ProcessingBatches (
                    Id, Name, Description, Status, TotalEmployees, 
                    ProcessedImages, AssignedCards, CreatedBy, CreatedAt, UpdatedAt
                ) VALUES (
                    @jobId, @name, @description, @status, @totalFiles,
                    @processedFiles, @assignedCards, @createdBy, @createdAt, @updatedAt
                )
            `;

            const params = {
                jobId: jobId,
                name: `${type} Job - ${createdAt.toISOString().split('T')[0]}`,
                description: `Processing job with ${files.length} files (${radiusPercentage}% radius)`,
                status: 'PENDING',
                totalFiles: files.length,
                processedFiles: 0,
                assignedCards: 0,
                createdBy: userId || '3D558A82-24EC-4778-82BD-6249BB79B638', // Default system user
                createdAt: createdAt,
                updatedAt: createdAt
            };

            await database.query(query, params);

            const job = {
                id: jobId,
                type: type,
                status: 'PENDING',
                createdAt: createdAt.toISOString(),
                completedAt: null,
                processedFiles: 0,
                totalFiles: files.length,
                radiusPercentage: radiusPercentage,
                errorMessage: null,
                resultData: null
            };

            console.log(`Created job ${jobId} with ${files.length} files in database`);
            return job;
        } catch (err) {
            console.error('Error creating job:', err);
            throw err;
        }
    }

    async getJob(jobId) {
        console.log('[JobManager] getJob start:', { jobId });
        try {
            const query = `
                SELECT 
                    Id as id,
                    Name,
                    Description,
                    Status as status,
                    TotalEmployees as totalFiles,
                    ProcessedImages as processedFiles,
                    AssignedCards,
                    CreatedAt as createdAt,
                    UpdatedAt as updatedAt,
                    CompletedAt as completedAt
                FROM ProcessingBatches 
                WHERE Id = @jobId
            `;

            const result = await database.query(query, { jobId });
            
            if (result.recordset.length === 0) {
                console.warn(`[JobManager] getJob: job ${jobId} not found`);
                return null;
            }

            const batch = result.recordset[0];
            const parsedRadius = this.parseRadiusFromDescription(batch.Description || batch.description);
            return {
                id: batch.id,
                type: 'ID_CARD_PROCESSING', // Default type
                status: this.mapDatabaseStatus(batch.status),
                createdAt: batch.createdAt.toISOString(),
                completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
                processedFiles: batch.processedFiles || 0,
                totalFiles: batch.totalFiles || 0,
                radiusPercentage: parsedRadius, // parsed from description
                errorMessage: null,
                resultData: null
            };
        } catch (err) {
            console.error('Error getting job:', err);
            return null;
        }
    }

    async getAllJobs() {
        console.log('[JobManager] getAllJobs start');
        try {
            const query = `
                SELECT 
                    Id as id,
                    Name,
                    Description,
                    Status as status,
                    TotalEmployees as totalFiles,
                    ProcessedImages as processedFiles,
                    AssignedCards,
                    CreatedAt as createdAt,
                    UpdatedAt as updatedAt,
                    CompletedAt as completedAt
                FROM ProcessingBatches 
                ORDER BY CreatedAt DESC
            `;

            const result = await database.query(query);
            const count = (result.recordset || []).length;
            console.log(`[JobManager] getAllJobs: fetched ${count} jobs`);
            
            return result.recordset.map(batch => ({
                id: batch.id,
                type: 'ID_CARD_PROCESSING',
                status: this.mapDatabaseStatus(batch.status),
                createdAt: batch.createdAt.toISOString(),
                completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
                processedFiles: batch.processedFiles || 0,
                totalFiles: batch.totalFiles || 0,
                radiusPercentage: this.parseRadiusFromDescription(batch.Description || batch.description),
                errorMessage: null,
                resultData: null
            }));
        } catch (err) {
            console.error('Error getting all jobs:', err);
            return [];
        }
    }

    async updateJobStatus(jobId, status, additionalData = {}) {
        try {
            const dbStatus = this.mapToDatabaseStatus(status);
            const updateFields = ['Status = @status', 'UpdatedAt = @updatedAt'];
            const params = {
                jobId: jobId,
                status: dbStatus,
                updatedAt: new Date()
            };

            // Add completion timestamp if job is completed or failed
            if (status === 'COMPLETED' || status === 'FAILED') {
                updateFields.push('CompletedAt = @completedAt');
                params.completedAt = new Date();
            }

            // Handle additional data updates
            if (additionalData.processedFiles !== undefined) {
                updateFields.push('ProcessedImages = @processedFiles');
                params.processedFiles = additionalData.processedFiles;
            }

            if (additionalData.assignedCards !== undefined) {
                updateFields.push('AssignedCards = @assignedCards');
                params.assignedCards = additionalData.assignedCards;
            }

            const query = `
                UPDATE ProcessingBatches 
                SET ${updateFields.join(', ')}
                WHERE Id = @jobId
            `;

            const result = await database.query(query, params);
            
            if (result.rowsAffected[0] > 0) {
                console.log(`Updated job ${jobId} status to ${status}`);
                return true;
            } else {
                console.error(`Job ${jobId} not found for status update`);
                return false;
            }
        } catch (err) {
            console.error('Error updating job status:', err);
            return false;
        }
    }

    async updateJobProgress(jobId, processedFiles, totalFiles = null) {
        try {
            const updateFields = ['ProcessedImages = @processedFiles', 'UpdatedAt = @updatedAt'];
            const params = {
                jobId: jobId,
                processedFiles: processedFiles,
                updatedAt: new Date()
            };

            if (totalFiles !== null) {
                updateFields.push('TotalEmployees = @totalFiles');
                params.totalFiles = totalFiles;
            }

            const query = `
                UPDATE ProcessingBatches 
                SET ${updateFields.join(', ')}
                WHERE Id = @jobId
            `;

            const result = await database.query(query, params);
            
            if (result.rowsAffected[0] > 0) {
                console.log(`Updated job ${jobId} progress: ${processedFiles}/${totalFiles || 'unchanged'}`);
                return true;
            } else {
                console.error(`Job ${jobId} not found for progress update`);
                return false;
            }
        } catch (err) {
            console.error('Error updating job progress:', err);
            return false;
        }
    }

    async deleteJob(jobId) {
        try {
            // Note: In a production system, you might want to soft delete or archive instead
            const query = `DELETE FROM ProcessingBatches WHERE Id = @jobId`;
            const result = await database.query(query, { jobId });
            
            if (result.rowsAffected[0] > 0) {
                console.log(`Deleted job ${jobId}`);
                return true;
            } else {
                console.error(`Job ${jobId} not found for deletion`);
                return false;
            }
        } catch (err) {
            console.error('Error deleting job:', err);
            return false;
        }
    }

    async cancelJob(jobId) {
        console.log('[JobManager] cancelJob start:', { jobId });
        try {
            // Check if job exists and is in a cancellable state
            const job = await this.getJob(jobId);
            if (!job) {
                console.error(`Job ${jobId} not found for cancellation`);
                return false;
            }

            // Only allow cancellation of pending or processing jobs
            if (job.status !== 'PENDING' && job.status !== 'PROCESSING') {
                console.error(`Job ${jobId} cannot be cancelled - current status: ${job.status}`);
                return false;
            }

            // Update job status to CANCELLED
            const success = await this.updateJobStatus(jobId, 'CANCELLED');
            if (success) {
                console.log(`Cancelled job ${jobId}`);
                return true;
            } else {
                console.error(`Failed to cancel job ${jobId}`);
                return false;
            }
        } catch (err) {
            console.error('Error cancelling job:', err);
            return false;
        }
    }

    async getJobsByStatus(status) {
        console.log('[JobManager] getJobsByStatus start:', { status });
        try {
            const dbStatus = this.mapToDatabaseStatus(status);
            const query = `
                SELECT 
                    Id as id,
                    Name,
                    Description,
                    Status as status,
                    TotalEmployees as totalFiles,
                    ProcessedImages as processedFiles,
                    AssignedCards,
                    CreatedAt as createdAt,
                    UpdatedAt as updatedAt,
                    CompletedAt as completedAt
                FROM ProcessingBatches 
                WHERE Status = @status
                ORDER BY CreatedAt DESC
            `;

            const result = await database.query(query, { status: dbStatus });
            const count = (result.recordset || []).length;
            console.log(`[JobManager] getJobsByStatus: ${count} jobs with status ${status}`);
            
            return result.recordset.map(batch => ({
                id: batch.id,
                type: 'ID_CARD_PROCESSING',
                status: this.mapDatabaseStatus(batch.status),
                createdAt: batch.createdAt.toISOString(),
                completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
                processedFiles: batch.processedFiles || 0,
                totalFiles: batch.totalFiles || 0,
                radiusPercentage: this.parseRadiusFromDescription(batch.Description || batch.description),
                errorMessage: null,
                resultData: null
            }));
        } catch (err) {
            console.error('Error getting jobs by status:', err);
            return [];
        }
    }

    async getJobStats() {
        try {
            const query = `
                SELECT 
                    Status,
                    COUNT(*) as count
                FROM ProcessingBatches 
                GROUP BY Status
            `;

            const result = await database.query(query);
            
            const stats = {
                total: 0,
                pending: 0,
                processing: 0,
                completed: 0,
                failed: 0,
                active: 0
            };

            result.recordset.forEach(row => {
                const status = this.mapDatabaseStatus(row.Status);
                const count = row.count;
                
                stats.total += count;
                
                switch (status) {
                    case 'PENDING':
                        stats.pending = count;
                        stats.active += count;
                        break;
                    case 'PROCESSING':
                        stats.processing = count;
                        stats.active += count;
                        break;
                    case 'COMPLETED':
                        stats.completed = count;
                        break;
                    case 'FAILED':
                        stats.failed = count;
                        break;
                }
            });

            console.log('[JobManager] getJobStats result:', stats);
            return stats;
        } catch (err) {
            console.error('Error getting job stats:', err);
            return {
                total: 0,
                pending: 0,
                processing: 0,
                completed: 0,
                failed: 0,
                active: 0
            };
        }
    }

    mapDatabaseStatus(dbStatus) {
        switch (dbStatus) {
            case 'PENDING':
                return 'PENDING';
            case 'PROCESSING':
                return 'PROCESSING';
            case 'COMPLETED':
                return 'COMPLETED';
            case 'FAILED':
                return 'FAILED';
            case 'CANCELLED':
                return 'FAILED';
            default:
                return 'PENDING';
        }
    }

    mapToDatabaseStatus(appStatus) {
        switch (appStatus) {
            case 'PENDING':
                return 'PENDING';
            case 'PROCESSING':
                return 'PROCESSING';
            case 'COMPLETED':
                return 'COMPLETED';
            case 'FAILED':
                return 'FAILED';
            case 'CANCELLED':
                return 'CANCELLED';
            default:
                return 'PENDING';
        }
    }

    async clearAllJobs() {
        try {
            const query = `DELETE FROM ProcessingBatches`;
            await database.query(query);
            console.log('Cleared all jobs from database');
            return true;
        } catch (err) {
            console.error('Error clearing all jobs:', err);
            return false;
        }
    }
}

module.exports = JobManager;