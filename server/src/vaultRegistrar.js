const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const XLSX = require('xlsx');
const crypto = require('crypto');
// SOAP configuration via environment (with safe defaults)
const SOAP_ACTION = process.env.VAULT_SOAP_ACTION || '';
const SOAP_NAMESPACE = process.env.VAULT_SOAP_NAMESPACE || 'http://tempuri.org/';
// Supported: '1.1' or '1.2'
const SOAP_VERSION = (process.env.VAULT_SOAP_VERSION || '1.1').trim();
// Defaults for access levels when source data leaves them blank (use Excel value if present, otherwise '00')
const DEFAULT_ACCESS_LEVEL = '00';
const DEFAULT_FACE_ACCESS_LEVEL = '00';
const DEFAULT_LIFT_ACCESS_LEVEL = '00';
// Default SOAP action for UpdateCard when env not set
const UPDATE_SOAP_ACTION = process.env.VAULT_UPDATE_SOAP_ACTION || 'WebAPI/UpdateCard';

/**
 * Utility: safe string trimming and defaulting
 */
function s(val, def = '') {
  if (val === undefined || val === null) return def;
  return String(val).trim();
}

// Logging helpers
function ts() { return new Date().toISOString(); }
function appendTextLog(outputDir, text) {
  try {
    const logPath = path.join(outputDir, 'vault-registration.log');
    fs.appendFileSync(logPath, `[${ts()}] ${text}\n`, { encoding: 'utf8' });
  } catch {}
}
// Write to file and mirror to backend terminal
function logInfo(outputDir, text) {
  appendTextLog(outputDir, text);
  try {
    console.log(`${ts()} - ${text}`);
  } catch {}
}
function appendJsonLog(outputDir, obj) {
  try {
    const jsonlPath = path.join(outputDir, 'vault-registration-log.jsonl');
    fs.appendFileSync(jsonlPath, JSON.stringify({ time: ts(), ...obj }) + '\n', { encoding: 'utf8' });
  } catch {}
}
// Dedicated logging for Update operations (batch and individual)
function appendUpdateTextLog(outputDir, text) {
  try {
    const logPath = path.join(outputDir, 'vault-update.log');
    fs.appendFileSync(logPath, `[${ts()}] ${text}\n`, { encoding: 'utf8' });
  } catch {}
}
function logUpdateInfo(outputDir, text) {
  appendUpdateTextLog(outputDir, text);
  try { console.log(`${ts()} - ${text}`); } catch {}
}
function appendUpdateJsonLog(outputDir, obj) {
  try {
    const jsonlPath = path.join(outputDir, 'vault-update-log.jsonl');
    fs.appendFileSync(jsonlPath, JSON.stringify({ time: ts(), ...obj }) + '\n', { encoding: 'utf8' });
  } catch {}
}
// Produce a short snippet suitable for console output
function consoleSnippet(text, limit = 600) {
  try {
    if (!text) return '';
    const compact = String(text).replace(/\s+/g, ' ').trim();
    if (compact.length <= limit) return compact;
    return compact.slice(0, limit) + ' … (truncated)';
  } catch { return ''; }
}
function redactEnvelope(envelope) {
  if (!envelope) return envelope;
  // Redact base64 photo content if present; keep empty Photo tags as-is
  return envelope.replace(/<Photo>([\s\S]*?)<\/Photo>/i, (match, inner) => {
    const content = (inner || '').trim();
    if (!content) return '<Photo></Photo>';
    return '<Photo>[redacted]</Photo>';
  });
}

/**
 * Map a row (from Excel/CSV) into the Vault AddCard payload fields.
 * This mapping is based on our current CSV schema and typical Excel columns.
 */
function mapRowToProfile(row) {
  // Try multiple potential column names to be robust across CSV/Excel variants
  const name = s(row['Card Name [Max 50]'] || row['Card Name'] || row['Name'] || row['Employee Name'] || row['Employee'] || row['Nama']);
  const staffNoRaw = s(row['Staff No [Max 15]'] || row['Staff No. [Max 10]'] || row['Emp. No'] || row['Employee ID'] || row['ID'] || row['NIK']);
  const cardNoRaw = s(row['Card No #[Max 10]'] || row['Card No [Max 10]'] || row['Card No'] || row['CardNo'] || row['Card Number']);
  const department = s(row['Department [Max 50]'] || row['Department'] || row['Departement'] || row['Dept']);
  const company = s(row['Company [Max 50]'] || row['Company'] || 'Merdeka Tsingsan Indonesia');
  const email = s(row['Email [Max 50]'] || row['Email'] || row['Email Address'] || '');
  const mobile = s(row['Mobile No. [Max 20]'] || row['Mobile No'] || row['Phone'] || '');
  let faceAccessLevel = s(row['Face Access Level [Max 3]'] || row['Face Access Level'] || row['FaceAccessLevel'] || '');
  if (!faceAccessLevel) faceAccessLevel = DEFAULT_FACE_ACCESS_LEVEL;
  // Lift Access Level: required by API, default to '00' if blank to avoid -1 errors
  let liftAccessLevel = s(row['Lift Access Level [Max 3]'] || row['Lift Access Level'] || row['LiftAccessLevel'] || '');
  if (!liftAccessLevel) liftAccessLevel = DEFAULT_LIFT_ACCESS_LEVEL;

  // Access Level logic: try explicit value; otherwise derive from MessHall per new rules
  // - Labota -> 1
  // - Makarti -> 2
  // - No Access!! or empty -> blank
  let accessLevel = s(row['Access Level [Max 3]'] || row['Access Level'] || row['AccessLevel']);
  const messHallRaw = s(row['MessHall'] || row['Mess Hall'] || '');
  const messHall = messHallRaw.toLowerCase().trim();
  if (!accessLevel) {
    if (messHall === 'labota') accessLevel = '1';
    else if (messHall === 'makarti') accessLevel = '2';
    else if (messHall === '' || messHall === 'no access!!') accessLevel = '';
    else accessLevel = '';
  }
  if (!accessLevel) accessLevel = DEFAULT_ACCESS_LEVEL;

  // CardNo must be max 10 characters. Do NOT fall back to Staff No — Staff No is employee ID, not card number.
  const cardNo = (cardNoRaw || '').substring(0, 10);

  return {
    CardNo: cardNo,
    StaffNo: staffNoRaw,
    Name: name,
    Department: department,
    Company: company,
    AccessLevel: accessLevel,
    FaceAccessLevel: faceAccessLevel,
    LiftAccessLevel: liftAccessLevel,
    Email: email,
    MobileNo: mobile,
    // Defaults
    ActiveStatus: 'true',
    NonExpired: 'true',
    ExpiredDate: '',
    Download: 'true',
    // Photo will be attached later if available
    Photo: null,
  };
}

/**
 * Build SOAP 1.1 envelope for AddCard
 */
