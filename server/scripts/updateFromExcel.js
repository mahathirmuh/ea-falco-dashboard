#!/usr/bin/env node
// Simple script to update Vault users based on an Excel file until success.
// Usage: node server/scripts/updateFromExcel.js [path_to_excel] [endpoint]
// Defaults:
//  - path_to_excel: ../../scripts/UpdateCardTemplate.xlsx (relative to this script)
//  - endpoint: process.env.VAULT_API_BASE or http://10.60.10.6/Vaultsite/APIwebservice.asmx

const path = require('path');
const fs = require('fs');
const sql = require('mssql');

// Try to load server .env if present
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {}

const registrar = require('../src/vaultRegistrar');
const database = require('../src/database');

async function main() {
  const argv = process.argv.slice(2);
  // Build non-flag args robustly by skipping flag values
  const skipIdx = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (String(a).startsWith('--')) {
      skipIdx.add(i);
      if (!a.includes('=')) {
        // skip next token as value
        if (i + 1 < argv.length) skipIdx.add(i + 1);
      }
    }
  }
  const nonFlagArgs = argv.filter((a, idx) => !String(a).startsWith('--') && !skipIdx.has(idx));
  const argPath = nonFlagArgs[0];
  const argEndpoint = nonFlagArgs[1];
  const cardArgRaw = argv.find(a => String(a).startsWith('--card'));
  const cardArg = cardArgRaw ? (cardArgRaw.includes('=') ? cardArgRaw.split('=')[1] : argv[argv.indexOf(cardArgRaw) + 1]) : undefined;
  const dbFlag = argv.some(a => a === '--db' || a === '--from-db');
  // DB overrides
  const getFlagVal = (name) => {
    const raw = argv.find(a => a === name || a.startsWith(name + '='));
    if (!raw) return undefined;
    if (raw.includes('=')) return raw.split('=')[1];
    const idx = argv.indexOf(raw);
    return argv[idx + 1];
  };
  const dbNameOverride = getFlagVal('--db-name');
  const dbServerOverride = getFlagVal('--db-server');
  const dbUserOverride = getFlagVal('--db-user');
  const dbPassOverride = getFlagVal('--db-pass');
  const dbPortOverride = getFlagVal('--db-port');
  const accessLevelOverride = getFlagVal('--access-level');
  // Additional field overrides
  const faceLevelOverride = getFlagVal('--face-level');
  const liftLevelOverride = getFlagVal('--lift-level');
  const departmentOverride = getFlagVal('--department');
  const titleOverride = getFlagVal('--title');
  const positionOverride = getFlagVal('--position');
  const genderOverride = getFlagVal('--gender');
  const passportOverride = getFlagVal('--passport');
  const nricOverride = getFlagVal('--nric');
  const dobOverride = getFlagVal('--dob');
  const addressOverride = getFlagVal('--address');
  const phoneOverride = getFlagVal('--phone');
  const joinDateOverride = getFlagVal('--join-date');
  const raceOverride = getFlagVal('--race');
  const vehicleOverride = getFlagVal('--vehicle');
  const activeOverride = getFlagVal('--active') || getFlagVal('--card-status');
  const messhallOverride = getFlagVal('--messhall');
  const defaultExcel = path.join(__dirname, '..', '..', 'scripts', 'UpdateCardTemplate.xlsx');
  const isFilePath = argPath && (/[\\\/]/.test(argPath) || /\.(xlsx|csv)$/i.test(argPath));
  const csvPath = isFilePath ? path.resolve(argPath) : defaultExcel;
  const endpoint = argEndpoint || process.env.VAULT_API_BASE || 'http://10.60.10.6/Vaultsite/APIwebservice.asmx';

  if (!dbFlag) {
    if (!fs.existsSync(csvPath)) {
      console.error(`Excel file not found: ${csvPath}`);
      process.exit(1);
    }
  }

  if (!dbFlag) console.log(`[UpdateFromExcel] Starting update from: ${csvPath}`);
  console.log(`[UpdateFromExcel] Endpoint: ${endpoint}`);

  // If a specific card number is provided, update only that row
  if (cardArg && String(cardArg).trim()) {
    const cardNo = String(cardArg).trim();
    console.log(`[UpdateFromExcel] Single-card mode: cardNo=${cardNo}`);
    if (dbFlag) {
      // Fetch from SQL Server carddb table
      try {
        const dbConfig = {
          user: dbUserOverride || process.env.DATADB_USER,
          password: dbPassOverride || process.env.DATADB_PASSWORD,
          server: dbServerOverride || process.env.DATADB_SERVER,
          database: dbNameOverride || process.env.DATADB_NAME,
          port: Number(dbPortOverride || process.env.DATADB_PORT || 1433),
          options: { encrypt: false, trustServerCertificate: true }
        };
        console.log(`[UpdateFromExcel] Connecting to SQL Server ${dbConfig.server}, DB=${dbConfig.database} ...`);
        await sql.connect(dbConfig);
        const req = new sql.Request();
        req.input('cardNo', sql.VarChar, cardNo);
        const res = await req.query('SELECT TOP 1 * FROM [carddb] WHERE CardNo = @cardNo');
        const row = res && res.recordset && res.recordset[0];
        if (!row) {
          console.error(`[UpdateFromExcel] Card not found in carddb: ${cardNo}`);
          process.exit(1);
        }
        console.log(`[UpdateFromExcel] Found card in carddb: ${cardNo}`);
        const profile = buildProfileFromDbRow(row);
        if (accessLevelOverride) {
          profile.AccessLevel = String(accessLevelOverride).trim();
        }
        // Apply additional overrides from CLI (DB mode)
        if (faceLevelOverride) profile.FaceAccessLevel = String(faceLevelOverride).trim();
        if (liftLevelOverride) profile.LiftAccessLevel = String(liftLevelOverride).trim();
        if (departmentOverride) profile.Department = String(departmentOverride).trim().slice(0, 30);
        if (titleOverride) profile.Title = String(titleOverride).trim().slice(0, 25);
        if (positionOverride) profile.Position = String(positionOverride).trim().slice(0, 25);
        if (genderOverride) profile.Gentle = String(genderOverride).trim();
        if (passportOverride) profile.Passport = String(passportOverride).trim();
        if (nricOverride) profile.NRIC = String(nricOverride).trim();
        if (dobOverride) profile.DOB = String(dobOverride).trim();
        if (addressOverride) profile.Address1 = String(addressOverride).trim().slice(0, 50);
        if (phoneOverride) profile.MobileNo = String(phoneOverride).trim().slice(0, 20);
        if (joinDateOverride) profile.JoiningDate = String(joinDateOverride).trim();
        if (raceOverride) profile.Race = String(raceOverride).trim();
        if (vehicleOverride) profile.VehicleNo = String(vehicleOverride).trim().slice(0, 20);
        if (typeof activeOverride !== 'undefined' && activeOverride !== null) {
          const val = String(activeOverride).trim().toLowerCase();
          profile.ActiveStatus = (val === 'true' || val === '1' || val === 'active' || val === 'permanent') ? 'true' : 'false';
        }
        if (messhallOverride) {
          const mv = String(messhallOverride).trim().toLowerCase();
          if (mv.includes('makarti')) profile.VehicleNo = 'Makarti';
          else if (mv.includes('labota')) profile.VehicleNo = 'Labota';
          else profile.VehicleNo = String(messhallOverride).trim().slice(0, 20);
        }
        // Heuristic VehicleNo shortening
        if (profile.VehicleNo) {
          const v = String(profile.VehicleNo).toLowerCase();
          if (v.includes('makarti')) profile.VehicleNo = 'Makarti';
          else if (v.includes('labota')) profile.VehicleNo = 'Labota';
          else if (v.includes('local') || v.includes('no access')) profile.VehicleNo = 'NoAccess';
        }
        const single = await registrar.updateProfileToVault({ profile, endpointBaseUrl: endpoint, outputDir: path.join(__dirname, '..', '..', 'scripts') });
        if (single && single.ok) {
          console.log(`[UpdateFromExcel] SUCCESS: cardNo=${cardNo}`);
          process.exit(0);
        } else {
          const msg = (single && single.message) || 'Unknown error';
          console.error(`[UpdateFromExcel] FAILED: cardNo=${cardNo} message=${String(msg).trim()}`);
          process.exit(2);
        }
      } catch (err) {
        console.error('[UpdateFromExcel] DB error:', err.message || err);
        process.exit(1);
      } finally {
        try { await sql.close(); } catch {}
      }
  } else {
      const preview = registrar.previewUpdateCsvPathToVault({ csvPath });
      const idx = (preview.details || []).findIndex(d => String(d.cardNo) === cardNo);
      if (idx < 0) {
        console.error(`[UpdateFromExcel] Card not found in Excel: ${cardNo}`);
        process.exit(1);
      }
      const MAX = {
        Name: 50, Department: 50, Company: 50, Title: 50, Position: 50,
        Address1: 50, Address2: 50, Email: 50, MobileNo: 20,
        VehicleNo: 15, StaffNo: 15,
      };
      const detail = preview.details[idx];
      const profile = detail && detail.profile ? detail.profile : {};
      const override = {};
      for (const key of Object.keys(MAX)) {
        if (profile[key]) {
          override[key] = String(profile[key]).substring(0, MAX[key]);
        }
      }
      // Normalize date fields if Excel provided serial numbers
      const normalizeExcelDate = (val) => {
        if (val === null || typeof val === 'undefined') return undefined;
        const s = String(val).trim();
        if (!s) return undefined;
        // numeric serial -> convert
        if (/^\d+(\.\d+)?$/.test(s)) {
          const serial = parseFloat(s);
          // Excel (Windows) 1900 date system: days since 1899-12-30; Unix epoch is 25569 days after
          const ms = (serial - 25569) * 86400 * 1000;
          const d = new Date(ms);
          if (!isNaN(d.getTime())) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const day = d.getUTCDate();
            const mon = months[d.getUTCMonth()];
            const year = d.getUTCFullYear();
            return `${day} ${mon} ${year}`;
          }
        }
        // If already a date-like string, return as-is
        return s;
      };
      // Apply normalized dates
      if (typeof profile.DOB !== 'undefined') {
        const n = normalizeExcelDate(profile.DOB);
        if (n) override.DOB = n;
      }
      if (typeof profile.JoiningDate !== 'undefined') {
        const n = normalizeExcelDate(profile.JoiningDate);
        if (n) override.JoiningDate = n;
      }
      if (typeof profile.ResignDate !== 'undefined') {
        const n = normalizeExcelDate(profile.ResignDate);
        if (n) override.ResignDate = n;
      }
      if (typeof profile.ExpiredDate !== 'undefined') {
        const n = normalizeExcelDate(profile.ExpiredDate);
        if (n) override.ExpiredDate = n;
      }
      if (profile.VehicleNo) {
        const v = String(profile.VehicleNo).toLowerCase();
        if (v.includes('makarti')) override.VehicleNo = 'Makarti';
        else if (v.includes('labota')) override.VehicleNo = 'Labota';
        else if (v.includes('local') || v.includes('no access')) override.VehicleNo = 'NoAccess';
      }
      if (typeof profile.Download !== 'undefined') override.Download = profile.Download;
      if (accessLevelOverride) override.AccessLevel = String(accessLevelOverride).trim();
      // Apply additional overrides from CLI (Excel mode)
      if (faceLevelOverride) override.FaceAccessLevel = String(faceLevelOverride).trim();
      if (liftLevelOverride) override.LiftAccessLevel = String(liftLevelOverride).trim();
      if (departmentOverride) override.Department = String(departmentOverride).trim().slice(0, MAX.Department);
      if (titleOverride) override.Title = String(titleOverride).trim().slice(0, MAX.Title);
      if (positionOverride) override.Position = String(positionOverride).trim().slice(0, MAX.Position);
      if (genderOverride) override.Gentle = String(genderOverride).trim();
      if (passportOverride) override.Passport = String(passportOverride).trim();
      if (nricOverride) override.NRIC = String(nricOverride).trim();
      if (dobOverride) override.DOB = String(dobOverride).trim();
      if (addressOverride) override.Address1 = String(addressOverride).trim().slice(0, MAX.Address1);
      if (phoneOverride) override.MobileNo = String(phoneOverride).trim().slice(0, MAX.MobileNo);
      if (joinDateOverride) override.JoiningDate = String(joinDateOverride).trim();
      if (raceOverride) override.Race = String(raceOverride).trim();
      if (vehicleOverride) override.VehicleNo = String(vehicleOverride).trim().slice(0, MAX.VehicleNo);
      if (typeof activeOverride !== 'undefined' && activeOverride !== null) {
        const val = String(activeOverride).trim().toLowerCase();
        override.ActiveStatus = (val === 'true' || val === '1' || val === 'active' || val === 'permanent') ? 'true' : 'false';
      }
      if (messhallOverride) {
        const mv = String(messhallOverride).trim().toLowerCase();
        if (mv.includes('makarti')) override.VehicleNo = 'Makarti';
        else if (mv.includes('labota')) override.VehicleNo = 'Labota';
        else override.VehicleNo = String(messhallOverride).trim().slice(0, MAX.VehicleNo);
      }
      // Final safety: clip VehicleNo for Vault constraints to <= 15 chars
      if (override.VehicleNo) override.VehicleNo = String(override.VehicleNo).slice(0, 15);
      const single = await registrar.updateCsvRowToVault({ csvPath, index: idx, endpointBaseUrl: endpoint, override });
      const ok = single && single.rowStatus && single.rowStatus.ok;
      if (ok) {
        console.log(`[UpdateFromExcel] SUCCESS: cardNo=${cardNo} (${single.rowStatus.durationMs || '-'}ms)`);
        process.exit(0);
      } else {
        const msg = (single && single.rowStatus && single.rowStatus.message) || (single && single.errors && single.errors[0] && single.errors[0].message) || 'Unknown error';
        console.error(`[UpdateFromExcel] FAILED: cardNo=${cardNo} message=${String(msg).trim()}`);
        process.exit(2);
      }
    }
  }

  // First pass: attempt to update all rows from the Excel (batch mode)
  const result = await registrar.updateCsvPathToVault({ csvPath, endpointBaseUrl: endpoint, overrides: [] });
  const errorsCount = Array.isArray(result.errors) ? result.errors.length : 0;
  console.log(`[UpdateFromExcel] Attempted=${result.attempted} Updated=${result.registered} WithPhoto=${result.withPhoto} WithoutPhoto=${result.withoutPhoto} Errors=${errorsCount}`);

  // If there are errors, show a brief summary and attempt auto-retry by trimming long fields
  if (errorsCount > 0) {
    console.log(`[UpdateFromExcel] Some rows failed. Printing first 10 errors:`);
    for (let i = 0; i < Math.min(10, result.errors.length); i++) {
      const e = result.errors[i] || {};
      console.log(`  - cardNo=${e.cardNo || '-'} code=${e.errCode || e.code || '-'} message=${(e.message || '').trim() || '-'}`);
    }
    // Attempt automatic retry for rows that failed due to truncation
    const MAX = {
      Name: 50,
      Department: 50,
      Company: 50,
      Title: 50,
      Position: 50,
      Address1: 50,
      Address2: 50,
      Email: 50,
      MobileNo: 20,
      VehicleNo: 50,
      StaffNo: 15,
    };
    const isTruncated = (msg) => String(msg || '').toLowerCase().includes('truncated');
    const preview = registrar.previewUpdateCsvPathToVault({ csvPath });
    const retryTargets = result.errors.filter(e => isTruncated(e.message));
    if (retryTargets.length > 0) {
      console.log(`[UpdateFromExcel] Auto-retry: trimming long fields for ${retryTargets.length} row(s) and retrying...`);
      let retryUpdated = 0;
      let retryErrors = [];
      for (const e of retryTargets) {
        const idx = e.index;
        const detail = preview.details[idx];
        const profile = detail && detail.profile ? detail.profile : {};
        const override = {};
        for (const key of Object.keys(MAX)) {
          if (profile[key]) {
            override[key] = String(profile[key]).substring(0, MAX[key]);
          }
        }
        // Preserve Download preference from original mapping
        if (typeof profile.Download !== 'undefined') {
          override.Download = profile.Download;
        }
        const single = await registrar.updateCsvRowToVault({ csvPath, index: idx, endpointBaseUrl: endpoint, override });
        if (single && single.rowStatus && single.rowStatus.ok) {
          retryUpdated += 1;
        } else {
          const msg = (single && single.rowStatus && single.rowStatus.message) || (single && single.error) || 'Unknown error';
          retryErrors.push({ index: idx, cardNo: e.cardNo, message: msg });
        }
      }
      console.log(`[UpdateFromExcel] Auto-retry result: Updated=${retryUpdated}, Errors=${retryErrors.length}`);
      if (retryErrors.length === 0) {
        console.log('[UpdateFromExcel] All rows updated successfully after auto-retry.');
        process.exit(0);
      } else {
        console.log('[UpdateFromExcel] Remaining errors after auto-retry:');
        for (const r of retryErrors) {
          console.log(`  - idx=${r.index} cardNo=${r.cardNo || '-'} message=${String(r.message).trim()}`);
        }
      }
    }
    console.log(`
Tips:
 - If you see 'String or binary data would be truncated', shorten the offending fields in the Excel (e.g., Name, Department, Company, Title, Position, Address).
 - Place photo files in the same folder as the Excel, named as CardNo.jpg/.jpeg/.png or StaffNo.jpg/.jpeg/.png for automatic attachment.
 - Re-run this script after fixing the data.`);
    process.exit(2);
  }

  console.log('[UpdateFromExcel] All rows updated successfully.');
}

