<?php

return [
    // Private engine endpoint on the Compose network; never published to the host.
    'agent_url' => env('AGENT_URL', 'http://agent:3101'),

    // Laravel signs every engine request with this key (contracts/README.md). Keep it in .env;
    // the engine receives the same value. Engine-to-Laravel callbacks will use a separate key.
    'agent_request_signing_key' => env('AGENT_REQUEST_SIGNING_KEY'),
    'agent_connect_timeout_seconds' => (float) env('AGENT_CONNECT_TIMEOUT_SECONDS', 2),
    'agent_timeout_seconds' => (float) env('AGENT_TIMEOUT_SECONDS', 5),

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