function buildAddCardEnvelope(profile, { namespace = SOAP_NAMESPACE, soapVersion = SOAP_VERSION } = {}) {
  const soapEnvNs = soapVersion === '1.2' ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
  const photoTag = profile.Photo ? `<Photo>${escapeXml(profile.Photo)}</Photo>` : '<Photo></Photo>';
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="${soapEnvNs}">
  <soap:Body>
    <AddCard xmlns="${namespace}">
      <CardProfile>
        <CardNo>${escapeXml(profile.CardNo)}</CardNo>
        <Name>${escapeXml(profile.Name)}</Name>
        <CardPinNo>${escapeXml(profile.CardPinNo || '')}</CardPinNo>
        <CardType>${escapeXml(profile.CardType || '')}</CardType>
        <Department>${escapeXml(profile.Department)}</Department>
        <Company>${escapeXml(profile.Company)}</Company>
        <Gentle>${escapeXml(profile.Gentle || '')}</Gentle>
        <AccessLevel>${escapeXml(profile.AccessLevel)}</AccessLevel>
        <FaceAccessLevel>${escapeXml(profile.FaceAccessLevel)}</FaceAccessLevel>
        <LiftAccessLevel>${escapeXml(profile.LiftAccessLevel || '')}</LiftAccessLevel>
        <BypassAP>${escapeXml(profile.BypassAP || 'false')}</BypassAP>
        <ActiveStatus>${escapeXml(profile.ActiveStatus)}</ActiveStatus>
        <NonExpired>${escapeXml(profile.NonExpired)}</NonExpired>
        <ExpiredDate>${escapeXml(profile.ExpiredDate)}</ExpiredDate>
        <VehicleNo>${escapeXml(profile.VehicleNo || '')}</VehicleNo>
        <FloorNo>${escapeXml(profile.FloorNo || '')}</FloorNo>
        <UnitNo>${escapeXml(profile.UnitNo || '')}</UnitNo>
        <ParkingNo>${escapeXml(profile.ParkingNo || '')}</ParkingNo>
        <StaffNo>${escapeXml(profile.StaffNo || '')}</StaffNo>
        <Title>${escapeXml(profile.Title || '')}</Title>
        <Position>${escapeXml(profile.Position || '')}</Position>
        <NRIC>${escapeXml(profile.NRIC || '')}</NRIC>
        <Passport>${escapeXml(profile.Passport || '')}</Passport>
        <Race>${escapeXml(profile.Race || '')}</Race>
        <DOB>${escapeXml(profile.DOB || '')}</DOB>
        <JoiningDate>${escapeXml(profile.JoiningDate || '')}</JoiningDate>
        <ResignDate>${escapeXml(profile.ResignDate || '')}</ResignDate>
        <Address1>${escapeXml(profile.Address1 || '')}</Address1>
        <Address2>${escapeXml(profile.Address2 || '')}</Address2>
        <PostalCode>${escapeXml(profile.PostalCode || '')}</PostalCode>
        <City>${escapeXml(profile.City || '')}</City>
        <State>${escapeXml(profile.State || '')}</State>
        <Email>${escapeXml(profile.Email)}</Email>
        <MobileNo>${escapeXml(profile.MobileNo)}</MobileNo>
        ${photoTag}
        <Download>${escapeXml(profile.Download)}</Download>
      </CardProfile>
    </AddCard>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Post AddCard SOAP request and return parsed result
 */
async function postAddCard(endpointBaseUrl, envelope, { soapVersion = SOAP_VERSION, soapAction = SOAP_ACTION } = {}) {
  const url = `${endpointBaseUrl}`;
  const headers = (soapVersion === '1.2')
    ? (() => {
        let ct = 'application/soap+xml; charset=utf-8';
        if (soapAction && String(soapAction).trim()) {
          ct += `; action="${soapAction}"`;
        }
        return { 'Content-Type': ct };
      })()
    : {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction,
      };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: envelope,
  });
  const text = await res.text();
  // Attempt to parse a simple result code/message from the XML response
  const errCodeMatch = text.match(/<ErrCode>(.*?)<\/ErrCode>/);
  const errMessageMatch = text.match(/<ErrMessage>(.*?)<\/ErrMessage>/);
  const cardIdMatch = text.match(/<CardID>(.*?)<\/CardID>/) || text.match(/<ID>(.*?)<\/ID>/);
  return {
    status: res.ok ? 'ok' : 'error',
    httpStatus: res.status,
    errCode: errCodeMatch ? errCodeMatch[1] : undefined,
    errMessage: errMessageMatch ? errMessageMatch[1] : undefined,
    cardId: cardIdMatch ? cardIdMatch[1] : undefined,
    raw: text,
  };
}

/**
 * Build SOAP 1.1 envelope for UpdateCard
 * Reference: APIWebService UpdateCard CardProfile fields
 */
function buildUpdateCardEnvelope(profile, { namespace = SOAP_NAMESPACE, soapVersion = SOAP_VERSION } = {}) {
  const soapEnvNs = soapVersion === '1.2' ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
  const photoTag = profile.Photo ? `<Photo>${escapeXml(profile.Photo)}</Photo>` : '<Photo></Photo>';
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="${soapEnvNs}">
  <soap:Body>
    <UpdateCard xmlns="${namespace}">
      <CardNo>${escapeXml(profile.CardNo)}</CardNo>
      <CardProfile>
        <CardNo>${escapeXml(profile.CardNo)}</CardNo>
        <Name>${escapeXml(profile.Name || '')}</Name>
        <CardPinNo>${escapeXml(profile.CardPinNo || '')}</CardPinNo>
        <CardType>${escapeXml(profile.CardType || '')}</CardType>
        <Department>${escapeXml(profile.Department || '')}</Department>
        <Company>${escapeXml(profile.Company || '')}</Company>
        <Gentle>${escapeXml(profile.Gentle || '')}</Gentle>
        <AccessLevel>${escapeXml(profile.AccessLevel || '')}</AccessLevel>
        <FaceAccessLevel>${escapeXml(profile.FaceAccessLevel || '')}</FaceAccessLevel>
        <LiftAccessLevel>${escapeXml(profile.LiftAccessLevel || '')}</LiftAccessLevel>
        <BypassAP>${escapeXml(profile.BypassAP || 'false')}</BypassAP>
        <ActiveStatus>${escapeXml(profile.ActiveStatus || 'true')}</ActiveStatus>
        <NonExpired>${escapeXml(profile.NonExpired || 'true')}</NonExpired>
        <ExpiredDate>${escapeXml(profile.ExpiredDate || '')}</ExpiredDate>
        <VehicleNo>${escapeXml(profile.VehicleNo || '')}</VehicleNo>
        <FloorNo>${escapeXml(profile.FloorNo || '')}</FloorNo>
        <UnitNo>${escapeXml(profile.UnitNo || '')}</UnitNo>
        <ParkingNo>${escapeXml(profile.ParkingNo || '')}</ParkingNo>
        <StaffNo>${escapeXml(profile.StaffNo || '')}</StaffNo>
        <Title>${escapeXml(profile.Title || '')}</Title>
        <Position>${escapeXml(profile.Position || '')}</Position>
        <NRIC>${escapeXml(profile.NRIC || '')}</NRIC>
        <Passport>${escapeXml(profile.Passport || '')}</Passport>
        <Race>${escapeXml(profile.Race || '')}</Race>
        <DOB>${escapeXml(profile.DOB || '')}</DOB>
        <JoiningDate>${escapeXml(profile.JoiningDate || '')}</JoiningDate>
        <ResignDate>${escapeXml(profile.ResignDate || '')}</ResignDate>
        <Address1>${escapeXml(profile.Address1 || '')}</Address1>
        <Address2>${escapeXml(profile.Address2 || '')}</Address2>
        <PostalCode>${escapeXml(profile.PostalCode || '')}</PostalCode>
        <City>${escapeXml(profile.City || '')}</City>
        <State>${escapeXml(profile.State || '')}</State>
        <Email>${escapeXml(profile.Email || '')}</Email>
        <MobileNo>${escapeXml(profile.MobileNo || '')}</MobileNo>
        ${photoTag}
        <Download>${escapeXml(profile.Download || 'true')}</Download>
      </CardProfile>
    </UpdateCard>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * Post UpdateCard SOAP request and return parsed result
 */
async function postUpdateCard(endpointBaseUrl, envelope, { soapVersion = SOAP_VERSION, soapAction = UPDATE_SOAP_ACTION } = {}) {
  const url = `${endpointBaseUrl}`;
  const headers = (soapVersion === '1.2')
    ? (() => {
        let ct = 'application/soap+xml; charset=utf-8';
        if (soapAction && String(soapAction).trim()) {
          ct += `; action="${soapAction}"`;
        }
        return { 'Content-Type': ct };
      })()
    : {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction,
      };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: envelope,
  });
  const text = await res.text();
  // Use dotall ([\s\S]) and case-insensitive to robustly extract values across newlines
  const errCodeMatch = text.match(/<ErrCode>([\s\S]*?)<\/ErrCode>/i);
  const errMessageMatch = text.match(/<ErrMessage>([\s\S]*?)<\/ErrMessage>/i);
  const mediaIdMatch = text.match(/<MediaID>([\s\S]*?)<\/MediaID>/i);
  const errCode = errCodeMatch ? String(errCodeMatch[1]).trim() : undefined;
  const errMessage = errMessageMatch ? String(errMessageMatch[1]).trim() : undefined;
  return {
    status: res.ok ? 'ok' : 'error',
    httpStatus: res.status,
    errCode,
    errMessage,
    mediaId: mediaIdMatch ? String(mediaIdMatch[1]).trim() : undefined,
    raw: text,
  };
}