main().catch(err => {
  console.error('[UpdateFromExcel] Fatal error:', err);
  process.exit(1);
});

function buildProfileFromDbRow(row) {
  const max = {
    Name: 40,
    Department: 30,
    Company: 30,
    Title: 25,
    Position: 25,
    Address1: 50,
    Address2: 50,
    Email: 50,
    MobileNo: 20,
    VehicleNo: 20,
    StaffNo: 15,
  };
  const clip = (v, m) => {
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    return s.length > m ? s.slice(0, m) : s;
  };
  return {
    CardNo: String(row.CardNo || row.cardno || row.CARDNO || '').trim(),
    Name: clip(row.Name || row.NAME, max.Name),
    Department: clip(row.Department || row.DEPT || row.DepartmentName, max.Department),
    Company: clip(row.Company || row.COMPANY, max.Company),
    Title: clip(row.Title || row.TITLE, max.Title),
    Position: clip(row.Position || row.POSITION, max.Position),
    Gentle: String(row.Gentle || row.Gender || row.SEX || '').trim(),
    NRIC: String(row.NRIC || row.IdNo || '').trim(),
    Passport: String(row.Passport || '').trim(),
    Race: String(row.Race || '').trim(),
    DOB: String(row.DOB || row.BirthDate || '').trim(),
    JoiningDate: String(row.JoiningDate || row.JoinDate || '').trim(),
    ResignDate: String(row.ResignDate || row.ExitDate || '').trim(),
    Address1: clip(row.Address1 || row.Address || '', max.Address1),
    Address2: clip(row.Address2 || '', max.Address2),
    Email: clip(row.Email || '', max.Email),
    MobileNo: clip(row.MobileNo || row.Phone || row.Contact || '', max.MobileNo),
    ActiveStatus: 'true',
    NonExpired: 'true',
    ExpiredDate: String(row.ExpiredDate || '').trim(),
    AccessLevel: String(row.AccessLevel || row.MESSHALL || row.Access || '00').trim(),
    FaceAccessLevel: String(row.FaceAccessLevel || '00').trim(),
    LiftAccessLevel: String(row.LiftAccessLevel || '00').trim(),
    VehicleNo: clip(row.VehicleNo || row.Vehicle || row.Remark || '', max.VehicleNo),
    Download: 'true',
    Photo: null,
    StaffNo: clip(row.StaffNo || row.StaffID || '', max.StaffNo),
  };
}