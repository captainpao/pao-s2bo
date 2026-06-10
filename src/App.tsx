import { useState, useRef, useEffect } from 'react';
import { processDocumentPack, processIdDocument, processMandateDocument, sendChatMessage, type ChatMessage, type ChatContext } from './lib/claude';
import scLogoRaw from './assets/logo.svg?raw';
import { Check, ChevronRight, ChevronLeft, FileText, Save, Eye, Users, User, UserCheck, Mail, Building2, MapPin, Phone, Briefcase, X, Upload, AlertCircle, Sparkles, Plus, Trash2, CreditCard, Shield, Edit3, Send, RotateCcw, BadgeCheck, Bot } from 'lucide-react';

/* ─── Domain types ─── */
type EntityId = 'meridian' | 'aurelius';
type SectionId = 'start' | 'company' | 'compliance' | 'accounts' | 'mandate' | 's2b' | 'documents' | 'review';
type AppStatus = 'client-draft' | 'bank-review' | 'awaiting-signatures' | 'activated';
type SpecMode = 'a' | 'b';
type ComplianceSubId = 'country' | 'kyc-narrative' | 'kyc-questions' | 'declarations';
type SigningRule = 'any-one' | 'any-two' | 'categories' | 'custom' | null;
type SpecType = 'spec-a' | 'spec-b' | 'enhanced';

interface ModalConfig {
  title: string;
  body: React.ReactNode;
  footer: React.ReactNode | null;
}

interface Account {
  id: number;
  currency: string;
  purpose: string;
  services: string[];
}

interface Signatory {
  id: number;
  name: string;
  role: string;
  category: string;
  limit: number;
  source?: string;
  acraDirector?: boolean;
}

interface CompanyFields {
  legalName: string;
  uen: string;
  entityType: string;
  incorporated: string;
  address: string;
  industry: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  primaryMarkets: string;
}

interface NarrativeStep {
  classify: string;
  extract: string;
  reconcile: string;
  validate: string;
  apply: string;
  extractedFields?: Partial<CompanyFields>;
}

interface DocIntelState {
  uploadedDocs: string[];
  isProcessing: boolean;
  processingStep: number;
  extractedFields: Partial<CompanyFields>;
  showSidePanel: boolean;
  currentDocId?: string;
  currentNarrative?: NarrativeStep;
}

interface IdUpload {
  idType: string;
  name: string;
  matched: boolean;
  uploaded: boolean;
}

