#pragma once

#include <vector>

#include "crow_all.h"
#include "location.h"
#include "recommender.h"

namespace bib
{
    /// Everything the API serves. Built once at startup and never modified,
    /// so request handlers on different threads can share it safely.
    struct AppData
    {
        Recommender recommender;
        std::vector<Location> locations;
    };

    /// Registers /api/health, /api/locations and /api/activities. `data` must outlive `app`.
    void register_api_routes(crow::SimpleApp& app, const AppData& data);
}
