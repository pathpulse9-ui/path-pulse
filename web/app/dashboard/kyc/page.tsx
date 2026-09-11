'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createCarretSubAccount,
  initiateCarretKyc,
  submitCarretKycDocument,
  uploadCarretKycFile,
  getCarretKycStatus,
  cleanupCarretKyc,
  type CarretKycStatus,
  type CarretSubAccountInput,
} from '../../lib/api';

/**
 * Polished multi-step KYC wizard — mirrors iOS `KycView` and Android
 * `KycScreen`. Every step is a focused card with a hero mint circle icon,
 * one big question or action, and a sticky primary CTA at the bottom.
 * Backend still proxies every Carret call so the API-KEY never touches
 * the browser.
 */

type WizardPage =
  | 'welcome' | 'name' | 'contact' | 'bornWhen' | 'about'
  | 'pan' | 'aadhaar' | 'selfie'
  | 'checking' | 'verified' | 'rejected';

const STEP_INDEX: Record<WizardPage, number> = {
  welcome: 0, name: 1, contact: 2, bornWhen: 3, about: 4,
  pan: 5, aadhaar: 6, selfie: 7,
  checking: -1, verified: -1, rejected: -1,
};
const STEP_COUNT = 8;

const OCCUPATIONS = [
  'Private Job',
  'Goverment Job',
  'Business Owner',
  'Home Maker',
  'Freelancer',
  'Unemployed',
  'Student',
  'Professional',
] as const;

const INCOMES = [
  '< ₹5 Lakhs',
  '₹5 Lakhs-₹10 Lakhs',
  '₹10 Lakhs-₹25 Lakhs',
  '₹25 Lakhs-₹50 Lakhs',
  '₹50 Lakhs-1 Crore',
  '>₹1 Crore',
] as const;

const DIAL_CODES = [
  { code: '91',  flag: '🇮🇳', name: 'India' },
  { code: '971', flag: '🇦🇪', name: 'UAE' },
  { code: '1',   flag: '🇺🇸', name: 'USA' },
  { code: '44',  flag: '🇬🇧', name: 'UK' },
  { code: '65',  flag: '🇸🇬', name: 'Singapore' },
  { code: '1',   flag: '🇨🇦', name: 'Canada' },
  { code: '61',  flag: '🇦🇺', name: 'Australia' },
] as const;

// dd/mm/yyyy — Carret's required format.
function formatDob(iso: string): string {
  // <input type="date"> gives us YYYY-MM-DD; Carret wants DD/MM/YYYY.
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

// 18 years ago today — youngest allowed.
function maxDobIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}
function minDobIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 100);
  return d.toISOString().slice(0, 10);
}

