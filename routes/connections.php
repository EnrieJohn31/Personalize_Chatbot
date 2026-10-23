<?php

use App\Http\Controllers\ConnectionsController;
use Illuminate\Support\Facades\Route;

// Provider connections (task 3.1); the engine holds every credential. The page polls while a
// ChatGPT sign-in runs, so its routes take the session lock: a poll finishing during an action
// would otherwise overwrite the session and lose the action's flashed errors.
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('connections', [ConnectionsController::class, 'index'])->block(15, 15)->name('connections.index');
    Route::put('connections/chat', [ConnectionsController::class, 'useForChat'])->block(15, 15)->name('connections.chat.update');

    Route::prefix('connections/{provider}')
        ->whereIn('provider', array_keys((array) config('assistant.connection_providers')))
        ->name('connections.')
        ->group(function () {
            Route::post('login', [ConnectionsController::class, 'startLogin'])->middleware('throttle:10,1')->block(15, 15)->name('login.store');
            Route::delete('login', [ConnectionsController::class, 'cancelLogin'])->block(15, 15)->name('login.destroy');
            Route::post('login/callback', [ConnectionsController::class, 'completeLogin'])->middleware('throttle:10,1')->block(15, 15)->name('login.callback');
            Route::put('key', [ConnectionsController::class, 'saveKey'])->middleware('throttle:10,1')->block(15, 15)->name('key.update');
            // Each test is a real message that counts against the user's plan or balance.
            Route::post('test', [ConnectionsController::class, 'test'])->middleware('throttle:6,1')->name('test');
            Route::delete('/', [ConnectionsController::class, 'disconnect'])->block(15, 15)->name('destroy');
        });
});
