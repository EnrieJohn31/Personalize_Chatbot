<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('provider_connections', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 64);
            $table->string('auth_method', 32);
            $table->string('status', 32)->default('not_configured');
            $table->string('credential_reference')->nullable()->unique();
            $table->timestamps();
            $table->index(['user_id', 'created_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('provider_connections');
    }
};
