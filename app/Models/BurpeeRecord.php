<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\BurpeeRecordFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'count', 'duration_seconds'])]
class BurpeeRecord extends Model
{
    /** @use HasFactory<BurpeeRecordFactory> */
    use HasFactory;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'count' => 'integer',
            'duration_seconds' => 'integer',
        ];
    }

    /**
     * Get the user that owns this burpee record.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

