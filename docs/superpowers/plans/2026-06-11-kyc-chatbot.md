# KYC Chatbot Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating KYC/onboarding specialist chatbot that opens a slide-in panel from the right — pushing content on desktop, overlaying on mobile.

**Architecture:** A floating `MessageCircle` button lives at `fixed bottom-6 right-6`. Clicking it opens a chat panel that on `lg:` screens (1024px+) renders as a 3rd sibling inside the existing flex layout row (naturally pushing content left), and on smaller screens renders as a `fixed` overlay. Both containers share the same `ChatContent` component and the same chat state in `App.tsx`. The Claude API call goes through the existing `/api/claude` Vite proxy using the same key — a new `sendChatMessage` function in `src/lib/claude.ts` handles multi-turn message history.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, existing `/api/claude` Vite proxy, `claude-sonnet-4-6`, Lucide React (`MessageCircle` added)

---

## File Map

| File | Change |
|---|---|
| `src/lib/claude.ts` | Add `ChatMessage`, `ChatContext` interfaces and `sendChatMessage()` |
| `src/App.tsx` | Add chat state, `ChatContent` component, two panel containers (desktop + mobile), floating button, backdrop |

---

### Task 1: Chat service function

**Files:**
- Modify: `src/lib/claude.ts` — append after the last export

- [ ] **Step 1: Add interfaces and `sendChatMessage` at the bottom of `src/lib/claude.ts`**

```typescript
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
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit
```
Expected: no errors related to `src/lib/claude.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/claude.ts
git commit -m "feat: add sendChatMessage for multi-turn KYC chatbot"
```

---

### Task 2: Chat state, `ChatContent` component, and floating button

**Files:**
- Modify: `src/App.tsx`

