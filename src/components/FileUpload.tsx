import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Upload, 
  X, 
  FileImage, 
  FileSpreadsheet, 
  AlertCircle, 
  CheckCircle,
  Loader2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FileUploadProps {
  onUploadComplete?: (jobId: string) => void;
  onUploadStart?: () => void;
}

interface UploadFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
}

export function FileUpload({ onUploadComplete, onUploadStart }: FileUploadProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingMode, setProcessingMode] = useState<'images_only' | 'images_and_excel'>('images_and_excel');
  const [radiusPercentage, setRadiusPercentage] = useState(15);
  const [processExcel, setProcessExcel] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const validateFile = (file: File): string | null => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const excelTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];

    if (file.size > maxSize) {
      return 'File size must be less than 10MB';
    }

    if (processingMode === 'images_only' && !imageTypes.includes(file.type)) {
      return 'Only image files (JPEG, PNG) are allowed in images-only mode';
    }

    if (processingMode === 'images_and_excel' && 
        !imageTypes.includes(file.type) && 
        !excelTypes.includes(file.type)) {
      return 'Only image files (JPEG, PNG) and Excel files are allowed';
    }

    return null;
  };

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const validFiles: UploadFile[] = [];

    fileArray.forEach(file => {
      const error = validateFile(file);
      validFiles.push({
        file,
        id: generateId(),
        status: error ? 'error' : 'pending',
        progress: 0,
        error
      });
    });

    setFiles(prev => [...prev, ...validFiles]);

    // Show validation errors
    const errorFiles = validFiles.filter(f => f.error);
    if (errorFiles.length > 0) {
      toast({
        title: 'File Validation Errors',
        description: `${errorFiles.length} file(s) have validation errors`,
        variant: 'destructive',
      });
    }
  }, [processingMode, toast]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAllFiles = () => {
    setFiles([]);
  };

  const handleUpload = async () => {
    const validFiles = files.filter(f => f.status !== 'error');
    if (validFiles.length === 0) {
      toast({
        title: 'No Valid Files',
        description: 'Please add valid files before uploading',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    onUploadStart?.();

    try {
      const formData = new FormData();
      
      validFiles.forEach(({ file }) => {
        formData.append('files', file);
      });

      formData.append('processingMode', processingMode);

      // Update file statuses to uploading
      setFiles(prev => prev.map(f => 
        f.status !== 'error' ? { ...f, status: 'uploading' as const, progress: 0 } : f
      ));

      const response = await fetch('http://localhost:3001/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          // Update file statuses to success
          setFiles(prev => prev.map(f => 
            f.status === 'uploading' ? { ...f, status: 'success' as const, progress: 100 } : f
          ));

          toast({
            title: 'Upload Successful',
            description: `${result.files.length} files uploaded successfully`,
          });

          // Now process the uploaded files
          await processFiles(result.files, result.uploadPath);
          
          // Clear files after successful upload
          setTimeout(() => {
            setFiles([]);
          }, 2000);
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      
      // Update file statuses to error
      setFiles(prev => prev.map(f => 
        f.status === 'uploading' ? { 
          ...f, 
          status: 'error' as const, 
          error: error instanceof Error ? error.message : 'Upload failed' 
        } : f
      ));

      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'An error occurred during upload',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const processFiles = async (uploadedFiles: string[], uploadPath: string) => {
    try {
      const response = await fetch('http://localhost:3001/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputPath: uploadPath,
          processingMode,
          radiusPercentage: parseFloat(radiusPercentage.toString()),
          processExcel
        }),
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          toast({
            title: 'Processing Complete',
            description: `Files processed successfully. Session ID: ${result.sessionId}`,
          });

          onUploadComplete?.(result.sessionId);
        } else {
          throw new Error(result.error || 'Processing failed');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Processing failed');
      }
    } catch (error) {
      console.error('Processing error:', error);
      toast({
        title: 'Processing Failed',
        description: error instanceof Error ? error.message : 'An error occurred during processing',
        variant: 'destructive',
      });
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <FileImage className="h-4 w-4" />;
    } else {
      return <FileSpreadsheet className="h-4 w-4" />;
    }
  };

  const getStatusIcon = (status: UploadFile['status']) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const validFilesCount = files.filter(f => f.status !== 'error').length;
  const imageFiles = files.filter(f => f.file.type.startsWith('image/'));
  const excelFiles = files.filter(f => !f.file.type.startsWith('image/'));

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>File Upload</CardTitle>
        <CardDescription>
          Upload images and Excel files for processing
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Processing Configuration */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="processing-mode">Processing Mode</Label>
            <Select value={processingMode} onValueChange={(value: 'images_only' | 'images_and_excel') => setProcessingMode(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="images_only">Images Only</SelectItem>
                <SelectItem value="images_and_excel">Images and Excel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="radius-percentage">Radius Percentage: {radiusPercentage}%</Label>
              <Input
                id="radius-percentage"
                type="range"
                min="5"
                max="50"
                value={radiusPercentage}
                onChange={(e) => setRadiusPercentage(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="process-excel"
                checked={processExcel}
                onCheckedChange={setProcessExcel}
                disabled={processingMode === 'images_only'}
              />
              <Label htmlFor="process-excel">Process Excel Files</Label>
            </div>
          </div>
        </div>

        <Separator />

        {/* File Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive 
              ? 'border-primary bg-primary/5' 
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <div className="space-y-2">
            <p className="text-lg font-medium">
              Drop files here or click to browse
            </p>
            <p className="text-sm text-muted-foreground">
              {processingMode === 'images_only' 
                ? 'Supports: JPEG, PNG (max 10MB each)'
                : 'Supports: JPEG, PNG, Excel files (max 10MB each)'
              }
            </p>
          </div>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            Browse Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={processingMode === 'images_only' 
              ? 'image/jpeg,image/jpg,image/png'
              : 'image/jpeg,image/jpg,image/png,.xlsx,.xls'
            }
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex space-x-4 text-sm text-muted-foreground">
                <span>{imageFiles.length} image(s)</span>
                <span>{excelFiles.length} Excel file(s)</span>
                <span>{validFilesCount} valid file(s)</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFiles}
                disabled={uploading}
              >
                Clear All
              </Button>
            </div>

            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {files.map((uploadFile) => (
                  <div
                    key={uploadFile.id}
                    className="flex items-center space-x-3 p-3 border rounded-lg"
                  >
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      {getFileIcon(uploadFile.file)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {uploadFile.file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(uploadFile.file.size)}
                        </p>
                        {uploadFile.error && (
                          <p className="text-xs text-red-500 mt-1">
                            {uploadFile.error}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Badge variant={
                        uploadFile.status === 'success' ? 'default' :
                        uploadFile.status === 'error' ? 'destructive' :
                        uploadFile.status === 'uploading' ? 'secondary' : 'outline'
                      }>
                        {uploadFile.status}
                      </Badge>
                      {getStatusIcon(uploadFile.status)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(uploadFile.id)}
                        disabled={uploading}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Upload Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={uploading || validFilesCount === 0}
            className="min-w-[120px]"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload Files
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}