#pragma once

#include <array>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace bib
{
    /// Minutes since local midnight, 0..1440 (1440 means "until midnight").
    using Minute = int;
    constexpr Minute kMinutesPerDay = 24 * 60;

    /// A calendar date packed as YYYYMMDD, so dates compare as plain integers.
    using DateKey = int;

    /// A moment in local (Kingston) time, split the way schedules need it.
    struct LocalTime
    {
        DateKey date;
        int weekday; // 0 = Monday ... 6 = Sunday
        Minute minute;
    };

    struct TimeRange
    {
        Minute start;
        Minute end;

        bool is_all_day() const { return start == 0 && end == kMinutesPerDay; }
    };

    /// Weekly opening hours, optionally limited to a span of dates.
    /// A one-day event is a span whose first and last dates are equal.
    class Schedule
    {
      public:
        void set_day(int weekday, std::vector<TimeRange> ranges);
        void limit_to_dates(DateKey first, DateKey last);

        /// Opening ranges on that day; empty if closed or outside the date span.
        const std::vector<TimeRange>& ranges_on(DateKey date, int weekday) const;

        bool is_empty() const;

      private:
        std::array<std::vector<TimeRange>, 7> week_{};
        DateKey first_ = 0;
        DateKey last_ = 99991231;
    };

    /// "HH:MM" (24-hour, "24:00" allowed) -> minutes since midnight.
    std::optional<Minute> parse_clock(std::string_view text);

    /// One day's hours: "" (closed), "anytime", or "HH:MM-HH:MM[,HH:MM-HH:MM...]".
    std::optional<std::vector<TimeRange>> parse_day_hours(std::string_view text);

    /// "YYYY-MM-DD" -> DateKey.
    std::optional<DateKey> parse_date(std::string_view text);

    /// Weekday (0 = Monday) of a valid DateKey.
    int weekday_of(DateKey date);

    /// 1170 -> "7:30 PM", 1440 -> "midnight".
    std::string format_clock_12h(Minute minute);
}
