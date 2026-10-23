<?php

use App\Http\Controllers\ConversationController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\ProviderConnectionController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'verified'])->prefix('api/chat')->name('chat.')->scopeBindings()->group(function (): void {
    Route::get('conversations', [ConversationController::class, 'index'])->name('conversations.index');
    Route::post('conversations', [ConversationController::class, 'store'])->name('conversations.store');
    Route::get('conversations/{conversation}', [ConversationController::class, 'show'])
        ->can('view', 'conversation')->name('conversations.show');
    Route::patch('conversations/{conversation}', [ConversationController::class, 'update'])
        ->can('update', 'conversation')->name('conversations.update');
    Route::post('conversations/{conversation}/messages', [MessageController::class, 'store'])
        ->can('update', 'conversation')->name('messages.store');
    Route::get('conversations/{conversation}/messages/{message}', [MessageController::class, 'show'])
        ->can('view', 'conversation')->name('messages.show');

    Route::get('provider-connections', [ProviderConnectionController::class, 'index'])->name('provider-connections.index');
    Route::post('provider-connections', [ProviderConnectionController::class, 'store'])->name('provider-connections.store');
    Route::get('provider-connections/{providerConnection}', [ProviderConnectionController::class, 'show'])
        ->can('view', 'providerConnection')->name('provider-connections.show');
});
