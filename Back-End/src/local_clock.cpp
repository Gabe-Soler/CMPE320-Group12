#include "local_clock.h"

#include <cstdlib>
#include <ctime>

namespace bib
{
    LocalTime now_in_kingston()
    {
        // Set once; localtime_r then converts using Kingston's rules, including daylight saving.
        static const bool tzReady = [] {
            setenv("TZ", "America/Toronto", 1);
            tzset();
            return true;
        }();
        (void)tzReady;

        const std::time_t now = std::time(nullptr);
        std::tm local{};
        localtime_r(&now, &local);

        const DateKey date = (local.tm_year + 1900) * 10000 + (local.tm_mon + 1) * 100 + local.tm_mday;
        return {date, (local.tm_wday + 6) % 7, local.tm_hour * 60 + local.tm_min};
    }

    std::optional<LocalTime> parse_local_datetime(std::string_view text)
    {
        if (text.size() != 16 || text[10] != 'T') return std::nullopt;
        const auto date = parse_date(text.substr(0, 10));
        const auto minute = parse_clock(text.substr(11));
        if (!date || !minute || *minute >= kMinutesPerDay) return std::nullopt;
        return LocalTime{*date, weekday_of(*date), *minute};
    }
}
