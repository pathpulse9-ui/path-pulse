import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/browser';
import { StrKey } from '@stellar/stellar-sdk';

export interface ParsedRecipient {
  name: string;
  address: string;
  amount: string;
  remark: string;
  addressValid: boolean;
  amountValid: boolean;
}

const NAME_KEYS = ['name', 'person', 'worker', 'driver', 'recipient'];
const ADDRESS_KEYS = ['address', 'publicaddress', 'publickey', 'wallet', 'stellaraddress'];
const AMOUNT_KEYS = ['amount', 'pay', 'payout', 'amountxlm'];
const REMARK_KEYS = ['remark', 'remarks', 'note', 'notes', 'memo', 'reference', 'description'];

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '');

function matchColumn(headers: string[], keys: string[]): number {
  const normalized = headers.map(norm);
  return normalized.findIndex((h) => keys.includes(h));
}

const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;

function toRecipient(
  name: string,
  address: string,
  amount: string,
  remark: string,
): ParsedRecipient {
  const trimmedAmount = amount.trim();
  return {
    name: name.trim(),
    address: address.trim(),
    amount: trimmedAmount,
    remark: remark.trim(),
    addressValid: StrKey.isValidEd25519PublicKey(address.trim()),
    amountValid: AMOUNT_RE.test(trimmedAmount) && Number(trimmedAmount) > 0,
  };
}

function rowsToRecipients(headers: string[], rows: string[][]): ParsedRecipient[] {
  const nameCol = matchColumn(headers, NAME_KEYS);
  const addressCol = matchColumn(headers, ADDRESS_KEYS);
  const amountCol = matchColumn(headers, AMOUNT_KEYS);
  const remarkCol = matchColumn(headers, REMARK_KEYS);
  if (addressCol === -1) {
    throw new Error('Could not find an "Address" column in the uploaded file.');
  }
  if (amountCol === -1) {
    throw new Error('Could not find an "Amount" column in the uploaded file.');
  }
  return rows
    .filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''))
    .map((r) =>
      toRecipient(
        nameCol === -1 ? '' : String(r[nameCol] ?? ''),
        String(r[addressCol] ?? ''),
        String(r[amountCol] ?? ''),
        remarkCol === -1 ? '' : String(r[remarkCol] ?? ''),
      ),
    );
}

function parseCsv(file: File): Promise<ParsedRecipient[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data;
        if (rows.length === 0) {
          reject(new Error('CSV file is empty.'));
          return;
        }
        try {
          resolve(rowsToRecipients(rows[0], rows.slice(1)));
        } catch (e) {
          reject(e);
        }
      },
      error: (err: Error) => reject(err),
    });
  });
}

async function parseExcel(file: File): Promise<ParsedRecipient[]> {
  const rows = (await readXlsxFile(file)) as unknown as string[][];
  if (rows.length === 0) throw new Error('Excel file is empty.');
  return rowsToRecipients(
    rows[0].map((h) => String(h ?? '')),
    rows.slice(1).map((r) => r.map((c) => String(c ?? ''))),
  );
}

export function parseRecipientsFile(file: File): Promise<ParsedRecipient[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return parseCsv(file);
  if (ext === 'xlsx' || ext === 'xls') return parseExcel(file);
  return Promise.reject(new Error('Unsupported file type — upload a .csv, .xlsx, or .xls file.'));
}
