#pragma once

#include <vector>

#include "crow_all.h"
#include "location.h"
#include "recommender.h"

namespace bib
{
    /// {"locations": [{"id", "name"}, ...]}
    crow::json::wvalue locations_json(const std::vector<Location>& locations);

    /// {"query": {...}, "activities": [{...}, ...]} — the shape the front-end's api.ts expects.
    crow::json::wvalue activities_json(const Query& query, const std::vector<Suggestion>& suggestions);
}