export default function KycPage() {
  const [page, setPage] = useState<WizardPage>('welcome');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Account / session
  const [accountId, setAccountId] = useState('');
  const [sessionId, setSessionId] = useState('');

  // Wizard state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dialCode, setDialCode] = useState(DIAL_CODES[0].code);
  const [dobIso, setDobIso] = useState(''); // YYYY-MM-DD from <input type=date>
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [occupation, setOccupation] = useState<string>('Business Owner');
  const [income, setIncome] = useState<string>('₹5 Lakhs-₹10 Lakhs');

  // PAN
  const [panNumber, setPanNumber] = useState('');
  const [panName, setPanName] = useState('');
  const [panDobIso, setPanDobIso] = useState('');

  // Files
  const aadhaarFileRef = useRef<HTMLInputElement>(null);
  const selfieFileRef = useRef<HTMLInputElement>(null);
  const [aadhaarName, setAadhaarName] = useState<string>('');
  const [selfieName, setSelfieName] = useState<string>('');

  // Poll
  const [status, setStatus] = useState<CarretKycStatus | null>(null);

  const dob = useMemo(() => formatDob(dobIso), [dobIso]);
  const panDob = useMemo(() => formatDob(panDobIso), [panDobIso]);

  // ── Actions ─────────────────────────────────────────────────

  async function doCreateSubAccount(): Promise<boolean> {
    try {
      const input: CarretSubAccountInput = {
        email,
        phone_number: phone.replace(/\D/g, ''), // bare 10 digits — Carret contract
        first_name: firstName,
        last_name: lastName,
        dob,
        country: 'IN',
        gender,
        occupation,
        annual_income: income,
      };
      const acc = await createCarretSubAccount(input);
      setAccountId(String(acc.id));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create sub-account');
      return false;
    }
  }

  async function doInitiate(): Promise<boolean> {
    try {
      const r = await initiateCarretKyc(accountId);
      setSessionId(r.session.session_id);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to initiate KYC');
      return false;
    }
  }

  async function doSubmitPan(): Promise<boolean> {
    try {
      await submitCarretKycDocument(sessionId, {
        document_type: 'pan',
        document_number: panNumber.toUpperCase(),
        name: panName,
        dob: panDob,
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PAN submission failed');
      return false;
    }
  }

  async function doUploadAadhaar(): Promise<boolean> {
    const file = aadhaarFileRef.current?.files?.[0];
    if (!file) { setError('Choose an Aadhaar file first.'); return false; }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const fileType = ext === 'xml' || ext === 'zip' ? 'xml' : 'image';
    try {
      await uploadCarretKycFile({ kycSession: sessionId, docType: 'aadhaar', fileType, file });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aadhaar upload failed');
      return false;
    }
  }

  async function doUploadSelfie(): Promise<boolean> {
    const file = selfieFileRef.current?.files?.[0];
    if (!file) { setError('Choose a selfie first.'); return false; }
    try {
      await uploadCarretKycFile({ kycSession: sessionId, docType: 'selfie', fileType: 'image', file });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Selfie upload failed');
      return false;
    }
  }

  async function doCleanupAndRetry() {
    try {
      await cleanupCarretKyc(accountId);
      setSessionId(''); setStatus(null);
      setError(null); setPage('name');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cleanup failed');
    }
  }

  // Sticky CTA click.
  const performAction = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      switch (page) {
        case 'welcome':  setPage('name'); break;
        case 'name':     setPage('contact'); break;
        case 'contact':  setPage('bornWhen'); break;
        case 'bornWhen':
          setPage('about');
          if (!panDobIso) setPanDobIso(dobIso);
          break;
        case 'about':
          if (await doCreateSubAccount() && await doInitiate()) setPage('pan');
          break;
        case 'pan':      if (await doSubmitPan()) setPage('aadhaar'); break;
        case 'aadhaar':  if (await doUploadAadhaar()) setPage('selfie'); break;
        case 'selfie':
          if (await doUploadSelfie()) setPage('checking');
          break;
      }
    } finally { setSubmitting(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, firstName, lastName, email, phone, dobIso, panDobIso, gender, occupation, income, panNumber, panName, sessionId, accountId]);

  // ── Polling — driven by page === 'checking' ─────────────────
  useEffect(() => {
    if (page !== 'checking' || !accountId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getCarretKycStatus(accountId);
        if (cancelled) return;
        setStatus(s);
        if (s.kyc_status === 'verified') setPage('verified');
        else if (s.kyc_status === 'rejected') setPage('rejected');
      } catch { /* keep polling */ }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [page, accountId]);

  const actionEnabled = (() => {
    switch (page) {
      case 'welcome':  return true;
      case 'name':     return !!firstName && !!lastName;
      case 'contact':  return email.includes('@') && phone.length === 10;
      case 'bornWhen': return !!dobIso;
      case 'about':    return true;
      case 'pan':      return panNumber.length >= 10 && !!panName && !!panDobIso;
      case 'aadhaar':  return !!aadhaarName;
      case 'selfie':   return !!selfieName;
      default:         return false;
    }
  })();

  const action = actionFor(page);

  const stepIdx = STEP_INDEX[page];

  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 pb-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            const prev = previousPage(page);
            if (prev) setPage(prev);
          }}
          className="grid place-items-center h-9 w-9 rounded-full hover:bg-black/5 disabled:opacity-30"
          disabled={!previousPage(page)}
          aria-label="Back"
        >
          <ChevronIcon dir="left" />
        </button>
        <div className="flex-1 text-center text-sm font-medium text-black">
          {navTitle(page)}
        </div>
        <div className="w-9" />
      </div>

      {/* Progress bar */}
      {stepIdx >= 0 && (
        <div className="flex items-center gap-3 pb-4">
          <div className="flex-1 h-1 rounded-full bg-black/10 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${((stepIdx + 1) / STEP_COUNT) * 100}%` }}
            />
          </div>
          <span className="text-xs text-black/50 tabular-nums">
            Step {stepIdx + 1} of {STEP_COUNT}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-100 p-3 flex gap-2 items-start mb-3">
          <WarnIcon className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto pb-32">
        {page === 'welcome' && (
          <PageShell icon={<ShieldIcon />} title="Let's verify your identity" subtitle="A one-time check so you can withdraw to your bank. Takes about 3 minutes.">
            <ul className="space-y-3 pt-4">
              <BulletItem>Your name & basic details</BulletItem>
              <BulletItem>PAN card</BulletItem>
              <BulletItem>Aadhaar (from DigiLocker, or a photo)</BulletItem>
              <BulletItem>A quick selfie</BulletItem>
            </ul>
          </PageShell>
        )}

        {page === 'name' && (
          <PageShell icon={<UserIcon />} title="What's your name?" subtitle="Enter your name exactly as it appears on your PAN card.">
            <div className="space-y-3 pt-4">
              <BigField label="First name" value={firstName} onChange={setFirstName} />
              <BigField label="Last name"  value={lastName}  onChange={setLastName} />
            </div>
          </PageShell>
        )}

        {page === 'contact' && (
          <PageShell icon={<MailIcon />} title="How can we reach you?" subtitle="We'll send transaction updates to your email and phone.">
            <div className="space-y-3 pt-4">
              <BigField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@gmail.com" />
              <PhoneField phone={phone} onPhone={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} dialCode={dialCode} onDialCode={setDialCode} />
            </div>
          </PageShell>
        )}

        {page === 'bornWhen' && (
          <PageShell icon={<CalendarIcon />} title="Your date of birth" subtitle="Pick the date exactly as it appears on your PAN card.">
            <div className="pt-4">
              <DatePickerField label="Date of birth" iso={dobIso} onIso={setDobIso} />
            </div>
          </PageShell>
        )}

        {page === 'about' && (
          <PageShell icon={<BadgeIcon />} title="Tell us about yourself" subtitle="A few quick details required by the payments partner.">
            <div className="space-y-5 pt-4">
              <LabeledSection label="Gender">
                <div className="grid grid-cols-3 gap-2">
                  {(['male', 'female', 'other'] as const).map((g) => (
                    <GenderChip key={g} label={g[0].toUpperCase() + g.slice(1)} selected={gender === g} onClick={() => setGender(g)} />
                  ))}
                </div>
              </LabeledSection>
              <LabeledSection label="Occupation">
                <CardPicker options={[...OCCUPATIONS]} value={occupation} onChange={setOccupation} />
              </LabeledSection>
              <LabeledSection label="Annual income">
                <CardPicker options={[...INCOMES]} value={income} onChange={setIncome} />
              </LabeledSection>
              <LabeledSection label="Country">
                <div className="flex items-center gap-3 rounded-2xl bg-white border-2 border-emerald-500 p-3">
                  <span className="text-xl">🇮🇳</span>
                  <span className="text-black">India</span>
                  <span className="flex-1" />
                  <CheckCircleIcon className="text-emerald-500" />
                </div>
              </LabeledSection>
            </div>
          </PageShell>
        )}

        {page === 'pan' && (
          <PageShell icon={<CardIcon />} title="Enter your PAN card" subtitle="Copy these exactly as printed on the card — name spelling and DOB must match India's tax records.">
            <div className="space-y-3 pt-4">
              <BigField label="PAN number (10 characters)" value={panNumber} onChange={(v) => setPanNumber(v.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
              <BigField label="Name on card" value={panName} onChange={setPanName} placeholder="e.g. RAHUL KUMAR SHARMA" />
              <DatePickerField label="Date of birth" iso={panDobIso} onIso={setPanDobIso} />
            </div>
          </PageShell>
        )}

        {page === 'aadhaar' && (
          <PageShell icon={<UploadIcon />} title="Upload your Aadhaar" subtitle="The DigiLocker XML verifies fastest, but a clear photo or PDF of your card also works.">
            <div className="space-y-3 pt-4">
              <DropZone
                icon={aadhaarName ? <CheckCircleIcon /> : <UploadIcon />}
                title={aadhaarName || 'Choose Aadhaar file'}
                subtitle={aadhaarName ? 'Ready to upload' : 'XML, ZIP, JPG, PNG, or PDF'}
                selected={!!aadhaarName}
                onClick={() => aadhaarFileRef.current?.click()}
              />
              <input
                ref={aadhaarFileRef}
                type="file"
                accept=".xml,.zip,.pdf,image/*"
                className="hidden"
                onChange={(e) => setAadhaarName(e.target.files?.[0]?.name ?? '')}
              />
              <InfoTile>
                Pro tip: DigiLocker → Aadhaar → Share as XML → set a 4-digit code → download the ZIP.
                That's the fastest path to verified.
              </InfoTile>
            </div>
          </PageShell>
        )}

        {page === 'selfie' && (
          <PageShell icon={<CameraIcon />} title="Take a selfie" subtitle="Front-facing, well-lit, plain background. We'll match it against your Aadhaar photo.">
            <div className="space-y-3 pt-4">
              <DropZone
                icon={selfieName ? <CheckCircleIcon /> : <CameraIcon />}
                title={selfieName || 'Choose a selfie'}
                subtitle={selfieName ? 'Ready to upload' : 'From your camera or files'}
                selected={!!selfieName}
                onClick={() => selfieFileRef.current?.click()}
              />
              <input
                ref={selfieFileRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => setSelfieName(e.target.files?.[0]?.name ?? '')}
              />
              <InfoTile>
                For best results: no mask, no sunglasses, face fully lit, blank wall behind you.
              </InfoTile>
            </div>
          </PageShell>
        )}

        {page === 'checking' && (
          <div className="flex flex-col items-center gap-5 pt-16">
            <div className="w-32 h-32 rounded-full bg-emerald-500/20 grid place-items-center">
              <Spinner className="text-emerald-500 w-14 h-14" />
            </div>
            <div className="text-center px-6 space-y-2">
              <h2 className="text-xl font-medium text-black">Verifying your identity</h2>
              <p className="text-sm text-black/60">
                This usually takes a few seconds. We'll show the result here as soon as it's done.
              </p>
            </div>
            {status?.kyc_status === 'manual_review' && (
              <div className="max-w-sm px-6 pt-2">
                <InfoTile>
                  Under manual review by our partner. This can take a few hours — we'll notify you when it's done.
                </InfoTile>
              </div>
            )}
          </div>
        )}

        {page === 'verified' && (
          <OutcomePage
            iconBg="bg-emerald-500/20" iconFg="text-emerald-500" icon={<CheckCircleIcon size={64} />}
            title="You're verified"
            subtitle="All set. You can now withdraw your USDC rewards to your bank."
            primary="Start using PathPulse"
            onPrimary={() => { setPage('welcome'); }}
          />
        )}

        {page === 'rejected' && (
          <OutcomePage
            iconBg="bg-red-50" iconFg="text-red-600" icon={<WarnIcon size={64} />}
            title="We couldn't verify you"
            subtitle="Something didn't match. Try again with clearer documents — usually a name spelling mismatch on PAN, or a low-quality Aadhaar upload."
            primary="Start over"
            onPrimary={doCleanupAndRetry}
          />
        )}
      </div>

      {/* Sticky CTA */}
      {action && (
        <div className="fixed left-0 right-0 bottom-0 border-t border-black/5 bg-[#F3F7F5]">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <button
              type="button"
              onClick={performAction}
              disabled={!actionEnabled || submitting}
              className="w-full h-14 rounded-full bg-black text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:bg-black/40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {submitting ? action.busy : action.label}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Wizard chrome ─────────────────────────────────────────────

function previousPage(p: WizardPage): WizardPage | null {
  switch (p) {
    case 'welcome':  return null;
    case 'name':     return 'welcome';
    case 'contact':  return 'name';
    case 'bornWhen': return 'contact';
    case 'about':    return 'bornWhen';
    case 'pan':      return 'about';
    case 'aadhaar':  return 'pan';
    case 'selfie':   return 'aadhaar';
    default:         return null;
  }
}

function navTitle(p: WizardPage): string {
  switch (p) {
    case 'welcome': return 'Verification';
    case 'name': case 'contact': case 'bornWhen': case 'about': return 'About you';
    case 'pan':     return 'PAN card';
    case 'aadhaar': return 'Aadhaar';
    case 'selfie':  return 'Selfie';
    case 'checking': return 'Verifying';
    case 'verified': case 'rejected': return 'Verification';
  }
}

function actionFor(p: WizardPage): { label: string; busy: string } | null {
  switch (p) {
    case 'welcome':  return { label: 'Get started',    busy: 'Get started' };
    case 'name': case 'contact': case 'bornWhen': return { label: 'Continue', busy: 'Continue' };
    case 'about':    return { label: 'Continue',       busy: 'Saving…' };
    case 'pan':      return { label: 'Verify PAN',     busy: 'Checking…' };
    case 'aadhaar':  return { label: 'Upload Aadhaar', busy: 'Uploading…' };
    case 'selfie':   return { label: 'Upload photo',   busy: 'Uploading…' };
    default:         return null;
  }
}

// ─── Reusable chunks ───────────────────────────────────────────

function PageShell({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-6 px-2">
      <div className="w-24 h-24 rounded-full bg-emerald-500/20 grid place-items-center text-emerald-900">
        {icon}
      </div>
      <h2 className="text-2xl font-medium text-black text-center tracking-tight">{title}</h2>
      <p className="text-sm text-black/60 text-center max-w-md">{subtitle}</p>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid place-items-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-900 shrink-0">
        <CheckIcon size={14} />
      </span>
      <span className="text-sm text-black/70">{children}</span>
    </li>
  );
}

function BigField({
  label, value, onChange, placeholder, type = 'text', maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-black/50 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="h-14 w-full rounded-2xl border border-black/10 bg-white px-4 text-base text-black placeholder:text-black/30 focus:outline-none focus:border-black/30"
      />
    </label>
  );
}

function PhoneField({
  phone, onPhone, dialCode, onDialCode,
}: {
  phone: string; onPhone: (v: string) => void;
  dialCode: string; onDialCode: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = DIAL_CODES.find((c) => c.code === dialCode) ?? DIAL_CODES[0];
  return (
    <div>
      <span className="block text-xs text-black/50 mb-1">Phone</span>
      <div className="flex gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="h-14 min-w-[110px] px-3 rounded-2xl border border-black/10 bg-white flex items-center gap-2 text-black hover:bg-black/[.02]"
          >
            <span className="text-lg">{current.flag}</span>
            <span>+{current.code}</span>
            <ChevronIcon dir="down" size={14} />
          </button>
          {open && (
            <div className="absolute z-10 top-16 left-0 w-56 rounded-xl bg-white shadow-lg border border-black/5 overflow-hidden">
              {DIAL_CODES.map((c) => (
                <button
                  key={`${c.code}-${c.name}`}
                  type="button"
                  onClick={() => { onDialCode(c.code); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-black/5"
                >
                  <span className="text-lg">{c.flag}</span>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-black/50">+{c.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="tel"
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="9XXXXXXXXX"
          inputMode="numeric"
          className="flex-1 h-14 rounded-2xl border border-black/10 bg-white px-4 text-base text-black placeholder:text-black/30 focus:outline-none focus:border-black/30"
        />
      </div>
    </div>
  );
}

function DatePickerField({ label, iso, onIso }: { label: string; iso: string; onIso: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-black/50 mb-1">{label}</span>
      <input
        type="date"
        value={iso}
        onChange={(e) => onIso(e.target.value)}
        min={minDobIso()}
        max={maxDobIso()}
        className="h-14 w-full rounded-2xl border border-black/10 bg-white px-4 text-base text-black focus:outline-none focus:border-black/30"
      />
    </label>
  );
}

function LabeledSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-black/70">{label}</p>
      {children}
    </div>
  );
}

function GenderChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-20 rounded-2xl flex flex-col items-center justify-center gap-1 border-2 transition-colors ${
        selected
          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-900'
          : 'bg-white border-black/5 text-black hover:bg-black/[.02]'
      }`}
    >
      <UserIcon size={22} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function CardPicker({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            type="button"
            key={opt}
            onClick={() => onChange(opt)}
            className={`w-full flex items-center justify-between p-3 rounded-2xl border-2 transition-colors ${
              selected ? 'bg-emerald-500/20 border-emerald-500' : 'bg-white border-black/5 hover:bg-black/[.02]'
            }`}
          >
            <span className="text-base text-black">{opt}</span>
            {selected
              ? <CheckCircleIcon className="text-emerald-500" />
              : <span className="w-5 h-5 rounded-full border-2 border-black/15" />}
          </button>
        );
      })}
    </div>
  );
}

function DropZone({ icon, title, subtitle, selected, onClick }: {
  icon: React.ReactNode; title: string; subtitle: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-colors ${
        selected ? 'border-emerald-500 bg-white' : 'border-black/5 bg-white hover:bg-black/[.02]'
      }`}
    >
      <div className={`w-14 h-14 rounded-full grid place-items-center shrink-0 ${
        selected ? 'bg-emerald-500/20 text-emerald-500' : 'bg-black/5 text-black/70'
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base text-black truncate">{title}</p>
        <p className="text-xs text-black/50">{subtitle}</p>
      </div>
      <ChevronIcon dir="right" size={14} className="text-black/40" />
    </button>
  );
}

function InfoTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 rounded-2xl bg-emerald-500/10 text-black/70 text-sm">
      <span className="text-emerald-500 shrink-0"><BulbIcon /></span>
      <p>{children}</p>
    </div>
  );
}

function OutcomePage({
  iconBg, iconFg, icon, title, subtitle, primary, onPrimary,
}: {
  iconBg: string; iconFg: string; icon: React.ReactNode;
  title: string; subtitle: string; primary: string; onPrimary: () => void;
}) {
  return (
    <div className="flex flex-col items-center pt-16 px-6 gap-5">
      <div className={`w-32 h-32 rounded-full grid place-items-center ${iconBg} ${iconFg}`}>{icon}</div>
      <h2 className="text-2xl font-medium text-black text-center">{title}</h2>
      <p className="text-sm text-black/60 text-center max-w-md">{subtitle}</p>
      <button
        type="button"
        onClick={onPrimary}
        className="w-full max-w-md h-14 rounded-full bg-black text-white text-sm font-semibold mt-4"
      >
        {primary}
      </button>
    </div>
  );
}

// ─── Icons (inline SVG — matches the app icon vibe) ────────────

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function ShieldIcon()   { return <IconSvg size={44} paths={<path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3Z" fill="currentColor" />} />; }
function UserIcon({ size = 44 }: { size?: number }) {
  return <IconSvg size={size} paths={<><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor" /></>} />;
}
function MailIcon()     { return <IconSvg size={44} paths={<><rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" /><path d="m3 7 9 7 9-7" stroke="white" strokeWidth="2" fill="none" /></>} />; }
function CalendarIcon() { return <IconSvg size={44} paths={<><rect x="3" y="5" width="18" height="16" rx="2" fill="currentColor" /><path d="M8 3v4M16 3v4M3 10h18" stroke="white" strokeWidth="2" fill="none" /></>} />; }
function BadgeIcon()    { return <IconSvg size={44} paths={<><rect x="4" y="4" width="16" height="16" rx="4" fill="currentColor" /><circle cx="12" cy="10" r="3" fill="white" /><path d="M6 20c0-3 2.5-5 6-5s6 2 6 5" fill="white" /></>} />; }
function CardIcon()     { return <IconSvg size={44} paths={<><rect x="2" y="5" width="20" height="14" rx="2" fill="currentColor" /><path d="M2 10h20" stroke="white" strokeWidth="2" /></>} />; }
function UploadIcon({ size = 44 }: { size?: number }) {
  return <IconSvg size={size} paths={<><path d="M12 3v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><path d="m7 8 5-5 5 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" /></>} />;
}
function CameraIcon({ size = 44 }: { size?: number }) {
  return <IconSvg size={size} paths={<><path d="M4 8h4l2-2h4l2 2h4v11H4z" fill="currentColor" /><circle cx="12" cy="14" r="4" fill="white" /></>} />;
}
function CheckIcon({ size = 22 }: { size?: number }) {
  return <IconSvg size={size} paths={<path d="m5 12 5 5 9-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />} />;
}
function CheckCircleIcon({ size = 22, className }: { size?: number; className?: string }) {
  return <IconSvg size={size} className={className} paths={<><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="m7 12 3 3 7-7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>} />;
}
function WarnIcon({ size = 22, className }: { size?: number; className?: string }) {
  return <IconSvg size={size} className={className} paths={<><path d="m12 3 10 18H2Z" fill="currentColor" /><path d="M12 10v5M12 18v.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" /></>} />;
}
function BulbIcon() {
  return <IconSvg size={18} paths={<><path d="M9 21h6M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M12 3a6 6 0 0 0-4 10.5c1 1 1.5 2 1.5 3.5h5c0-1.5.5-2.5 1.5-3.5A6 6 0 0 0 12 3Z" fill="currentColor" /></>} />;
}
function ChevronIcon({ dir, size = 20, className }: { dir: 'left' | 'right' | 'down'; size?: number; className?: string }) {
  const rot = dir === 'left' ? 180 : dir === 'down' ? 90 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={{ transform: `rotate(${rot}deg)` }}>
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconSvg({ size, className, paths }: { size: number; className?: string; paths: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {paths}
    </svg>
  );
}
