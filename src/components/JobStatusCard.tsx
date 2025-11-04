import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Clock, Download, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Job {
  id: string;
  type: 'IMAGES_ONLY' | 'IMAGES_AND_EXCEL';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt?: string;
  processedFiles?: number;
  totalFiles?: number;
  radiusPercentage: number;
  errorMessage?: string;
  resultData?: {
    success: boolean;
    images_processed: number;
    images_failed: number;
    output_files: string[];
  };
}

interface JobStatusCardProps {
  job: Job;
  onDownload?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onDelete?: (jobId: string) => void;
}

const getStatusIcon = (status: Job['status']) => {
  switch (status) {
    case 'PENDING':
      return <Clock className="h-4 w-4" />;
    case 'PROCESSING':
      return <RefreshCw className="h-4 w-4 animate-spin" />;
    case 'COMPLETED':
      return <CheckCircle className="h-4 w-4" />;
    case 'FAILED':
      return <AlertCircle className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
};

const getStatusColor = (status: Job['status']) => {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-500';
    case 'PROCESSING':
      return 'bg-blue-500';
    case 'COMPLETED':
      return 'bg-green-500';
    case 'FAILED':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

const getProgressValue = (job: Job) => {
  if (job.status === 'COMPLETED') return 100;
  if (job.status === 'FAILED') return 0;
  if (job.status === 'PROCESSING') {
    if (job.processedFiles && job.totalFiles) {
      return (job.processedFiles / job.totalFiles) * 100;
    }
    return 50; // Indeterminate progress
  }
  return 0;
};

export function JobStatusCard({ job, onDownload, onCancel, onRetry, onDelete }: JobStatusCardProps) {
  const progressValue = getProgressValue(job);
  const canCancel = job.status === 'PENDING' || job.status === 'PROCESSING';
  const canDownload = job.status === 'COMPLETED';
  const canRetry = job.status === 'FAILED';

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={cn('p-1 rounded-full', getStatusColor(job.status))}>
              {getStatusIcon(job.status)}
            </div>
            <div>
              <CardTitle className="text-lg">Job {job.id.slice(0, 8)}</CardTitle>
              <CardDescription>
                {job.type === 'IMAGES_ONLY' ? 'Images Only' : 'Images & Excel'} • 
                Created {new Date(job.createdAt).toLocaleString()}
              </CardDescription>
            </div>
          </div>
          <Badge variant={job.status === 'COMPLETED' ? 'default' : job.status === 'FAILED' ? 'destructive' : 'secondary'}>
            {job.status}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span>{Math.round(progressValue)}%</span>
          </div>
          <Progress value={progressValue} className="h-2" />
        </div>

        {/* Job Details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Radius:</span>
            <span className="ml-2 font-medium">{job.radiusPercentage}%</span>
          </div>
          {job.processedFiles !== undefined && (
            <div>
              <span className="text-muted-foreground">Processed:</span>
              <span className="ml-2 font-medium">{job.processedFiles} files</span>
            </div>
          )}
        </div>

        {/* Result Data */}
        {job.resultData && (
          <div className="bg-muted/50 p-3 rounded-md text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Images Processed:</span>
                <span className="ml-2 font-medium text-green-600">{job.resultData.images_processed}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Images Failed:</span>
                <span className="ml-2 font-medium text-red-600">{job.resultData.images_failed}</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {job.errorMessage && (
          <div className="bg-red-50 border border-red-200 p-3 rounded-md">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-700">
                <p className="font-medium">Error:</p>
                <p>{job.errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-2 pt-2">
          {canCancel && onCancel && (
            <Button variant="outline" size="sm" onClick={() => onCancel(job.id)}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
          {canRetry && onRetry && (
            <Button variant="outline" size="sm" onClick={() => onRetry(job.id)}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          )}
          {canDownload && onDownload && (
            <Button size="sm" onClick={() => onDownload(job.id)}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          )}
          {onDelete && (job.status === 'COMPLETED' || job.status === 'FAILED') && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(job.id)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}