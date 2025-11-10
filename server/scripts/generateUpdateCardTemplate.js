// Generate UpdateCardTemplate.xlsx with all supported columns
// Usage: npm run generate-template
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const outPath = path.join(projectRoot, 'UpdateCardTemplate.xlsx');

  const headers = [
    // Identity
    'CARD NO',
    'NAME',
    'COMPANY',
    'DEPARTMENT',
    'STAFF ID',
    'TITLE',
    'POSITION',
    'GENDER',
    // IDs
    'KTP/PASPORT NO',
    // Dates & status
    'DATE OF BIRTH',
    'DATE OF HIRE',
    'WORK PERIOD END',
    'RACE',
    'CARD STATUS',
    // Contact & address
    'ADDRESS',
    'PHONE NO',
    // Access related
    'MESSHALL',
    'VEHICLE NO',
    'ACCESS LEVEL',
    'FACE ACCESS LEVEL',
    'LIFT ACCESS LEVEL',
  ];

  // Create worksheet with headers and a sample row description
  const rows = [headers];
  const sample = {
    'CARD NO': '2349317840',
    'NAME': 'JOHN DOE',
    'COMPANY': 'ACME LTD',
    'DEPARTMENT': 'HUMAN RESOURCE',
    'STAFF ID': 'MT123456',
    'TITLE': 'STAFF',
    'POSITION': 'ASSISTANT',
    'GENDER': 'Male',
    'KTP/PASPORT NO': '3174xxxxxxxx',
    'DATE OF BIRTH': '1990-01-02',
    'DATE OF HIRE': '2020-05-01',
    'WORK PERIOD END': '',
    'RACE': 'ASIAN',
    'CARD STATUS': 'Active',
    'ADDRESS': 'Jl. Example 123',
    'PHONE NO': '+62 812 0000 0000',
    'MESSHALL': 'Makarti',
    'VEHICLE NO': '',
    'ACCESS LEVEL': '10',
    'FACE ACCESS LEVEL': '',
    'LIFT ACCESS LEVEL': '',
  };
  rows.push(headers.map(h => sample[h] ?? ''));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Style: autofilter & column widths
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: headers.length - 1, r: 0 } }) };
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 2) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'UpdateCardTemplate');
  XLSX.writeFile(wb, outPath);

  console.log(`✅ Generated template: ${outPath}`);
}

main();