/**
 * Given an output directory for a job, detect available data sources and build registration profiles
 */
function collectProfilesFromOutputDir(outputDir) {
  // Prefer Excel "For_Machine_...xlsx"; fallback to CSV "CardDatafileformat_...csv"
  const files = fse.readdirSync(outputDir);
  const excelFile = files.find(f => /For_Machine_.*\.xlsx$/i.test(f));
  const csvFile = files.find(f => /CardDatafileformat_.*\.csv$/i.test(f));
  let rows = [];
  if (excelFile) {
    const wb = XLSX.readFile(path.join(outputDir, excelFile));
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } else if (csvFile) {
    const wb = XLSX.readFile(path.join(outputDir, csvFile));
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  // Map rows to profiles
  const profiles = rows.map(mapRowToProfile);
  return profiles;
}

// Read rows directly from a specific CSV file path
function readRowsFromCsvPath(csvPath) {
  try {
    const wb = XLSX.readFile(csvPath);
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return rows;
  } catch (err) {
    return [];
  }
}

// Map UpdateCard fields from a generic row source (CSV/Excel)
function mapRowToUpdateProfile(row) {
  // Max lengths aligned with Vault DB constraints to avoid truncation errors
  const MAX = { Name: 40, Department: 30, Company: 30, Title: 25, Position: 25, Address1: 50, Email: 50, MobileNo: 20, VehicleNo: 15, StaffNo: 15 };
  const clip = (v, m) => { if (v === undefined || v === null) return ''; const sVal = String(v).trim(); return m && sVal.length > m ? sVal.slice(0, m) : sVal; };
  const normalizeExcelDate = (val) => {
    if (val === null || typeof val === 'undefined') return '';
    const sVal = String(val).trim();
    if (!sVal) return '';
    // Excel serial (e.g., 35524) -> human-readable
    if (/^\d+(\.\d+)?$/.test(sVal)) {
      const serial = parseFloat(sVal);
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
    return sVal;
  };

  const cardNo = s(row['CARD NO'] || row['Card No'] || row['CardNo'] || row['Card Number']).substring(0,10);
  const name = clip(s(row['NAME'] || row['Name'] || row['Card Name'] || row['Employee Name']), MAX.Name);
  const company = clip(s(row['COMPANY'] || row['Company']), MAX.Company);
  const staffNo = clip(s(row['STAFF ID'] || row['Staff No'] || row['Employee ID'] || row['ID']), MAX.StaffNo);
  const department = clip(s(row['DEPARTMENT'] || row['Department']), MAX.Department);
  const title = clip(s(row['TITLE'] || row['Title']), MAX.Title);
  const position = clip(s(row['POSITION'] || row['Position']), MAX.Position);
  const gentle = s(row['GENDER'] || row['Gender'] || row['Gentle']);
  const ktpPassport = s(row['KTP/PASPORT NO'] || row['KTP/PASSPORT NO'] || row['NRIC/Passport']);
  const dob = normalizeExcelDate(s(row['DATE OF BIRTH'] || row['DOB']));
  const address = clip(s(row['ADDRESS'] || row['Address']), MAX.Address1);
  const mobile = clip(s(row['PHONE NO'] || row['Mobile No'] || row['Phone']), MAX.MobileNo);
  const joining = normalizeExcelDate(s(row['DATE OF HIRE'] || row['Joining Date']));
  const resign = normalizeExcelDate(s(row['WORK PERIOD END'] || row['Resign Date']));
  const race = s(row['RACE'] || row['Race']);
  const cardStatus = s(row['CARD STATUS'] || row['Status'] || row['STATUS']).toLowerCase();
  const activeStatus = cardStatus ? (cardStatus.includes('active') ? 'true' : (cardStatus.includes('inactive') ? 'false' : 'true')) : 'true';

  // VehicleNo: use explicit column if provided, otherwise derive from MessHall per previous implementation
  const vehicleNoExplicit = s(row['VEHICLE NO'] || row['Vehicle No'] || row['VehicleNo']);
  let vehicleNo = vehicleNoExplicit;
  let accessLevel = '';
  const messRaw = s(row['MESSHALL'] || row['MessHall'] || row['Mess Hall']);
  if (!vehicleNo) {
    const mess = messRaw.toLowerCase();
    if (mess.includes('makarti')) vehicleNo = 'Makarti MessHall';
    else if (mess.includes('labota')) vehicleNo = 'Labota Messhall';
    else vehicleNo = 'Local Hire / No Access!!';

    // Derive AccessLevel based on MessHall mapping: 00=No Access/Local Hire, 01=Labota, 10=Makarti, 11=Both
    const messDigits = messRaw.replace(/[^01]/g, '');
    if (messDigits === '00' || messRaw.toLowerCase().includes('no access') || messRaw.toLowerCase().includes('local hire')) accessLevel = '00';
    else if (messDigits === '01' || messRaw.toLowerCase().includes('labota')) accessLevel = '01';
    else if (messDigits === '10' || messRaw.toLowerCase().includes('makarti')) accessLevel = '10';
    else if (messDigits === '11' || (messRaw.toLowerCase().includes('makarti') && messRaw.toLowerCase().includes('labota'))) accessLevel = '11';
  } else {
    // If VehicleNo explicitly provided, optionally set AccessLevel if MESSHALL digits present
    const messDigits = messRaw.replace(/[^01]/g, '');
    if (messDigits === '00') accessLevel = '00';
    else if (messDigits === '01') accessLevel = '01';
    else if (messDigits === '10') accessLevel = '10';
    else if (messDigits === '11') accessLevel = '11';
  }

  // If AccessLevel still blank, attempt to use explicit provided column
  const accessLevelExplicit = s(row['ACCESS LEVEL'] || row['Access Level'] || row['AccessLevel']);
  if (!accessLevel && accessLevelExplicit) accessLevel = accessLevelExplicit;

  // Final fallback: API requires non-blank AccessLevel. Default to configured DEFAULT_ACCESS_LEVEL.
  if (!accessLevel) accessLevel = DEFAULT_ACCESS_LEVEL;

  const faceAccessLevelExplicit = s(row['FACE ACCESS LEVEL'] || row['Face Access Level'] || row['FaceAccessLevel']);
  const liftAccessLevelExplicit = s(row['LIFT ACCESS LEVEL'] || row['Lift Access Level'] || row['LiftAccessLevel']);

  // Standardize VehicleNo and clip safely to 15 chars
  if (vehicleNo) {
    const v = String(vehicleNo).toLowerCase();
    if (v.includes('makarti')) vehicleNo = 'Makarti';
    else if (v.includes('labota')) vehicleNo = 'Labota';
    else if (v.includes('local') || v.includes('no access')) vehicleNo = 'NoAccess';
    vehicleNo = clip(vehicleNo, MAX.VehicleNo);
  }

  const profile = {
    CardNo: cardNo,
    Name: name,
    Company: company,
    Department: department,
    StaffNo: staffNo,
    Title: title,
    Position: position,
    Gentle: gentle,
    NRIC: ktpPassport, // Prefer NRIC for local ID; Passport can be filled if format indicates passport
    Passport: '',
    Race: race,
    DOB: dob,
    JoiningDate: joining,
    ResignDate: resign,
    Address1: address,
    Email: '',
    MobileNo: mobile,
    ActiveStatus: activeStatus,
    NonExpired: 'true',
    ExpiredDate: '',
    AccessLevel: accessLevel,
    FaceAccessLevel: faceAccessLevelExplicit || DEFAULT_FACE_ACCESS_LEVEL,
    LiftAccessLevel: liftAccessLevelExplicit || DEFAULT_LIFT_ACCESS_LEVEL,
    VehicleNo: vehicleNo,
    Download: 'true',
    Photo: null,
  };
  return profile;
}

// Read raw rows (objects) from output directory without mapping
function readRowsFromOutputDir(outputDir) {
  const files = fse.readdirSync(outputDir);
  const excelFile = files.find(f => /For_Machine_.*\.xlsx$/i.test(f));
  const csvFile = files.find(f => /CardDatafileformat_.*\.csv$/i.test(f));
  let rows = [];
  if (excelFile) {
    const wb = XLSX.readFile(path.join(outputDir, excelFile));
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } else if (csvFile) {
    const wb = XLSX.readFile(path.join(outputDir, csvFile));
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  return rows;
}

/**
 * Try to attach base64 photo to the profile if a matching image file is found.
 * We attempt filename patterns based on CardNo.
 */
function tryAttachPhoto(outputDir, profile) {
  const baseCandidates = [];
  if (profile.CardNo) {
    baseCandidates.push(`${profile.CardNo}.jpg`, `${profile.CardNo}.jpeg`, `${profile.CardNo}.png`);
  }
  // Fallback: try StaffNo-based filenames if CardNo images not found
  if (profile.StaffNo) {
    baseCandidates.push(`${profile.StaffNo}.jpg`, `${profile.StaffNo}.jpeg`, `${profile.StaffNo}.png`);
  }
  const candidates = baseCandidates;
  for (const fname of candidates) {
    const full = path.join(outputDir, fname);
    if (fs.existsSync(full)) {
      const buf = fs.readFileSync(full);
      profile.Photo = buf.toString('base64');
      return true;
    }
  }
  // No photo
  return false;
}

// Check whether a photo file exists for a given CardNo without loading it
function photoExists(outputDir, cardNo, staffNo = '') {
  const candidates = [];
  if (cardNo) {
    candidates.push(`${cardNo}.jpg`, `${cardNo}.jpeg`, `${cardNo}.png`);
  }
  if (staffNo) {
    candidates.push(`${staffNo}.jpg`, `${staffNo}.jpeg`, `${staffNo}.png`);
  }
  for (const fname of candidates) {
    const full = path.join(outputDir, fname);
    if (fs.existsSync(full)) {
      return true;
    }
  }
  return false;
}

/**
 * Register all cards for a given job output directory
 */
async function registerJobToVault({ jobId, outputDir, endpointBaseUrl, overrides = [] }) {
  const result = {
    jobId,
    endpointBaseUrl,
    attempted: 0,
    registered: 0,
    withPhoto: 0,
    withoutPhoto: 0,
    errors: [],
    details: [],
  };

  if (!fse.pathExistsSync(outputDir)) {
    result.errors.push({ code: 'OUTPUT_NOT_FOUND', message: `Output directory not found: ${outputDir}` });
    return result;
  }

  logInfo(outputDir, `Start registration job=${jobId} endpoint=${endpointBaseUrl} soapVersion=${SOAP_VERSION} soapAction=${SOAP_ACTION} namespace=${SOAP_NAMESPACE}`);
  logInfo(outputDir, `Defaults: AccessLevel=${DEFAULT_ACCESS_LEVEL} FaceAccessLevel=${DEFAULT_FACE_ACCESS_LEVEL} LiftAccessLevel=${DEFAULT_LIFT_ACCESS_LEVEL}`);
  appendJsonLog(outputDir, { event: 'start', jobId, endpointBaseUrl, overridesCount: Array.isArray(overrides) ? overrides.length : 0 });

  const rows = readRowsFromOutputDir(outputDir);
  if (!rows.length) {
    result.errors.push({ code: 'NO_ROWS', message: 'No rows found in Excel/CSV outputs.' });
    logInfo(outputDir, 'No rows found in Excel/CSV outputs.');
    appendJsonLog(outputDir, { event: 'no_rows' });
    return result;
  }

  // Build index-based override map for quick lookup
  // Supports overrides: { index, cardNo?: string, downloadCard?: boolean }
  const overrideMap = new Map();
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      if (o && typeof o.index === 'number') {
        const cardNoVal = typeof o.cardNo === 'string' ? o.cardNo.trim().substring(0, 10) : undefined;
        const downloadCardVal = typeof o.downloadCard === 'boolean' ? o.downloadCard : undefined;
        overrideMap.set(o.index, { cardNo: cardNoVal, downloadCard: downloadCardVal });
      }
    }
  }
  appendJsonLog(outputDir, { event: 'override_map_ready', count: overrideMap.size });
  logInfo(outputDir, `Override map ready: ${overrideMap.size} item(s)`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const profile = mapRowToProfile(row);
    result.attempted += 1;

    appendJsonLog(outputDir, { event: 'row_mapped', index: i, cardNo: profile.CardNo, staffNo: profile.StaffNo, name: profile.Name });

    // Apply override if provided
    const overrideItem = overrideMap.get(i);
    if (overrideItem !== undefined) {
      if (overrideItem.cardNo !== undefined) {
        profile.CardNo = overrideItem.cardNo || '';
      }
      if (overrideItem.downloadCard !== undefined) {
        profile.DownloadCard = overrideItem.downloadCard ? 'true' : 'false';
      }
      appendJsonLog(outputDir, { event: 'override_applied', index: i, cardNo: profile.CardNo, downloadCard: profile.DownloadCard });
      logInfo(outputDir, `Row ${i}: override applied, CardNo=${profile.CardNo}, DownloadCard=${profile.DownloadCard}`);
    }

    // Validate required CardNo
    if (!profile.CardNo) {
      result.errors.push({ code: 'CARD_NO_MISSING', message: 'Card No is required', index: i, name: profile.Name });
      result.details.push({ cardNo: '', name: profile.Name, hasPhoto: false, respCode: 'CARD_NO_MISSING', respMessage: 'Card No is required' });
      logInfo(outputDir, `Row ${i}: Card No missing for name='${profile.Name}'`);
      appendJsonLog(outputDir, { event: 'card_no_missing', index: i, name: profile.Name });
      continue; // skip SOAP call
    }

    const photoCandidates = [];
    if (profile.CardNo) photoCandidates.push(`${profile.CardNo}.jpg`, `${profile.CardNo}.jpeg`, `${profile.CardNo}.png`);
    if (profile.StaffNo) photoCandidates.push(`${profile.StaffNo}.jpg`, `${profile.StaffNo}.jpeg`, `${profile.StaffNo}.png`);
    appendJsonLog(outputDir, { event: 'photo_candidates', index: i, candidates: photoCandidates });
    const hasPhoto = tryAttachPhoto(outputDir, profile);
    appendJsonLog(outputDir, { event: 'photo_attach_result', index: i, hasPhoto, photoSize: profile.Photo ? profile.Photo.length : 0 });
    if (hasPhoto) result.withPhoto += 1; else result.withoutPhoto += 1;
    const envelope = buildAddCardEnvelope(profile, { namespace: SOAP_NAMESPACE, soapVersion: SOAP_VERSION });
    logInfo(outputDir, `Row ${i}: POST AddCard cardNo=${profile.CardNo} name='${profile.Name}'`);
    appendJsonLog(outputDir, { event: 'soap_request', index: i, cardNo: profile.CardNo, name: profile.Name, envelope: redactEnvelope(envelope) });
    try {
      const resp = await postAddCard(endpointBaseUrl, envelope, { soapVersion: SOAP_VERSION, soapAction: SOAP_ACTION });
      appendJsonLog(outputDir, { event: 'soap_response', index: i, status: resp.status, httpStatus: resp.httpStatus, errCode: resp.errCode, errMessage: resp.errMessage, cardId: resp.cardId, raw: resp.raw });
      logInfo(outputDir, `Row ${i}: Resp HTTP=${resp.httpStatus} ErrCode=${resp.errCode ?? '-'} ErrMessage=${resp.errMessage ?? '-'} CardID=${resp.cardId ?? '-'}`);
      // Optional: show compact raw response in terminal for quick inspection
      const rawSnippet = consoleSnippet(resp.raw);
      if (rawSnippet) {
        logInfo(outputDir, `Row ${i}: SOAP raw: ${rawSnippet}`);
      }
      // Business success criteria: HTTP 2xx and ErrCode 0 or 1
      const errCodeNum = resp.errCode !== undefined ? Number(resp.errCode) : NaN;
      const bizSuccess = (resp.httpStatus >= 200 && resp.httpStatus < 300) && (errCodeNum === 0 || errCodeNum === 1);
      if (bizSuccess) {
        result.registered += 1;
      } else {
        // Distinguish HTTP transport errors from business errors
        if (!(resp.httpStatus >= 200 && resp.httpStatus < 300)) {
          result.errors.push({ code: 'HTTP_ERROR', message: `HTTP ${resp.httpStatus}`, cardNo: profile.CardNo });
          logInfo(outputDir, `Row ${i}: HTTP error for cardNo=${profile.CardNo} status=${resp.httpStatus}`);
        } else {
          result.errors.push({ code: 'VAULT_ERROR', message: resp.errMessage || 'Unknown error', errCode: resp.errCode, cardNo: profile.CardNo });
          logInfo(outputDir, `Row ${i}: VAULT_ERROR for cardNo=${profile.CardNo} errCode=${resp.errCode} message='${resp.errMessage || ''}'`);
        }
      }
      result.details.push({ cardNo: profile.CardNo, name: profile.Name, hasPhoto, respCode: resp.errCode, respMessage: resp.errMessage });
    } catch (err) {
      result.errors.push({ code: 'REQUEST_FAILED', message: err.message, cardNo: profile.CardNo });
      logInfo(outputDir, `Row ${i}: REQUEST_FAILED for cardNo=${profile.CardNo} message=${err.message}`);
      appendJsonLog(outputDir, { event: 'error', index: i, cardNo: profile.CardNo, message: err.message, stack: err.stack });
    }
  }

  logInfo(outputDir, `Job ${jobId} complete: Attempted=${result.attempted}, Registered=${result.registered}, WithPhoto=${result.withPhoto}, WithoutPhoto=${result.withoutPhoto}, Errors=${result.errors.length}`);
  appendJsonLog(outputDir, { event: 'complete', summary: { attempted: result.attempted, registered: result.registered, withPhoto: result.withPhoto, withoutPhoto: result.withoutPhoto, errors: result.errors.length } });
  return result;
}

/**
 * Register cards using a direct CSV file path (without requiring a Job).
 * Photos (if any) will be looked up in the same directory as the CSV.
 */
async function registerCsvPathToVault({ csvPath, endpointBaseUrl, overrides = [] }) {
  const outputDir = path.dirname(csvPath);
  const jobId = path.basename(outputDir);
  const result = {
    jobId,
    endpointBaseUrl,
    attempted: 0,
    registered: 0,
    withPhoto: 0,
    withoutPhoto: 0,
    errors: [],
    details: [],
  };

  if (!fse.pathExistsSync(outputDir)) {
    result.errors.push({ code: 'OUTPUT_NOT_FOUND', message: `Output directory not found: ${outputDir}` });
    return result;
  }
  if (!fse.pathExistsSync(csvPath)) {
    result.errors.push({ code: 'CSV_NOT_FOUND', message: `CSV file not found: ${csvPath}` });
    return result;
  }

  logInfo(outputDir, `Start registration (CSV) dir=${outputDir} endpoint=${endpointBaseUrl} soapVersion=${SOAP_VERSION}`);
  logInfo(outputDir, `Defaults: AccessLevel=${DEFAULT_ACCESS_LEVEL} FaceAccessLevel=${DEFAULT_FACE_ACCESS_LEVEL} LiftAccessLevel=${DEFAULT_LIFT_ACCESS_LEVEL}`);
  appendJsonLog(outputDir, { event: 'start_csv', csvPath, endpointBaseUrl, overridesCount: Array.isArray(overrides) ? overrides.length : 0 });

  const rows = readRowsFromCsvPath(csvPath);
  if (!rows.length) {
    result.errors.push({ code: 'NO_ROWS', message: 'No rows found in CSV.' });
    logInfo(outputDir, 'No rows found in CSV.');
    appendJsonLog(outputDir, { event: 'no_rows_csv' });
    return result;
  }

  const overrideMap = new Map();
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      if (o && typeof o.index === 'number') {
        const cardNoVal = typeof o.cardNo === 'string' ? o.cardNo.trim().substring(0, 10) : undefined;
        const downloadCardVal = typeof o.downloadCard === 'boolean' ? o.downloadCard : undefined;
        overrideMap.set(o.index, { cardNo: cardNoVal, downloadCard: downloadCardVal });
      }
    }
  }
  appendJsonLog(outputDir, { event: 'override_map_ready_csv', count: overrideMap.size });
  logInfo(outputDir, `Override map ready (CSV): ${overrideMap.size} item(s)`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const profile = mapRowToProfile(row);
    result.attempted += 1;

    appendJsonLog(outputDir, { event: 'row_mapped_csv', index: i, cardNo: profile.CardNo, staffNo: profile.StaffNo, name: profile.Name });

    const overrideItem = overrideMap.get(i);
    if (overrideItem !== undefined) {
      if (overrideItem.cardNo !== undefined) {
        profile.CardNo = overrideItem.cardNo || '';
      }
      if (overrideItem.downloadCard !== undefined) {
        profile.DownloadCard = overrideItem.downloadCard ? 'true' : 'false';
      }
      appendJsonLog(outputDir, { event: 'override_applied_csv', index: i, cardNo: profile.CardNo, downloadCard: profile.DownloadCard });
      logInfo(outputDir, `Row ${i}: override applied (CSV), CardNo=${profile.CardNo}, DownloadCard=${profile.DownloadCard}`);
    }

    if (!profile.CardNo) {
      result.errors.push({ code: 'CARD_NO_MISSING', message: 'Card No is required', index: i, name: profile.Name });
      result.details.push({ cardNo: '', name: profile.Name, hasPhoto: false, respCode: 'CARD_NO_MISSING', respMessage: 'Card No is required' });
      logInfo(outputDir, `Row ${i}: Card No missing for name='${profile.Name}' (CSV)`);
      appendJsonLog(outputDir, { event: 'card_no_missing_csv', index: i, name: profile.Name });
      continue;
    }

    const hasPhoto = tryAttachPhoto(outputDir, profile);
    appendJsonLog(outputDir, { event: 'photo_attach_result_csv', index: i, hasPhoto, photoSize: profile.Photo ? profile.Photo.length : 0 });
    if (hasPhoto) result.withPhoto += 1; else result.withoutPhoto += 1;
    const envelope = buildAddCardEnvelope(profile, { namespace: SOAP_NAMESPACE, soapVersion: SOAP_VERSION });
    logInfo(outputDir, `Row ${i}: POST AddCard (CSV) cardNo=${profile.CardNo} name='${profile.Name}'`);
    appendJsonLog(outputDir, { event: 'soap_request_csv', index: i, cardNo: profile.CardNo, name: profile.Name, envelope: redactEnvelope(envelope) });
    try {
      const resp = await postAddCard(endpointBaseUrl, envelope, { soapVersion: SOAP_VERSION, soapAction: SOAP_ACTION });
      appendJsonLog(outputDir, { event: 'soap_response_csv', index: i, status: resp.status, httpStatus: resp.httpStatus, errCode: resp.errCode, errMessage: resp.errMessage, cardId: resp.cardId, raw: resp.raw });
      logInfo(outputDir, `Row ${i}: Resp (CSV) HTTP=${resp.httpStatus} ErrCode=${resp.errCode ?? '-'} ErrMessage=${resp.errMessage ?? '-'} CardID=${resp.cardId ?? '-'}`);
      const rawSnippet = consoleSnippet(resp.raw);
      if (rawSnippet) {
        logInfo(outputDir, `Row ${i}: SOAP raw (CSV): ${rawSnippet}`);
      }
      const errCodeNum = resp.errCode !== undefined ? Number(resp.errCode) : NaN;
      const bizSuccess = (resp.httpStatus >= 200 && resp.httpStatus < 300) && (errCodeNum === 0 || errCodeNum === 1);
      if (bizSuccess) {
        result.registered += 1;
      } else {
        if (!(resp.httpStatus >= 200 && resp.httpStatus < 300)) {
          result.errors.push({ code: 'HTTP_ERROR', message: `HTTP ${resp.httpStatus}`, cardNo: profile.CardNo });
          logInfo(outputDir, `Row ${i}: HTTP error (CSV) for cardNo=${profile.CardNo} status=${resp.httpStatus}`);
        } else {
          result.errors.push({ code: 'VAULT_ERROR', message: resp.errMessage || 'Unknown error', errCode: resp.errCode, cardNo: profile.CardNo });
          logInfo(outputDir, `Row ${i}: VAULT_ERROR (CSV) for cardNo=${profile.CardNo} errCode=${resp.errCode} message='${resp.errMessage || ''}'`);
        }
      }
      result.details.push({ cardNo: profile.CardNo, name: profile.Name, hasPhoto, respCode: resp.errCode, respMessage: resp.errMessage });
    } catch (err) {
      result.errors.push({ code: 'REQUEST_FAILED', message: err.message, cardNo: profile.CardNo });
      logInfo(outputDir, `Row ${i}: REQUEST_FAILED (CSV) for cardNo=${profile.CardNo} message=${err.message}`);
      appendJsonLog(outputDir, { event: 'error_csv', index: i, cardNo: profile.CardNo, message: err.message, stack: err.stack });
    }
  }

  logInfo(outputDir, `CSV registration complete: Attempted=${result.attempted}, Registered=${result.registered}, WithPhoto=${result.withPhoto}, WithoutPhoto=${result.withoutPhoto}, Errors=${result.errors.length}`);
  appendJsonLog(outputDir, { event: 'complete_csv', summary: { attempted: result.attempted, registered: result.registered, withPhoto: result.withPhoto, withoutPhoto: result.withoutPhoto, errors: result.errors.length } });
  return result;
}

