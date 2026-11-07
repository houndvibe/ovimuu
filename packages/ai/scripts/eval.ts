// Live evaluation against Yandex Cloud. Costs money; not part of `pnpm test`.
// Usage: pnpm --filter @ovimuu/ai eval [parse|intent] [--parse-model=...] [--intent-model=...]
import { diffParseResult, diffPartial } from '../fixtures/compare.ts';
import { intentFixtures, intentMeds, intentToday } from '../fixtures/intent.ts';
import { fixtureToday, parseFixtures } from '../fixtures/parse.ts';
import { AiError, createAi, DEFAULT_MODELS } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const only = args.find((a) => !a.startsWith('--'));

const { YC_FOLDER_ID, YC_API_KEY } = process.env;
if (!YC_FOLDER_ID || !YC_API_KEY) {
  console.error('YC_FOLDER_ID and YC_API_KEY are required (root .env).');
  process.exit(1);
}

const models = {
  parse: flag('parse-model') ?? process.env.YC_MODEL_PARSE ?? DEFAULT_MODELS.parse,
  intent: flag('intent-model') ?? process.env.YC_MODEL_INTENT ?? DEFAULT_MODELS.intent,
};
const ai = createAi({ folderId: YC_FOLDER_ID, apiKey: YC_API_KEY, models });

let passed = 0;
let failed = 0;

function report(id: string, ms: number, diffs: string[]) {
  if (diffs.length === 0) {
    passed++;
    console.log(`  ✓ ${id} (${ms} ms)`);
  } else {
    failed++;
    console.log(`  ✗ ${id} (${ms} ms)`);
    for (const d of diffs) console.log(`      ${d}`);
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<[T | AiError, number]> {
  const start = Date.now();
  try {
    return [await fn(), Date.now() - start];
  } catch (e) {
    if (e instanceof AiError) return [e, Date.now() - start];
    throw e;
  }
}

if (!only || only === 'parse') {
  console.log(`\nparseMedications · ${models.parse}`);
  for (const f of parseFixtures) {
    const [result, ms] = await timed(() =>
      ai.parseMedications(f.input, { today: fixtureToday, ...f.ctx }),
    );
    if (result instanceof AiError) report(f.id, ms, [`AiError: ${result.code}`]);
    else report(f.id, ms, diffParseResult(f.expected, result, f.compare));
  }
}

if (!only || only === 'intent') {
  console.log(`\nrouteIntent · ${models.intent}`);
  for (const f of intentFixtures) {
    const [result, ms] = await timed(() => ai.routeIntent(f.input, intentMeds, intentToday));
    if (result instanceof AiError) report(f.id, ms, [`AiError: ${result.code}`]);
    else report(f.id, ms, diffPartial(f.expected, result));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
