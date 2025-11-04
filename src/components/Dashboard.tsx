import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Activity, 
  Users, 
  FileImage, 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  BarChart3
} from 'lucide-react';
import { FileUpload } from './FileUpload';
import { JobManager } from './JobManager';
import { Job } from './JobStatusCard';
import { useToast } from '@/hooks/use-toast';

interface DashboardStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalEmployees: number;
  totalImages: number;
  processingRate: number;
  averageProcessingTime: number;
  recentJobs: Array<{
    id: string;
    type: string;
    status: string;
    createdAt: string;
  }>;
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('upload');
  const { toast } = useToast();

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/jobs');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
       if (data.success) {
         const jobs: Job[] = data.jobs || [];
         const statistics = data.statistics || {};
         
         // Calculate stats from the jobs data
         const totalJobs = jobs.length;
         const activeJobs = jobs.filter((job: Job) => job.status === 'PENDING' || job.status === 'PROCESSING').length;
         const completedJobs = jobs.filter((job: Job) => job.status === 'COMPLETED').length;
         const failedJobs = jobs.filter((job: Job) => job.status === 'FAILED').length;
         
         // Calculate processing rate (completed jobs / total jobs * 100)
         const processingRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;
         
         // Calculate average processing time from completed jobs
         const completedJobsWithTime = jobs.filter((job: Job) => 
           job.status === 'COMPLETED' && job.createdAt && job.completedAt
         );
         const averageProcessingTime = completedJobsWithTime.length > 0 
           ? Math.round(completedJobsWithTime.reduce((acc: number, job: Job) => {
               const start = new Date(job.createdAt).getTime();
               const end = new Date(job.completedAt!).getTime();
               return acc + (end - start);
             }, 0) / completedJobsWithTime.length / 1000) // Convert to seconds
           : 0;
         
         // Get recent jobs (last 5)
         const recentJobs = jobs
           .sort((a: Job, b: Job) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
           .slice(0, 5)
           .map((job: Job) => ({
             id: job.id,
             type: job.type,
             status: job.status,
             createdAt: job.createdAt
           }));
        
        setStats({
          totalJobs,
          activeJobs,
          completedJobs,
          failedJobs,
          totalEmployees: statistics.totalEmployees || 0,
          totalImages: statistics.totalImages || 0,
          processingRate,
          averageProcessingTime,
          recentJobs
        });
      } else {
        throw new Error(data.error || 'Failed to fetch stats');
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch dashboard statistics',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleUploadComplete = (jobId: string) => {
    toast({
      title: 'Upload Complete',
      description: `Job ${jobId} has been created and is being processed`,
    });
    setActiveTab('jobs');
    fetchStats();
  };

  const handleUploadStart = () => {
    toast({
      title: 'Upload Started',
      description: 'Your files are being uploaded...',
    });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ID Card Processor</h1>
        <p className="text-muted-foreground">
          Upload and process ID card images with Excel data integration
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalJobs || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.activeJobs || 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Employees</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalEmployees || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.totalImages || 0} images processed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.processingRate ? `${stats.processingRate.toFixed(1)}%` : '0%'}
            </div>
            <Progress 
              value={stats?.processingRate || 0} 
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Processing Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.averageProcessingTime ? formatDuration(stats.averageProcessingTime) : '0s'}
            </div>
            <p className="text-xs text-muted-foreground">
              Per job completion
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Upload and Jobs */}
        <div className="lg:col-span-2">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Upload Files</TabsTrigger>
              <TabsTrigger value="jobs">Manage Jobs</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <FileUpload 
                onUploadComplete={handleUploadComplete}
                onUploadStart={handleUploadStart}
              />
            </TabsContent>

            <TabsContent value="jobs" className="space-y-4">
              <JobManager onRefresh={fetchStats} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Recent Activity and Status */}
        <div className="space-y-6">
          {/* Job Status Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Job Status</CardTitle>
              <CardDescription>Current processing status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Completed</span>
                  </div>
                  <Badge variant="secondary">{stats?.completedJobs || 0}</Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Activity className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">Active</span>
                  </div>
                  <Badge variant="default">{stats?.activeJobs || 0}</Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">Failed</span>
                  </div>
                  <Badge variant="destructive">{stats?.failedJobs || 0}</Badge>
                </div>
              </div>

              {stats && stats.totalJobs > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Overall Progress</span>
                      <span>
                        {Math.round(((stats.completedJobs + stats.failedJobs) / stats.totalJobs) * 100)}%
                      </span>
                    </div>
                    <Progress 
                      value={((stats.completedJobs + stats.failedJobs) / stats.totalJobs) * 100}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Jobs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Jobs</CardTitle>
              <CardDescription>Latest processing activities</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                {stats?.recentJobs && stats.recentJobs.length > 0 ? (
                  <div className="space-y-3">
                    {stats.recentJobs.map((job) => (
                      <div key={job.id} className="flex items-center space-x-3 p-2 rounded-lg border">
                        <div className="flex-shrink-0">
                          {job.status === 'COMPLETED' && <CheckCircle className="h-4 w-4 text-green-500" />}
                          {job.status === 'FAILED' && <XCircle className="h-4 w-4 text-red-500" />}
                          {(job.status === 'PENDING' || job.status === 'PROCESSING') && 
                            <Activity className="h-4 w-4 text-blue-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {job.type.replace('_', ' ')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(job.createdAt)}
                          </p>
                        </div>
                        <Badge 
                          variant={
                            job.status === 'COMPLETED' ? 'default' :
                            job.status === 'FAILED' ? 'destructive' : 'secondary'
                          }
                          className="text-xs"
                        >
                          {job.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <BarChart3 className="mx-auto h-8 w-8 mb-2" />
                    <p className="text-sm">No recent jobs</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}