// Update existing cards from a CSV/Excel path
async function updateCsvPathToVault({ csvPath, endpointBaseUrl, overrides = [] }) {
  const dir = path.dirname(csvPath);
  const rows = readRowsFromCsvPath(csvPath);
  const details = [];
  const errors = [];
  let registered = 0;
  let withPhoto = 0;
  let withoutPhoto = 0;
  const attempted = rows.length;

  // Batch update logging header
  logUpdateInfo(dir, `Start Update (CSV) path=${csvPath} endpoint=${endpointBaseUrl || '(env default)'} rows=${rows.length}`);
  appendUpdateJsonLog(dir, { event: 'update_batch_start', csvPath, endpointBaseUrl, rows: rows.length, overridesCount: Array.isArray(overrides) ? overrides.length : 0 });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const startedAt = Date.now();
    let profile = mapRowToUpdateProfile(row);
    appendUpdateJsonLog(dir, { event: 'row_mapped_update', index: i, cardNo: profile.CardNo, staffNo: profile.StaffNo, name: profile.Name });
    // Access level resolution source logging
    const accessLevelExplicit = s(row['ACCESS LEVEL'] || row['Access Level'] || row['AccessLevel']);
    const messRaw = s(row['MESSHALL'] || row['MessHall'] || row['Mess Hall']);
    let accessSource = 'default';
    if (accessLevelExplicit) accessSource = 'explicit_column';
    else if (messRaw) accessSource = 'derived_from_messhall';
    appendUpdateJsonLog(dir, { event: 'row_access_level_resolved_update', index: i, cardNo: profile.CardNo, accessLevel: profile.AccessLevel, faceAccessLevel: profile.FaceAccessLevel, liftAccessLevel: profile.LiftAccessLevel, source: accessSource, messRaw });
    logUpdateInfo(dir, `Row ${i}: AccessLevel=${profile.AccessLevel} Face=${profile.FaceAccessLevel || '-'} Lift=${profile.LiftAccessLevel || '-'} source=${accessSource}${messRaw ? ` mess='${messRaw}'` : ''}`);

    const override = overrides.find(o => o.index === i);
    if (override) {
      if (override.cardNo) profile.CardNo = s(override.cardNo).substring(0,10);
      if (typeof override.downloadCard === 'boolean') profile.Download = String(override.downloadCard);
      appendUpdateJsonLog(dir, { event: 'override_applied_update', index: i, cardNo: profile.CardNo, download: profile.Download });
      logUpdateInfo(dir, `Row ${i}: override applied, CardNo=${profile.CardNo}, Download=${profile.Download}`);
    }

    const hasPhoto = tryAttachPhoto(dir, profile);
    if (hasPhoto) withPhoto++; else withoutPhoto++;
    appendUpdateJsonLog(dir, { event: 'photo_attach_result_update', index: i, hasPhoto, photoSize: profile.Photo ? profile.Photo.length : 0 });
    const envelope = buildUpdateCardEnvelope(profile);
    logUpdateInfo(dir, `Row ${i}: POST UpdateCard cardNo=${profile.CardNo} name='${profile.Name}'`);
    appendUpdateJsonLog(dir, { event: 'soap_request_update', index: i, cardNo: profile.CardNo, name: profile.Name, envelope: redactEnvelope(envelope) });
    try {
      const resp = await postUpdateCard(endpointBaseUrl, envelope);
      appendUpdateJsonLog(dir, { event: 'soap_response_update', index: i, status: resp.status, httpStatus: resp.httpStatus, errCode: resp.errCode, errMessage: resp.errMessage, raw: resp.raw });
      const ok = resp.status === 'ok' && (!resp.errCode || resp.errCode === '0');
      if (ok) registered++; else errors.push({ code: 'VAULT_ERROR', message: resp.errMessage || 'Unknown error', errCode: resp.errCode, cardNo: profile.CardNo, index: i });
      details.push({
        cardNo: profile.CardNo,
        name: profile.Name,
        hasPhoto: !!profile.Photo,
        respCode: resp.errCode,
        respMessage: resp.errMessage,
        department: profile.Department,
        staffNo: profile.StaffNo,
        sourceRow: row,
        profile,
      });
      appendUpdateJsonLog(dir, { event: 'row_update_complete', index: i, cardNo: profile.CardNo, accessLevel: profile.AccessLevel, success: ok, durationMs: Date.now() - startedAt });
    } catch (err) {
      errors.push({ code: 'REQUEST_FAILED', message: err.message, cardNo: profile.CardNo, index: i });
      appendUpdateJsonLog(dir, { event: 'error_update', index: i, cardNo: profile.CardNo, message: err.message, stack: err.stack });
      logUpdateInfo(dir, `Row ${i}: REQUEST_FAILED for cardNo=${profile.CardNo} message=${err.message}`);
    }
  }

  logUpdateInfo(dir, `Update batch complete: Attempted=${attempted}, Updated=${registered}, WithPhoto=${withPhoto}, WithoutPhoto=${withoutPhoto}, Errors=${errors.length}`);
  appendUpdateJsonLog(dir, { event: 'update_batch_complete', summary: { attempted, registered, withPhoto, withoutPhoto, errors: errors.length } });
  return { attempted, registered, withPhoto, withoutPhoto, details, errors };
}

