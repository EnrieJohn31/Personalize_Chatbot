<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The provider and model a conversation was started with, copied from the user's chat choice
     * so that later choices do not change existing conversations. Null uses the built-in default.
     */
    public function up(): void
    {
        Schema::table('conversations', function (Blueprint $table): void {
            $table->string('model_provider', 64)->nullable();
            $table->string('model', 128)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table): void {
            $table->dropColumn(['model_provider', 'model']);
        });
    }
};
