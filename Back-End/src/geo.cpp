#include "geo.h"

#include <cmath>

namespace bib
{
    namespace
    {
        constexpr double kEarthRadiusM = 6'371'000.0;
        constexpr double kPi = 3.14159265358979323846;
        constexpr double kWalkMetresPerMinute = 80.0; // about 4.8 km/h
        constexpr double kDetourFactor = 1.3;         // streets are not straight lines

        double to_radians(double degrees) { return degrees * kPi / 180.0; }
    }

    double distance_m(GeoPoint a, GeoPoint b)
    {
        const double dlat = to_radians(b.lat - a.lat);
        const double dlng = to_radians(b.lng - a.lng);
        const double h = std::sin(dlat / 2) * std::sin(dlat / 2) +
                         std::cos(to_radians(a.lat)) * std::cos(to_radians(b.lat)) *
                           std::sin(dlng / 2) * std::sin(dlng / 2);
        return 2 * kEarthRadiusM * std::asin(std::sqrt(h));
    }

    int walk_minutes(GeoPoint from, GeoPoint to)
    {
        const double metres = distance_m(from, to) * kDetourFactor;
        return static_cast<int>(std::ceil(metres / kWalkMetresPerMinute));
    }
}
