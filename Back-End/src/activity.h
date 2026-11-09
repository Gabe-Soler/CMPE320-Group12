#pragma once

#include <string>
#include <string_view>

#include "geo.h"
#include "schedule.h"

namespace bib
{
    enum class Cost
    {
        Unknown, // not stated in the source
        Free,
        Low,  // "$"  : cheapest option under $30
        High, // "$$" : $30 or more
    };

    struct Activity
    {
        int id;
        std::string name;
        std::string category;
        std::string description;
        std::string place;
        GeoPoint where;
        int duration; // minutes spent at the activity, not counting travel
        Cost cost;
        Schedule schedule;
    };

    /// "free" / "$" / "$$" / "" as used in the CSV.
    Cost parse_cost(std::string_view text);
    std::string_view to_string(Cost cost);
}
