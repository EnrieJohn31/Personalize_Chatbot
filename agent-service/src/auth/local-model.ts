import { createProvider, type Model, type Provider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

/** An administrator-configured OpenAI-compatible server, such as Ollama, LM Studio, llama.cpp or vLLM. */
export interface LocalModelConfig {
    name: string;
    /** Base URL including `/v1`, without a trailing slash. */
    url: string;
    apiKey: string | null;
}

export interface LocalModelView {
    configured: boolean;
    name: string | null;
    baseUrl: string | null;
    reachable: boolean;
    models: string[];
    error: string | null;
}

/** Model IDs the application contracts accept; others the server lists are left out. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_MODELS = 200;
const LIST_TIMEOUT_MS = 3_000;
/** A model list fresher than this is reused, so page views do not hammer the server. */
const CACHE_MS = 15_000;
// Local models report neither limit through the OpenAI API; these are conservative defaults.
const CONTEXT_WINDOW = 32_768;
const MAX_OUTPUT_TOKENS = 8_192;
/** Sent as the bearer token when no LOCAL_LLM_API_KEY is set. */
const UNUSED_API_KEY = 'unused';

/**
 * The local model server. Its address comes only from the engine's configuration, never from a
 * request, so users cannot point the engine at other hosts. The model list is read from the
 * server's `GET /models` and cached briefly.
 */
export class LocalModelServer {
    private catalog: { at: number; models: string[]; error: string | null } | null = null;
    private loading: Promise<void> | null = null;

    constructor(
        private readonly config: LocalModelConfig,
        private readonly now: () => number,
        private readonly fetcher: typeof fetch = fetch,
    ) {}

    /** Reads the model list again unless a recent one is cached. Never rejects. */
    async refresh(): Promise<void> {
        if (this.catalog !== null && this.now() - this.catalog.at < CACHE_MS) {
            return;
        }

        this.loading ??= this.load().finally(() => {
            this.loading = null;
        });

        await this.loading;
    }

    view(): LocalModelView {
        return {
            configured: true,
            name: this.config.name,
            baseUrl: this.config.url,
            reachable: this.catalog !== null && this.catalog.error === null,
            models: this.catalog?.models ?? [],
            error: this.catalog?.error ?? null,
        };
    }

    /** A Pi provider with the current model list; call `refresh()` first. */
    provider(): Provider {
        const models = (this.catalog?.models ?? []).map((id): Model<'openai-completions'> => ({
            id,
            name: id,
            api: 'openai-completions',
            provider: 'local',
            baseUrl: this.config.url,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: CONTEXT_WINDOW,
            maxTokens: MAX_OUTPUT_TOKENS,
            // Ollama, vLLM, LM Studio and llama.cpp expect a system message and no reasoning_effort.
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        }));
        // Most local servers need no key, but the completions client refuses to send without one,
        // so a placeholder goes instead; servers started without a key ignore it.
        const apiKey = this.config.apiKey ?? UNUSED_API_KEY;

        return createProvider({
            id: 'local',
            name: this.config.name,
            baseUrl: this.config.url,
            auth: { apiKey: { name: this.config.name, resolve: async () => ({ auth: { apiKey } }) } },
            models,
            api: openAICompletionsApi(),
        });
    }

    private async load(): Promise<void> {
        try {
            const response = await this.fetcher(`${this.config.url}/models`, {
                headers: { Accept: 'application/json', ...(this.config.apiKey === null ? {} : { Authorization: `Bearer ${this.config.apiKey}` }) },
                signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
            });
            if (!response.ok) {
                throw new Error(`The server answered ${response.status} for its model list.`);
            }

            const body = (await response.json()) as { data?: unknown };
            const ids = Array.isArray(body.data)
                ? body.data
                      .map((entry: unknown) => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : null))
                      .filter((id): id is string => typeof id === 'string' && MODEL_ID.test(id))
                : [];

            this.catalog = { at: this.now(), models: [...new Set(ids)].slice(0, MAX_MODELS), error: null };
        } catch (error) {
            const reason = error instanceof Error && error.name === 'TimeoutError' ? 'did not answer in time' : 'could not be reached';
            this.catalog = { at: this.now(), models: [], error: `${this.config.name} ${reason}.` };
        }
    }
}

/** Reads LOCAL_LLM_URL, LOCAL_LLM_NAME and LOCAL_LLM_API_KEY; null when no server is configured. */
export function localModelConfig(env: NodeJS.ProcessEnv): LocalModelConfig | null {
    const raw = env.LOCAL_LLM_URL?.trim() ?? '';
    if (raw === '') {
        return null;
    }

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('LOCAL_LLM_URL must be an http or https URL, for example http://host.docker.internal:11434/v1.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
        throw new Error('LOCAL_LLM_URL must be a plain http or https URL without credentials, query or fragment.');
    }

    const name = (env.LOCAL_LLM_NAME?.trim() || 'Local model').replace(/[^\p{L}\p{N} ._()-]+/gu, ' ').slice(0, 64).trim();
    const apiKey = env.LOCAL_LLM_API_KEY?.trim() ?? '';

    return { name: name === '' ? 'Local model' : name, url: url.toString().replace(/\/+$/, ''), apiKey: apiKey === '' ? null : apiKey };
}
