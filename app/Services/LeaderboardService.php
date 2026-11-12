<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class LeaderboardService
{
    public const string CACHE_KEY = 'leaderboard:top_10';

    private const int CACHE_TTL_SECONDS = 3600;

    private const int TOP_LIMIT = 10;

    /**
     * Return the cached top-10 leaderboard ordered by total burpees.
     *
     * @return list<array{
     *     rank: int,
     *     user_id: string,
     *     name: string,
     *     total_burpees: int,
     *     best_record: int,
     *     records_count: int,
     *     total_duration_seconds: int
     * }>
     */
    public function getTopUsers(): array
    {
        return Cache::remember(
            self::CACHE_KEY,
            self::CACHE_TTL_SECONDS,
            fn (): array => $this->queryTopUsers(),
        );
    }

    /**
     * Invalidate the cached leaderboard after new record persistence.
     */
    public function invalidate(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /**
     * @return list<array{
     *     rank: int,
     *     user_id: string,
     *     name: string,
     *     total_burpees: int,
     *     best_record: int,
     *     records_count: int,
     *     total_duration_seconds: int
     * }>
     */
    private function queryTopUsers(): array
    {
        return DB::table('users')
            ->join('burpee_records', 'users.id', '=', 'burpee_records.user_id')
            ->select([
                'users.id as user_id',
                'users.name',
                DB::raw('SUM(burpee_records.count) as total_burpees'),
                DB::raw('MAX(burpee_records.count) as best_record'),
                DB::raw('SUM(burpee_records.duration_seconds) as total_duration_seconds'),
                DB::raw('COUNT(burpee_records.id) as records_count'),
            ])
            ->groupBy('users.id', 'users.name')
            ->orderByDesc('total_burpees')
            ->orderBy('total_duration_seconds')
            ->orderBy('users.id')
            ->limit(self::TOP_LIMIT)
            ->get()
            ->values()
            ->map(static fn (object $row, int $index): array => [
                'rank' => $index + 1,
                'user_id' => (string) $row->user_id,
                'name' => $row->name ?? 'Athlete #'.substr((string) $row->user_id, 0, 8),
                'total_burpees' => (int) $row->total_burpees,
                'best_record' => (int) $row->best_record,
                'records_count' => (int) $row->records_count,
                'total_duration_seconds' => (int) $row->total_duration_seconds,
            ])
            ->all();
    }
}

