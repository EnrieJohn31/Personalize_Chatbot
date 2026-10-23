<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('conversation_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('sequence');
            $table->string('role', 16);
            $table->text('content');
            $table->json('canonical_content')->nullable();
            $table->timestamps();
            $table->unique(['conversation_id', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
