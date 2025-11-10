import React, { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSearchParams } from "react-router-dom";
import type { Job } from "@/components/JobStatusCard";

type VaultRegistrationError = {
  code?: string;
  message?: string;
  cardNo?: string;
};

// Profile payload per row (from backend parser)
type ProfileData = {
  DownloadCard?: string | boolean;
  [key: string]: unknown;
};

type VaultRegistrationDetail = {
  cardNo?: string;
  name?: string;
  hasPhoto?: boolean;
  respCode?: string;
  respMessage?: string;
  department?: string;
  staffNo?: string;
  sourceRow?: Record<string, unknown>;
  profile?: ProfileData;
};

type VaultRegistrationSummary = {
  success?: boolean;
  jobId?: string;
  endpointBaseUrl?: string;
  attempted: number;
  registered: number;
  withPhoto: number;
  withoutPhoto: number;
  errors: VaultRegistrationError[];
  details: VaultRegistrationDetail[];
};

// Types for upload API response
type UploadedFileInfo = {
  originalName: string;
  path: string;
  mimetype?: string;
  size?: number;
};

type UploadResponse = {
  success: boolean;
  files?: UploadedFileInfo[];
  error?: string;
};

const RegisterVault: React.FC = () => {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [searchParams] = useSearchParams();
  const [previewing, setPreviewing] = useState(false);
  const [previewSummary, setPreviewSummary] = useState<VaultRegistrationSummary | null>(null);
  const [previewMode, setPreviewMode] = useState<'job' | 'csv' | 'update_csv' | null>(null);
  const [registering, setRegistering] = useState(false);
  const [regSummary, setRegSummary] = useState<VaultRegistrationSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<VaultRegistrationDetail | null>(null);
  const [cardNoEdits, setCardNoEdits] = useState<Record<number, string>>({});
  const [photoChecks, setPhotoChecks] = useState<Record<number, boolean>>({});
  const [downloadCardEdits, setDownloadCardEdits] = useState<Record<number, boolean>>({});
  const [uploadedCsvPath, setUploadedCsvPath] = useState<string | undefined>();
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [csvPathInput, setCsvPathInput] = useState<string>('');
  // UpdateCard upload state
  const [uploadedUpdatePath, setUploadedUpdatePath] = useState<string | undefined>();
  const [uploadingUpdate, setUploadingUpdate] = useState(false);
  const [csvUpdatePathInput, setCsvUpdatePathInput] = useState<string>('');

  useEffect(() => {
    const jobIdParam = searchParams.get("jobId") || undefined;
    setSelectedJobId(jobIdParam);
  }, [searchParams]);

  useEffect(() => {
    const fetchJobs = async () => {
      setLoadingJobs(true);
      try {
        const response = await fetch("/api/jobs");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || "Failed to fetch jobs");
        setJobs(data.jobs || []);
      } catch (err) {
        console.error("Error fetching jobs:", err);
        toast({ title: "Error", description: "Failed to load jobs", variant: "destructive" });
      } finally {
        setLoadingJobs(false);
      }
    };
    fetchJobs();
  }, [toast]);

  const completedJobs = useMemo(() => jobs.filter(j => j.status === "COMPLETED"), [jobs]);

  // Upload controls removed — this page now exclusively registers cards from completed ID Card Processor jobs.

  const handleRegisterSelectedJob = async () => {
    if (!selectedJobId) {
      toast({ title: "No job selected", description: "Please choose a job to register." });
      return;
    }
    try {
      // First: preview (dry-run) to show details before executing
      setPreviewing(true);
      // Protection: once job preview is initiated, hide CSV upload section
      setPreviewMode('job');
      setPreviewSummary(null);
      const res = await fetch(`/api/vault/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJobId, dryRun: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Preview failed");
      const summary: VaultRegistrationSummary = {
        success: true,
        jobId: data.jobId,
        endpointBaseUrl: data.endpointBaseUrl,
        attempted: data.attempted ?? 0,
        registered: data.registered ?? 0,
        withPhoto: data.withPhoto ?? 0,
        withoutPhoto: data.withoutPhoto ?? 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
        details: Array.isArray(data.details) ? data.details : [],
      };
      setPreviewSummary(summary);
      toast({ title: "Preview ready", description: `Found ${summary.attempted} cards. Review and execute below.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Vault preview failed",
        description: message || "Preview failed.",
        variant: "destructive",
      });
    }
    finally {
      setPreviewing(false);
    }
  };

  const handleUploadCsv = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append('files', f);
    // optional: include mode for clarity
    form.append('processingMode', 'images_and_excel');
    try {
      setUploadingCsv(true);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UploadResponse = await res.json();
      if (!data.success) throw new Error(data.error || 'Upload failed');
      const filesList: UploadedFileInfo[] = Array.isArray(data.files) ? data.files : [];
      const csvFile = filesList.find((f) => f.originalName.toLowerCase().endsWith('.csv'));
      if (!csvFile) throw new Error('No CSV file found in upload');
      setUploadedCsvPath(csvFile.path);
      toast({ title: 'CSV uploaded', description: 'Ready to preview and register.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'CSV upload failed', description: message, variant: 'destructive' });
    } finally {
      setUploadingCsv(false);
    }
  };

  const handlePreviewUploadedCsv = async () => {
    if (!uploadedCsvPath) {
      toast({ title: 'No CSV uploaded', description: 'Please upload a CSV first.' });
      return;
    }
    try {
      setPreviewing(true);
      setPreviewSummary(null);
      const res = await fetch('/api/vault/preview-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvPath: uploadedCsvPath })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Preview CSV failed');
      const summary: VaultRegistrationSummary = {
        success: true,
        jobId: data.jobId,
        endpointBaseUrl: data.endpointBaseUrl,
        attempted: data.attempted ?? 0,
        registered: data.registered ?? 0,
        withPhoto: data.withPhoto ?? 0,
        withoutPhoto: data.withoutPhoto ?? 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
        details: Array.isArray(data.details) ? data.details : [],
      };
      setPreviewSummary(summary);
      setPreviewMode('csv');
      toast({ title: 'CSV preview ready', description: `Found ${summary.attempted} cards in CSV.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Preview CSV failed', description: message, variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  };

  // Upload and preview for UpdateCard (CSV/Excel)
  const handleUploadUpdateCsv = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append('files', f);
    form.append('processingMode', 'images_and_excel');
    try {
      setUploadingUpdate(true);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UploadResponse = await res.json();
      if (!data.success) throw new Error(data.error || 'Upload failed');
      const filesList: UploadedFileInfo[] = Array.isArray(data.files) ? data.files : [];
      const updateFile = filesList.find((f) => f.originalName.toLowerCase().endsWith('.csv') || f.originalName.toLowerCase().endsWith('.xlsx') || f.originalName.toLowerCase().endsWith('.xls'));
      if (!updateFile) throw new Error('No CSV/Excel file found in upload');
      setUploadedUpdatePath(updateFile.path);
      toast({ title: 'File uploaded', description: 'Ready to preview for UpdateCard.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
    } finally {
      setUploadingUpdate(false);
    }
  };

  const handlePreviewUploadedUpdateCsv = async () => {
    if (!uploadedUpdatePath) {
      toast({ title: 'No file uploaded', description: 'Please upload a CSV/Excel first.' });
      return;
    }
    try {
      setPreviewing(true);
      setPreviewSummary(null);
      const res = await fetch('/api/vault/preview-update-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvPath: uploadedUpdatePath })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Preview UpdateCard CSV failed');
      const summary: VaultRegistrationSummary = {
        success: true,
        jobId: data.jobId,
        endpointBaseUrl: data.endpointBaseUrl,
        attempted: data.attempted ?? 0,
        registered: data.registered ?? 0,
        withPhoto: data.withPhoto ?? 0,
        withoutPhoto: data.withoutPhoto ?? 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
        details: Array.isArray(data.details) ? data.details : [],
      };
      setPreviewSummary(summary);
      setPreviewMode('update_csv');
      toast({ title: 'UpdateCard preview ready', description: `Found ${summary.attempted} rows.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Preview UpdateCard CSV failed', description: message, variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  };

  const handleExecuteRegistration = async () => {
    if (!previewSummary) return;
    try {
      setRegistering(true);
      setRegSummary(null);
      // Build overrides from current edits
      const overrides = (previewSummary.details || []).map((d, idx) => {
        const cardNo = (cardNoEdits[idx] ?? d.cardNo ?? '').trim().slice(0, 10);
        const defaultDownloadStr = String(d.profile?.DownloadCard ?? 'true');
        const defaultDownload = defaultDownloadStr.toLowerCase() === 'true';
        const downloadCard = (downloadCardEdits[idx] ?? defaultDownload);
        return { index: idx, cardNo, downloadCard };
      });
      const endpoint = previewMode === 'csv' ? `/api/vault/register-csv` : (previewMode === 'update_csv' ? `/api/vault/update-csv` : `/api/vault/register`);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previewMode === 'csv' ? { csvPath: uploadedCsvPath, overrides } : (previewMode === 'update_csv' ? { csvPath: uploadedUpdatePath, overrides } : { jobId: selectedJobId, overrides })),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Registration failed");
      const summary: VaultRegistrationSummary = {
        success: true,
        jobId: data.jobId,
        endpointBaseUrl: data.endpointBaseUrl,
        attempted: data.attempted ?? 0,
        registered: data.registered ?? 0,
        withPhoto: data.withPhoto ?? 0,
        withoutPhoto: data.withoutPhoto ?? 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
        details: Array.isArray(data.details) ? data.details : [],
      };
      setRegSummary(summary);
      toast({ title: "Vault registration completed", description: `Registered ${summary.registered}/${summary.attempted} cards.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Vault registration failed", description: message || "Registration failed.", variant: "destructive" });
    } finally {
      setRegistering(false);
    }
  };

  const handleCheckPhotos = async () => {
    if (!previewSummary) return;
    try {
      const rows = previewSummary.details.slice(0, 100).map((d, idx) => ({ index: idx, cardNo: (cardNoEdits[idx] ?? d.cardNo ?? '').trim(), staffNo: (d.staffNo ?? '').trim() }));
      const res = await fetch(previewMode === 'csv' || previewMode === 'update_csv' ? '/api/vault/photo-check-csv' : '/api/vault/photo-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewMode === 'csv' ? { csvPath: uploadedCsvPath, rows } : (previewMode === 'update_csv' ? { csvPath: uploadedUpdatePath, rows } : { jobId: selectedJobId, rows }))
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Photo check failed');
      const map: Record<number, boolean> = {};
      for (const r of data.results || []) {
        if (typeof r.index === 'number') map[r.index] = !!r.hasPhoto;
      }
      setPhotoChecks(map);
      toast({ title: 'Photo check complete', description: 'Updated photo statuses based on Card No edits.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Photo check failed', description: message, variant: 'destructive' });
    }
  };

  const handleDownloadSummary = () => {
    if (!regSummary) return;
    const blob = new Blob([JSON.stringify(regSummary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vault-registration-${selectedJobId?.slice(0,8) || 'summary'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout title="Register Vault">
      <div className="space-y-6">
        <p className="text-muted-foreground text-sm">
          Register from a completed ID Card Processor job or upload a standalone CSV (CardDatafileformat_*.csv) to register directly into Vault.
        </p>

        {/* Select a processed job to register */}
        <Card>
          <CardHeader>
            <CardTitle>Select Job to Register</CardTitle>
            <CardDescription>Choose a completed job from ID Card Processor to register into Vault</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Completed Jobs</label>
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger disabled={loadingJobs}>
                    <SelectValue placeholder={loadingJobs ? "Loading jobs..." : "Select a job"} />
                  </SelectTrigger>
                  <SelectContent>
                    {completedJobs.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No completed jobs</div>
                    ) : (
                      completedJobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          Job {j.id.slice(0, 8)} • {j.type === 'IMAGES_ONLY' ? 'Images Only' : 'Images & Excel'}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button onClick={handleRegisterSelectedJob} disabled={!selectedJobId || previewing} className="w-full sm:w-auto">
                  {previewing ? "Preparing preview..." : "Register Selected Job to Vault"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload CSV for direct registration — hidden once a job preview is initiated */}
        {previewMode !== 'job' && (
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV for Vault Registration</CardTitle>
              <CardDescription>Use a CSV in the CardDatafileformat schema without running the ID Card Processor</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select CSV</label>
                  <Input type="file" accept=".csv" onChange={(e) => handleUploadCsv(e.target.files)} />
                  {uploadedCsvPath && (
                    <div className="text-xs text-muted-foreground break-all">Uploaded: {uploadedCsvPath}</div>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={handlePreviewUploadedCsv} disabled={uploadingCsv || !uploadedCsvPath} className="w-full sm:w-auto">
                    {previewing ? 'Preparing preview...' : 'Preview Uploaded CSV'}
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Or use an existing server CSV path</label>
                  <Input
                    placeholder="e.g. C:\\Scripts\\Projects\\data-interpret-kit\\server\\output\\<jobId>\\CardDatafileformat_08-11-2025.csv"
                    value={csvPathInput}
                    onChange={(e) => setCsvPathInput(e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!csvPathInput) {
                        toast({ title: 'CSV path required', description: 'Please enter a CSV path.' });
                        return;
                      }
                      setUploadedCsvPath(csvPathInput);
                      await handlePreviewUploadedCsv();
                    }}
                    className="w-full sm:w-auto"
                  >
                    Preview CSV from path
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Update existing cards from CSV/Excel — hidden once a job preview is initiated */}
        {previewMode !== 'job' && (
          <Card>
            <CardHeader>
              <CardTitle>Update Existing Cards (CSV/Excel)</CardTitle>
              <CardDescription>Upload an Excel/CSV following the UpdateCard schema to update existing cards in Vault</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const resp = await fetch('/api/vault/template/update-card.xlsx');
                      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                      const blob = await resp.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'UpdateCardTemplate.xlsx';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      const message = err instanceof Error ? err.message : String(err);
                      toast({ title: 'Download template failed', description: message, variant: 'destructive' });
                    }
                  }}
                >
                  Download Update Template (Excel)
                </Button>
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select CSV/Excel</label>
                  <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleUploadUpdateCsv(e.target.files)} />
                  {uploadedUpdatePath && (
                    <div className="text-xs text-muted-foreground break-all">Uploaded: {uploadedUpdatePath}</div>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={handlePreviewUploadedUpdateCsv} disabled={uploadingUpdate || !uploadedUpdatePath} className="w-full sm:w-auto">
                    {previewing ? 'Preparing preview...' : 'Preview Uploaded File'}
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Or use an existing server file path</label>
                  <Input
                    placeholder="e.g. C:\\Scripts\\Projects\\data-interpret-kit\\server\\uploads\\<session>\\UpdateData.xlsx"
                    value={csvUpdatePathInput}
                    onChange={(e) => setCsvUpdatePathInput(e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!csvUpdatePathInput) {
                        toast({ title: 'File path required', description: 'Please enter a CSV/Excel path.' });
                        return;
                      }
                      setUploadedUpdatePath(csvUpdatePathInput);
                      await handlePreviewUploadedUpdateCsv();
                    }}
                    className="w-full sm:w-auto"
                  >
                    Preview from path
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {previewSummary && (
          <Card>
            <CardHeader>
              <CardTitle>Preview Cards to Register</CardTitle>
              <CardDescription>
                Review the values before executing. Attempted {previewSummary.attempted}, With Photo {previewSummary.withPhoto}, Without Photo {previewSummary.withoutPhoto}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-amber-600">
                Card No is required for each user. Staff No is employee ID (not card number). Please fill missing Card No values before executing.
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4">Card No</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Department</th>
                      <th className="py-2 pr-4">Staff No</th>
                      <th className="py-2 pr-4">Photo</th>
                      <th className="py-2 pr-4">Download Card</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewSummary.details.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-3 text-muted-foreground">No rows found in job output</td>
                      </tr>
                    ) : (
                      previewSummary.details.slice(0, 100).map((d, idx) => (
                        <tr key={`${d.cardNo}-${idx}`} className="border-b">
                          <td className="py-2 pr-4">
                            <Input
                              value={cardNoEdits[idx] ?? d.cardNo ?? ''}
                              placeholder="Enter Card No"
                              maxLength={10}
                              onChange={(e) => setCardNoEdits((prev) => ({ ...prev, [idx]: e.target.value }))}
                            />
                          </td>
                          <td className="py-2 pr-4">{d.name || '-'}</td>
                          <td className="py-2 pr-4">{d.department || '-'}</td>
                          <td className="py-2 pr-4">{d.staffNo || '-'}</td>
                          <td className="py-2 pr-4">{(photoChecks[idx] ?? d.hasPhoto) ? 'Yes' : 'No'}</td>
                          <td className="py-2 pr-4">
                            {(() => {
                              const profile = d.profile as Record<string, unknown> | undefined;
                              const defaultDownloadStr = String(profile?.DownloadCard ?? 'true');
                              const defaultDownload = defaultDownloadStr.toLowerCase() === 'true';
                              const val = downloadCardEdits[idx] ?? defaultDownload;
                              return (
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={val}
                                    onCheckedChange={(checked) => setDownloadCardEdits(prev => ({ ...prev, [idx]: !!checked }))}
                                  />
                                  <span className="text-xs text-muted-foreground">{val ? 'Yes' : 'No'}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-2 pr-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setSelectedDetail(d); setDetailOpen(true); }}
                            >
                              View details
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleCheckPhotos}>Re-check photos</Button>
                  {/* Bulk set DownloadCard ON/OFF */}
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!previewSummary) return;
                      const next: Record<number, boolean> = {};
                      previewSummary.details.slice(0, 100).forEach((d, idx) => { next[idx] = true; });
                      setDownloadCardEdits(next);
                    }}
                  >
                    Set all Download ON
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!previewSummary) return;
                      const next: Record<number, boolean> = {};
                      previewSummary.details.slice(0, 100).forEach((d, idx) => { next[idx] = false; });
                      setDownloadCardEdits(next);
                    }}
                  >
                    Set all Download OFF
                  </Button>
                </div>
                {(() => {
                  const missing = (previewSummary.details || []).reduce((acc, d, idx) => {
                    const effective = (cardNoEdits[idx] ?? d.cardNo ?? '').trim();
                    return acc + (effective ? 0 : 1);
                  }, 0);
                  return (
                    <div className="flex items-center justify-end gap-3">
                      {missing > 0 && (
                        <div className="text-sm text-red-600">{missing} row(s) missing Card No</div>
                      )}
                      <Button onClick={handleExecuteRegistration} disabled={registering || missing > 0 || (previewMode === 'csv' && !uploadedCsvPath)}>
                        {registering ? 'Executing...' : 'Execute registration'}
                      </Button>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Card details</DialogTitle>
              <DialogDescription>Raw CSV/Excel row and mapped Vault profile.</DialogDescription>
            </DialogHeader>

            {selectedDetail ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-medium mb-2">Mapped profile</div>
                  <div className="grid grid-cols-2 gap-2">
                    {['CardNo','Name','Department','Company','AccessLevel','FaceAccessLevel','Email','MobileNo','ActiveStatus','NonExpired','ExpiredDate','DownloadCard'].map((k) => {
                      const profile = selectedDetail.profile as Record<string, unknown> | undefined;
                      const val = profile ? profile[k] : undefined;
                      return (
                        <div key={k} className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-mono break-all">{val !== undefined && val !== null && String(val).length > 0 ? String(val) : '-'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="font-medium mb-2">Source row</div>
                  <div className="max-h-60 overflow-auto border rounded p-2">
                    <table className="w-full text-xs">
                      <tbody>
                        {Object.entries((selectedDetail.sourceRow || {}) as Record<string, unknown>).map(([key, val]) => (
                          <tr key={key} className="border-b">
                            <td className="py-1 pr-4 text-muted-foreground align-top">{key}</td>
                            <td className="py-1 font-mono break-all">{val !== undefined && val !== null && String(val).length > 0 ? String(val) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No detail selected</div>
            )}
          </DialogContent>
        </Dialog>

        {regSummary && (
          <Card>
            <CardHeader>
              <CardTitle>Vault Registration Summary</CardTitle>
              <CardDescription>
                Job {regSummary.jobId?.slice(0,8) || selectedJobId?.slice(0,8)} • Attempted {regSummary.attempted}, Registered {regSummary.registered}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 rounded border">
                  <div className="text-muted-foreground">Attempted</div>
                  <div className="font-medium">{regSummary.attempted}</div>
                </div>
                <div className="p-3 rounded border">
                  <div className="text-muted-foreground">Registered</div>
                  <div className="font-medium">{regSummary.registered}</div>
                </div>
                <div className="p-3 rounded border">
                  <div className="text-muted-foreground">With Photo</div>
                  <div className="font-medium">{regSummary.withPhoto}</div>
                </div>
                <div className="p-3 rounded border">
                  <div className="text-muted-foreground">Without Photo</div>
                  <div className="font-medium">{regSummary.withoutPhoto}</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleDownloadSummary}>Download result JSON</Button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4">Card No</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Photo</th>
                      <th className="py-2 pr-4">Resp Code</th>
                      <th className="py-2 pr-4">Resp Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regSummary.details.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-3 text-muted-foreground">No per-card details returned</td>
                      </tr>
                    ) : (
                      regSummary.details.slice(0, 100).map((d, idx) => (
                        <tr key={`${d.cardNo}-${idx}`} className="border-b">
                          <td className="py-2 pr-4 font-mono">{d.cardNo || '-'}</td>
                          <td className="py-2 pr-4">{d.name || '-'}</td>
                          <td className="py-2 pr-4">{d.hasPhoto ? 'Yes' : 'No'}</td>
                          <td className="py-2 pr-4">{d.respCode || '-'}</td>
                          <td className="py-2 pr-4">{d.respMessage || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upload menus removed — registration relies on existing processed jobs only. */}
      </div>
    </AppLayout>
  );
};

export default RegisterVault;