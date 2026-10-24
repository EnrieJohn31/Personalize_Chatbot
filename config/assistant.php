<?php

return [
    // Private engine endpoint on the Compose network; never published to the host.
    'agent_url' => env('AGENT_URL', 'http://agent:3101'),

    // Laravel signs every engine request with this key (contracts/README.md). Keep it in .env;
    // the engine receives the same value. Engine-to-Laravel callbacks will use a separate key.
    'agent_request_signing_key' => env('AGENT_REQUEST_SIGNING_KEY'),
    'agent_connect_timeout_seconds' => (float) env('AGENT_CONNECT_TIMEOUT_SECONDS', 2),
    'agent_timeout_seconds' => (float) env('AGENT_TIMEOUT_SECONDS', 5),
    // Event streams outlive ordinary calls: the whole stream is bounded by the run deadline
    // plus a margin, and each read by the engine's 15-second heartbeat plus a margin.
    'agent_stream_timeout_seconds' => (float) env('AGENT_STREAM_TIMEOUT_SECONDS', 240),
    'agent_stream_read_timeout_seconds' => (float) env('AGENT_STREAM_READ_TIMEOUT_SECONDS', 30),
    // Sign-in calls wait while the engine moves a sign-in on (it answers within about 5 seconds);
    // a connection test waits for one model reply, which the engine abandons after 60 seconds.
    'agent_connection_timeout_seconds' => (float) env('AGENT_CONNECTION_TIMEOUT_SECONDS', 15),
    'agent_connection_test_timeout_seconds' => (float) env('AGENT_CONNECTION_TEST_TIMEOUT_SECONDS', 75),

    // Accounts a user can connect under Connections, in page order. `auth` is how they connect:
    // the provider's own browser sign-in (oauth), a key the user enters (api_key), or nothing for
    // the administrator's local model server (none; its address is engine configuration). The
    // engine holds every credential. `test_model` must be in the engine's catalog; the OpenCode
    // defaults are free models, so a test message costs nothing on a pay-as-you-go balance. An
    // empty local test model uses the first model the server lists.
    'connection_providers' => [
        'openai' => [
            'name' => 'ChatGPT',
            'auth' => 'oauth',
            'test_model' => env('ASSISTANT_CONNECTION_TEST_MODEL', 'gpt-5.4-mini'),
        ],
        'opencode-go' => [
            'name' => 'OpenCode Go',
            'auth' => 'api_key',
            'test_model' => env('ASSISTANT_OPENCODE_GO_TEST_MODEL', 'beam-free'),
        ],
        'opencode' => [
            'name' => 'OpenCode Zen',
            'auth' => 'api_key',
            'test_model' => env('ASSISTANT_OPENCODE_ZEN_TEST_MODEL', 'beam-free'),
        ],
        'local' => [
            'name' => env('LOCAL_LLM_NAME') ?: 'Local model',
            'auth' => 'none',
            'test_model' => (string) env('LOCAL_LLM_TEST_MODEL', ''),
        ],
    ],

    // Whether runs use each conversation's chosen connection and model (task 3.2). When off, every
    // reply comes from the default profile below; a switch to fall back without changing choices.
    'live_replies' => (bool) env('ASSISTANT_LIVE_REPLIES', true),

    // Reasoning effort requested from models that reason: low, medium or high. Others ignore it.
    'reasoning' => env('ASSISTANT_REASONING', 'medium'),

    // Versioned default profile copied into each server-created run snapshot. The simulated
    // provider needs no connection and is only admitted when the engine enables simulation.
    'profile' => [
        'id' => 'default',
        'version' => 1,
        'model' => [
            'provider' => env('ASSISTANT_MODEL_PROVIDER', 'simulated'),
            'id' => env('ASSISTANT_MODEL_ID', 'simulated-echo'),
        ],
        'capabilities' => [],
    ],

    // Blueprint section 12 starting bounds; prototype values, not measured capacity.
    'limits' => [
        'history_messages' => 50,
        'max_model_rounds' => 4,
        'max_tool_calls' => 6,
        'run_deadline_ms' => 180_000,
    ],
];
