const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

/**
 * Execute the Python ID card processing script
 * @param {string} scriptPath - Path to the Python script
 * @param {string} inputPath - Path to input file/folder
 * @param {string} outputPath - Path to output folder
 * @param {string} mode - Processing mode ('images_only' or 'images_and_excel')
 * @returns {Promise<{success: boolean, output: string, error?: string}>}
 */
async function executePythonScript(scriptPath, inputPath, outputPath, mode = 'images_only') {
    return new Promise((resolve) => {
        // Ensure output directory exists
        fs.ensureDirSync(outputPath);
        
        // Prepare arguments for the Python script
        const args = [scriptPath, inputPath, outputPath];
        
        // Add mode-specific arguments if needed
        if (mode === 'images_and_excel') {
            args.push('--excel');
        }
        
        console.log(`Executing Python script: python ${args.join(' ')}`);
        
        // Spawn the Python process
        const pythonProcess = spawn('python', args, {
            cwd: path.dirname(scriptPath),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log(`Python stdout: ${data}`);
        });
        
        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error(`Python stderr: ${data}`);
        });
        
        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code: ${code}`);
            
            if (code === 0) {
                resolve({
                    success: true,
                    output: stdout,
                    exitCode: code
                });
            } else {
                resolve({
                    success: false,
                    output: stdout,
                    error: stderr || `Process exited with code ${code}`,
                    exitCode: code
                });
            }
        });
        
        pythonProcess.on('error', (error) => {
            console.error(`Failed to start Python process: ${error.message}`);
            resolve({
                success: false,
                output: '',
                error: `Failed to start Python process: ${error.message}`,
                exitCode: -1
            });
        });
    });
}

/**
 * Process ID card images using the existing Python script
 * @param {string} inputPath - Path to input images or folder
 * @param {string} outputPath - Path to output folder
 * @param {string} mode - Processing mode
 * @returns {Promise<Object>}
 */
async function processIDCards(inputPath, outputPath, mode = 'images_only') {
    // Path to the user's existing Python script
    const pythonScriptPath = path.resolve('c:/Scripts/Projects/data-interpret-kit/scripts/pyIDCardPreprocess V2.pyw');
    
    // Check if the Python script exists
    if (!await fs.pathExists(pythonScriptPath)) {
        throw new Error(`Python script not found at: ${pythonScriptPath}`);
    }
    
    // Check if input path exists
    if (!await fs.pathExists(inputPath)) {
        throw new Error(`Input path not found: ${inputPath}`);
    }
    
    try {
        const result = await executePythonScript(pythonScriptPath, inputPath, outputPath, mode);
        
        if (result.success) {
            // Check what files were created in the output directory
            const outputFiles = await fs.readdir(outputPath);
            
            return {
                success: true,
                message: 'ID card processing completed successfully',
                outputPath: outputPath,
                outputFiles: outputFiles,
                pythonOutput: result.output
            };
        } else {
            throw new Error(result.error || 'Python script execution failed');
        }
    } catch (error) {
        console.error('Error processing ID cards:', error);
        throw error;
    }
}

/**
 * Get processing status and results
 * @param {string} outputPath - Path to check for results
 * @returns {Promise<Object>}
 */
async function getProcessingResults(outputPath) {
    try {
        if (!await fs.pathExists(outputPath)) {
            return {
                exists: false,
                files: []
            };
        }
        
        const files = await fs.readdir(outputPath);
        const fileDetails = [];
        
        for (const file of files) {
            const filePath = path.join(outputPath, file);
            const stats = await fs.stat(filePath);
            
            fileDetails.push({
                name: file,
                path: filePath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                isDirectory: stats.isDirectory()
            });
        }
        
        return {
            exists: true,
            files: fileDetails,
            totalFiles: files.length
        };
    } catch (error) {
        console.error('Error getting processing results:', error);
        throw error;
    }
}

module.exports = {
    processIDCards,
    getProcessingResults,
    executePythonScript
};