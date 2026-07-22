/**
 * Quick smoke-test for resolveCompanyDomain.
 * Run: bun run scripts/test-domain-resolver.ts
 */
import { resolveCompanyDomain } from "../lib/domain/resolveCompanyDomain";

const TEST_CASES: Array<{
  name: string;
  websiteHint?: string;
  expected: string;
  note: string;
}> = [
  // Fast-path: valid hint → should return immediately, no API calls
  {
    name: "Cursor",
    websiteHint: "cursor.com",
    expected: "cursor.com",
    note: "fast-path: hint is already a valid domain",
  },
  // Easy: well-known company, name matches domain cleanly
  {
    name: "Meshy",
    expected: "meshy.ai",
    note: "easy: name matches domain",
  },
  // Slash name WITH hint — mirrors real import behaviour (Clay always provides the domain)
  {
    name: "Sunday Robotics/Lemi Bot",
    websiteHint: "lemi.bot",
    expected: "lemi.bot",
    note: "fast-path: Clay provides domain, slash name never reaches search",
  },
  // Hard: company name gives no domain clue — 'Black Forest Labs' → bfl.ai
  {
    name: "Black Forest Labs",
    expected: "bfl.ai",
    note: "hard: abbreviation domain, name gives no obvious hint",
  },
  // Hard: name bears no resemblance to domain — 'Frontier Design' → imaginefrontier.com
  {
    name: "Frontier Design",
    expected: "imaginefrontier.com",
    note: "hard: domain bears no resemblance to name",
  },
  // Hard: rebranded company — 'AAI Technologies' → doubleai.com
  {
    name: "AAI Technologies",
    expected: "doubleai.com",
    note: "hard: company operates under different brand, LLM picks correctly from candidates",
  },
  // Slash name with hint — fast-path should win regardless
  {
    name: "Kasikorn Bank/Kasikorn X",
    websiteHint: "kx.tech",
    expected: "kx.tech",
    note: "fast-path: hint wins even with ambiguous slash name",
  },
];

async function run() {
  console.log("Testing resolveCompanyDomain\n");

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    const start = Date.now();
    try {
      const result = await resolveCompanyDomain({
        name: tc.name,
        websiteHint: tc.websiteHint,
        debug: true,
      });
      const ms = Date.now() - start;
      const ok = result === tc.expected;
      const icon = ok ? "✅" : "❌";

      console.log(`${icon} ${tc.name}`);
      console.log(`   note:     ${tc.note}`);
      console.log(`   expected: ${tc.expected}`);
      console.log(`   got:      ${result ?? "(null)"}`);
      console.log(`   time:     ${ms}ms`);
      console.log();

      if (ok) passed++;
      else failed++;
    } catch (err) {
      console.log(`💥 ${tc.name}`);
      console.log(`   error: ${err}`);
      console.log();
      failed++;
    }
  }

  console.log(`─────────────────────────`);
  console.log(`${passed}/${TEST_CASES.length} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
