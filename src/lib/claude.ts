import mammoth from 'mammoth';

export interface NarrativeStep {
  classify: string;
  extract: string;
  reconcile: string;
  validate: string;
  apply: string;
}

export interface CompanyExtract {
  legalName?: string;
  uen?: string;
  entityType?: string;
  incorporated?: string;
  address?: string;
  industry?: string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  primaryMarkets?: string;
}

export interface SignatoryExtract {
  name: string;
  role: string;
  category: 'A' | 'B';
  limit: number;
}

export interface MandateRuleExtract {
  tier: string;
  label: string;
  limit: string;
  rule: string;
  services: string;
  rawText: string;
}

export interface DocumentPackResult {
  narrative: NarrativeStep;
  extractedFields: CompanyExtract;
}

export interface IdDocumentResult {
  narrative: NarrativeStep;
  nameMatched: boolean;
  extractedName: string;
}

export interface MandateDocumentResult {
  narrative: NarrativeStep;
  signatories: SignatoryExtract[];
  rules: MandateRuleExtract[];
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

async function fileToContentBlock(file: File): Promise<ContentBlock> {
  const isDocx =
    file.name.toLowerCase().endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (isDocx) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { type: 'text', text: `[Document: ${file.name}]\n\n${result.value}` };
  }
  const base64 = await toBase64(file);
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  const mediaType = file.type || 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function callClaude(userContent: ContentBlock[], systemPrompt: string): Promise<string> {
  const response = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('No text in Claude response');
  return textBlock.text;
}

function parseJson<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in Claude response');
  return JSON.parse(match[0]) as T;
}

export async function processDocumentPack(files: File[]): Promise<DocumentPackResult> {
  const contentBlocks = await Promise.all(files.map(fileToContentBlock));
  const system = `You are a KYC specialist at a Singapore bank. You have received one or more documents submitted as part of a CORPORATE account opening application. Your job is to extract information regardless of what each document is titled or named — the file name and document heading may be inaccurate or generic. Reason entirely from the actual content.

STEP 1 — Identify the company being onboarded:
Look for any of: registered company name, "Pte Ltd" / "Ltd" / "LLP" suffix, UEN/ACRA number, business registration number, employer name on an individual form, entity named as account holder, party named in a board resolution. Use the most authoritative source found.

STEP 2 — Identify the primary contact person:
Look for any of: named applicant, authorized representative, director, signatory, account holder (if individual submitting on behalf of company), person whose email/phone/NRIC appears. Their occupation or stated role becomes their title.

STEP 3 — Extract address carefully:
Only extract as company address if it is labeled as: registered address, business address, office address, or company address. Do NOT use a personal home/residential address as the company address.

STEP 4 — Fill fields only from evidence in the document. Omit any field you cannot confidently support.

Field definitions:
- legalName: Full registered company name
- uen: Singapore UEN or company registration number (digits + letter format)
- entityType: Legal structure (e.g. "Private Limited Company", "Sole Proprietorship", "LLP")
- incorporated: Company incorporation/registration date as "DD MMM YYYY"
- address: Company registered/business address only
- industry: Business activity, sector, or SSIC description
- contactName: Primary contact person's full name
- contactTitle: Their job title or role
- contactEmail: Their email address
- contactPhone: Their mobile or direct phone number
- primaryMarkets: Countries or regions the company operates in

Return ONLY raw JSON (no markdown, no code fences):
{
  "classify": "1-2 sentences: what each document actually is based on its content, regardless of file name",
  "extract": "1-2 sentences: which fields came from which part of which document",
  "reconcile": "1-2 sentences: consistency across documents, or 'Single document submitted' if only one",
  "validate": "1-2 sentences: document validity signals (dates, signatures, seals, expiry)",
  "apply": "1 sentence: summary of what is now populated in the application",
  "extractedFields": {
    "legalName": "...",
    "uen": "...",
    "entityType": "...",
    "incorporated": "...",
    "address": "...",
    "industry": "...",
    "contactName": "...",
    "contactTitle": "...",
    "contactEmail": "...",
    "contactPhone": "...",
    "primaryMarkets": "..."
  }
}`;

  const raw = await callClaude(contentBlocks, system);
  type RawResult = NarrativeStep & { extractedFields?: CompanyExtract };
  const parsed = parseJson<RawResult>(raw);
  return {
    narrative: {
      classify: parsed.classify,
      extract: parsed.extract,
      reconcile: parsed.reconcile,
      validate: parsed.validate,
      apply: parsed.apply,
    },
    extractedFields: parsed.extractedFields ?? {},
  };
}

