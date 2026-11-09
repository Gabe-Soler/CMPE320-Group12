#pragma once

#include <filesystem>
#include <istream>
#include <string>
#include <vector>

#include "activity.h"
#include "location.h"

namespace bib
{
    /// What a loader produced, plus one message per row it had to skip.
    template <typename T>
    struct LoadResult
    {
        std::vector<T> items;
        std::vector<std::string> warnings;
    };

    /// Parses Activities.csv. Bad rows are skipped and reported, not fatal.
    LoadResult<Activity> parse_activities(std::istream& in);
    LoadResult<Activity> load_activities(const std::filesystem::path& file);

    /// Parses locations.csv (id,name,lat,lng). Blank lat/lng means "Anywhere".
    LoadResult<Location> parse_locations(std::istream& in);
    LoadResult<Location> load_locations(const std::filesystem::path& file);
}
