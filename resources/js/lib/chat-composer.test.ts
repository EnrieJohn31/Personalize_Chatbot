import { describe, expect, test } from 'vite-plus/test';
import type { ComposerKeyEvent } from '@/lib/chat-composer';
import {
    MAX_MESSAGE_LENGTH,
    canSend,
    characterCount,
    shouldSendOnKeyDown,
    titleFromMessage,
} from '@/lib/chat-composer';

const key = (overrides: Partial<ComposerKeyEvent> = {}): ComposerKeyEvent => ({
    key: 'Enter',
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
});

describe('shouldSendOnKeyDown', () => {
    test('Enter sends', () => {
        expect(shouldSendOnKeyDown(key(), false)).toBe(true);
    });

    test('Shift+Enter inserts a line instead of sending', () => {
        expect(shouldSendOnKeyDown(key({ shiftKey: true }), false)).toBe(false);
    });

    test('other keys never send', () => {
        expect(shouldSendOnKeyDown(key({ key: 'a', keyCode: 65 }), false)).toBe(
            false,
        );
    });

    test('Enter during an IME composition confirms it instead of sending', () => {
        expect(shouldSendOnKeyDown(key({ isComposing: true }), false)).toBe(
            false,
        );
        expect(shouldSendOnKeyDown(key(), true)).toBe(false);
    });

    test("Safari's composition-confirming Enter (keyCode 229) does not send", () => {
        expect(shouldSendOnKeyDown(key({ keyCode: 229 }), false)).toBe(false);
    });
});

describe('message limits', () => {
    test('blank or whitespace-only drafts cannot be sent', () => {
        expect(canSend('')).toBe(false);
        expect(canSend(' \n\t ')).toBe(false);
        expect(canSend('  hello  ')).toBe(true);
    });

    test('length is counted in characters like the server', () => {
        expect(characterCount('😀')).toBe(1);
        expect(canSend('😀'.repeat(MAX_MESSAGE_LENGTH))).toBe(true);
        expect(canSend('😀'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false);
    });
});

describe('titleFromMessage', () => {
    test('uses the first non-empty line with collapsed whitespace', () => {
        expect(titleFromMessage('\n  Plan   the\tlaunch \nsecond line')).toBe(
            'Plan the launch',
        );
    });

    test('shortens long titles on a character boundary', () => {
        const title = titleFromMessage('é'.repeat(80), 10);
        expect(characterCount(title)).toBe(10);
        expect(title.endsWith('…')).toBe(true);
    });

    test('never cuts a multi-part emoji and stays within the code-point limit', () => {
        const family = '👨‍👩‍👧‍👦'; // seven code points, one visible character
        const title = titleFromMessage(family.repeat(20), 10);
        expect(title).toBe(`${family}…`);
        expect(characterCount(title)).toBeLessThanOrEqual(10);
    });
});
