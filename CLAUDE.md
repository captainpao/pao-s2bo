# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file React/TypeScript prototype (`app.tsx`) for a bank onboarding workflow — **S2BO Module 1 V2** (Straight2Bank Onboarding). It is a self-contained interactive demo, not a production app. There is no build system, package.json, or test suite in this repo; the file is intended to be dropped into a sandbox environment (e.g. CodeSandbox, StackBlitz, or an internal prototype runner) that provides React, Tailwind CSS, and Lucide React.

## Architecture

Everything lives in the single default export `S2BOModule1V2`. All state is managed with `useState` at the top level and passed down via closures — there is no context, no reducer, no external state library.

**Section routing** is driven by a `section` string state (`'start' | 'company' | 'compliance' | 'accounts' | 'mandate' | 's2b' | 'documents' | 'review'`). `renderSection()` at line 1402 switches on this value to render the active panel.

**Entity switching** (`entity`: `'meridian' | 'aurelius'`) drives two parallel data scenarios:
- `meridian` — established company with ACRA registry pre-fill
- `aurelius` — newly incorporated SPV with no registry data, requiring document upload

**Spec mode toggle** (`specMode`: `'a' | 'b'`) switches between two UX paradigms:
- Spec A (Foundation) — structured form entry, registry-assisted
- Spec B (AI-embedded) — document upload triggers a simulated AI pipeline that classifies, extracts, reconciles, and populates fields

**Compliance sub-routing** uses a separate `complianceSubsection` state (`'country' | 'kyc-narrative' | 'kyc-questions' | 'declarations'`) to navigate within the Compliance section.

## Key patterns

- **Section components** are defined as inner functions (`StartSection`, `CompanySection`, `ComplianceSection`, etc.) that close over the top-level state. They render as JSX directly.
- **Completion tracking** is an object `{ meridian: { start, company, compliance, ... }, aurelius: {...} }` — call `advanceCompletion(sectionId, value)` to update.
- **AI pipeline simulation** uses chained `setTimeout` calls to step through `processingStep` (1–5) and trigger state updates. See `runAureliusPack()` and `runMandateAi()`.
- **`SpecBadge` / `SpecBOutline`** are highlight wrappers that only render when `showWhatChanged` is true, used to annotate what changed between Spec A and Spec B.
- **`showToast(message)`** — standard way to surface user feedback; auto-dismisses after 3 s.
- **`setModal({ title, body, footer })`** — renders the global modal overlay.
- **`resetToBaseline()`** resets all state back to demo starting values.

## Styling

Tailwind utility classes throughout. One custom animation (`animate-fadein`) is injected via a `<style>` tag inside the render output (line 1416).

## Demo entities and data

Fixture data is embedded directly in state initialisers and in `MANDATE_AI` / `entityData` constants. There is no API or network layer.
