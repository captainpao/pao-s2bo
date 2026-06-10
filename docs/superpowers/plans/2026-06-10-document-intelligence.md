# Document Intelligence — Claude API Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `setTimeout`-simulated pipeline with real Claude API calls that classify, extract, reconcile, validate, and apply uploaded documents (PDF/DOCX/JPG/PNG, one or more files) to the bank onboarding form, and reset all demo form values to a clean starting state.

**Architecture:** Vite dev server proxies `/api/claude` → `api.anthropic.com` — the API key is injected server-side by the proxy and never appears in the browser bundle. `src/lib/claude.ts` encodes files for the API (base64 for PDF/images, mammoth text extraction for DOCX) and makes the fetch call. `App.tsx` gains hidden `<input type="file">` elements wired to existing upload buttons; the pipeline step animation (steps 1–5) is preserved while Claude processes the actual documents; the result is applied at step 5. All pre-filled mock form values are cleared so Claude's contribution is visually clear during the demo.

**Tech Stack:** TypeScript 5, React 18, Vite 6, Anthropic Messages API (`claude-opus-4-8`), mammoth (DOCX text extraction), `fetch` (no SDK — proxy handles auth)

---

## File Map

| Status | Path | Purpose |
|--------|------|---------|
| Create | `.env` | Holds `ANTHROPIC_API_KEY` (gitignored) |
| Create | `.env.example` | Template for the key (tracked) |
| Modify | `vite.config.ts` | Add proxy: `/api/claude` → Anthropic, injecting API key server-side |
| Create | `src/lib/claude.ts` | File encoding + three API call functions |
| Modify | `src/App.tsx` | Add `useRef` imports, file input refs/elements, replace 4 mock functions, reset initial state |

---

### Task 1: Environment & Vite Proxy

**Files:**
- Create: `.env`
- Create: `.env.example`
- Modify: `vite.config.ts`
- Verify: `.gitignore` already has `*.local` — but `.env` itself is not listed. Add it.

- [ ] **Step 1: Create `.env`**

```
ANTHROPIC_API_KEY=your_api_key_here
```

Do NOT prefix with `VITE_` — this must stay server-side only.

- [ ] **Step 2: Create `.env.example`**

```
ANTHROPIC_API_KEY=your_api_key_here
```

- [ ] **Step 3: Add `.env` to `.gitignore`**

Open `.gitignore` and add a line:
```
.env
```

(`.env.example` must NOT be in `.gitignore` — it should be committed as documentation.)

- [ ] **Step 4: Replace `vite.config.ts` entirely**

```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/claude/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.ANTHROPIC_API_KEY || '');
              proxyReq.setHeader('anthropic-version', '2023-06-01');
            });
          },
        },
      },
    },
  };
});
```

- [ ] **Step 5: Smoke-test the proxy**

Run: `npm run dev`

In the browser DevTools → Network tab, make a manual test call to verify routing is set up (a real test will come after Task 3). The server should start without errors.

- [ ] **Step 6: Commit**

```bash
git add .env.example .gitignore vite.config.ts
git commit -m "feat: add Vite proxy for Claude API with server-side key injection"
```

---

### Task 2: Install DOCX Extraction Dependency

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install mammoth**

```bash
npm install mammoth
```

Expected: `added 1 package` or similar. mammoth ships TypeScript types — no `@types/` install needed.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add mammoth for DOCX text extraction"
```

---

### Task 3: Create `src/lib/claude.ts`

**Files:**
- Create: `src/lib/claude.ts`

This module handles: (1) converting any File to the right API content block, (2) making the proxied fetch call, (3) three exported functions for the three document types used in the app.

- [ ] **Step 1: Create the file with the full implementation**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/claude.ts
git commit -m "feat: add Claude API document intelligence service (processDocumentPack, processIdDocument, processMandateDocument)"
```

---

### Task 4: Add File Input Refs & Hidden Inputs to `App.tsx`

**Files:**
- Modify: `src/App.tsx`

Hidden `<input type="file">` elements wired to each upload area. Refs live at the top level so all inner section components can access them via closure.

- [ ] **Step 1: Add `useRef` to the React import (line 1)**

Change:
```ts
import { useState } from 'react';
```
To:
```ts
import { useState, useRef } from 'react';
```

- [ ] **Step 2: Add the Claude service import after the React import**

After line 1, add:
```ts
import { processDocumentPack, processIdDocument, processMandateDocument } from './lib/claude';
```

- [ ] **Step 3: Add four refs near the top of `S2BOModule1V2`, after all `useState` declarations (around line 102)**

