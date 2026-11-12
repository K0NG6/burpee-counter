<?php

declare(strict_types=1);

use App\Http\Controllers\Api\RecordController;
use Illuminate\Support\Facades\Route;

Route::post('/records', [RecordController::class, 'store'])->name('api.records.store');
Route::get('/leaderboard', [RecordController::class, 'leaderboard'])->name('api.leaderboard.index');