export default function S2BOModule1V2() {
  const [entity, setEntity] = useState<EntityId>('meridian');
  const [section, setSection] = useState<SectionId>('company');
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [delegationChoice, setDelegationChoice] = useState<string | null>(null);
  const [showWhatChanged, setShowWhatChanged] = useState(false);
  const [docIntelState, setDocIntelState] = useState<DocIntelState>({ uploadedDocs: [], isProcessing: false, processingStep: 0, extractedFields: {}, showSidePanel: false });
  const [idUploads, setIdUploads] = useState<Record<string, IdUpload>>({});
  const [appStatus, setAppStatus] = useState<AppStatus>('client-draft');
  const [signingState, setSigningState] = useState<Record<string, string>>({});
  const [complianceSubsection, setComplianceSubsection] = useState<ComplianceSubId>('country');
  const [complianceSubProgress, setComplianceSubProgress] = useState<Record<ComplianceSubId, number>>({ country: 0, 'kyc-narrative': 0, 'kyc-questions': 0, declarations: 0 });
  const [kycNarrative, setKycNarrative] = useState({ businessDescription: '', countriesTraded: '', productsServices: '', turnover: '', duration: '', majorClients: '', majorSuppliers: '', mainCompetitors: '', sourceOfFunds: '' });
  const [kycQuestionsState, setKycQuestionsState] = useState<{ currentIdx: number; answers: Record<string, string>; followups: Record<string, string> }>({ currentIdx: 0, answers: {}, followups: {} });

  const [mandateStep, setMandateStep] = useState(1);
  const [signingRule, setSigningRule] = useState<SigningRule>(null);
  const [signatories, setSignatories] = useState<Signatory[]>([]);

  const [mandateMode, setMandateMode] = useState<string>('chooser');
  const [mandateAiStage, setMandateAiStage] = useState(0);

  // Spec mode master toggle. 'a' = foundation (AI hidden), 'b' = AI-embedded
  const [specMode, setSpecMode] = useState<SpecMode>('b');

  const MANDATE_AI = {
    documentName: 'Board Mandate - 15 March 2026.pdf',
    boardResRef: 'BR-2026-014',
    signatories: [
      { id: 101, name: 'Alice Smith', role: 'Head of Finance', category: 'A', limit: 50000, source: 'Listed in Board Resolution', acraDirector: false },
      { id: 102, name: 'David Tan', role: 'CFO', category: 'A', limit: 500000, source: 'Director in ACRA, matched', acraDirector: true },
      { id: 103, name: 'Priya Krishnan', role: 'Treasury Manager', category: 'B', limit: 25000, source: 'Listed in Board Resolution', acraDirector: false },
      { id: 104, name: 'Marcus Lim', role: 'Operations Director', category: 'B', limit: 25000, source: 'Director in ACRA, matched', acraDirector: true }
    ],
    rules: [
      { tier: 'Tier 1', label: 'Standard payments', limit: 'Up to S$50,000', rule: 'Any one signatory', services: 'Domestic payments, payroll, vendor payments', rawText: 'For domestic payments, payroll and vendor payments not exceeding SGD 50,000 in aggregate per transaction, any one (1) Authorised Signatory may sign on behalf of the Company.' },
      { tier: 'Tier 2', label: 'High value', limit: 'S$50,001 to S$500,000', rule: 'Any two signatories jointly', services: 'Domestic and cross-border payments', rawText: 'For transactions between SGD 50,001 and SGD 500,000, any two (2) of the Authorised Signatories shall sign jointly.' },
      { tier: 'Tier 3', label: 'Above threshold', limit: 'Above S$500,000', rule: 'CFO + any one other', services: 'All services', rawText: 'For any transaction exceeding SGD 500,000, the signature of the CFO (David Tan) together with any one other Authorised Signatory shall be required.' },
      { tier: 'FX carve-out', label: 'Foreign exchange', limit: 'FX > S$100,000', rule: 'CFO co-signature', services: 'Foreign exchange transactions', rawText: 'Notwithstanding the above, any foreign exchange transaction exceeding SGD 100,000 shall require the co-signature of the CFO.' }
    ]
  };

  const [accountsList, setAccountsList] = useState<Record<EntityId, Account[]>>({
    meridian: [],
    aurelius: []
  });
  const accounts = accountsList[entity];
  const setAccounts = (newAccounts: Account[]) => setAccountsList(prev => ({ ...prev, [entity]: newAccounts }));

  const [s2bUsers, setS2bUsers] = useState<Array<{ id: number; name: string; email: string; role: string; dailyLimit: number }>>([]);

  const [completion, setCompletion] = useState<Record<EntityId, Record<SectionId, number>>>({
    meridian: { start: 100, company: 40, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 0, review: 0 },
    aurelius: { start: 100, company: 5, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 0, review: 0 }
  });

  const [companyFields, setCompanyFields] = useState<Record<EntityId, CompanyFields>>({
    meridian: { legalName: 'Meridian Trade Solutions Pte. Ltd.', uen: '202512345X', entityType: 'Private Limited Company', incorporated: '12 Jan 2020', address: '123 Anson Road, #05-01, Singapore 079906', industry: 'Commodity wholesale', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '', primaryMarkets: '' },
    aurelius: { legalName: '', uen: '202698765A', entityType: '', incorporated: '3 Apr 2026', address: '', industry: '', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '', primaryMarkets: '' }
  });

  const spvPackInputRef = useRef<HTMLInputElement>(null);
  const docUploadInputRef = useRef<HTMLInputElement>(null);
  const mandateFileInputRef = useRef<HTMLInputElement>(null);

  const fields = companyFields[entity];
  const setField = (key: keyof CompanyFields, value: string) => setCompanyFields(prev => ({ ...prev, [entity]: { ...prev[entity], [key]: value } }));

  const entityData = {
    meridian: { name: 'Meridian Trade Solutions Pte. Ltd.', shortName: 'Meridian Trade Solutions', meta: 'UEN 202512345X · Private Limited · Singapore', products: 'Cash account + S2B online', locations: 'Singapore (primary), UAE', assignedTo: 'Alice Smith (you)', mode: 'Registry-assisted', modeNote: 'ACRA pre-fill available' },
    aurelius: { name: 'Aurelius Maritime SPV Pte. Ltd.', shortName: 'Aurelius Maritime SPV', meta: 'UEN 202698765A · Private Limited · Singapore · Inc. 3 Apr 2026', products: 'Cash account', locations: 'Singapore', assignedTo: 'Alice Smith (you)', mode: 'Fully client-provided', modeNote: 'Newly incorporated, thin registry' }
  };

  const ent = entityData[entity];
  const sectionCompletion = completion[entity];

  const sections: { id: SectionId; label: string }[] = [
    { id: 'start', label: 'Get started' },
    { id: 'company', label: 'Company details' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'mandate', label: 'Mandate & signing' },
    { id: 's2b', label: 'Straight2Bank setup' },
    { id: 'documents', label: 'Documents' },
    { id: 'review', label: 'Review & sign' }
  ];

  const currentSectionIndex = sections.findIndex(s => s.id === section);
  const overallProgress = Math.round(Object.values(sectionCompletion).reduce((a: number, b: number) => a + b, 0) / sections.length);

  const showToast = (message: string) => { setToast(message); setTimeout(() => setToast(null), 3000); };
  const advanceCompletion = (sectionId: SectionId, value: number) => setCompletion(prev => ({ ...prev, [entity]: { ...prev[entity], [sectionId]: value } }));
  const journeyStepState = (sectionId: SectionId, idx: number) => {
    const c = sectionCompletion[sectionId];
    if (sectionId === section) return 'current';
    if (c >= 100) return 'done';
    if (c > 0) return 'partial';
    if (idx <= currentSectionIndex + 1) return 'available';
    return 'locked';
  };
  const formatMoney = (n: number) => 'S$' + n.toLocaleString();

  const runAureliusPack = (files: File[]) => {
    setDocIntelState(prev => ({
      ...prev,
      isProcessing: true,
      processingStep: 1,
      showSidePanel: true,
      currentDocId: 'aurelius-pack',
      currentNarrative: undefined,
    }));
    const s2 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 2 })), 1200);
    const s3 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 3 })), 2400);
    const s4 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 4 })), 3600);

    processDocumentPack(files)
      .then(({ narrative, extractedFields }) => {
        clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
        setDocIntelState(prev => ({
          ...prev,
          processingStep: 5,
          isProcessing: false,
          extractedFields,
          uploadedDocs: [...prev.uploadedDocs, 'incorp', 'constitution', 'board'],
          currentNarrative: narrative,
        }));
        setCompanyFields(prev => ({ ...prev, aurelius: { ...prev.aurelius, ...extractedFields } }));
        advanceCompletion('company', 90);
        advanceCompletion('documents', 75);
        showToast('SPV pack processed. Company Details populated.');
      })
      .catch((err) => {
        clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
        setDocIntelState(prev => ({ ...prev, isProcessing: false, processingStep: 0 }));
        showToast(`Processing error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
  };

  const startDocUploadWithFiles = (files: File[]) => {
    setDocIntelState(prev => ({
      ...prev,
      isProcessing: true,
      processingStep: 1,
      showSidePanel: true,
      currentDocId: 'multi-upload',
      currentNarrative: undefined,
    }));
    const s2 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 2 })), 1200);
    const s3 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 3 })), 2400);
    const s4 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 4 })), 3600);

    processDocumentPack(files)
      .then(({ narrative, extractedFields }) => {
        clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
        const inferredIds = files.flatMap(f => {
          const n = f.name.toLowerCase();
          if (n.includes('incorp') || n.includes('cert')) return ['incorp'];
          if (n.includes('constit') || n.includes('maa') || n.includes('article')) return ['constitution'];
          if (n.includes('board') || n.includes('resolution')) return ['board'];
          return [];
        });
        setDocIntelState(prev => ({
          ...prev,
          processingStep: 5,
          isProcessing: false,
          currentNarrative: narrative,
          uploadedDocs: [...new Set([...prev.uploadedDocs, ...inferredIds])],
        }));
        if (Object.keys(extractedFields).length > 0) {
          setCompanyFields(prev => ({ ...prev, [entity]: { ...prev[entity], ...extractedFields } }));
          advanceCompletion('company', 90);
        }
        showToast('Documents processed.');
      })
      .catch((err) => {
        clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
        setDocIntelState(prev => ({ ...prev, isProcessing: false, processingStep: 0 }));
        showToast(`Processing error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
  };

  const runMandateAi = (file?: File) => {
    setMandateMode('ai-processing');
    setMandateAiStage(1);
    const s2 = setTimeout(() => setMandateAiStage(2), 1200);
    const s3 = setTimeout(() => setMandateAiStage(3), 2400);
    const s4 = setTimeout(() => setMandateAiStage(4), 3600);

    const applyResult = (
      extractedSignatories: typeof MANDATE_AI.signatories,
      _rules: typeof MANDATE_AI.rules,
    ) => {
      clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
      setMandateAiStage(5);
      setSignatories(
        extractedSignatories.map((s, i) => ({
          id: i + 101,
          name: s.name,
          role: s.role,
          category: s.category as 'A' | 'B',
          limit: s.limit,
          source: (s as { source?: string }).source ?? 'Extracted from document',
          acraDirector: (s as { acraDirector?: boolean }).acraDirector ?? false,
        }))
      );
      setSigningRule('categories');
      setMandateMode('ai-extracted');
      showToast('Mandate authorisations extracted.');
    };

    if (!file) {
      setTimeout(() => applyResult(MANDATE_AI.signatories, MANDATE_AI.rules), 4500);
      return;
    }

    processMandateDocument(file)
      .then(({ signatories: sigs, rules }) => {
        const mapped = sigs.map(s => ({
          id: 0,
          name: s.name,
          role: s.role,
          category: s.category,
          limit: s.limit,
          source: 'Extracted from document',
          acraDirector: false,
        }));
        applyResult(mapped as typeof MANDATE_AI.signatories, rules as typeof MANDATE_AI.rules);
      })
      .catch((err) => {
        clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
        setMandateMode('chooser');
        setMandateAiStage(0);
        showToast(`Processing error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
  };

  const Toast = () => toast ? (
    <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-lg shadow-2xl z-50 text-sm flex items-center gap-2 animate-fadein">
      <Check size={16} className="text-green-400" />{toast}
    </div>
  ) : null;

  const Modal = () => {
    if (!modal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-6" onClick={() => setModal(null)}>
        <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">{modal.title}</h3>
            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
          <div className="px-6 py-5 overflow-y-auto flex-1">{modal.body}</div>
          {modal.footer && <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">{modal.footer}</div>}
        </div>
      </div>
    );
  };

  const resetToBaseline = () => {
    setSection('start'); setEntity('meridian'); setDelegationChoice(null); setShowWhatChanged(false);
    setMandateStep(1); setSigningRule(null); setMandateMode('chooser'); setMandateAiStage(0);
    setSignatories([]);
    setAccountsList({ meridian: [], aurelius: [] });
    setS2bUsers([]);
    setCompletion({
      meridian: { start: 100, company: 40, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 0, review: 0 },
      aurelius: { start: 100, company: 5, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 0, review: 0 }
    });
    setCompanyFields({
      meridian: { legalName: 'Meridian Trade Solutions Pte. Ltd.', uen: '202512345X', entityType: 'Private Limited Company', incorporated: '12 Jan 2020', address: '123 Anson Road, #05-01, Singapore 079906', industry: 'Commodity wholesale', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '', primaryMarkets: '' },
      aurelius: { legalName: '', uen: '202698765A', entityType: '', incorporated: '3 Apr 2026', address: '', industry: '', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '', primaryMarkets: '' }
    });
    setComplianceSubsection('country'); setComplianceSubProgress({ country: 0, 'kyc-narrative': 0, 'kyc-questions': 0, declarations: 0 });
    setKycNarrative({ businessDescription: '', countriesTraded: '', productsServices: '', turnover: '', duration: '', majorClients: '', majorSuppliers: '', mainCompetitors: '', sourceOfFunds: '' });
    setKycQuestionsState({ currentIdx: 0, answers: {}, followups: {} });
    setDocIntelState({ uploadedDocs: [], isProcessing: false, processingStep: 0, extractedFields: {}, showSidePanel: false });
    setIdUploads({}); setAppStatus('client-draft'); setSigningState({}); setModal(null);
    showToast('Demo reset to baseline');
  };

  const MissionControl = () => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-4 mx-4 mt-4 md:px-6 md:py-5 md:mx-6 md:mt-5">
      <div className="flex justify-between items-start gap-5 mb-4">
        <div>
          <div className="text-base font-semibold text-slate-900 leading-tight">{ent.name}</div>
          <div className="text-xs text-slate-500 mt-0.5">{ent.meta}</div>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          {appStatus === 'client-draft' ? 'Client draft' : appStatus === 'bank-review' ? 'Bank review' : appStatus === 'awaiting-signatures' ? 'E-signing' : 'Activated'}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 md:gap-4 py-3 border-y border-slate-100">
        <div><div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Products</div><div className="text-xs font-medium text-slate-900">{ent.products}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Booking locations</div><div className="text-xs font-medium text-slate-900">{ent.locations}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Mode</div><div className="text-xs font-medium text-slate-900">{ent.mode}</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xl font-semibold text-blue-600">{overallProgress}%</span>
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-xs">
            <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }}></div>
          </div>
          <span className="text-xs text-slate-500">Last saved just now</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal({
            title: 'Draft application preview',
            body: <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 flex items-start gap-2"><AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" /><div>Watermarked DRAFT preview. Official application downloads after submission and validation only.</div></div>
              <div className="border border-slate-200 rounded-lg p-5 bg-slate-50/50 relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10"><div className="text-6xl font-bold text-slate-900 -rotate-12">DRAFT</div></div>
                <div className="relative">
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Application summary</div>
                  <div className="text-base font-semibold text-slate-900 mb-3">{ent.name}</div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <div>Application ID: APP-{entity === 'meridian' ? 'MER' : 'AUR'}-2026-0001</div>
                    <div>Status: Client Draft ({overallProgress}% complete)</div>
                    <div>Products: {ent.products}</div>
                  </div>
                </div>
              </div>
            </div>,
            footer: <button onClick={() => setModal(null)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-full hover:bg-blue-700">Close</button>
          })} className="px-3 py-1.5 border border-slate-300 rounded-full text-xs font-medium text-slate-700 hover:border-blue-500 hover:text-blue-600 flex items-center gap-1.5"><Eye size={12} />Preview draft</button>
          <button onClick={() => showToast('Application saved.')} className="px-3 py-1.5 border border-slate-300 rounded-full text-xs font-medium text-slate-700 hover:border-blue-500 hover:text-blue-600 flex items-center gap-1.5"><Save size={12} />Save & exit</button>
        </div>
      </div>
    </div>
  );

  const JourneyMap = () => (
    <div className="bg-slate-50 border-r border-slate-200 px-3 py-5 w-44 md:px-4 md:w-52 lg:px-5 lg:py-6 lg:w-60 flex-shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-5">Your journey</div>
      <div className="relative pl-1.5">
        <div className="absolute left-3.5 top-3 bottom-3 w-0.5 bg-slate-200"></div>
        {sections.map((s, idx) => {
          const state = journeyStepState(s.id, idx);
          const c = sectionCompletion[s.id];
          let dotClass = 'bg-white border-slate-300 text-slate-400';
          let labelClass = 'text-slate-400 font-normal';
          let canClick = state !== 'locked';
          if (state === 'done') { dotClass = 'bg-emerald-500 border-emerald-500 text-white'; labelClass = 'text-slate-700 font-medium'; }
          else if (state === 'current') { dotClass = 'bg-blue-600 border-blue-600 text-white shadow-[0_0_0_4px_#dbeafe]'; labelClass = 'text-blue-600 font-semibold'; }
          else if (state === 'partial') { dotClass = 'bg-white border-blue-500 text-blue-500'; labelClass = 'text-slate-700 font-medium'; }
          else if (state === 'available') { dotClass = 'bg-white border-slate-400 text-slate-500'; labelClass = 'text-slate-600 font-medium'; }
          return (
            <button key={s.id} onClick={() => canClick && setSection(s.id)} disabled={!canClick} className={`relative flex items-center gap-3 py-2.5 w-full text-left ${canClick ? 'cursor-pointer hover:bg-white/50 -mx-2 px-2 rounded' : 'cursor-not-allowed'}`}>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold flex-shrink-0 z-10 ${dotClass}`}>{state === 'done' ? <Check size={11} /> : (idx === 0 ? <Check size={11} /> : idx + 1)}</div>
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] ${labelClass}`}>{s.label}</div>
                {state === 'current' && <div className="text-[10px] text-slate-400 mt-0.5">In progress</div>}
                {state === 'partial' && c > 0 && c < 100 && <div className="text-[10px] text-blue-500 mt-0.5">{c}% done</div>}
                {state === 'done' && c === 100 && <div className="text-[10px] text-emerald-600 mt-0.5">Complete</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const Banner = () => (
    <div className="relative overflow-hidden" style={{ background: '#2C3A87' }}>
      <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)' }}></div>
      <div className="px-4 md:px-6 py-3 md:py-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 relative">
        <div className="flex items-center gap-3">
          <div
            className="sc-logo-dark"
            style={{ height: 24, display: 'flex', alignItems: 'center', flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: scLogoRaw }}
          />
          <div className="w-px h-4 bg-white/20 mx-1"></div>
          <div className="text-white text-[13px] font-medium flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Onboarding · {ent.shortName}</div>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <button onClick={() => setModal({
            title: 'Reset demo to baseline?',
            body: <div className="text-sm text-slate-700 space-y-3"><p>Clears all entered data and returns the demo to starting state.</p></div>,
            footer: <><button onClick={() => setModal(null)} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700">Cancel</button><button onClick={resetToBaseline} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700">Reset demo</button></>
          })} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white/80 border border-white/15 hover:bg-white/15"><RotateCcw size={13} /><span className="hidden md:inline">Reset</span></button>
          <button onClick={() => setShowWhatChanged(!showWhatChanged)} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${showWhatChanged ? 'bg-amber-400/90 text-slate-900 border-amber-300' : 'bg-white/10 text-white/80 border-white/15 hover:bg-white/15'}`}><Sparkles size={13} /><span className="hidden md:inline">What's new</span></button>
          <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-lg p-1 border border-white/15">
            <span className="text-[10px] uppercase tracking-wider text-white/60 font-semibold pl-1.5 hidden md:inline">Spec</span>
            <button onClick={() => setSpecMode('a')} className={`px-2.5 md:px-3 py-1 rounded-full text-xs font-medium ${specMode === 'a' ? 'bg-emerald-400 text-slate-900' : 'text-white/80 hover:text-white'}`}>A<span className="ml-1.5 text-[9px] opacity-70 hidden md:inline">Foundation</span></button>
            <button onClick={() => setSpecMode('b')} className={`px-2.5 md:px-3 py-1 rounded-full text-xs font-medium ${specMode === 'b' ? 'bg-amber-400 text-slate-900' : 'text-white/80 hover:text-white'}`}>B<span className="ml-1.5 text-[9px] opacity-70 hidden md:inline">AI-embedded</span></button>
          </div>
          <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-lg p-1 border border-white/15">
            <span className="text-[10px] uppercase tracking-wider text-white/60 font-semibold pl-1.5 hidden md:inline">Entity</span>
            <button onClick={() => setEntity('meridian')} className={`px-2.5 md:px-3 py-1 rounded-full text-xs font-medium ${entity === 'meridian' ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'}`}>Meridian<span className="ml-1.5 text-[9px] opacity-70 hidden md:inline">Registry</span></button>
            <button onClick={() => setEntity('aurelius')} className={`px-2.5 md:px-3 py-1 rounded-full text-xs font-medium ${entity === 'aurelius' ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'}`}>Aurelius<span className="ml-1.5 text-[9px] opacity-70 hidden md:inline">Empty</span></button>
          </div>
        </div>
      </div>
      {specMode === 'a'
        ? <div className="bg-emerald-100/95 border-t border-emerald-200 px-6 py-2.5 flex items-center gap-3 animate-fadein"><Shield size={14} className="text-emerald-700" /><div className="text-xs text-emerald-900"><strong>Spec A · Foundation.</strong> Structured, guided, registry-assisted data capture. The same data contract Spec B writes into. Flip to Spec B to embed AI on top.</div></div>
        : <div className="bg-amber-100/95 border-t border-amber-200 px-6 py-2.5 flex items-center gap-3 animate-fadein"><Sparkles size={14} className="text-amber-700" /><div className="text-xs text-amber-900"><strong>Spec B · AI-embedded.</strong> Upload a document pack and AI classifies, extracts, reconciles and populates the same foundation. The form did not change. The data entry did.</div></div>}
      {showWhatChanged && <div className="bg-amber-100/95 border-t border-amber-200 px-6 py-2.5 flex items-center gap-3 animate-fadein"><Sparkles size={14} className="text-amber-700" /><div className="text-xs text-amber-900"><strong>"What's new" mode is on.</strong> Spec B enhancements highlighted in amber. Spec A foundations in green.</div></div>}
    </div>
  );

  const SpecBadge = ({ type, children }: { type: SpecType; children?: React.ReactNode }) => {
    if (!showWhatChanged) return null;
    const styles: Record<SpecType, string> = { 'spec-a': 'bg-emerald-100 text-emerald-800 border-emerald-300', 'spec-b': 'bg-amber-100 text-amber-900 border-amber-300', 'enhanced': 'bg-blue-100 text-blue-800 border-blue-300' };
    const labels: Record<SpecType, string> = { 'spec-a': 'Spec A · unchanged', 'spec-b': 'New in Spec B', 'enhanced': 'Enhanced from Spec A' };
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${styles[type]} ml-2 align-middle`}><Sparkles size={9} />{children || labels[type]}</span>;
  };

  const SpecBOutline = ({ children, type = 'spec-b' as SpecType }: { children: React.ReactNode; type?: SpecType }) => {
    if (!showWhatChanged) return <>{children}</>;
    const colors: Record<SpecType, string> = { 'spec-a': 'ring-emerald-400/60', 'spec-b': 'ring-amber-400/60', 'enhanced': 'ring-blue-400/60' };
    return <div className={`ring-2 ${colors[type]} ring-offset-2 ring-offset-white rounded-xl`}>{children}</div>;
  };

  const ConfirmField = ({ label, value, icon, source = 'registry' }: { label: string; value: string; icon?: React.ReactNode; source?: 'registry' | 'document' | 'client' }) => {
    const styles = { registry: 'bg-blue-50/50 border-blue-100', document: 'bg-indigo-50/50 border-indigo-100', client: 'bg-emerald-50/40 border-emerald-100' };
    return (
      <div className={`px-3 py-2.5 rounded-lg border ${styles[source]} flex items-center gap-2.5`}>
        {icon && <span className="text-slate-400">{icon}</span>}
        <div className="flex-1 min-w-0"><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div><div className="text-[13px] font-semibold text-slate-900 truncate">{value}</div></div>
        <Check size={14} className="text-emerald-500 flex-shrink-0" />
      </div>
    );
  };

  const InputField = ({ label, value, onChange, placeholder, disabled, note, type = 'text' }: { label: string; value: string | number; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; note?: string; type?: string }) => (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">{label}</label>
      <input type={type} value={value || ''} onChange={(e) => !disabled && onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none ${disabled ? 'bg-slate-50 border-slate-200 text-slate-600 cursor-not-allowed' : 'border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'}`} />
      {note && <div className="text-[10px] text-slate-400 mt-1">{note}</div>}
    </div>
  );

  const PipelineStep = ({ n, name, desc, active, done, detail }: { n: number | string; name: string; desc: string; active: boolean; done: boolean; detail?: string | null }) => (
    <div className={`rounded-lg border ${active ? 'border-purple-400 bg-white shadow-sm' : done ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${done ? 'bg-emerald-500 text-white' : active ? 'bg-purple-500 text-white animate-pulse' : 'bg-slate-100 text-slate-500'}`}>{done ? <Check size={13} /> : n}</div>
        <div className="flex-1"><div className="text-xs font-semibold text-slate-900">{name}</div><div className="text-[10px] text-slate-500">{desc}</div></div>
      </div>
      {detail && (active || done) && <div className="px-3 pb-2.5 -mt-1"><div className="text-[10px] text-slate-700 bg-slate-50 rounded px-2 py-1.5 leading-relaxed">{detail}</div></div>}
    </div>
  );

  const StartSection = () => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div><div className="text-xl font-semibold text-slate-900">Welcome back, Alice</div><div className="text-sm text-slate-500">Pick up where you left off.</div></div>
        <div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">DONE</div>
      </div>
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mt-5 flex items-start gap-3"><Check size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" /><div className="text-sm text-emerald-900">Application started for <strong>{ent.name}</strong>. {entity === 'meridian' ? 'CLM has pre-filled what it could from public registries.' : 'No registry data yet — upload your documents from Company Details.'}</div></div>
      <div className="mt-6 flex justify-end gap-2"><button onClick={() => setSection('company')} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-2">Continue to Company details<ChevronRight size={16} /></button></div>
    </div>
  );

  const CompanySection = () => {
    const isMeridian = entity === 'meridian';
    const handleContinue = () => {
      const allFilled = Object.values(fields).every(v => v && v.toString().trim() !== '');
      const newCompletion = allFilled ? 100 : (isMeridian ? Math.max(85, sectionCompletion.company) : Math.min(95, sectionCompletion.company + 10));
      advanceCompletion('company', newCompletion);
      setSection('compliance');
      showToast('Company details saved');
    };

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <div className="text-xl font-semibold text-slate-900 flex items-center">Tell us about your company<SpecBadge type="enhanced" /></div>
            <div className="text-sm text-slate-500">{isMeridian ? 'Confirm what we found, and fill in the gaps.' : 'Upload your documents and we will extract everything, or enter it yourself.'}</div>
          </div>
          <div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">CLUSTER MODE</div>
        </div>

        {!isMeridian && specMode === 'b' ? (
          <SpecBOutline type="spec-b">
            <div className="mt-5 rounded-xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-white p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0"><Upload size={20} /></div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">Have your incorporation pack?</div>
                <div className="text-xs text-slate-600 mt-0.5">Cert of Incorporation, MAA, Board Resolution, Director ID. We classify, extract, reconcile and populate this section.</div>
              </div>
              <button onClick={() => spvPackInputRef.current?.click()} disabled={docIntelState.isProcessing} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-full hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed">{docIntelState.isProcessing ? 'Processing...' : 'Upload SPV pack'}</button>
            </div>
          </SpecBOutline>
        ) : isMeridian ? (
          <div className="mt-5 rounded-xl border border-blue-300 bg-gradient-to-br from-blue-50 to-white p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0"><Upload size={18} /></div>
            <div className="flex-1"><div className="text-sm font-semibold text-slate-900">Got your incorporation documents?</div><div className="text-xs text-slate-600 mt-0.5">Upload them and we'll extract the rest.</div></div>
            <button onClick={() => setSection('documents')} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-full hover:bg-blue-700">Upload</button>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0"><Edit3 size={18} /></div>
            <div className="flex-1"><div className="text-sm font-semibold text-slate-900">New entity, thin registry</div><div className="text-xs text-slate-600 mt-0.5">No ACRA pre-fill available. Enter the details below. Flip to Spec B to extract them from your documents.</div></div>
          </div>
        )}

        {docIntelState.showSidePanel && !isMeridian && (
          <div className="mt-5 bg-gradient-to-br from-purple-50 to-white border border-purple-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Sparkles size={14} className="text-purple-600" /><h3 className="text-sm font-semibold text-purple-900">Document Intelligence</h3></div>
              <button onClick={() => setDocIntelState(prev => ({ ...prev, showSidePanel: false }))} className="text-purple-400 hover:text-purple-600"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
              <PipelineStep n="1" name="Classify" desc="Identify types" active={docIntelState.processingStep === 1} done={docIntelState.processingStep > 1} detail={docIntelState.processingStep >= 1 ? docIntelState.currentNarrative?.classify : null} />
              <PipelineStep n="2" name="Extract" desc="Pull fields" active={docIntelState.processingStep === 2} done={docIntelState.processingStep > 2} detail={docIntelState.processingStep >= 2 ? docIntelState.currentNarrative?.extract : null} />
              <PipelineStep n="3" name="Reconcile" desc="Cross-check" active={docIntelState.processingStep === 3} done={docIntelState.processingStep > 3} detail={docIntelState.processingStep >= 3 ? docIntelState.currentNarrative?.reconcile : null} />
              <PipelineStep n="4" name="Validate" desc="Check quality" active={docIntelState.processingStep === 4} done={docIntelState.processingStep > 4} detail={docIntelState.processingStep >= 4 ? docIntelState.currentNarrative?.validate : null} />
              <PipelineStep n="5" name="Apply" desc="Update sections" active={docIntelState.processingStep === 5} done={docIntelState.processingStep === 5} detail={docIntelState.processingStep === 5 ? docIntelState.currentNarrative?.apply : null} />
            </div>
          </div>
        )}

        {isMeridian ? (
          <>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-semibold"><Check size={13} /></div><h3 className="text-sm font-semibold text-slate-900">Confirm what we know</h3><span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold">From ACRA</span></div>
              <div className="grid grid-cols-2 gap-3 ml-9">
                <ConfirmField label="Legal name" value={fields.legalName} icon={<Building2 size={13} />} />
                <ConfirmField label="UEN" value={fields.uen} />
                <ConfirmField label="Entity type" value={fields.entityType} />
                <ConfirmField label="Incorporated" value={fields.incorporated} />
                <div className="col-span-2"><ConfirmField label="Registered address" value={fields.address} icon={<MapPin size={13} />} /></div>
                <ConfirmField label="Industry" value={fields.industry} icon={<Briefcase size={13} />} />
              </div>
            </div>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-semibold"><Check size={13} /></div><h3 className="text-sm font-semibold text-slate-900">Main contact</h3><span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-semibold">You entered</span></div>
              <div className="grid grid-cols-2 gap-3 ml-9">
                <ConfirmField label="Name" value={fields.contactName} source="client" icon={<User size={13} />} />
                <ConfirmField label="Title" value={fields.contactTitle} source="client" />
                <ConfirmField label="Email" value={fields.contactEmail} source="client" icon={<Mail size={13} />} />
                <ConfirmField label="Phone" value={fields.contactPhone} source="client" icon={<Phone size={13} />} />
              </div>
            </div>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">3</div><h3 className="text-sm font-semibold text-slate-900">We still need</h3><span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">1 field</span></div>
              <div className="ml-9">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Primary markets traded</label>
                <select value={fields.primaryMarkets} onChange={(e) => setField('primaryMarkets', e.target.value)} className="w-full max-w-md px-3.5 py-2.5 border-2 border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white">
                  <option value="">Select primary markets...</option>
                  <option value="Singapore, China, Australia">Singapore, China, Australia</option>
                  <option value="Singapore, Indonesia, Malaysia">Singapore, Indonesia, Malaysia</option>
                  <option value="Singapore, India, UAE">Singapore, India, UAE</option>
                  <option value="Pan-Asia">Pan-Asia</option>
                  <option value="Global">Global</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-6 h-6 rounded-full ${fields.legalName ? 'bg-emerald-500 text-white' : 'bg-blue-100 text-blue-600'} flex items-center justify-center text-xs font-semibold`}>{fields.legalName ? <Check size={13} /> : '1'}</div>
                <h3 className="text-sm font-semibold text-slate-900">Tell us about your company</h3>
                <span className={`text-[10px] ${fields.legalName ? 'text-purple-700 bg-purple-50' : 'text-amber-700 bg-amber-50'} px-2 py-0.5 rounded-full font-semibold`}>{fields.legalName ? 'Extracted from documents' : 'No pre-fill'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 ml-9">
                <InputField label="Legal name" value={fields.legalName} onChange={(v) => setField('legalName', v)} placeholder="Aurelius Maritime SPV Pte. Ltd." />
                <InputField label="UEN" value={fields.uen} onChange={(v) => setField('uen', v)} disabled note="From ACRA basics" />
                <InputField label="Entity type" value={fields.entityType} onChange={(v) => setField('entityType', v)} placeholder="Select..." />
                <InputField label="Incorporated" value={fields.incorporated} onChange={(v) => setField('incorporated', v)} disabled note="From ACRA basics" />
                <div className="col-span-2"><InputField label="Registered address" value={fields.address} onChange={(v) => setField('address', v)} placeholder="Street, building, postal code" /></div>
                <InputField label="Industry" value={fields.industry} onChange={(v) => setField('industry', v)} placeholder="e.g. Maritime / Shipping" />
                <InputField label="Primary markets" value={fields.primaryMarkets} onChange={(v) => setField('primaryMarkets', v)} placeholder="Where you do business" />
              </div>
            </div>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4"><div className={`w-6 h-6 rounded-full ${fields.contactName ? 'bg-emerald-500 text-white' : 'bg-blue-100 text-blue-600'} flex items-center justify-center text-xs font-semibold`}>{fields.contactName ? <Check size={13} /> : '2'}</div><h3 className="text-sm font-semibold text-slate-900">Main contact</h3></div>
              <div className="grid grid-cols-2 gap-4 ml-9">
                <InputField label="Name" value={fields.contactName} onChange={(v) => setField('contactName', v)} placeholder="Full name" />
                <InputField label="Title" value={fields.contactTitle} onChange={(v) => setField('contactTitle', v)} placeholder="Job title" />
                <InputField label="Email" value={fields.contactEmail} onChange={(v) => setField('contactEmail', v)} placeholder="email@company.com" />
                <InputField label="Phone" value={fields.contactPhone} onChange={(v) => setField('contactPhone', v)} placeholder="+65 ..." />
              </div>
            </div>
          </>
        )}

        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setSection('start')} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 hover:border-slate-400 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={handleContinue} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  const RequirementCard = ({ label, detail, checkable, defaultChecked, checked, note, optional }: { label: string; detail: string; checkable?: boolean; defaultChecked?: boolean; checked?: boolean; note?: string; optional?: boolean }) => {
    const [isChecked, setIsChecked] = useState(defaultChecked || checked || false);
    const isFixed = checked !== undefined && !checkable;
    return (
      <div className={`border rounded-xl px-4 py-3 ${(isFixed && checked) || (checkable && isChecked) ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-start gap-3">
          <button onClick={() => checkable && setIsChecked(!isChecked)} disabled={!checkable} className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${(isFixed && checked) || (checkable && isChecked) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'} ${checkable ? 'cursor-pointer' : 'cursor-default'}`}>{((isFixed && checked) || (checkable && isChecked)) && <Check size={12} className="text-white" />}</button>
          <div className="flex-1">
            <div className="flex items-center gap-2"><div className="text-sm font-semibold text-slate-900">{label}</div>{optional && <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium">Optional</span>}</div>
            <div className="text-xs text-slate-600 mt-1 leading-relaxed">{detail}</div>
            {note && <div className="text-[11px] text-emerald-700 mt-1.5 italic">{note}</div>}
          </div>
        </div>
      </div>
    );
  };

  const renderCountryRequirementSub = () => {
    const isMeridian = entity === 'meridian';
    return (
      <div>
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-base font-semibold text-slate-900">Country and jurisdiction</div><div className="text-xs text-slate-500">Singapore-specific requirements.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">CLUSTER MODE</div></div>
        <div className="mt-6 max-w-3xl">
          <div className="flex items-center gap-3 mb-4"><div className={`w-6 h-6 rounded-full ${isMeridian ? 'bg-emerald-500 text-white' : 'bg-blue-100 text-blue-600'} flex items-center justify-center text-xs font-semibold`}>{isMeridian ? <Check size={13} /> : '1'}</div><h3 className="text-sm font-semibold text-slate-900">Primary country / market</h3></div>
          <div className="ml-9">{isMeridian ? <ConfirmField label="Primary country" value="Singapore" icon={<MapPin size={13} />} /> : <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Primary country</label><select className="w-full max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"><option>Singapore</option></select></div>}</div>
        </div>
        <div className="mt-7 max-w-3xl">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">2</div><h3 className="text-sm font-semibold text-slate-900">Booking locations</h3></div>
          <div className="ml-9 space-y-2">
            <div className="border border-slate-200 rounded-lg px-4 py-2.5 bg-blue-50/30 flex items-center gap-3"><span className="text-[10px] uppercase tracking-wider font-semibold text-blue-700 bg-blue-100 px-2 py-1 rounded">Primary</span><span className="text-sm font-medium text-slate-900">Singapore</span><span className="text-xs text-slate-500 ml-auto">SCB Singapore</span></div>
            {isMeridian && <div className="border border-slate-200 rounded-lg px-4 py-2.5 bg-white flex items-center gap-3"><span className="text-[10px] uppercase tracking-wider font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">Secondary</span><span className="text-sm font-medium text-slate-900">UAE</span><span className="text-xs text-slate-500 ml-auto">SCB Dubai</span></div>}
          </div>
        </div>
        <div className="mt-7 max-w-3xl">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">3</div><h3 className="text-sm font-semibold text-slate-900">Singapore-specific requirements</h3><span className="text-[10px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full font-semibold">MAS Notice 626</span></div>
          <div className="ml-9 space-y-3">
            <RequirementCard label="Singapore tax residency" detail="Entity is tax resident in Singapore under section 2(1) of the Income Tax Act." checked={true} note="Confirmed automatically — Singapore-incorporated" />
            <RequirementCard label="MAS Notice 626 — AML/CFT screening" detail="Business is subject to MAS Notice 626 on prevention of money laundering and countering of terrorist financing." checkable defaultChecked />
            <RequirementCard label="Source of wealth declaration" detail="For shareholders with 25%+ ownership, source of wealth must be declared and substantiated." checkable defaultChecked />
            <RequirementCard label="Connected party disclosure" detail="Disclose any related entities, subsidiaries, or connected parties." checkable optional />
            <RequirementCard label="Local document submission" detail="ACRA business profile is primary identity document. Foreign-language documents require certified English translation." checked={true} note="ACRA profile attached" />
          </div>
        </div>
        <div className="mt-6 flex justify-end"><button onClick={() => { setComplianceSubProgress(prev => ({ ...prev, country: 100 })); setComplianceSubsection('kyc-narrative'); showToast('Country requirements saved'); }} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button></div>
      </div>
    );
  };

  const renderKycNarrativeSub = () => {
    type KycKey = keyof typeof kycNarrative;
    const setNarrativeField = (key: KycKey, value: string) => setKycNarrative(prev => ({ ...prev, [key]: value }));
    return (
      <div>
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-base font-semibold text-slate-900">About your business</div><div className="text-xs text-slate-500">Help us understand the nature and scale.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">CLUSTER MODE</div></div>
        <div className="mt-6 max-w-3xl">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">1</div><h3 className="text-sm font-semibold text-slate-900">Nature of business</h3></div>
          <div className="ml-9 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Describe the business</label><textarea value={kycNarrative.businessDescription} onChange={(e) => setNarrativeField('businessDescription', e.target.value)} placeholder="What does the company do?" rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" /></div>
            <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Countries traded</label><textarea value={kycNarrative.countriesTraded} onChange={(e) => setNarrativeField('countriesTraded', e.target.value)} placeholder="Where does the company trade?" rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" /></div>
            <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Products / services</label><textarea value={kycNarrative.productsServices} onChange={(e) => setNarrativeField('productsServices', e.target.value)} placeholder="What does it sell?" rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" /></div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Annual turnover</label>
              <select value={kycNarrative.turnover} onChange={(e) => setNarrativeField('turnover', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500"><option value="">Select range...</option><option value="Up to S$1M">Up to S$1M</option><option value="S$1M – S$2M">S$1M – S$2M</option><option value="S$2M – S$5M">S$2M – S$5M</option><option value="S$5M – S$10M">S$5M – S$10M</option><option value="S$10M – S$50M">S$10M – S$50M</option><option value="S$50M – S$100M">S$50M – S$100M</option><option value="Above S$100M">Above S$100M</option></select>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5 mt-3">Years operating</label>
              <select value={kycNarrative.duration} onChange={(e) => setNarrativeField('duration', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500"><option value="">Select range...</option><option value="Less than 1 year">Less than 1 year</option><option value="1 – 3 years">1 – 3 years</option><option value="3 – 5 years">3 – 5 years</option><option value="5 – 10 years">5 – 10 years</option><option value="10 – 20 years">10 – 20 years</option><option value="More than 20 years">More than 20 years</option></select>
            </div>
          </div>
        </div>
        <div className="mt-7 max-w-3xl">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">2</div><h3 className="text-sm font-semibold text-slate-900">Source of funds</h3></div>
          <div className="ml-9"><textarea value={kycNarrative.sourceOfFunds} onChange={(e) => setNarrativeField('sourceOfFunds', e.target.value)} placeholder="Where do the funds originate? e.g. trading revenue, capital injection..." rows={2} className="w-full max-w-2xl px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" /></div>
        </div>
        <div className="mt-7 flex justify-end"><button onClick={() => { const required: KycKey[] = ['businessDescription', 'countriesTraded', 'productsServices', 'sourceOfFunds']; const allFilled = required.every(f => kycNarrative[f] && kycNarrative[f].trim()); const anyFilled = Object.values(kycNarrative).some(v => v && v.trim()); const progress = allFilled ? 100 : anyFilled ? 50 : 0; setComplianceSubProgress(prev => ({ ...prev, 'kyc-narrative': progress })); setComplianceSubsection('kyc-questions'); showToast(progress === 100 ? 'Business info complete' : 'Saved'); }} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button></div>
      </div>
    );
  };

  const renderKycQuestionsSub = () => {
    const questions = [
      { id: 'pic', label: 'Is this company a Personal Investment Company (PIC)?', help: 'A PIC is a corporate vehicle held by an individual or family.', branches: true },
      { id: 'bearerShares', label: 'Does the company or any shareholder issue bearer shares?', help: 'Bearer shares are unregistered equity securities.', branches: false },
      { id: 'armaments', label: 'Is the company involved in armaments or defence business?', help: 'Manufacturing, trading, or financing of weapons or military equipment.', branches: true },
      { id: 'gaming', label: 'Is the company involved in gaming or casino business?', help: 'Casinos, betting operators, or gaming software.', branches: false }
    ];
    const currentIdx = kycQuestionsState.currentIdx;
    const currentQuestion = questions[currentIdx];
    const isLast = currentIdx === questions.length - 1;
    const setAnswer = (qid: string, value: string) => setKycQuestionsState(prev => ({ ...prev, answers: { ...prev.answers, [qid]: value } }));
    const setFollowup = (qid: string, value: string) => setKycQuestionsState(prev => ({ ...prev, followups: { ...prev.followups, [qid]: value } }));
    const goNext = () => {
      const answer = kycQuestionsState.answers[currentQuestion.id];
      if (answer === undefined) { showToast('Pick Yes or No.'); return; }
      if (currentQuestion.branches && answer === 'yes' && !kycQuestionsState.followups[currentQuestion.id]) { showToast('Add a brief explanation.'); return; }
      if (isLast) { setComplianceSubProgress(prev => ({ ...prev, 'kyc-questions': 100 })); setComplianceSubsection('declarations'); showToast('Risk questions complete'); }
      else setKycQuestionsState(prev => ({ ...prev, currentIdx: prev.currentIdx + 1 }));
    };
    const currentAnswer = kycQuestionsState.answers[currentQuestion.id];
    return (
      <div>
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-base font-semibold text-slate-900">Risk questions</div><div className="text-xs text-slate-500">Yes answers may need a short explanation.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold tracking-wider">FOCUS MODE</div></div>
        <div className="flex gap-1.5 mt-6 mb-7 max-w-2xl">{questions.map((q, idx) => { const answered = kycQuestionsState.answers[q.id] !== undefined; const isCurrent = idx === currentIdx; return <button key={q.id} onClick={() => setKycQuestionsState(prev => ({ ...prev, currentIdx: idx }))} className={`flex-1 h-1.5 rounded-full ${isCurrent ? 'bg-blue-500' : answered ? 'bg-emerald-500' : 'bg-slate-200'}`} />; })}</div>
        <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Question {currentIdx + 1} of {questions.length}</div>
        <h2 className="text-xl font-semibold text-slate-900 leading-tight mb-2.5 max-w-2xl">{currentQuestion.label}</h2>
        <p className="text-sm text-slate-600 mb-6 max-w-xl">{currentQuestion.help}</p>
        <div className="flex gap-3 max-w-md mb-6">
          <button onClick={() => setAnswer(currentQuestion.id, 'no')} className={`flex-1 py-3 px-4 rounded-full border-2 text-sm font-semibold ${currentAnswer === 'no' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>No</button>
          <button onClick={() => setAnswer(currentQuestion.id, 'yes')} className={`flex-1 py-3 px-4 rounded-full border-2 text-sm font-semibold ${currentAnswer === 'yes' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>Yes</button>
        </div>
        {currentAnswer === 'yes' && currentQuestion.branches && (
          <div className="max-w-2xl mt-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 animate-fadein">
            <div className="flex items-start gap-2.5 mb-3"><AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" /><div><div className="text-sm font-semibold text-amber-900">Tell us more</div><div className="text-xs text-amber-800 mt-0.5">{currentQuestion.id === 'pic' ? 'PICs follow specific KYC requirements.' : 'Defence-related business requires enhanced due diligence.'}</div></div></div>
            <textarea value={kycQuestionsState.followups[currentQuestion.id] || ''} onChange={(e) => setFollowup(currentQuestion.id, e.target.value)} placeholder="Add details..." rows={3} className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:border-amber-500 resize-none bg-white" />
          </div>
        )}
        {currentAnswer === 'no' && <div className="max-w-2xl mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start gap-2.5 animate-fadein"><Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" /><div className="text-xs text-emerald-900">Noted.</div></div>}
        <div className="mt-7 flex justify-between">
          <button onClick={() => { if (currentIdx > 0) setKycQuestionsState(prev => ({ ...prev, currentIdx: prev.currentIdx - 1 })); else setComplianceSubsection('kyc-narrative'); }} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={goNext} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">{isLast ? 'Continue to declarations' : 'Next'}<ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  const renderDeclarationsSub = () => {
    const DelegationOption = ({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) => (
      <button onClick={onClick} className="w-full text-left border-2 border-slate-200 rounded-xl px-4 py-3.5 hover:border-blue-500 hover:bg-blue-50/30 flex items-start gap-3.5"><div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">{icon}</div><div className="flex-1"><div className="text-sm font-semibold text-slate-900">{title}</div><div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{desc}</div></div></button>
    );
    const DelegationConfirmation = ({ recipient, email, code, path }: { recipient: string; email: string; code: string; path: string }) => (
      <div className="space-y-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2.5 text-xs text-emerald-900"><Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" /><div>{recipient} will receive the email below. {path === 'specialist' ? 'Access expires on submission or in 7 days.' : 'They register once on arrival.'}</div></div>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 text-xs"><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Email preview</div><div className="text-slate-600"><strong className="text-slate-900">To:</strong> {email}</div><div className="text-slate-900 font-semibold mt-1">{path === 'specialist' ? 'Action required: FATCA & CRS' : 'Invitation to onboard ' + ent.shortName}</div></div>
          <div className="px-4 py-3.5 text-xs text-slate-700 leading-relaxed space-y-2">
            <p>Hi {recipient},</p>
            <p>{path === 'specialist' ? `Alice Smith has asked you to complete the FATCA and CRS Self-Certification for ${ent.name}.` : `Alice Smith has invited you to join the onboarding team for ${ent.name}.`}</p>
            <p className="font-mono text-slate-900"><strong>Reference code:</strong> {code}<br /><strong>Portal:</strong> sc-onboarding.standardchartered.com</p>
          </div>
          <div className="px-4 py-2.5 bg-red-50 border-t border-red-100 flex items-start gap-2 text-[11px] text-red-800"><AlertCircle size={13} className="text-red-600 flex-shrink-0 mt-0.5" /><div><strong>No clickable links</strong> per Information Security policy.</div></div>
        </div>
      </div>
    );
    const DelegationChooser = () => (
      <div>
        <div className="text-xs text-slate-600 mb-4 leading-relaxed">Pick how you'd like to handle FATCA & CRS.</div>
        <div className="space-y-2.5">
          <DelegationOption icon={<User size={18} />} title="I'll complete it myself" desc="Walk through five short questions." onClick={() => { setDelegationChoice('self'); setModal(null); }} />
          <DelegationOption icon={<Users size={18} />} title="Invite a team member" desc="Persistent access. Best for a colleague across multiple sections." onClick={() => { setDelegationChoice('jane'); setModal({ title: 'Invitation sent to Jane Liu', body: <DelegationConfirmation recipient="Jane" email="jane.liu@meridian.com" code="SC-MER-J7K2" path="team" />, footer: <button onClick={() => setModal(null)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-full">Done</button> }); showToast('Jane invited'); }} />
          <DelegationOption icon={<UserCheck size={18} />} title="One-time request to a specialist" desc="Scoped access. Expires on submission." onClick={() => { setDelegationChoice('rose'); setModal({ title: 'Request sent to Rose Chen', body: <DelegationConfirmation recipient="Rose" email="rose.chen@meridian.com" code="SC-MER-F7K2" path="specialist" />, footer: <button onClick={() => setModal(null)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-full">Done</button> }); showToast('Specialist request sent'); }} />
        </div>
      </div>
    );
    const ComplianceFormCard = ({ letter: initialLetter, name, desc, status, onClick, disabled }: { letter: string; name: string; desc: string; status?: string | null; onClick?: () => void; disabled?: boolean }) => {
      let letter = initialLetter;
      let statusText = 'Not started', statusColor = 'text-slate-400', cardBg = 'border-slate-200 hover:border-blue-400', iconBg = 'bg-blue-50 text-blue-600';
      if (status === 'self') { statusText = 'Continue'; statusColor = 'text-blue-600 font-semibold'; cardBg = 'border-blue-300 bg-blue-50/30'; }
      else if (status === 'jane') { statusText = '⏱ Awaiting Jane'; statusColor = 'text-amber-600 font-medium'; cardBg = 'border-amber-300 bg-amber-50/40'; iconBg = 'bg-amber-500 text-white'; letter = 'J'; }
      else if (status === 'rose') { statusText = '⏱ Awaiting Rose · SC-MER-F7K2'; statusColor = 'text-amber-600 font-medium'; cardBg = 'border-amber-300 bg-amber-50/40'; iconBg = 'bg-amber-500 text-white'; letter = 'R'; }
      if (disabled) return <div className="border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4 opacity-60"><div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-semibold flex-shrink-0">{letter}</div><div className="flex-1 min-w-0"><div className="text-sm font-semibold text-slate-700">{name}</div><div className="text-xs text-slate-500 truncate">{desc}</div></div><div className="text-xs text-slate-400">Not started</div></div>;
      return <button onClick={onClick} className={`w-full border rounded-xl px-5 py-4 flex items-center gap-4 text-left ${cardBg}`}><div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0 ${iconBg}`}>{letter}</div><div className="flex-1 min-w-0"><div className="text-sm font-semibold text-slate-900">{name}</div><div className="text-xs text-slate-600 truncate">{desc}</div></div><div className={`text-xs ${statusColor} flex-shrink-0`}>{statusText}</div><ChevronRight size={16} className="text-slate-400 flex-shrink-0" /></button>;
    };
    return (
      <div>
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-base font-semibold text-slate-900">Regulatory declarations</div><div className="text-xs text-slate-500">Each form captures structured data used across the application and downstream systems.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">CLUSTER MODE</div></div>
        <div className="mt-6 space-y-3">
          <ComplianceFormCard letter="F" name="FATCA & CRS Self-Certification" desc="US tax status and CRS. Generates W-8BEN-E from your answers." status={delegationChoice} onClick={() => setModal({ title: "Who's completing FATCA & CRS?", body: <DelegationChooser />, footer: null })} />
          <ComplianceFormCard letter="P" name="PEP Declaration" desc="Politically exposed persons among beneficial owners, directors, signatories." disabled />
          <ComplianceFormCard letter="S" name="Sanctions Self-Certification" desc="Confirmation that the entity is not subject to any sanctions regime." disabled />
          <ComplianceFormCard letter="B" name="Beneficial Ownership Declaration" desc="Individuals owning or controlling 25% or more of the entity." disabled />
        </div>
      </div>
    );
  };

  const ComplianceSection = () => {
    const subsections: { id: ComplianceSubId; label: string; mode: string }[] = [
      { id: 'country', label: 'Country requirement', mode: 'cluster' },
      { id: 'kyc-narrative', label: 'About your business', mode: 'cluster' },
      { id: 'kyc-questions', label: 'Risk questions', mode: 'focus' },
      { id: 'declarations', label: 'Declarations', mode: 'cluster' }
    ];
    const renderSub = () => {
      if (complianceSubsection === 'country') return renderCountryRequirementSub();
      if (complianceSubsection === 'kyc-narrative') return renderKycNarrativeSub();
      if (complianceSubsection === 'kyc-questions') return renderKycQuestionsSub();
      if (complianceSubsection === 'declarations') return renderDeclarationsSub();
    };
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900">Compliance</div><div className="text-sm text-slate-500">Country requirements, KYC, and regulatory declarations.</div></div></div>
        <div className="mt-6 flex gap-1 border-b border-slate-200 overflow-x-auto">
          {subsections.map(sub => { const isActive = complianceSubsection === sub.id; const isDone = complianceSubProgress[sub.id] === 100; return <button key={sub.id} onClick={() => setComplianceSubsection(sub.id)} className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{isDone && <Check size={12} className="text-emerald-500" />}{sub.label}<span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${sub.mode === 'focus' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{sub.mode}</span></button>; })}
        </div>
        <div className="mt-6">{renderSub()}</div>
        <div className="mt-7 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setSection('company')} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={() => { const declProgress = delegationChoice ? 100 : complianceSubProgress.declarations; const finalSub = { ...complianceSubProgress, declarations: declProgress }; const totalProgress = Math.round(Object.values(finalSub).reduce((a, b) => a + b, 0) / 4); if (declProgress > complianceSubProgress.declarations) setComplianceSubProgress(finalSub); advanceCompletion('compliance', totalProgress); setSection('accounts'); showToast(totalProgress === 100 ? 'Compliance complete' : 'Progress saved'); }} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  const ServiceCheckbox = ({ label, desc, checked, onClick }: { label: string; desc: string; checked: boolean; onClick: () => void }) => (
    <button onClick={onClick} className={`w-full text-left p-3 rounded-lg border-2 flex items-start gap-3 ${checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}>
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${checked ? 'border-blue-600 bg-blue-600' : 'border-slate-400'}`}>{checked && <Check size={10} className="text-white" />}</div>
      <div><div className="text-xs font-semibold text-slate-900">{label}</div><div className="text-[11px] text-slate-600">{desc}</div></div>
    </button>
  );

  const AccountsSection = () => {
    const [showAdd, setShowAdd] = useState(false);
    const [newAccount, setNewAccount] = useState<{ currency: string; purpose: string; services: string[] }>({ currency: '', purpose: '', services: [] });
    const addAccount = () => { if (!newAccount.currency) { showToast('Pick a currency.'); return; } setAccounts([...accounts, { ...newAccount, id: Date.now() }]); setNewAccount({ currency: '', purpose: '', services: [] }); setShowAdd(false); showToast('Account added'); };
    const removeAccount = (id: number) => { setAccounts(accounts.filter(a => a.id !== id)); showToast('Account removed'); };
    const toggleService = (svc: string) => setNewAccount(prev => ({ ...prev, services: prev.services.includes(svc) ? prev.services.filter(s => s !== svc) : [...prev.services, svc] }));
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900">Set up your accounts</div><div className="text-sm text-slate-500">{entity === 'meridian' ? 'Confirm or adjust selected accounts.' : 'Add accounts. One per currency.'}</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">CLUSTER MODE</div></div>
        {accounts.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-semibold"><Check size={13} /></div><h3 className="text-sm font-semibold text-slate-900">Selected accounts</h3></div>
            <div className="ml-9 space-y-3">
              {accounts.map(acc => (
                <div key={acc.id} className="border border-slate-200 rounded-xl px-5 py-4 bg-blue-50/30 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">{acc.currency}</div>
                  <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{acc.currency} · {acc.purpose}</div><div className="flex flex-wrap gap-1.5 mt-2">{acc.services.includes('online') && <span className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 font-medium">S2B online</span>}{acc.services.includes('cards') && <span className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 font-medium">Cards</span>}{acc.services.includes('sweeping') && <span className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 font-medium">Sweeping</span>}</div></div>
                  <button onClick={() => removeAccount(acc.id)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-6 ml-9">
          {!showAdd ? <button onClick={() => setShowAdd(true)} className="w-full border-2 border-dashed border-slate-300 rounded-xl py-3 text-sm font-medium text-blue-600 hover:border-blue-400 hover:bg-blue-50/30 flex items-center justify-center gap-2"><Plus size={16} />Add another account</button> : (
            <div className="border border-slate-300 rounded-xl p-5 bg-white">
              <h4 className="text-sm font-semibold text-slate-900 mb-4">New account</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Currency</label><select value={newAccount.currency} onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"><option value="">Select...</option><option value="SGD">SGD</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="HKD">HKD</option><option value="GBP">GBP</option></select></div>
                <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Purpose</label><input type="text" value={newAccount.purpose} onChange={(e) => setNewAccount({ ...newAccount, purpose: e.target.value })} placeholder="e.g. Operating" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></div>
              </div>
              <div className="mb-4">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Services</label>
                <div className="space-y-2">
                  <ServiceCheckbox label="S2B online banking" desc="Initiate and approve online" checked={newAccount.services.includes('online')} onClick={() => toggleService('online')} />
                  <ServiceCheckbox label="Corporate cards" desc="Debit or credit cards" checked={newAccount.services.includes('cards')} onClick={() => toggleService('cards')} />
                  <ServiceCheckbox label="Sweeping" desc="Auto-balance funds" checked={newAccount.services.includes('sweeping')} onClick={() => toggleService('sweeping')} />
                </div>
              </div>
              <div className="flex justify-end gap-2"><button onClick={() => { setShowAdd(false); setNewAccount({ currency: '', purpose: '', services: [] }); }} className="px-3 py-1.5 border border-slate-300 rounded-full text-xs font-medium text-slate-700">Cancel</button><button onClick={addAccount} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-full hover:bg-blue-700">Add</button></div>
            </div>
          )}
        </div>
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setSection('compliance')} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={() => { if (accounts.length === 0) { showToast('Add at least one account.'); return; } advanceCompletion('accounts', 100); setSection('mandate'); showToast('Accounts saved'); }} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  const SigningOption = ({ label, desc, selected, onClick }: { label: string; desc: string; selected: boolean; onClick: () => void }) => (
    <button onClick={onClick} className={`w-full text-left p-4 rounded-xl border-2 flex items-start gap-3.5 ${selected ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'}`}>
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${selected ? 'border-blue-600 bg-blue-600' : 'border-slate-400'}`}>{selected && <div className="w-2 h-2 rounded-full bg-white"></div>}</div>
      <div><div className={`text-sm font-semibold ${selected ? 'text-slate-900' : 'text-slate-800'}`}>{label}</div><div className="text-xs text-slate-600 mt-0.5">{desc}</div></div>
    </button>
  );

  const MandateChooser = () => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
      <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900 flex items-center">Mandate and signing authority<SpecBadge type="spec-b" /></div><div className="text-sm text-slate-500">Upload your Board mandate and we'll extract the authorisations, or set them up manually.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold tracking-wider">FOCUS MODE</div></div>
      <div className="mt-7 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <SpecBOutline type="spec-b">
          <button onClick={() => mandateFileInputRef.current?.click()} className="w-full h-full text-left border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-white rounded-xl p-6 hover:border-blue-500 hover:shadow-md">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-4"><Upload size={22} /></div>
            <div className="text-base font-semibold text-slate-900 mb-1.5">Upload your Board mandate</div>
            <div className="text-xs text-slate-600 leading-relaxed mb-3">We'll read the signatories, signing rules and authorisation limits prescribed by the Board, and present them for your confirmation.</div>
            <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1"><Sparkles size={10} />Recommended · 2 minutes</div>
          </button>
        </SpecBOutline>
        <button onClick={() => setMandateMode('manual')} className="w-full text-left border-2 border-slate-200 bg-white rounded-xl p-6 hover:border-slate-400">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mb-4"><Edit3 size={22} /></div>
          <div className="text-base font-semibold text-slate-900 mb-1.5">Enter manually</div>
          <div className="text-xs text-slate-600 leading-relaxed mb-3">Six-step wizard. Pick your signing rule, add signatories, set authority limits, and review.</div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Step-by-step · 5 minutes</div>
        </button>
      </div>
    </div>
  );

  const MandateAiView = () => {
    const stage = mandateAiStage;
    const done = mandateMode === 'ai-extracted';
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const narrative = {
      classify: 'Identified as: Board Resolution (signed, dated 15 Mar 2026). Standard board mandate format covering banking authority and signatory appointments.',
      extract: `Extracted: ${MANDATE_AI.signatories.length} named signatories with roles and identifiers, ${MANDATE_AI.rules.length} signing rules with limits and conditions, Board Resolution reference ${MANDATE_AI.boardResRef}.`,
      reconcile: '2 of 4 signatories match ACRA director register (David Tan, Marcus Lim). 2 are non-director appointed signatories (Alice Smith, Priya Krishnan), common for delegated authority.',
      validate: 'Resolution properly signed by Board Chair and Company Secretary. Authority limits are internally consistent (Cat A > Cat B). Tier-based rules align with standard mandate structure. FX carve-out identified as a notwithstanding clause.',
      apply: 'Mandate section populated with extracted signatories and tier-based rules. Authority matrix derived. Ready for client confirmation.'
    };
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900 flex items-center">Mandate and signing authority<SpecBadge type="spec-b" /></div><div className="text-sm text-slate-500">{done ? 'Here is what we extracted. Review and confirm.' : 'Processing your Board mandate...'}</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 font-semibold tracking-wider">AI EXTRACTION</div></div>
        <div className="mt-5 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
          <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{MANDATE_AI.documentName}</div><div className="text-xs text-slate-500">Board Resolution ref {MANDATE_AI.boardResRef} · {done ? 'Extraction complete' : 'Processing...'}</div></div>
          {done && <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-700">✓ Extracted</span>}
        </div>
        <div className="mt-5 grid grid-cols-3 md:grid-cols-5 gap-2">
          <PipelineStep n="1" name="Classify" desc="Identify type" active={stage === 1} done={stage > 1} detail={stage >= 1 ? narrative.classify : null} />
          <PipelineStep n="2" name="Extract" desc="Pull data" active={stage === 2} done={stage > 2} detail={stage >= 2 ? narrative.extract : null} />
          <PipelineStep n="3" name="Reconcile" desc="Match ACRA" active={stage === 3} done={stage > 3} detail={stage >= 3 ? narrative.reconcile : null} />
          <PipelineStep n="4" name="Validate" desc="Check rules" active={stage === 4} done={stage > 4} detail={stage >= 4 ? narrative.validate : null} />
          <PipelineStep n="5" name="Apply" desc="Populate" active={stage === 5 && !done} done={done} detail={stage === 5 ? narrative.apply : null} />
        </div>
        {done && (
          <>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-semibold"><Sparkles size={11} /></div><h3 className="text-sm font-semibold text-slate-900">Authorised signatories</h3><span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">{MANDATE_AI.signatories.length} extracted</span></div>
              <div className="ml-9 space-y-2">
                {MANDATE_AI.signatories.map(s => (
                  <div key={s.id} className="border border-slate-200 rounded-lg px-4 py-3 bg-white flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-xs flex-shrink-0">{s.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                    <div className="flex-1"><div className="flex items-center gap-2"><span className="text-sm font-semibold text-slate-900">{s.name}</span>{s.acraDirector && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-50 text-emerald-700">ACRA director</span>}</div><div className="text-[11px] text-slate-500">{s.role} · {s.source}</div></div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">Cat. {s.category}</span>
                    <div className="text-xs text-slate-700 font-semibold">{formatMoney(s.limit)}</div>
                    <Check size={14} className="text-emerald-500" />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-semibold"><Sparkles size={11} /></div><h3 className="text-sm font-semibold text-slate-900">Signing rules and authorisation limits</h3><span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">{MANDATE_AI.rules.length} rules extracted</span></div>
              <div className="ml-9 space-y-3">
                {MANDATE_AI.rules.map((r, i) => {
                  const open = expanded[i];
                  return (
                    <div key={i} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                      <button onClick={() => setExpanded(prev => ({ ...prev, [i]: !open }))} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left">
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-blue-50 text-blue-700 uppercase tracking-wider">{r.tier}</span>
                        <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{r.label}</div><div className="text-xs text-slate-600">{r.limit} · {r.rule}</div></div>
                        <ChevronRight size={16} className={`text-slate-400 ${open ? 'rotate-90' : ''}`} />
                      </button>
                      {open && (
                        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Extracted from mandate</div>
                          <div className="text-sm italic text-slate-700 p-3 bg-white rounded border-l-4 border-blue-400">"{r.rawText}"</div>
                          <div className="mt-2 text-[11px] text-slate-500"><strong className="text-slate-700">Services:</strong> {r.services}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-7 max-w-3xl bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-xs text-emerald-900 flex items-start gap-2.5"><Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" /><div><strong>Plain English:</strong> Any one of 4 signatories can approve up to S$50,000. Two together can approve up to S$500,000. David Tan (CFO) plus one other for anything above that. FX over S$100,000 always needs David's signature.</div></div>
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
              <button onClick={() => { setMandateMode('chooser'); setMandateAiStage(0); }} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Start over</button>
              <div className="flex gap-2">
                <button onClick={() => { setMandateMode('manual'); setMandateStep(2); }} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700">Edit step by step</button>
                <button onClick={() => { advanceCompletion('mandate', 100); setSection('s2b'); showToast('Mandate confirmed'); }} className="px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-full hover:bg-emerald-700 flex items-center gap-1.5"><Check size={14} />Confirm all rules</button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const MandateStep1Sub = () => (
    <div>
      <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Mandate · Step 1 of 6</div>
      <h2 className="text-2xl font-semibold text-slate-900 leading-tight mb-2.5">How should signatories approve transactions?</h2>
      <p className="text-sm text-slate-600 mb-7 max-w-xl">Pick what best matches your board resolution.</p>
      <div className="space-y-2.5 max-w-2xl">
        <SigningOption label="Any one signatory can sign" desc="Any authorised signer can approve on their own." selected={signingRule === 'any-one'} onClick={() => setSigningRule('any-one')} />
        <SigningOption label="Any two signatories together" desc="Any two signers must approve jointly." selected={signingRule === 'any-two'} onClick={() => setSigningRule('any-two')} />
        <SigningOption label="Group signatories into categories" desc="Different limits for different roles." selected={signingRule === 'categories'} onClick={() => setSigningRule('categories')} />
        <SigningOption label="Custom rules" desc="Multiple groups, ranges, and conditions." selected={signingRule === 'custom'} onClick={() => setSigningRule('custom')} />
      </div>
    </div>
  );

  const MandateStep2Sub = () => {
    const [newSig, setNewSig] = useState({ name: '', role: '', category: 'A' });
    const [showAdd, setShowAdd] = useState(false);
    const addSig = () => { if (!newSig.name) { showToast('Name required.'); return; } setSignatories([...signatories, { ...newSig, id: Date.now(), limit: 0 }]); setNewSig({ name: '', role: '', category: 'A' }); setShowAdd(false); };
    return (
      <div>
        <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Mandate · Step 2 of 6</div>
        <h2 className="text-2xl font-semibold text-slate-900 leading-tight mb-2.5">Who are your signatories?</h2>
        <p className="text-sm text-slate-600 mb-7 max-w-xl">List everyone authorised to sign.</p>
        <div className="max-w-3xl space-y-2.5">
          {signatories.map(sig => (
            <div key={sig.id} className="border border-slate-200 rounded-xl px-5 py-3.5 bg-white flex items-center gap-4">
              <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-xs flex-shrink-0">{sig.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
              <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{sig.name}</div><div className="text-xs text-slate-600">{sig.role}</div></div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">Cat. {sig.category}</div>
              <button onClick={() => setSignatories(signatories.filter(s => s.id !== sig.id))} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
            </div>
          ))}
          {!showAdd ? <button onClick={() => setShowAdd(true)} className="w-full border-2 border-dashed border-slate-300 rounded-xl py-3 text-sm font-medium text-blue-600 flex items-center justify-center gap-2"><Plus size={16} />Add signatory</button> : (
            <div className="border border-slate-300 rounded-xl p-4 bg-white">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <InputField label="Full name" value={newSig.name} onChange={(v) => setNewSig({ ...newSig, name: v })} placeholder="Sarah Lee" />
                <InputField label="Role" value={newSig.role} onChange={(v) => setNewSig({ ...newSig, role: v })} placeholder="Director" />
                <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Category</label><select value={newSig.category} onChange={(e) => setNewSig({ ...newSig, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></div>
              </div>
              <div className="flex justify-end gap-2"><button onClick={() => setShowAdd(false)} className="px-3 py-1.5 border border-slate-300 rounded-full text-xs font-medium text-slate-700">Cancel</button><button onClick={addSig} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-full">Add</button></div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const MandateStep3Sub = () => {
    const updateLimit = (id: number, limit: string) => setSignatories(signatories.map(s => s.id === id ? { ...s, limit: parseInt(limit) || 0 } : s));
    return (
      <div>
        <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Mandate · Step 3 of 6</div>
        <h2 className="text-2xl font-semibold text-slate-900 leading-tight mb-2.5">Authority limits per signatory</h2>
        <p className="text-sm text-slate-600 mb-7 max-w-xl">Set maximum amounts each can approve on their own.</p>
        <div className="max-w-3xl space-y-3">
          {signatories.map(sig => (
            <div key={sig.id} className="border border-slate-200 rounded-xl px-5 py-4 bg-white flex items-center gap-4">
              <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-xs flex-shrink-0">{sig.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
              <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{sig.name}</div><div className="text-xs text-slate-600">{sig.role} · Category {sig.category}</div></div>
              <div className="flex items-center gap-2"><span className="text-xs text-slate-500 font-semibold">S$</span><input type="number" value={sig.limit || ''} onChange={(e) => updateLimit(sig.id, e.target.value)} placeholder="0" className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-right focus:outline-none focus:border-blue-500" /></div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const MandateStep4Sub = () => {
    const catA = signatories.filter(s => s.category === 'A');
    const catB = signatories.filter(s => s.category === 'B');
    const minA = catA.length ? Math.min(...catA.map(s => s.limit || 0)) : 0;
    const maxB = catB.length ? Math.max(...catB.map(s => s.limit || 0)) : 0;
    const inconsistency = catA.length && catB.length && (minA < maxB);
    const CategorySummary = ({ cat, sigs }: { cat: string; sigs: Signatory[] }) => {
      const max = Math.max(...sigs.map(s => s.limit || 0));
      const min = Math.min(...sigs.map(s => s.limit || 0));
      return (
        <div className="border border-slate-200 rounded-xl px-5 py-4 bg-white">
          <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-3"><div className="text-sm font-semibold text-slate-900">Category {cat}</div><div className="text-xs text-slate-500">{sigs.length} {sigs.length === 1 ? 'signatory' : 'signatories'}</div></div><div className="text-xs text-slate-500">{min === max ? formatMoney(max) : `${formatMoney(min)} – ${formatMoney(max)}`}</div></div>
          <div className="flex flex-wrap gap-2">{sigs.map(s => <div key={s.id} className="text-xs bg-slate-50 px-2.5 py-1 rounded border border-slate-200"><span className="text-slate-700 font-medium">{s.name}</span><span className="text-slate-400"> · </span><span className="text-slate-900 font-semibold">{formatMoney(s.limit || 0)}</span></div>)}</div>
        </div>
      );
    };
    return (
      <div>
        <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Mandate · Step 4 of 6</div>
        <h2 className="text-2xl font-semibold text-slate-900 leading-tight mb-2.5">Let's check the limits make sense</h2>
        <p className="text-sm text-slate-600 mb-7 max-w-xl">Validated authority limits across categories.</p>
        <div className="max-w-3xl space-y-3">
          {catA.length > 0 && <CategorySummary cat="A" sigs={catA} />}
          {catB.length > 0 && <CategorySummary cat="B" sigs={catB} />}
        </div>
        {inconsistency ? <div className="mt-5 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 max-w-3xl text-xs text-amber-900 flex items-start gap-2.5"><AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" /><div><strong>Heads up:</strong> Lowest Cat A limit ({formatMoney(minA)}) is below highest Cat B ({formatMoney(maxB)}). Most boards arrange Cat A equal to or above Cat B.</div></div> : <div className="mt-5 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 max-w-3xl text-xs text-emerald-900 flex items-start gap-2.5"><Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" /><div><strong>All consistent.</strong> Category limits are in ascending order.</div></div>}
      </div>
    );
  };

  const MandateStep5Sub = () => {
    const [hasSpecial, setHasSpecial] = useState<string | null>(null);
    return (
      <div>
        <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Mandate · Step 5 of 6</div>
        <h2 className="text-2xl font-semibold text-slate-900 leading-tight mb-2.5">Any special arrangements?</h2>
        <p className="text-sm text-slate-600 mb-7 max-w-xl">Sole-signing carve-outs, group-signing exceptions, period-based rules.</p>
        <div className="space-y-2.5 max-w-2xl">
          <SigningOption label="No special arrangements" desc="Signing rules as previously set." selected={hasSpecial === 'no'} onClick={() => setHasSpecial('no')} />
          <SigningOption label="Yes, we have special arrangements" desc="Additional sole-signing limits or period rules." selected={hasSpecial === 'yes'} onClick={() => setHasSpecial('yes')} />
        </div>
        {hasSpecial === 'yes' && <div className="mt-5 max-w-2xl"><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Describe</label><textarea placeholder="e.g. Emergency sole-signing rights up to S$10,000 for CFO during overseas travel..." rows={4} className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg text-sm resize-none" /></div>}
      </div>
    );
  };

  const MandateStep6Sub = () => {
    const ruleText = { 'any-one': 'Any one signatory may approve on their own up to their authority limit.', 'any-two': 'Any two signatories must approve jointly.', 'categories': 'Signatories grouped into categories with different authority limits.', 'custom': 'Custom signing arrangements.' };
    return (
      <div>
        <div className="text-[11px] text-blue-600 uppercase tracking-wider font-semibold mb-3">Mandate · Step 6 · Review</div>
        <h2 className="text-2xl font-semibold text-slate-900 leading-tight mb-2.5">Here's your mandate, in plain English</h2>
        <p className="text-sm text-slate-600 mb-7 max-w-xl">Read it through. If anything's wrong, go back.</p>
        <div className="max-w-3xl bg-slate-50 border border-slate-200 rounded-xl p-6">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Your mandate summary</div>
          <div className="space-y-3 text-sm text-slate-800 leading-relaxed">
            <div className="flex gap-3"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /><div><strong>Signing rule:</strong> {signingRule ? ruleText[signingRule] : 'Not yet set.'}</div></div>
            <div className="flex gap-3"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /><div><strong>Authorised signatories ({signatories.length}):</strong><ul className="mt-1.5 ml-1 space-y-1">{signatories.map(s => <li key={s.id} className="text-slate-700">{s.name} ({s.role}) · Cat {s.category} · up to <strong>{formatMoney(s.limit || 0)}</strong></li>)}</ul></div></div>
            <div className="flex gap-3"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /><div><strong>Special arrangements:</strong> None.</div></div>
          </div>
        </div>
      </div>
    );
  };

  const MandateManual = () => {
    const totalSteps = 6;
    const goNext = () => {
      if (mandateStep === 1 && !signingRule) { showToast('Pick a signing rule.'); return; }
      if (mandateStep < totalSteps) { setMandateStep(mandateStep + 1); advanceCompletion('mandate', Math.round(((mandateStep + 1) / totalSteps) * 100)); }
      else { advanceCompletion('mandate', 100); setSection('s2b'); showToast('Mandate complete'); }
    };
    const goPrev = () => { if (mandateStep > 1) setMandateStep(mandateStep - 1); else if (specMode === 'b') setMandateMode('chooser'); };
    const renderStep = () => {
      if (mandateStep === 1) return <MandateStep1Sub />;
      if (mandateStep === 2) return <MandateStep2Sub />;
      if (mandateStep === 3) return <MandateStep3Sub />;
      if (mandateStep === 4) return <MandateStep4Sub />;
      if (mandateStep === 5) return <MandateStep5Sub />;
      if (mandateStep === 6) return <MandateStep6Sub />;
    };
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900">Set up your mandate</div><div className="text-sm text-slate-500">Branching decisions, one question at a time.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold tracking-wider">FOCUS MODE</div></div>
        <div className="flex gap-1.5 mt-7 mb-7">{Array.from({ length: totalSteps }, (_, i) => i + 1).map(n => <div key={n} className={`flex-1 h-1 rounded-full ${n <= mandateStep ? 'bg-blue-500' : 'bg-slate-200'}`} />)}</div>
        {renderStep()}
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={goPrev} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <div className="text-xs text-slate-400">Step {mandateStep} of {totalSteps}</div>
          <button onClick={goNext} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">{mandateStep === totalSteps ? 'Complete' : 'Continue'}<ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  const MandateSection = () => {
    if (specMode === 'a') return <MandateManual />;
    if (mandateMode === 'chooser') return <MandateChooser />;
    if (mandateMode === 'ai-processing' || mandateMode === 'ai-extracted') return <MandateAiView />;
    return <MandateManual />;
  };

  const RoleBadge = ({ role }: { role: string }) => {
    const styles: Record<string, string> = { 'Admin': 'bg-purple-100 text-purple-700', 'Authoriser': 'bg-blue-100 text-blue-700', 'Inputter': 'bg-emerald-100 text-emerald-700', 'Viewer': 'bg-slate-100 text-slate-600' };
    return <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded ${styles[role] || styles.Viewer}`}>{role}</span>;
  };

  const S2BSection = () => {
    const [showAdd, setShowAdd] = useState(false);
    const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Inputter', dailyLimit: 50000 });
    const addUser = () => { if (!newUser.name || !newUser.email) { showToast('Name and email required.'); return; } setS2bUsers([...s2bUsers, { ...newUser, id: Date.now() }]); setNewUser({ name: '', email: '', role: 'Inputter', dailyLimit: 50000 }); setShowAdd(false); showToast('User added'); };
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900">Straight2Bank setup</div><div className="text-sm text-slate-500">Users, roles, per-user transaction limits.</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold tracking-wider">CLUSTER MODE</div></div>
        <div className="mt-7">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">1</div><h3 className="text-sm font-semibold text-slate-900">Online banking users</h3></div>
          <div className="ml-9 space-y-2.5">
            {s2bUsers.map(user => (
              <div key={user.id} className="border border-slate-200 rounded-xl px-5 py-4 bg-white flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-xs flex-shrink-0">{user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{user.name}</div><div className="text-xs text-slate-500">{user.email}</div></div>
                <RoleBadge role={user.role} />
                <div className="text-xs text-slate-700 font-medium">Daily: <span className="text-slate-900 font-semibold">{formatMoney(user.dailyLimit)}</span></div>
                {s2bUsers.length > 1 && <button onClick={() => setS2bUsers(s2bUsers.filter(u => u.id !== user.id))} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
              </div>
            ))}
            {!showAdd ? <button onClick={() => setShowAdd(true)} className="w-full border-2 border-dashed border-slate-300 rounded-xl py-3 text-sm font-medium text-blue-600 flex items-center justify-center gap-2"><Plus size={16} />Add user</button> : (
              <div className="border border-slate-300 rounded-xl p-4 bg-white">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <InputField label="Name" value={newUser.name} onChange={(v) => setNewUser({ ...newUser, name: v })} placeholder="Full name" />
                  <InputField label="Email" value={newUser.email} onChange={(v) => setNewUser({ ...newUser, email: v })} placeholder="email@company.com" />
                  <div><label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Role</label><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"><option value="Admin">Admin</option><option value="Authoriser">Authoriser</option><option value="Inputter">Inputter</option><option value="Viewer">Viewer</option></select></div>
                  <InputField label="Daily limit (S$)" type="number" value={newUser.dailyLimit} onChange={(v) => setNewUser({ ...newUser, dailyLimit: parseInt(v) || 0 })} />
                </div>
                <div className="flex justify-end gap-2"><button onClick={() => setShowAdd(false)} className="px-3 py-1.5 border border-slate-300 rounded-full text-xs font-medium text-slate-700">Cancel</button><button onClick={addUser} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-full">Add</button></div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setSection('mandate')} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={() => { advanceCompletion('s2b', 100); setSection('documents'); showToast('S2B setup saved'); }} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  const DocumentsSection = () => {
    const isAurelius = entity === 'aurelius';
    const requiredDocs = isAurelius ? [
      { id: 'acra', name: 'ACRA basic record', type: 'auto', extracts: ['UEN', 'incorporation'] },
      { id: 'incorp', name: 'Certificate of incorporation', type: 'required', extracts: ['legal name', 'entity type'] },
      { id: 'constitution', name: 'Constitutional documents', type: 'required', extracts: ['share structure'] },
      { id: 'board', name: 'Board resolution', type: 'required', extracts: ['signatories', 'rules'] }
    ] : [
      { id: 'acra', name: 'ACRA business profile', type: 'auto', extracts: ['UEN', 'directors', 'address'] },
      { id: 'incorp', name: 'Certificate of incorporation', type: 'required', extracts: ['confirms ACRA data'] },
      { id: 'board', name: 'Board resolution', type: 'required', extracts: ['signatories', 'rules'] }
    ];

    const peopleRaw = [
      ...signatories.map(s => ({ id: `sig-${s.id}`, name: s.name, role: s.role })),
      ...s2bUsers.filter(u => u.role !== 'Viewer').map(u => ({ id: `user-${u.id}`, name: u.name, role: `S2B ${u.role}` }))
    ];
    type PersonEntry = { id: string; name: string; role: string; roles: string[] };
    const dedupedPeople = peopleRaw.reduce<PersonEntry[]>((acc, p) => {
      const existing = acc.find(x => x.name === p.name);
      if (existing) existing.roles.push(p.role);
      else acc.push({ ...p, roles: [p.role] });
      return acc;
    }, []);

    const [pendingDocId, setPendingDocId] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<{ pid: string; idType: 'passport' | 'nric'; name: string } | null>(null);
    const localDocFileRef = useRef<HTMLInputElement>(null);
    const localIdFileRef = useRef<HTMLInputElement>(null);

    const startDocUpload = (docId: string, file?: File) => {
      if (!file) {
        setDocIntelState(prev => ({ ...prev, uploadedDocs: [...prev.uploadedDocs, docId] }));
        showToast('Document attached.');
        return;
      }
      setDocIntelState(prev => ({
        ...prev, isProcessing: true, processingStep: 1, showSidePanel: true,
        currentDocId: docId, currentNarrative: undefined,
      }));
      const s2 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 2 })), 1200);
      const s3 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 3 })), 2400);
      const s4 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 4 })), 3600);

      processDocumentPack([file])
        .then(({ narrative }) => {
          clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
          setDocIntelState(prev => ({
            ...prev, processingStep: 5, isProcessing: false,
            currentNarrative: narrative, uploadedDocs: [...prev.uploadedDocs, docId],
          }));
          showToast('Document processed.');
        })
        .catch((err) => {
          clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
          setDocIntelState(prev => ({ ...prev, isProcessing: false, processingStep: 0 }));
          showToast(`Processing error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        });
    };

    const startIdUpload = (pid: string, idType: 'passport' | 'nric', name: string, file?: File) => {
      if (!file) {
        setIdUploads(prev => ({ ...prev, [pid]: { idType, name, matched: true, uploaded: true } }));
        showToast(`ID attached for ${name}`);
        return;
      }
      setDocIntelState(prev => ({
        ...prev, isProcessing: true, processingStep: 1, showSidePanel: true,
        currentDocId: `${pid}-${idType}`, currentNarrative: undefined,
      }));
      const s2 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 2 })), 1200);
      const s3 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 3 })), 2400);
      const s4 = setTimeout(() => setDocIntelState(prev => ({ ...prev, processingStep: 4 })), 3600);

      processIdDocument(file, name)
        .then(({ narrative, nameMatched }) => {
          clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
          setDocIntelState(prev => ({ ...prev, processingStep: 5, isProcessing: false, currentNarrative: narrative }));
          setIdUploads(prev => ({ ...prev, [pid]: { idType, name, matched: nameMatched, uploaded: true } }));
          showToast(nameMatched ? `ID verified for ${name}` : `Name mismatch — review required`);
        })
        .catch((err) => {
          clearTimeout(s2); clearTimeout(s3); clearTimeout(s4);
          setDocIntelState(prev => ({ ...prev, isProcessing: false, processingStep: 0 }));
          showToast(`Processing error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        });
    };

    const isUploaded = (id: string) => id === 'acra' || docIntelState.uploadedDocs.includes(id);
    const idVerified = Object.values(idUploads).filter(u => u.matched).length;
    const idMismatched = Object.values(idUploads).filter(u => u.uploaded && !u.matched).length;
    const aiOn = specMode === 'b';

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900 flex items-center">Documents<SpecBadge type="enhanced" /></div><div className="text-sm text-slate-500">{aiOn ? (isAurelius ? 'Upload documents — we extract structured data and pre-fill.' : 'Upload supporting documents to confirm ACRA data.') : 'Attach the required documents. Identity checked manually against the mandate.'}</div></div><div className={`text-[10px] px-2.5 py-1 rounded-full font-semibold tracking-wider ${aiOn ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{aiOn ? 'DOC INTELLIGENCE' : 'MANUAL UPLOAD'}</div></div>
        <div className={`grid ${aiOn && docIntelState.showSidePanel ? 'lg:grid-cols-2 gap-5' : 'grid-cols-1'} mt-5`}>
          <div>
            <SpecBOutline type="enhanced">
              <div className="rounded-xl border-2 border-dashed border-blue-300 bg-gradient-to-br from-blue-50 to-white p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0"><Upload size={20} /></div>
                <div className="flex-1"><div className="text-sm font-semibold text-slate-900">Drop documents or click to browse</div><div className="text-xs text-slate-600 mt-0.5">{aiOn ? 'Auto-classified, extracted, validated' : 'Attached to the application and reviewed by the bank'}</div></div>
                <button onClick={() => {
                  if (!aiOn) { showToast('Document attached.'); return; }
                  docUploadInputRef.current?.click();
                }} disabled={docIntelState.isProcessing} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-full hover:bg-blue-700 disabled:bg-slate-300">{docIntelState.isProcessing ? 'Processing...' : 'Choose files'}</button>
              </div>
            </SpecBOutline>
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">1</div><h3 className="text-sm font-semibold text-slate-900">Required documents</h3></div>
              <div className="ml-9 space-y-2.5">
                {requiredDocs.map(doc => {
                  const uploaded = isUploaded(doc.id);
                  const isCurrent = docIntelState.isProcessing && docIntelState.currentDocId === doc.id;
                  return (
                    <div key={doc.id} className={`border rounded-xl px-5 py-3.5 ${uploaded ? 'border-emerald-200 bg-emerald-50/40' : isCurrent ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${uploaded ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-500 text-white animate-pulse' : 'bg-slate-100 text-slate-500'}`}><FileText size={16} /></div>
                        <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{doc.name}</div><div className="text-xs text-slate-600">{doc.type === 'auto' ? 'Auto-fetched from ACRA' : aiOn ? `Extracts: ${doc.extracts.join(', ')}` : 'Required for review'}</div></div>
                        {uploaded ? <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-700">{aiOn ? '✓ Verified' : '✓ Attached'}</span> : isCurrent ? <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700">Processing</span> : <button onClick={() => {
                          if (aiOn) { setPendingDocId(doc.id); localDocFileRef.current?.click(); }
                          else { setDocIntelState(prev => ({ ...prev, uploadedDocs: [...prev.uploadedDocs, doc.id] })); }
                        }} disabled={docIntelState.isProcessing} className="text-xs text-blue-600 font-semibold hover:underline disabled:text-slate-400">Upload</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-7">
              <div className="flex items-center gap-3 mb-2"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">2</div><h3 className="text-sm font-semibold text-slate-900">Identity verification</h3>{aiOn && <SpecBadge type="spec-b">Cross-section reconciliation</SpecBadge>}</div>
              <div className="ml-9 mb-4 text-xs text-slate-600">{aiOn ? 'Each signatory and S2B user needs valid ID. Names extracted from IDs are reconciled against Mandate and S2B sections.' : 'Each signatory and S2B user needs valid ID. Attach each one; the bank checks names against the mandate during review.'}{aiOn && <span className="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">{idVerified} verified</span>}{aiOn && idMismatched > 0 && <span className="ml-1.5 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">{idMismatched} mismatch</span>}</div>
              <div className="ml-9 space-y-2.5">
                {dedupedPeople.map(person => {
                  const upload = idUploads[person.id];
                  const isCurrent = docIntelState.isProcessing && docIntelState.currentDocId?.startsWith(person.id);
                  const matched = upload?.matched;
                  const mismatched = upload && !upload.matched;
                  const card = (
                    <div className={`border rounded-xl px-5 py-3.5 ${matched ? 'border-emerald-200 bg-emerald-50/40' : mismatched ? 'border-red-300 bg-red-50/40' : isCurrent ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${matched ? 'bg-emerald-500 text-white' : mismatched ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}>{matched ? <BadgeCheck size={18} /> : mismatched ? <AlertCircle size={18} /> : person.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                        <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{person.name}</div><div className="flex items-center gap-2 mt-0.5 flex-wrap">{person.roles.map((r, i) => <span key={i} className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{r}</span>)}</div></div>
                        {matched && <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">✓ {upload.idType === 'passport' ? 'Passport' : 'NRIC'} {aiOn ? 'matched' : 'attached'}</span>}
                        {mismatched && <div className="flex items-center gap-2"><span className="text-[10px] uppercase tracking-wider font-semibold text-red-700">⚠ Mismatch</span><button onClick={() => setIdUploads(prev => { const n = { ...prev }; delete n[person.id]; return n; })} className="text-[10px] text-red-600 hover:underline font-semibold">Remove</button></div>}
                        {!upload && !isCurrent && <div className="flex gap-1.5"><button onClick={() => {
                          if (aiOn) { setPendingId({ pid: person.id, idType: 'passport', name: person.name }); localIdFileRef.current?.click(); }
                          else { setIdUploads(prev => ({ ...prev, [person.id]: { idType: 'passport', name: person.name, matched: true, uploaded: true } })); }
                        }} disabled={docIntelState.isProcessing} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-full border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 flex items-center gap-1"><CreditCard size={11} />Passport</button><button onClick={() => {
                          if (aiOn) { setPendingId({ pid: person.id, idType: 'nric', name: person.name }); localIdFileRef.current?.click(); }
                          else { setIdUploads(prev => ({ ...prev, [person.id]: { idType: 'nric', name: person.name, matched: true, uploaded: true } })); }
                        }} disabled={docIntelState.isProcessing} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-full border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 flex items-center gap-1"><CreditCard size={11} />NRIC</button></div>}
                        {isCurrent && <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700">Processing</span>}
                      </div>
                      {mismatched && <div className="mt-3 pt-3 border-t border-red-200"><div className="text-[11px] text-red-800 leading-relaxed"><strong>What we found:</strong> Name on uploaded ID does not match Mandate/S2B record. Re-upload correct ID, or update name in Mandate to match.</div></div>}
                    </div>
                  );
                  return aiOn ? <SpecBOutline key={person.id} type="spec-b">{card}</SpecBOutline> : <div key={person.id}>{card}</div>;
                })}
              </div>
            </div>
            {!isAurelius && aiOn && (
              <div className="mt-7">
                <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">3</div><h3 className="text-sm font-semibold text-slate-900">Already on file</h3><SpecBadge type="spec-b">Cross-application reuse</SpecBadge></div>
                <div className="ml-9">
                  <SpecBOutline type="spec-b">
                    <div className="border border-purple-200 bg-purple-50/40 rounded-xl px-5 py-4 flex items-center gap-4">
                      <div className="w-9 h-9 rounded-lg bg-purple-500 text-white flex items-center justify-center flex-shrink-0"><FileText size={16} /></div>
                      <div className="flex-1"><div className="text-sm font-semibold text-slate-900">Audited financials (FY2024)</div><div className="text-xs text-slate-600">Uploaded 6 months ago, still valid</div></div>
                      <button onClick={() => showToast('Reused.')} className="px-3 py-1.5 border border-purple-300 text-purple-700 text-xs font-semibold rounded-full hover:bg-purple-100">Reuse</button>
                    </div>
                  </SpecBOutline>
                </div>
              </div>
            )}
          </div>
          {aiOn && docIntelState.showSidePanel && (
            <SpecBOutline type="spec-b">
              <div className="bg-gradient-to-br from-purple-50 to-white border border-purple-200 rounded-xl p-5 sticky top-6">
                <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Sparkles size={14} className="text-purple-600" /><h3 className="text-sm font-semibold text-purple-900">Document Intelligence</h3></div><button onClick={() => setDocIntelState(prev => ({ ...prev, showSidePanel: false }))} className="text-purple-400 hover:text-purple-600"><X size={16} /></button></div>
                <div className="space-y-2.5">
                  <PipelineStep n="1" name="Classify" desc="Identify type" active={docIntelState.processingStep === 1} done={docIntelState.processingStep > 1} detail={docIntelState.processingStep >= 1 ? docIntelState.currentNarrative?.classify : null} />
                  <PipelineStep n="2" name="Extract" desc="Pull fields" active={docIntelState.processingStep === 2} done={docIntelState.processingStep > 2} detail={docIntelState.processingStep >= 2 ? docIntelState.currentNarrative?.extract : null} />
                  <PipelineStep n="3" name="Reconcile" desc="Cross-check" active={docIntelState.processingStep === 3} done={docIntelState.processingStep > 3} detail={docIntelState.processingStep >= 3 ? docIntelState.currentNarrative?.reconcile : null} />
                  <PipelineStep n="4" name="Validate" desc="Check quality" active={docIntelState.processingStep === 4} done={docIntelState.processingStep > 4} detail={docIntelState.processingStep >= 4 ? docIntelState.currentNarrative?.validate : null} />
                  <PipelineStep n="5" name="Apply" desc="Update sections" active={docIntelState.processingStep === 5} done={docIntelState.processingStep === 5} detail={docIntelState.processingStep === 5 ? docIntelState.currentNarrative?.apply : null} />
                </div>
              </div>
            </SpecBOutline>
          )}
        </div>
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setSection('s2b')} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={() => { advanceCompletion('documents', 100); setSection('review'); showToast('Documents saved'); }} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 flex items-center gap-1.5">Continue<ChevronRight size={14} /></button>
        </div>
        <input
          ref={localDocFileRef}
          type="file"
          accept=".pdf,.docx,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0] && pendingDocId) startDocUpload(pendingDocId, e.target.files[0]);
            e.target.value = '';
            setPendingDocId(null);
          }}
        />
        <input
          ref={localIdFileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0] && pendingId) startIdUpload(pendingId.pid, pendingId.idType, pendingId.name, e.target.files[0]);
            e.target.value = '';
            setPendingId(null);
          }}
        />
      </div>
    );
  };

  const ReviewSection = () => {
    const generatedDocs = [
      { id: 'aop', name: 'Account Opening Pack', purpose: 'Master agreement', signers: signatories.slice(0, 2).map(s => ({ name: s.name, role: s.role })) },
      { id: 'mandate', name: 'Mandate document', purpose: 'Authority and signing rules', signers: signatories.map(s => ({ name: s.name, role: s.role })) },
      { id: 'w8', name: 'W-8BEN-E', purpose: 'FATCA self-certification', signers: [{ name: 'Alice Smith', role: 'Declaration Signer' }] }
    ];
    if (appStatus === 'client-draft') return renderPreSubmission(generatedDocs);
    return renderPostSubmission(generatedDocs);
  };

  type GeneratedDoc = { id: string; name: string; purpose: string; signers: { name: string; role: string }[] };
  const renderPreSubmission = (generatedDocs: GeneratedDoc[]) => {
    const sectionsForReview = [
      { name: 'Get started', completion: sectionCompletion.start, summary: 'Application created' },
      { name: 'Company details', completion: sectionCompletion.company, summary: ent.name },
      { name: 'Compliance', completion: sectionCompletion.compliance, summary: delegationChoice ? `FATCA: ${delegationChoice}` : 'Pending' },
      { name: 'Accounts', completion: sectionCompletion.accounts, summary: accounts.length > 0 ? `${accounts.length} accounts · ${accounts.map(a => a.currency).join(', ')}` : 'Pending' },
      { name: 'Mandate', completion: sectionCompletion.mandate, summary: signingRule ? `${signatories.length} signatories` : 'Pending' },
      { name: 'S2B setup', completion: sectionCompletion.s2b, summary: `${s2bUsers.length} users` },
      { name: 'Documents', completion: sectionCompletion.documents, summary: 'In progress' }
    ];
    const allComplete = sectionsForReview.every(s => s.completion === 100);
    const completedCount = sectionsForReview.filter(s => s.completion === 100).length;

    const submitApp = () => {
      advanceCompletion('review', 100);
      setAppStatus('bank-review');
      const initialSigning: Record<string, string> = {};
      generatedDocs.forEach(doc => doc.signers.forEach(signer => { initialSigning[`${doc.id}-${signer.name}`] = 'pending'; }));
      setSigningState(initialSigning);
      showToast('Submitted. Bank review starting.');
      setTimeout(() => { setAppStatus('awaiting-signatures'); showToast('Bank review complete. DocuSign routed.'); }, 3500);
    };

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900">Review and submit</div><div className="text-sm text-slate-500">{allComplete ? 'Everything ready. Send for bank review.' : `${completedCount} of ${sectionsForReview.length} sections complete.`}</div></div><div className="text-[10px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold tracking-wider">REVIEW</div></div>
        <div className="mt-7">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">1</div><h3 className="text-sm font-semibold text-slate-900">Section summary</h3></div>
          <div className="ml-9 space-y-2">
            {sectionsForReview.map((s, idx) => (
              <div key={idx} className={`border rounded-xl px-5 py-3.5 flex items-center gap-4 ${s.completion === 100 ? 'border-emerald-200 bg-emerald-50/40' : s.completion > 0 ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${s.completion === 100 ? 'bg-emerald-500 text-white' : s.completion > 0 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>{s.completion === 100 ? <Check size={15} /> : <span className="text-[10px] font-bold">{s.completion}%</span>}</div>
                <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{s.name}</div><div className="text-xs text-slate-600 truncate">{s.summary}</div></div>
                {s.completion < 100 && <button onClick={() => setSection(sections[idx + 1]?.id)} className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"><Edit3 size={12} />Continue</button>}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-7">
          <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">2</div><h3 className="text-sm font-semibold text-slate-900">Documents to be generated and signed</h3></div>
          <div className="ml-9 space-y-2.5">
            {generatedDocs.map(doc => (
              <div key={doc.id} className="border border-slate-200 rounded-xl px-5 py-4 bg-white">
                <div className="flex items-start gap-4"><div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0"><FileText size={18} /></div><div className="flex-1"><div className="text-sm font-semibold text-slate-900">{doc.name}</div><div className="text-xs text-slate-600 mt-0.5">{doc.purpose}</div><div className="flex items-center gap-2 mt-2"><span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Signers:</span><div className="flex flex-wrap gap-1.5">{doc.signers.map((s, i) => <span key={i} className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-700 font-medium">{s.name}</span>)}</div></div></div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <button onClick={() => setSection('documents')} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><ChevronLeft size={14} />Back</button>
          <button onClick={submitApp} className={`px-6 py-2.5 text-sm font-semibold rounded-full flex items-center gap-2 ${allComplete ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}><Send size={14} />{allComplete ? 'Submit for review' : 'Submit anyway'}</button>
        </div>
      </div>
    );
  };

  const StatusStage = ({ label, done, active, last }: { label: string; done: boolean; active: boolean; last?: boolean }) => (
    <div className="relative">
      <div className="flex items-center gap-2"><div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-600 text-white shadow-[0_0_0_4px_#dbeafe]' : 'bg-slate-100 text-slate-400 border border-slate-300'}`}>{done ? <Check size={13} /> : '·'}</div><div className={`text-xs font-semibold ${done ? 'text-slate-700' : active ? 'text-blue-600' : 'text-slate-400'}`}>{label}</div></div>
      {!last && <div className={`h-0.5 mt-3 ${done ? 'bg-emerald-500' : 'bg-slate-200'}`}></div>}
    </div>
  );

  const ValidationLine = ({ label, status }: { label: string; status: 'done' | 'checking' | 'queued' }) => (
    <div className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg border border-blue-100">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${status === 'done' ? 'bg-emerald-500 text-white' : status === 'checking' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'}`}>{status === 'done' ? <Check size={12} /> : status === 'checking' ? <div className="w-2 h-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : '·'}</div>
      <div className="flex-1 text-xs text-slate-700 font-medium">{label}</div>
      <span className={`text-[10px] uppercase tracking-wider font-semibold ${status === 'done' ? 'text-emerald-700' : status === 'checking' ? 'text-blue-700' : 'text-slate-400'}`}>{status === 'done' ? 'Pass' : status === 'checking' ? 'Checking' : 'Queued'}</span>
    </div>
  );

  const renderPostSubmission = (generatedDocs: GeneratedDoc[]) => {
    const allSigned = Object.values(signingState).every(s => s === 'signed');
    const signedCount = Object.values(signingState).filter(s => s === 'signed').length;
    const totalSignatures = Object.keys(signingState).length;
    if (allSigned && appStatus === 'awaiting-signatures') setTimeout(() => { setAppStatus('activated'); showToast('All signed. Activation in progress.'); }, 600);
    const simulateSign = (docId: string, signerName: string) => { setSigningState(prev => ({ ...prev, [`${docId}-${signerName}`]: 'signed' })); showToast(`${signerName} signed`); };

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm m-4 px-5 py-6 md:m-6 md:px-8 md:py-7">
        <div className="flex items-start justify-between gap-3 mb-1"><div><div className="text-xl font-semibold text-slate-900">{appStatus === 'bank-review' ? 'Bank review in progress' : appStatus === 'awaiting-signatures' ? 'Awaiting signatures' : 'Application activated'}</div><div className="text-sm text-slate-500">{appStatus === 'bank-review' ? 'Validating against PACE, eBBS, CADM.' : appStatus === 'awaiting-signatures' ? `${signedCount} of ${totalSignatures} signatures collected.` : 'All signatures collected. Accounts now active.'}</div></div><div className={`text-[10px] px-2.5 py-1 rounded-full font-semibold tracking-wider ${appStatus === 'bank-review' ? 'bg-blue-50 text-blue-700' : appStatus === 'awaiting-signatures' ? 'bg-purple-50 text-purple-700' : 'bg-emerald-50 text-emerald-700'}`}>{appStatus === 'bank-review' ? 'BANK REVIEW' : appStatus === 'awaiting-signatures' ? 'E-SIGNING' : 'ACTIVATED'}</div></div>
        <div className="mt-7 max-w-3xl">
          <div className="grid grid-cols-4 gap-2">
            <StatusStage label="Submitted" done active={false} />
            <StatusStage label="Bank review" done={appStatus !== 'bank-review'} active={appStatus === 'bank-review'} />
            <StatusStage label="E-signatures" done={appStatus === 'activated'} active={appStatus === 'awaiting-signatures'} />
            <StatusStage label="Activated" done={appStatus === 'activated'} active={appStatus === 'activated'} last />
          </div>
        </div>
        {appStatus === 'bank-review' && (
          <div className="mt-7 max-w-3xl"><div className="bg-blue-50 border border-blue-200 rounded-xl p-5"><div className="flex items-start gap-3"><div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0"><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div></div><div className="flex-1"><div className="text-sm font-semibold text-slate-900">Validating against bank systems</div></div></div><div className="mt-4 space-y-2"><ValidationLine label="PACE — product and channel enablement" status="checking" /><ValidationLine label="eBBS — entity setup and account configuration" status="checking" /><ValidationLine label="CADM — customer master data" status="queued" /><ValidationLine label="Sanctions and PEP screening" status="queued" /></div></div></div>
        )}
        {(appStatus === 'awaiting-signatures' || appStatus === 'activated') && (
          <div className="mt-7">
            <div className="flex items-center gap-3 mb-4"><div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">{appStatus === 'activated' ? <Check size={13} /> : '1'}</div><h3 className="text-sm font-semibold text-slate-900">DocuSign envelopes</h3><span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">{signedCount} of {totalSignatures} signed</span></div>
            <div className="ml-9 space-y-3">
              {generatedDocs.map(doc => {
                const allDocSigned = doc.signers.every(s => signingState[`${doc.id}-${s.name}`] === 'signed');
                return (
                  <div key={doc.id} className={`border rounded-xl px-5 py-4 ${allDocSigned ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-start gap-4 mb-3"><div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${allDocSigned ? 'bg-emerald-500 text-white' : 'bg-purple-100 text-purple-600'}`}>{allDocSigned ? <Check size={18} /> : <FileText size={18} />}</div><div className="flex-1"><div className="flex items-center gap-2"><div className="text-sm font-semibold text-slate-900">{doc.name}</div>{allDocSigned && <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Fully signed</span>}</div><div className="text-xs text-slate-600 mt-0.5">{doc.purpose}</div></div></div>
                    <div className="ml-14 space-y-1.5">
                      {doc.signers.map((signer, idx) => {
                        const status = signingState[`${doc.id}-${signer.name}`];
                        return (
                          <div key={idx} className="flex items-center gap-3 py-1.5">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-semibold ${status === 'signed' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}>{status === 'signed' ? <Check size={12} /> : signer.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}</div>
                            <div className="flex-1"><div className="text-xs font-semibold text-slate-900">{signer.name}</div><div className="text-[10px] text-slate-500">{signer.role}</div></div>
                            {status === 'signed' ? <span className="text-[10px] text-emerald-700 font-semibold">✓ Signed</span> : <div className="flex items-center gap-2"><span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-semibold">⏱ Pending</span>{appStatus === 'awaiting-signatures' && <button onClick={() => simulateSign(doc.id, signer.name)} className="text-[10px] text-blue-600 hover:underline font-semibold">Simulate sign</button>}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {appStatus === 'awaiting-signatures' && <div className="ml-9 mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-900 flex items-start gap-2.5"><AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" /><div><strong>No clickable links</strong> per ICS policy. Signers visit docusign.standardchartered.com manually.</div></div>}
          </div>
        )}
        {appStatus === 'activated' && (
          <div className="mt-7 max-w-3xl"><div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 rounded-xl p-6"><div className="flex items-start gap-4"><div className="w-12 h-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0"><Check size={24} /></div><div className="flex-1"><div className="text-base font-semibold text-emerald-900">Your accounts are active</div><div className="text-sm text-emerald-800 mt-1">{accounts.length} accounts activated, S2B credentials dispatched to {s2bUsers.length} users by post.</div></div></div></div></div>
        )}
        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500">App ID: APP-{entity === 'meridian' ? 'MER' : 'AUR'}-2026-0001</div>
          <button onClick={resetToBaseline} className="px-4 py-2 border border-slate-300 rounded-full text-sm font-medium text-slate-700 flex items-center gap-1.5"><RotateCcw size={14} />Run demo again</button>
        </div>
      </div>
    );
  };

  const ChatContent = () => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const handleSend = async () => {
      const text = chatInput.trim();
      if (!text || chatLoading) return;
      const userMsg: ChatMessage = { role: 'user', content: text };
      const next = [...chatMessages, userMsg];
      setChatMessages(next);
      setChatInput('');
      setChatLoading(true);
      try {
        const context: ChatContext = {
          entity,
          entityName: ent.name,
          section,
          companyName: companyFields[entity].legalName || undefined,
        };
        const reply = await sendChatMessage(next, context);
        setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      } catch {
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I ran into an error. Please try again.' }]);
      } finally {
        setChatLoading(false);
      }
    };

    const starters = [
      'What documents do I need to open a corporate account?',
      'How do signing categories A and B work?',
      'What is MAS Notice 626?',
      'How long does account opening take?',
    ];

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0" style={{ background: '#2C3A87' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"><Bot size={14} className="text-white" /></div>
            <div>
              <div className="text-sm font-semibold text-white">KYC Assistant</div>
              <div className="text-[10px] text-white/70">Onboarding specialist</div>
            </div>
          </div>
          <button onClick={() => setChatOpen(false)} className="text-white/60 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {chatMessages.length === 0 && (
            <div className="space-y-4">
              <div className="flex justify-start">
                <div className="max-w-[90%] px-3 py-2.5 rounded-2xl rounded-tl-sm bg-slate-100 text-slate-900 text-sm leading-relaxed">
                  Hi! I'm your KYC and onboarding specialist. Ask me anything about account opening requirements, document needs, signing mandates, or S2B setup.
                </div>
              </div>
              <div className="space-y-2">
                {starters.map(q => (
                  <button
                    key={q}
                    onClick={() => { setChatInput(q); }}
                    className="w-full text-left text-xs px-3 py-2 rounded-full border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50/50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] px-3 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-slate-100 text-slate-900 rounded-tl-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="px-3 py-2.5 rounded-2xl rounded-tl-sm bg-slate-100 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-3 py-3 border-t border-slate-200 flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask about KYC, documents, mandates…"
              rows={1}
              className="flex-1 resize-none px-3 py-2 text-sm border border-slate-300 rounded-2xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 max-h-28 overflow-y-auto"
              style={{ minHeight: '38px' }}
            />
            <button
              onClick={handleSend}
              disabled={!chatInput.trim() || chatLoading}
              className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:bg-slate-200 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
          {chatMessages.length > 0 && (
            <button
              onClick={() => setChatMessages([])}
              className="mt-1.5 text-[10px] text-slate-400 hover:text-slate-600 w-full text-center"
            >
              Clear conversation
            </button>
          )}
        </div>
      </div>
    );
  };
  void ChatContent;

  const renderSection = () => {
    if (section === 'start') return <StartSection />;
    if (section === 'company') return CompanySection();
    if (section === 'compliance') return ComplianceSection();
    if (section === 'accounts') return <AccountsSection />;
    if (section === 'mandate') return <MandateSection />;
    if (section === 's2b') return <S2BSection />;
    if (section === 'documents') return <DocumentsSection />;
    if (section === 'review') return <ReviewSection />;
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <style>{`@keyframes fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } .animate-fadein { animation: fadein 0.2s ease-out; }`}</style>
      <Banner />
      <div className="flex">
        <JourneyMap />
        <div className="flex-1 min-w-0">
          <MissionControl />
          {renderSection()}
        </div>
      </div>
      <Toast />
      <Modal />
      <input
        ref={spvPackInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) runAureliusPack(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={docUploadInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) startDocUploadWithFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={mandateFileInputRef}
        type="file"
        accept=".pdf,.docx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) runMandateAi(e.target.files[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}