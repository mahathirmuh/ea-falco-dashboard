const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

class ImageProcessor {
    constructor() {
        this.faceApiInitialized = false;
        this.faceapi = null;
    }

    async initializeFaceAPI() {
        if (this.faceApiInitialized) return;

        try {
            // Lazy load face-api only when needed
            this.faceapi = require('@vladmandic/face-api');
            
            // For now, we'll skip face detection and just do basic image processing
            // This can be enhanced later with proper model loading
            this.faceApiInitialized = true;
            console.log('Image processor initialized (basic mode)');
        } catch (error) {
            console.warn('Face-API not available, using basic image processing:', error.message);
            this.faceApiInitialized = false;
        }
    }

    async processImagesInFolder(inputPath, outputPath, radiusPercentage = 15) {
        await this.initializeFaceAPI();
        
        const processedFiles = [];
        const supportedFormats = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff'];

        try {
            const files = await fs.readdir(inputPath);
            const imageFiles = files.filter(file => 
                supportedFormats.includes(path.extname(file).toLowerCase())
            );

            console.log(`Found ${imageFiles.length} image files to process`);

            for (const filename of imageFiles) {
                try {
                    const inputFilePath = path.join(inputPath, filename);
                    const outputFilePath = path.join(outputPath, filename);
                    
                    const result = await this.processImage(inputFilePath, outputFilePath, radiusPercentage);
                    processedFiles.push({
                        filename,
                        status: result.success ? 'success' : 'failed',
                        message: result.message,
                        facesDetected: result.facesDetected || 0
                    });
                } catch (error) {
                    console.error(`Error processing ${filename}:`, error);
                    processedFiles.push({
                        filename,
                        status: 'failed',
                        message: error.message,
                        facesDetected: 0
                    });
                }
            }

            return {
                success: true,
                processedFiles,
                totalFiles: imageFiles.length,
                successCount: processedFiles.filter(f => f.status === 'success').length
            };
        } catch (error) {
            console.error('Error processing images:', error);
            return {
                success: false,
                error: error.message,
                processedFiles: []
            };
        }
    }

    async processImage(inputPath, outputPath, radiusPercentage) {
        try {
            // Read image
            const image = sharp(inputPath);
            const metadata = await image.metadata();

            // For now, do basic image processing without face detection
            // Resize to standard ID card dimensions and optimize
            await image
                .resize(300, 400, { 
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ quality: 90 })
                .toFile(outputPath);

            return {
                success: true,
                message: 'Image processed and resized',
                facesDetected: 0 // Will be enhanced with face detection later
            };
        } catch (error) {
            console.error(`Error processing image ${inputPath}:`, error);
            return {
                success: false,
                message: error.message,
                facesDetected: 0
            };
        }
    }

    async processExcelToCSV(inputPath, outputPath) {
        try {
            const files = await fs.readdir(inputPath);
            const excelFiles = files.filter(file => 
                ['.xlsx', '.xls'].includes(path.extname(file).toLowerCase())
            );

            if (excelFiles.length === 0) {
                return {
                    success: false,
                    message: 'No Excel files found'
                };
            }

            let allData = [];

            // Process each Excel file
            for (const filename of excelFiles) {
                const filePath = path.join(inputPath, filename);
                const workbook = XLSX.readFile(filePath);
                
                // Process each sheet
                workbook.SheetNames.forEach(sheetName => {
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    // Skip empty rows and process data
                    jsonData.forEach((row, index) => {
                        if (row.length > 0 && index > 0) { // Skip header row
                            const processedRow = this.processExcelRow(row);
                            if (processedRow) {
                                allData.push(processedRow);
                            }
                        }
                    });
                });
            }

            // Write to CSV
            if (allData.length > 0) {
                const csvPath = path.join(outputPath, 'processed_data.csv');
                const csvWriter = createCsvWriter({
                    path: csvPath,
                    header: [
                        { id: 'id', title: 'ID' },
                        { id: 'name', title: 'Name' },
                        { id: 'position', title: 'Position' },
                        { id: 'department', title: 'Department' },
                        { id: 'email', title: 'Email' },
                        { id: 'phone', title: 'Phone' }
                    ]
                });

                await csvWriter.writeRecords(allData);
                
                return {
                    success: true,
                    message: `Processed ${allData.length} records to CSV`,
                    recordCount: allData.length,
                    outputFile: csvPath
                };
            } else {
                return {
                    success: false,
                    message: 'No valid data found in Excel files'
                };
            }
        } catch (error) {
            console.error('Error processing Excel files:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    processExcelRow(row) {
        // Process Excel row data similar to Python script
        // This is a basic implementation - adjust based on your Excel structure
        if (row.length < 2) return null;

        return {
            id: row[0] || '',
            name: row[1] || '',
            position: row[2] || '',
            department: row[3] || '',
            email: row[4] || '',
            phone: row[5] || ''
        };
    }

    async processIDCards(inputPath, outputPath, options = {}) {
        const { radiusPercentage = 15, processImages = true, processExcel = true } = options;
        
        try {
            // Ensure output directory exists
            await fs.mkdir(outputPath, { recursive: true });

            const results = {
                images: null,
                excel: null,
                success: true,
                message: 'Processing completed'
            };

            if (processImages) {
                console.log('Processing images...');
                results.images = await this.processImagesInFolder(inputPath, outputPath, radiusPercentage);
            }

            if (processExcel) {
                console.log('Processing Excel files...');
                results.excel = await this.processExcelToCSV(inputPath, outputPath);
            }

            return results;
        } catch (error) {
            console.error('Error in processIDCards:', error);
            return {
                success: false,
                message: error.message,
                images: null,
                excel: null
            };
        }
    }
}

module.exports = ImageProcessor;