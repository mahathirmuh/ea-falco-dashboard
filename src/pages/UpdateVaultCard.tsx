import React, { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

type VaultRegistrationError = {
  code?: string;
  message?: string;
  cardNo?: string;
};

type ProfileData = {
  Download?: string | boolean;
  DownloadCard?: string | boolean; // fallback for older logs
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

const UpdateVaultCard: React.FC = () => {
  const { toast } = useToast();
  const [previewing, setPreviewing] = useState(false);
  const [previewSummary, setPreviewSummary] = useState<VaultRegistrationSummary | null>(null);
  const [registering, setRegistering] = useState(false);
  const [regSummary, setRegSummary] = useState<VaultRegistrationSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rowExecuting, setRowExecuting] = useState<Record<number, boolean>>({});
  const [selectedDetail, setSelectedDetail] = useState<VaultRegistrationDetail | null>(null);
  const [cardNoEdits, setCardNoEdits] = useState<Record<number, string>>({});
  const [photoChecks, setPhotoChecks] = useState<Record<number, boolean>>({});
  const [downloadCardEdits, setDownloadCardEdits] = useState<Record<number, boolean>>({});
  const [rowStatusMap, setRowStatusMap] = useState<Record<number, { state: 'idle' | 'executing' | 'success' | 'failed', code?: string, message?: string, requestId?: string }>>({});
  const [uploadedUpdatePath, setUploadedUpdatePath] = useState<string | undefined>();
  const [uploadingUpdate, setUploadingUpdate] = useState(false);
  const [csvUpdatePathInput, setCsvUpdatePathInput] = useState<string>("");

  // Single-card update from DB section state
  const [dbCardNo, setDbCardNo] = useState<string>("");
  const [dbAccessLevel, setDbAccessLevel] = useState<string>("");
  const [dbFaceLevel, setDbFaceLevel] = useState<string>("");
  const [dbLiftLevel, setDbLiftLevel] = useState<string>("");
  const [dbDepartment, setDbDepartment] = useState<string>("");
  const [dbTitle, setDbTitle] = useState<string>("");
  const [dbPosition, setDbPosition] = useState<string>("");
  const [dbGender, setDbGender] = useState<string>("");
  const [dbDob, setDbDob] = useState<string>("");
  const [dbRace, setDbRace] = useState<string>("");
  const [dbVehicle, setDbVehicle] = useState<string>("");
  const [dbMesshall, setDbMesshall] = useState<string>("");
  const [dbActive, setDbActive] = useState<boolean>(true);
  const [dbEndpoint, setDbEndpoint] = useState<string>("");
  const [dbServer, setDbServer] = useState<string>("");
  const [dbName, setDbName] = useState<string>("");
  const [dbUser, setDbUser] = useState<string>("");
  const [dbPass, setDbPass] = useState<string>("");
  const [dbPort, setDbPort] = useState<string>("");
  const [dbUpdating, setDbUpdating] = useState<boolean>(false);

  const handleUpdateFromDb = async () => {
    if (!dbCardNo.trim()) {
      toast({ title: 'Card No required', description: 'Please enter Card No to update from DB.', variant: 'destructive' });
      return;
    }
    try {
      setDbUpdating(true);
      const body: Record<string, unknown> = {
        cardNo: dbCardNo.trim(),
        overrides: {
          accessLevel: dbAccessLevel.trim() || undefined,
          faceLevel: dbFaceLevel.trim() || undefined,
          liftLevel: dbLiftLevel.trim() || undefined,
          department: dbDepartment.trim() || undefined,
          title: dbTitle.trim() || undefined,
          position: dbPosition.trim() || undefined,
          gender: dbGender.trim() || undefined,
          dob: dbDob.trim() || undefined,
          race: dbRace.trim() || undefined,
          vehicle: dbVehicle.trim() || undefined,
          messhall: dbMesshall.trim() || undefined,
          active: dbActive,
        }
      };
      if (dbEndpoint.trim()) body.endpointBaseUrl = dbEndpoint.trim();
      if (dbServer.trim()) body.dbServer = dbServer.trim();
      if (dbName.trim()) body.dbName = dbName.trim();
      if (dbUser.trim()) body.dbUser = dbUser.trim();
      if (dbPass.trim()) body.dbPass = dbPass.trim();
      if (dbPort.trim()) body.dbPort = dbPort.trim();
      const res = await fetch('/api/vault/update-card-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ok = !!data.success;
      toast({
        title: ok ? 'UpdateCard (DB) success' : 'UpdateCard (DB) failed',
        description: (() => {
          const code = data.code ?? '-';
          const msg = (data.message ?? '').trim() || (ok ? 'OK' : 'Failed');
          return `Card ${dbCardNo.trim()}: ${msg} (code ${code})`;
        })(),
        variant: ok ? undefined : 'destructive',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Update from DB failed', description: message, variant: 'destructive' });
    } finally {
      setDbUpdating(false);
    }
  };

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
      toast({ title: 'UpdateCard preview ready', description: `Found ${summary.attempted} rows.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Preview UpdateCard CSV failed', description: message, variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  };

  const handleExecuteUpdate = async () => {
    if (!previewSummary) return;
    try {
      setRegistering(true);
      setRegSummary(null);
      const overrides = (previewSummary.details || []).map((d, idx) => {
        const cardNo = (cardNoEdits[idx] ?? d.cardNo ?? '').trim().slice(0, 10);
        const defaultDownloadStr = String(d.profile?.DownloadCard ?? 'true');
        const defaultDownload = defaultDownloadStr.toLowerCase() === 'true';
        const downloadCard = (downloadCardEdits[idx] ?? defaultDownload);
        return { index: idx, cardNo, downloadCard };
      });
      const res = await fetch(`/api/vault/update-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvPath: uploadedUpdatePath, overrides })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Update failed');
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
      toast({ title: 'Update completed', description: `Updated ${summary.registered}/${summary.attempted} cards.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  const handleExecuteRow = async (index: number) => {
    if (!previewSummary || uploadedUpdatePath === '') return;
    const d = previewSummary.details[index];
    const effectiveCardNo = (cardNoEdits[index] ?? d.cardNo ?? '').trim().slice(0, 10);
    const defaultDownloadStr = String((d.profile?.Download ?? d.profile?.DownloadCard ?? 'true'));
    const defaultDownload = defaultDownloadStr.toLowerCase() === 'true';
    const effectiveDownload = (downloadCardEdits[index] ?? defaultDownload);
    if (!effectiveCardNo) {
      toast({ title: 'Card No required', description: `Row ${index + 1} is missing Card No. Please fill before executing.`, variant: 'destructive' });
      return;
    }
    try {
      setRowExecuting(prev => ({ ...prev, [index]: true }));
      setRowStatusMap(prev => ({ ...prev, [index]: { state: 'executing' } }));
      const res = await fetch(`/api/vault/update-csv-row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvPath: uploadedUpdatePath,
          index,
          override: { cardNo: effectiveCardNo, downloadCard: effectiveDownload }
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ok: boolean = !!data.success;
      const rs = data.rowStatus || {};
      const detail = Array.isArray(data.details) ? data.details[0] : undefined;
      const resolvedCode = rs.code ?? detail?.respCode ?? '-';
      const normalize = (val: unknown) => {
        const t = typeof val === 'string' ? val.trim() : '';
        if (!t) return '';
        if (t === '-' || /^unknown error$/i.test(t)) return '';
        return t;
      };
      const extractErrMessage = (s?: string) => {
        if (!s) return '';
        const m = s.match(/<ErrMessage>([\s\S]*?)<\/ErrMessage>/i);
        return m && m[1] ? m[1].trim() : '';
      };
      const resolvedMessage = (() => {
        const m1 = normalize(rs.message);
        if (m1) return m1;
        const m2 = normalize(detail?.respMessage);
        if (m2) return m2;
        const m3 = normalize(Array.isArray(data.errors) && data.errors[0]?.message ? String(data.errors[0].message) : '');
        if (m3) return m3;
        const m4 = extractErrMessage(rs.rawSnippet);
        if (m4) return m4;
        return ok ? 'OK' : 'Failed';
      })();
      // Debug: surface the full payload for this row to the console for easier diagnosis
      try {
        console.debug('update-csv-row response', { index, requestId: data.requestId, rs, detail, errors: data.errors });
      } catch (e) {
        // Ensure eslint no-empty doesn't trigger and still keep this non-critical
        console.warn('update-csv-row debug output failed', e);
      }
      setRowStatusMap(prev => ({
        ...prev,
        [index]: {
          state: ok ? 'success' : 'failed',
          code: resolvedCode,
          message: resolvedMessage,
          requestId: data.requestId,
        }
      }));
      toast({
        title: ok ? 'Row executed' : 'Row executed with errors',
        description: (() => {
          const code = resolvedCode;
          const msg = resolvedMessage;
          const cn = detail?.cardNo || effectiveCardNo || '-';
          return `Card ${cn}: ${msg} (code ${code})`;
        })(),
        variant: ok ? undefined : 'destructive',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Execute row failed', description: message, variant: 'destructive' });
      setRowStatusMap(prev => ({ ...prev, [index]: { state: 'failed', message } }));
    } finally {
      setRowExecuting(prev => ({ ...prev, [index]: false }));
    }
  };

  const handleCheckPhotos = async () => {
    if (!previewSummary) return;
    try {
      const rows = previewSummary.details.slice(0, 100).map((d, idx) => ({ index: idx, cardNo: (cardNoEdits[idx] ?? d.cardNo ?? '').trim(), staffNo: (d.staffNo ?? '').trim() }));
      const res = await fetch('/api/vault/photo-check-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvPath: uploadedUpdatePath, rows })
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

  return (
    <AppLayout title="Update Vault Card">
      <div className="space-y-6">
        <p className="text-muted-foreground text-sm">
          Update existing Vault cards by uploading an Excel/CSV file following the UpdateCard schema. You can preview rows, edit Card No and DownloadCard, re-check photos, and execute updates.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Update Existing Cards (CSV/Excel)</CardTitle>
            <CardDescription>Upload an Excel/CSV with UpdateCard fields, or use a server file path.</CardDescription>
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

        <Card>
          <CardHeader>
            <CardTitle>Update Single Card from Database</CardTitle>
            <CardDescription>Fetch card profile from DataDBEnt.carddb and update to Vault with optional overrides.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Card No</label>
                <Input placeholder="e.g. 1231231231" value={dbCardNo} onChange={(e) => setDbCardNo(e.target.value)} maxLength={10} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Vault Endpoint (optional)</label>
                <Input placeholder="http://10.60.10.6/Vaultsite/APIwebservice.asmx" value={dbEndpoint} onChange={(e) => setDbEndpoint(e.target.value)} />
              </div>
            </div>

            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Access Level</label>
                <Input placeholder="e.g. 01" value={dbAccessLevel} onChange={(e) => setDbAccessLevel(e.target.value)} maxLength={2} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Face Access Level</label>
                <Input placeholder="e.g. 00" value={dbFaceLevel} onChange={(e) => setDbFaceLevel(e.target.value)} maxLength={2} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Lift Access Level</label>
                <Input placeholder="e.g. 00" value={dbLiftLevel} onChange={(e) => setDbLiftLevel(e.target.value)} maxLength={2} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <Input value={dbDepartment} onChange={(e) => setDbDepartment(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input value={dbTitle} onChange={(e) => setDbTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Position</label>
                <Input value={dbPosition} onChange={(e) => setDbPosition(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Gender</label>
                <Input placeholder="MALE/FEMALE" value={dbGender} onChange={(e) => setDbGender(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Date of Birth</label>
                <Input placeholder="e.g. 4 Apr 1997" value={dbDob} onChange={(e) => setDbDob(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Race</label>
                <Input placeholder="e.g. WNI" value={dbRace} onChange={(e) => setDbRace(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Vehicle No</label>
                <Input placeholder="e.g. B 1234 XYZ" value={dbVehicle} onChange={(e) => setDbVehicle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mess Hall (maps to VehicleNo)</label>
                <Input placeholder="e.g. Makarti MessHall" value={dbMesshall} onChange={(e) => setDbMesshall(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Active</label>
                <div className="flex items-center gap-2">
                  <Switch checked={dbActive} onCheckedChange={(checked) => setDbActive(!!checked)} />
                  <span className="text-xs text-muted-foreground">{dbActive ? 'TRUE' : 'FALSE'}</span>
                </div>
              </div>
            </div>

            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">DB Server (optional)</label>
                <Input placeholder={"e.g. 10.60.10.6"} value={dbServer} onChange={(e) => setDbServer(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">DB Name (optional)</label>
                <Input placeholder={"DataDBEnt"} value={dbName} onChange={(e) => setDbName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">DB User (optional)</label>
                <Input value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">DB Password (optional)</label>
                <Input type="password" value={dbPass} onChange={(e) => setDbPass(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">DB Port (optional)</label>
                <Input placeholder="1433" value={dbPort} onChange={(e) => setDbPort(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleUpdateFromDb} disabled={dbUpdating || !dbCardNo.trim()}>
                {dbUpdating ? 'Updating…' : 'Update from DB'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {previewSummary && (
          <Card>
            <CardHeader>
              <CardTitle>Preview Cards to Update</CardTitle>
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
                      <th className="py-2 pr-4">Exec Status</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewSummary.details.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-3 text-muted-foreground">No rows found in file</td>
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
                            {(() => {
                              const st = rowStatusMap[idx]?.state ?? 'idle';
                              const code = rowStatusMap[idx]?.code ?? '-';
                              const message = rowStatusMap[idx]?.message;
                              const color = st === 'success' ? 'text-green-600' : st === 'failed' ? 'text-red-600' : st === 'executing' ? 'text-blue-600' : 'text-muted-foreground';
                              return (
                                <div className={`text-xs ${color} max-w-xs whitespace-normal break-words`}> 
                                  {st === 'idle' && 'Idle'}
                                  {st === 'executing' && 'Executing…'}
                                  {st === 'success' && `Success (code ${code})`}
                                  {st === 'failed' && `Failed${message ? `: ${message}` : ''} (code ${code})`}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setSelectedDetail(d); setDetailOpen(true); }}
                              >
                                View details
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleExecuteRow(idx)}
                                disabled={registering || rowExecuting[idx] || !uploadedUpdatePath || !((cardNoEdits[idx] ?? d.cardNo ?? '').trim())}
                              >
                                {rowExecuting[idx] ? 'Executing…' : 'Execute row'}
                              </Button>
                            </div>
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
                      <Button onClick={handleExecuteUpdate} disabled={registering || missing > 0 || !uploadedUpdatePath}>
                        {registering ? 'Executing...' : 'Execute update'}
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
                    {['CardNo','Name','Department','Company','AccessLevel','FaceAccessLevel','Email','MobileNo','ActiveStatus','NonExpired','ExpiredDate','DownloadCard','VehicleNo','Title','Position'].map((k) => {
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
              <CardTitle>Update Summary</CardTitle>
              <CardDescription>
                Attempted {regSummary.attempted}, Updated {regSummary.registered}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 rounded border">
                  <div className="text-muted-foreground">Attempted</div>
                  <div className="font-medium">{regSummary.attempted}</div>
                </div>
                <div className="p-3 rounded border">
                  <div className="text-muted-foreground">Updated</div>
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
      </div>
    </AppLayout>
  );
};

export default UpdateVaultCard;