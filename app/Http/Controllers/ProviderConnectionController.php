<?php

namespace App\Http\Controllers;

use App\Http\Requests\Chat\PaginatedRequest;
use App\Http\Requests\Chat\StoreProviderConnectionRequest;
use App\Http\Resources\ProviderConnectionResource;
use App\Models\ProviderConnection;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ProviderConnectionController extends Controller
{
    public function index(PaginatedRequest $request): AnonymousResourceCollection
    {
        return ProviderConnectionResource::collection(
            $request->user()->providerConnections()
                ->orderByDesc('created_at')->orderByDesc('id')
                ->simplePaginate($request->integer('per_page', 25))
                ->appends($request->safe()->only(['per_page'])),
        );
    }

    public function store(StoreProviderConnectionRequest $request): ProviderConnectionResource
    {
        return new ProviderConnectionResource($request->user()->providerConnections()->create($request->validated()));
    }

    public function show(ProviderConnection $providerConnection): ProviderConnectionResource
    {
        return new ProviderConnectionResource($providerConnection);
    }
}
