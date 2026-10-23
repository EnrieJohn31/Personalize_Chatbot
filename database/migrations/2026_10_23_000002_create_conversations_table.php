<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('provider_connection_id')->nullable()
                ->constrained()->nullOnDelete();
            $table->string('title', 200);
            $table->timestamps();
            $table->index(['user_id', 'updated_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conversations');
    }
};