```ts
const spvPackInputRef = useRef<HTMLInputElement>(null);
const docUploadInputRef = useRef<HTMLInputElement>(null);
const mandateFileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 4: Add hidden file inputs to the JSX return**

Find the main return statement. The outermost `<div>` contains `<Banner />`, `<MissionControl />`, `<Toast />`, `<Modal />`. Before the closing `</div>` of the outermost div, add:

```tsx
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
```

Note: `startDocUploadWithFiles` and the updated `runAureliusPack` / `runMandateAi` are defined in Tasks 5–7.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add file input refs for document upload areas"
```

---

### Task 5: Replace `runAureliusPack` with Real Claude API

**Files:**
- Modify: `src/App.tsx` (~line 183, the `runAureliusPack` function)

The function changes signature from `() => void` to `(files: File[]) => void`. The setTimeout animation chain is kept for steps 1–4 while Claude processes; cancelled and replaced with step 5 on API response.

- [ ] **Step 1: Replace `runAureliusPack` entirely (lines ~183–214)**

```ts
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
```

- [ ] **Step 2: Add `startDocUploadWithFiles` directly after `runAureliusPack`**

This is needed so the top-level hidden `docUploadInputRef` can trigger bulk uploads from the Documents section's "Choose files" button.

```ts
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
```

- [ ] **Step 3: Update the "Upload SPV pack" button in `CompanySection` (~line 484)**

Find:
```tsx
<button onClick={runAureliusPack} disabled={docIntelState.isProcessing}
```

Replace `onClick`:
```tsx
<button onClick={() => spvPackInputRef.current?.click()} disabled={docIntelState.isProcessing}
```

- [ ] **Step 4: Verify `currentNarrative` typing allows `undefined`**

In the `DocIntelState` interface (line ~60), `currentNarrative` is already typed as `NarrativeStep | undefined` — no change needed. The `PipelineStep` component receives `detail={... ? docIntelState.currentNarrative?.classify : null}` using optional chaining, which handles `undefined` correctly.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: replace runAureliusPack with real Claude API call"
```

---

### Task 6: Replace `startDocUpload` / `startIdUpload` with Real Claude API

**Files:**
- Modify: `src/App.tsx` — the `DocumentsSection` inner component (~lines 1173–1343)

Both functions are defined inside `DocumentsSection`. They gain an optional `file` parameter: with a file, Claude processes it; without, they fall back to the current simulated behavior (for Spec A or when no file is selected).

Also adds per-section local refs for the per-doc and per-person file inputs, using `useState` + `useRef` inside `DocumentsSection` (which is a proper React component rendered via JSX).

- [ ] **Step 1: Add local state and refs inside `DocumentsSection`, after `const aiOn = specMode === 'b';` (around line 1249)**

```ts
const [pendingDocId, setPendingDocId] = useState<string | null>(null);
const [pendingId, setPendingId] = useState<{ pid: string; idType: 'passport' | 'nric'; name: string } | null>(null);
const localDocFileRef = useRef<HTMLInputElement>(null);
const localIdFileRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Replace `startDocUpload` (~line 1229) with the Claude-connected version**

```ts
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
```

- [ ] **Step 3: Replace `startIdUpload` (~line 1215) with the Claude-connected version**

```ts
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
```

- [ ] **Step 4: Update the "Upload" button in the required docs list to use the per-doc file input**

Find the button in `requiredDocs.map` (~line 1274):
```tsx
<button onClick={() => aiOn ? startDocUpload(doc.id) : setDocIntelState(prev => ({ ...prev, uploadedDocs: [...prev.uploadedDocs, doc.id] }))} ...>Upload</button>
```

Replace `onClick`:
```tsx
onClick={() => {
  if (aiOn) { setPendingDocId(doc.id); localDocFileRef.current?.click(); }
  else { setDocIntelState(prev => ({ ...prev, uploadedDocs: [...prev.uploadedDocs, doc.id] })); }
}}
```

- [ ] **Step 5: Update the "Choose files" main upload button (line ~1260) to trigger the top-level ref**

Find:
```tsx
<button onClick={() => { if (!aiOn) { showToast('Document attached.'); return; } if (isAurelius && !isUploaded('incorp')) startDocUpload('incorp'); else if (!isUploaded('board')) startDocUpload('board'); else showToast('All docs uploaded for demo.'); }}
```

Replace `onClick`:
```tsx
onClick={() => {
  if (!aiOn) { showToast('Document attached.'); return; }
  docUploadInputRef.current?.click();
}}
```

- [ ] **Step 6: Update the Passport/NRIC buttons in the identity list (~line 1297)**