// Update a single row (by index) from a CSV/Excel path
async function updateCsvRowToVault({ csvPath, index, endpointBaseUrl, override }) {
  const dir = path.dirname(csvPath);
  const rows = readRowsFromCsvPath(csvPath);
  const details = [];
  const errors = [];
  let registered = 0;
  let withPhoto = 0;
  let withoutPhoto = 0;
  const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now());
  let lastResp = null;
  let lastDurationMs = 0;

  if (!Array.isArray(rows) || index < 0 || index >= rows.length) {
    const message = `Index out of range. index=${index}, rows=${Array.isArray(rows) ? rows.length : 0}`;
    appendUpdateJsonLog(dir, { event: 'single_update_invalid_index', csvPath, index, rows: Array.isArray(rows) ? rows.length : 0 });
    return { attempted: 0, registered: 0, withPhoto: 0, withoutPhoto: 0, details: [], errors: [{ code: 'INDEX_OUT_OF_RANGE', message }] };
  }

  const row = rows[index];
  const startedAt = Date.now();
  let profile = mapRowToUpdateProfile(row);
  appendUpdateJsonLog(dir, { event: 'single_row_mapped_update', requestId, index, cardNo: profile.CardNo, staffNo: profile.StaffNo, name: profile.Name });
  const accessLevelExplicit = s(row['ACCESS LEVEL'] || row['Access Level'] || row['AccessLevel']);
  const messRaw = s(row['MESSHALL'] || row['MessHall'] || row['Mess Hall']);
  let accessSource = 'default';
  if (accessLevelExplicit) accessSource = 'explicit_column';
  else if (messRaw) accessSource = 'derived_from_messhall';
  appendUpdateJsonLog(dir, { event: 'single_row_access_level_resolved_update', requestId, index, cardNo: profile.CardNo, accessLevel: profile.AccessLevel, faceAccessLevel: profile.FaceAccessLevel, liftAccessLevel: profile.LiftAccessLevel, source: accessSource, messRaw });
  logUpdateInfo(dir, `Row ${index} [${requestId}]: AccessLevel=${profile.AccessLevel} Face=${profile.FaceAccessLevel || '-'} Lift=${profile.LiftAccessLevel || '-'} source=${accessSource}${messRaw ? ` mess='${messRaw}'` : ''}`);

  if (override) {
    if (override.cardNo) profile.CardNo = s(override.cardNo).substring(0,10);
    if (typeof override.downloadCard === 'boolean') profile.Download = String(override.downloadCard);
    // Apply generic field overrides if provided
    const overrideKeys = [
      'Name','Department','Company','Gentle','AccessLevel','FaceAccessLevel','LiftAccessLevel','BypassAP','ActiveStatus','NonExpired','ExpiredDate',
      'VehicleNo','FloorNo','UnitNo','ParkingNo','StaffNo','Title','Position','NRIC','Passport','Race','DOB','JoiningDate','ResignDate',
      'Address1','Address2','PostalCode','City','State','Email','MobileNo','Download'
    ];
    for (const key of overrideKeys) {
      if (Object.prototype.hasOwnProperty.call(override, key)) {
        const val = override[key];
        profile[key] = typeof val === 'string' ? val : String(val);
      }
    }
    appendUpdateJsonLog(dir, { event: 'single_override_applied_update', requestId, index, cardNo: profile.CardNo, download: profile.Download });
    logUpdateInfo(dir, `Row ${index} [${requestId}]: override applied, CardNo=${profile.CardNo}, Download=${profile.Download}`);
  }

  const hasPhoto = tryAttachPhoto(dir, profile);
  if (hasPhoto) withPhoto++; else withoutPhoto++;
  appendUpdateJsonLog(dir, { event: 'single_photo_attach_result_update', requestId, index, hasPhoto, photoSize: profile.Photo ? profile.Photo.length : 0 });
  const envelope = buildUpdateCardEnvelope(profile);
  logUpdateInfo(dir, `Row ${index} [${requestId}]: POST UpdateCard (single) cardNo=${profile.CardNo} name='${profile.Name}'`);
  appendUpdateJsonLog(dir, { event: 'single_soap_request_update', requestId, index, cardNo: profile.CardNo, name: profile.Name, envelope: redactEnvelope(envelope) });
  // Emit a truncated redacted request envelope to backend text/console logs for easier diagnosis
  try {
    const reqSnippet = consoleSnippet(redactEnvelope(envelope), 1200);
    if (reqSnippet) {
      logUpdateInfo(dir, `Row ${index} [${requestId}]: SOAP request envelope: ${reqSnippet}`);
    }
  } catch {}
  try {
    const resp = await postUpdateCard(endpointBaseUrl, envelope);
    lastResp = resp;
    appendUpdateJsonLog(dir, { event: 'single_soap_response_update', requestId, index, status: resp.status, httpStatus: resp.httpStatus, errCode: resp.errCode, errMessage: resp.errMessage, raw: resp.raw });
    // Also emit a truncated raw SOAP response to backend text/console logs for easier diagnosis
    try {
      const snippet = consoleSnippet(resp.raw, 1200);
      if (snippet) {
        logUpdateInfo(dir, `Row ${index} [${requestId}]: SOAP response raw: ${snippet}`);
      }
    } catch {}
    const ok = resp.status === 'ok' && (!resp.errCode || resp.errCode === '0');
    if (ok) registered++; else errors.push({ code: 'VAULT_ERROR', message: resp.errMessage || 'Unknown error', errCode: resp.errCode, cardNo: profile.CardNo });
    details.push({
      cardNo: profile.CardNo,
      name: profile.Name,
      hasPhoto: !!profile.Photo,
      respCode: resp.errCode,
      respMessage: resp.errMessage,
      department: profile.Department,
      staffNo: profile.StaffNo,
      sourceRow: row,
      profile,
    });
    const durationMs = Date.now() - startedAt;
    lastDurationMs = durationMs;
    // If Vault reports truncation, emit a quick field-length summary to help pinpoint offending fields
    try {
      const msgText = (resp.errMessage || '').toLowerCase();
      if (msgText.includes('truncated')) {
        const lengths = Object.entries(profile)
          .filter(([k]) => k !== 'Photo')
          .map(([k, v]) => [k, typeof v === 'string' ? v.length : (typeof v === 'number' ? String(v).length : 0)]);
        lengths.sort((a, b) => b[1] - a[1]);
        const top = lengths.slice(0, 8).map(([k, len]) => `${k}=${len}`).join(' ');
        appendUpdateJsonLog(dir, { event: 'single_field_length_summary', requestId, index, cardNo: profile.CardNo, summary: lengths.slice(0, 20) });
        logUpdateInfo(dir, `Row ${index} [${requestId}]: Field length summary (top): ${top}`);
      }
    } catch {}
    appendUpdateJsonLog(dir, { event: 'single_row_update_complete', requestId, index, cardNo: profile.CardNo, accessLevel: profile.AccessLevel, success: ok, durationMs });
    const errMsg = ((resp.errMessage || '').trim()) || '-';
    logUpdateInfo(dir, `Row ${index} [${requestId}]: ${ok ? 'SUCCESS' : 'FAILED'} cardNo=${profile.CardNo} code=${resp.errCode || '-'} msg=${errMsg} (${durationMs}ms)`);
  } catch (err) {
    errors.push({ code: 'REQUEST_FAILED', message: err.message, cardNo: profile.CardNo });
    appendUpdateJsonLog(dir, { event: 'single_error_update', requestId, index, cardNo: profile.CardNo, message: err.message, stack: err.stack });
    logUpdateInfo(dir, `Row ${index} [${requestId}]: REQUEST_FAILED (single) for cardNo=${profile.CardNo} message=${err.message}`);
  }

  const summary = { attempted: 1, registered, withPhoto, withoutPhoto, errors: errors.length };
  appendUpdateJsonLog(dir, { event: 'single_update_complete', requestId, index, summary });
  // Flatten per-row status for easier UI consumption
  const detail = details[0];
  const rowStatus = {
    ok: (errors.length === 0),
    code: detail ? detail.respCode : undefined,
    message: detail ? detail.respMessage : (errors[0]?.message || undefined),
    durationMs: lastDurationMs || undefined,
    rawSnippet: lastResp && lastResp.raw ? consoleSnippet(lastResp.raw, 400) : undefined,
  };
  return { attempted: 1, registered, withPhoto, withoutPhoto, details, errors, requestId, rowStatus };
}

