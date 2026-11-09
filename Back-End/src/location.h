#pragma once

#include <optional>
#include <string>

#include "geo.h"

namespace bib
{
    /// A starting point the user can pick ("Where are you now?").
    struct Location
    {
        std::string id;   // stable key used in the API, e.g. "goodwin-hall"
        std::string name; // label shown in the UI
        std::optional<GeoPoint> point; // nullopt means "Anywhere": no walking counted
    };
}
