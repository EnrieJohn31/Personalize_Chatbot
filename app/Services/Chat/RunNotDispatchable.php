<?php

namespace App\Services\Chat;

use RuntimeException;

/** The conversation cannot start a run yet; nothing was sent to the engine. */
final class RunNotDispatchable extends RuntimeException
{
    private function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public static function connectionRequired(string $provider): self
    {
        return new self('connection_required', "The [$provider] model requires an owned [$provider] connection.");
    }

    public static function connectionNotReady(string $status): self
    {
        return new self('connection_not_ready', "The provider connection is [$status], not ready for live use.");
    }

    public static function noPendingUserMessage(): self
    {
        return new self('no_pending_user_message', 'The latest message must be a user message.');
    }
}