This task adds everything needed for the chat UI except the layout containers (those come in Task 3). After this task, the floating button will be visible and clicking it will toggle the `chatOpen` state (the panel containers just won't be wired yet).

- [ ] **Step 1: Add `MessageCircle` and `useEffect` to the imports at line 1 and 4**

Find line 1:
```typescript
import { useState, useRef } from 'react';
```
Replace with:
```typescript
import { useState, useRef, useEffect } from 'react';
```

Find line 2 (the claude imports line):
```typescript
import { processDocumentPack, processIdDocument, processMandateDocument } from './lib/claude';
```
Replace with:
```typescript
import { processDocumentPack, processIdDocument, processMandateDocument, sendChatMessage, type ChatMessage, type ChatContext } from './lib/claude';
```

Find line 4 (lucide imports):
```typescript
import { Check, ChevronRight, ChevronLeft, FileText, Save, Eye, Users, User, UserCheck, Mail, Building2, MapPin, Phone, Briefcase, X, Upload, AlertCircle, Sparkles, Plus, Trash2, CreditCard, Shield, Edit3, Send, RotateCcw, BadgeCheck } from 'lucide-react';
```
Replace with:
```typescript
import { Check, ChevronRight, ChevronLeft, FileText, Save, Eye, Users, User, UserCheck, Mail, Building2, MapPin, Phone, Briefcase, X, Upload, AlertCircle, Sparkles, Plus, Trash2, CreditCard, Shield, Edit3, Send, RotateCcw, BadgeCheck, MessageCircle, Bot } from 'lucide-react';
```

- [ ] **Step 2: Add chat state variables**

In `S2BOModule1V2`, immediately after the existing `useState` declarations (look for the block starting around line 100 where all the `const [...]` declarations are), add these four new state variables. A safe anchor: find the line `const [modal, setModal] = useState...` and add after it:

```typescript
const [chatOpen, setChatOpen] = useState(false);
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [chatInput, setChatInput] = useState('');
const [chatLoading, setChatLoading] = useState(false);
```

- [ ] **Step 3: Add the `ChatContent` component**

This component is defined as an inner function, exactly like the existing section components (`StartSection`, `CompanySection`, etc.). Add it just before the `renderSection` function (which is around line 1613):

```typescript
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
      {/* Header */}
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

      {/* Messages */}
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

      {/* Input */}
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
```

- [ ] **Step 4: Verify the file compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add ChatContent component and chat state for KYC chatbot"
```

---

### Task 3: Layout wiring — desktop push + mobile overlay + floating button

**Files:**
- Modify: `src/App.tsx` — the JSX `return` block starting at line ~1625

This task wires up the two panel containers and the floating button into the existing layout. After this task, the chatbot is fully functional.

- [ ] **Step 1: Add the desktop panel, mobile overlay, backdrop, and floating button to the JSX return**

Find the existing return block:
```tsx
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
```

Replace with:
```tsx
  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <style>{`@keyframes fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } .animate-fadein { animation: fadein 0.2s ease-out; } @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} } .animate-bounce { animation: bounce 1.2s infinite ease-in-out; }`}</style>
      <Banner />
      <div className="flex">
        <JourneyMap />
        <div className="flex-1 min-w-0">
          <MissionControl />
          {renderSection()}
        </div>

        {/* Desktop chat panel — 3rd sibling, pushes content left on lg+ */}
        <div className={`hidden lg:flex flex-col bg-white border-l border-slate-200 flex-shrink-0 overflow-hidden transition-all duration-300 ease-out ${chatOpen ? 'w-96' : 'w-0'}`}>
          {chatOpen && <ChatContent />}
        </div>
      </div>

      {/* Mobile chat panel — fixed overlay on <lg */}
      <div className={`lg:hidden fixed right-0 top-0 bottom-0 z-40 w-80 bg-white border-l border-slate-200 shadow-2xl transform transition-transform duration-300 ease-out ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <ChatContent />
      </div>

      {/* Mobile backdrop */}
      {chatOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-slate-900/30 animate-fadein"
          onClick={() => setChatOpen(false)}
        />
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => setChatOpen(prev => !prev)}
        className={`fixed bottom-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${chatOpen ? 'bg-slate-700 hover:bg-slate-800 right-6' : 'bg-blue-600 hover:bg-blue-700 right-6'}`}
        aria-label={chatOpen ? 'Close chat' : 'Open KYC assistant'}
      >
        {chatOpen ? <X size={22} className="text-white" /> : <MessageCircle size={22} className="text-white" />}
      </button>

      <Toast />
      <Modal />
```

- [ ] **Step 2: Verify the file compiles with no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: zero errors

- [ ] **Step 3: Start the dev server and manually verify**

```bash
npm run dev
```

Open http://localhost:5173 and confirm:

**Floating button:**
- Blue `MessageCircle` button appears at bottom-right
- Clicking it opens the chat panel
- Button icon changes to `X` when panel is open
- Clicking again closes it

**Desktop (resize browser to ≥1024px):**
- Chat panel slides in from the right, content area visibly narrows
- Panel has blue header "KYC Assistant", 4 starter question chips, message input
- Closing panel returns the content area to full width

**Mobile (resize browser to <1024px):**
- Chat panel slides in as an overlay (does not push content)
- Dark semi-transparent backdrop appears behind the panel
- Clicking backdrop closes the panel

**Chat functionality:**
- Type a question and press Enter or click Send
- A typing indicator (3 bouncing dots) appears while awaiting response
- Claude responds as the KYC specialist
- Multi-turn conversation works (sends full history each time)
- "Clear conversation" link resets to welcome state
- Starter question chips pre-fill the input

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add KYC chatbot widget with desktop push and mobile overlay layout"
```

---

## Self-Review

**Spec coverage:**
- ✅ Floating icon in bottom right → `fixed bottom-6 right-6` button with `MessageCircle`
- ✅ Click launches chat window from the right → panel slides in via CSS transition
- ✅ Large screen pushes content → 3rd sibling in flex row, `w-96` when open
- ✅ Small screen floats on top → `fixed` overlay with backdrop
- ✅ KYC/onboarding/client management specialist → system prompt covers all listed domains
- ✅ Same API key → uses existing `/api/claude` Vite proxy, same `vite.config.ts`

**Placeholder scan:** None found. All code is complete.

**Type consistency:**
- `ChatMessage` defined in Task 1 → used in Task 2 state and `handleSend` ✅
- `ChatContext` defined in Task 1 → constructed in Task 2 `handleSend` with `entity`, `ent.name`, `section`, `companyFields[entity].legalName` ✅
- `sendChatMessage` exported in Task 1 → imported and called in Task 2 ✅
- `chatOpen`, `setChatOpen`, `chatMessages`, `setChatMessages`, `chatInput`, `setChatInput`, `chatLoading`, `setChatLoading` all defined in Task 2, consumed in `ChatContent` via closure ✅
- `ChatContent` defined in Task 2, rendered in Task 3 desktop and mobile containers ✅
