<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreBurpeeRecordRequest;
use App\Models\BurpeeRecord;
use App\Models\User;
use App\Services\LeaderboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class RecordController extends Controller
{
    public function __construct(
        private readonly LeaderboardService $leaderboardService,
    ) {}

    /**
     * Store a newly completed burpee workout record and invalidate leaderboard cache.
     */
    public function store(StoreBurpeeRecordRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $record = DB::transaction(static function () use ($validated): BurpeeRecord {
            $now = now()->toDateTimeString();

            // Atomic upsert-if-missing avoids unique-violation transaction aborts in PostgreSQL.
            User::query()->insertOrIgnore([
                [
                    'id' => $validated['user_id'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ],
            ]);

            return BurpeeRecord::query()->create([
                'user_id' => $validated['user_id'],
                'count' => (int) $validated['count'],
                'duration_seconds' => (int) $validated['duration_seconds'],
            ]);
        });

        $this->leaderboardService->invalidate();

        return response()->json([
            'data' => [
                'id' => $record->id,
                'user_id' => $record->user_id,
                'count' => $record->count,
                'duration_seconds' => $record->duration_seconds,
                'created_at' => $record->created_at?->toIso8601String(),
            ],
        ], Response::HTTP_CREATED);
    }

    /**
     * Return the cached top-10 burpee leaderboard.
     */
    public function leaderboard(): JsonResponse
    {
        return response()->json([
            'data' => $this->leaderboardService->getTopUsers(),
        ]);
    }
}

