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
      model: 'claude-opus-4-8',
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
  const system = `You are a KYC specialist at a Singapore bank reviewing documents for a corporate account opening application. Analyze the attached documents carefully.

Return ONLY raw JSON (no markdown, no code fences) with this exact schema:
{
  "classify": "1-2 sentences: each document identified with type and confidence level",
  "extract": "1-2 sentences: which fields were extracted from which documents",
  "reconcile": "1-2 sentences: cross-document consistency findings",
  "validate": "1-2 sentences: document validity checks (dates, signatures, seals)",
  "apply": "1 sentence: what was populated in the application",
  "extractedFields": {
    "legalName": "...",
    "uen": "...",
    "entityType": "Private Limited Company or similar",
    "incorporated": "DD MMM YYYY",
    "address": "full registered address",
    "industry": "...",
    "contactName": "...",
    "contactTitle": "...",
    "contactEmail": "...",
    "contactPhone": "+65 ..."
  }
}
Include only fields you can confidently extract. Omit fields not found.`;

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
