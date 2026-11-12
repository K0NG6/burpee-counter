<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\BurpeeRecord;
use App\Models\User;
use App\Services\LeaderboardService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class RecordApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_creates_burpee_record_for_existing_user(): void
    {
        $user = User::factory()->create([
            'name' => 'Alex',
        ]);

        $response = $this->postJson('/api/records', [
            'user_id' => $user->id,
            'count' => 30,
            'duration_seconds' => 95,
        ]);

        $response->assertCreated()
            ->assertJsonStructure([
                'data' => [
                    'id',
                    'user_id',
                    'count',
                    'duration_seconds',
                    'created_at',
                ],
            ])
            ->assertJsonPath('data.user_id', $user->id)
            ->assertJsonPath('data.count', 30)
            ->assertJsonPath('data.duration_seconds', 95);

        $this->assertDatabaseHas('burpee_records', [
            'user_id' => $user->id,
            'count' => 30,
            'duration_seconds' => 95,
        ]);

        $this->assertCount(1, $user->fresh()->burpeeRecords);
    }

    public function test_store_auto_provisions_anonymous_user_and_normalizes_uuid(): void
    {
        $uuid = strtolower((string) Str::uuid());

        $firstResponse = $this->postJson('/api/records', [
            'user_id' => strtoupper($uuid),
            'count' => 20,
            'duration_seconds' => 60,
        ]);

        $firstResponse->assertCreated()
            ->assertJsonPath('data.user_id', $uuid);

        $secondResponse = $this->postJson('/api/records', [
            'user_id' => $uuid,
            'count' => 15,
            'duration_seconds' => 45,
        ]);

        $secondResponse->assertCreated();

        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseHas('users', ['id' => $uuid]);

        $user = User::query()->findOrFail($uuid);
        $this->assertCount(2, $user->burpeeRecords);
        $this->assertSame($user->id, $user->burpeeRecords->first()->user->id);
    }

    public function test_store_validates_payload_and_rejects_invalid_inputs(): void
    {
        $this->postJson('/api/records', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['user_id', 'count', 'duration_seconds']);

        $this->postJson('/api/records', [
            'user_id' => 'not-a-valid-uuid',
            'count' => 0,
            'duration_seconds' => -10,
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['user_id', 'count', 'duration_seconds']);

        $this->postJson('/api/records', [
            'user_id' => (string) Str::uuid(),
            'count' => 10001,
            'duration_seconds' => 86401,
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['count', 'duration_seconds']);
    }

    public function test_leaderboard_returns_top_10_users_ordered_by_total_burpees_and_duration(): void
    {
        // User with 0 records should never appear on the leaderboard.
        User::factory()->create(['name' => 'IdleUser']);

        // Create 10 users with 10..100 burpees (steps of 10).
        for ($i = 1; $i <= 10; $i++) {
            $user = User::factory()->create(['name' => "Athlete {$i}"]);
            BurpeeRecord::factory()->create([
                'user_id' => $user->id,
                'count' => $i * 10,
                'duration_seconds' => 100,
            ]);
        }

        // User 11 splits 150 burpees across 2 workouts -> must be Rank 1.
        $leader = User::factory()->create(['name' => 'TopLeader']);
        BurpeeRecord::factory()->create([
            'user_id' => $leader->id,
            'count' => 80,
            'duration_seconds' => 120,
        ]);
        BurpeeRecord::factory()->create([
            'user_id' => $leader->id,
            'count' => 70,
            'duration_seconds' => 110,
        ]);

        // User 12 ties with Athlete 10 (100 burpees), but faster (50s vs 100s) -> must beat Athlete 10.
        $fasterTiedUser = User::factory()->create(['name' => 'FasterTied']);
        BurpeeRecord::factory()->create([
            'user_id' => $fasterTiedUser->id,
            'count' => 100,
            'duration_seconds' => 50,
        ]);

        $response = $this->getJson('/api/leaderboard');

        $response->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('data.0.rank', 1)
            ->assertJsonPath('data.0.user_id', $leader->id)
            ->assertJsonPath('data.0.name', 'TopLeader')
            ->assertJsonPath('data.0.total_burpees', 150)
            ->assertJsonPath('data.0.best_record', 80)
            ->assertJsonPath('data.0.records_count', 2)
            ->assertJsonPath('data.0.total_duration_seconds', 230)
            ->assertJsonPath('data.1.rank', 2)
            ->assertJsonPath('data.1.user_id', $fasterTiedUser->id)
            ->assertJsonPath('data.2.rank', 3)
            ->assertJsonPath('data.2.name', 'Athlete 10')
            ->assertJsonPath('data.9.rank', 10)
            ->assertJsonPath('data.9.name', 'Athlete 3');
    }

    public function test_leaderboard_caches_response_and_invalidates_on_new_record(): void
    {
        $alice = User::factory()->create(['name' => 'Alice']);
        $bob = User::factory()->create(['name' => 'Bob']);

        BurpeeRecord::factory()->create([
            'user_id' => $alice->id,
            'count' => 50,
            'duration_seconds' => 120,
        ]);
        BurpeeRecord::factory()->create([
            'user_id' => $bob->id,
            'count' => 30,
            'duration_seconds' => 80,
        ]);

        // 1st call: cache miss -> queries database and warms cache.
        DB::flushQueryLog();
        DB::enableQueryLog();

        $firstResponse = $this->getJson('/api/leaderboard');
        $firstResponse->assertOk()
            ->assertJsonPath('data.0.user_id', $alice->id);

        $firstQueryCount = count(DB::getQueryLog());
        $this->assertGreaterThan(0, $firstQueryCount);
        $this->assertTrue(Cache::has(LeaderboardService::CACHE_KEY));

        // 2nd call: cache hit -> 0 database queries.
        DB::flushQueryLog();

        $secondResponse = $this->getJson('/api/leaderboard');
        $secondResponse->assertOk()
            ->assertExactJson($firstResponse->json());

        $this->assertCount(0, DB::getQueryLog());

        // New record pushes Bob past Alice and invalidates cache.
        $this->postJson('/api/records', [
            'user_id' => $bob->id,
            'count' => 40,
            'duration_seconds' => 90,
        ])->assertCreated();

        $this->assertFalse(Cache::has(LeaderboardService::CACHE_KEY));

        // 3rd call: cache miss again -> recomputes leaderboard with Bob at rank 1.
        DB::flushQueryLog();

        $thirdResponse = $this->getJson('/api/leaderboard');
        $thirdResponse->assertOk()
            ->assertJsonPath('data.0.user_id', $bob->id)
            ->assertJsonPath('data.0.total_burpees', 70)
            ->assertJsonPath('data.1.user_id', $alice->id)
            ->assertJsonPath('data.1.total_burpees', 50);

        $this->assertGreaterThan(0, count(DB::getQueryLog()));
    }

    public function test_invalid_record_submission_does_not_invalidate_cached_leaderboard(): void
    {
        $user = User::factory()->create();
        BurpeeRecord::factory()->create([
            'user_id' => $user->id,
            'count' => 25,
            'duration_seconds' => 60,
        ]);

        $this->getJson('/api/leaderboard')->assertOk();
        $this->assertTrue(Cache::has(LeaderboardService::CACHE_KEY));

        $this->postJson('/api/records', [
            'user_id' => $user->id,
            'count' => -1,
            'duration_seconds' => 60,
        ])->assertUnprocessable();

        $this->assertTrue(Cache::has(LeaderboardService::CACHE_KEY));
    }

    public function test_leaderboard_returns_empty_list_and_caches_when_no_records_exist(): void
    {
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->getJson('/api/leaderboard')
            ->assertOk()
            ->assertExactJson(['data' => []]);

        $this->assertGreaterThan(0, count(DB::getQueryLog()));
        $this->assertTrue(Cache::has(LeaderboardService::CACHE_KEY));

        DB::flushQueryLog();

        $this->getJson('/api/leaderboard')
            ->assertOk()
            ->assertExactJson(['data' => []]);

        $this->assertCount(0, DB::getQueryLog());
    }
}