// Preview update from CSV/Excel path
function previewUpdateCsvPathToVault({ csvPath }) {
  const dir = path.dirname(csvPath);
  const rows = readRowsFromCsvPath(csvPath);
  const details = rows.map((row, i) => {
    const profile = mapRowToUpdateProfile(row);
    const hasPhoto = photoExists(dir, profile.CardNo, profile.StaffNo);
    return {
      cardNo: profile.CardNo,
      name: profile.Name,
      hasPhoto,
      department: profile.Department,
      staffNo: profile.StaffNo,
      sourceRow: row,
      profile,
    };
  });
  return { attempted: rows.length, registered: 0, withPhoto: details.filter(d=>d.hasPhoto).length, withoutPhoto: details.filter(d=>!d.hasPhoto).length, details };
}

module.exports = {
  registerJobToVault,
  photoExists,
  registerCsvPathToVault,
  /**
   * Preview profiles to be registered without executing SOAP calls.
   * Returns counts and per-card details (cardNo, name, department, hasPhoto).
   */
  previewJobToVault: ({ jobId, outputDir }) => {
    const result = {
      jobId,
      attempted: 0,
      registered: 0,
      withPhoto: 0,
      withoutPhoto: 0,
      errors: [],
      details: [],
    };

    if (!fse.pathExistsSync(outputDir)) {
      result.errors.push({ code: 'OUTPUT_NOT_FOUND', message: `Output directory not found: ${outputDir}` });
      return result;
    }

    const rows = readRowsFromOutputDir(outputDir);
    if (!rows.length) {
      result.errors.push({ code: 'NO_ROWS', message: 'No rows found in Excel/CSV outputs.' });
      return result;
    }

    for (const row of rows) {
      const profile = mapRowToProfile(row);
      result.attempted += 1;
      const hasPhoto = tryAttachPhoto(outputDir, profile);
      if (hasPhoto) result.withPhoto += 1; else result.withoutPhoto += 1;
      result.details.push({
        cardNo: profile.CardNo,
        name: profile.Name,
        department: profile.Department,
        staffNo: s(row['Staff No [Max 15]'] || row['Staff No. [Max 10]'] || row['Emp. No'] || row['Employee ID'] || row['ID'] || row['NIK']) || profile.CardNo,
        hasPhoto,
        sourceRow: row,
        profile,
      });
    }

    return result;
  },
  /**
   * Preview from a specific CSV file path.
   */
  previewCsvPathToVault: ({ csvPath }) => {
    const outputDir = path.dirname(csvPath);
    const jobId = path.basename(outputDir);
    const result = {
      jobId,
      attempted: 0,
      registered: 0,
      withPhoto: 0,
      withoutPhoto: 0,
      errors: [],
      details: [],
    };

    if (!fse.pathExistsSync(outputDir)) {
      result.errors.push({ code: 'OUTPUT_NOT_FOUND', message: `Output directory not found: ${outputDir}` });
      return result;
    }
    if (!fse.pathExistsSync(csvPath)) {
      result.errors.push({ code: 'CSV_NOT_FOUND', message: `CSV file not found: ${csvPath}` });
      return result;
    }

    const rows = readRowsFromCsvPath(csvPath);
    if (!rows.length) {
      result.errors.push({ code: 'NO_ROWS', message: 'No rows found in CSV.' });
      return result;
    }

    for (const row of rows) {
      const profile = mapRowToProfile(row);
      result.attempted += 1;
      const hasPhoto = tryAttachPhoto(outputDir, profile);
      if (hasPhoto) result.withPhoto += 1; else result.withoutPhoto += 1;
      result.details.push({
        cardNo: profile.CardNo,
        name: profile.Name,
        department: profile.Department,
        staffNo: s(row['Staff No [Max 15]'] || row['Staff No. [Max 10]'] || row['Emp. No'] || row['Employee ID'] || row['ID'] || row['NIK']) || profile.CardNo,
        hasPhoto,
        sourceRow: row,
        profile,
      });
    }

    return result;
  },
  updateCsvPathToVault,
  previewUpdateCsvPathToVault,
  updateCsvRowToVault,
  // Update a single profile object directly (DB-sourced or custom)
  updateProfileToVault: async ({ profile, endpointBaseUrl, outputDir }) => {
    const dir = outputDir || path.join(__dirname, '..', '..', 'scripts');
    const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now());
    // Attach photo if available
    tryAttachPhoto(dir, profile);
    const envelope = buildUpdateCardEnvelope(profile);
    appendUpdateJsonLog(dir, { event: 'single_soap_request_update', requestId, cardNo: profile.CardNo, name: profile.Name, envelope: redactEnvelope(envelope) });
    logUpdateInfo(dir, `DB Single [${requestId}]: POST UpdateCard cardNo=${profile.CardNo} name='${profile.Name}'`);
    const resp = await postUpdateCard(endpointBaseUrl, envelope);
    appendUpdateJsonLog(dir, { event: 'single_soap_response_update', requestId, status: resp.status, httpStatus: resp.httpStatus, errCode: resp.errCode, errMessage: resp.errMessage, raw: resp.raw });
    const ok = resp.status === 'ok' && (!resp.errCode || resp.errCode === '0');
    logUpdateInfo(dir, `DB Single [${requestId}]: ${ok ? 'SUCCESS' : 'FAILED'} cardNo=${profile.CardNo} code=${resp.errCode || '-'} msg=${((resp.errMessage||'').trim()) || '-'} `);
    return {
      ok,
      code: resp.errCode,
      message: resp.errMessage,
      raw: resp.raw,
      requestId,
    };
  },
};