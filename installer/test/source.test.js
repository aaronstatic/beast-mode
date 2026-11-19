// installer/test/source.test.js
//
// Covers the seventeen-term constant against the contract, the real repo source,
// the glossary validator (a good fixture and five bad fixtures), the skill
// validator, and the frontmatter split/join round trip.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CANONICAL_TERMS,
  findPluginRoot,
  readSource,
  validateGlossary,
  validateSkill,
} from '../lib/source.js';
import { SourceInvalidError } from '../lib/errors.js';
import { split, join } from '../lib/frontmatter.js';
import {
  FOOTPRINT,
  createFixturePluginRoot,
  goodGlossaryText,
  removeFixture,
} from './helpers.js';

const PLUGIN_ROOT = findPluginRoot(import.meta.dirname);

test('CANONICAL_TERMS matches contract section 6.1', () => {
  const contractPath = path.join(PLUGIN_ROOT, 'docs', 'harness-neutral-source.md');
  const text = fs.readFileSync(contractPath, 'utf8');

  const sectionStart = text.indexOf('### 6.1 The seventeen terms');
  const sectionEnd = text.indexOf('### 6.2', sectionStart);
  assert.ok(sectionStart !== -1, 'section 6.1 heading not found in the contract');
  assert.ok(sectionEnd !== -1, 'section 6.2 heading not found in the contract');
  const section = text.slice(sectionStart, sectionEnd);

  const terms = [...section.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1]);

  assert.deepEqual(terms, CANONICAL_TERMS);
});

test('the real plugin source is valid and yields the documented counts', () => {
  const source = readSource({
    pluginRoot: PLUGIN_ROOT,
    harnessId: 'claude',
    glossaryHarnessId: 'claude-code',
  });

  const skillNames = new Set();
  const counts = { agent: 0, 'dev-doc': 0, format: 0, glossary: 0 };
  for (const entry of source.entries) {
    if (entry.kind === 'skill') {
      skillNames.add(entry.name);
    } else {
      counts[entry.kind] += 1;
    }
  }

  assert.equal(skillNames.size, FOOTPRINT.skills);
  assert.equal(counts.agent, 2);
  assert.equal(counts['dev-doc'], 7);
  assert.equal(counts.format, 8);
  assert.equal(counts.glossary, 1);
  assert.equal(typeof source.version, 'string');
  assert.ok(source.version.length > 0);
});

test('a good fixture glossary passes validation', () => {
  assert.doesNotThrow(() => {
    validateGlossary(goodGlossaryText('claude-code'), 'templates/harness/claude.md', 'claude-code');
  });
});

test('a glossary with no H1 title fails with exit code 1', () => {
  const text = goodGlossaryText('claude-code').replace(/^# Harness Glossary - Fixture\n/, '');
  assert.throws(
    () => validateGlossary(text, 'fixture.md', 'claude-code'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 1/);
      return true;
    }
  );
});

test('a glossary with a non-kebab-case Harness value fails with exit code 1', () => {
  const text = goodGlossaryText('claude-code').replace(
    '**Harness:** claude-code',
    '**Harness:** Claude_Code'
  );
  assert.throws(
    () => validateGlossary(text, 'fixture.md', 'claude-code'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 2/);
      assert.match(err.causeText, /kebab-case/);
      return true;
    }
  );
});

test('a glossary whose Harness value does not equal the adapter id fails with exit code 1', () => {
  const text = goodGlossaryText('other-harness');
  assert.throws(
    () => validateGlossary(text, 'fixture.md', 'claude-code'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 2/);
      assert.match(err.causeText, /does not equal the adapter id/);
      return true;
    }
  );
});

test('a glossary with one missing term fails with exit code 1 and names the term', () => {
  const missingTerm = CANONICAL_TERMS[4];
  const rows = CANONICAL_TERMS.filter((t) => t !== missingTerm)
    .map((term) => `| ${term} | Do the fixture thing. |`)
    .join('\n');
  const text = `# Harness Glossary - Fixture

**Harness:** claude-code
**Targets:** Fixture harness 1.0 and later

## Term map

| Neutral term | This harness |
| --- | --- |
${rows}

## Notes

- A fixture note.
`;

  assert.throws(
    () => validateGlossary(text, 'fixture.md', 'claude-code'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 4/);
      assert.ok(err.causeText.includes(missingTerm), 'the error names the missing term');
      return true;
    }
  );
});

test('a glossary with no Notes heading fails with exit code 1', () => {
  const text = goodGlossaryText('claude-code').replace(/## Notes\n\n- A fixture note\.\n/, '');
  assert.throws(
    () => validateGlossary(text, 'fixture.md', 'claude-code'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 5/);
      return true;
    }
  );
});

test('a skill whose name does not equal its folder fails validation', () => {
  const text = `---
name: wrong-name
description: "A fixture skill. Usage: /wrong-name"
user-invocable: true
---

Body.
`;
  assert.throws(
    () => validateSkill(text, 'templates/skills/right-name/SKILL.md', 'right-name'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 2/);
      return true;
    }
  );
});

test('a skill with no user-invocable fails validation', () => {
  const text = `---
name: fixture-skill
description: "A fixture skill. Usage: /fixture-skill"
---

Body.
`;
  assert.throws(
    () => validateSkill(text, 'templates/skills/fixture-skill/SKILL.md', 'fixture-skill'),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      assert.match(err.causeText, /Rule 4/);
      return true;
    }
  );
});

test('readSource on a fixture plugin root finds every source directory', () => {
  const root = createFixturePluginRoot();
  try {
    const source = readSource({
      pluginRoot: root,
      harnessId: 'claude',
      glossaryHarnessId: 'claude-code',
    });
    const skillNames = new Set(source.entries.filter((e) => e.kind === 'skill').map((e) => e.name));
    assert.equal(skillNames.size, 1);
    assert.equal(source.entries.filter((e) => e.kind === 'agent').length, 1);
    assert.equal(source.entries.filter((e) => e.kind === 'dev-doc').length, 1);
    assert.equal(source.entries.filter((e) => e.kind === 'format').length, 1);
    assert.equal(source.entries.filter((e) => e.kind === 'glossary').length, 1);
    assert.equal(source.version, '5.1.0-fixture');
  } finally {
    removeFixture(root);
  }
});

test('frontmatter split handles a description with a colon and strips quotes', () => {
  const text = `---
name: plan-feature
description: "Plan a new feature. Usage: /plan-feature <feature-name>"
user-invocable: true
---

Body text.
`;
  const parsed = split(text);
  assert.ok(parsed);
  assert.equal(parsed.data.name, 'plan-feature');
  assert.equal(parsed.data.description, 'Plan a new feature. Usage: /plan-feature <feature-name>');
  assert.equal(parsed.data['user-invocable'], 'true');
  assert.equal(parsed.body, '\nBody text.\n');
});

test('frontmatter round-trips a description with a colon through join', () => {
  const text = `---
name: plan-feature
description: "Plan a new feature. Usage: /plan-feature <feature-name>"
user-invocable: true
---

Body text.
`;
  const parsed = split(text);
  const rejoined = join(parsed.data, parsed.body);
  const reparsed = split(rejoined);

  assert.ok(reparsed);
  assert.deepEqual(reparsed.data, parsed.data);
  assert.equal(reparsed.body, parsed.body);
});

test('frontmatter split rejects a block scalar value', () => {
  const text = `---
name: fixture
description: |
  A block scalar value.
---

Body.
`;
  assert.throws(
    () => split(text),
    (err) => {
      assert.ok(err instanceof SourceInvalidError);
      assert.equal(err.exitCode, 1);
      return true;
    }
  );
});
