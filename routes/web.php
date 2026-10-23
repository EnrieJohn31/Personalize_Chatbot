<?php

use App\Http\Controllers\ChatPageController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::inertia('dashboard', 'dashboard')->name('dashboard');
    Route::get('chat', [ChatPageController::class, 'index'])->name('chat.index');
    Route::get('chat/{conversation}', [ChatPageController::class, 'show'])
        ->can('view', 'conversation')->name('chat.show');
});

require __DIR__.'/settings.php';
require __DIR__.'/chat.php';
require __DIR__.'/connections.php';
