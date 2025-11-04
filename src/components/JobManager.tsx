import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { RefreshCw, Search, Filter } from 'lucide-react';
import { JobStatusCard, Job } from './JobStatusCard';
import { useToast } from '@/hooks/use-toast';

interface JobManagerProps {
  onRefresh?: () => void;
}

export function JobManager({ onRefresh }: JobManagerProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/jobs');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setJobs(data.jobs || []);
      } else {
        throw new Error(data.error || 'Failed to fetch jobs');
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch jobs',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    // Set up polling for active jobs
    const interval = setInterval(() => {
      const hasActiveJobs = jobs.some(job => job.status === 'PENDING' || job.status === 'PROCESSING');
      if (hasActiveJobs) {
        fetchJobs();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs]);

  const handleDownload = async (jobId: string) => {
    try {
      const response = await fetch(`/api/process/download/${jobId}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `job-${jobId}-results.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        toast({
          title: 'Success',
          description: 'Download started',
        });
      } else {
        throw new Error('Download failed');
      }
    } catch (error) {
      console.error('Error downloading:', error);
      toast({
        title: 'Error',
        description: 'Failed to download results',
        variant: 'destructive',
      });
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      const response = await fetch(`/api/process/cancel/${jobId}`, {
        method: 'POST',
      });
      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Job cancelled',
        });
        fetchJobs();
      } else {
        throw new Error('Cancel failed');
      }
    } catch (error) {
      console.error('Error cancelling job:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel job',
        variant: 'destructive',
      });
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/retry/${jobId}`, {
        method: 'POST',
      });
      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Job restarted',
        });
        fetchJobs();
      } else {
        throw new Error('Retry failed');
      }
    } catch (error) {
      console.error('Error retrying job:', error);
      toast({
        title: 'Error',
        description: 'Failed to retry job',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Job deleted',
        });
        fetchJobs();
      } else {
        throw new Error('Delete failed');
      }
    } catch (error) {
      console.error('Error deleting job:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete job',
        variant: 'destructive',
      });
    }
  };

  const filteredJobs = jobs.filter(job => {
    const matchesFilter = filter === 'all' || job.status.toLowerCase() === filter;
    const matchesSearch = job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         job.type.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getStatusCounts = () => {
    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'PENDING').length,
      processing: jobs.filter(j => j.status === 'PROCESSING').length,
      completed: jobs.filter(j => j.status === 'COMPLETED').length,
      failed: jobs.filter(j => j.status === 'FAILED').length,
    };
  };

  const statusCounts = getStatusCounts();

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Job Manager</CardTitle>
            <CardDescription>
              Monitor and manage your processing jobs
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchJobs();
              onRefresh?.();
            }}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status Overview */}
        <div className="grid grid-cols-5 gap-2">
          <div className="text-center">
            <div className="text-2xl font-bold">{statusCounts.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">{statusCounts.pending}</div>
            <div className="text-xs text-muted-foreground">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{statusCounts.processing}</div>
            <div className="text-xs text-muted-foreground">Processing</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{statusCounts.completed}</div>
            <div className="text-xs text-muted-foreground">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{statusCounts.failed}</div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </div>
        </div>

        <Separator />

        {/* Filters */}
        <div className="flex space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={filter} onValueChange={(value: 'all' | 'pending' | 'processing' | 'completed' | 'failed') => setFilter(value)}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Jobs List */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-4">
            {filteredJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {jobs.length === 0 ? 'No jobs found' : 'No jobs match your filters'}
              </div>
            ) : (
              filteredJobs.map((job) => (
                <JobStatusCard
                  key={job.id}
                  job={job}
                  onDownload={handleDownload}
                  onCancel={handleCancel}
                  onRetry={handleRetry}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}