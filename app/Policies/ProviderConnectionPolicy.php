<?php

namespace App\Policies;

use App\Models\ProviderConnection;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class ProviderConnectionPolicy
{
    public function view(User $user, ProviderConnection $providerConnection): Response
    {
        return $user->id === $providerConnection->user_id
            ? Response::allow()
            : Response::denyAsNotFound();
    }
}
