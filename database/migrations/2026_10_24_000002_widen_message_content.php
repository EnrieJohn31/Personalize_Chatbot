<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Real model replies can exceed MySQL TEXT (65,535 bytes); the event contract allows final
     * answers of 200,000 characters. MEDIUMTEXT holds 16 MB.
     */
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table): void {
            $table->mediumText('content')->change();
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table): void {
            $table->text('content')->change();
        });
    }
};
