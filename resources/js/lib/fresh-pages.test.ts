import { describe, expect, test } from 'vite-plus/test';
import { keepPagesFresh } from '@/lib/fresh-pages';

type Listener = (event: { detail: Record<string, unknown> }) => void;
type Visit = {
    url: string;
    options: { onHttpException?: (response: { status: number }) => unknown };
};

/** Records listeners, visits and cache flushes instead of navigating. */
function fakeRouter() {
    const listeners: Record<string, Listener> = {};
    const visits: Visit[] = [];
    const state = { flushes: 0, gone: 0 };
    const inertia = {
        on: (name: string, listener: Listener) => {
            listeners[name] = listener;

            return () => {};
        },
        flushAll: () => {
            state.flushes++;
        },
        visit: (url: string, options: Visit['options'] = {}) => {
            visits.push({ url, options });
        },
    };
    keepPagesFresh(
        inertia as unknown as Parameters<typeof keepPagesFresh>[0],
        () => state.gone++,
    );

    const emit = (name: string, detail: Record<string, unknown>) =>
        listeners[name]({ detail });

    return { emit, visits, state };
}

const chatPage = (url: string) => ({ component: 'chat/index', url });

describe('keepPagesFresh', () => {
    test('a completed write through Inertia clears every prefetched page', () => {
        const { emit, state } = fakeRouter();

        emit('finish', { visit: { method: 'get', completed: true } });
        emit('finish', { visit: { method: 'delete', completed: false } });
        expect(state.flushes).toBe(0);

        emit('finish', { visit: { method: 'put', completed: true } });
        expect(state.flushes).toBe(1);
    });

    test('a chat page restored from history is fetched again', () => {
        const { emit, visits } = fakeRouter();

        emit('navigate', { type: 'visit', page: chatPage('/chat') });
        emit('navigate', {
            type: 'history',
            page: { component: 'connections/index', url: '/connections' },
        });
        expect(visits).toEqual([]);

        emit('navigate', { type: 'history', page: chatPage('/chat/abc') });
        expect(visits).toHaveLength(1);
        expect(visits[0].url).toBe('/chat/abc');
        expect(visits[0].options).toMatchObject({
            replace: true,
            preserveScroll: true,
        });
    });

    test('a restored chat whose conversation was deleted leads back to a new chat', () => {
        const { emit, visits, state } = fakeRouter();
        emit('navigate', { type: 'history', page: chatPage('/chat/abc') });
        const onHttpException = visits[0].options.onHttpException!;

        // Other failures keep Inertia's usual handling.
        expect(onHttpException({ status: 500 })).toBeUndefined();
        expect(visits).toHaveLength(1);

        expect(onHttpException({ status: 404 })).toBe(false);
        expect(state.gone).toBe(1);
        expect(visits[1].url).toBe('/chat');
    });
});
