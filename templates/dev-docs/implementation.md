# [Feature Name] - Implementation Plan

**Status:** Planning → In Progress → Complete
**Started:** YYYY-MM-DD
**Target Completion:** YYYY-MM-DD
**Last Updated:** YYYY-MM-DD HH:MM

---

## Quality Bar

**Target quality:** Production-grade — this feature should feel intentional, polished, and robust. Every interaction should feel considered, not just functional. Aim for the kind of implementation that makes users trust the product more, not less.

- **UI:** Transitions are smooth, layouts are tight, states are handled (empty, loading, error, success)
- **Code:** Clear intent, minimal abstraction, handles edge cases at boundaries
- **Integration:** Seamless with existing features — no seams visible to users

---

## Executive Summary

[2-3 sentence overview of what we're building and why]

---

## User Personas Alignment

**Target Users:** [Which user types from `docs/user-personas.md`]
- [ ] **[Persona 1]** ([What this persona does])
- [ ] **[Persona 2]** ([What this persona does])
- [ ] **All Personas**

**User Subsets Served:**
- [ ] **Complex** - Need granular controls and advanced options
- [ ] **Simple** - Need guided workflows and sensible defaults
- [ ] **Hands-off** - Need automation and AI assistance
- [ ] **All Subsets**

**UX Approach:**
- [How this feature serves each relevant subset]
- [What controls/workflows are provided]
- [How automation/AI can assist]

---

## Goals

### Primary Goals
1. [Main objective - what must be achieved]
2. [Secondary objective]
3. [Tertiary objective]

### Success Criteria
- [ ] [Measurable criterion 1]
- [ ] [Measurable criterion 2]
- [ ] [Measurable criterion 3]

---

## Architecture Overview

[High-level architectural approach - components, services, data flow]

### Key Components
- **ComponentA** - Purpose and responsibility
- **ComponentB** - Purpose and responsibility
- **ServiceX** - What it provides

### Data Flow
[Brief description of how data flows through the system]

---

## Implementation Phases

Each phase is a slice: one narrow path that works end to end, with a demo line that a person can test. Section 11 of `.beast-mode/phase-handoff.md` holds the rules. A feature under about 8 tasks stays one phase.

### Phase 1: [Slice Name]
**Goal:** [The smallest path that proves the idea]
**Demo:** [One action and one result that a person can check, for example "the user opens the list and sees one row"]
**Needs:** none

**Tasks:**
- [ ] Task 1 - [Description]
- [ ] Task 2 - [Description]
- [ ] Task 3 - [Description]

**Estimated Steps:** X (about six steps for one task)

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

---

### Phase 2: [Slice Name]
**Goal:** [The next path in the order of value, or the validation and polish of an earlier path]
**Demo:** [One action and one result that a person can check]
**Needs:** Phase 1

**Tasks:**
- [ ] Task 1 - [Description]
- [ ] Task 2 - [Description]
- [ ] Task 3 - [Description]

**Estimated Steps:** X (about six steps for one task)

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

---

### Phase 3: [Base Phase Name] (Base)
**Goal:** [Work that cannot be a slice, for example a data migration or a pure refactor. Delete this phase when the plan has no base phase]
**Demo:** none (base phase: [the reason that this phase cannot be a slice])
**Needs:** Phase 1

**Tasks:**
- [ ] Task 1 - [Description]
- [ ] Task 2 - [Description]
- [ ] Task 3 - [Description]

**Estimated Steps:** X (about six steps for one task)

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

---

## Key Technical Decisions

### Decision 1: [Decision Title]
**Context:** [Why this decision was needed]
**Decision:** [What was decided]
**Rationale:** [Why this approach]
**Alternatives Considered:** [What else was considered and why not chosen]

### Decision 2: [Decision Title]
**Context:** [Why this decision was needed]
**Decision:** [What was decided]
**Rationale:** [Why this approach]
**Alternatives Considered:** [What else was considered and why not chosen]

---

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [Risk description] | Low/Medium/High | Low/Medium/High | [How to mitigate] |
| [Risk description] | Low/Medium/High | Low/Medium/High | [How to mitigate] |

---

## Dependencies

### Internal Dependencies
- [Feature/Module that must exist first]
- [Service that must be available]

### External Dependencies
- [npm packages needed]
- [APIs or services needed]

---

## Definition of Done

These are the feature-level acceptance criteria that must ALL pass for this feature to be considered complete. They should be concrete, testable, and verifiable by an independent evaluator.

### Functional Criteria
- [ ] [User-facing behavior 1 — describe what the user does and what should happen]
- [ ] [User-facing behavior 2]
- [ ] [User-facing behavior 3]

### Quality Criteria
- [ ] No regressions in existing functionality
- [ ] Error states are handled gracefully with clear user feedback
- [ ] Loading states provide appropriate feedback
- [ ] [Feature-specific quality criterion]

### Integration Criteria
- [ ] [How this feature integrates with existing system X]
- [ ] [Data flows correctly between components]

### Verification Method
**How to verify:** [Describe how an evaluator should test — manual interaction steps, API calls to make, or automated test commands to run]

---

## Testing Strategy

### Unit Tests
- [What needs unit testing]
- [Testing approach]

### Integration Tests
- [What needs integration testing]
- [Testing approach]

### Manual Testing
- [What requires manual testing]
- [Testing checklist]

---

## Related Documentation

- **User Personas:** `docs/user-personas.md` (stakeholder-approved user types)
- **Original Implementation:** `docs/features/[feature-name]/implementation.md`
- **API Docs:** [Link if applicable]

---

## Notes

[Any additional notes, considerations, or reminders]

---

*This plan will be updated as implementation progresses. See context.md and tasks.md for current status.*
