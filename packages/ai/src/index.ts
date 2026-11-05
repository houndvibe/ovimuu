// Public AI interface. Implementation (Yandex Cloud) arrives in stage 1, step 4.
// Result types are placeholders and will be replaced by zod-inferred types.

export interface UserContext {
  timezone: string;
}

export interface ActiveMedSummary {
  id: number;
  name: string;
  /** Short human-readable schedule, e.g. "daily after breakfast". */
  schedule: string;
}

export type ParseResult = unknown;
export type IntentResult = unknown;

export interface AiService {
  transcribe(audio: Buffer, mime: string): Promise<string>;
  ocr(image: Buffer): Promise<string>;
  parseMedications(text: string, ctx: UserContext): Promise<ParseResult>;
  routeIntent(text: string, meds: ActiveMedSummary[]): Promise<IntentResult>;
}
