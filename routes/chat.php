<?php

use App\Http\Controllers\ChatRunController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\ProviderConnectionController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'verified'])->prefix('api/chat')->name('chat.')->scopeBindings()->group(function (): void {
    Route::get('conversations', [ConversationController::class, 'index'])->name('conversations.index');
    Route::post('conversations', [ConversationController::class, 'store'])->name('conversations.store');
    // Bulk delete takes a JSON body of IDs; only the caller's own conversations are deleted.
    Route::delete('conversations', [ConversationController::class, 'destroyMany'])->name('conversations.destroy-many');
    Route::delete('conversations/{conversation}', [ConversationController::class, 'destroy'])
        ->can('delete', 'conversation')->name('conversations.destroy');
    Route::get('conversations/{conversation}', [ConversationController::class, 'show'])
        ->can('view', 'conversation')->name('conversations.show');
    Route::patch('conversations/{conversation}', [ConversationController::class, 'update'])
        ->can('update', 'conversation')->name('conversations.update');
    Route::post('conversations/{conversation}/messages', [MessageController::class, 'store'])
        ->can('update', 'conversation')->name('messages.store');
    Route::get('conversations/{conversation}/messages/{message}', [MessageController::class, 'show'])
        ->can('view', 'conversation')->name('messages.show');

    // Stage A prototype run relay (task 2.4); ownership of {run} is checked in the controller.
    Route::post('conversations/{conversation}/runs', [ChatRunController::class, 'store'])
        ->can('update', 'conversation')->name('runs.store');
    Route::get('runs/{run}/events', [ChatRunController::class, 'events'])->whereUuid('run')->name('runs.events');
    Route::delete('runs/{run}', [ChatRunController::class, 'destroy'])->whereUuid('run')->name('runs.destroy');

    Route::get('provider-connections', [ProviderConnectionController::class, 'index'])->name('provider-connections.index');
    Route::post('provider-connections', [ProviderConnectionController::class, 'store'])->name('provider-connections.store');
    Route::get('provider-connections/{providerConnection}', [ProviderConnectionController::class, 'show'])
        ->can('view', 'providerConnection')->name('provider-connections.show');
});
