import { describe, expect, it } from 'vite-plus/test';
import { groupConversations } from '@/lib/conversation-groups';
import type { Conversation } from '@/types';

// Local time, so the day boundaries match the viewer's calendar wherever the tests run.
const now = new Date(2026, 9, 24, 15, 30);
const at = (id: string, date: Date): Conversation => ({
    id,
    title: id,
    provider_connection_id: null,
    model_provider: null,
    model: null,
    created_at: date.toISOString(),
    updated_at: date.toISOString(),
});
const labels = (conversations: Conversation[]) =>
    groupConversations(conversations, now).map((group) => [
        group.label,
        group.conversations.map((conversation) => conversation.id),
    ]);

describe('groupConversations', () => {
    it('sorts conversations into Today, Yesterday, Previous 7 days and Older', () => {
        expect(
            labels([
                at('now', new Date(2026, 9, 24, 15, 0)),
                at('midnight', new Date(2026, 9, 24, 0, 0)),
                at('late-yesterday', new Date(2026, 9, 23, 23, 59)),
                at('early-yesterday', new Date(2026, 9, 23, 0, 0)),
                at('two-days', new Date(2026, 9, 22, 12, 0)),
                at('seven-days', new Date(2026, 9, 17, 0, 0)),
                at('eight-days', new Date(2026, 9, 16, 23, 59)),
                at('last-year', new Date(2025, 0, 1)),
            ]),
        ).toEqual([
            ['Today', ['now', 'midnight']],
            ['Yesterday', ['late-yesterday', 'early-yesterday']],
            ['Previous 7 days', ['two-days', 'seven-days']],
            ['Older', ['eight-days', 'last-year']],
        ]);
    });

    it('leaves out empty sections and keeps the given order inside one', () => {
        expect(
            labels([
                at('b', new Date(2026, 8, 2)),
                at('a', new Date(2026, 8, 30)),
            ]),
        ).toEqual([['Older', ['b', 'a']]]);
        expect(groupConversations([], now)).toEqual([]);
    });

    it('treats a future timestamp as today and an unreadable one as older', () => {
        expect(
            labels([
                at('future', new Date(2026, 9, 25, 9, 0)),
                {
                    ...at('broken', now),
                    updated_at: 'not a date',
                },
            ]),
        ).toEqual([
            ['Today', ['future']],
            ['Older', ['broken']],
        ]);
    });
});
