import type { Conversation } from '@/types';

export type ConversationGroup = {
    label: string;
    conversations: Conversation[];
};

/**
 * Sidebar sections by last activity, in the viewer's local calendar: Today, Yesterday, Previous
 * 7 days and Older. Conversations keep their given order inside a section; empty sections are left
 * out. A timestamp in the future (clock skew) counts as today.
 */
export function groupConversations(
    conversations: Conversation[],
    now: Date = new Date(),
): ConversationGroup[] {
    const dayStart = (daysAgo: number): number =>
        new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - daysAgo,
        ).getTime();
    const older = {
        label: 'Older',
        from: -Infinity,
        conversations: [] as Conversation[],
    };
    const groups = [
        {
            label: 'Today',
            from: dayStart(0),
            conversations: [] as Conversation[],
        },
        {
            label: 'Yesterday',
            from: dayStart(1),
            conversations: [] as Conversation[],
        },
        {
            label: 'Previous 7 days',
            from: dayStart(7),
            conversations: [] as Conversation[],
        },
        older,
    ];

    for (const conversation of conversations) {
        // An unreadable timestamp parses as NaN, which matches no section but Older.
        const time = Date.parse(conversation.updated_at);
        const group =
            groups.find((candidate) => time >= candidate.from) ?? older;
        group.conversations.push(conversation);
    }

    return groups
        .filter((group) => group.conversations.length > 0)
        .map(({ label, conversations: members }) => ({
            label,
            conversations: members,
        }));
}
