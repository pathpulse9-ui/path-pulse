'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * Carret Infra KYC flow (D4 · dev-onboarding).
 *
 * Two entry points: create a fresh sub-account, or point at an existing
 * pending account_id. Then walks initiate → PAN JSON → Aadhaar XML file →
 * selfie → poll status. Backend proxies every call so the API-KEY never
 * touches the browser.
 */

type Step = 'account' | 'initiate' | 'pan' | 'aadhaar' | 'selfie' | 'polling' | 'done';
type StepState = 'idle' | 'busy' | 'success' | 'error';

interface StepStatus {
  state: StepState;
  message?: string;
}

const OCCUPATIONS = [
  'Private Job',
  'Goverment Job', // sic — Carret's enum
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

const INPUT_CLASS =
  'rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 py-2 text-sm w-full focus:outline-none focus:border-black/30';

const LABEL_CLASS = 'block text-black/50 text-xs mb-1';

export default function KycPage() {
  const [accountId, setAccountId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState<CarretKycStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const [steps, setSteps] = useState<Record<Step, StepStatus>>({
    account: { state: 'idle' },
    initiate: { state: 'idle' },
    pan: { state: 'idle' },
    aadhaar: { state: 'idle' },
    selfie: { state: 'idle' },
    polling: { state: 'idle' },
    done: { state: 'idle' },
  });
  const set = useCallback((step: Step, s: StepStatus) => {
    setSteps((prev) => ({ ...prev, [step]: s }));
  }, []);

  // ── Section 1: sub-account (create fresh OR use existing) ──
  const [subFirstName, setSubFirstName] = useState('');
  const [subLastName, setSubLastName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [subPhone, setSubPhone] = useState('');
  const [subDob, setSubDob] = useState(''); // dd/mm/yyyy
  const [subCountry, setSubCountry] = useState('IN');
  const [subGender, setSubGender] = useState<'male' | 'female' | 'other'>('male');
  const [subOccupation, setSubOccupation] = useState<string>('Business Owner');
  const [subIncome, setSubIncome] = useState<string>('₹5 Lakhs-₹10 Lakhs');

  async function handleCreateSubAccount() {
    set('account', { state: 'busy', message: 'Registering sub-account with Carret…' });
    try {
      const input: CarretSubAccountInput = {
        email: subEmail,
        phone_number: subPhone.replace(/\+/g, ''),
        first_name: subFirstName,
        last_name: subLastName,
        dob: subDob,
        country: subCountry,
        gender: subGender,
        occupation: subOccupation,
        annual_income: subIncome,
      };
      const acc = await createCarretSubAccount(input);
      setAccountId(String(acc.id));
      set('account', {
        state: 'success',
        message: `Sub-account ${acc.id} · ref ${acc.reference_id} · kyc_status: ${acc.kyc_status}`,
      });
    } catch (e) {
      set('account', {
        state: 'error',
        message: e instanceof Error ? e.message : 'Failed to create sub-account',
      });
    }
  }

  // ── Section 2: initiate KYC session ──
  async function handleInitiate() {
    if (!accountId) return;
    set('initiate', { state: 'busy', message: 'Requesting KYC session…' });
    try {
      const r = await initiateCarretKyc(accountId);
      setSessionId(r.session.session_id);
      set('initiate', {
        state: 'success',
        message: `Session ${r.session.session_id} · status ${r.session.status}`,
      });
    } catch (e) {
      set('initiate', {
        state: 'error',
        message: e instanceof Error ? e.message : 'Failed to initiate KYC',
      });
    }
  }

  // ── Section 3: PAN (JSON) ──
  const [panNumber, setPanNumber] = useState('');
  const [panName, setPanName] = useState('');
  const [panDob, setPanDob] = useState(''); // dd/mm/yyyy

  async function handleSubmitPan() {
    if (!sessionId) return;
    set('pan', { state: 'busy', message: 'Verifying PAN against NSDL…' });
    try {
      await submitCarretKycDocument(sessionId, {
        document_type: 'pan',
        document_number: panNumber.toUpperCase(),
        name: panName,
        dob: panDob,
      });
      set('pan', { state: 'success', message: 'PAN accepted by Carret.' });
    } catch (e) {
      set('pan', {
        state: 'error',
        message: e instanceof Error ? e.message : 'PAN submission failed',
      });
    }
  }

  // ── Section 4: Aadhaar XML ──
  const aadhaarFileRef = useRef<HTMLInputElement>(null);

  async function handleSubmitAadhaar() {
    if (!sessionId) return;
    const file = aadhaarFileRef.current?.files?.[0];
    if (!file) {
      set('aadhaar', { state: 'error', message: 'Choose an Aadhaar XML file first.' });
      return;
    }
    set('aadhaar', { state: 'busy', message: 'Uploading Aadhaar XML to Carret…' });
    try {
      await uploadCarretKycFile({
        kycSession: sessionId,
        docType: 'aadhaar',
        fileType: 'xml',
        file,
      });
      set('aadhaar', { state: 'success', message: `Aadhaar XML "${file.name}" uploaded.` });
    } catch (e) {
      set('aadhaar', {
        state: 'error',
        message: e instanceof Error ? e.message : 'Aadhaar upload failed',
      });
    }
  }

  // ── Section 5: Selfie ──
  const selfieRef = useRef<HTMLInputElement>(null);

  async function handleSubmitSelfie() {
    if (!sessionId) return;
    const file = selfieRef.current?.files?.[0];
    if (!file) {
      set('selfie', { state: 'error', message: 'Choose a selfie image first.' });
      return;
    }
    set('selfie', { state: 'busy', message: 'Uploading selfie — face match starts server-side…' });
    try {
      await uploadCarretKycFile({
        kycSession: sessionId,
        docType: 'selfie',
        fileType: 'image',
        file,
      });
      set('selfie', {
        state: 'success',
        message: `Selfie "${file.name}" uploaded. Face-match running at Carret.`,
      });
      set('polling', { state: 'busy', message: 'Polling KYC status every 3s…' });
    } catch (e) {
      set('selfie', {
        state: 'error',
        message: e instanceof Error ? e.message : 'Selfie upload failed',
      });
    }
  }

  // ── Polling GET /kyc/{account_id}/ every 3s once selfie is in ──
  useEffect(() => {
    if (steps.polling.state !== 'busy' || !accountId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getCarretKycStatus(accountId);
        if (cancelled) return;
        setStatus(s);
        setPollError(null);
        if (s.kyc_status === 'verified') {
          set('polling', { state: 'success', message: 'KYC verified ✔' });
          set('done', { state: 'success', message: 'All done — this sub-account is off-ramp ready.' });
        } else if (s.kyc_status === 'rejected') {
          set('polling', { state: 'error', message: 'Rejected. Use Cleanup and retry with corrected docs.' });
        } else if (s.kyc_status === 'manual_review') {
          set('polling', {
            state: 'busy',
            message: 'Flagged for manual review at Carret — waiting on their team.',
          });
        }
      } catch (e) {
        if (!cancelled) setPollError(e instanceof Error ? e.message : 'poll failed');
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [steps.polling.state, accountId, set]);

  // ── Cleanup (retry a failed session) ──
  async function handleCleanup() {
    if (!accountId) return;
    try {
      await cleanupCarretKyc(accountId);
      setSessionId('');
      setStatus(null);
      setSteps({
        account: steps.account,
        initiate: { state: 'idle' },
        pan: { state: 'idle' },
        aadhaar: { state: 'idle' },
        selfie: { state: 'idle' },
        polling: { state: 'idle' },
        done: { state: 'idle' },
      });
    } catch (e) {
      console.error(e);
    }
  }

  const isSelfieDone = steps.selfie.state === 'success';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 space-y-2">
        <h1 className="text-black text-2xl font-medium tracking-[-0.02em]">Driver KYC</h1>
        <p className="text-sm text-black/50">
          Runs the real Carret Infra KYC pipeline: PAN → Aadhaar XML → Selfie → face-match. Documents
          verify against NSDL + UIDAI. Not a mock.
        </p>
      </div>

      {/* Section 1 — Sub-account */}
      <SectionCard num={1} title="Sub-account" state={steps.account}>
        <p className="text-xs text-black/50 mb-4">
          KYC runs against a Carret sub-account. Create a fresh one below, or paste an existing
          <code className="mx-1 rounded bg-black/5 px-1 py-0.5">pending</code> account id.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>First name</label>
            <input className={INPUT_CLASS} value={subFirstName} onChange={(e) => setSubFirstName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Last name</label>
            <input className={INPUT_CLASS} value={subLastName} onChange={(e) => setSubLastName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Email</label>
            <input className={INPUT_CLASS} value={subEmail} onChange={(e) => setSubEmail(e.target.value)} placeholder="you+kyc@gmail.com" />
          </div>
          <div>
            <label className={LABEL_CLASS}>Phone (12 char, no +)</label>
            <input className={INPUT_CLASS} value={subPhone} onChange={(e) => setSubPhone(e.target.value)} placeholder="919XXXXXXXXX" />
          </div>
          <div>
            <label className={LABEL_CLASS}>DOB (dd/mm/yyyy)</label>
            <input className={INPUT_CLASS} value={subDob} onChange={(e) => setSubDob(e.target.value)} placeholder="18/04/2003" />
          </div>
          <div>
            <label className={LABEL_CLASS}>Country</label>
            <input className={INPUT_CLASS} value={subCountry} onChange={(e) => setSubCountry(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Gender</label>
            <select
              className={INPUT_CLASS}
              value={subGender}
              onChange={(e) => setSubGender(e.target.value as 'male' | 'female' | 'other')}
            >
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="other">other</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Occupation</label>
            <select className={INPUT_CLASS} value={subOccupation} onChange={(e) => setSubOccupation(e.target.value)}>
              {OCCUPATIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLASS}>Annual income</label>
            <select className={INPUT_CLASS} value={subIncome} onChange={(e) => setSubIncome(e.target.value)}>
              {INCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-3">
          <button onClick={handleCreateSubAccount} disabled={steps.account.state === 'busy'} className={PRIMARY_BTN}>
            {steps.account.state === 'busy' ? 'Creating…' : 'Register sub-account'}
          </button>
          <div className="flex-1 min-w-52">
            <label className={LABEL_CLASS}>…or paste an existing pending account_id</label>
            <input
              className={INPUT_CLASS}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="48560"
            />
          </div>
        </div>
      </SectionCard>

      {/* Section 2 — Initiate */}
      <SectionCard num={2} title="Initiate KYC session" state={steps.initiate}>
        <button onClick={handleInitiate} disabled={!accountId || steps.initiate.state === 'busy'} className={PRIMARY_BTN}>
          {steps.initiate.state === 'busy' ? 'Initiating…' : `Initiate KYC on ${accountId || '…'}`}
        </button>
        {sessionId && (
          <p className="text-xs text-black/50 mt-2">
            Session id: <span className="font-mono text-black">{sessionId}</span>
          </p>
        )}
      </SectionCard>

      {/* Section 3 — PAN */}
      <SectionCard num={3} title="PAN — number-based" state={steps.pan}>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLASS}>PAN number</label>
            <input
              className={INPUT_CLASS}
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
              placeholder="ABCDE1234F"
              maxLength={10}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Name (exactly as on card)</label>
            <input className={INPUT_CLASS} value={panName} onChange={(e) => setPanName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLASS}>DOB (dd/mm/yyyy)</label>
            <input className={INPUT_CLASS} value={panDob} onChange={(e) => setPanDob(e.target.value)} placeholder="18/04/2003" />
          </div>
        </div>
        <button onClick={handleSubmitPan} disabled={!sessionId || steps.pan.state === 'busy'} className={PRIMARY_BTN + ' mt-3'}>
          {steps.pan.state === 'busy' ? 'Verifying…' : 'Submit PAN'}
        </button>
      </SectionCard>

      {/* Section 4 — Aadhaar XML */}
      <SectionCard num={4} title="Aadhaar — XML file (from DigiLocker)" state={steps.aadhaar}>
        <p className="text-xs text-black/50 mb-3">
          Download from DigiLocker → Aadhaar → Share as XML. Upload the ZIP file below. The
          4-digit share code you set is embedded in the XML for Carret to verify.
        </p>
        <input ref={aadhaarFileRef} type="file" accept=".xml,.zip,application/xml,application/zip" className="text-sm text-black" />
        <div className="mt-3">
          <button onClick={handleSubmitAadhaar} disabled={!sessionId || steps.aadhaar.state === 'busy'} className={PRIMARY_BTN}>
            {steps.aadhaar.state === 'busy' ? 'Uploading…' : 'Submit Aadhaar XML'}
          </button>
        </div>
      </SectionCard>

      {/* Section 5 — Selfie */}
      <SectionCard num={5} title="Selfie — face match" state={steps.selfie}>
        <p className="text-xs text-black/50 mb-3">
          Front-facing, well-lit, plain background. Carret runs face-match against the photo
          inside your Aadhaar XML.
        </p>
        <input ref={selfieRef} type="file" accept="image/*" capture="user" className="text-sm text-black" />
        <div className="mt-3">
          <button onClick={handleSubmitSelfie} disabled={!sessionId || steps.selfie.state === 'busy'} className={PRIMARY_BTN}>
            {steps.selfie.state === 'busy' ? 'Uploading…' : 'Submit selfie'}
          </button>
        </div>
      </SectionCard>

      {/* Section 6 — Status */}
      {(isSelfieDone || status) && (
        <SectionCard num={6} title="Final KYC status" state={steps.polling}>
          {status ? (
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-black/50">kyc_status:</span>{' '}
                <StatusPill label={status.kyc_status} />
              </div>
              {status.kyc_session && (
                <div className="text-xs">
                  <span className="text-black/50">session:</span>{' '}
                  <span className="font-mono">{status.kyc_session}</span>
                </div>
              )}
              {status.ovd_documents && status.ovd_documents.length > 0 && (
                <div>
                  <div className="text-xs text-black/50 mb-1">Documents:</div>
                  <ul className="text-xs space-y-1">
                    {status.ovd_documents.map((d, i) => (
                      <li key={i} className="font-mono">
                        {d.document_type} · {d.status ?? 'no-status'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-black/50">Waiting for first poll…</p>
          )}
          {pollError && <p className="text-xs text-red-600 mt-2">Poll error: {pollError}</p>}
          <div className="pt-3">
            <button onClick={handleCleanup} className={SECONDARY_BTN}>
              Cleanup & retry
            </button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

const PRIMARY_BTN =
  'bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed';
const SECONDARY_BTN =
  'border border-black/10 text-black text-sm px-4 py-1.5 rounded-full hover:bg-black/5 transition-colors duration-200';

function SectionCard({
  num,
  title,
  state,
  children,
}: {
  num: number;
  title: string;
  state: StepStatus;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
          <span className="text-black/40 mr-2">{num}.</span>
          {title}
        </h2>
        <StepBadge state={state} />
      </div>
      {state.message && (
        <p className={`text-xs ${state.state === 'error' ? 'text-red-600' : 'text-black/60'}`}>
          {state.message}
        </p>
      )}
      {children}
    </div>
  );
}

function StepBadge({ state }: { state: StepStatus }) {
  if (state.state === 'idle') return null;
  const cls =
    state.state === 'success'
      ? 'bg-green-100 text-green-700 border-green-300'
      : state.state === 'busy'
      ? 'bg-blue-100 text-blue-700 border-blue-300'
      : 'bg-red-100 text-red-700 border-red-300';
  const label = state.state === 'success' ? 'Done' : state.state === 'busy' ? 'Running…' : 'Error';
  return <span className={`text-xs rounded-full border px-2 py-0.5 ${cls}`}>{label}</span>;
}

function StatusPill({ label }: { label: string }) {
  const cls =
    label === 'verified'
      ? 'bg-green-100 text-green-700 border-green-300'
      : label === 'rejected'
      ? 'bg-red-100 text-red-700 border-red-300'
      : label === 'manual_review'
      ? 'bg-amber-100 text-amber-700 border-amber-300'
      : 'bg-blue-100 text-blue-700 border-blue-300';
  return <span className={`text-xs rounded-full border px-2 py-0.5 ${cls}`}>{label}</span>;
}
