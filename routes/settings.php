<?php

use App\Http\Controllers\Settings\ConnectionsController;
use App\Http\Controllers\Settings\ProfileController;
use App\Http\Controllers\Settings\SecurityController;
use Illuminate\Auth\Middleware\RequirePassword;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth'])->group(function () {
    Route::redirect('settings', '/settings/profile');

    Route::get('settings/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('settings/profile', [ProfileController::class, 'update'])->name('profile.update');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::delete('settings/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    Route::get('settings/security', [SecurityController::class, 'edit'])
        ->middleware(RequirePassword::class)
        ->name('security.edit');

    Route::put('settings/password', [SecurityController::class, 'update'])
        ->middleware('throttle:6,1')
        ->name('user-password.update');

    Route::inertia('settings/appearance', 'settings/appearance')->name('appearance.edit');

    // ChatGPT subscription sign-in (task 3.1); the engine holds the tokens. The page polls while a
    // sign-in runs, so these routes take the session lock: a poll finishing during an action would
    // otherwise overwrite the session and lose the action's flashed errors.
    Route::get('settings/connections', [ConnectionsController::class, 'edit'])->block(15, 15)->name('connections.edit');
    Route::prefix('settings/connections/chatgpt')->name('connections.chatgpt.')->group(function () {
        Route::post('login', [ConnectionsController::class, 'startLogin'])->middleware('throttle:10,1')->block(15, 15)->name('login.store');
        Route::delete('login', [ConnectionsController::class, 'cancelLogin'])->block(15, 15)->name('login.destroy');
        Route::post('login/callback', [ConnectionsController::class, 'completeLogin'])->middleware('throttle:10,1')->block(15, 15)->name('login.callback');
        // Each test is a real message that counts against the user's plan.
        Route::post('test', [ConnectionsController::class, 'test'])->middleware('throttle:6,1')->name('test');
        Route::delete('/', [ConnectionsController::class, 'disconnect'])->block(15, 15)->name('destroy');
    });
});

Route::get('.well-known/passkey-endpoints', function () {
    return response()->json([
        'enroll' => route('security.edit'),
        'manage' => route('security.edit'),
    ]);
})->name('well-known.passkeys');
