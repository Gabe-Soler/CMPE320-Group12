#pragma once

namespace bib
{
    struct GeoPoint
    {
        double lat;
        double lng;
    };

    /// Great-circle distance in metres (haversine).
    double distance_m(GeoPoint a, GeoPoint b);

    /// Estimated walking time in whole minutes, rounded up. Straight-line
    /// distance is stretched by a detour factor because paths are not straight.
    int walk_minutes(GeoPoint from, GeoPoint to);
}
