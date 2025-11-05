const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

class ImageProcessor {
    constructor() {
        this.faceApiInitialized = false;
        this.faceapi = null;
        this.faceSupport = { available: false, modelDir: null };
    }

    async initializeFaceAPI() {
        if (this.faceApiInitialized) return;

        try {
            // Lazy load face-api only when needed
            this.faceapi = require('@vladmandic/face-api');
            // Try to monkey-patch canvas for Node
            try {
                const canvas = require('canvas');
                const { Canvas, Image, ImageData } = canvas;
                this.faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
            } catch (err) {
                console.warn('Canvas not available, face detection may not work:', err.message);
            }

            // Load tiny face detector model from server/models if present
            const modelsCandidate = path.join(__dirname, '..', 'models');
            try {
                const stat = await fs.stat(modelsCandidate);
                if (stat.isDirectory()) {
                    await this.faceapi.nets.tinyFaceDetector.loadFromDisk(modelsCandidate);
                    this.faceSupport = { available: true, modelDir: modelsCandidate };
                    console.log(`Face-API models loaded from ${modelsCandidate}`);
                }
            } catch (e) {
                console.warn('Face-API model directory not found. Using heuristic cropping.');
                this.faceSupport = { available: false, modelDir: null };
            }

            this.faceApiInitialized = true;
            console.log('Image processor initialized');
        } catch (error) {
            console.warn('Face-API not available, using heuristic cropping:', error.message);
            this.faceApiInitialized = false;
            this.faceSupport = { available: false, modelDir: null };
        }
    }

    // Helper: derive employee id from filename
    // Rules:
    // - Remove leading timestamp if present (10-14 digits followed by -/_)
    // - Prefer pattern MTI#######
    // - Else, if name contains " - ", take the left side
    // - Else, prefer pure numeric token with length>=5
    // - Else, first token
    deriveEmployeeId(filename) {
        const baseOrig = path.parse(filename).name;
        const base = baseOrig.replace(/^\d{10,14}[-_]?/, '');
        // Prefer "<id> - <name>"
        const parts = base.split(' - ');
        if (parts.length === 2 && parts[0]) return parts[0].trim();
        const tokens = base.split(/[\s_\-]+/).filter(Boolean);
        const mti = tokens.find(t => /^MTI\d{3,}$/.test(t));
        if (mti) return mti;
        const numeric = tokens.find(t => /^\d{5,}$/.test(t));
        if (numeric) return numeric;
        return tokens[0] || base;
    }

