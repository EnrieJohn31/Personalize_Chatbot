<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class ConversationPolicy
{
    public function view(User $user, Conversation $conversation): Response
    {
        return $user->id === $conversation->user_id
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function update(User $user, Conversation $conversation): Response
    {
        return $this->view($user, $conversation);
    }

    public function delete(User $user, Conversation $conversation): Response
    {
        return $this->view($user, $conversation);
    }
}