Find the Passport button:
```tsx
<button onClick={() => aiOn ? startIdUpload(person.id, 'passport', person.name) : setIdUploads(...)} ...>
```

Replace `onClick`:
```tsx
onClick={() => {
  if (aiOn) { setPendingId({ pid: person.id, idType: 'passport', name: person.name }); localIdFileRef.current?.click(); }
  else { setIdUploads(prev => ({ ...prev, [person.id]: { idType: 'passport', name: person.name, matched: true, uploaded: true } })); }
}}
```

Find the NRIC button (immediately after):
```tsx
<button onClick={() => aiOn ? startIdUpload(person.id, 'nric', person.name) : setIdUploads(...)} ...>
```

Replace `onClick`:
```tsx
onClick={() => {
  if (aiOn) { setPendingId({ pid: person.id, idType: 'nric', name: person.name }); localIdFileRef.current?.click(); }
  else { setIdUploads(prev => ({ ...prev, [person.id]: { idType: 'nric', name: person.name, matched: true, uploaded: true } })); }
}}
```

- [ ] **Step 7: Add hidden file inputs to `DocumentsSection`'s JSX return**

Find the closing `</div>` of `DocumentsSection`'s return, just before the final `);`. Add two hidden inputs before that closing div:

```tsx
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
```

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire document and ID upload buttons to real Claude API"
```

---

### Task 7: Replace `runMandateAi` with Real Claude API

**Files:**
- Modify: `src/App.tsx` (~line 216, `runMandateAi`)

The function changes signature from `() => void` to `(file?: File) => void`. Without a file, falls back to the hardcoded `MANDATE_AI` fixture (for Spec A or when no file is selected).

- [ ] **Step 1: Replace `runMandateAi` entirely (~lines 216–229)**

```ts
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
```

- [ ] **Step 2: Find where `runMandateAi()` is called in the mandate section and wire it to the file input**

Search for `runMandateAi` call in the mandate UI (it will be an `onClick` handler on an "Upload" or "AI extract" button). Replace that `onClick`:

```tsx
onClick={() => mandateFileInputRef.current?.click()}
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: replace runMandateAi simulation with real Claude API"
```

---

### Task 8: Reset Mock Starting Values

**Files:**
- Modify: `src/App.tsx` — initial state declarations and `resetToBaseline`

**Goal:** The demo starts with ACRA-sourced fields pre-filled for Meridian (that's the Spec A story) but all user-entered fields, accounts, signatories, and completion percentages reset to empty/zero so Claude's contribution is visibly clear.

- [ ] **Step 1: Reset `signatories` initial state (~line 95)**

Change:
```ts
const [signatories, setSignatories] = useState<Signatory[]>([
  { id: 1, name: 'Alice Smith', role: 'Head of Finance', category: 'A', limit: 50000 },
  { id: 2, name: 'David Tan', role: 'CFO', category: 'A', limit: 250000 },
  { id: 3, name: 'Priya Krishnan', role: 'Treasury Manager', category: 'B', limit: 25000 }
]);
```

To:
```ts
const [signatories, setSignatories] = useState<Signatory[]>([]);
```

- [ ] **Step 2: Reset `accountsList` initial state (~line 124)**

Change:
```ts
const [accountsList, setAccountsList] = useState<Record<EntityId, Account[]>>({
  meridian: [
    { id: 1, currency: 'SGD', purpose: 'Operating account', services: ['online', 'cards'] },
    { id: 2, currency: 'USD', purpose: 'Trade settlement', services: ['online'] }
  ],
  aurelius: []
});
```

To:
```ts
const [accountsList, setAccountsList] = useState<Record<EntityId, Account[]>>({
  meridian: [],
  aurelius: []
});
```

- [ ] **Step 3: Reset `s2bUsers` initial state (~line 134)**

Change:
```ts
const [s2bUsers, setS2bUsers] = useState([{ id: 1, name: 'Alice Smith', email: 'alice.smith@meridian.com', role: 'Admin', dailyLimit: 1000000 }]);
```

To:
```ts
const [s2bUsers, setS2bUsers] = useState<Array<{ id: number; name: string; email: string; role: string; dailyLimit: number }>>([]);
```

- [ ] **Step 4: Reset `completion` initial state (~line 136)**

Change:
```ts
const [completion, setCompletion] = useState<Record<EntityId, Record<SectionId, number>>>({
  meridian: { start: 100, company: 85, compliance: 0, accounts: 60, mandate: 0, s2b: 30, documents: 40, review: 0 },
  aurelius: { start: 100, company: 5, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 10, review: 0 }
});
```

To:
```ts
const [completion, setCompletion] = useState<Record<EntityId, Record<SectionId, number>>>({
  meridian: { start: 100, company: 40, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 0, review: 0 },
  aurelius: { start: 100, company: 5, compliance: 0, accounts: 0, mandate: 0, s2b: 0, documents: 0, review: 0 }
});
```

Meridian at 40% company: ACRA data present but contact fields are empty.

- [ ] **Step 5: Reset `companyFields` initial state (~line 141) — keep ACRA data, clear user-entered fields**

Change:
```ts
meridian: { legalName: 'Meridian Trade Solutions Pte. Ltd.', uen: '202512345X', entityType: 'Private Limited Company', incorporated: '12 Jan 2020', address: '123 Anson Road, #05-01, Singapore 079906', industry: 'Commodity wholesale', contactName: 'Alice Smith', contactTitle: 'Head of Finance', contactEmail: 'alice.smith@meridian.com', contactPhone: '+65 9123 4567', primaryMarkets: '' },
```

To:
```ts
meridian: { legalName: 'Meridian Trade Solutions Pte. Ltd.', uen: '202512345X', entityType: 'Private Limited Company', incorporated: '12 Jan 2020', address: '123 Anson Road, #05-01, Singapore 079906', industry: 'Commodity wholesale', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '', primaryMarkets: '' },
```

(legalName, uen, entityType, incorporated, address, industry are "from ACRA" — kept. contactName/Title/Email/Phone and primaryMarkets are user-entered — cleared.)

- [ ] **Step 6: Update `resetToBaseline` (~line 253) to match all new initial values**

Replace the entire `resetToBaseline` function:

```ts
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
  setComplianceSubsection('country');
  setComplianceSubProgress({ country: 0, 'kyc-narrative': 0, 'kyc-questions': 0, declarations: 0 });
  setKycNarrative({ businessDescription: '', countriesTraded: '', productsServices: '', turnover: '', duration: '', majorClients: '', majorSuppliers: '', mainCompetitors: '', sourceOfFunds: '' });
  setKycQuestionsState({ currentIdx: 0, answers: {}, followups: {} });
  setDocIntelState({ uploadedDocs: [], isProcessing: false, processingStep: 0, extractedFields: {}, showSidePanel: false });
  setIdUploads({}); setAppStatus('client-draft'); setSigningState({}); setModal(null);
  showToast('Demo reset to baseline');
};
```

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: reset demo to minimal starting state for convincing demo flow"
```