    async processImagesInFolder(inputPath, outputPath, faceAreaPercentage = 50) {
        await this.initializeFaceAPI();
        const processedFiles = [];
        const supportedFormats = ['.jpg', '.jpeg', '.png'];

        try {
            const files = await fs.readdir(inputPath);
            const imageFiles = files.filter(file => supportedFormats.includes(path.extname(file).toLowerCase()));

            console.log(`Found ${imageFiles.length} image files to process`);

            for (const filename of imageFiles) {
                try {
                    const inputFilePath = path.join(inputPath, filename);
                    const employeeId = this.deriveEmployeeId(filename);
                    const outputFilePath = path.join(outputPath, `${employeeId}.jpg`);

                    const result = await this.cropAndResizeImage(inputFilePath, outputFilePath, faceAreaPercentage);
                    processedFiles.push({ filename, output: path.basename(outputFilePath), status: result.success ? 'success' : 'failed', message: result.message });
                } catch (error) {
                    console.error(`Error processing ${filename}:`, error);
                    processedFiles.push({ filename, status: 'failed', message: error.message });
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
            return { success: false, error: error.message, processedFiles: [] };
        }
    }

    // Cropping logic with face detection: faceAreaPercentage means the face box occupies that % of final 400x400
    async cropAndResizeImage(inputPath, outputPath, faceAreaPercentage) {
        try {
            const img = sharp(inputPath);
            const meta = await img.metadata();
            const W = meta.width || 0;
            const H = meta.height || 0;
            if (!W || !H) throw new Error('Unable to read image metadata');

            const desiredRatio = Math.min(Math.max(faceAreaPercentage, 10), 90) / 100; // clamp 10%-90%

            let cropX, cropY, cropSide;

            if (this.faceSupport.available) {
                try {
                    // Prepare tensor for face-api
                    const buffer = await sharp(inputPath).toBuffer();
                    const { createCanvas, Image } = require('canvas');
                    const canvas = createCanvas(W, H);
                    const ctx = canvas.getContext('2d');
                    const image = new Image();
                    image.src = buffer;
                    ctx.drawImage(image, 0, 0);

                    const options = new this.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 });
                    const detection = await this.faceapi.detectSingleFace(canvas, options);
                    if (detection && detection.box) {
                        const box = detection.box;
                        const faceW = box.width;
                        const faceH = box.height;
                        const faceArea = faceW * faceH;
                        // cropSide such that after resize to 400, face occupies desiredRatio of area
                        cropSide = Math.ceil(Math.sqrt(faceArea / desiredRatio));
                        cropSide = Math.max(cropSide, Math.max(faceW, faceH));
                        cropSide = Math.min(cropSide, Math.min(W, H));

                        const cx = box.x + faceW / 2;
                        const cy = box.y + faceH / 2;
                        cropX = Math.round(cx - cropSide / 2);
                        cropY = Math.round(cy - cropSide / 2);
                        // Clamp
                        cropX = Math.max(0, Math.min(cropX, W - cropSide));
                        cropY = Math.max(0, Math.min(cropY, H - cropSide));
                    } else {
                        // No detection found; fall back to heuristic by leaving cropX undefined
                    }
                } catch (e) {
                    console.warn('Face detection error; falling back to heuristic:', e.message);
                    // Leave cropX undefined to trigger heuristic fallback below
                }
            }

            if (cropX === undefined) {
                // Heuristic centered crop that respects desiredRatio (acts as zoom level)
                // Larger desiredRatio => smaller cropSide => face appears larger after resize
                const baseSide = Math.min(W, H);
                const scale = Math.min(Math.max(1.0 - desiredRatio * 0.5, 0.35), 0.95); // clamp to avoid too small/large crops
                cropSide = Math.floor(baseSide * scale);
                cropSide = Math.max(cropSide, 1);

                const cx = Math.floor(W / 2);
                const cy = Math.floor(H / 2);
                cropX = Math.max(0, Math.min(cx - Math.floor(cropSide / 2), W - cropSide));
                cropY = Math.max(0, Math.min(cy - Math.floor(cropSide / 2), H - cropSide));
            }

            const bufferOut = await sharp(inputPath)
                .extract({ left: cropX, top: cropY, width: cropSide, height: cropSide })
                .resize(400, 400)
                .jpeg({ quality: 90 })
                .toBuffer();
            await sharp(bufferOut).toFile(outputPath);

            return { success: true, message: this.faceSupport.available ? `Cropped with face detection target ${(desiredRatio * 100).toFixed(0)}% face area` : `Cropped using heuristic (target ${(desiredRatio * 100).toFixed(0)}% face area) and resized to 400x400` };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // Combine Excel files following Python logic
    async combineExcelFilesInFolder(inputFolder, expectedColumns, outputExcelFile) {
        try {
            const files = await fs.readdir(inputFolder);
            const excelFiles = files.filter(f => ['.xls', '.xlsx'].includes(path.extname(f).toLowerCase()));
            const combinedRows = [];

            for (const filename of excelFiles) {
                const filePath = path.join(inputFolder, filename);
                const workbook = XLSX.readFile(filePath);
                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
                    if (rows.length === 0) continue;
                    const hasAll = expectedColumns.every(col => Object.prototype.hasOwnProperty.call(rows[0], col));
                    if (!hasAll) {
                        console.log(`Skipping file '${filename}' because columns do not match expected format.`);
                        continue;
                    }
                    combinedRows.push(...rows);
                }
            }

            const outWb = XLSX.utils.book_new();
            const outSheet = XLSX.utils.json_to_sheet(combinedRows);
            XLSX.utils.book_append_sheet(outWb, outSheet, 'Combined');
            XLSX.writeFile(outWb, outputExcelFile);

            return { success: true, count: combinedRows.length, outputExcelFile };
        } catch (error) {
            console.error('Error combining Excel files:', error);
            return { success: false, message: error.message };
        }
    }

    // Convert combined Excel to the specific CSV schema
    async processExcelToCSVFromCombined(inputExcelFile, outputCsvFile) {
        try {
            const workbook = XLSX.readFile(inputExcelFile);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

            const csvPath = outputCsvFile;
            const csvWriter = createCsvWriter({
                path: csvPath,
                header: [
                    { id: 'CardNo', title: 'Card No #[Max 10]' },
                    { id: 'CardName', title: 'Card Name [Max 50]' },
                    { id: 'StaffNo', title: 'Staff No [Max 15]' },
                    { id: 'Department', title: 'Department [Max 50]' },
                    { id: 'AccessLevel', title: 'Access Level [Max 3]' },
                    { id: 'Company', title: 'Company [Max 50]' },
                    { id: 'NRICPass', title: 'NRIC/Pass [Max 50]' },
                    { id: 'Remark', title: 'Remark  [Max 100]' },
                    { id: 'Email', title: 'Email [Max 50]' },
                    { id: 'Status', title: 'Status [True/False]' },
                    { id: 'LiftAccessLevel', title: 'Lift Access Level [Max 3]' },
                    { id: 'VehicleNo', title: 'Vehicle No [Max 15]' },
                    { id: 'ExpiryDate', title: 'ExpiryDate dd/MM/yyyy HH:mm:ss  [Blank for non expired card]' },
                    { id: 'Address', title: 'Address [Max 50]' },
                    { id: 'UnitNo', title: 'Unit No [Max 15]' },
                    { id: 'EmergencyCard', title: 'Emergency Card [True/False]' },
                    { id: 'FaceAccessLevel', title: 'Face Access Level [Max 3]' },
                ]
            });

            const toLower = (s) => (typeof s === 'string' ? s.toLowerCase() : '');

            const records = rows.map(row => {
                const mess = toLower(row['MessHall']);
                const accessLevel = mess.includes('senior') ? 4 : mess.includes('junior') ? 2 : 13;
                const vehicleNo = mess.includes('senior') ? 'Senior Messhall' : mess.includes('junior') ? 'Junior Messhall' : 'No Access!!';
                return {
                    CardNo: '',
                    CardName: row['Name'] || '',
                    StaffNo: row['Emp. No'] || '',
                    Department: row['Department'] || '',
                    AccessLevel: accessLevel,
                    Company: 'Merdeka Tsingsan Indonesia',
                    NRICPass: '',
                    Remark: '',
                    Email: '',
                    Status: 'TRUE',
                    LiftAccessLevel: '',
                    VehicleNo: vehicleNo,
                    ExpiryDate: '',
                    Address: '',
                    UnitNo: '',
                    EmergencyCard: '',
                    FaceAccessLevel: ''
                };
            });

            await csvWriter.writeRecords(records);
            return { success: true, count: records.length, outputCsvFile: csvPath };
        } catch (error) {
            console.error('Error converting Excel to CSV:', error);
            return { success: false, message: error.message };
        }
    }

    async processIDCards(inputPath, outputPath, options = {}) {
        const { radiusPercentage = 50, processImages = true, processExcel = true } = options; // interpret radiusPercentage as faceAreaPercentage
        try {
            await fs.mkdir(outputPath, { recursive: true });

            const results = { images: null, excel: null, success: true, message: 'Processing completed' };

            if (processImages) {
                results.images = await this.processImagesInFolder(inputPath, outputPath, radiusPercentage);
            }

            if (processExcel) {
                const date = new Date();
                const dd = String(date.getDate()).padStart(2, '0');
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const yyyy = date.getFullYear();
                const formatted = `${dd}-${mm}-${yyyy}`;
                const expectedColumns = ['Emp. No', 'Name', 'Department', 'Section', 'Job Title', 'MessHall'];

                const outputExcelFile = path.join(outputPath, `For_Machine_${formatted}.xlsx`);
                const outputCsvFile = path.join(outputPath, `CardDatafileformat_${formatted}.csv`);

                const combined = await this.combineExcelFilesInFolder(inputPath, expectedColumns, outputExcelFile);
                if (combined.success) {
                    results.excel = await this.processExcelToCSVFromCombined(outputExcelFile, outputCsvFile);
                } else {
                    results.excel = combined;
                }
            }

            return results;
        } catch (error) {
            console.error('Error in processIDCards:', error);
            return { success: false, message: error.message, images: null, excel: null };
        }
    }
}

module.exports = ImageProcessor;