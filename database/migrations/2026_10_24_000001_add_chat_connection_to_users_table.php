<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** The connection and model a user chose for chat replies; null keeps the built-in default. */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->foreignUuid('chat_connection_id')->nullable()->constrained('provider_connections')->nullOnDelete();
            $table->string('chat_model', 128)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('chat_connection_id');
            $table->dropColumn('chat_model');
        });
    }
};
