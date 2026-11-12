<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('burpee_records', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('user_id')
                ->constrained('users')
                ->cascadeOnDelete();
            $table->unsignedInteger('count');
            $table->unsignedInteger('duration_seconds');
            $table->timestamps();

            $table->index(['user_id', 'count'], 'burpee_records_user_count_idx');
            $table->index('created_at', 'burpee_records_created_at_idx');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('burpee_records');
    }
};