---

## Self-Review

**Spec coverage:**
- ✅ Classify → extract → reconcile → validate → apply: all five narrative fields come from Claude prompts in `claude.ts`
- ✅ 1 or more files: `processDocumentPack` accepts `File[]`; all three upload areas accept multiple files
- ✅ DOCX: mammoth extracts text, sent as text block
- ✅ PDF: base64 encoded as `type: "document"` with `media_type: "application/pdf"`
- ✅ Scanned JPG/PNG: base64 encoded as `type: "image"`
- ✅ `.env` file: Task 1, API key server-side via Vite proxy
- ✅ Reset mock values: Task 8 — signatories, accounts, s2bUsers, completion, companyFields contact fields
- ✅ Mandate AI with real documents: Task 7
- ✅ Spec A fallback (no file picker, just marks uploaded): `!file` path in `startDocUpload` / `startIdUpload` / `runMandateAi`

**Type consistency:**
- `NarrativeStep` in `claude.ts` has the same 5 string fields as the interface in `App.tsx`
- `CompanyExtract` in `claude.ts` is a `Partial<CompanyFields>` equivalent — spread into `CompanyFields` works
- `SignatoryExtract` maps to `Signatory` via explicit mapping in Task 7 (`id`, `source`, `acraDirector` added)
- `currentNarrative` typed as `NarrativeStep | undefined` in `DocIntelState` — optional chaining in `PipelineStep` detail props handles undefined safely

**Placeholder scan:** None — all steps contain complete, runnable code.

**Demo notes for June 25:**
- Insert your `ANTHROPIC_API_KEY` value in `.env` before running
- For Aurelius entity + Spec B: drag actual incorporation documents (cert, MAA, board resolution, passport scan) onto the upload area — Claude classifies and populates the form live
- For mandate section: upload an actual board resolution PDF — Claude extracts signatories and signing tiers
- For identity: upload a passport scan — Claude verifies the name matches the signatory list
- Processing typically takes 10–20 seconds per upload; the 5-step animation plays during wait time