export async function processIdDocument(file: File, expectedName: string): Promise<IdDocumentResult> {
  const contentBlock = await fileToContentBlock(file);
  const system = `You are a KYC officer at a bank verifying an identity document. The document should belong to: "${expectedName}".

Return ONLY raw JSON:
{
  "classify": "Document type identified (e.g. Singapore Passport, NRIC, foreign passport)",
  "extract": "Name, document number, date of birth, expiry date extracted",
  "reconcile": "Whether the extracted name matches '${expectedName}' — note any differences",
  "validate": "Expiry status, MRZ checksum validity if visible, document condition",
  "apply": "Action: identity verified or flagged for mismatch",
  "nameMatched": true,
  "extractedName": "Name exactly as it appears on the document"
}`;

  const raw = await callClaude([contentBlock], system);
  type RawResult = NarrativeStep & { nameMatched: boolean; extractedName: string };
  const parsed = parseJson<RawResult>(raw);
  return {
    narrative: {
      classify: parsed.classify,
      extract: parsed.extract,
      reconcile: parsed.reconcile,
      validate: parsed.validate,
      apply: parsed.apply,
    },
    nameMatched: parsed.nameMatched ?? false,
    extractedName: parsed.extractedName ?? '',
  };
}

export async function processMandateDocument(file: File): Promise<MandateDocumentResult> {
  const contentBlock = await fileToContentBlock(file);
  const system = `You are a bank officer extracting signing mandate information from a corporate resolution document for a Singapore company.

Return ONLY raw JSON:
{
  "classify": "Document type (board resolution, mandate letter, authorised signatories list, etc.)",
  "extract": "Signatories named, authorization limits, signing rules found in the document",
  "reconcile": "Internal consistency: signatures match named persons, limits are consistent across tiers",
  "validate": "Document validity: signed, dated, within 90-day window from today (10 Jun 2026)",
  "apply": "Mandate structure and signatories populated in application",
  "signatories": [
    { "name": "Full Name", "role": "Job Title", "category": "A", "limit": 500000 }
  ],
  "rules": [
    {
      "tier": "Tier 1",
      "label": "Standard payments",
      "limit": "Up to S$50,000",
      "rule": "Any one signatory",
      "services": "Domestic payments, payroll",
      "rawText": "Quoted text verbatim from document"
    }
  ]
}
Category A = senior/higher-limit signatories, B = operational/lower-limit. Limits as SGD numbers. Include only persons explicitly named as authorized signatories.`;

  const raw = await callClaude([contentBlock], system);
  type RawResult = NarrativeStep & { signatories: SignatoryExtract[]; rules: MandateRuleExtract[] };
  const parsed = parseJson<RawResult>(raw);
  return {
    narrative: {
      classify: parsed.classify,
      extract: parsed.extract,
      reconcile: parsed.reconcile,
      validate: parsed.validate,
      apply: parsed.apply,
    },
    signatories: parsed.signatories ?? [],
    rules: parsed.rules ?? [],
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  entity: string;        // 'meridian' | 'aurelius'
  entityName: string;    // e.g. 'Meridian Trade Solutions Pte. Ltd.'
  section: string;       // e.g. 'company' | 'compliance' etc.
  companyName?: string;  // populated once user has entered it
}

export async function sendChatMessage(
  messages: ChatMessage[],
  context: ChatContext
): Promise<string> {
  const system = `You are a KYC and corporate banking onboarding specialist at Standard Chartered Bank, embedded in the Straight2Bank (S2B) corporate onboarding portal. You help relationship managers and corporate clients navigate:

- KYC/AML-CFT requirements: what documents are needed, why, and how they're verified
- Corporate account opening process, timelines, and sequencing
- Entity types and their specific requirements (Singapore Pte Ltd, LLP, sole proprietor, SPV, foreign branch)
- Signing mandate and authorised signatory setup: categories, limits, signing rules
- S2B digital banking platform: user access, roles (Admin/Authoriser/Inputter/Viewer), transaction limits
- Singapore regulatory requirements: MAS Notice 626, FATCA, CRS, PDPA implications
- ACRA registry data: how it pre-fills the application and what happens when it's outdated
- Document validity: certification requirements, expiry windows, resubmission process
- Compliance flags: PIC entities, defence-related businesses, enhanced due diligence triggers

Current session context:
- Entity scenario: ${context.entityName} (${context.entity === 'meridian' ? 'established company with ACRA registry pre-fill' : 'newly incorporated SPV, no registry data, document upload required'})
- Current section: ${context.section}
${context.companyName ? `- Applicant company: ${context.companyName}` : ''}

Be concise, direct, and professional — one or two short paragraphs maximum unless the question genuinely requires more. When a question is outside your knowledge or concerns this bank's internal policies specifically, say so clearly and direct the user to their relationship manager. Never invent policy details.`;

  const response = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Chat API error ${response.status}: ${err}`);
  }
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock?.text) throw new Error('No text in chat response');
  return textBlock.text;
}
