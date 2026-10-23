// Composer rules kept free of React so they can be unit tested.

/** Matches StoreMessageRequest's max:12000, which counts characters (code points). */
export const MAX_MESSAGE_LENGTH = 12_000;

/** Matches SaveConversationRequest's max:200. */
export const MAX_TITLE_LENGTH = 200;

export type ComposerKeyEvent = Pick<
    KeyboardEvent,
    'key' | 'shiftKey' | 'isComposing' | 'keyCode'
>;

/**
 * Enter sends and Shift+Enter inserts a line. Nothing sends while an input method
 * composition is active: browsers report it through `isComposing`, our composition
 * listeners, or keyCode 229 (Safari's Enter that confirms a composition arrives after
 * `compositionend` with `isComposing` false).
 */
export function shouldSendOnKeyDown(
    event: ComposerKeyEvent,
    composing: boolean,
): boolean {
    if (event.key !== 'Enter' || event.shiftKey) {
        return false;
    }

    return !(composing || event.isComposing || event.keyCode === 229);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Counts Unicode code points, as PHP's mb_strlen does for the server's max rules,
 * so a single emoji counts once rather than as two UTF-16 units.
 */
export function characterCount(text: string): number {
    return Array.from(text).length;
}

export function canSend(text: string): boolean {
    return text.trim() !== '' && characterCount(text) <= MAX_MESSAGE_LENGTH;
}

/**
 * Derives a conversation title from the first line of its first message. Long titles are
 * shortened on grapheme boundaries, so an emoji is never cut in half, and stay within
 * `maxLength` code points.
 */
export function titleFromMessage(content: string, maxLength = 60): string {
    const firstLine = content.trim().split('\n')[0] ?? '';
    const title = firstLine.replace(/\s+/g, ' ').trim();

    if (characterCount(title) <= maxLength) {
        return title;
    }

    let shortened = '';

    for (const { segment } of graphemes.segment(title)) {
        if (characterCount(shortened + segment) > maxLength - 1) {
            break;
        }

        shortened += segment;
    }

    return `${shortened.trimEnd()}…`;
}
