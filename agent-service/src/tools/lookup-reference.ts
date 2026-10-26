import { Type } from 'typebox';
import { REFERENCE_ENTRIES, type ReferenceEntry } from './reference-fixture.js';
import type { ToolDefinition } from './registry.js';

const MAX_MATCHES = 3;
/** Words too common to tell entries apart. */
const IGNORED_WORDS = new Set(['the', 'and', 'for', 'what', 'which', 'with', 'are', 'our', 'how', 'when', 'where', 'who', 'about']);

const parameters = Type.Object(
    {
        query: Type.String({
            minLength: 1,
            maxLength: 200,
            description: 'A reference code such as SAMPLE-001, or a few keywords such as "warehouse deliveries".',
        }),
    },
    { additionalProperties: false },
);

/** Read-only lookup in the invented reference records (offices, policies and facilities). */
export const lookupReference: ToolDefinition<typeof parameters> = {
    name: 'lookup_reference',
    label: 'Look up a reference',
    description:
        "Looks up the organisation's reference records (offices, policies and facilities) by code or keywords and returns up to three matching entries with their codes. Use it whenever a question concerns these records instead of guessing; if nothing matches, say so.",
    parameters,
    capability: 'lookup_reference',
    effect: 'read',
    timeoutMs: 10_000,
    maxResultLength: 4_000,
    async run({ query }, signal) {
        signal.throwIfAborted();
        const matches = search(query);
        if (matches.length === 0) {
            return { text: `No reference entry matches "${query}".`, sources: [] };
        }

        return {
            text: matches.map((entry) => `[${entry.code}] ${entry.title} (evidence ${entry.id}, checked ${entry.checkedAt})\n${entry.text}`).join('\n\n'),
            sources: matches.map((entry) => ({ evidenceId: entry.id, title: entry.title, locator: entry.locator, checkedAt: entry.checkedAt })),
        };
    },
};

/** A code anywhere in the query wins; otherwise entries are ranked by how many query words they contain. */
function search(query: string): ReferenceEntry[] {
    const normalized = query.toLowerCase();
    const words = normalized.split(/[^a-z0-9-]+/).filter((word) => word.length >= 3 && !IGNORED_WORDS.has(word));

    return REFERENCE_ENTRIES.map((entry) => {
        if (normalized.includes(entry.code.toLowerCase())) {
            return { entry, score: Number.MAX_SAFE_INTEGER };
        }
        const haystack = [entry.title, entry.text, ...entry.keywords].join(' ').toLowerCase();

        return { entry, score: words.filter((word) => haystack.includes(word)).length };
    })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MATCHES)
        .map(({ entry }) => entry);
}
